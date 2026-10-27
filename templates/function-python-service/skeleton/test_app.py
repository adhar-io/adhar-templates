"""The function's tests. app-ci runs them with pytest on the Python version
project.toml pins; locally: python -m pytest."""

from app import app

client = app.test_client()


def test_healthz():
    res = client.get("/healthz")
    assert res.status_code == 200
    assert res.get_json()["ok"] is True


def test_invoke():
    res = client.get("/")
    assert res.status_code == 200
    body = res.get_json()
    assert body["ok"] is True
    assert body["event"] is None


def test_cloudevent():
    res = client.post(
        "/",
        json={"hello": "world"},
        headers={"ce-type": "com.example.ping", "ce-source": "test", "ce-id": "1", "ce-specversion": "1.0"},
    )
    assert res.status_code == 200
    body = res.get_json()
    assert body["event"] == "com.example.ping"
    assert body["received"] > 0
