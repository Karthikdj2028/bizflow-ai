"""Demo transaction data generator and idempotent database seeder.

Inspects all 9 supported chart-of-accounts categories (3 Income, 6 Expense)
and seeds exactly 50 realistic, varied demo transactions per individual category
(450 total transactions) into a development database.

Features:
- Pure Decimal arithmetic (zero float types).
- Realistic descriptions, counterparties, amounts, and dates.
- Deterministic reference numbers ('DEMO-{CODE}-{INDEX:03d}').
- Strict multi-tenant business data isolation.
- Complete idempotency: running repeatedly will not produce duplicates.
- Non-destructive: preserves all existing user transactions.
- Provides CLI entrypoint for local Windows/macOS development setup.
"""

import argparse
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal
import sys
from typing import Any, Dict, List, Optional, Tuple
import uuid

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.database import SessionLocal
from app.core.security import hash_password
from app.models.business import Business
from app.models.category import Category
from app.models.membership import BusinessMembership
from app.models.transaction import Transaction
from app.models.user import User
from app.services.category import DEFAULT_CATEGORIES, seed_default_categories

# Category code abbreviations used in deterministic demo reference numbers
CATEGORY_CODES: Dict[str, str] = {
    "Sales & Services": "SLS",
    "Consulting & Advisory": "CNS",
    "Other Income": "OTH",
    "Software & Subscriptions": "SFT",
    "Rent & Office Space": "RNT",
    "Marketing & Advertising": "MKT",
    "Professional Services": "PRF",
    "Travel & Entertainment": "TRV",
    "General & Administrative": "ADM",
}

# ---------------------------------------------------------------------------
# Realistic Template Generators (50 items per category)
# ---------------------------------------------------------------------------

def _build_sales_templates() -> List[Dict[str, Any]]:
    counterparties = [
        "Acme Retailers Corp", "Global Logistics Partners", "Nexus Innovations",
        "Apex Tech Solutions", "Pinnacle Media Group", "Quantum Enterprises",
        "Vertex Industrial", "Horizon Dynamics LLC", "Starlight Ventures",
        "Cascade Systems Inc", "Echo Stream Media", "Beacon Healthcare",
    ]
    base_descriptions = [
        "Monthly SaaS platform subscription tier",
        "Enterprise annual license renewal",
        "Custom integration and API webhook setup",
        "Quarterly software maintenance retainer",
        "Dedicated technical support tier",
        "Platform onboarding and data migration fee",
        "Additional team seat licenses tier",
        "High-volume data processing package",
        "Custom analytics dashboard configuration",
        "Cloud service level agreement retainer",
    ]
    amounts = [
        "1250.00", "3400.00", "850.00", "5600.00", "12500.00",
        "750.00", "2200.00", "4100.00", "980.00", "6400.00",
        "1850.00", "2900.00", "4500.00", "1500.00", "8200.00",
        "3100.00", "670.00", "5200.00", "1950.00", "11000.00",
        "1400.00", "3800.00", "920.00", "4800.00", "7600.00",
        "2100.00", "3600.00", "1750.00", "6900.00", "890.00",
        "5400.00", "2600.00", "3950.00", "1350.00", "9500.00",
        "1600.00", "4300.00", "2800.00", "6100.00", "820.00",
        "3300.00", "1900.00", "4700.00", "7200.00", "1150.00",
        "5800.00", "2400.00", "3500.00", "8600.00", "10250.00",
    ]
    methods = ["BANK_TRANSFER", "CREDIT_CARD", "UPI", "BANK_TRANSFER", "CREDIT_CARD"]
    items = []
    for i in range(50):
        items.append({
            "description": f"[Demo] {base_descriptions[i % len(base_descriptions)]} #{i + 1}",
            "counterparty": counterparties[i % len(counterparties)],
            "amount": amounts[i],
            "payment_method": methods[i % len(methods)],
            "day_offset": (i * 3 + 2) % 175 + 1,
        })
    return items


