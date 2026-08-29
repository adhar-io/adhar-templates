import os
from flask import Flask, jsonify
{%- if values.withDatabase %}
import psycopg2
{%- endif %}

app = Flask(__name__)


@app.route("/")
def index():
    return jsonify(service="${{ values.name }}", status="ok")


@app.route("/healthz")
def healthz():
    return "ok", 200

{%- if values.withDatabase %}

@app.route("/db")
def db():
    try:
        conn = psycopg2.connect(os.environ["DATABASE_URL"])
        cur = conn.cursor()
        cur.execute("SELECT now()")
        now = cur.fetchone()[0]
        conn.close()
        return jsonify(db="ok", now=str(now))
    except Exception as exc:  # noqa: BLE001
        return jsonify(db="error", error=str(exc)), 500
{%- endif %}


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=int(os.environ.get("PORT", ${{ values.port }})))
