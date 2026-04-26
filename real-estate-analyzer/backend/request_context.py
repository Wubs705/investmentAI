"""
request_context.py — Lightweight per-request context storage.

Import `request_id_var` from any module to read the current request ID::

    from backend.request_context import request_id_var

    rid = request_id_var.get("")
"""

from contextvars import ContextVar

# Holds the X-Request-ID for the current request.  Default is an empty string
# so callers can do `request_id_var.get("")` safely outside a request context.
request_id_var: ContextVar[str] = ContextVar("request_id", default="")