def _build_consulting_templates() -> List[Dict[str, Any]]:
    counterparties = [
        "Stratton & Oak Partners", "Crestview Advisory LLC", "Beacon Strategy Group",
        "Summit Financial Consulting", "Alpha Capital Advisors", "Vanguard Leadership Corp",
        "Frontier Analytics Group", "Sterling Strategy Partners", "Archway Associates",
    ]
    base_descriptions = [
        "Financial systems architecture audit fee",
        "Q3 strategic financial planning workshop",
        "Operational workflow efficiency retainer",
        "Post-merger technical consolidation advisory",
        "Risk management and regulatory compliance review",
        "Executive fractional CFO retainer",
        "ERP implementation milestone consultation",
        "Cash flow forecasting model validation",
        "Internal accounting controls optimization",
        "Unit economics and margin analysis sprint",
    ]
    amounts = [
        "2500.00", "4800.00", "7500.00", "1500.00", "6200.00",
        "3200.00", "5100.00", "8400.00", "2100.00", "4300.00",
        "6900.00", "1800.00", "5500.00", "9200.00", "3600.00",
        "2900.00", "6400.00", "4100.00", "7800.00", "1600.00",
        "5300.00", "8800.00", "3400.00", "6100.00", "2200.00",
        "4700.00", "7100.00", "1900.00", "5800.00", "9500.00",
        "2700.00", "4900.00", "6600.00", "3800.00", "8100.00",
        "1400.00", "5200.00", "7400.00", "2300.00", "6500.00",
        "3500.00", "5900.00", "8600.00", "1700.00", "4600.00",
        "7300.00", "2800.00", "6800.00", "3900.00", "9100.00",
    ]
    methods = ["BANK_TRANSFER", "BANK_TRANSFER", "CREDIT_CARD", "OTHER", "BANK_TRANSFER"]
    items = []
    for i in range(50):
        items.append({
            "description": f"[Demo] {base_descriptions[i % len(base_descriptions)]} - Phase {i + 1}",
            "counterparty": counterparties[i % len(counterparties)],
            "amount": amounts[i],
            "payment_method": methods[i % len(methods)],
            "day_offset": (i * 3 + 4) % 170 + 2,
        })
    return items


def _build_other_income_templates() -> List[Dict[str, Any]]:
    counterparties = [
        "First National Commercial Bank", "City Treasury Dept", "State Revenue Office",
        "Vanguard Money Market", "Merchant Escrow Services", "Commercial Property Insurers",
        "Equipment Liquidators Inc", "Apex Merchant Services",
    ]
    base_descriptions = [
        "Commercial high-yield treasury interest",
        "Vendor volume rebate credit",
        "Overpaid supplier invoice refund",
        "Commercial property insurance claim credit",
        "Municipal small business job creation rebate",
        "Corporate savings promotional incentive",
        "Decommissioned server salvage sale proceeds",
        "Foreign exchange transaction hedging credit",
        "Early payment discount earned from vendor",
        "Settlement escrow release proceeds",
    ]
    amounts = [
        "142.50", "850.00", "62.15", "1250.00", "310.00",
        "95.40", "420.00", "1850.00", "78.20", "560.00",
        "215.00", "940.00", "125.80", "1650.00", "430.00",
        "88.60", "620.00", "2100.00", "175.00", "740.00",
        "315.50", "1120.00", "92.30", "1450.00", "510.00",
        "64.75", "480.00", "1950.00", "138.40", "670.00",
        "285.00", "890.00", "112.50", "1580.00", "390.00",
        "76.20", "540.00", "2250.00", "195.00", "810.00",
        "245.80", "1050.00", "84.90", "1380.00", "470.00",
        "155.00", "720.00", "2850.00", "225.40", "960.00",
    ]
    methods = ["BANK_TRANSFER", "OTHER", "UPI", "BANK_TRANSFER", "OTHER"]
    items = []
    for i in range(50):
        items.append({
            "description": f"[Demo] {base_descriptions[i % len(base_descriptions)]} (Ref #{i + 1})",
            "counterparty": counterparties[i % len(counterparties)],
            "amount": amounts[i],
            "payment_method": methods[i % len(methods)],
            "day_offset": (i * 3 + 1) % 172 + 1,
        })
    return items


