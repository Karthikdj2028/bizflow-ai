"""Hermetic unit tests for application settings and Alembic runtime configuration.

Verifies:
1. Canonical repository-root .env resolution and resolve_env_file logic without reading live credentials.
2. Production Settings directory independence using isolated temporary .env files and BIZFLOW_ENV_FILE.
3. Operating-system environment variable precedence over .env files.
4. Alembic script_location %(here)s resolution to absolute backend path across working directories.
5. Alembic configuration explicit URL override preservation.
6. configure_alembic_url helper testing settings fallback, percent-encoded credentials, and caller preservation.
"""

from pathlib import Path
import pytest
from alembic.config import Config

from app.core.config import (
    Settings,
    REPO_ROOT,
    ROOT_ENV_PATH,
    configure_alembic_url,
    get_settings,
    resolve_env_file,
)


def test_canonical_root_env_path_anchoring(monkeypatch: pytest.MonkeyPatch):
    """Verify ROOT_ENV_PATH is anchored to absolute root without reading local .env file."""
    assert ROOT_ENV_PATH.is_absolute()
    assert ROOT_ENV_PATH.name == ".env"
    assert ROOT_ENV_PATH.parent == REPO_ROOT
    assert (REPO_ROOT / "backend").is_dir()
    assert (REPO_ROOT / "docs").is_dir()

    # Without ambient override, resolve_env_file() returns canonical ROOT_ENV_PATH
    monkeypatch.delenv("BIZFLOW_ENV_FILE", raising=False)
    assert resolve_env_file() == str(ROOT_ENV_PATH)

    # With 'none' or empty string, resolve_env_file() safely returns None
    monkeypatch.setenv("BIZFLOW_ENV_FILE", "none")
    assert resolve_env_file() is None
    monkeypatch.setenv("BIZFLOW_ENV_FILE", "")
    assert resolve_env_file() is None


