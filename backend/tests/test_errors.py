"""Every error response uses {"error": {"code", "message"}}."""

import httpx
from fastapi import FastAPI


def _assert_error_shape(response: httpx.Response, code: str) -> None:
    body = response.json()
    assert set(body) == {"error"}
    assert set(body["error"]) == {"code", "message"}
    assert body["error"]["code"] == code
    assert isinstance(body["error"]["message"], str)
    assert body["error"]["message"]


async def test_missing_fields_are_validation_errors(client: httpx.AsyncClient) -> None:
    response = await client.post("/api/auth/login", json={"email": "a@b.c"})
    assert response.status_code == 422
    _assert_error_shape(response, "validation.invalid")


async def test_malformed_json_is_a_validation_error(client: httpx.AsyncClient) -> None:
    response = await client.post(
        "/api/auth/login", content=b"{not json", headers={"content-type": "application/json"}
    )
    assert response.status_code == 422
    _assert_error_shape(response, "validation.invalid")


async def test_unknown_route(client: httpx.AsyncClient) -> None:
    response = await client.get("/api/does-not-exist")
    assert response.status_code == 404
    _assert_error_shape(response, "resource.not_found")


async def test_wrong_method(client: httpx.AsyncClient) -> None:
    response = await client.get("/api/auth/login")
    assert response.status_code == 405
    _assert_error_shape(response, "request.method_not_allowed")


async def test_unexpected_exception_is_hidden(app: FastAPI, client: httpx.AsyncClient) -> None:
    @app.get("/api/_boom")
    async def boom() -> None:
        raise RuntimeError("secret internals")

    response = await client.get("/api/_boom")
    assert response.status_code == 500
    _assert_error_shape(response, "server.internal")
    assert "secret" not in response.text
