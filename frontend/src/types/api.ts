/**
 * Core API domain types and HTTP client request contracts.
 */

export type WorkspaceRole = 'OWNER' | 'ADMIN' | 'MEMBER' | 'VIEWER';

export interface User {
  id: string;
  email: string;
  full_name: string;
  is_active: boolean;
  is_superuser: boolean;
  created_at: string;
}

export interface Business {
  id: string;
  name: string;
  currency: string;
  tax_id: string | null;
  created_at: string;
}

export interface BusinessMembership {
  id: string;
  user_id: string;
  business_id: string;
  role: WorkspaceRole;
  created_at: string;
}

export interface WorkspaceSummaryResponse {
  id: string;
  name: string;
  base_currency: string;
  role: WorkspaceRole;
  created_at: string;
}

export type WorkspaceItem = WorkspaceSummaryResponse;
export type WorkspaceResponse = WorkspaceSummaryResponse;

export interface WorkspaceListResponse {
  items: WorkspaceSummaryResponse[];
  total: number;
}

export interface ProblemDetails {
  type: string;
  title: string;
  status: number;
  detail: string;
  instance?: string;
  code?: string;
  invalid_params?: Array<{ name: string; reason: string }>;
}

export type RequestScope = 'public' | 'auth' | 'workspace';

export interface RequestOptions extends Omit<RequestInit, 'headers'> {
  headers?: Record<string, string>;
  scope: RequestScope;
  targetWorkspaceId?: string;
  targetWorkspaceGeneration?: number;
}

// ==========================================
// Category Domain Contracts
// ==========================================

export interface CategoryResponse {
  id: string;
  business_id: string;
  name: string;
  type: 'INCOME' | 'EXPENSE';
  description: string | null;
  color_hex: string;
  is_system_default: boolean;
  created_at: string;
  updated_at: string;
}

export interface CategoryListResponse {
  items: CategoryResponse[];
  total: number;
}

export interface CategoryCreateRequest {
  name: string;
  type: 'INCOME' | 'EXPENSE';
  description?: string | null;
  color_hex?: string;
}

export interface CategoryUpdateRequest {
  name?: string;
  description?: string | null;
  color_hex?: string;
}

// ==========================================
// Transaction Domain Contracts
// ==========================================

export type PaymentMethod =
  | 'CASH'
  | 'BANK_TRANSFER'
  | 'CREDIT_CARD'
  | 'DEBIT_CARD'
  | 'UPI'
  | 'OTHER';

export const SUPPORTED_PAYMENT_METHODS: readonly PaymentMethod[] = [
  'CASH',
  'BANK_TRANSFER',
  'CREDIT_CARD',
  'DEBIT_CARD',
  'UPI',
  'OTHER',
] as const;

export interface TransactionResponse {
  id: string;
  business_id: string;
  category_id: string;
  category_name: string | null;
  category_color: string | null;
  type: 'INCOME' | 'EXPENSE';
  amount: string;
  currency: string;
  transaction_date: string;
  description: string;
  counterparty: string | null;
  reference_number: string | null;
  payment_method: PaymentMethod;
  created_at: string;
  updated_at: string;
}

export interface TransactionListResponse {
  items: TransactionResponse[];
  total: number;
  page: number;
  page_size: number;
  total_pages: number;
}

export interface CategoryBreakdownResponse {
  category_id: string;
  category_name: string;
  category_color: string;
  total_amount: string;
  count: number;
  percentage: string;
}

export interface FinancialSummaryPeriod {
  start_date: string;
  end_date: string;
}

export interface FinancialSummaryResponse {
  period: FinancialSummaryPeriod;
  currency: string;
  total_income: string;
  total_expenses: string;
  net_cash_flow: string;
  transaction_count: number;
  cumulative_net_movement: string;
  income_by_category: CategoryBreakdownResponse[];
  expenses_by_category: CategoryBreakdownResponse[];
}

export interface TransactionFilterParams {
  type?: 'INCOME' | 'EXPENSE';
  category_id?: string;
  start_date?: string;
  end_date?: string;
  search?: string;
  sort_by?: 'transaction_date' | 'amount' | 'created_at';
  sort_order?: 'asc' | 'desc';
  page?: number;
  page_size?: number;
}

export interface TransactionCreateRequest {
  type: 'INCOME' | 'EXPENSE';
  amount: string;
  category_id: string;
  transaction_date: string;
  description: string;
  counterparty?: string | null;
  reference_number?: string | null;
  payment_method?: PaymentMethod;
}

export interface TransactionUpdateRequest {
  amount?: string;
  category_id?: string;
  transaction_date?: string;
  description?: string;
  counterparty?: string | null;
  reference_number?: string | null;
  payment_method?: PaymentMethod;
}