def _build_software_templates() -> List[Dict[str, Any]]:
    counterparties = [
        "Amazon Web Services", "Google Cloud Platform", "Microsoft Azure",
        "GitHub Inc", "Slack Technologies", "Atlassian", "Datadog",
        "Stripe Inc", "Figma Inc", "JetBrains", "Sentry.io", "Vercel Inc",
    ]
    base_descriptions = [
        "AWS production computing EC2 & RDS hosting",
        "Google Workspace enterprise business email",
        "GitHub Enterprise developer team seats",
        "Slack Business communications subscription",
        "Datadog production APM monitoring suite",
        "Figma design team enterprise subscription",
        "JetBrains IDE all-products team pack",
        "Postmark transactional email API delivery",
        "Sentry application error monitoring tier",
        "Vercel enterprise edge network hosting",
    ]
    amounts = [
        "45.00", "180.00", "450.00", "1250.00", "89.00",
        "320.00", "750.00", "24.00", "650.00", "1850.00",
        "95.00", "210.00", "520.00", "1100.00", "78.00",
        "380.00", "820.00", "35.00", "590.00", "1420.00",
        "65.00", "195.00", "480.00", "1310.00", "84.00",
        "340.00", "790.00", "29.00", "620.00", "1680.00",
        "110.00", "240.00", "560.00", "1190.00", "92.00",
        "360.00", "870.00", "42.00", "680.00", "1540.00",
        "85.00", "175.00", "430.00", "1280.00", "72.00",
        "310.00", "760.00", "49.00", "640.00", "1790.00",
    ]
    methods = ["CREDIT_CARD", "CREDIT_CARD", "DEBIT_CARD", "BANK_TRANSFER", "CREDIT_CARD"]
    items = []
    for i in range(50):
        items.append({
            "description": f"[Demo] {base_descriptions[i % len(base_descriptions)]} (Cycle #{i + 1})",
            "counterparty": counterparties[i % len(counterparties)],
            "amount": amounts[i],
            "payment_method": methods[i % len(methods)],
            "day_offset": (i * 3 + 5) % 176 + 1,
        })
    return items


def _build_rent_templates() -> List[Dict[str, Any]]:
    counterparties = [
        "Metro Commercial Properties LLC", "WeWork Management LLC", "Regus Executive Suites",
        "Pacific Plaza Realty", "Urban Co-working Hubs", "Edison Power & Utilities",
        "Metropolitan Water Authority", "Comcast Business Fiber",
    ]
    base_descriptions = [
        "Headquarters suite monthly commercial rent",
        "Executive co-working desks monthly lease",
        "Downtown satellite branch office lease",
        "Office electricity and central HVAC utility",
        "Commercial high-speed fiber internet billing",
        "Office janitorial and facilities sanitization",
        "Dedicated corporate parking spaces lease",
        "Building physical access control and security",
        "Quarterly common area maintenance (CAM) fee",
        "Storage facility climate-controlled unit lease",
    ]
    amounts = [
        "3200.00", "1800.00", "450.00", "2200.00", "650.00",
        "350.00", "420.00", "280.00", "750.00", "190.00",
        "3250.00", "1850.00", "475.00", "2250.00", "680.00",
        "360.00", "430.00", "295.00", "780.00", "205.00",
        "3300.00", "1900.00", "460.00", "2300.00", "670.00",
        "375.00", "440.00", "310.00", "810.00", "215.00",
        "3350.00", "1950.00", "490.00", "2350.00", "695.00",
        "390.00", "450.00", "325.00", "840.00", "225.00",
        "3400.00", "2000.00", "510.00", "2400.00", "720.00",
        "410.00", "465.00", "340.00", "870.00", "240.00",
    ]
    methods = ["BANK_TRANSFER", "BANK_TRANSFER", "OTHER", "BANK_TRANSFER", "CREDIT_CARD"]
    items = []
    for i in range(50):
        items.append({
            "description": f"[Demo] {base_descriptions[i % len(base_descriptions)]} - Month {i + 1}",
            "counterparty": counterparties[i % len(counterparties)],
            "amount": amounts[i],
            "payment_method": methods[i % len(methods)],
            "day_offset": (i * 3 + 3) % 170 + 3,
        })
    return items


