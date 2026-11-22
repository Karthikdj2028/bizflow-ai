"""0004_invoice_management

Creates invoices and invoice_items tables with multi-line items,
composite tenant foreign key referencing customers(business_id, id),
status-specific financial invariants, and non-empty string checks.

Revision ID: 0004_invoice_management
Revises: 0003_customer_management
Create Date: 2026-11-22 19:15:00 UTC
"""

from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa

revision: str = '0004_invoice_management'
down_revision: Union[str, None] = '0003_customer_management'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # 1. Add composite unique constraint to customers for composite FK referencing
    with op.batch_alter_table('customers') as batch_op:
        batch_op.create_unique_constraint('uq_customers_biz_id', ['business_id', 'id'])

    # 2. Create invoices table
    op.create_table(
        'invoices',
        sa.Column('id', sa.UUID(), nullable=False),
        sa.Column('business_id', sa.UUID(), nullable=False),
        sa.Column('customer_id', sa.UUID(), nullable=False),
        sa.Column('invoice_number', sa.String(length=64), nullable=False),
        sa.Column('status', sa.String(length=32), server_default='DRAFT', nullable=False),
        sa.Column('issue_date', sa.Date(), nullable=False),
        sa.Column('due_date', sa.Date(), nullable=False),
        sa.Column('subtotal', sa.Numeric(precision=15, scale=2), server_default='0.00', nullable=False),
        sa.Column('tax_rate', sa.Numeric(precision=7, scale=4), server_default='0.0000', nullable=False),
        sa.Column('tax_amount', sa.Numeric(precision=15, scale=2), server_default='0.00', nullable=False),
        sa.Column('discount_amount', sa.Numeric(precision=15, scale=2), server_default='0.00', nullable=False),
        sa.Column('total_amount', sa.Numeric(precision=15, scale=2), server_default='0.00', nullable=False),
        sa.Column('paid_amount', sa.Numeric(precision=15, scale=2), server_default='0.00', nullable=False),
        sa.Column('balance_due', sa.Numeric(precision=15, scale=2), server_default='0.00', nullable=False),
        sa.Column('notes', sa.Text(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),

        sa.PrimaryKeyConstraint('id', name=op.f('pk_invoices')),
        sa.ForeignKeyConstraint(['business_id'], ['businesses.id'], name='fk_invoices_business_id', ondelete='CASCADE'),
        sa.ForeignKeyConstraint(
            ['business_id', 'customer_id'],
            ['customers.business_id', 'customers.id'],
            name='fk_invoices_business_customer',
            ondelete='RESTRICT',
        ),
        sa.UniqueConstraint('business_id', 'invoice_number', name='uq_invoices_business_invoice_number'),
        sa.CheckConstraint('length(trim(invoice_number)) > 0', name='ck_invoices_number_not_empty'),
        sa.CheckConstraint("status IN ('DRAFT', 'SENT', 'PARTIALLY_PAID', 'PAID', 'CANCELED')", name='ck_invoices_status'),
        sa.CheckConstraint('due_date >= issue_date', name='ck_invoices_due_date_after_issue'),
        sa.CheckConstraint('subtotal >= 0', name='ck_invoices_subtotal_non_negative'),
        sa.CheckConstraint('tax_rate >= 0.0000 AND tax_rate <= 1.0000', name='ck_invoices_tax_rate_bounds'),
        sa.CheckConstraint('tax_amount >= 0', name='ck_invoices_tax_amount_non_negative'),
        sa.CheckConstraint('discount_amount >= 0', name='ck_invoices_discount_non_negative'),
        sa.CheckConstraint('discount_amount <= subtotal + tax_amount', name='ck_invoices_discount_limit'),
        sa.CheckConstraint('total_amount = subtotal + tax_amount - discount_amount', name='ck_invoices_total_equality'),
        sa.CheckConstraint('paid_amount >= 0', name='ck_invoices_paid_amount_non_negative'),
        sa.CheckConstraint('paid_amount <= total_amount', name='ck_invoices_paid_amount_bounds'),
        sa.CheckConstraint('balance_due = total_amount - paid_amount', name='ck_invoices_balance_due_equality'),
        sa.CheckConstraint(
            "(status = 'DRAFT' AND paid_amount = 0 AND balance_due = total_amount) OR "
            "(status = 'SENT' AND total_amount > 0 AND paid_amount = 0 AND balance_due = total_amount) OR "
            "(status = 'PARTIALLY_PAID' AND total_amount > 0 AND paid_amount > 0 AND paid_amount < total_amount AND balance_due = total_amount - paid_amount) OR "
            "(status = 'PAID' AND total_amount > 0 AND paid_amount = total_amount AND balance_due = 0) OR "
            "(status = 'CANCELED' AND balance_due = total_amount - paid_amount)",
            name='ck_invoices_status_financial_invariants',
        ),
    )
    op.create_index('ix_invoices_business_status', 'invoices', ['business_id', 'status'], unique=False)
    op.create_index('ix_invoices_business_created', 'invoices', ['business_id', 'created_at', 'id'], unique=False)

    # 3. Create invoice_items table
    op.create_table(
        'invoice_items',
        sa.Column('id', sa.UUID(), nullable=False),
        sa.Column('invoice_id', sa.UUID(), nullable=False),
        sa.Column('description', sa.String(length=255), nullable=False),
        sa.Column('quantity', sa.Numeric(precision=10, scale=2), nullable=False),
        sa.Column('unit_price', sa.Numeric(precision=15, scale=2), nullable=False),
        sa.Column('line_total', sa.Numeric(precision=15, scale=2), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),

        sa.PrimaryKeyConstraint('id', name=op.f('pk_invoice_items')),
        sa.ForeignKeyConstraint(['invoice_id'], ['invoices.id'], name='fk_invoice_items_invoice_id', ondelete='CASCADE'),
        sa.CheckConstraint('length(trim(description)) > 0', name='ck_invoice_items_description_not_empty'),
        sa.CheckConstraint('quantity > 0', name='ck_invoice_items_quantity_positive'),
        sa.CheckConstraint('unit_price >= 0', name='ck_invoice_items_unit_price_non_negative'),
        sa.CheckConstraint('line_total >= 0', name='ck_invoice_items_line_total_non_negative'),
    )
    op.create_index('ix_invoice_items_invoice_id', 'invoice_items', ['invoice_id'], unique=False)


def downgrade() -> None:
    op.drop_index('ix_invoice_items_invoice_id', table_name='invoice_items')
    op.drop_table('invoice_items')
    op.drop_index('ix_invoices_business_created', table_name='invoices')
    op.drop_index('ix_invoices_business_status', table_name='invoices')
    op.drop_table('invoices')
    with op.batch_alter_table('customers') as batch_op:
        batch_op.drop_constraint('uq_customers_biz_id', type_='unique')
