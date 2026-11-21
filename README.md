# BizFlow AI — Intelligent Business Financial Management & Decision Support Platform

BizFlow AI is a production-grade, web-based financial intelligence and decision support platform tailored for small businesses. It unifies transaction ledgers, invoicing, payments, cash flow analytics, forecasting, and anomaly detection.

---

## 1. Project Overview & Architecture

- **Architecture:** Pragmatic Modular Monolith.
- **Backend:** Python 3.13+, FastAPI, SQLAlchemy 2.0 (Synchronous with Psycopg 3), Pydantic v2, Alembic.
- **Frontend:** React 18, Vite, TypeScript (Strict Mode), Tailwind CSS v3, Recharts.
- **Multi-Tenancy:** Strict business workspace scoping enforced via `CurrentBusinessDep` using `X-Business-ID`.
- **Financial Precision:** Strict `Decimal` and `NUMERIC(15, 2)` arithmetic; floating-point types prohibited for currency.
- **Error Standard:** RFC 9457 Problem Details (`application/problem+json`).

---

## 2. Directory Structure

```
bizflow-ai/
├── AGENTS.md                          # Permanent AI coding agent guidelines
├── README.md                          # Project documentation (this file)
├── .env.example                       # Environment variable template
├── .gitignore                         # Git exclusion rules
├── docs/                              # Phase 0 Architecture Specifications
│   ├── PROJECT_CHARTER.md
│   ├── SYSTEM_ARCHITECTURE.md
│   ├── DATABASE_DESIGN.md
│   ├── API_CONTRACT.md
│   ├── TEAM_RESPONSIBILITIES.md
│   ├── DEVELOPMENT_ROADMAP.md
│   └── ARCHITECTURE_DECISIONS.md
├── backend/                           # FastAPI Application & Tests
│   ├── app/
│   │   ├── api/                       # API routes (v1 endpoints)
│   │   ├── core/                      # Settings, database, security
│   │   ├── models/                    # SQLAlchemy 2.0 declarative models
│   │   ├── schemas/                   # Pydantic v2 validation models
│   │   ├── services/                  # Business logic services
│   │   └── main.py                    # Application entrypoint
│   ├── tests/                         # Pytest test suite
│   ├── pyproject.toml                 # Exact pinned dependencies
│   └── requirements.lock              # Pinned lockfile
└── frontend/                          # React + Vite + TypeScript SPA
    ├── src/                           # Components, pages, hooks, types
    ├── package.json                   # Pinned frontend dependencies
    ├── tailwind.config.js             # Tailwind CSS v3 configuration
    └── vite.config.ts                 # Vite bundler configuration
```

---

## 3. Local Development Setup

### 3.1 Prerequisites
- Python 3.12+ (Python 3.13 tested and verified)
- Node.js 18+ & npm (Node v24 tested)
- PostgreSQL 16+ (or local Docker container)

### 3.2 Environment Configuration
```bash
cp .env.example .env
```

### 3.3 Backend Setup & Startup
```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.lock

# Start backend development server:
uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```
Verify the health endpoint:
```bash
curl http://127.0.0.1:8000/health
```

### 3.4 Frontend Setup & Startup
```bash
cd frontend
npm install
npm run dev
```
Open `http://localhost:5173` in your browser.

### 3.5 Running Tests

#### Backend SQLite Suite (Default Fast Path)
Runs all 85 unit and integration tests hermetically in-memory with zero external database dependencies:
```bash
cd backend
source .venv/bin/activate
pytest tests/ -m "not postgres" -v
```

#### Opt-In PostgreSQL Test Suite
Requires a running PostgreSQL 16+ instance. The test suite strictly validates that the database name is `bizflow_test` and automatically runs migrations within the session fixture:
```bash
# 1. Create isolated disposable test database (local dev only):
psql -h 127.0.0.1 -U postgres -c "CREATE USER bizflow_user WITH PASSWORD 'disposable_local_dev_pwd';"
psql -h 127.0.0.1 -U postgres -c "CREATE DATABASE bizflow_test OWNER bizflow_user;"

# 2. Run opt-in suite:
TEST_DATABASE_URL="postgresql+psycopg://bizflow_user:disposable_local_dev_pwd@127.0.0.1:5432/bizflow_test" pytest tests/postgres/ -m postgres -v
```
*(Note: PostgreSQL runtime verification remains UNVERIFIED on local environments without a live PostgreSQL daemon).*

#### Frontend Automated Tests (Vitest + RTL)
Runs 35 unit and integration tests covering the API client, authentication flow, and workspace isolation:
```bash
cd frontend
npm test
```

#### Frontend Production Build
```bash
cd frontend
npm run build
```

---

## 4. Current Milestone Status

- **Phase 0:** Complete (Architecture blueprints, database design, API contract, ADRs approved).
- **Phase 1 (Foundation, Database, Auth & Multi-Tenant Security):** Complete.
  - **Checkpoint 1 (Repository Foundation):** Complete.
  - **Checkpoint 2 (Database Foundation):** Complete (SQLAlchemy 2.x, Alembic, PostgreSQL models).
  - **Checkpoint 3 (Registration & Authentication):** Complete (JWT HS256, bcrypt timing attack defense).
  - **Checkpoint 4 (Multi-Tenant Context & RBAC):** Complete (`X-Business-ID`, `CurrentBusinessDep`, uniform 404, `RequireRoles`).
  - **Checkpoint 5 (Integration, Frontend Shell & Security Review):** Complete (API client, Auth/Workspace shell, 35 Vitest tests, 85 SQLite tests, opt-in PG test architecture).
- **Phase 2 (Customers, Invoices, Payments & Transaction Ledger):** Pending Developer Authorization.
