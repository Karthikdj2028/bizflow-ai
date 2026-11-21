# AGENTS.md — AI Agent Operating Guidelines & Solo-Developer Project Guardrails

## Project: BizFlow AI (Intelligent Business Financial Management and Decision Support Platform)

> **Document Version:** 1.1.0
> **Status:** Active Standard
> **Development Model:** Solo Primary Developer (Supported by 2 Academic/QA Contributors)
> **Target Audience:** All AI Coding Agents, Copilots, and the Primary Developer

---

## 1. Core Mission, Team Model & Engineering Philosophy

BizFlow AI is a production-grade, web-based financial intelligence platform tailored for small businesses. The system manages income and expense transactions, invoicing, payments, cash flow analytics, forecasting, and anomaly detection.

### 1.1 Solo-Developer Delivery Model
- **Single Technical Owner:** All application implementation, architecture decisions, database migrations, backend/frontend code, and GitHub management are owned and executed by **ONE primary developer**.
- **Role of AI Assistant:** The AI acts as a senior technical co-pilot, pair programmer, and code reviewer. The AI proposes structured, clean, well-typed code, explains rationale, writes targeted tests, and strictly implements **one feature at a time**.
- **Supporting Team Members:** Two additional team members participate in academic deliverables, research, documentation, manual testing/QA, and final demonstration. They do not maintain independent code workstreams.
- **Single Linear Workflow:** Do not divide tasks into parallel, decoupled multi-developer tracks. All work merges into a single development workflow on one shared repository.

### 1.2 Engineering Philosophy: Pragmatic Simplicity Over Over-Abstraction
- **Pragmatic Modular Monolith:** Favor straightforward, maintainable Python 3.12 and TypeScript implementations over deeply nested design patterns, extraneous factory classes, or unnecessary abstraction layers.
- **Transaction Ledger Model:** Use a straightforward, clean transaction ledger (categorized income, expense, and transfers with payment/invoice reconciliation) suitable for small business operations, avoiding the complexity of an unneeded multi-leg general double-entry journal for the MVP.
- **Feature-by-Feature Cadence:** Build and verify features incrementally. Run relevant tests after every milestone. **Never proceed to a subsequent phase without explicit approval from the primary developer.**

---

## 2. Fundamental Architectural Guardrails

### 2.1 Multi-Business Data Isolation (Non-Negotiable)
- BizFlow AI is a multi-tenant application where each workspace represents a distinct business entity (`business_id`).
- **Zero Cross-Tenant Leakage:** Every database query involving business-owned records (`transactions`, `invoices`, `customers`, `payments`, `categories`, `forecasts`, `anomalies`, `reports`) **MUST** enforce business-level authorization and filter explicitly by `business_id`.
- Business context and user membership permissions must be resolved and verified at the API boundary via authenticated session context / dependency injection (`CurrentBusinessDep`), never blindly trusted from client request bodies.
- Never write queries without tenant scoping unless operating on system-wide administrative tables (`users`).

### 2.2 Financial Arithmetic & Precision Standards
- **Absolute Float Ban:** Never use floating-point types (`float`, `f32`, `f64`, `numpy.float64`) for currency amounts or monetary balances.
- In Python, use `decimal.Decimal` with explicit rounding modes (`ROUND_HALF_UP` or `ROUND_HALF_EVEN`).
- In PostgreSQL, use `NUMERIC(15, 2)` for currency and `NUMERIC(7, 4)` for tax rates/percentages.
- In TypeScript/Frontend, represent money as fixed-precision strings or formatted values. Never perform raw JavaScript floating-point calculations for transaction totals or invoice balances.
- All monetary operations must satisfy:
  $$\text{Invoice Total} = \sum (\text{Line Item Amount}) + \text{Tax Amount} - \text{Discount Amount}$$
- Invariant: `balance_due = total_amount - paid_amount` (with bounds: $0 \le \text{paid\_amount} \le \text{total\_amount}$).

### 2.3 UTC Timestamps Everywhere
- All timestamps in the database, API contracts, and internal services must be timezone-aware UTC (`TIMESTAMPTZ` / Python `datetime.now(timezone.utc)` / ISO 8601 with `Z`).
- Timezone conversions must occur strictly on the client presentation layer.

### 2.4 Transactional Integrity
- State modifications involving multiple database operations (e.g., recording an invoice payment, updating invoice balance/status, and logging the matching transaction entry) must execute inside an explicit atomic database transaction block (`db.begin()`).
- Implement database-level check constraints (e.g., `amount > 0`, `balance_due >= 0`) to guarantee integrity at the lowest layer.

