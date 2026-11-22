"""PostgreSQL authoritative concurrency test suite for invoice lifecycle, locking, and race conditions.

Opt-in test suite requiring a live PostgreSQL instance specified via POSTGRES_TEST_URL.
"""

from concurrent.futures import ThreadPoolExecutor
from datetime import date
from decimal import Decimal
import os
import uuid
import pytest
from sqlalchemy import create_engine, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import sessionmaker, Session

from app.core.exceptions import ConflictError, ValidationError
from app.models.business import Business
from app.models.customer import Customer
from app.models.invoice import Invoice, InvoiceItem
from app.schemas.invoice import InvoiceCreateRequest, InvoiceItemCreateRequest, InvoiceUpdateRequest
from app.services.customer import create_customer
from app.services.invoice import (
    create_invoice,
    transition_invoice_status,
    update_invoice,
)

POSTGRES_TEST_URL = os.getenv("POSTGRES_TEST_URL")


@pytest.mark.skipif(not POSTGRES_TEST_URL, reason="POSTGRES_TEST_URL not set; skipping live PostgreSQL concurrency suite")
def test_mark_sent_vs_customer_deactivation_concurrency_pg() -> None:
    """Verify serialization between MARK_SENT and Customer Deactivation."""
    engine = create_engine(POSTGRES_TEST_URL, pool_pre_ping=True)
    SessionFactory = sessionmaker(bind=engine, autocommit=False, autoflush=False)

    # Setup test workspace and customer
    setup_session = SessionFactory()
    biz = Business(name=f"PG Test Biz {uuid.uuid4().hex[:8]}", base_currency="USD")
    setup_session.add(biz)
    setup_session.flush()

    cust = Customer(business_id=biz.id, name="Concurrency Customer", is_active=True)
    setup_session.add(cust)
    setup_session.flush()

    inv = Invoice(
        business_id=biz.id,
        customer_id=cust.id,
        invoice_number=f"INV-CONC-{uuid.uuid4().hex[:6]}",
        status="DRAFT",
        issue_date=date.today(),
        due_date=date.today(),
        subtotal=Decimal("100.00"),
        tax_rate=Decimal("0.0000"),
        tax_amount=Decimal("0.00"),
        discount_amount=Decimal("0.00"),
        total_amount=Decimal("100.00"),
        paid_amount=Decimal("0.00"),
        balance_due=Decimal("100.00"),
    )
    setup_session.add(inv)
    setup_session.commit()
    biz_id = biz.id
    cust_id = cust.id
    inv_id = inv.id
    setup_session.close()

    results = {}

    def run_mark_sent() -> None:
        session = SessionFactory()
        try:
            res = transition_invoice_status(session, biz_id, inv_id, "MARK_SENT")
            results["mark_sent"] = res.status
        except ValidationError as e:
            results["mark_sent"] = e.code
        except Exception as e:
            results["mark_sent"] = str(e)
        finally:
            session.close()

    def run_deactivate_customer() -> None:
        session = SessionFactory()
        try:
            target = (
                session.query(Customer)
                .filter(Customer.id == cust_id, Customer.business_id == biz_id)
                .with_for_update()
                .populate_existing()
                .one()
            )
            target.is_active = False
            session.commit()
            results["deactivate"] = "SUCCESS"
        except Exception as e:
            results["deactivate"] = str(e)
        finally:
            session.close()

    with ThreadPoolExecutor(max_workers=2) as executor:
        f1 = executor.submit(run_mark_sent)
        f2 = executor.submit(run_deactivate_customer)
        f1.result()
        f2.result()

    # Serialization assert: either MARK_SENT succeeded (SENT) before deactivation,
    # or customer deactivation acquired lock first, causing MARK_SENT to fail with CUSTOMER_INACTIVE.
    assert results["deactivate"] == "SUCCESS"
    assert results["mark_sent"] in ("SENT", "CUSTOMER_INACTIVE")


@pytest.mark.skipif(not POSTGRES_TEST_URL, reason="POSTGRES_TEST_URL not set; skipping live PostgreSQL concurrency suite")
def test_concurrent_invoice_number_uniqueness_pg() -> None:
    """Verify that concurrent creation of duplicate invoice number results in exactly one 409 Conflict."""
    engine = create_engine(POSTGRES_TEST_URL, pool_pre_ping=True)
    SessionFactory = sessionmaker(bind=engine, autocommit=False, autoflush=False)

    setup_session = SessionFactory()
    biz = Business(name=f"PG Test Biz {uuid.uuid4().hex[:8]}", base_currency="USD")
    setup_session.add(biz)
    setup_session.flush()

    cust = Customer(business_id=biz.id, name="Customer", is_active=True)
    setup_session.add(cust)
    setup_session.commit()
    biz_id = biz.id
    cust_id = cust.id
    setup_session.close()

    unique_inv_number = f"INV-DUP-{uuid.uuid4().hex[:8]}"

    def create_single_invoice() -> str:
        session = SessionFactory()
        req = InvoiceCreateRequest(
            customer_id=cust_id,
            invoice_number=unique_inv_number,
            issue_date=date.today(),
            due_date=date.today(),
            items=[InvoiceItemCreateRequest(description="Item", quantity="1.00", unit_price="50.00")],
        )
        try:
            create_invoice(session, biz_id, req)
            return "SUCCESS"
        except ConflictError as e:
            return e.code
        finally:
            session.close()

    with ThreadPoolExecutor(max_workers=2) as executor:
        f1 = executor.submit(create_single_invoice)
        f2 = executor.submit(create_single_invoice)
        r1 = f1.result()
        r2 = f2.result()

    outcomes = sorted([r1, r2])
    assert outcomes == ["INVOICE_NUMBER_ALREADY_EXISTS", "SUCCESS"]


