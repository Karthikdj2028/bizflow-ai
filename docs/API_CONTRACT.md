# REST API CONTRACT SPECIFICATION: BIZFLOW AI

**Document Version:** 1.0.0
**Date:** November 2026
**Status:** Approved Architecture Baseline (Phase 0)
**Base URL:** `/api/v1`
**Protocol:** HTTPS / JSON (RFC 8259)

---

## 1. Global Standards & Conventions

### 1.1 Authentication & Tenancy Headers
Protected endpoints require the following request headers:
- `Authorization: Bearer <jwt_access_token>`
- `X-Business-ID: <business_uuid>` (Mandatory for all tenant-scoped resources)
- `Content-Type: application/json`

### 1.2 Frontend Request Scopes & Option Contract
The frontend client (`frontend/src/lib/api.ts`) organizes requests into mandatory scopes:
- **`public`**: Injects neither `Authorization` nor `X-Business-ID`.
- **`auth`**: Injects `Authorization: Bearer <token>`, omits `X-Business-ID`.
- **`workspace`**: Injects both `Authorization: Bearer <token>` and `X-Business-ID: <business_uuid>`.

All requests enforce `credentials: 'omit'` unconditionally. Application options (`scope`, `targetWorkspaceId`) are destructured before invoking `fetch`.

### 1.3 Exact Error Codes (RFC 9457)
Workspace context and authorization dependencies return these standardized error codes:
- **HTTP 400 `MISSING_BUSINESS_ID_HEADER`**: The `X-Business-ID` header is missing or blank on a workspace-scoped request.
- **HTTP 400 `INVALID_BUSINESS_ID_FORMAT`**: The provided `X-Business-ID` is not a valid UUID.
- **HTTP 404 `BUSINESS_NOT_FOUND`**: Uniform anti-enumeration response when the business does not exist or the authenticated user has no active membership.
- **HTTP 403 `INSUFFICIENT_PERMISSIONS`**: The user has valid membership in the workspace, but their role lacks required permissions.
- **HTTP 401 `INVALID_CREDENTIALS`**: Login failure due to incorrect email or password.
- **HTTP 401 `ACCOUNT_INACTIVE`**: The authenticated user account is deactivated (`is_active=False`).
- **HTTP 409 `CANNOT_REMOVE_LAST_OWNER`**: Safeguard violation attempting to delete or demote the last remaining owner in a workspace.

### 1.2 Standard Response Formats
Successful responses return HTTP 200/201 with the domain payload or list envelope:
```json
{
  "items": [ ... ],
  "total": 128,
  "page": 1,
  "size": 50,
  "pages": 3
}
```

### 1.3 Standard Error Format (RFC 9457 Problem Details)
Errors consistently return structured problem details:
```json
{
  "type": "https://errors.bizflow.ai/validation-error",
  "title": "Unprocessable Entity",
  "status": 422,
  "detail": "Invoice payment amount exceeds remaining balance due.",
  "instance": "/api/v1/payments",
  "code": "PAYMENT_EXCEEDS_BALANCE",
  "errors": [
    {
      "field": "amount",
      "message": "Payment amount 1500.00 exceeds remaining balance 1200.00"
    }
  ]
}
```

---

## 2. Authentication & Workspace Endpoints

### 2.1 User Registration
- **Method / Path:** `POST /api/v1/auth/register`
- **Auth Required:** No
- **Request Body:**
```json
{
  "email": "sarah.connor@example.com",
  "password": "SecurePassword123!",
  "full_name": "Sarah Connor",
  "initial_business_name": "Skyline Logistics"
}
```
- **Response:** `201 Created`
```json
{
  "user": {
    "id": "e3b0c442-98fc-1c14-9afb-4c72e04f9e01",
    "email": "sarah.connor@example.com",
    "full_name": "Sarah Connor",
    "is_active": true
  },
  "business": {
    "id": "7c9e6679-7425-40de-944b-e07fc1f90ae7",
    "name": "Skyline Logistics",
    "role": "OWNER"
  },
  "tokens": {
    "access_token": "eyJhbGciOiJIUzI1NiIs...",
    "refresh_token": "dGhpcy1pcy1hLXJlZnJlc2gtdG9rZW4...",
    "token_type": "bearer",
    "expires_in": 900
  }
}
```