def _build_marketing_templates() -> List[Dict[str, Any]]:
    counterparties = [
        "Google Ads", "Meta Advertising", "LinkedIn Marketing Solutions",
        "HubSpot Inc", "Mailchimp", "Semrush Inc", "Creative Pulse Agency",
        "Outfront Media", "G2 Crowd Reviews", "TechTarget Media",
    ]
    base_descriptions = [
        "Google Search intent CPC advertising campaign",
        "LinkedIn B2B sponsored content lead generation",
        "HubSpot marketing automation platform tier",
        "Quarterly corporate email newsletter campaign",
        "Search engine optimization (SEO) keyword sprint",
        "Creative brand identity and graphic design fee",
        "Industry trade conference exhibit booth space",
        "Developer community podcast sponsorship fee",
        "Customer review platform verified listing tier",
        "Direct-response digital retargeting campaign",
    ]
    amounts = [
        "650.00", "1200.00", "2400.00", "350.00", "1800.00",
        "420.00", "3100.00", "850.00", "1500.00", "920.00",
        "720.00", "1350.00", "2600.00", "380.00", "1950.00",
        "460.00", "3400.00", "890.00", "1650.00", "980.00",
        "680.00", "1250.00", "2500.00", "360.00", "1850.00",
        "440.00", "3250.00", "870.00", "1580.00", "940.00",
        "750.00", "1400.00", "2750.00", "410.00", "2100.00",
        "490.00", "3600.00", "940.00", "1720.00", "1050.00",
        "790.00", "1480.00", "2900.00", "430.00", "2250.00",
        "520.00", "3800.00", "990.00", "1850.00", "1120.00",
    ]
    methods = ["CREDIT_CARD", "BANK_TRANSFER", "CREDIT_CARD", "BANK_TRANSFER", "CREDIT_CARD"]
    items = []
    for i in range(50):
        items.append({
            "description": f"[Demo] {base_descriptions[i % len(base_descriptions)]} #{i + 1}",
            "counterparty": counterparties[i % len(counterparties)],
            "amount": amounts[i],
            "payment_method": methods[i % len(methods)],
            "day_offset": (i * 3 + 6) % 174 + 1,
        })
    return items


def _build_professional_templates() -> List[Dict[str, Any]]:
    counterparties = [
        "Pinnacle Legal Associates", "Grant & Sterling CPAs", "Apex Cybersecurity Audit",
        "Deloitte Tax Advisory", "Vanguard HR Consulting", "Baker Tilly Accountants",
        "KPMG Forensic Services", "Fenwick Corporate Law",
    ]
    base_descriptions = [
        "Annual financial statement compilation review",
        "Commercial client contract drafting and legal review",
        "Quarterly corporate tax compliance filing",
        "SOC 2 Type II readiness security assessment",
        "Employee equity plan and option grant review",
        "Corporate trademark and IP registration filing",
        "Multi-state sales tax nexus determination audit",
        "HR employment policy and handbook update",
        "Board of directors corporate resolutions filing",
        "External penetration testing and vulnerability report",
    ]
    amounts = [
        "1500.00", "3200.00", "850.00", "4500.00", "2200.00",
        "1800.00", "5200.00", "950.00", "3800.00", "2700.00",
        "1650.00", "3400.00", "890.00", "4800.00", "2350.00",
        "1900.00", "5500.00", "980.00", "4100.00", "2850.00",
        "1550.00", "3300.00", "870.00", "4650.00", "2280.00",
        "1850.00", "5350.00", "960.00", "3950.00", "2750.00",
        "1720.00", "3550.00", "920.00", "5100.00", "2450.00",
        "2050.00", "5800.00", "1020.00", "4300.00", "2950.00",
        "1800.00", "3700.00", "950.00", "5400.00", "2600.00",
        "2150.00", "6100.00", "1080.00", "4500.00", "3150.00",
    ]
    methods = ["BANK_TRANSFER", "BANK_TRANSFER", "OTHER", "BANK_TRANSFER", "OTHER"]
    items = []
    for i in range(50):
        items.append({
            "description": f"[Demo] {base_descriptions[i % len(base_descriptions)]} - Retainer {i + 1}",
            "counterparty": counterparties[i % len(counterparties)],
            "amount": amounts[i],
            "payment_method": methods[i % len(methods)],
            "day_offset": (i * 3 + 2) % 172 + 2,
        })
    return items


