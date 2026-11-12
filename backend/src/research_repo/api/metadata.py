"""/api/metadata (DOI lookup) and /api/config (settings the client needs)."""

from fastapi import APIRouter

from research_repo.api.deps import AppSettings, CurrentUser, Lookup
from research_repo.schemas.citations import ConfigOut, DoiLookupIn, DoiLookupOut

router = APIRouter(tags=["metadata"])


@router.post("/metadata/lookup")
async def lookup_doi(body: DoiLookupIn, _: CurrentUser, lookup: Lookup) -> DoiLookupOut:
    """CSL-JSON for a DOI (``10.x/…``, ``doi:…`` or ``https://doi.org/…``) from Crossref."""
    return DoiLookupOut(csl=await lookup.lookup_doi(body.doi))


@router.get("/config")
async def config(_: CurrentUser, settings: AppSettings) -> ConfigOut:
    return ConfigOut(
        max_upload_mb=settings.max_upload_mb,
        metadata_lookup_enabled=settings.metadata_lookup_enabled,
    )
