"""Unit tests for invoice mathematical calculations, fixed-point precision, and validation boundaries."""

from datetime import date
from decimal import Decimal
import pytest
from pydantic import ValidationError as PydanticValidationError

from app.core.exceptions import ValidationError
from app.schemas.invoice import (
    InvoiceCreateRequest,
    InvoiceItemCreateRequest,
    InvoiceUpdateRequest,
)
from app.services.invoice import (
    calculate_invoice_totals,
    calculate_line_total,
    derive_presentation_status,
)


def test_calculate_line_total_half_up() -> None:
    """Verify ROUND_HALF_UP rounding on line item totals."""
    # 2.5 * 1.55 = 3.875 -> 3.88
    tot = calculate_line_total(Decimal("2.5"), Decimal("1.55"))
    assert tot == Decimal("3.88")

    # 1.0 * 1.554 = 1.554 -> 1.55
    tot = calculate_line_total(Decimal("1.0"), Decimal("1.554"))
    assert tot == Decimal("1.55")


def test_calculate_invoice_totals_multi_line_and_tax() -> None:
    """Verify subtotaling, tax, and discount arithmetic."""
    items = [
        (Decimal("2.00"), Decimal("100.00")),  # 200.00
        (Decimal("3.00"), Decimal("50.00")),   # 150.00
    ]
    # Subtotal = 350.00
    # Tax @ 18% = 350.00 * 0.1800 = 63.00
    # Discount = 25.00
    # Total = 350.00 + 63.00 - 25.00 = 388.00
    subtotal, tax_amount, total_amount, balance_due = calculate_invoice_totals(
        items, Decimal("0.1800"), Decimal("25.00")
    )
    assert subtotal == Decimal("350.00")
    assert tax_amount == Decimal("63.00")
    assert total_amount == Decimal("388.00")
    assert balance_due == Decimal("388.00")


def test_discount_exceeding_subtotal_plus_tax_rejected() -> None:
    """Discount amount cannot exceed subtotal + tax."""
    items = [(Decimal("1.00"), Decimal("100.00"))]
    with pytest.raises(ValidationError) as exc:
        calculate_invoice_totals(items, Decimal("0.1000"), Decimal("115.00"))
    assert exc.value.code == "DISCOUNT_EXCEEDS_TOTAL"


def test_numerical_overflow_limit_rejected() -> None:
    """Calculated totals exceeding NUMERIC(15,2) capacity must be rejected."""
    huge_items = [(Decimal("10000000.00"), Decimal("100000000.00"))]
    with pytest.raises(ValidationError) as exc:
        calculate_invoice_totals(huge_items, Decimal("0.1000"), Decimal("0.00"))
    assert exc.value.code == "NUMERICAL_OVERFLOW_LIMIT"


def test_quantity_excess_scale_rejected() -> None:
    """Quantity with scale > 2 must be rejected."""
    with pytest.raises(PydanticValidationError) as exc:
        InvoiceItemCreateRequest(
            description="Consulting",
            quantity="5.125",
            unit_price="100.00",
        )
    assert "MAX_SCALE_EXCEEDED" in str(exc.value)


def test_unit_price_excess_scale_rejected() -> None:
    """Unit price with scale > 2 must be rejected."""
    with pytest.raises(PydanticValidationError) as exc:
        InvoiceItemCreateRequest(
            description="Consulting",
            quantity="5.00",
            unit_price="100.999",
        )
    assert "MAX_SCALE_EXCEEDED" in str(exc.value)


def test_tax_rate_excess_scale_rejected() -> None:
    """Tax rate with scale > 4 must be rejected."""
    with pytest.raises(PydanticValidationError) as exc:
        InvoiceCreateRequest(
            customer_id="00000000-0000-0000-0000-000000000001",
            invoice_number="INV-001",
            issue_date=date(2026, 11, 1),
            due_date=date(2026, 11, 30),
            tax_rate="0.18255",
            discount_amount="0.00",
            items=[InvoiceItemCreateRequest(description="Item", quantity="1.00", unit_price="10.00")],
        )
    assert "MAX_SCALE_EXCEEDED" in str(exc.value)


def test_empty_description_rejected() -> None:
    """Empty or whitespace-only description must be rejected."""
    with pytest.raises(PydanticValidationError):
        InvoiceItemCreateRequest(
            description="   ",
            quantity="1.00",
            unit_price="10.00",
        )


def test_date_inversion_rejected() -> None:
    """due_date earlier than issue_date must be rejected."""
    with pytest.raises(PydanticValidationError) as exc:
        InvoiceCreateRequest(
            customer_id="00000000-0000-0000-0000-000000000001",
            invoice_number="INV-001",
            issue_date=date(2026, 11, 30),
            due_date=date(2026, 11, 1),
            tax_rate="0.1800",
            discount_amount="0.00",
            items=[InvoiceItemCreateRequest(description="Item", quantity="1.00", unit_price="10.00")],
        )
    assert "INVALID_DATE_RANGE" in str(exc.value)
