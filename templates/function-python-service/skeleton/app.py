"""${{ values.name }}: an HTTP function on Adhar's Function API (Knative).

Knative starts this process on demand, sends it requests on $PORT (8080) and
scales it to zero when no request has arrived for a while. Events from the
function's trigger arrive as HTTP POSTs too: a CloudEvent in binary mode (ce-*
headers) from a schedule or a Broker, or a Dapr topic delivery.
"""

import os
from datetime import datetime, timezone

from flask import Flask, jsonify, request

app = Flask(__name__)
# Requests larger than this are refused rather than buffered.
app.config["MAX_CONTENT_LENGTH"] = 1024 * 1024

NAME = os.environ.get("FUNCTION_NAME", ${{ values.name | dump }})
RUNTIME = os.environ.get("FUNCTION_RUNTIME", "python313")
TRIGGER = os.environ.get("FUNCTION_TRIGGER", "http")
METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"]


def now():
    return datetime.now(timezone.utc).isoformat()


@app.get("/healthz")
def healthz():
    return jsonify(ok=True, at=now())


# The function: every path and method but /healthz. Replace the body with what
# yours does.
@app.route("/", defaults={"path": ""}, methods=METHODS)
@app.route("/<path:path>", methods=METHODS)
def invoke(path):
    body = request.get_data()
    return jsonify(
        ok=True,
        function=NAME,
        runtime=RUNTIME,
        trigger=TRIGGER,
        method=request.method,
        path="/" + path,
        event=request.headers.get("ce-type"),
        received=len(body),
        at=now(),
    )


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=int(os.environ.get("PORT", "8080")))