---

## 3. Technology Stack & Directory Structure

### 3.1 Stack Summary (Local Development & Zero Paid Services)
- **Backend:** Python 3.12+, FastAPI, SQLAlchemy 2.0 (declarative mapping), Alembic, Pydantic v2.
- **Database:** PostgreSQL 16+ (runs locally or via local Docker container; no paid cloud DB dependencies).
- **Frontend:** React 18/19, Vite, TypeScript 5+ (strict mode), Tailwind CSS, Recharts, TanStack Query.
- **Analytics & ML:** Pandas, NumPy, Python standard library `decimal`, Statsmodels, Scikit-learn (IsolationForest).
- **Reporting:** ReportLab (pure Python PDF generation; zero headless browser dependencies).
- **Testing:** Pytest, HTTPX (backend integration), Vitest (frontend).

### 3.2 Target Repository Layout
```
bizflow-ai/
├── AGENTS.md                          # Permanent AI guidelines (this file)
├── README.md                          # Repository overview & quickstart
├── docs/                              # Architecture & specification baseline
│   ├── PROJECT_CHARTER.md
│   ├── SYSTEM_ARCHITECTURE.md
│   ├── DATABASE_DESIGN.md
│   ├── API_CONTRACT.md
│   ├── TEAM_RESPONSIBILITIES.md
│   ├── DEVELOPMENT_ROADMAP.md
│   └── ARCHITECTURE_DECISIONS.md
├── backend/
│   ├── app/
│   │   ├── api/                       # API routers and endpoints
│   │   │   ├── v1/
│   │   │   │   ├── api.py             # Route aggregator
│   │   │   │   ├── endpoints/         # Modular endpoints (auth, invoices, etc.)
│   │   │   │   └── dependencies.py    # FastAPI dependencies (auth, tenancy, db)
│   │   ├── core/                      # Core infrastructure
│   │   │   ├── config.py              # Environment settings (pydantic-settings)
│   │   │   ├── database.py            # Engine, sessionmaker, base model
│   │   │   ├── security.py            # Password hashing, JWT token handling
│   │   │   └── exceptions.py          # Domain exceptions & RFC 9457 handlers
│   │   ├── models/                    # SQLAlchemy 2.0 ORM models
│   │   ├── schemas/                   # Pydantic v2 validation models
│   │   ├── services/                  # Business logic layer
│   │   ├── analytics/                 # Financial metrics, P&L, ratios
│   │   ├── ml/                        # ML forecasting & anomaly detection
│   │   └── reporting/                 # PDF (ReportLab) & CSV generation
│   ├── alembic/                       # Database migration scripts
│   ├── tests/                         # Pytest test suite
│   │   ├── unit/                      # Targeted unit tests (math, auth, services)
│   │   ├── integration/               # API endpoint tests (tenancy, error states)
│   │   └── conftest.py                # Fixtures and test DB setup
│   ├── pyproject.toml                 # Backend dependencies & configuration
│   └── Dockerfile
├── frontend/
│   ├── src/
│   │   ├── components/                # Reusable UI primitives
│   │   ├── features/                  # Domain modules (auth, invoices, etc.)
│   │   ├── hooks/                     # Custom React hooks
│   │   ├── lib/                       # API client, formatters, utilities
│   │   ├── types/                     # TypeScript types mirroring API schemas
│   │   ├── App.tsx                    # Root routing & layout
│   │   └── main.tsx                   # App entrypoint
│   ├── package.json
│   ├── tsconfig.json
│   ├── vite.config.ts
│   └── tailwind.config.js
└── docker-compose.yml                 # Local development orchestration
```

---

## 4. Coding Conventions & Best Practices

### 4.1 Python Standards
1. **Python 3.12+ Modern Features:** Use modern syntax (e.g., `X | Y` union types instead of `Union[X, Y]`, built-in generics `list[str]` instead of `List[str]`).
2. **Type Annotations:** Every function signature, parameter, and return value must have explicit type hints.
3. **Docstrings & Comments:** Document business methods, parameters, return values, mathematical assumptions, and domain constraints.
4. **Error Handling (RFC 9457):** Map custom domain exceptions (`EntityNotFoundError`, `BusinessAccessDeniedError`, `FinancialValidationError`) to RFC 9457 Problem Details responses via centralized FastAPI exception handlers.
5. **No Hardcoded Values:** Place configuration constants and thresholds in `core/config.py`.

