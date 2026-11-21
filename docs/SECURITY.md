# SECURITY SPECIFICATION & GUARDRAILS: BIZFLOW AI

**Document Version:** 1.0.0  
**Date:** November 2026  
**Status:** Active Standard (Phase 1, Checkpoint 4 Baseline)  
**Target Environment:** Local Python 3.12+ / PostgreSQL 16+  

---

## 1. Authentication & Cryptographic Standards

### 1.1 Password Hashing & UTF-8 Boundaries
- **Algorithm:** Direct bcrypt with cost factor 12 (`rounds=12`).
- **72-Byte Boundary:** Bcrypt strictly enforces a 72-byte input ceiling. Passwords exceeding 72 UTF-8 encoded bytes (`len(password.encode("utf-8")) > 72`) are rejected at the Pydantic schema validation boundary (`422 Unprocessable Entity`) and asserted in the hashing service.
- **Login Timing Mitigation:** When an authentication request specifies a nonexistent email, the backend executes `bcrypt.checkpw` against a precomputed cost-12 dummy hash (`DUMMY_BCRYPT_HASH`) before returning generic `401 Unauthorized`. This mitigates gross account enumeration based on computational latency disparities.
- **Credential Privacy:** Stored password hashes are never serialized into API responses or written to system logs.

### 1.2 JWT Token Architecture
- **Algorithm:** Exclusively HMAC-SHA256 (`HS256`). Algorithm switching and `alg=none` tokens are strictly rejected.
- **Token Claims:** Access tokens require timezone-aware UTC timestamps for expiration (`exp`), issuance (`iat`), subject UUID (`sub`), and explicit issuer validation (`iss == "BizFlow AI"`).
- **Production Secret Validation:** When `APP_ENV="production"`, `Settings` rejects default development secrets, enforces minimum secret length $\ge 32$ bytes ($256$ bits), enforces weak-key heuristics ($\ge 16$ distinct characters), and requires cryptographically secure CSPRNG generation (`secrets.token_urlsafe(32)` or `secrets.token_hex(32)`).

---

## 2. Multi-Tenant Data Isolation & Workspace Privacy

### 2.1 Shared Database, Shared Schema with Discriminator
BizFlow AI isolates tenants within a shared PostgreSQL database using the `business_id` discriminator column:
1. Every business-owned record (`invoices`, `customers`, `transactions`, `categories`, `forecasts`) includes a foreign key `business_id REFERENCES businesses(id) ON DELETE CASCADE`.
2. Every database query accessing business records enforces `WHERE business_id = :active_business_id`.
3. Compound indexes starting with `business_id` (e.g. `(business_id, created_at)`) enforce query isolation at the database index layer.

### 2.2 Workspace Context Resolution (`CurrentBusinessDep`)
Tenancy is established per request via the `X-Business-ID` header:
1. The client supplies `X-Business-ID: <UUID>`.
2. `get_current_workspace` validates that the header exists and is a valid UUID (returning `400 Bad Request` with RFC 9457 Problem Details if missing or malformed).
3. The server executes a single joined query:
   ```sql
   SELECT b.*, m.*
   FROM businesses b
   LEFT JOIN business_memberships m
     ON b.id = m.business_id AND m.user_id = :current_user_id
   WHERE b.id = :header_business_uuid;
   ```
4. Returns an immutable `WorkspaceContext` containing the verified `Business`, `BusinessMembership`, `User`, and `role`.

### 2.3 Uniform 404 Anti-Enumeration Design
- **Security Boundary:** Distinguishing between a non-existent workspace (404) and an unauthorized workspace (403) allows malicious actors to probe and enumerate valid workspace UUIDs.
- **Implementation:** If the business does not exist (`b IS NULL`) OR the authenticated user has no active membership in that business (`m IS NULL`), the API returns an identical **`HTTP 404 Not Found`** (`BUSINESS_NOT_FOUND`, detail: `"Requested business workspace not found."`).
- **Nuanced Privacy Boundary:** While this design significantly mitigates gross ID enumeration, microsecond-level query variance between indexed misses and joined nulls could theoretically be measured; it represents a pragmatic defense-in-depth barrier.

