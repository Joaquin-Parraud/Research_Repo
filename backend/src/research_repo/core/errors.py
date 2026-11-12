"""Error type shared by services and API, and the handlers that render it.

Every error response has the shape::

    {"error": {"code": "auth.invalid_credentials", "message": "English fallback text"}}

``code`` is a stable dotted key that clients translate; ``message`` is an English fallback.
"""

import logging

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

logger = logging.getLogger(__name__)


class AppError(Exception):
    status_code: int = 400
    code: str = "request.invalid"
    message: str = "The request is invalid."

    def __init__(
        self,
        message: str | None = None,
        *,
        code: str | None = None,
        status_code: int | None = None,
        headers: dict[str, str] | None = None,
    ) -> None:
        if message is not None:
            self.message = message
        if code is not None:
            self.code = code
        if status_code is not None:
            self.status_code = status_code
        self.headers = headers
        super().__init__(self.message)


class InvalidCredentials(AppError):
    status_code = 401
    code = "auth.invalid_credentials"
    message = "Invalid email or password."


class NotAuthenticated(AppError):
    status_code = 401
    code = "auth.not_authenticated"
    message = "Authentication required."


class RateLimited(AppError):
    status_code = 429
    code = "auth.rate_limited"
    message = "Too many failed login attempts. Try again later."

    def __init__(self, retry_after_seconds: int) -> None:
        super().__init__(headers={"Retry-After": str(retry_after_seconds)})


class NotFound(AppError):
    status_code = 404
    code = "resource.not_found"
    message = "Resource not found."


class Forbidden(AppError):
    status_code = 403
    code = "auth.forbidden"
    message = "You do not have permission to do this."


class ServiceUnavailable(AppError):
    status_code = 503
    code = "server.unavailable"
    message = "The service is temporarily unavailable."


_HTTP_STATUS_CODES: dict[int, tuple[str, str]] = {
    404: ("resource.not_found", "Resource not found."),
    405: ("request.method_not_allowed", "Method not allowed."),
}


def error_body(code: str, message: str) -> dict[str, dict[str, str]]:
    return {"error": {"code": code, "message": message}}


def _response(
    status_code: int, code: str, message: str, headers: dict[str, str] | None = None
) -> JSONResponse:
    return JSONResponse(error_body(code, message), status_code=status_code, headers=headers)


async def _app_error_handler(_: Request, exc: Exception) -> JSONResponse:
    assert isinstance(exc, AppError)
    return _response(exc.status_code, exc.code, exc.message, exc.headers)


async def _validation_error_handler(_: Request, exc: Exception) -> JSONResponse:
    assert isinstance(exc, RequestValidationError)
    return _response(422, "validation.invalid", "The request data is invalid.")


async def _http_error_handler(_: Request, exc: Exception) -> JSONResponse:
    assert isinstance(exc, StarletteHTTPException)
    code, message = _HTTP_STATUS_CODES.get(
        exc.status_code, ("request.invalid", "The request could not be processed.")
    )
    return _response(exc.status_code, code, message, exc.headers)


async def _unhandled_error_handler(request: Request, exc: Exception) -> JSONResponse:
    logger.exception("Unhandled error on %s %s", request.method, request.url.path, exc_info=exc)
    return _response(500, "server.internal", "An unexpected error occurred.")


def install_error_handlers(app: FastAPI) -> None:
    app.add_exception_handler(AppError, _app_error_handler)
    app.add_exception_handler(RequestValidationError, _validation_error_handler)
    app.add_exception_handler(StarletteHTTPException, _http_error_handler)
    app.add_exception_handler(Exception, _unhandled_error_handler)