### 4.2 TypeScript & React Standards
1. **Strict TypeScript:** No `any` type allowed. Define shared types mirroring backend API schemas.
2. **Component Architecture:** Small, functional components. Keep business logic inside custom hooks; keep UI components primarily presentational.
3. **UI State Integrity:** Every button or interactive control must connect to real state or API mutations. No non-functional buttons or mock placeholders.

### 4.3 Machine Learning & Analytics Standards
1. **No Data Leakage:** In time-series evaluation, strictly use chronological train/test splits. Never shuffle time-series data.
2. **Explainability Over Blackbox:** All anomalies and financial health outputs must include explainable drivers (e.g., "Feature 'amount_zscore' contributed 65% to anomaly score").
3. **No Fake Analytics:** Production analytics code must never emit randomized or hardcoded mock data. If data volume is insufficient ($< 30$ historical days), return explicit warnings (`INSUFFICIENT_DATA_FOR_ML`) with a moving-average baseline.
4. **Safe ML Invocations:** Handle missing values, zero variance, and small sample edge cases without unhandled exceptions.

---

## 5. Security Restrictions & Compliance

1. **Zero Secret Leaks:**
   - Never commit API keys, JWT secrets, database passwords, or private keys to git.
   - Use `.env.example` templates with placeholder values.
2. **Comprehensive CSV Security Strategy:**
   - **On Ingestion:** Validate file size ($\le 10\text{ MB}$), MIME type, row headers, column types, and sanitize imported values.
   - **On Export (Formula Injection Defense):** When generating CSV exports for transactions or reports, sanitize any string field beginning with dangerous formula triggers (`=`, `+`, `-`, `@`, `\t`, `\r`) by prepending a single quote (`'`) to neutralize spreadsheet execution in Excel/Google Sheets.
3. **Authentication & Authorization:**
   - Password hashing must use `bcrypt` with appropriate work factors ($\ge 12$).
   - Access tokens must be signed JWTs with short expiry (15–30 minutes) and refresh token rotation.
   - Enforce business workspace membership and role authorization on every protected endpoint.
4. **Database Safety:**
   - Never use raw SQL string concatenation. Always use SQLAlchemy parameterized queries.
   - Enforce pagination (`limit`, `offset`) on all list queries.

---

## 6. Testing Strategy: Critical-Path Coverage

Instead of arbitrary blanket percentages (such as an uncalibrated 85% requirement), the project enforces **meaningful, high-confidence test coverage on critical paths**:

1. **Financial Arithmetic & Domain Logic:**
   - `Decimal` calculations (invoice totals, subtotals, tax rates, discounts, balance due deductions).
   - Profit & Loss calculations and cash balance aggregations.
   - What-if scenario mathematical projections.
2. **Authentication & Security:**
   - User registration, password hashing verification, and JWT lifecycle.
   - Token expiration and refresh handling.
3. **Multi-Tenant Data Isolation (P0 Security):**
   - Integration tests explicitly verifying that User A authenticated in Business 1 receives `404 Not Found` or `403 Forbidden` when attempting to access records belonging to Business 2.
4. **ML & Analytics Stability:**
   - Anomaly detection behavior on known test datasets.
   - Graceful fallback and error reporting on sparse time-series data ($< 30$ days) or zero variance.
5. **CSV Ingestion & Export Safety:**
   - Validating correct row parsing, error logging on malformed rows, and formula injection prefixing on CSV export.

---

## 7. Development & Agent Collaboration Rules

1. **Role of AI Assistant:**
   - The AI proposes changes, generates clean structured code, writes targeted tests, and explains design decisions.
   - The AI must implement **one feature at a time** and await developer review before moving to the next task.
   - The AI must never proceed to a subsequent roadmap phase without explicit developer approval.
2. **Branching & Commit Standards:**
   - Single developer repository workflow: commit to `develop` or use short-lived feature branches (`feat/<feature-name>`).
   - Follow Conventional Commits: `feat(invoices): add payment balance calculation and status transition`.
3. **Documentation Maintenance:**
   - Keep architectural documentation (`docs/`) synchronized as implementation decisions evolve.

---

## 8. Explicit Prohibitions for AI Agents

- ❌ DO NOT use `float` for currency amounts.
- ❌ DO NOT execute cross-tenant queries without filtering by `business_id`.
- ❌ DO NOT mock or hardcode fake financial metrics in production endpoints.
- ❌ DO NOT leave non-functional buttons or placeholders in the frontend.
- ❌ DO NOT introduce paid cloud infrastructure or paid APIs.
- ❌ DO NOT proceed to the next development phase without explicit developer approval.
- ❌ DO NOT implement multiple unrelated modules simultaneously.