@pytest.mark.skipif(not POSTGRES_TEST_URL, reason="POSTGRES_TEST_URL not set; skipping live PostgreSQL concurrency suite")
def test_customer_reassignment_vs_customer_deactivation_concurrency_pg() -> None:
    """Verify serialization between Customer Reassignment and Customer Deactivation."""
    engine = create_engine(POSTGRES_TEST_URL, pool_pre_ping=True)
    SessionFactory = sessionmaker(bind=engine, autocommit=False, autoflush=False)

    setup_session = SessionFactory()
    biz = Business(name=f"PG Test Biz {uuid.uuid4().hex[:8]}", base_currency="USD")
    setup_session.add(biz)
    setup_session.flush()

    cust_a = Customer(business_id=biz.id, name="Old Customer A", is_active=True)
    cust_b = Customer(business_id=biz.id, name="New Customer B", is_active=True)
    setup_session.add_all([cust_a, cust_b])
    setup_session.flush()

    inv = Invoice(
        business_id=biz.id,
        customer_id=cust_a.id,
        invoice_number=f"INV-REASSIGN-{uuid.uuid4().hex[:6]}",
        status="DRAFT",
        issue_date=date.today(),
        due_date=date.today(),
        subtotal=Decimal("100.00"),
        tax_rate=Decimal("0.0000"),
        tax_amount=Decimal("0.00"),
        discount_amount=Decimal("0.00"),
        total_amount=Decimal("100.00"),
        paid_amount=Decimal("0.00"),
        balance_due=Decimal("100.00"),
    )
    setup_session.add(inv)
    setup_session.commit()
    biz_id = biz.id
    cust_a_id = cust_a.id
    cust_b_id = cust_b.id
    inv_id = inv.id
    setup_session.close()

    results = {}

    def run_reassignment() -> None:
        session = SessionFactory()
        try:
            req = InvoiceUpdateRequest(customer_id=cust_b_id)
            res = update_invoice(session, biz_id, inv_id, req)
            results["reassignment"] = str(res.customer_id)
        except ValidationError as e:
            results["reassignment"] = e.code
        except Exception as e:
            results["reassignment"] = str(e)
        finally:
            session.close()

    def run_deactivate_b() -> None:
        session = SessionFactory()
        try:
            target = (
                session.query(Customer)
                .filter(Customer.id == cust_b_id, Customer.business_id == biz_id)
                .with_for_update()
                .populate_existing()
                .one()
            )
            target.is_active = False
            session.commit()
            results["deactivate_b"] = "SUCCESS"
        except Exception as e:
            results["deactivate_b"] = str(e)
        finally:
            session.close()

    with ThreadPoolExecutor(max_workers=2) as executor:
        f1 = executor.submit(run_reassignment)
        f2 = executor.submit(run_deactivate_b)
        f1.result()
        f2.result()

    assert results["deactivate_b"] == "SUCCESS"
    assert results["reassignment"] in (str(cust_b_id), "CUSTOMER_INACTIVE")


from threading import Barrier, Event


