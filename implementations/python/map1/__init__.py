"""map1 — MAP v1 Python implementation.

Compute deterministic identifiers (MIDs) for structured descriptors
using the MAP v1 canonical format.
"""

from __future__ import annotations

from typing import List

from ._constants import CANON_HDR
from ._core import (
    canon_bytes_from_value,
    mid_from_canon_bytes,
    mid_from_value,
    _sha256_hex,
)
from ._errors import (
    ERR_CANON_HDR,
    ERR_CANON_MCF,
    ERR_DUP_KEY,
    ERR_KEY_ORDER,
    ERR_LIMIT_DEPTH,
    ERR_LIMIT_SIZE,
    ERR_SCHEMA,
    ERR_TYPE,
    ERR_UTF8,
    MapError,
    choose_reported_error,
)
from ._json_adapter import (
    json_strict_parse_with_dups,
    json_to_canon_value,
)
from ._projection import bind_project, full_project

__version__ = "1.0.0"

__all__ = [
    # Functions
    "mid_full",
    "mid_bind",
    "canonical_bytes_full",
    "canonical_bytes_bind",
    "mid_full_json",
    "mid_bind_json",
    "mid_from_canon_bytes",
    # Classes / exceptions
    "MapError",
    # Error codes
    "ERR_CANON_HDR",
    "ERR_CANON_MCF",
    "ERR_SCHEMA",
    "ERR_TYPE",
    "ERR_UTF8",
    "ERR_DUP_KEY",
    "ERR_KEY_ORDER",
    "ERR_LIMIT_DEPTH",
    "ERR_LIMIT_SIZE",
]


# ── Public API ──────────────────────────────────────────────


def mid_full(descriptor: dict) -> str:
    """Compute a MID over the full descriptor (FULL projection)."""
    val = full_project(descriptor)
    return mid_from_value(val)


def mid_bind(descriptor: dict, pointers: List[str]) -> str:
    """Compute a MID over selected fields (BIND projection)."""
    val = bind_project(descriptor, pointers)
    return mid_from_value(val)


def canonical_bytes_full(descriptor: dict) -> bytes:
    """Return CANON_BYTES for the full descriptor."""
    val = full_project(descriptor)
    return canon_bytes_from_value(val)


def canonical_bytes_bind(descriptor: dict, pointers: List[str]) -> bytes:
    """Return CANON_BYTES for selected fields (BIND projection)."""
    val = bind_project(descriptor, pointers)
    return canon_bytes_from_value(val)


def mid_full_json(raw: bytes) -> str:
    """Compute a MID from raw UTF-8 JSON bytes (JSON-STRICT + FULL)."""
    obj, dup_found = json_strict_parse_with_dups(raw)
    val = json_to_canon_value(obj)
    canon = canon_bytes_from_value(val)
    if dup_found:
        raise MapError(ERR_DUP_KEY, "duplicate key in JSON")
    return "map1:" + _sha256_hex(canon)


def mid_bind_json(raw: bytes, pointers: List[str]) -> str:
    """Compute a MID from raw UTF-8 JSON bytes (JSON-STRICT + BIND)."""
    obj, dup_found = json_strict_parse_with_dups(raw)
    val = json_to_canon_value(obj)
    proj = bind_project(val, pointers)
    canon = canon_bytes_from_value(proj)
    if dup_found:
        raise MapError(ERR_DUP_KEY, "duplicate key in JSON")
    return "map1:" + _sha256_hex(canon)