### 2.2 User Login
- **Method / Path:** `POST /api/v1/auth/login`
- **Auth Required:** No
- **Request Body:**
```json
{
  "email": "sarah.connor@example.com",
  "password": "SecurePassword123!"
}
```
- **Response:** `200 OK` (returns tokens and list of accessible businesses).

### 2.3 Current User Profile
- **Method / Path:** `GET /api/v1/auth/me`
- **Auth Required:** Yes (Bearer Token)
- **Response:** `200 OK`
```json
{
  "id": "e3b0c442-98fc-1c14-9afb-4c72e04f9e01",
  "email": "sarah.connor@example.com",
  "full_name": "Sarah Connor",
  "is_active": true,
  "created_at": "2026-11-20T22:15:00Z"
}
```

### 2.4 Workspace Tenancy Endpoints

#### List User Workspaces (Header-Free Discovery)
- **Method / Path:** `GET /api/v1/workspaces`
- **Auth Required:** Yes (Bearer Token)
- **Tenancy Header Required:** No (`X-Business-ID` is NOT required for workspace discovery)
- **Response:** `200 OK`
```json
{
  "items": [
    {
      "id": "7c9e6679-7425-40de-944b-e07fc1f90ae7",
      "name": "Skyline Logistics",
      "base_currency": "INR",
      "role": "OWNER",
      "created_at": "2026-11-20T22:15:00Z"
    }
  ],
  "total": 1
}
```

#### Get Active Workspace Context
- **Method / Path:** `GET /api/v1/workspaces/current`
- **Auth Required:** Yes (Bearer Token)
- **Tenancy Header Required:** Yes (`X-Business-ID: <business_uuid>`)
- **Response:** `200 OK`
```json
{
  "id": "7c9e6679-7425-40de-944b-e07fc1f90ae7",
  "name": "Skyline Logistics",
  "base_currency": "INR",
  "role": "OWNER",
  "created_at": "2026-11-20T22:15:00Z"
}
```

#### Standard Tenancy Problem Responses (RFC 9457)
- **Missing Header (400 Bad Request):**
  `{"type": "https://errors.bizflow.ai/missing-business-id-header", "title": "Bad Request", "status": 400, "detail": "Missing required 'X-Business-ID' header for workspace-scoped resource.", "code": "MISSING_BUSINESS_ID_HEADER"}`
- **Malformed UUID (400 Bad Request):**
  `{"type": "https://errors.bizflow.ai/invalid-business-id-format", "title": "Bad Request", "status": 400, "detail": "The provided 'X-Business-ID' header is not a valid UUID.", "code": "INVALID_BUSINESS_ID_FORMAT"}`
- **Uniform 404 Anti-Enumeration (404 Not Found):**
  `{"type": "https://errors.bizflow.ai/business-not-found", "title": "Not Found", "status": 404, "detail": "Requested business workspace not found.", "code": "BUSINESS_NOT_FOUND"}`
  *(Returned identically when workspace does not exist OR authenticated user is not a member)*
- **Insufficient Role (403 Forbidden):**
  `{"type": "https://errors.bizflow.ai/insufficient-role-permissions", "title": "Forbidden", "status": 403, "detail": "Insufficient role permissions for this operation. Required: OWNER. Your role: 'VIEWER'.", "code": "INSUFFICIENT_ROLE_PERMISSIONS"}`

---

## 3. Customer Management Endpoints

### 3.1 List Customers
- **Method / Path:** `GET /api/v1/customers`
- **Auth & Tenant Required:** Yes (`X-Business-ID`)
- **Query Params:** `search`, `is_active`, `page`, `size`
- **Response:** `200 OK`

### 3.2 Create Customer
- **Method / Path:** `POST /api/v1/customers`
- **Auth & Tenant Required:** Yes
- **Request Body:**
```json
{
  "name": "Apex Manufacturing Corp",
  "email": "accounts@apexcorp.com",
  "phone": "+1-555-0199",
  "billing_address": "100 Industrial Parkway, Chicago, IL 60601",
  "payment_terms_days": 30
}
```
- **Response:** `201 Created`

---

## 4. Invoice Management Endpoints