@pytest.mark.skipif(not POSTGRES_TEST_URL, reason="POSTGRES_TEST_URL not set; skipping live PostgreSQL concurrency suite")
def test_invoice_creation_vs_customer_deactivation_concurrency_pg() -> None:
    """Verify deterministic serialization: no invoice can be created against a customer deactivated before lock acquisition."""
    engine = create_engine(POSTGRES_TEST_URL, pool_pre_ping=True)
    SessionFactory = sessionmaker(bind=engine, autocommit=False, autoflush=False)

    setup_session = SessionFactory()
    biz = Business(name=f"PG Test Biz {uuid.uuid4().hex[:8]}", base_currency="USD")
    setup_session.add(biz)
    setup_session.flush()

    cust = Customer(business_id=biz.id, name="Target Customer", is_active=True)
    setup_session.add(cust)
    setup_session.commit()
    biz_id = biz.id
    cust_id = cust.id
    setup_session.close()

    barrier = Barrier(2)
    results = {}

    def run_deactivate_first() -> None:
        session = SessionFactory()
        try:
            # Acquire exclusive lock on customer and deactivate
            target = (
                session.query(Customer)
                .filter(Customer.id == cust_id, Customer.business_id == biz_id)
                .with_for_update()
                .populate_existing()
                .one()
            )
            target.is_active = False
            session.flush()
            # Synchronize: both threads arrived; deactivation holds lock
            barrier.wait(timeout=5)
            session.commit()
            results["deactivate"] = "SUCCESS"
        except Exception as e:
            results["deactivate"] = str(e)
            session.rollback()
        finally:
            session.close()

    def run_create_invoice() -> None:
        session = SessionFactory()
        try:
            # Synchronize so Thread 1 holds lock
            barrier.wait(timeout=5)
            req = InvoiceCreateRequest(
                customer_id=cust_id,
                invoice_number=f"INV-CREATE-{uuid.uuid4().hex[:6]}",
                issue_date=date.today(),
                due_date=date.today(),
                items=[InvoiceItemCreateRequest(description="Item", quantity="1.00", unit_price="25.00")],
            )
            create_invoice(session, biz_id, req)
            results["create"] = "SUCCESS"
        except ValidationError as e:
            results["create"] = e.code
        except Exception as e:
            results["create"] = str(e)
        finally:
            session.close()

    with ThreadPoolExecutor(max_workers=2) as executor:
        f1 = executor.submit(run_deactivate_first)
        f2 = executor.submit(run_create_invoice)
        f1.result()
        f2.result()

    assert results["deactivate"] == "SUCCESS"
    assert results["create"] == "CUSTOMER_INACTIVE"


@pytest.mark.skipif(not POSTGRES_TEST_URL, reason="POSTGRES_TEST_URL not set; skipping live PostgreSQL concurrency suite")
def test_customer_reassignment_vs_mark_sent_concurrency_pg() -> None:
    """Verify canonical lock hierarchy and savepoint retry: concurrent customer reassignment and MARK_SENT."""
    engine = create_engine(POSTGRES_TEST_URL, pool_pre_ping=True)
    SessionFactory = sessionmaker(bind=engine, autocommit=False, autoflush=False)

    setup_session = SessionFactory()
    biz = Business(name=f"PG Test Biz {uuid.uuid4().hex[:8]}", base_currency="USD")
    setup_session.add(biz)
    setup_session.flush()

    cust_a = Customer(business_id=biz.id, name="Customer Alpha", is_active=True)
    cust_b = Customer(business_id=biz.id, name="Customer Beta", is_active=True)
    setup_session.add_all([cust_a, cust_b])
    setup_session.flush()

    inv = Invoice(
        business_id=biz.id,
        customer_id=cust_a.id,
        invoice_number=f"INV-RACE-{uuid.uuid4().hex[:6]}",
        status="DRAFT",
        issue_date=date.today(),
        due_date=date.today(),
        subtotal=Decimal("200.00"),
        tax_rate=Decimal("0.0000"),
        tax_amount=Decimal("0.00"),
        discount_amount=Decimal("0.00"),
        total_amount=Decimal("200.00"),
        paid_amount=Decimal("0.00"),
        balance_due=Decimal("200.00"),
    )
    setup_session.add(inv)
    setup_session.commit()
    biz_id = biz.id
    cust_a_id = cust_a.id
    cust_b_id = cust_b.id
    inv_id = inv.id
    setup_session.close()

    barrier = Barrier(2)
    results = {}

    def run_reassign_to_b() -> None:
        session = SessionFactory()
        try:
            barrier.wait(timeout=5)
            req = InvoiceUpdateRequest(customer_id=cust_b_id)
            res = update_invoice(session, biz_id, inv_id, req)
            results["reassign"] = str(res.customer_id)
        except ValidationError as e:
            results["reassign"] = e.code or str(e)
        except Exception as e:
            results["reassign"] = str(e)
        finally:
            session.close()

    def run_mark_sent() -> None:
        session = SessionFactory()
        try:
            barrier.wait(timeout=5)
            res = transition_invoice_status(session, biz_id, inv_id, "MARK_SENT")
            results["mark_sent"] = res.status
        except ValidationError as e:
            results["mark_sent"] = e.code or str(e)
        except Exception as e:
            results["mark_sent"] = str(e)
        finally:
            session.close()

    with ThreadPoolExecutor(max_workers=2) as executor:
        f1 = executor.submit(run_reassign_to_b)
        f2 = executor.submit(run_mark_sent)
        f1.result()
        f2.result()

    # Serialization assert:
    # No deadlock occurs.
    # MARK_SENT always produces SENT (either on old customer or after reassignment on new customer).
    # Reassignment either succeeded before MARK_SENT, or safely failed because invoice transitioned to SENT.
    verify_session = SessionFactory()
    final_inv = verify_session.query(Invoice).filter(Invoice.id == inv_id).one()
    assert results["mark_sent"] == "SENT"
    assert final_inv.status == "SENT"
    if results["reassign"] == str(cust_b_id):
        assert final_inv.customer_id == cust_b_id
    else:
        assert "Only DRAFT invoices can be edited" in str(results["reassign"]) or results["reassign"] == "INVALID_INVOICE_STATE"
        assert final_inv.customer_id == cust_a_id
    verify_session.close()