def test_working_directory_independent_env_resolution(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    """Verify production Settings resolves identically across working directories

    using an isolated temporary .env via both default configuration and explicit _env_file.
    """
    temp_env_file = tmp_path / "custom.env"
    temp_env_file.write_text("PROJECT_NAME=Directory Independent Production Settings\n", encoding="utf-8")

    override_env_file = tmp_path / "override.env"
    override_env_file.write_text("PROJECT_NAME=Explicit Override Settings\n", encoding="utf-8")

    monkeypatch.setenv("BIZFLOW_ENV_FILE", str(temp_env_file))

    backend_dir = REPO_ROOT / "backend"
    arbitrary_dir = tmp_path / "arbitrary"
    arbitrary_dir.mkdir()

    # Exercise production Settings class default config across working directories
    for target_dir in (REPO_ROOT, backend_dir, arbitrary_dir):
        monkeypatch.chdir(target_dir)

        # 1. Default configuration evaluation via resolve_env_file()
        settings_default = Settings()
        assert settings_default.PROJECT_NAME == "Directory Independent Production Settings"

        # 2. Explicit _env_file parameter evaluation
        settings_explicit = Settings(_env_file=str(override_env_file))
        assert settings_explicit.PROJECT_NAME == "Explicit Override Settings"

        # 3. Path resolver function returns isolated absolute path
        assert resolve_env_file() == str(temp_env_file)


def test_os_environment_variable_precedence_over_env_file(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    """Verify operating-system environment variables strictly override .env values."""
    temp_env_file = tmp_path / "test.env"
    temp_env_file.write_text("PROJECT_NAME=Value From Temp File\n", encoding="utf-8")
    monkeypatch.setenv("BIZFLOW_ENV_FILE", str(temp_env_file))

    # Without OS env var: loads from temp file via production Settings
    monkeypatch.delenv("PROJECT_NAME", raising=False)
    settings_from_file = Settings()
    assert settings_from_file.PROJECT_NAME == "Value From Temp File"

    # With OS env var: OS environment variable takes strict precedence
    monkeypatch.setenv("PROJECT_NAME", "Value From OS Environment")
    settings_from_os = Settings()
    assert settings_from_os.PROJECT_NAME == "Value From OS Environment"


def test_alembic_script_location_here_expansion(monkeypatch: pytest.MonkeyPatch, tmp_path: Path):
    """Verify Alembic %(here)s expands to absolute backend path regardless of working directory."""
    backend_dir = REPO_ROOT / "backend"
    alembic_ini_path = backend_dir / "alembic.ini"
    expected_script_dir = str(backend_dir / "alembic")

    # 1. From repository root
    monkeypatch.chdir(REPO_ROOT)
    cfg_root = Config(str(alembic_ini_path))
    assert cfg_root.get_main_option("script_location") == expected_script_dir

    # 2. From backend directory
    monkeypatch.chdir(backend_dir)
    cfg_backend = Config(str(alembic_ini_path))
    assert cfg_backend.get_main_option("script_location") == expected_script_dir

    # 3. From arbitrary external directory
    monkeypatch.chdir(tmp_path)
    cfg_temp = Config(str(alembic_ini_path))
    assert cfg_temp.get_main_option("script_location") == expected_script_dir


def test_alembic_placeholder_removed_and_override_preserved():
    """Verify that alembic.ini has no hardcoded URL and preserves explicit overrides."""
    backend_dir = REPO_ROOT / "backend"
    alembic_ini_path = backend_dir / "alembic.ini"

    # Default Config: sqlalchemy.url must be unset / None in alembic.ini
    cfg_default = Config(str(alembic_ini_path))
    assert cfg_default.get_main_option("sqlalchemy.url") is None

    # Explicit override (such as opt-in test runner): must be preserved
    explicit_test_url = "postgresql+psycopg://bizflow_user:secret@localhost:5432/bizflow_test"
    cfg_default.set_main_option("sqlalchemy.url", explicit_test_url)
    assert cfg_default.get_main_option("sqlalchemy.url") == explicit_test_url


def test_alembic_configure_url_helper_and_percent_roundtrip():
    """Verify configure_alembic_url handles settings fallback, percent encoding, and overrides."""
    backend_dir = REPO_ROOT / "backend"
    alembic_ini_path = backend_dir / "alembic.ini"

    # 1. Fallback to get_settings().DATABASE_URL when no fallback_url provided
    cfg = Config(str(alembic_ini_path))
    assert cfg.get_main_option("sqlalchemy.url") is None
    url_default = configure_alembic_url(cfg)
    assert url_default == get_settings().DATABASE_URL
    assert cfg.get_main_option("sqlalchemy.url") == get_settings().DATABASE_URL

    # 2. Explicit fallback_url with complex percent-encoded credentials (@, %, /, :)
    raw_url = "postgresql+psycopg://user:p%40ss%25w%2Fo%3Ard@localhost:5432/bizflow_dev"
    cfg_custom = Config(str(alembic_ini_path))
    assert cfg_custom.get_main_option("sqlalchemy.url") is None
    effective_url = configure_alembic_url(cfg_custom, fallback_url=raw_url)
    assert effective_url == raw_url
    assert cfg_custom.get_main_option("sqlalchemy.url") == raw_url

    # 3. Preservation of caller-provided URL (e.g. test runner override)
    explicit_test_url = "postgresql+psycopg://bizflow_user:secret@localhost:5432/bizflow_test"
    cfg_override = Config(str(alembic_ini_path))
    cfg_override.set_main_option("sqlalchemy.url", explicit_test_url.replace("%", "%%"))
    retained_url = configure_alembic_url(
        cfg_override,
        fallback_url="postgresql+psycopg://ignored@localhost:5432/other",
    )
    assert retained_url == explicit_test_url
    assert cfg_override.get_main_option("sqlalchemy.url") == explicit_test_url