### 2.4 Request Payload Tenant Override Immunity
- Client-supplied request bodies for tenant-owned entities (such as invoices or customers) must **never** include a client-controlled `business_id`.
- The server derives tenant identity exclusively from `WorkspaceContext.business_id`. Any rogue `business_id` injected into a JSON body is ignored by the service.

---

## 3. Role-Based Access Control (RBAC) & Permission Boundaries

### 3.1 Supported Membership Roles
The canonical role whitelist is defined centrally in `app.models.membership`:
`SUPPORTED_ROLES = frozenset({"OWNER", "ADMIN", "MEMBER", "VIEWER"})`

### 3.2 Role-Permission Matrix
- **OWNER:** Full organizational control. Manages workspace profile, billing, member deletion, role modification, workspace deletion, and transaction soft-deletion.
- **ADMIN:** Operational management. Invites/removes members (cannot demote/remove OWNER or modify OWNER roles), creates and updates invoices, payments, customers, and categories; soft-deletes transactions.
- **MEMBER:** Standard operational execution. Creates/updates invoices, customers, payments, and transactions; imports CSVs; runs analytics and queries transaction ledgers. Cannot delete transactions (HTTP 403 Forbidden), manage categories, manage members, or modify workspace settings.
- **VIEWER:** Minimum read-only permission level. Can view dashboards, financial reports, transaction ledgers, invoices, and customers. Zero write or mutation capabilities.

### 3.3 Transaction Ledger Security Safeguards
- **Least-Privilege Deletion:** Soft-deletion of transaction records alters cumulative net cash flow and P&L history. To preserve ledger audit integrity, `DELETE /api/v1/transactions/{id}` is restricted to `OWNER` and `ADMIN` roles. Attempts by `MEMBER` return `HTTP 403 Forbidden` (`code="INSUFFICIENT_ROLE_PERMISSIONS"`).
- **Non-Destructive Soft-Delete:** Physical SQL deletions are prohibited; transactions are marked with `deleted_at = now()`. All operational queries and financial calculations filter `deleted_at IS NULL`.
- **Payload Tampering Immunity (`extra="forbid"`):** Request models reject client-supplied `business_id` and `currency`. Currency is inherited from `workspace.base_currency`. Transaction `type` is immutable upon creation.
- **Composite Foreign Key Defense-in-Depth:** In addition to service-level workspace verification, the database composite foreign key `(business_id, category_id, type)` ensures cross-tenant category assignments and type mismatches are rejected at the database engine level.

### 3.3 Fail-Closed Role Guards (`RequireRoles`)
- `RequireRoles(*allowed_roles)` validates allowed roles at construction time against `SUPPORTED_ROLES`. Empty role sets or unrecognized role strings raise a `ValueError` immediately at startup (failing closed).
- Role matching is exact and case-sensitive.
- Insufficient permissions return **`HTTP 403 Forbidden`** (`code="INSUFFICIENT_ROLE_PERMISSIONS"`).

---

## 4. Workspace Lifecycle & Last-Owner Invariant

### 4.1 Last-Owner Protection Safeguard
- An active business workspace must never become orphaned. Every workspace must maintain at least one user with the `OWNER` role.
- **Safeguard Helper:** `assert_not_last_owner(db, business_id, user_id)` verifies that removing or demoting the target user leaves at least one other `OWNER` in the workspace. If violated, raises `ConflictError` (HTTP 409 `CANNOT_REMOVE_LAST_OWNER`).

### 4.2 Concurrency Guidelines for Phase 2 Mutation Services
When future Phase 2 member-removal and role-demotion endpoints are implemented:
1. The mutating service must invoke `assert_not_last_owner()` inside an explicit atomic transaction block (`with db.begin():`).
2. The service must acquire a pessimistic row lock (`SELECT ... FOR UPDATE` on the parent `businesses` row in PostgreSQL) to prevent race conditions where two simultaneous requests both demote or delete the last two remaining owners.
3. Ownership transfer must be treated as a dedicated, two-phase administrative operation.

## 5. Client-Side Security & Threat Model Disclosures

