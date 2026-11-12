"""APA 7 output from the citation service (FR-C1 to FR-C3, FR-L3).

References and in-text citations are rendered by the ``citeproc`` service (``citeproc/`` at the
repository root): citeproc-js with the official ``apa.csl`` and CSL locales. Nothing here builds
reference strings or edits the processor's output; this module only sends CSL-JSON items and
reads the answer.

The service renders, in one call, a sorted reference list and in-text forms for the items asked
for. Every item sent takes part in disambiguation (year suffixes such as ``2020a``, added names
or initials), so the caller chooses the scope by what it sends: the whole project for one
source's citation, the exported sources for a bibliography.

The ``html`` the service returns uses only ``<i>``, ``<b>``, ``<sup>`` and ``<sub>``, and user
text in it is escaped; ``text`` is the same content without markup.
"""

import logging
from collections.abc import Sequence
from dataclasses import dataclass
from typing import Any, Literal

import httpx

logger = logging.getLogger(__name__)

Mode = Literal["parenthetical", "narrative"]

CONNECT_TIMEOUT_SECONDS = 2.0
# Shorter than the service's keep-alive timeout (65 s), so a pooled connection is never reused
# just as the service closes it.
KEEPALIVE_EXPIRY_SECONDS = 30.0


class ProcessorUnavailable(Exception):
    """The service could not be reached or did not answer in time."""


class ProcessorFailed(Exception):
    """The service answered with an error. ``keys``: the items it could not render, if known."""

    def __init__(self, message: str, keys: list[str] | None = None) -> None:
        super().__init__(message)
        self.keys = keys or []


@dataclass(frozen=True)
class Reference:
    key: str
    html: str
    text: str


@dataclass(frozen=True)
class Entry:
    key: str
    reference_html: str
    reference_text: str
    in_text_parenthetical: str
    in_text_narrative: str


def processor_item(csl: dict[str, Any], key: str) -> dict[str, Any]:
    """A source's CSL-JSON as the service takes it: the citation key is the item ``id``."""
    return {**csl, "id": key}


class CiteprocClient:
    """Async client for the citation service; one per application (pooled connections)."""

    def __init__(
        self,
        base_url: str,
        *,
        timeout: float,
        transport: httpx.AsyncBaseTransport | None = None,
    ) -> None:
        self.base_url = base_url.rstrip("/")
        self._client = httpx.AsyncClient(
            base_url=self.base_url,
            timeout=httpx.Timeout(timeout, connect=CONNECT_TIMEOUT_SECONDS),
            limits=httpx.Limits(
                max_connections=10,
                max_keepalive_connections=5,
                keepalive_expiry=KEEPALIVE_EXPIRY_SECONDS,
            ),
            transport=transport,
            follow_redirects=False,
        )

    async def aclose(self) -> None:
        await self._client.aclose()

    async def healthy(self) -> bool:
        try:
            response = await self._client.get("/health", timeout=CONNECT_TIMEOUT_SECONDS)
        except httpx.HTTPError:
            return False
        return response.status_code == 200

    async def render(
        self,
        locale: str,
        items: list[dict[str, Any]],
        *,
        bibliography: list[str] | Literal["all"] | None = None,
        citations: Sequence[tuple[str, Mode]] = (),
    ) -> dict[str, Any]:
        """The service's answer: ``bibliography``, ``citations`` and ``excluded_ids``."""
        body: dict[str, Any] = {"locale": locale, "items": items}
        if bibliography == "all":
            body["bibliography"] = {}
        elif bibliography is not None:
            body["bibliography"] = {"ids": bibliography}
        if citations:
            body["citations"] = [{"id": key, "mode": mode} for key, mode in citations]
        try:
            response = await self._client.post("/render", json=body)
        except httpx.TimeoutException as exc:
            logger.warning("Citation service at %s timed out: %r", self.base_url, exc)
            raise ProcessorUnavailable("timeout") from exc
        except httpx.TransportError as exc:
            logger.warning("Citation service at %s is unreachable: %r", self.base_url, exc)
            raise ProcessorUnavailable("unreachable") from exc

        if response.status_code in (502, 503, 504):
            logger.warning("Citation service answered %s", response.status_code)
            raise ProcessorUnavailable(f"status {response.status_code}")
        try:
            payload = response.json()
        except ValueError as exc:
            raise ProcessorFailed(f"invalid JSON (status {response.status_code})") from exc
        if response.status_code != 200:
            error = payload.get("error") if isinstance(payload, dict) else None
            error = error if isinstance(error, dict) else {}
            ids = error.get("ids")
            keys = [str(k) for k in ids] if isinstance(ids, list) else []
            message = f"status {response.status_code}: {error.get('code')}: {error.get('message')}"
            if response.status_code == 422:
                logger.info("Citation service could not render %s", keys or "these items")
            else:
                logger.error("Citation service rejected a request: %s", message)
            raise ProcessorFailed(message, keys)
        if not isinstance(payload, dict):
            raise ProcessorFailed("unexpected response body")
        excluded = payload.get("excluded_ids") or []
        if excluded:
            logger.info("Citation service left out items it cannot render: %s", excluded)
        return payload

    async def citation(self, locale: str, scope: dict[str, dict[str, Any]], key: str) -> Entry:
        """Reference and in-text forms of ``key``, disambiguated against all of ``scope``."""
        payload = await self.render(
            locale,
            [processor_item(csl, k) for k, csl in scope.items()],
            bibliography=[key],
            citations=[(key, "parenthetical"), (key, "narrative")],
        )
        try:
            (reference,) = payload["bibliography"]
            parenthetical, narrative = payload["citations"]
            return Entry(
                key=key,
                reference_html=str(reference["html"]),
                reference_text=str(reference["text"]),
                in_text_parenthetical=str(parenthetical["text"]),
                in_text_narrative=str(narrative["text"]),
            )
        except (KeyError, TypeError, ValueError) as exc:
            raise ProcessorFailed("unexpected response body") from exc

    async def reference_list(
        self, locale: str, items: dict[str, dict[str, Any]]
    ) -> list[Reference]:
        """All of ``items`` as one APA reference list, in the processor's order."""
        payload = await self.render(
            locale, [processor_item(csl, k) for k, csl in items.items()], bibliography="all"
        )
        try:
            references = [
                Reference(key=str(e["id"]), html=str(e["html"]), text=str(e["text"]))
                for e in payload["bibliography"]
            ]
        except (KeyError, TypeError) as exc:
            raise ProcessorFailed("unexpected response body") from exc
        if sorted(r.key for r in references) != sorted(items):
            raise ProcessorFailed("the reference list does not match the items sent")
        return references
