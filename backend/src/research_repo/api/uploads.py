"""Streaming ``multipart/form-data`` reader for source uploads.

The body is parsed as it arrives: the ``file`` part goes straight into a storage staging
file (hashed and size-checked on the way, see ``core/storage.py``), so an upload is never
held in memory and an oversized one is rejected as soon as it crosses the limit.
"""

import re
from dataclasses import dataclass, field

from fastapi import Request
from python_multipart.exceptions import MultipartParseError
from python_multipart.multipart import MultipartParser, parse_options_header

from research_repo.core.errors import ValidationFailed
from research_repo.core.storage import FileStorage, StagedFile, UploadTooLarge
from research_repo.services.sources import FileTooLarge

FILE_FIELD = "file"
TEXT_FIELDS = frozenset({"folder_id", "title", "allow_duplicate"})
_MAX_TEXT_FIELD_BYTES = 16 * 1024
_MAX_PARTS = 16
# Allowance for multipart framing and the text fields on top of the file itself.
_ENVELOPE_BYTES = 1024 * 1024


@dataclass
class _Part:
    headers: dict[str, bytes] = field(default_factory=dict)
    name: str = ""
    filename: str | None = None
    text: bytearray = field(default_factory=bytearray)


@dataclass
class SourceUpload:
    fields: dict[str, str]
    file: StagedFile | None


def _decode(value: bytes) -> str:
    try:
        return value.decode()
    except UnicodeDecodeError:
        return value.decode("latin-1")


_HTML_FORM_ESCAPES = re.compile(r"%(22|0D|0A)", re.IGNORECASE)


def _unescape_filename(filename: str) -> str:
    """Undo the escaping browsers apply to filenames in form data (HTML: '"', CR, LF)."""
    return _HTML_FORM_ESCAPES.sub(lambda m: chr(int(m.group(1), 16)), filename)


class _Reader:
    """Collects parser events; file bytes are buffered per network chunk, then written."""

    def __init__(self) -> None:
        self.parts: list[_Part] = []
        self.current: _Part | None = None
        self.header_field = bytearray()
        self.header_value = bytearray()
        self.pending: list[tuple[_Part, bytes]] = []
        self.finished = False

    def callbacks(self) -> dict[str, object]:
        return {
            "on_part_begin": self.on_part_begin,
            "on_header_field": self.on_header_field,
            "on_header_value": self.on_header_value,
            "on_header_end": self.on_header_end,
            "on_headers_finished": self.on_headers_finished,
            "on_part_data": self.on_part_data,
            "on_end": self.on_end,
        }

    def on_part_begin(self) -> None:
        if len(self.parts) >= _MAX_PARTS:
            raise ValidationFailed("Too many form fields.")
        self.current = _Part()
        self.parts.append(self.current)

    def on_header_field(self, data: bytes, start: int, end: int) -> None:
        self.header_field += data[start:end]

    def on_header_value(self, data: bytes, start: int, end: int) -> None:
        self.header_value += data[start:end]

    def on_header_end(self) -> None:
        assert self.current is not None
        self.current.headers[bytes(self.header_field).decode("latin-1").lower()] = bytes(
            self.header_value
        )
        self.header_field.clear()
        self.header_value.clear()

    def on_headers_finished(self) -> None:
        part = self.current
        assert part is not None
        _, options = parse_options_header(part.headers.get("content-disposition", b""))
        part.name = _decode(options.get(b"name", b""))
        if b"filename" in options:
            part.filename = _unescape_filename(_decode(options[b"filename"]))
        if part.name != FILE_FIELD and (part.name not in TEXT_FIELDS or part.filename is not None):
            raise ValidationFailed(f"Unexpected form field {part.name!r}.")
        if sum(p.name == part.name for p in self.parts) > 1:
            raise ValidationFailed(f"The form field {part.name!r} appears more than once.")

    def on_part_data(self, data: bytes, start: int, end: int) -> None:
        part = self.current
        assert part is not None
        chunk = data[start:end]
        if part.name == FILE_FIELD:
            self.pending.append((part, chunk))
        else:
            part.text += chunk
            if len(part.text) > _MAX_TEXT_FIELD_BYTES:
                raise ValidationFailed(f"The form field {part.name!r} is too long.")

    def on_end(self) -> None:
        self.finished = True


async def read_source_upload(
    request: Request, storage: FileStorage, *, max_bytes: int
) -> SourceUpload:
    """Parse the form. On error nothing is left behind; on success the caller owns
    ``file`` and must ``discard()`` it.
    """
    content_type, params = parse_options_header(request.headers.get("content-type"))
    boundary = params.get(b"boundary")
    if content_type != b"multipart/form-data" or not boundary:
        raise ValidationFailed("Expected a multipart/form-data body.")
    declared = request.headers.get("content-length")
    if declared and declared.isdigit() and int(declared) > max_bytes + _ENVELOPE_BYTES:
        raise FileTooLarge

    reader = _Reader()
    parser = MultipartParser(boundary, reader.callbacks())  # type: ignore[arg-type]
    staged: StagedFile | None = None
    try:
        async for chunk in request.stream():
            try:
                parser.write(chunk)
            except MultipartParseError as exc:
                raise ValidationFailed("The form data is malformed.") from exc
            for part, data in reader.pending:
                if staged is None:
                    staged = await storage.stage(
                        max_bytes=max_bytes, original_filename=part.filename or ""
                    )
                await staged.write(data)
            reader.pending.clear()
        parser.finalize()
        if not reader.finished:
            raise ValidationFailed("The form data is incomplete.")

        file_part = next((p for p in reader.parts if p.name == FILE_FIELD), None)
        # An empty, unnamed file part is what a browser sends when no file was chosen; an
        # empty file with a name is kept, so that it is rejected as an invalid PDF.
        if file_part is not None and staged is None and file_part.filename:
            staged = await storage.stage(max_bytes=max_bytes, original_filename=file_part.filename)
        if staged is not None:
            await staged.finish()
        fields = {p.name: _decode(bytes(p.text)) for p in reader.parts if p.name in TEXT_FIELDS}
        return SourceUpload(fields=fields, file=staged)
    except UploadTooLarge:
        if staged is not None:
            await staged.discard()
        raise FileTooLarge from None
    except BaseException:
        if staged is not None:
            await staged.discard()
        raise