def _build_travel_templates() -> List[Dict[str, Any]]:
    counterparties = [
        "Delta Air Lines", "United Airlines", "Marriott International",
        "Hilton Hotels", "Uber Technologies", "Amex Corporate Dining",
        "The Capital Grille", "Lyft Inc", "Amtrak Rail", "National Car Rental",
    ]
    base_descriptions = [
        "Client kickoff discovery flight roundtrip",
        "Executive hotel lodging for client deployment",
        "Annual tech summit flight and hotel package",
        "Client partnership business dinner meeting",
        "Airport transfer and metropolitan rideshare travel",
        "Sales executive prospect presentation lunch",
        "Regional customer workshop train transit",
        "Executive leadership retreat team catering",
        "Client site multi-day rental vehicle",
        "Airport business lounge access and transit meals",
    ]
    amounts = [
        "58.20", "450.00", "820.00", "185.00", "310.00",
        "42.50", "680.00", "125.00", "540.00", "95.00",
        "64.00", "480.00", "870.00", "195.00", "330.00",
        "48.00", "720.00", "135.00", "580.00", "105.00",
        "61.50", "465.00", "840.00", "190.00", "320.00",
        "45.00", "695.00", "130.00", "560.00", "98.00",
        "68.50", "510.00", "920.00", "215.00", "350.00",
        "52.00", "760.00", "145.00", "610.00", "112.00",
        "72.00", "535.00", "960.00", "225.00", "375.00",
        "55.50", "795.00", "155.00", "640.00", "118.00",
    ]
    methods = ["CREDIT_CARD", "CREDIT_CARD", "DEBIT_CARD", "CASH", "CREDIT_CARD"]
    items = []
    for i in range(50):
        items.append({
            "description": f"[Demo] {base_descriptions[i % len(base_descriptions)]} (Trip #{i + 1})",
            "counterparty": counterparties[i % len(counterparties)],
            "amount": amounts[i],
            "payment_method": methods[i % len(methods)],
            "day_offset": (i * 3 + 1) % 173 + 1,
        })
    return items


def _build_admin_templates() -> List[Dict[str, Any]]:
    counterparties = [
        "Staples Office Supplies", "Amazon Business", "First National Merchant Bank",
        "FedEx Express", "Iron Mountain Shredding", "State Department of Taxation",
        "Grainger Industrial", "Uline Shipping Supplies", "Pitney Bowes",
    ]
    base_descriptions = [
        "Office stationery, printer toner, and supplies",
        "Commercial business bank account wire fees",
        "Confidential document shredding and archiving",
        "Priority legal courier and parcel shipping",
        "State annual corporate franchise tax fee",
        "Office breakroom coffee, tea, and pantry supplies",
        "Ergonomic workstation accessories and monitor arms",
        "Merchant payment gateway settlement processing",
        "Postage meter refill and certified mail dispatch",
        "Corporate notary public and signature verification",
    ]
    amounts = [
        "45.00", "120.00", "210.00", "65.50", "380.00",
        "85.00", "240.00", "15.00", "175.00", "35.00",
        "48.50", "130.00", "225.00", "68.00", "410.00",
        "92.00", "260.00", "18.50", "190.00", "38.00",
        "46.50", "125.00", "215.00", "66.00", "395.00",
        "88.00", "250.00", "16.50", "180.00", "36.50",
        "52.00", "140.00", "245.00", "72.00", "430.00",
        "98.00", "280.00", "21.00", "205.00", "42.00",
        "55.00", "148.00", "260.00", "76.50", "450.00",
        "105.00", "295.00", "23.50", "215.00", "45.00",
    ]
    methods = ["CREDIT_CARD", "DEBIT_CARD", "BANK_TRANSFER", "CASH", "CREDIT_CARD"]
    items = []
    for i in range(50):
        items.append({
            "description": f"[Demo] {base_descriptions[i % len(base_descriptions)]} (Receipt #{i + 1})",
            "counterparty": counterparties[i % len(counterparties)],
            "amount": amounts[i],
            "payment_method": methods[i % len(methods)],
            "day_offset": (i * 3 + 4) % 175 + 1,
        })
    return items


# Master map associating each standard category with its 50 items generator
CATEGORY_BUILDERS = {
    "Sales & Services": _build_sales_templates,
    "Consulting & Advisory": _build_consulting_templates,
    "Other Income": _build_other_income_templates,
    "Software & Subscriptions": _build_software_templates,
    "Rent & Office Space": _build_rent_templates,
    "Marketing & Advertising": _build_marketing_templates,
    "Professional Services": _build_professional_templates,
    "Travel & Entertainment": _build_travel_templates,
    "General & Administrative": _build_admin_templates,
}


