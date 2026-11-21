# ARCHITECTURAL DECISION RECORDS (ADR): BIZFLOW AI

**Document Version:** 1.1.0
**Date:** November 2026
**Status:** Approved Architecture Baseline (Phase 0)
**Development Model:** Solo Primary Developer Focus

---

## Index of Architectural Decisions

- [ADR-001: Pragmatic Solo-Developer Modular Monolith](#adr-001-pragmatic-solo-developer-modular-monolith)
- [ADR-002: Monetary Arithmetic Representation (Decimal and NUMERIC)](#adr-002-monetary-arithmetic-representation-decimal-and-numeric)
- [ADR-003: Multi-Tenancy Strategy (Shared DB/Schema with Discriminator Column)](#adr-003-multi-tenancy-strategy-shared-dbschema-with-discriminator-column)
- [ADR-004: Transaction Ledger Model vs Complex Double-Entry Engine](#adr-004-transaction-ledger-model-vs-complex-double-entry-engine)
- [ADR-005: Time-Series Forecasting Strategy & Model Selection](#adr-005-time-series-forecasting-strategy--model-selection)
- [ADR-006: Anomaly Detection Methodology & Ethical Explainability](#adr-006-anomaly-detection-methodology--ethical-explainability)
- [ADR-007: Comprehensive CSV Security (Import Validation & Export Neutralization)](#adr-007-comprehensive-csv-security-import-validation--export-neutralization)
- [ADR-008: API Error Standard: RFC 9457 Problem Details](#adr-008-api-error-standard-rfc-9457-problem-details)
- [ADR-009: Targeted Critical-Path Testing Strategy vs Blanket Metric Targets](#adr-009-targeted-critical-path-testing-strategy-vs-blanket-metric-targets)
- [ADR-010: Zero-Paid-Service Local Development Infrastructure](#adr-010-zero-paid-service-local-development-infrastructure)

---

### ADR-001: Pragmatic Solo-Developer Modular Monolith

#### Status
Accepted (Refined for Solo Developer)

#### Context
BizFlow AI is engineered by one primary developer. We must balance clean modular architecture with realistic solo-developer maintainability, avoiding microservices overhead and unnecessary design abstraction.

#### Decision
We adopt a **Pragmatic Modular Monolith** in Python 3.12 (FastAPI) and React (Vite/TypeScript). All modules reside in a single codebase with clear directory boundaries (`api`, `services`, `models`, `analytics`, `ml`).

#### Rationale & Trade-offs
- Eliminates distributed network latency, container orchestration sprawl, and distributed transactions.
- Allows the primary developer to implement, refactor, and test features end-to-end quickly without cross-service coordination.
- Keeps code modular through standard Python package organization rather than premature microservice extraction.

---

### ADR-002: Monetary Arithmetic Representation (Decimal and NUMERIC)

#### Status
Accepted

#### Context
Financial calculations cannot tolerate floating-point rounding errors (e.g., `0.1 + 0.2 = 0.30000000000000004`).

#### Decision
We mandate **fixed-precision arbitrary decimal representation** everywhere:
- Python: `decimal.Decimal` with explicit rounding modes (`ROUND_HALF_UP`).
- PostgreSQL: `NUMERIC(15, 2)` for currency and `NUMERIC(7, 4)` for tax/discount rates.
- Frontend: Represented as formatted strings or integer cents; zero raw float operations for monetary math.

#### Rationale & Trade-offs
Guarantees zero floating-point drift across invoice item totals, tax calculations, discounts, payment deductions, and P&L sums.

---

### ADR-003: Multi-Tenancy Strategy (Shared DB/Schema with Discriminator Column)

#### Status
Accepted

#### Context
Small businesses require absolute confidentiality for their transaction records.

#### Decision
We choose **Shared Database, Shared Schema with Discriminator Column (`business_id`)**, enforced via:
1. `CurrentBusinessDep` FastAPI dependency verifying user membership and role.
2. Mandatory `business_id` filtering on every business-owned database query.
3. Database compound indexes (e.g., `(business_id, transaction_date)`).

#### Rationale & Trade-offs
Avoids the operational overhead of running hundreds of schema migrations or separate database instances while providing rock-solid isolation when enforced at the application boundary and repository layer.

---

### ADR-004: Transaction Ledger Model vs Complex Double-Entry Engine

#### Status
Accepted (Corrected in Phase 0 Revision)

#### Context
While enterprise ERPs use multi-leg general double-entry accounting (Debits/Credits across chart of accounts with complex journal vouchers), small business owners primarily need clear, categorized income and expense tracking, customer invoicing, and payment reconciliation. Attempting to build an unneeded full double-entry general ledger introduces severe complexity for a solo developer without adding practical value to the core MVP.

#### Decision
For the MVP, BizFlow AI implements a **straightforward, categorized transaction ledger**:
- Transactions are classified as `INCOME`, `EXPENSE`, or `TRANSFER`.
- Transactions link to chart-of-accounts categories and optional payment/invoice records.
- Payment recording reconciles invoice balances and automatically creates corresponding transaction entries inside an atomic database transaction.

#### Rationale & Trade-offs
- Radically simplifies data modeling and user experience while fully satisfying small business cash flow analytics, P&L reporting, and forecasting.
- Leaves a clean upgrade path to a complete double-entry model if future enterprise accounting requires it.

---

### ADR-005: Time-Series Forecasting Strategy & Model Selection

#### Status
Accepted

#### Context
Small businesses need reliable 30-to-90-day cash flow projections but often possess limited historical data (e.g., 3 to 6 months).

#### Decision
We implement a **Statistical Time-Series Pipeline** using **Statsmodels**:
1. Naive / Moving Average Baseline.
2. Holt-Winters Exponential Smoothing & ARIMA/SARIMAX.
3. Chronological train/test split evaluation reporting **MAE** and **RMSE**.
4. 80% and 95% confidence intervals.
5. Structured fallback warnings (`INSUFFICIENT_DATA_FOR_ML`) if history $< 30$ days.

#### Rationale & Trade-offs
Statistical models converge reliably on small sample sizes where deep learning models overfit. They run quickly on local CPU hardware with zero external GPU dependencies.

---

### ADR-006: Anomaly Detection Methodology & Ethical Explainability

#### Status
Accepted

#### Context
Small businesses need to detect unusual transactions (spikes, unexpected vendors, unusual hours) without labeled fraud data.

#### Decision
We choose **Scikit-learn IsolationForest** with **domain feature engineering** (amount $z$-score within category, hour of day, day of week, counterparty novelty) and **structured JSON explainability**.

#### Rationale & Trade-offs
- Unsupervised; requires no labeled training data.
- Ethical standard: Results are classified as "Unusual Activity" requiring review, never accusatory "Fraud".

---

### ADR-007: Comprehensive CSV Security (Import Validation & Export Neutralization)

#### Status
Accepted (Expanded in Phase 0 Revision)

#### Context
CSV files are widely used for importing bank statements and exporting reports. CSV files present two distinct security risks:
1. Malformed or malicious rows during import.
2. **Formula Injection (CSV Injection):** When exported CSV files are opened in Microsoft Excel or Google Sheets, cells beginning with `=`, `+`, `-`, `@`, `\t`, or `\r` can execute arbitrary formulas or commands on the user's workstation.

#### Decision
We enforce a dual-layer CSV security strategy:
1. **On Ingestion:** Enforce file size limit ($\le 10\text{ MB}$), MIME type validation, column type verification, row sanitization, and structured row error reporting.
2. **On Export:** Automatically sanitize all exported text cells. If a value begins with `=`, `+`, `-`, `@`, `\t`, or `\r`, prepend a single quote (`'`) to force the spreadsheet viewer to interpret the value strictly as text.

#### Rationale & Trade-offs
Protects users from both malicious file uploads and client-side spreadsheet execution vulnerabilities without compromising data legibility.

---

### ADR-008: API Error Standard: RFC 9457 Problem Details

#### Status
Accepted (Updated to current standard RFC 9457)

#### Context
The API must return consistent, machine-readable error responses. RFC 7807 has been formally obsoleted by **RFC 9457 (Problem Details for HTTP APIs)**.

#### Decision
We adopt **RFC 9457** as the global API error standard:
- Content-Type: `application/problem+json`
- Fields: `type`, `title`, `status`, `detail`, `instance`, plus custom domain extensions (`code`, `errors`).

#### Rationale & Trade-offs
Conforms to current IETF standards and allows the React frontend to uniformly render form validation errors and server failure alerts.

---

### ADR-009: Targeted Critical-Path Testing Strategy vs Blanket Metric Targets

#### Status
Accepted (Refined for Solo Developer)

#### Context
Blanket code coverage percentages (e.g., arbitrary 85% requirements) often incentivize shallow tests of boilerplate code while missing complex edge cases.

#### Decision
We replace arbitrary blanket metrics with **targeted, high-confidence testing of critical business paths**:
1. Financial math determinism (`Decimal` calculations, P&L logic, invoice balances).
2. Authentication, password hashing, and JWT lifecycle.
3. Multi-tenant data isolation (asserting cross-tenant access is rejected).
4. Machine learning stability on edge cases (sparse data, zero variance).
5. CSV formula injection defense on export and validation on import.

#### Rationale & Trade-offs
Maximizes engineering safety and defect detection for a solo developer without wasting time writing fragile tests for trivial getters or framework boilerplate.

---

### ADR-010: Zero-Paid-Service Local Development Infrastructure

#### Status
Accepted

#### Context
The project must run seamlessly for academic evaluation, open-source contributors, and the solo developer without incurring paid cloud subscriptions.

#### Decision
- Database: Local PostgreSQL (or Dockerized PostgreSQL).
- PDF Generation: Pure-Python **ReportLab** (no cloud services or heavy headless browser containers).
- Machine Learning & Analytics: Local Scikit-learn, Statsmodels, Pandas (CPU-based, $< 2\text{ s}$ execution).
- Orchestration: Local `docker-compose.yml` spinning up PostgreSQL, FastAPI, and Vite frontend.

#### Rationale & Trade-offs
Ensures 100% reproducible local execution for academic grading and open-source adoption at zero hosting cost.

---

### ADR-011: Multi-Tenant Workspace Context, Anti-Enumeration & Role-Based Authorization

#### Status
Accepted (Phase 1, Checkpoint 4 Baseline)

#### Context
A multi-tenant SaaS application managing sensitive business financials must ensure absolute data isolation between workspaces. Key architectural challenges include:
1. Preventing cross-tenant IDOR attacks.
2. Preventing malicious actors from probing whether a given business UUID exists (workspace existence enumeration).
3. Enforcing least-privilege role boundaries across team members (OWNER, ADMIN, MEMBER, VIEWER).
4. Preventing orphaned workspaces where all owners are removed.

#### Decision
1. **Header-Based Workspace Context:** All tenant-scoped endpoints require `X-Business-ID: <UUID>`. `CurrentBusinessDep` resolves and verifies user membership in a single joined database query.
2. **Uniform 404 Anti-Enumeration:** Requests for nonexistent workspaces and workspaces where the authenticated user lacks membership return an identical `HTTP 404 Not Found` (`BUSINESS_NOT_FOUND`). `HTTP 403 Forbidden` (`INSUFFICIENT_ROLE_PERMISSIONS`) is reserved strictly for authenticated members lacking role permissions.
3. **Canonical Role Whitelist & Fail-Closed Guards:** `SUPPORTED_ROLES = frozenset({"OWNER", "ADMIN", "MEMBER", "VIEWER"})` is defined canonically in `models/membership.py`. The dependency factory `RequireRoles()` fails fast at construction time if given empty or invalid roles.
4. **Last-Owner Safeguard Invariant:** A reusable domain helper `assert_not_last_owner(db, business_id, user_id)` guarantees that the sole remaining `OWNER` of a workspace cannot be removed or demoted. Future Phase 2 mutations must invoke this helper inside an atomic transaction with pessimistic locking (`SELECT ... FOR UPDATE`).
5. **Payload Override Immunity:** Creation schemas for tenant entities never accept a client-supplied `business_id`; tenant identity is derived strictly from `WorkspaceContext.business_id`.

#### Rationale & Trade-offs
Guarantees tenant isolation, minimizes database roundtrips to one joined query per request, prevents workspace existence enumeration, and enforces strict RBAC without premature microservices complexity.
