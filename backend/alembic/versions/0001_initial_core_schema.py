"""0001_initial_core_schema

Initial migration creating users, businesses, and business_memberships tables.

Revision ID: 0001_initial_core_schema
Revises:
Create Date: 2026-11-20 22:15:00 UTC
"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa

revision: str = '0001_initial_core_schema'
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # 1. Create users table
    op.create_table(
        'users',
        sa.Column('id', sa.UUID(), nullable=False),
        sa.Column('email', sa.String(length=255), nullable=False),
        sa.Column('password_hash', sa.String(length=255), nullable=False),
        sa.Column('full_name', sa.String(length=255), nullable=False),
        sa.Column('is_active', sa.Boolean(), server_default=sa.text('true'), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.PrimaryKeyConstraint('id', name=op.f('pk_users')),
        sa.UniqueConstraint('email', name=op.f('uq_users_email')),
    )
    op.create_index(op.f('ix_users_email'), 'users', ['email'], unique=True)

    # 2. Create businesses table
    op.create_table(
        'businesses',
        sa.Column('id', sa.UUID(), nullable=False),
        sa.Column('name', sa.String(length=255), nullable=False),
        sa.Column('base_currency', sa.String(length=3), server_default='INR', nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.PrimaryKeyConstraint('id', name=op.f('pk_businesses')),
    )
    op.create_index(op.f('ix_businesses_name'), 'businesses', ['name'], unique=False)

    # 3. Create business_memberships table
    op.create_table(
        'business_memberships',
        sa.Column('id', sa.UUID(), nullable=False),
        sa.Column('user_id', sa.UUID(), nullable=False),
        sa.Column('business_id', sa.UUID(), nullable=False),
        sa.Column('role', sa.String(length=20), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], name='fk_business_memberships_user_id', ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['business_id'], ['businesses.id'], name='fk_business_memberships_business_id', ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id', name=op.f('pk_business_memberships')),
        sa.UniqueConstraint('user_id', 'business_id', name='uq_user_business_membership'),
        sa.CheckConstraint("role IN ('OWNER', 'ADMIN', 'MEMBER', 'VIEWER')", name='chk_membership_role'),
    )
    op.create_index('idx_membership_user_id', 'business_memberships', ['user_id'], unique=False)
    op.create_index('idx_membership_business_id', 'business_memberships', ['business_id'], unique=False)


def downgrade() -> None:
    op.drop_index('idx_membership_business_id', table_name='business_memberships')
    op.drop_index('idx_membership_user_id', table_name='business_memberships')
    op.drop_table('business_memberships')
    op.drop_index(op.f('ix_businesses_name'), table_name='businesses')
    op.drop_table('businesses')
    op.drop_index(op.f('ix_users_email'), table_name='users')
    op.drop_table('users')
