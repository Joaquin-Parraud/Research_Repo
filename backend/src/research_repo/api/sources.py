"""/api/sources: read, edit, move and delete sources, and serve their PDFs."""

import uuid

from fastapi import APIRouter, Request, Response, status

from research_repo.api.deps import CurrentUser, DbSession, Storage
from research_repo.api.file_response import pdf_response
from research_repo.schemas.library import MoveResult, SourceMove, SourceOut, SourceUpdate
from research_repo.services import sources as sources_service

router = APIRouter(prefix="/sources", tags=["sources"])


# Declared before /{source_id} so "move" is never parsed as an id.
@router.post("/move")
async def move_sources(body: SourceMove, user: CurrentUser, db: DbSession) -> MoveResult:
    moved = await sources_service.move_sources(
        db, user_id=user.id, source_ids=body.source_ids, folder_id=body.folder_id
    )
    return MoveResult(moved=moved)


@router.get("/{source_id}")
async def get_source(source_id: uuid.UUID, user: CurrentUser, db: DbSession) -> SourceOut:
    return SourceOut.of(await sources_service.get_source(db, user_id=user.id, source_id=source_id))


@router.patch("/{source_id}")
async def update_source(
    source_id: uuid.UUID, body: SourceUpdate, user: CurrentUser, db: DbSession
) -> SourceOut:
    view = await sources_service.update_source(
        db, user_id=user.id, source_id=source_id, **body.given()
    )
    return SourceOut.of(view)


@router.delete("/{source_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_source(
    source_id: uuid.UUID, user: CurrentUser, db: DbSession, storage: Storage
) -> Response:
    await sources_service.delete_source(db, storage, user_id=user.id, source_id=source_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get(
    "/{source_id}/file",
    response_class=Response,
    responses={
        200: {"content": {"application/pdf": {}}, "description": "The whole PDF"},
        206: {"content": {"application/pdf": {}}, "description": "One byte range"},
        304: {"description": "Not modified (If-None-Match)"},
        416: {"description": "Range not satisfiable"},
    },
)
async def get_source_file(
    source_id: uuid.UUID, request: Request, user: CurrentUser, db: DbSession, storage: Storage
) -> Response:
    file, path = await sources_service.open_source_file(
        db, storage, user_id=user.id, source_id=source_id
    )
    await db.commit()  # read-only; releases the connection before streaming
    return await pdf_response(request, path, sha256=file.sha256, filename=file.original_filename)
