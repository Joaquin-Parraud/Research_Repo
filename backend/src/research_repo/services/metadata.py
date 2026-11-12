"""Metadata suggestions (FR-S2, FR-S3): DOI → Crossref, else the PDF's embedded metadata.

One :class:`MetadataLookup` lives on the application. Suggestions never raise: a failed or
slow lookup simply yields less. The whole run (PDF inspection in a worker thread, then at most
one Crossref request) is bounded by ``METADATA_LOOKUP_TIMEOUT_SECONDS``; a PDF inspection still
running when the budget ends finishes in its thread, but nobody waits for it.
"""

import asyncio
import logging
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Literal

import httpx

from research_repo.citations import crossref, pdfmeta
from research_repo.citations.csl import InvalidCsl, normalize_doi, validate_csl
from research_repo.core.config import Settings
from research_repo.core.errors import AppError

logger = logging.getLogger(__name__)

Origin = Literal["doi", "pdf", "none"]


class InvalidDoi(AppError):
    status_code = 422
    code = "metadata.invalid_doi"
    message = "This is not a valid DOI."


class DoiNotFound(AppError):
    status_code = 404
    code = "metadata.doi_not_found"
    message = "No record was found for this DOI."


class LookupFailed(AppError):
    status_code = 502
    code = "metadata.lookup_failed"
    message = "The metadata lookup failed. Try again later."


class LookupDisabled(AppError):
    status_code = 503
    code = "metadata.lookup_disabled"
    message = "Online metadata lookups are turned off on this server."


@dataclass(frozen=True)
class Suggestion:
    csl: dict[str, Any] | None
    origin: Origin
    doi: str | None


NO_SUGGESTION = Suggestion(csl=None, origin="none", doi=None)


class MetadataLookup:
    def __init__(
        self, settings: Settings, *, transport: httpx.AsyncBaseTransport | None = None
    ) -> None:
        self.enabled = settings.metadata_lookup_enabled
        self.timeout = settings.metadata_lookup_timeout_seconds
        self.crossref = crossref.CrossrefClient(
            mailto=settings.crossref_mailto or None, transport=transport
        )

    async def lookup_doi(self, value: str) -> dict[str, Any]:
        """CSL for a DOI given as ``10.x/…``, ``doi:…`` or a doi.org URL."""
        doi = normalize_doi(value)
        if doi is None:
            raise InvalidDoi
        if not self.enabled:
            raise LookupDisabled
        try:
            async with asyncio.timeout(self.timeout):
                message = await self.crossref.work(doi, timeout=self.timeout)
        except crossref.CrossrefNotFound:
            raise DoiNotFound from None
        except (crossref.CrossrefError, TimeoutError) as exc:
            logger.info("Crossref lookup for %s failed: %s", doi, exc)
            raise LookupFailed from None
        try:
            return crossref.to_csl(message)
        except InvalidCsl:
            raise LookupFailed from None

    async def suggest(self, path: Path) -> Suggestion:
        """The suggestion for a stored PDF. Never raises."""
        deadline = time.monotonic() + self.timeout
        try:
            async with asyncio.timeout(self.timeout):
                facts = await asyncio.to_thread(pdfmeta.inspect_pdf, path)
        except TimeoutError:
            logger.info("PDF inspection of %s ran out of time", path.name)
            return NO_SUGGESTION
        except Exception:
            logger.exception("PDF inspection of %s failed", path.name)
            return NO_SUGGESTION

        if facts.doi and self.enabled:
            remaining = deadline - time.monotonic()
            if remaining > 0.05:
                try:
                    async with asyncio.timeout(remaining):
                        message = await self.crossref.work(facts.doi, timeout=remaining)
                    return Suggestion(csl=crossref.to_csl(message), origin="doi", doi=facts.doi)
                except (crossref.CrossrefNotFound, crossref.CrossrefError, TimeoutError) as exc:
                    logger.info("Crossref lookup for %s failed: %r", facts.doi, exc)
                except InvalidCsl:
                    logger.info("Crossref record for %s is unusable", facts.doi)
                except Exception:
                    logger.exception("Crossref lookup for %s failed", facts.doi)

        embedded = pdfmeta.embedded_csl(facts)
        if embedded is not None:
            try:
                return Suggestion(csl=validate_csl(embedded), origin="pdf", doi=facts.doi)
            except InvalidCsl:
                pass
        return Suggestion(csl=None, origin="none", doi=facts.doi)