### 4.1 Create Invoice
- **Method / Path:** `POST /api/v1/invoices`
- **Auth & Tenant Required:** Yes
- **Request Body:**
```json
{
  "customer_id": "8f8b3400-3306-47b2-8438-66236b28b7e2",
  "invoice_number": "INV-2026-0042",
  "issue_date": "2026-11-20",
  "due_date": "2026-12-20",
  "tax_rate": 0.0825,
  "discount_amount": "50.00",
  "notes": "Thank you for your business. Net 30 terms.",
  "items": [
    {
      "description": "Logistics Dispatch Consulting",
      "quantity": "40.00",
      "unit_price": "125.00"
    },
    {
      "description": "Route Optimization Analysis",
      "quantity": "1.00",
      "unit_price": "750.00"
    }
  ]
}
```
- **Response:** `201 Created`
```json
{
  "id": "3a0b5f54-47ef-417c-a4f6-8bbec53f2214",
  "business_id": "7c9e6679-7425-40de-944b-e07fc1f90ae7",
  "customer_id": "8f8b3400-3306-47b2-8438-66236b28b7e2",
  "invoice_number": "INV-2026-0042",
  "status": "DRAFT",
  "issue_date": "2026-11-20",
  "due_date": "2026-12-20",
  "subtotal": "5750.00",
  "tax_rate": "0.0825",
  "tax_amount": "470.25",
  "discount_amount": "50.00",
  "total_amount": "6170.25",
  "paid_amount": "0.00",
  "balance_due": "6170.25",
  "items": [
    {
      "id": "11111111-2222-3333-4444-555555555555",
      "description": "Logistics Dispatch Consulting",
      "quantity": "40.00",
      "unit_price": "125.00",
      "line_total": "5000.00"
    },
    {
      "id": "22222222-3333-4444-5555-666666666666",
      "description": "Route Optimization Analysis",
      "quantity": "1.00",
      "unit_price": "750.00",
      "line_total": "750.00"
    }
  ]
}
```

### 4.2 Transition Invoice Status
- **Method / Path:** `POST /api/v1/invoices/{id}/status`
- **Request Body:** `{"action": "MARK_SENT"}` (Valid actions: `MARK_SENT`, `CANCEL`)
- **Response:** `200 OK`

---

## 5. Payment & Transaction Endpoints

### 5.1 Record Invoice Payment
- **Method / Path:** `POST /api/v1/payments`
- **Auth & Tenant Required:** Yes
- **Request Body:**
```json
{
  "invoice_id": "3a0b5f54-47ef-417c-a4f6-8bbec53f2214",
  "amount": "6170.25",
  "payment_date": "2026-11-21T14:30:00Z",
  "payment_method": "BANK_TRANSFER",
  "reference_number": "ACH-994821",
  "notes": "Full balance cleared"
}
```
- **Response:** `201 Created` (updates invoice balance to 0.00, sets status to `PAID`, creates matching transaction entry).

### 5.2 Create Direct Transaction
- **Method / Path:** `POST /api/v1/transactions`
- **Auth & Tenant Required:** Yes (`OWNER`, `ADMIN`, `MEMBER`)
- **Request Body:**
```json
{
  "type": "EXPENSE",
  "amount": "340.50",
  "category_id": "550e8400-e29b-41d4-a716-446655440000",
  "transaction_date": "2026-11-20",
  "description": "Office Supplies & Printer Ink",
  "counterparty": "Office Depot",
  "reference_number": "REC-9912",
  "payment_method": "CREDIT_CARD"
}
```
- **Rules:** Strings only for `amount` ($\le 9999999999999.99$, max 2 decimals). Date cannot be future. `extra="forbid"`. Inherits `currency` from workspace.
- **Response:** `201 Created`

### 5.3 List Workspace Transactions
- **Method / Path:** `GET /api/v1/transactions`
- **Auth & Tenant Required:** Yes (`OWNER`, `ADMIN`, `MEMBER`, `VIEWER`)
- **Query Params:** `type`, `category_id`, `start_date`, `end_date`, `search`, `sort_by`, `sort_order`, `page`, `page_size`
- **Response:** `200 OK` (`{"items": [...], "total": 42, "page": 1, "page_size": 20, "total_pages": 3}`)

