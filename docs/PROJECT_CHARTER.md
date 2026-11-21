# PROJECT CHARTER: BIZFLOW AI

**Document Version:** 1.0.0
**Date:** November 2026
**Status:** Approved Architecture Baseline (Phase 0)
**Classification:** Open-Source Engineering Specification & Academic Capstone

---

## 1. Executive Summary

Small and medium-sized enterprises (SMEs) face immense operational challenges in managing working capital, tracking payables and receivables, detecting expenditure anomalies, and anticipating cash flow shortages. Existing software alternatives are either prohibitively expensive enterprise ERPs or fragmented single-purpose tools lacking intelligent decision support.

**BizFlow AI** is a production-quality, web-based financial intelligence and decision support platform designed specifically for small businesses. It unifies transaction recording, customer invoicing, payment reconciliation, financial statement generation, time-series cash flow forecasting, transaction anomaly detection, and what-if scenario simulations into a single, cohesive, multi-tenant modular monolith.

---

## 2. Project Problem Statement

Small business operators encounter several critical financial management bottlenecks:
1. **Disjointed Financial Workflows:** Invoicing, transaction ledgers, bank exports, and reporting typically live in disparate spreadsheets and software, leading to reconciliation delays and synchronization errors.
2. **Backward-Looking Reporting:** Traditional bookkeeping is retrospective (e.g., standard trailing month P&L statements). Small businesses fail due to future liquidity crunches that retrospective reports fail to forecast.
3. **Undetected Financial Anomalies:** Manual auditing of transactions leaves businesses vulnerable to billing errors, duplicate charges, sudden vendor rate spikes, and fraudulent disbursements.
4. **Lack of Strategic Decision Modeling:** Business owners lack accessible "what-if" simulation tools to evaluate the cash impact of hiring an employee, delaying an invoice, or altering pricing models prior to commitment.

---

## 3. Project Objectives

BizFlow AI is engineered to fulfill three distinct target milestones:

1. **Academic Capstone Evaluation:**
   - Demonstrates rigorous software engineering principles, clean modular architecture, relational database design with ACID compliance, deterministic financial arithmetic, and sound statistical/machine learning methodologies.
   - Comprehensive test suite (unit, integration, and ML validation tests) with reproducible execution.

2. **Open-Source GitHub Publication:**
   - Production-ready codebase featuring standard developer toolchains (Docker Compose, Alembic, Poetry/pyproject.toml, Vite, Tailwind CSS).
   - Clear architectural blueprints, API specifications, and contributor workflows conforming to open-source best practices.

3. **Future SaaS Evolution:**
   - Multi-tenant tenant-isolation architecture by design (`business_id` scoping at every layer).
   - Horizontal scalability path, secure authentication, role-based access control (RBAC), and clean separation of concerns allowing migration to distributed microservices if transaction volume demands.

---

## 4. Scope & Boundaries

### 4.1 In-Scope (Phase 0 through Phase 6)
- Secure user registration, authentication, and session handling using JWT.
- Multi-business workspace management (a user can own or belong to multiple businesses).
- Double-entry aligned transaction recording (income, expense, category allocation).
- Customer master data management and payment term tracking.
- Invoice lifecycle management (draft, sent, partially paid, paid, overdue, canceled).
- Payment recording and automatic invoice reconciliation.
- Standardized CSV transaction ingestion with validation, schema mapping, and error reporting.
- Real-time financial dashboard (KPI cards, revenue/expense trends, net margin).
- Automated Profit & Loss (P&L) and Cash Flow statement generation.
- Time-series cash flow forecasting using statistical baseline and autoregressive models with confidence intervals.
- Unsupervised anomaly detection on transaction streams using Isolation Forest with feature attribution.
- Rule-based, explainable Financial Health Score with weighted sub-indicator breakdowns.
- Interactive What-If scenario simulation engine (e.g., revenue changes, expense increases, payment delay effects).
- Exportable financial reports in structured CSV and professional PDF formats.

### 4.2 Out-of-Scope (Explicitly Deferred)
- Direct bank API integrations (e.g., Plaid, Open Banking, Yodlee) to avoid third-party paid subscriptions, regulatory licensing, and live credential handling.
- Integrated payment gateway processing (e.g., Stripe, PayPal card capture) — payment records are recorded for accounting reconciliation, not direct credit card charging.
- Payroll tax filing and automated governmental tax submissions.
- Multi-currency conversion with live forex feeds (MVP will standardize on a single configurable base currency per business workspace, e.g., USD).
- Mobile native application development (platform will be responsive web-first).

---

## 5. Functional Requirements Catalog

