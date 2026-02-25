"""map1 — MAP v1.1 Python implementation.

Compute deterministic identifiers (MIDs) for structured descriptors
using the MAP v1 canonical format.

Quick start:
    >>> from map1 import mid_full
    >>> mid_full({"action": "deploy", "target": "prod", "version": "2.1.0"})
    'map1:02f660092e372c2da0f87cefdecd1de9476eba39be2222b30637ba72178c5e7e'

v1.1 adds BOOLEAN and INTEGER types.  Booleans and integers are now
distinct from their string representations:
    >>> mid_full({"active": True}) != mid_full({"active": "true"})
    True
"""

from __future__ import annotations

from typing import Any, Dict, List, Optional

from ._constants import CANON_HDR, INT64_MAX, INT64_MIN
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

__version__ = "1.1.0"

__all__ = [
    # Public API functions
    "mid_full",
    "mid_bind",
    "canonical_bytes_full",
    "canonical_bytes_bind",
    "mid_full_json",
    "mid_bind_json",
    "mid_from_canon_bytes",
    "prepare",
    # Exception
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


# ── Core API ──────────────────────────────────────────────────

def mid_full(descriptor: Any) -> str:
    """Compute a MID over the full descriptor (FULL projection).

    Accepts any canonical-model value: dict, list, str, bytes, bool, int.
    Keys must be strings.  Booleans encode as BOOLEAN, integers as INTEGER.
    """
    val = full_project(descriptor)
    return mid_from_value(val)


def mid_bind(descriptor: dict, pointers: List[str]) -> str:
    """Compute a MID over selected fields (BIND projection).

    Pointers are RFC 6901 JSON Pointer strings (e.g., "/action", "/config/port").
    """
    val = bind_project(descriptor, pointers)
    return mid_from_value(val)


def canonical_bytes_full(descriptor: Any) -> bytes:
    """Return CANON_BYTES (header + MCF) for the full descriptor."""
    val = full_project(descriptor)
    return canon_bytes_from_value(val)


def canonical_bytes_bind(descriptor: dict, pointers: List[str]) -> bytes:
    """Return CANON_BYTES for selected fields (BIND projection)."""
    val = bind_project(descriptor, pointers)
    return canon_bytes_from_value(val)


# ── JSON-STRICT API ───────────────────────────────────────────
# These functions take raw UTF-8 bytes and run them through the full
# JSON-STRICT adapter pipeline: BOM rejection, surrogate detection,
# duplicate-key detection, type mapping.

def mid_full_json(raw: bytes) -> str:
    """Compute a MID from raw UTF-8 JSON bytes (JSON-STRICT + FULL)."""
    obj, dup_found = json_strict_parse_with_dups(raw)
    val = json_to_canon_value(obj)
    canon = canon_bytes_from_value(val)
    # Raise dup_key only if no higher-precedence error already fired.
    # If we got this far, the only deferred error is duplicate keys.
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


# ── Convenience: prepare() ────────────────────────────────────

def prepare(descriptor: Dict[str, Any], *,
            float_precision: int = 6,
            omit_none: bool = True) -> Dict[str, Any]:
    """Normalize a Python dict for MID computation.

    This is a convenience function for application code that doesn't want
    to manually pre-process every descriptor.  It handles the common cases
    where Python's native types don't map cleanly to MAP's canonical model:

      - float → string with explicit precision (MAP rejects floats)
      - None  → omitted (MAP rejects null; omit_none=False raises instead)
      - int   → range-checked against INT64 bounds
      - bool  → passed through (BOOLEAN type in v1.1)
      - str   → passed through
      - dict  → recursively prepared
      - list  → recursively prepared

    This function does NOT compute a MID.  Feed the result to mid_full().

    Example:
        >>> raw = {"temp": 98.6, "active": True, "notes": None, "retries": 3}
        >>> prepared = prepare(raw)
        >>> prepared
        {'temp': '98.600000', 'active': True, 'retries': 3}
        >>> mid_full(prepared)
        'map1:...'
    """
    return _prepare_value(descriptor, float_precision, omit_none)


def _prepare_value(val: Any, fp: int, omit_none: bool) -> Any:
    if isinstance(val, dict):
        out: Dict[str, Any] = {}
        for k, v in val.items():
            if not isinstance(k, str):
                raise MapError(ERR_SCHEMA, "prepare: key must be string")
            if v is None:
                if omit_none:
                    continue
                raise MapError(ERR_TYPE, "prepare: null value for key '{}'".format(k))
            out[k] = _prepare_value(v, fp, omit_none)
        return out

    if isinstance(val, list):
        result = []
        for item in val:
            if item is None and omit_none:
                continue  # skip None in lists when omit_none is on
            result.append(_prepare_value(item, fp, omit_none))
        return result

    # bool before int (same Python subclass trap as everywhere else)
    if isinstance(val, bool):
        return val

    if isinstance(val, int):
        if val < INT64_MIN or val > INT64_MAX:
            raise MapError(ERR_TYPE,
                           "prepare: integer {} outside int64 range".format(val))
        return val

    if isinstance(val, float):
        # Encode as string with requested precision.
        # This is the recommended approach from the spec for float data.
        return "{:.{}f}".format(val, fp)

    if isinstance(val, str):
        return val

    if isinstance(val, bytes):
        return val

    raise MapError(ERR_SCHEMA,
                   "prepare: unsupported type {}".format(type(val).__name__))
