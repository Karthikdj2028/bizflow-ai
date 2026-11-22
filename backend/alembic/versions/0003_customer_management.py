"""0003_customer_management

Creates customers table with business multi-tenancy, non-negative payment terms,
trim check constraints, and tenant-scoped indexes.

Revision ID: 0003_customer_management
Revises: 0002_financial_management_core
Create Date: 2026-11-22 16:10:00 UTC
"""

from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa

revision: str = '0003_customer_management'
down_revision: Union[str, None] = '0002_financial_management_core'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'customers',
        sa.Column('id', sa.UUID(), nullable=False),
        sa.Column('business_id', sa.UUID(), nullable=False),
        sa.Column('name', sa.String(length=255), nullable=False),
        sa.Column('email', sa.String(length=255), nullable=True),
        sa.Column('phone', sa.String(length=50), nullable=True),
        sa.Column('billing_address', sa.Text(), nullable=True),
        sa.Column('payment_terms_days', sa.Integer(), server_default='30', nullable=False),
        sa.Column('is_active', sa.Boolean(), server_default=sa.text('true'), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(['business_id'], ['businesses.id'], name='fk_customers_business_id', ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id', name=op.f('pk_customers')),
        sa.CheckConstraint('payment_terms_days >= 0', name='chk_customers_payment_terms'),
        sa.CheckConstraint('length(trim(name)) > 0', name='chk_customers_name_not_empty'),
    )
    op.create_index('idx_customers_biz_name', 'customers', ['business_id', 'name'], unique=False)
    op.create_index('idx_customers_biz_active', 'customers', ['business_id', 'is_active'], unique=False)
    op.create_index('idx_customers_biz_created', 'customers', ['business_id', 'created_at'], unique=False)


def downgrade() -> None:
    op.drop_index('idx_customers_biz_created', table_name='customers')
    op.drop_index('idx_customers_biz_active', table_name='customers')
    op.drop_index('idx_customers_biz_name', table_name='customers')
    op.drop_table('customers')