# ---------------------------------------------------------------------------
# Core Seeding Logic
# ---------------------------------------------------------------------------

def seed_demo_transactions(
    db: Session,
    business_id: uuid.UUID,
    target_per_category: int = 50,
) -> Dict[str, Any]:
    """Seed demo transactions for a business workspace idempotently.

    - Verifies the business exists.
    - Ensures standard categories exist for the workspace.
    - Inspects each supported category.
    - For each category, seeds missing demo transactions up to target_per_category (default 50).
    - Preserves existing user transactions and avoids duplicates.
    """
    business = db.scalar(select(Business).where(Business.id == business_id))
    if not business:
        raise ValueError(f"Business workspace '{business_id}' does not exist.")

    # 1. Ensure 9 standard categories exist
    seed_default_categories(db, business_id)

    # 2. Query all categories in this workspace
    categories = db.scalars(
        select(Category).where(Category.business_id == business_id)
    ).all()
    cat_by_name = {c.name: c for c in categories}

    # 3. Query existing demo reference numbers in this workspace
    existing_ref_nums = set(
        db.scalars(
            select(Transaction.reference_number).where(
                Transaction.business_id == business_id,
                Transaction.deleted_at.is_(None),
                Transaction.reference_number.like("DEMO-%"),
            )
        ).all()
    )

    today = datetime.now(timezone.utc).date()
    now_utc = datetime.now(timezone.utc)

    created_count = 0
    per_category_created: Dict[str, int] = {}
    per_category_total: Dict[str, int] = {}

    for cat_name, builder_fn in CATEGORY_BUILDERS.items():
        cat = cat_by_name.get(cat_name)
        if not cat:
            continue

        cat_code = CATEGORY_CODES[cat_name]
        templates = builder_fn()[:target_per_category]

        new_for_cat = 0
        total_for_cat = 0

        for idx, tpl in enumerate(templates, start=1):
            ref_num = f"DEMO-{cat_code}-{idx:03d}"
            total_for_cat += 1

            if ref_num in existing_ref_nums:
                continue

            # Deterministic, stable UUID for each demo transaction
            tx_id = uuid.uuid5(uuid.NAMESPACE_URL, f"https://bizflow.ai/demo/{business_id}/{cat_code}/{idx:03d}")

            tx_date = today - timedelta(days=tpl["day_offset"])
            if tx_date > today:
                tx_date = today

            tx = Transaction(
                id=tx_id,
                business_id=business_id,
                category_id=cat.id,
                type=cat.type,
                amount=Decimal(tpl["amount"]),
                currency=business.base_currency,
                transaction_date=tx_date,
                description=tpl["description"],
                counterparty=tpl["counterparty"],
                reference_number=ref_num,
                payment_method=tpl["payment_method"],
                created_at=now_utc,
                updated_at=now_utc,
            )
            db.add(tx)
            existing_ref_nums.add(ref_num)
            new_for_cat += 1
            created_count += 1

        per_category_created[cat_name] = new_for_cat
        per_category_total[cat_name] = total_for_cat

    if created_count > 0:
        db.commit()

    return {
        "business_id": str(business_id),
        "business_name": business.name,
        "base_currency": business.base_currency,
        "categories_found": len(CATEGORY_BUILDERS),
        "transactions_created": created_count,
        "total_demo_transactions": len(existing_ref_nums),
        "per_category_created": per_category_created,
        "per_category_total": per_category_total,
    }


def seed_demo_workspace_and_data(
    db: Session,
    email: str = "demo@bizflow.ai",
    business_name: str = "Acme Global Enterprises",
    currency: str = "USD",
    password: str = "DemoPassword123!",
) -> Tuple[User, Business, Dict[str, Any]]:
    """Ensure a demo user, business workspace, and 450 demo transactions exist."""
    # Find or create user
    user = db.scalar(select(User).where(User.email == email))
    if not user:
        user = User(
            id=uuid.uuid4(),
            email=email,
            password_hash=hash_password(password),
            full_name="Demo Workspace Owner",
            is_active=True,
        )
        db.add(user)
        db.flush()

    # Find or create business
    business = db.scalar(
        select(Business)
        .join(BusinessMembership)
        .where(BusinessMembership.user_id == user.id)
    )
    if not business:
        business = Business(
            id=uuid.uuid4(),
            name=business_name,
            base_currency=currency,
        )
        db.add(business)
        db.flush()

        membership = BusinessMembership(
            id=uuid.uuid4(),
            user_id=user.id,
            business_id=business.id,
            role="OWNER",
        )
        db.add(membership)
        db.flush()

    db.commit()

    # Seed demo transactions
    result = seed_demo_transactions(db, business.id, target_per_category=50)
    return user, business, result


