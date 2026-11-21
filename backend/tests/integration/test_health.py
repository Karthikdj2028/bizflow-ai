"""Integration tests for the system health check endpoints."""

from fastapi.testclient import TestClient


def test_root_health_endpoint(client: TestClient) -> None:
    """Verify that GET /health returns 200 OK with healthy status."""
    response = client.get("/health")
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "healthy"
    assert data["project"] == "BizFlow AI"
    assert data["version"] == "0.1.0"
    assert "environment" in data


def test_api_v1_health_endpoint(client: TestClient) -> None:
    """Verify that GET /api/v1/health returns 200 OK with identical payload."""
    response = client.get("/api/v1/health")
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "healthy"
    assert data["project"] == "BizFlow AI"


def test_root_metadata_endpoint(client: TestClient) -> None:
    """Verify that GET / returns service metadata and links."""
    response = client.get("/")
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "online"
    assert data["health"] == "/health"
    assert data["docs"] == "/docs"
