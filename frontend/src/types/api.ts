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

export interface WorkspaceItem {
  business: Business;
  membership: BusinessMembership;
}

export interface WorkspaceListResponse {
  workspaces: WorkspaceItem[];
  total: number;
}

export interface WorkspaceResponse {
  business: Business;
  membership: BusinessMembership;
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
}
