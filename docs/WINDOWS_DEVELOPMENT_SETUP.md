# BizFlow AI — Windows Development & PowerShell Handoff Guide

This guide provides end-to-end instructions for cloning, configuring, migrating, seeding, and running BizFlow AI on Windows 10/11 using **Windows PowerShell** or **PowerShell 7**.

---

## 1. Prerequisites on Windows

Before beginning, ensure the following tools are installed on your Windows workstation:

1. **Git for Windows**:
   - Download: https://git-scm.com/download/win
   - Select default options (enables Git Bash and PowerShell integration).
2. **Python 3.12 or 3.13**:
   - Download: https://www.python.org/downloads/windows/
   - **Important**: During installation, check the box: **"Add python.exe to PATH"**.
3. **Node.js (LTS version 20+ or 22+) & npm**:
   - Download: https://nodejs.org/
4. **PostgreSQL 16+** (Optional for local PostgreSQL, or use SQLite for instant offline development):
   - PostgreSQL for Windows: https://www.postgresql.org/download/windows/
   - Alternatively, use Docker Desktop: `docker compose up -d postgres`

---

## 2. Step 1: Clone the Repository

Open **PowerShell** (press `Win + X`, then choose `Terminal` or `Windows PowerShell`) and navigate to your desired projects directory:

```powershell
# Navigate to your workspace directory
cd C:\Users\$env:USERNAME\Projects

# Clone the repository
git clone https://github.com/Karthikdj2028/bizflow-ai.git

# Enter project root
cd bizflow-ai
```

---

## 3. Step 2: Environment Variable Configuration

BizFlow AI keeps all environment configurations in a root `.env` file. A template `.env.example` is committed to the repository.

```powershell
# Copy the environment template to .env in project root
Copy-Item .env.example .env
```

### Inspect / Edit `.env`
Open `.env` in Notepad or VS Code:
```powershell
notepad .env
```

Default local database connection:
- For local PostgreSQL:
  ```env
  DATABASE_URL=postgresql+psycopg://bizflow_user:bizflow_password@localhost:5432/bizflow_dev
  ```
- For rapid local SQLite development (zero setup):
  ```env
  DATABASE_URL=sqlite:///./bizflow_dev.db
  ```
- Environment mode and security:
  ```env
  ENVIRONMENT=development
  DEBUG=true
  JWT_SECRET_KEY=development-insecure-secret-key-minimum-32-chars-long!
  CORS_ORIGINS=["http://localhost:5173","http://127.0.0.1:5173"]
  ```

---

## 4. Step 3: Backend Python Virtual Environment

```powershell
# Enter backend directory
cd backend

# Create a virtual environment named .venv
python -m venv .venv

# Enable script execution policy in the current PowerShell process if needed
Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope Process

# Activate the virtual environment
.\.venv\Scripts\Activate.ps1

# Upgrade pip, setuptools, and wheel
python -m pip install --upgrade pip setuptools wheel

# Install all backend dependencies from requirements.lock
pip install -r requirements.lock
```

---

## 5. Step 4: Run Database Migrations

Apply all Alembic database schema migrations (up to Phase 2.5 multi-line invoice management):

```powershell
# Ensure virtual environment is active in the backend directory
alembic upgrade head
```

You should see:
```text
INFO  [alembic.runtime.migration] Running upgrade  -> 0001, initial_core_schema
INFO  [alembic.runtime.migration] Running upgrade 0001 -> 0002, financial_management_core
INFO  [alembic.runtime.migration] Running upgrade 0002 -> 0003, customer_management
INFO  [alembic.runtime.migration] Running upgrade 0003 -> 0004, invoice_management
```

---

## 6. Step 5: Seed Demo Transaction Data

BizFlow AI includes an automated, idempotent demo data generator that seeds **50 realistic demo transactions per category across all 9 supported categories (450 total transactions)**:

```powershell
# Seed demo user, workspace, categories, and 450 transactions:
python -m app.services.demo_data
```

### Seeder Output:
```text
======================================================================
BizFlow AI — Demo Transaction Data Seeder
======================================================================
Database is empty. Initializing demo user and business workspace...
Created Demo User:     demo@bizflow.ai
Demo Password:         DemoPassword123!
Created Workspace:     Acme Global Enterprises (Currency: USD)
  Categories supported:     9
  New transactions created: 450
  Total demo transactions:  450
  Category breakdown:
    - Sales & Services          : 50 total (50 newly created)
    - Consulting & Advisory     : 50 total (50 newly created)
    - Other Income              : 50 total (50 newly created)
    - Software & Subscriptions  : 50 total (50 newly created)
    - Rent & Office Space       : 50 total (50 newly created)
    - Marketing & Advertising   : 50 total (50 newly created)
    - Professional Services     : 50 total (50 newly created)
    - Travel & Entertainment    : 50 total (50 newly created)
    - General & Administrative  : 50 total (50 newly created)

Demo seeding completed successfully. Database is ready for development.
```

> **Idempotency Note:** You can re-run `python -m app.services.demo_data` at any time. It will detect existing demo transactions and create zero duplicates. Existing user data is never overwritten.

---

## 7. Step 6: Frontend Installation

Open a **second PowerShell window**:

```powershell
# Navigate to the frontend directory
cd C:\Users\$env:USERNAME\Projects\bizflow-ai\frontend

# Install dependencies
npm install
```

---

## 8. Step 7: Starting Development Servers

### Terminal 1 — Backend (FastAPI + Uvicorn)
In your first PowerShell window (inside `backend` with `.venv` active):
```powershell
uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```
- API Health Check: http://127.0.0.1:8000/health
- Interactive Swagger Docs: http://127.0.0.1:8000/docs
- Alternative ReDoc: http://127.0.0.1:8000/redoc

### Terminal 2 — Frontend (Vite + React)
In your second PowerShell window (inside `frontend`):
```powershell
npm run dev
```
- Open your browser to: **http://localhost:5173**
- Login with the seeded demo credentials:
  - **Email:** `demo@bizflow.ai`
  - **Password:** `DemoPassword123!`

---

## 9. Running Verification Tests on Windows

### Backend Pytest Suite
In the backend directory (with `.venv` active):
```powershell
# Run the hermetic SQLite unit and integration test suite
pytest tests/ -v
```
Expected: 214+ passed, 0 failures.

### Frontend Vitest Suite
In the frontend directory:
```powershell
# Run full frontend test suite
npm test

# Run frontend production build
npm run build
```
Expected: 173 passed across 10 test files, production build passes with 0 errors.

---

## 10. Common Windows Troubleshooting & Tips

### Issue: `Activate.ps1 cannot be loaded because running scripts is disabled`
**Solution:** Enable execution policy for your current PowerShell session:
```powershell
Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope Process
```

### Issue: `python` points to Microsoft Store instead of Python
**Solution:**
1. Open Windows Start menu and search for **"Manage app execution aliases"**.
2. Turn off the toggles for **"App Installer" -> python.exe** and **python3.exe**.
3. Verify with `where.exe python`.

### Issue: Path Separators
BizFlow AI uses `pathlib.Path` and portable URL paths throughout Python code. Never hardcode Windows backslashes (`\`) into API URLs or JSON payloads.
