"""MAP v1 JSON-STRICT adapter.

Converts raw UTF-8 JSON bytes into the canonical model, enforcing:
  - BOM rejection
  - Strict UTF-8 decode
  - Surrogate rejection in string values/keys
  - Duplicate key detection (after JSON escape resolution)
  - Boolean → STRING mapping ("true" / "false")
  - null → ERR_TYPE
  - number → ERR_TYPE
  - Error precedence: higher-precedence errors override ERR_DUP_KEY
"""

from __future__ import annotations

import json
import re
from typing import Any, Tuple

from ._constants import MAX_CANON_BYTES, MAX_DEPTH
from ._errors import (
    ERR_CANON_MCF,
    ERR_DUP_KEY,
    ERR_LIMIT_DEPTH,
    ERR_LIMIT_SIZE,
    ERR_SCHEMA,
    ERR_TYPE,
    ERR_UTF8,
    MapError,
)

_WS = re.compile(rb"^[\x20\x09\x0A\x0D]*")


def _ensure_no_surrogates(s: str) -> None:
    for ch in s:
        cp = ord(ch)
        if 0xD800 <= cp <= 0xDFFF:
            raise MapError(ERR_UTF8, "surrogate code-point in JSON string")


# ── JSON parse with duplicate detection ─────────────────────

def json_strict_parse_with_dups(raw: bytes) -> Tuple[Any, bool]:
    """Parse raw JSON bytes under JSON-STRICT rules.

    Returns ``(parsed_object, dup_found)`` where *dup_found* is True if
    any object had duplicate keys (after escape resolution).

    IMPORTANT: duplicate detection does NOT short-circuit.  The flag is
    recorded and parsing continues so that higher-precedence errors
    (e.g. ERR_TYPE from null/number) can surface.
    """
    if len(raw) > MAX_CANON_BYTES:
        raise MapError(ERR_LIMIT_SIZE, "input exceeds MAX_CANON_BYTES")

    # BOM rejection (skip leading JSON whitespace first)
    m = _WS.match(raw)
    start = m.end() if m else 0
    if raw[start:start + 3] == b"\xef\xbb\xbf":
        raise MapError(ERR_SCHEMA, "BOM rejected")

    # Strict UTF-8 decode
    try:
        text = raw.decode("utf-8")
    except UnicodeDecodeError:
        raise MapError(ERR_UTF8, "invalid UTF-8 in JSON text")

    dup_found = False

    def object_pairs_hook(pairs: list) -> dict:
        nonlocal dup_found
        seen: set = set()
        d: dict = {}
        for k, v in pairs:
            if not isinstance(k, str):
                raise MapError(ERR_SCHEMA, "JSON key is not a string")
            _ensure_no_surrogates(k)
            if k in seen:
                dup_found = True
                # Keep first occurrence for determinism; skip later ones.
                continue
            seen.add(k)
            d[k] = v
        return d

    try:
        obj = json.loads(
            text,
            object_pairs_hook=object_pairs_hook,
            parse_constant=lambda c: (_ for _ in ()).throw(
                MapError(ERR_CANON_MCF, "JSON constant (Infinity/NaN)")
            ),
        )
        return obj, dup_found
    except MapError:
        raise
    except json.JSONDecodeError:
        raise MapError(ERR_CANON_MCF, "JSON parse error")


# ── JSON → canonical model value ────────────────────────────

def json_to_canon_value(x: Any, depth: int = 1) -> Any:
    """Convert a parsed JSON value to the MAP canonical model.

    Depth model for JSON adapter:
      - The root container starts at depth=1 (the root MAP/LIST is
        already at nesting level 1 once we enter it).
      - Depth increments only when a child is itself a container
        (dict or list), not for scalar children.
      - ``depth > MAX_DEPTH`` triggers ERR_LIMIT_DEPTH.
    """
    if depth > MAX_DEPTH:
        raise MapError(ERR_LIMIT_DEPTH, "exceeds MAX_DEPTH")

    if isinstance(x, dict):
        out: dict = {}
        for k, v in x.items():
            if not isinstance(k, str):
                raise MapError(ERR_SCHEMA, "JSON key is not a string")
            _ensure_no_surrogates(k)
            if isinstance(v, (dict, list)):
                out[k] = json_to_canon_value(v, depth + 1)
            else:
                out[k] = json_to_canon_value(v, depth)
        return out

    if isinstance(x, list):
        out_list: list = []
        for v in x:
            if isinstance(v, (dict, list)):
                out_list.append(json_to_canon_value(v, depth + 1))
            else:
                out_list.append(json_to_canon_value(v, depth))
        return out_list

    if isinstance(x, str):
        _ensure_no_surrogates(x)
        return x

    # bool check MUST come before int check (bool is subclass of int in Python)
    if isinstance(x, bool):
        return "true" if x else "false"

    if x is None:
        raise MapError(ERR_TYPE, "JSON null is not allowed")

    if isinstance(x, (int, float)):
        raise MapError(ERR_TYPE, "JSON number is not allowed")

    raise MapError(ERR_SCHEMA, "unsupported JSON type")
