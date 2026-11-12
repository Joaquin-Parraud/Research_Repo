"""PDF responses with single-range support (RFC 9110 §14), streamed from a worker thread."""

import asyncio
import os
import re
from collections.abc import AsyncIterator
from pathlib import Path
from urllib.parse import quote

from fastapi import Request
from fastapi.responses import Response, StreamingResponse

from research_repo.core.errors import AppError

CHUNK_SIZE = 256 * 1024
_RANGE_RE = re.compile(r"^bytes=(\d*)-(\d*)$")
_UNSAFE_ASCII = re.compile(r"[^A-Za-z0-9 !#$&+,.;=@^_`~()\[\]{}\'-]")


class RangeNotSatisfiable(AppError):
    status_code = 416
    code = "source.range_not_satisfiable"
    message = "The requested byte range is not available."


def content_disposition(filename: str) -> str:
    """``inline`` with an ASCII fallback name and the exact name in RFC 5987 form."""
    fallback = _UNSAFE_ASCII.sub("_", filename).strip() or "document.pdf"
    return f"inline; filename=\"{fallback}\"; filename*=UTF-8''{quote(filename, safe='')}"


def parse_range(header: str | None, size: int) -> tuple[int, int] | None:
    """Inclusive (start, end) for a satisfiable single range; None to send the whole file.

    Raises RangeNotSatisfiable for a well-formed range outside the file. Malformed headers
    and multi-range requests are ignored (the full file is sent, as RFC 9110 allows).
    """
    if not header:
        return None
    match = _RANGE_RE.match(header.strip())
    if match is None:
        return None
    first, last = match.groups()
    if not first and not last:
        return None
    if not first:  # suffix range: the last N bytes
        length = int(last)
        if length == 0 or size == 0:
            raise RangeNotSatisfiable
        return max(0, size - length), size - 1
    start = int(first)
    if last and int(last) < start:
        return None  # syntactically invalid: ignore
    if start >= size:
        raise RangeNotSatisfiable
    end = int(last) if last else size - 1
    return start, min(end, size - 1)


async def _read_file(path: Path, start: int, length: int) -> AsyncIterator[bytes]:
    fh = await asyncio.to_thread(path.open, "rb")
    try:
        await asyncio.to_thread(fh.seek, start)
        remaining = length
        while remaining > 0:
            chunk = await asyncio.to_thread(fh.read, min(CHUNK_SIZE, remaining))
            if not chunk:
                break
            remaining -= len(chunk)
            yield chunk
    finally:
        await asyncio.to_thread(fh.close)


def _etag_matches(header: str | None, etag: str) -> bool:
    if not header:
        return False
    candidates = {c.strip().removeprefix("W/") for c in header.split(",")}
    return "*" in candidates or etag in candidates


async def pdf_response(request: Request, path: Path, *, sha256: str, filename: str) -> Response:
    try:
        size = (await asyncio.to_thread(os.stat, path)).st_size
    except FileNotFoundError as exc:
        raise RuntimeError(f"stored file missing: {path}") from exc

    etag = f'"{sha256}"'
    headers = {
        "Accept-Ranges": "bytes",
        "ETag": etag,
        "Cache-Control": "private",
        "Content-Disposition": content_disposition(filename),
        "X-Content-Type-Options": "nosniff",
    }
    if _etag_matches(request.headers.get("if-none-match"), etag):
        return Response(status_code=304, headers=headers)

    range_header = request.headers.get("range")
    if_range = request.headers.get("if-range")
    if if_range is not None and if_range.strip() != etag:
        range_header = None  # the client's copy is stale: send everything
    try:
        byte_range = parse_range(range_header, size)
    except RangeNotSatisfiable as exc:
        exc.headers = {**headers, "Content-Range": f"bytes */{size}"}
        raise

    if byte_range is None:
        start, length, status = 0, size, 200
    else:
        start, end = byte_range
        length, status = end - start + 1, 206
        headers["Content-Range"] = f"bytes {start}-{end}/{size}"
    headers["Content-Length"] = str(length)
    return StreamingResponse(
        _read_file(path, start, length),
        status_code=status,
        media_type="application/pdf",
        headers=headers,
    )