### 5.4 Financial Summary & Calculation Overview
- **Method / Path:** `GET /api/v1/transactions/summary`
- **Auth & Tenant Required:** Yes (`OWNER`, `ADMIN`, `MEMBER`, `VIEWER`)
- **Query Params:** `start_date` (default: 1st of UTC month), `end_date` (default: today UTC), `category_id` (optional)
- **Response:** `200 OK`
```json
{
  "period": { "start_date": "2026-11-01", "end_date": "2026-11-21" },
  "currency": "INR",
  "total_income": "85000.00",
  "total_expenses": "32450.50",
  "net_cash_flow": "52549.50",
  "transaction_count": 28,
  "cumulative_net_movement": "142300.00",
  "income_by_category": [
    {
      "category_id": "uuid-1",
      "category_name": "Sales & Services",
      "category_color": "#10B981",
      "total_amount": "65000.00",
      "count": 12,
      "percentage": "76.47"
    }
  ],
  "expenses_by_category": [
    {
      "category_id": "uuid-2",
      "category_name": "Software & Subscriptions",
      "category_color": "#8B5CF6",
      "total_amount": "12450.50",
      "count": 5,
      "percentage": "38.37"
    }
  ]
}
```

### 5.5 Get Single Transaction
- **Method / Path:** `GET /api/v1/transactions/{id}`
- **Auth & Tenant Required:** Yes (`OWNER`, `ADMIN`, `MEMBER`, `VIEWER`)
- **Response:** `200 OK`

### 5.6 Update Transaction
- **Method / Path:** `PATCH /api/v1/transactions/{id}`
- **Auth & Tenant Required:** Yes (`OWNER`, `ADMIN`, `MEMBER`)
- **Request Body:** Partial fields (`amount`, `category_id`, `transaction_date`, `description`, `counterparty`, `reference_number`, `payment_method`). Empty body `{}` and `type` rejected.
- **Response:** `200 OK`

### 5.7 Soft-Delete Transaction
- **Method / Path:** `DELETE /api/v1/transactions/{id}`
- **Auth & Tenant Required:** Yes (`OWNER`, `ADMIN` only; `MEMBER` returns 403 Forbidden)
- **Response:** `200 OK` (`{"message": "Transaction successfully deleted", "id": "<uuid>"}`)

---

## 6. CSV Transaction Ingestion Endpoints

### 6.1 Upload & Preview CSV
- **Method / Path:** `POST /api/v1/imports/csv/preview`
- **Form Data:** `file: <binary_file.csv>`
- **Response:** `200 OK`
```json
{
  "filename": "bank_statement_oct2026.csv",
  "detected_columns": ["Date", "Description", "Debit", "Credit", "Reference"],
  "sample_rows": [
    ["2026-10-01", "Client Wire Apex", "", "15000.00", "REF123"],
    ["2026-10-02", "Office Lease", "4200.00", "", "LEAS01"]
  ],
  "suggested_mappings": {
    "transaction_date": "Date",
    "description": "Description",
    "debit_amount": "Debit",
    "credit_amount": "Credit",
    "counterparty": "Description"
  }
}
```

### 6.2 Process CSV Ingestion
- **Method / Path:** `POST /api/v1/imports/csv/commit`
- **Request Body:**
```json
{
  "filename": "bank_statement_oct2026.csv",
  "mappings": {
    "transaction_date": "Date",
    "description": "Description",
    "debit_amount": "Debit",
    "credit_amount": "Credit"
  },
  "date_format": "YYYY-MM-DD"
}
```
- **Response:** `200 OK` (`{"total": 150, "imported": 148, "failed": 2, "errors": [...]}`)

---

## 7. Financial Analytics Endpoints

### 7.1 Financial Overview Summary
- **Method / Path:** `GET /api/v1/analytics/summary`
- **Response:** `200 OK`
```json
{
  "period": { "start": "2026-10-01", "end": "2026-10-31" },
  "total_revenue": "84500.00",
  "total_expenses": "51200.00",
  "net_profit": "33300.00",
  "operating_margin_pct": 39.41,
  "cash_on_hand": "112450.75",
  "unpaid_invoices_total": "18400.00",
  "overdue_invoices_total": "4200.00"
}
```

