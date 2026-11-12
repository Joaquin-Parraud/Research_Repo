"""Request and response bodies for authentication and the current user."""

import uuid
from typing import Annotated, Literal, Self

from pydantic import BaseModel, ConfigDict, Field, StringConstraints, model_validator

Language = Literal["en", "es"]
DisplayName = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=200)]


class LoginRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    email: Annotated[str, StringConstraints(strip_whitespace=True, max_length=320)]
    password: Annotated[str, Field(max_length=1024)]


class UserOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    email: str
    display_name: str
    language: Language


class UserUpdate(BaseModel):
    """Partial update: omitted fields are left unchanged; explicit nulls are rejected."""

    model_config = ConfigDict(extra="forbid")

    language: Language | None = None
    display_name: DisplayName | None = None

    @model_validator(mode="after")
    def _reject_nulls(self) -> Self:
        for name in self.model_fields_set:
            if getattr(self, name) is None:
                raise ValueError(f"{name} cannot be null")
        return self
