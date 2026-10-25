import os
from datetime import datetime, timezone

from flask import Flask, jsonify

app = Flask(__name__)


@app.route("/healthz")
def healthz():
    return jsonify(ok=True, at=datetime.now(timezone.utc).isoformat())


@app.route("/")
def root():
    return jsonify(
        ok=True,
        function=os.environ.get("FUNCTION_NAME", "${{ values.name }}"),
        runtime="python312",
        trigger=os.environ.get("FUNCTION_TRIGGER", "${{ values.trigger }}"),
        at=datetime.now(timezone.utc).isoformat(),
    )


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=int(os.environ.get("PORT", "8080")))
