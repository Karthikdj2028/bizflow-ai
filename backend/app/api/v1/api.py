"""
Modular API v1 router definition.
Mounts all modular sub-routers under the /api/v1 prefix.
"""

from fastapi import APIRouter
from app.api.v1.endpoints import auth, categories, customers, health, transactions, workspaces

api_router = APIRouter()

# Mount health check routes
api_router.include_router(health.router, tags=["Health"])

# Mount auth routes under /api/v1/auth
api_router.include_router(auth.router, prefix="/auth", tags=["Authentication"])

# Mount workspace routes under /api/v1/workspaces
api_router.include_router(workspaces.router, prefix="/workspaces", tags=["Workspaces"])

# Mount category routes under /api/v1/categories
api_router.include_router(categories.router, tags=["Categories"])

# Mount customer routes under /api/v1/customers
api_router.include_router(customers.router, tags=["Customers"])

# Mount transaction ledger routes under /api/v1/transactions
api_router.include_router(transactions.router, tags=["Transactions"])
