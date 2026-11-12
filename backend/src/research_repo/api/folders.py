"""/api/folders: rename, move, reorder and delete folders."""

import uuid

from fastapi import APIRouter, Response, status

from research_repo.api.deps import CurrentUser, DbSession
from research_repo.schemas.library import FolderOut, FolderUpdate
from research_repo.services import folders as folders_service

router = APIRouter(prefix="/folders", tags=["folders"])


@router.patch("/{folder_id}")
async def update_folder(
    folder_id: uuid.UUID, body: FolderUpdate, user: CurrentUser, db: DbSession
) -> FolderOut:
    folder = await folders_service.update_folder(
        db, user_id=user.id, folder_id=folder_id, **body.given()
    )
    return FolderOut.model_validate(folder)


@router.delete("/{folder_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_folder(folder_id: uuid.UUID, user: CurrentUser, db: DbSession) -> Response:
    await folders_service.delete_folder(db, user_id=user.id, folder_id=folder_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
