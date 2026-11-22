"""Unit tests for invoice state machine transitions, derived presentation status, and cancellation invariants."""

from datetime import date
from decimal import Decimal
import pytest

from app.core.exceptions import ConflictError, ValidationError
from app.services.invoice import derive_presentation_status


def test_derive_presentation_status_draft_never_overdue() -> None:
    """DRAFT status is never OVERDUE, even if due date is in the past."""
    today = date(2026, 11, 22)
    past_date = date(2026, 10, 1)

    status = derive_presentation_status(
        persisted_status="DRAFT",
        due_date=past_date,
        balance_due=Decimal("100.00"),
        request_today_utc=today,
    )
    assert status == "DRAFT"


def test_derive_presentation_status_sent_future_is_sent() -> None:
    """SENT status with future due date remains SENT."""
    today = date(2026, 11, 22)
    future_date = date(2026, 12, 1)

    status = derive_presentation_status(
        persisted_status="SENT",
        due_date=future_date,
        balance_due=Decimal("100.00"),
        request_today_utc=today,
    )
    assert status == "SENT"


def test_derive_presentation_status_sent_past_is_overdue() -> None:
    """SENT status with past due date and positive balance is OVERDUE."""
    today = date(2026, 11, 22)
    past_date = date(2026, 11, 20)

    status = derive_presentation_status(
        persisted_status="SENT",
        due_date=past_date,
        balance_due=Decimal("100.00"),
        request_today_utc=today,
    )
    assert status == "OVERDUE"


def test_derive_presentation_status_due_today_is_not_overdue() -> None:
    """Invoice due today is not yet overdue (due_date < today is false)."""
    today = date(2026, 11, 22)

    status = derive_presentation_status(
        persisted_status="SENT",
        due_date=today,
        balance_due=Decimal("100.00"),
        request_today_utc=today,
    )
    assert status == "SENT"


def test_derive_presentation_status_partially_paid_past_is_overdue() -> None:
    """PARTIALLY_PAID status with past due date and positive balance is OVERDUE."""
    today = date(2026, 11, 22)
    past_date = date(2026, 11, 15)

    status = derive_presentation_status(
        persisted_status="PARTIALLY_PAID",
        due_date=past_date,
        balance_due=Decimal("50.00"),
        request_today_utc=today,
    )
    assert status == "OVERDUE"


def test_derive_presentation_status_zero_balance_never_overdue() -> None:
    """Invoice with zero balance due is never OVERDUE."""
    today = date(2026, 11, 22)
    past_date = date(2026, 11, 1)

    status = derive_presentation_status(
        persisted_status="SENT",
        due_date=past_date,
        balance_due=Decimal("0.00"),
        request_today_utc=today,
    )
    assert status == "SENT"


def test_derive_presentation_status_paid_and_canceled_immutable() -> None:
    """PAID and CANCELED remain unchanged regardless of due date."""
    today = date(2026, 11, 22)
    past_date = date(2026, 10, 1)

    assert derive_presentation_status("PAID", past_date, Decimal("0.00"), today) == "PAID"
    assert derive_presentation_status("CANCELED", past_date, Decimal("100.00"), today) == "CANCELED"
