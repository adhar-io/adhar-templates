"""The service's tests. app-ci runs them with pytest on the Python version the
image is built with (requirements.txt installed first); locally:
pip install -r requirements.txt pytest && python -m pytest

Without this file pytest collected nothing and app-ci's test stage passed on
"no tests ran", so a change that broke every endpoint still shipped."""

import app as service

client = service.app.test_client()


def test_index():
    res = client.get("/")
    assert res.status_code == 200
    assert res.get_json() == {"service": "${{ values.name }}", "status": "ok"}


def test_healthz():
    # The readiness and liveness probes call this path.
    res = client.get("/healthz")
    assert res.status_code == 200
    assert res.get_data(as_text=True) == "ok"
{%- if values.withDatabase %}


class _Cursor:
    def execute(self, sql):
        assert sql == "SELECT now()"

    def fetchone(self):
        return ("2026-01-01 00:00:00+00:00",)


class _Connection:
    closed = False

    def cursor(self):
        return _Cursor()

    def close(self):
        self.closed = True


def test_db_queries_the_database(monkeypatch):
    conn = _Connection()
    seen = []

    def connect(url):
        seen.append(url)
        return conn

    monkeypatch.setenv("DATABASE_URL", "postgresql://app@db.invalid/app")
    monkeypatch.setattr(service.psycopg2, "connect", connect)
    res = client.get("/db")
    assert res.status_code == 200
    assert res.get_json() == {"db": "ok", "now": "2026-01-01 00:00:00+00:00"}
    assert seen == ["postgresql://app@db.invalid/app"]
    assert conn.closed


def test_db_reports_a_missing_database_as_an_error(monkeypatch):
    # No DATABASE_URL (the Secret is not mounted): a JSON 500, never a crash.
    monkeypatch.delenv("DATABASE_URL", raising=False)
    res = client.get("/db")
    assert res.status_code == 500
    assert res.get_json()["db"] == "error"
{%- endif %}
