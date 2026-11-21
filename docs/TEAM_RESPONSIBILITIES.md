# TEAM RESPONSIBILITIES & ENGINEERING WORKFLOW: BIZFLOW AI

**Document Version:** 1.1.0
**Date:** November 2026
**Status:** Approved Architecture Baseline (Phase 0)
**Development Model:** Solo Primary Developer with Dedicated Academic & QA Support

---

## 1. Team Model & Responsibility Matrix

BizFlow AI is engineered under a **Solo Primary Developer model**. One primary developer holds end-to-end technical ownership over all code, architecture, and deployments, supported by two team members dedicated to documentation, research, manual testing, and project presentation.

```
┌────────────────────────────────────────────────────────────────────────┐
│ PRIMARY DEVELOPER (Technical Owner)                                   │
│ • Full-Stack Software Engineering (Python 3.12, FastAPI, React, TS)    │
│ • Database Architecture, Alembic Migrations & Data Isolation (Postgres)│
│ • Financial Math & Analytics Engine (Pandas, Decimal)                  │
│ • Machine Learning & Forecasting Models (Statsmodels, Scikit-learn)    │
│ • Architecture Decisions, Code Quality & Repository Management         │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │ Collaborative Feedback & QA
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│ SUPPORTING TEAM MEMBERS (Academic, QA & Presentation Contributors)     │
├───────────────────────────────────┬────────────────────────────────────┤
│ Member A: Research & Documentation│ Member B: Manual QA & Presentation │
│ • Business & SME Domain Research  │ • Manual Scenario & Exploratory QA │
│ • Technical Documentation Review  │ • Bug Reporting & UX Feedback      │
│ • User Guide & Walkthrough Manuals│ • Capstone Presentation & Slides   │
│ • Learning System Architecture    │ • Final Demonstration Coordination │
└───────────────────────────────────┴────────────────────────────────────┘
```

---

## 2. Detailed Work Allocation

### 2.1 Primary Developer (Technical Lead & Implementer)
- **Architecture & System Design:** Owns all architectural decisions, database models, API contracts, and technology choices.
- **Backend Implementation:** Implements FastAPI application, core security/JWT, tenant isolation middleware (`CurrentBusinessDep`), and all REST endpoints.
- **Database & Data Layer:** Maintains PostgreSQL declarative models, Alembic migrations, constraints, compound indexes, and ACID transaction blocks.
- **Financial Analytics & ML:** Builds P&L calculations, cash flow metric aggregators, Statsmodels time-series forecasting, IsolationForest anomaly detection, and ReportLab PDF generation.
- **Frontend SPA Integration:** Develops the React 18/19 SPA using Vite, TypeScript, Tailwind CSS, TanStack Query, and Recharts visualization.
- **Automated Testing:** Authors targeted unit and integration tests covering financial arithmetic, multi-tenant data isolation, security, and ML stability.
- **Release Management:** Manages GitHub repository, version tags, and local Docker Compose orchestration.

### 2.2 Supporting Team Member A (Domain Research & Documentation)
- **Domain & Market Research:** Conducts SME accounting workflow research to define standard categories, realistic test scenarios, and typical cash flow patterns.
- **Documentation Maintenance:** Drafts and reviews user-facing documentation, README quickstarts, API guides, and academic project report sections.
- **System Architecture Learning:** Reviews architectural specifications to effectively explain system mechanics during academic evaluation.

### 2.3 Supporting Team Member B (Manual QA, UX & Presentation)
- **Exploratory & Scenario Testing:** Tests user flows manually in the browser (e.g., creating businesses, generating invoices, uploading real-world CSV files, triggering what-if simulations).
- **Issue Tracking & User Feedback:** Logs clear, reproducible bug reports and UX observations for the primary developer.
- **Presentation & Demonstration:** Leads the creation of slide decks, demonstration scripts, and visual aids for academic capstone presentation and open-source showcase.

---

## 3. Solo-Developer Workflow & Collaboration Rules

### 3.1 One Primary Development Track
- **Unified Workflow:** All code changes occur within a single development stream. Do not create independent or parallel development tracks that require complex distributed merges.
- **Feature-by-Feature Progression:** Implement one feature at a time. Validate each feature with automated tests and manual verification before moving to the next.
- **Developer Gatekeeper Rule:** The AI assistant must never begin a subsequent phase or major feature without explicit review and approval from the primary developer.

### 3.2 Git Strategy & Commit Standards
- **Repository Structure:** Single shared Git repository.
- **Branching Model:**
  - `main`: Stable, release-ready branch for capstone submission and open-source publication.
  - `develop`: Primary working integration branch.
  - Short-lived feature branches: `feat/<feature-name>` (e.g., `feat/auth-workspace`, `feat/invoice-payments`, `feat/cash-flow-forecast`).
- **Commit Conventions:** Follow Conventional Commits format:
  ```
  feat(invoices): implement payment recording and balance deduction
  fix(csv): sanitize formula injection characters on export
  test(auth): add multi-tenant isolation verification test
  docs(api): update RFC 9457 problem details examples
  ```

---

## 4. Quality & Review Gates

1. **Incremental Verification:** Run relevant unit/integration tests immediately after implementing each feature milestone.
2. **Manual Acceptance:** Supporting team members perform exploratory testing on `develop` builds to verify edge cases and UI responsiveness.
3. **Documentation Parity:** Whenever an architectural decision or schema is refined during implementation, the primary developer and AI assistant immediately update the corresponding document in `docs/`.