# ---------------------------------------------------------------------------
# CLI Command Entrypoint
# ---------------------------------------------------------------------------

def main() -> None:
    """CLI entrypoint for loading demo data into a local development database."""
    parser = argparse.ArgumentParser(
        description="BizFlow AI — Demo Transaction Data Loader & Workspace Seeder"
    )
    parser.add_argument(
        "--email",
        type=str,
        default="demo@bizflow.ai",
        help="Email address of the target or demo user (default: demo@bizflow.ai)",
    )
    parser.add_argument(
        "--business-name",
        type=str,
        default="Acme Global Enterprises",
        help="Name of the business workspace to create or seed (default: Acme Global Enterprises)",
    )
    parser.add_argument(
        "--business-id",
        type=str,
        default=None,
        help="Specific business UUID to seed demo data into (optional)",
    )
    parser.add_argument(
        "--currency",
        type=str,
        default="USD",
        help="Base currency for newly created demo business (default: USD)",
    )
    parser.add_argument(
        "--all-businesses",
        action="store_true",
        help="Seed demo transactions across all existing businesses in the database",
    )
    parser.add_argument(
        "--target-per-category",
        type=int,
        default=50,
        help="Number of demo transactions per category (default: 50)",
    )

    args = parser.parse_args()

    print("=" * 70)
    print("BizFlow AI — Demo Transaction Data Seeder")
    print("=" * 70)

    db: Session = SessionLocal()
    try:
        if args.all_businesses:
            businesses = db.scalars(select(Business)).all()
            if not businesses:
                print("No businesses found. Bootstrapping initial demo business...")
                u, b, res = seed_demo_workspace_and_data(
                    db,
                    email=args.email,
                    business_name=args.business_name,
                    currency=args.currency,
                )
                businesses = [b]

            for b in businesses:
                print(f"\nSeeding workspace: {b.name} ({b.id})...")
                res = seed_demo_transactions(
                    db, b.id, target_per_category=args.target_per_category
                )
                _print_summary(res)
        elif args.business_id:
            biz_id = uuid.UUID(args.business_id)
            print(f"\nSeeding target workspace: {biz_id}...")
            res = seed_demo_transactions(
                db, biz_id, target_per_category=args.target_per_category
            )
            _print_summary(res)
        else:
            # Check if any business exists
            existing_biz = db.scalar(select(Business))
            if existing_biz:
                print(f"\nFound existing workspace '{existing_biz.name}' ({existing_biz.id}).")
                res = seed_demo_transactions(
                    db, existing_biz.id, target_per_category=args.target_per_category
                )
                _print_summary(res)
            else:
                print("\nDatabase is empty. Initializing demo user and business workspace...")
                u, b, res = seed_demo_workspace_and_data(
                    db,
                    email=args.email,
                    business_name=args.business_name,
                    currency=args.currency,
                )
                print(f"Created Demo User:     {u.email}")
                print(f"Demo Password:        DemoPassword123!")
                print(f"Created Workspace:    {b.name} (Currency: {b.base_currency})")
                _print_summary(res)

        print("\nDemo seeding completed successfully. Database is ready for development.")
    finally:
        db.close()


def _print_summary(res: Dict[str, Any]) -> None:
    print(f"  Categories supported:     {res['categories_found']}")
    print(f"  New transactions created: {res['transactions_created']}")
    print(f"  Total demo transactions:  {res['total_demo_transactions']}")
    print("  Category breakdown:")
    for cat, total in res["per_category_total"].items():
        created = res["per_category_created"].get(cat, 0)
        print(f"    - {cat:<26}: {total} total ({created} newly created)")


if __name__ == "__main__":
    main()
