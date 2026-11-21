"""0002_financial_management_core

Creates categories and transactions tables with composite foreign keys,
constraints, partial indexes, and idempotent seeding for existing workspaces.

Revision ID: 0002_financial_management_core
Revises: 0001_initial_core_schema
Create Date: 2026-11-21 05:55:00 UTC
"""
import uuid
from datetime import datetime, timezone
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa

revision: str = '0002_financial_management_core'
down_revision: Union[str, None] = '0001_initial_core_schema'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

# Canonical default categories (3 income, 6 expense)
DEFAULT_SEED_CATEGORIES = (
    {"name": "Sales & Services", "type": "INCOME", "color_hex": "#10B981", "description": "Core operating revenue"},
    {"name": "Consulting & Advisory", "type": "INCOME", "color_hex": "#059669", "description": "Professional fees"},
    {"name": "Other Income", "type": "INCOME", "color_hex": "#34D399", "description": "Incidental receipts and refunds"},
    {"name": "Software & Subscriptions", "type": "EXPENSE", "color_hex": "#6366F1", "description": "SaaS tools and licenses"},
    {"name": "Rent & Office Space", "type": "EXPENSE", "color_hex": "#8B5CF6", "description": "Office lease and utilities"},
    {"name": "Marketing & Advertising", "type": "EXPENSE", "color_hex": "#EC4899", "description": "Campaigns and advertising"},
    {"name": "Professional Services", "type": "EXPENSE", "color_hex": "#F59E0B", "description": "Legal and accounting"},
    {"name": "Travel & Entertainment", "type": "EXPENSE", "color_hex": "#F97316", "description": "Travel and meals"},
    {"name": "General & Administrative", "type": "EXPENSE", "color_hex": "#64748B", "description": "Office supplies and fees"},
)


def upgrade() -> None:
    # 1. Create categories table
    op.create_table(
        'categories',
        sa.Column('id', sa.UUID(), nullable=False),
        sa.Column('business_id', sa.UUID(), nullable=False),
        sa.Column('name', sa.String(length=100), nullable=False),
        sa.Column('type', sa.String(length=20), nullable=False),
        sa.Column('description', sa.String(length=255), nullable=True),
        sa.Column('color_hex', sa.String(length=7), server_default='#6366F1', nullable=False),
        sa.Column('is_system_default', sa.Boolean(), server_default=sa.text('false'), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(['business_id'], ['businesses.id'], name='fk_categories_business_id', ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id', name=op.f('pk_categories')),
        sa.UniqueConstraint('business_id', 'id', 'type', name='uq_categories_biz_id_type'),
        sa.CheckConstraint("type IN ('INCOME', 'EXPENSE')", name='chk_categories_type'),
        sa.CheckConstraint("length(color_hex) = 7 AND color_hex LIKE '#%'", name='chk_categories_color'),
    )
    op.create_index(
        'uq_categories_biz_type_lower_name',
        'categories',
        ['business_id', 'type', sa.text('lower(name)')],
        unique=True,
    )
    op.create_index('idx_categories_biz_type', 'categories', ['business_id', 'type'], unique=False)

    # 2. Create transactions table
    op.create_table(
        'transactions',
        sa.Column('id', sa.UUID(), nullable=False),
        sa.Column('business_id', sa.UUID(), nullable=False),
        sa.Column('category_id', sa.UUID(), nullable=False),
        sa.Column('type', sa.String(length=20), nullable=False),
        sa.Column('amount', sa.Numeric(precision=15, scale=2), nullable=False),
        sa.Column('currency', sa.String(length=3), nullable=False),
        sa.Column('transaction_date', sa.Date(), nullable=False),
        sa.Column('description', sa.String(length=255), nullable=False),
        sa.Column('counterparty', sa.String(length=255), nullable=True),
        sa.Column('reference_number', sa.String(length=100), nullable=True),
        sa.Column('payment_method', sa.String(length=50), server_default='OTHER', nullable=False),
        sa.Column('deleted_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(['business_id'], ['businesses.id'], name='fk_transactions_business_id', ondelete='CASCADE'),
        sa.ForeignKeyConstraint(
            ['business_id', 'category_id', 'type'],
            ['categories.business_id', 'categories.id', 'categories.type'],
            name='fk_transactions_categories_composite',
            ondelete='NO ACTION',
            deferrable=True,
            initially='DEFERRED',
        ),
        sa.PrimaryKeyConstraint('id', name=op.f('pk_transactions')),
        sa.CheckConstraint("type IN ('INCOME', 'EXPENSE')", name='chk_transactions_type'),
        sa.CheckConstraint('amount > 0', name='chk_transactions_amount_positive'),
        sa.CheckConstraint('length(currency) = 3', name='chk_transactions_currency_length'),
        sa.CheckConstraint(
            "payment_method IN ('CASH', 'BANK_TRANSFER', 'CREDIT_CARD', 'DEBIT_CARD', 'UPI', 'OTHER')",
            name='chk_transactions_payment_method',
        ),
    )
    op.create_index(
        'idx_tx_active_biz_date',
        'transactions',
        ['business_id', 'transaction_date', 'created_at'],
        unique=False,
        postgresql_where=sa.text('deleted_at IS NULL'),
        sqlite_where=sa.text('deleted_at IS NULL'),
    )
    op.create_index(
        'idx_tx_active_biz_category',
        'transactions',
        ['business_id', 'category_id'],
        unique=False,
        postgresql_where=sa.text('deleted_at IS NULL'),
        sqlite_where=sa.text('deleted_at IS NULL'),
    )

    # 3. Idempotent Data Migration: Seed standard default categories for all existing businesses
    bind = op.get_bind()
    dialect_name = bind.dialect.name
    existing_businesses = bind.execute(sa.text("SELECT id FROM businesses")).fetchall()

    for (biz_id,) in existing_businesses:
        for cat in DEFAULT_SEED_CATEGORIES:
            cat_id = str(uuid.uuid4())
            now_iso = datetime.now(timezone.utc).isoformat()
            if dialect_name == "postgresql":
                bind.execute(
                    sa.text("""
                        INSERT INTO categories (id, business_id, name, type, description, color_hex, is_system_default, created_at, updated_at)
                        VALUES (:id, :biz_id, :name, :type, :desc, :color, true, now(), now())
                        ON CONFLICT (business_id, type, lower(name)) DO NOTHING
                    """),
                    {
                        "id": cat_id,
                        "biz_id": biz_id,
                        "name": cat["name"],
                        "type": cat["type"],
                        "desc": cat["description"],
                        "color": cat["color_hex"],
                    },
                )
            elif dialect_name == "sqlite":
                bind.execute(
                    sa.text("""
                        INSERT OR IGNORE INTO categories (id, business_id, name, type, description, color_hex, is_system_default, created_at, updated_at)
                        VALUES (:id, :biz_id, :name, :type, :desc, :color, 1, :now, :now)
                    """),
                    {
                        "id": cat_id,
                        "biz_id": str(biz_id),
                        "name": cat["name"],
                        "type": cat["type"],
                        "desc": cat["description"],
                        "color": cat["color_hex"],
                        "now": now_iso,
                    },
                )


def downgrade() -> None:
    op.drop_index('idx_tx_active_biz_category', table_name='transactions')
    op.drop_index('idx_tx_active_biz_date', table_name='transactions')
    op.drop_table('transactions')
    op.drop_index('idx_categories_biz_type', table_name='categories')
    op.drop_index('uq_categories_biz_type_lower_name', table_name='categories')
    op.drop_table('categories')
