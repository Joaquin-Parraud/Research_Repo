"""Opening untrusted PDF files with pypdf, the way PDF readers do.

* Header. Readers (Acrobat, pdf.js, pypdf) accept ``%PDF-`` anywhere in the first 1024 bytes,
  and files that start with a byte-order mark, blank lines or NUL padding (left by some
  download tools, mail gateways and Windows editors) are common. :func:`header_offset` accepts
  those, but not ``%PDF-`` inside other content such as an HTML page.
* End marker. Without ``%%EOF`` pypdf's recovery reads the whole file (memory ~2x its size), so
  such files are not parsed. The marker is looked for in the last :data:`EOF_SEARCH_BYTES`,
  because downloads padded to a block size or with a proxy's page appended put it well before
  the physical end.
* Encryption. Publisher PDFs are often encrypted with an owner password only (printing or
  copying restricted): the user password is empty and every reader opens them. They are
  decrypted with the empty password; files that need a real password are not readable.
  AES needs pypdf's ``crypto`` extra (``cryptography``).

Everything here is blocking; call it in a worker thread.
"""

import re
from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path
from typing import TYPE_CHECKING, BinaryIO

if TYPE_CHECKING:
    from pypdf import PdfReader

PDF_MAGIC = b"%PDF-"
PDF_EOF = b"%%EOF"
HEADER_SEARCH_BYTES = 1024
EOF_SEARCH_BYTES = 1024 * 1024

# What may come before the header: UTF-8 byte-order marks, whitespace and NUL bytes.
_LEADING = re.compile(rb"(?:\xef\xbb\xbf|[\x00\t\n\x0c\r ])*")


class PdfUnreadable(Exception):
    """pypdf cannot be pointed at this file (see the module docstring for why)."""


def header_offset(head: bytes) -> int | None:
    """Where ``%PDF-`` starts in a file's first bytes, or None if this is not a PDF."""
    leading = _LEADING.match(head, 0, HEADER_SEARCH_BYTES)
    offset = leading.end() if leading else 0
    if head.startswith(PDF_MAGIC, offset) and offset + len(PDF_MAGIC) <= HEADER_SEARCH_BYTES:
        return offset
    return None


def has_eof_marker(fh: BinaryIO) -> bool:
    fh.seek(0, 2)
    size = fh.tell()
    start = max(0, size - EOF_SEARCH_BYTES)
    fh.seek(start)
    found = PDF_EOF in fh.read(size - start)
    fh.seek(0)
    return found


@contextmanager
def open_pdf(path: Path) -> Iterator["PdfReader"]:
    """A lenient reader on an open file (pypdf reads lazily; given a path, it would read the
    whole file into memory). Raises :class:`PdfUnreadable`, or whatever pypdf raises for a
    damaged file (it raises many exception types)."""
    from pypdf import PdfReader  # heavy import, only needed for uploads

    with path.open("rb") as fh:
        if not has_eof_marker(fh):
            raise PdfUnreadable("no end-of-file marker")
        reader = PdfReader(fh, strict=False)
        if reader.is_encrypted and not reader.decrypt(""):
            raise PdfUnreadable("encrypted with a password")
        yield reader
