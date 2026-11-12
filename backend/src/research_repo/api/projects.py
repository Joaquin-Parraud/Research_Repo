"""/api/projects: projects, their README, folder tree, and the folders/sources they contain."""

import uuid

from fastapi import APIRouter, Request, Response, status

from research_repo.api.deps import AppSettings, CurrentUser, DbSession, Storage
from research_repo.api.uploads import read_source_upload
from research_repo.core.errors import ValidationFailed
from research_repo.schemas.library import (
    FolderCreate,
    FolderOut,
    ProjectCreate,
    ProjectOut,
    ProjectUpdate,
    ReadmeIn,
    ReadmeOut,
    SourceOut,
    TreeOut,
)
from research_repo.services import folders as folders_service
from research_repo.services import projects as projects_service
from research_repo.services import sources as sources_service
from research_repo.services.tree import get_tree

router = APIRouter(prefix="/projects", tags=["projects"])


@router.get("")
async def list_projects(
    user: CurrentUser, db: DbSession, include_archived: bool = False
) -> list[ProjectOut]:
    views = await projects_service.list_projects(
        db, user_id=user.id, include_archived=include_archived
    )
    return [ProjectOut.of(v) for v in views]


@router.post("", status_code=status.HTTP_201_CREATED)
async def create_project(body: ProjectCreate, user: CurrentUser, db: DbSession) -> ProjectOut:
    view = await projects_service.create_project(
        db, user_id=user.id, name=body.name, description=body.description
    )
    return ProjectOut.of(view)


@router.get("/{project_id}")
async def get_project(project_id: uuid.UUID, user: CurrentUser, db: DbSession) -> ProjectOut:
    return ProjectOut.of(
        await projects_service.get_project(db, user_id=user.id, project_id=project_id)
    )


@router.patch("/{project_id}")
async def update_project(
    project_id: uuid.UUID, body: ProjectUpdate, user: CurrentUser, db: DbSession
) -> ProjectOut:
    view = await projects_service.update_project(
        db, user_id=user.id, project_id=project_id, **body.given()
    )
    return ProjectOut.of(view)


@router.delete("/{project_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_project(
    project_id: uuid.UUID, user: CurrentUser, db: DbSession, storage: Storage
) -> Response:
    await projects_service.delete_project(db, storage, user_id=user.id, project_id=project_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/{project_id}/readme")
async def get_readme(project_id: uuid.UUID, user: CurrentUser, db: DbSession) -> ReadmeOut:
    return ReadmeOut.of(
        await projects_service.get_readme(db, user_id=user.id, project_id=project_id)
    )


@router.put("/{project_id}/readme")
async def put_readme(
    project_id: uuid.UUID, body: ReadmeIn, user: CurrentUser, db: DbSession
) -> ReadmeOut:
    readme = await projects_service.put_readme(
        db, user_id=user.id, project_id=project_id, readme_md=body.readme_md
    )
    return ReadmeOut.of(readme)


@router.get("/{project_id}/tree")
async def tree(project_id: uuid.UUID, user: CurrentUser, db: DbSession) -> TreeOut:
    return TreeOut.of(await get_tree(db, user_id=user.id, project_id=project_id))


@router.post("/{project_id}/folders", status_code=status.HTTP_201_CREATED)
async def create_folder(
    project_id: uuid.UUID, body: FolderCreate, user: CurrentUser, db: DbSession
) -> FolderOut:
    folder = await folders_service.create_folder(
        db, user_id=user.id, project_id=project_id, name=body.name, parent_id=body.parent_id
    )
    return FolderOut.model_validate(folder)


def _optional_uuid(value: str | None, field: str) -> uuid.UUID | None:
    if value is None or not value.strip():
        return None
    try:
        return uuid.UUID(value.strip())
    except ValueError:
        raise ValidationFailed(f"{field} is not a valid id.") from None


@router.post(
    "/{project_id}/sources",
    status_code=status.HTTP_201_CREATED,
    openapi_extra={
        "requestBody": {
            "required": True,
            "content": {
                "multipart/form-data": {
                    "schema": {
                        "type": "object",
                        "properties": {
                            "file": {"type": "string", "format": "binary"},
                            "folder_id": {"type": "string", "format": "uuid"},
                            "title": {"type": "string"},
                            "allow_duplicate": {"type": "string", "enum": ["true", "false"]},
                        },
                    }
                }
            },
        }
    },
)
async def create_source(
    project_id: uuid.UUID,
    request: Request,
    user: CurrentUser,
    db: DbSession,
    storage: Storage,
    settings: AppSettings,
) -> SourceOut:
    """Multipart form: ``file`` (PDF, optional), ``folder_id``, ``title`` (required without a
    file), ``allow_duplicate`` ("true" to add a file already in this project). The body is
    streamed to disk, never buffered in memory.
    """
    await sources_service.ensure_can_add_sources(db, user_id=user.id, project_id=project_id)
    upload = await read_source_upload(request, storage, max_bytes=settings.max_upload_bytes)
    try:
        view = await sources_service.create_source(
            db,
            storage,
            user_id=user.id,
            project_id=project_id,
            title=upload.fields.get("title"),
            folder_id=_optional_uuid(upload.fields.get("folder_id"), "folder_id"),
            staged=upload.file,
            allow_duplicate=upload.fields.get("allow_duplicate", "").strip().lower() == "true",
        )
    finally:
        if upload.file is not None:
            await upload.file.discard()
    return SourceOut.of(view)