### 7.2 Profit and Loss (P&L) Statement
- **Method / Path:** `GET /api/v1/analytics/profit-and-loss?year=2026&period=MONTHLY`
- **Response:** `200 OK` (Hierarchical breakdown of Revenue, COGS, Gross Profit, Operating Expenses by category, and Net Income).

### 7.3 Explainable Financial Health Score
- **Method / Path:** `GET /api/v1/analytics/health`
- **Response:** `200 OK`
```json
{
  "overall_score": 78,
  "rating": "STRONG",
  "pillars": {
    "liquidity": { "score": 85, "weight": 0.30, "details": "4.2 months cash runway" },
    "profitability": { "score": 76, "weight": 0.25, "details": "32% average net margin" },
    "revenue_stability": { "score": 70, "weight": 0.25, "details": "Moderate monthly variation (CV: 0.18)" },
    "receivable_health": { "score": 80, "weight": 0.20, "details": "Average DSO is 24 days; <5% overdue" }
  },
  "recommendations": [
    "Accelerate collection on 2 invoices aging past 45 days.",
    "Build cash reserves to achieve 6 months operational runway."
  ],
  "disclaimer": "This score is an automated algorithmic heuristic for informational planning only and does not constitute a certified financial statement audit."
}
```

---

## 8. Machine Learning & Forecasting Endpoints

### 8.1 Cash Flow Forecast
- **Method / Path:** `GET /api/v1/ml/forecast?horizon_days=30`
- **Response:** `200 OK`
```json
{
  "model_used": "Holt-Winters Exponential Smoothing",
  "horizon_days": 30,
  "evaluation_metrics": {
    "mae": "412.30",
    "rmse": "589.45"
  },
  "predictions": [
    {
      "date": "2026-11-21",
      "projected_net_cash": "113200.00",
      "lower_bound_80": "111800.00",
      "upper_bound_80": "114600.00",
      "lower_bound_95": "110500.00",
      "upper_bound_95": "115900.00"
    }
  ]
}
```

### 8.2 Anomaly Detection Scan
- **Method / Path:** `GET /api/v1/ml/anomalies`
- **Query Params:** `status=PENDING`
- **Response:** `200 OK`
```json
{
  "items": [
    {
      "id": "a1b2c3d4-e5f6-7890-1234-567890abcdef",
      "transaction_id": "99999999-8888-7777-6666-555555555555",
      "transaction_date": "2026-11-18T22:15:00Z",
      "amount": "4850.00",
      "description": "Emergency Server Maintenance",
      "counterparty": "Unknown Cloud Vendor",
      "anomaly_score": -0.74,
      "severity": "HIGH",
      "explanations": [
        "Amount $4,850.00 is 5.4 standard deviations above typical expense in category 'IT & Software'.",
        "Transaction occurred outside normal business hours (10:15 PM UTC).",
        "First transaction ever recorded with counterparty 'Unknown Cloud Vendor'."
      ],
      "review_status": "PENDING"
    }
  ]
}
```

### 8.3 What-If Scenario Simulator
- **Method / Path:** `POST /api/v1/analytics/scenarios/simulate`
- **Request Body:**
```json
{
  "revenue_delta_percent": -15.0,
  "fixed_expense_delta_amount": "2500.00",
  "receivable_delay_days": 15,
  "projection_months": 3
}
```
- **Response:** `200 OK`
```json
{
  "baseline_ending_cash": "142000.00",
  "scenario_ending_cash": "98500.00",
  "cash_drain_rate_monthly": "14500.00",
  "projected_runway_months": 6.8,
  "warning": "Simulated conditions trigger a cash deficit within 7 months."
}
```

---

## 9. Reporting Endpoints

### 9.1 Download PDF Financial Report
- **Method / Path:** `GET /api/v1/reports/pdf?report_type=PROFIT_AND_LOSS&start_date=2026-01-01&end_date=2026-10-31`
- **Response:** `200 OK` (`Content-Type: application/pdf`, `Content-Disposition: attachment; filename="BizFlow_PL_Report_2026.pdf"`)

### 9.2 Download CSV Export
- **Method / Path:** `GET /api/v1/reports/csv?entity=TRANSACTIONS&start_date=2026-01-01`
- **Response:** `200 OK` (`Content-Type: text/csv`, `Content-Disposition: attachment; filename="transactions_export.csv"`)
