"""The access key for the hosted backend.

When TACIT_ACCESS_KEY is set, every request has to carry it in the X-Tacit-Key header, except
GET /health (so the app can see the server is up) and CORS preflights. Without the env var
(local dev) the backend stays open. The key is read once, when the app starts.

A <video src> can't send headers, so the clip route alone also takes the key as ?key=.
The Docker image runs uvicorn without its access log, so that URL isn't printed.
"""

import hmac
import json
import os
import re
from urllib.parse import parse_qs

from src.utils.logger import logger

HEADER = "X-Tacit-Key"
ENV_VAR = "TACIT_ACCESS_KEY"
QUERY_PARAM = "key"
DENIED = {"detail": "Missing or wrong access key"}
# The only route that takes the key in the query string (path_router.get_clip).
QUERY_KEY_PATH = re.compile(r"/api/v1/sessions/[^/]+/clip")


def access_key() -> str:
    return os.getenv(ENV_VAR, "").strip()


def mode() -> str:
    """ "key" when requests need the access key, "open" when they don't."""
    return "key" if access_key() else "open"


class AccessKeyMiddleware:
    """Pure ASGI middleware, so it adds nothing to streaming responses or uploads."""

    def __init__(self, app, key: str | None = None):
        self.app = app
        self.key = (access_key() if key is None else key).encode()
        logger.info(f"Access: {'key' if self.key else 'open'}")

    def _allowed(self, scope) -> bool:
        if not self.key:
            return True
        method = scope.get("method", "GET")
        if method == "OPTIONS" or (method == "GET" and scope["path"] == "/health"):
            return True
        sent = dict(scope.get("headers") or []).get(HEADER.lower().encode(), b"")
        if not sent and method == "GET" and QUERY_KEY_PATH.fullmatch(scope["path"]):
            query = parse_qs(scope.get("query_string", b"").decode("latin-1"))
            sent = (query.get(QUERY_PARAM) or [""])[0].encode()
        return hmac.compare_digest(sent, self.key)

    async def __call__(self, scope, receive, send):
        if scope["type"] not in ("http", "websocket") or self._allowed(scope):
            await self.app(scope, receive, send)
            return
        if scope["type"] == "websocket":
            await send({"type": "websocket.close", "code": 1008})
            return
        body = json.dumps(DENIED).encode()
        await send(
            {
                "type": "http.response.start",
                "status": 401,
                "headers": [
                    (b"content-type", b"application/json"),
                    (b"content-length", str(len(body)).encode()),
                ],
            }
        )
        await send({"type": "http.response.body", "body": body})