| ID | Requirement Name | Description | Priority |
| :--- | :--- | :--- | :--- |
| **FR-01** | User Auth & Session | Registration, secure login, password hashing (bcrypt), JWT generation with refresh token rotation. | P0 (Must Have) |
| **FR-02** | Workspace Tenancy | Create, switch, and manage business workspaces. Enforce strict isolation per `business_id`. | P0 (Must Have) |
| **FR-03** | Transaction Management | CRUD operations for income and expense transactions with category mapping, payment methods, and timestamps. | P0 (Must Have) |
| **FR-04** | Customer Management | Manage customer records, contact info, billing addresses, and payment terms. | P0 (Must Have) |
| **FR-05** | Invoice Lifecycle | Create multi-line item invoices, calculate subtotal, taxes, discounts, totals with `Decimal` precision; track status transitions. | P0 (Must Have) |
| **FR-06** | Payment Reconciliation | Record full or partial payments against invoices; update invoice balances and status automatically. | P0 (Must Have) |
| **FR-07** | CSV Ingestion Engine | Upload bank/accounting CSV files, map columns, validate rows, reject malformed rows, and import transactions in a transaction. | P1 (Should Have) |
| **FR-08** | Analytics Dashboard | Aggregate metrics: Total Revenue, Total Expenses, Net Profit, Operating Margin, Cash on Hand, Overdue Invoices. | P0 (Must Have) |
| **FR-09** | Financial Statements | Generate standard Profit and Loss (P&L) and Cash Flow summaries across user-defined date ranges. | P0 (Must Have) |
| **FR-10** | Cash Flow Forecasting | Forecast daily/weekly cash flow up to 30/90 days out using baseline and Statsmodels time-series models with MAE/RMSE metrics. | P1 (Should Have) |
| **FR-11** | Anomaly Detection | Flag abnormal transactions using Isolation Forest, displaying risk scores and top contributing feature factors. | P1 (Should Have) |
| **FR-12** | Financial Health Score | Calculate an explainable 0–100 score based on liquidity, profitability, debt/expense ratio, and invoice aging. | P1 (Should Have) |
| **FR-13** | What-If Simulator | Allow users to adjust parameter sliders (revenue change %, expense shock %, invoice lag) to project 3-month cash outcomes. | P2 (Nice to Have) |
| **FR-14** | Report Exporting | Export P&L, transaction logs, and forecast summaries to structured CSV and downloadable ReportLab PDF. | P1 (Should Have) |

---

## 6. Non-Functional Requirements (NFRs)

### 6.1 Accuracy & Precision
- **Monetary Precision:** All currency arithmetic must execute using Python `Decimal` and database `NUMERIC(15, 2)`. Zero floating-point drift permitted.
- **Ledger Invariance:** Every transaction balance update must be mathematically verified before committing.

### 6.2 Security & Data Privacy
- **Tenancy Protection:** All queries scoped by `business_id`. Zero cross-tenant data exposure under any failure mode.
- **Credential Storage:** Industry-standard password hashing via `bcrypt` (work factor $\ge 12$).
- **Session Tokens:** Stateless JWT access tokens signed with HMAC-SHA256 with short TTL (15 minutes); refresh tokens stored securely.
- **Input Sanitization:** Complete validation of all input payloads via Pydantic v2. Defense against CSV injection attacks.

### 6.3 Performance & Responsiveness
- **API Latency:** 95% of standard CRUD read/write API endpoints must respond in $< 150\text{ ms}$.
- **Analytics Aggregations:** Analytical summaries across up to 50,000 transactions must compute in $< 800\text{ ms}$.
- **ML Inference:** On-demand anomaly inference and 30-day forecasting must execute in $< 2.5\text{ s}$.

### 6.4 Maintainability & Extensibility
- **Architecture:** Clean modular monolith with strict separation of API, Services, Repositories, Domain models, and ML routines.
- **Code Standards:** 100% type hints in Python and strict TypeScript configuration. PEP 8 compliance.
- **Test Coverage:** Minimum 85% branch coverage on financial arithmetic and business services.

---

## 7. MVP Definition & Phasing Summary

The project is structured into three clear release tiers:

1. **Core MVP (Phase 1–2):**
   - User Auth, Business Workspaces, Customer CRUD, Transaction Management, Invoice Creation, Payment Reconciliation, CSV Import.
2. **Analytics & Intelligence MVP (Phase 3–4):**
   - Financial Dashboard, P&L generation, Cash Flow Forecasting with confidence bounds, Isolation Forest Anomaly Detection, Financial Health Score, ReportLab PDF generation.
3. **Advanced Integration & Packaging (Phase 5–6):**
   - Interactive Scenario Simulator, full frontend dashboard polish with Recharts, comprehensive E2E test suite, and open-source release preparation.
