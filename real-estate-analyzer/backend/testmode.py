"""Request-scoped test mode flag.

When the frontend sends ``X-Test-Mode: true``, the ASGI middleware sets
a contextvars flag for the duration of the request. The AI service checks
``is_test_mode()`` and skips API calls when it returns True.
"""

import contextvars

from starlette.middleware.base import BaseHTTPMiddleware, RequestResponseEndpoint
from starlette.requests import Request
from starlette.responses import Response

_test_mode: contextvars.ContextVar[bool] = contextvars.ContextVar("test_mode", default=False)


def is_test_mode() -> bool:
    return _test_mode.get()


class TestModeMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next: RequestResponseEndpoint) -> Response:
        header = request.headers.get("x-test-mode", "").lower()
        _test_mode.set(header == "true")
        response = await call_next(request)
        if _test_mode.get():
            response.headers["X-Test-Mode"] = "active"
        return response
