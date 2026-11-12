"""Content-addressed PDF storage on local disk (SDD §6.1, §7.1 ``file``).

Blobs live at ``<root>/ab/cd/<sha256>.pdf``. New content is first written to a staging file
under ``<root>/.tmp`` (same filesystem, so placing it is an atomic rename) while it is hashed
and its size is checked. All blocking file IO runs in worker threads.

``lock`` serialises every operation that creates or deletes a ``file`` row together with its
blob (database commit included), so an upload reusing a blob can never interleave with the
deletion of that blob. It is an in-process lock, which matches the single-worker deployment.
"""

import asyncio
import hashlib
import logging
import os
import re
import tempfile
import time
from pathlib import Path

logger = logging.getLogger(__name__)

_SHA256_RE = re.compile(r"^[0-9a-f]{64}$")
_TEMP_DIR = ".tmp"
_STALE_TEMP_SECONDS = 3600


class UploadTooLarge(Exception):
    """Raised by ``StagedFile.write`` when the configured size limit is exceeded."""


class StagedFile:
    """A temporary file being filled with upload data, hashed and size-checked as it grows.

    Always call ``discard()`` when done (it is a no-op once the file has been placed).
    """

    def __init__(self, path: Path, max_bytes: int, original_filename: str) -> None:
        self.path = path
        self.max_bytes = max_bytes
        self.original_filename = original_filename
        self.size = 0
        self.head = b""  # first bytes, for the magic-number check
        self._hash = hashlib.sha256()
        self._fh = path.open("wb")  # created by mkstemp; opening an existing file is instant

    @property
    def sha256(self) -> str:
        return self._hash.hexdigest()

    async def write(self, data: bytes) -> None:
        if not data:
            return
        self.size += len(data)
        if self.size > self.max_bytes:
            raise UploadTooLarge
        if len(self.head) < 1024:
            self.head = (self.head + data)[:1024]
        self._hash.update(data)
        await asyncio.to_thread(self._fh.write, data)

    async def finish(self) -> None:
        """Flush and fsync, so a later rename publishes complete content."""
        await asyncio.to_thread(self._finish_sync)

    def _finish_sync(self) -> None:
        if not self._fh.closed:
            self._fh.flush()
            os.fsync(self._fh.fileno())
            self._fh.close()

    async def discard(self) -> None:
        await asyncio.to_thread(self._discard_sync)

    def _discard_sync(self) -> None:
        if not self._fh.closed:
            self._fh.close()
        self.path.unlink(missing_ok=True)


class FileStorage:
    def __init__(self, root: Path) -> None:
        self.root = root
        self.lock = asyncio.Lock()

    @property
    def temp_dir(self) -> Path:
        return self.root / _TEMP_DIR

    def prepare(self) -> None:
        """Create the directories and remove staging files left behind by a crash."""
        self.temp_dir.mkdir(parents=True, exist_ok=True)
        cutoff = time.time() - _STALE_TEMP_SECONDS
        for entry in self.temp_dir.iterdir():
            try:
                if entry.is_file() and entry.stat().st_mtime < cutoff:
                    entry.unlink()
            except OSError:
                logger.warning("Could not remove stale staging file %s", entry)

    def blob_path(self, sha256: str) -> Path:
        if not _SHA256_RE.match(sha256):
            raise ValueError("not a sha256 hex digest")
        return self.root / sha256[:2] / sha256[2:4] / f"{sha256}.pdf"

    async def stage(self, *, max_bytes: int, original_filename: str) -> StagedFile:
        def _create() -> Path:
            self.temp_dir.mkdir(parents=True, exist_ok=True)
            fd, name = tempfile.mkstemp(dir=self.temp_dir, suffix=".upload")
            os.close(fd)
            return Path(name)

        path = await asyncio.to_thread(_create)
        try:
            return StagedFile(path, max_bytes, original_filename)
        except BaseException:
            path.unlink(missing_ok=True)
            raise

    async def place(self, staged: StagedFile) -> None:
        """Move a finished staging file to its content address (atomic; idempotent)."""
        target = self.blob_path(staged.sha256)

        def _place() -> None:
            target.parent.mkdir(parents=True, exist_ok=True)
            os.replace(staged.path, target)

        await asyncio.to_thread(_place)

    async def remove(self, sha256: str) -> None:
        """Delete a blob. Failures are logged, never raised: the database is already final."""
        path = self.blob_path(sha256)
        try:
            await asyncio.to_thread(path.unlink, missing_ok=True)
        except OSError:
            logger.exception("Could not delete stored file %s", path)