### 5.1 Token Storage & Tab Scoping
- **Storage Target:** `sessionStorage` (key: `bizflow_access_token`, `bizflow_active_workspace_id`).
- **Tab Scoping:** `sessionStorage` is scoped to a specific browsing context/tab. This reduces accidental sharing of workspace state between independent tabs running in the same browser profile.
- **Cross-Tab Boundary:** It does **not** prevent all cross-tab contamination (e.g. nested frames or window references within the same session tree).
- **XSS Vulnerability Disclosure:** `sessionStorage` is directly accessible to JavaScript running within the same origin. It **does not protect against token theft through successful Cross-Site Scripting (XSS)**. If an attacker succeeds in executing script in the application origin, tokens in `sessionStorage` can be read and exfiltrated.
- **Defensive Measures:**
  - React JSX's normal text escaping provides useful protection against common injection patterns, but is **not a complete XSS defense** (e.g., dynamic attribute values, `javascript:` pseudo-protocols, or unescaped HTML insertion).
  - Input sanitization alone is **not a complete XSS defense**.
  - The application avoids unsafe HTML rendering (`dangerouslySetInnerHTML`), validates URL destinations before navigation, minimizes third-party dependencies, and documents residual XSS risk.
- **Frontend Role Badges:** Badges (`OWNER`, `ADMIN`, etc.) displayed in the UI are **informational presentation only**. Backend authorization dependencies (`RequireRoles`, `CurrentBusinessDep`) remain strictly authoritative on every request.

---

## 6. Phase-Gated Security Requirements

### 6.1 Implemented & Verified Phase 1 Defenses
- **Workspace Context Isolation:** Verified workspace-context and membership isolation mechanisms for existing Phase 1 endpoints (`CurrentBusinessDep` requiring valid `X-Business-ID`).
- **Existence Privacy:** Inaccessible workspaces cannot be enumerated; uniform HTTP 404 `BUSINESS_NOT_FOUND` for nonexistent and un-joined workspaces.
- **Header Validation:** Strict missing and malformed header rejection: HTTP 400 `MISSING_BUSINESS_ID_HEADER` and `INVALID_BUSINESS_ID_FORMAT`.
- **Payload Overrides:** Client-supplied tenant IDs in JSON bodies ignored; backend extracts `business_id` exclusively from validated server-side `WorkspaceContext`.
- **Privilege Escalation:** Strict RBAC enforcement per workspace; `RequireRoles` dependency enforcing exact `SUPPORTED_ROLES` matching against database `CHECK` constraint.
- **Account Enumeration:** Mitigation of timing-based email discovery via `bcrypt` verification with dummy-hash verification for nonexistent accounts.
- **Last-Owner Lockout:** Workspaces cannot be orphaned; `assert_not_last_owner` transaction safeguard.
- **Credential & CSRF Defense:** No ambient cookie vulnerability; `credentials: 'omit'` on all fetch requests; Bearer token authentication.

### 6.2 Architectural Safeguards Reserved for Phase 2
- **Multi-Tenant Financial Data Isolation:** The Phase 1 foundation provides the tenant context and authorization dependencies. In Phase 2, every financial transaction, invoice, payment, and customer table **must independently enforce and test tenant scoping** using `WorkspaceContext.business_id`.

### 6.3 Future Phase 2 Security Requirements
- **CSV Ingestion & Export Defense:** When CSV import/export is introduced in Phase 2, string fields beginning with dangerous formula triggers (`=`, `+`, `-`, `@`, `\t`, `\r`) must be sanitized by prepending a single quote (`'`), and uploaded files must undergo strict size, MIME, and header validation. (This is a future requirement, not an existing Phase 1 implementation).
- **Authentication Rate Limiting:** Enforce IP/account-level rate limiting on `/auth/login` to prevent credential brute-forcing.

---

## 7. Testing & Environment Limitations

- **Hermetic SQLite Test Suite (Default):** All 85 unit and integration tests run hermetically against SQLite in-memory via `pytest backend/tests/ -m "not postgres" -v` with `PRAGMA foreign_keys=ON`.
- **Opt-In PostgreSQL Test Suite:** Opt-in PostgreSQL tests located in `backend/tests/postgres/` enforce strict `TEST_DATABASE_URL` validation (connecting strictly to `bizflow_test`) and automatic Alembic migration execution.
- **PostgreSQL Runtime Disclosure:** Live PostgreSQL 16 runtime verification remains **UNVERIFIED** on local developer hosts without a running PostgreSQL daemon.
