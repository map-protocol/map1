"""MAP v1.1 JSON-STRICT adapter.

Converts raw UTF-8 JSON bytes into the canonical model (§8).

Type mapping (§8.2):
    JSON object  → MAP
    JSON array   → LIST
    JSON string  → STRING
    JSON boolean → BOOLEAN    (v1.1 — was STRING in v1.0)
    JSON integer → INTEGER    (v1.1 — was ERR_TYPE in v1.0)
    JSON float   → ERR_TYPE   (decimal point or exponent = rejected)
    JSON null    → ERR_TYPE

The trickiest part of this module is float vs integer detection.  Python's
json.loads() silently converts "42" to int and "3.14" to float, which is
fine — but it also converts "1.0" to float(1.0), which we need to reject
even though the value is mathematically integral.  We intercept at the
token level using parse_float/parse_int hooks.  See §8.2.1.
"""

from __future__ import annotations

import json
import re
from typing import Any, Tuple

from ._constants import INT64_MAX, INT64_MIN, MAX_CANON_BYTES, MAX_DEPTH
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

# Leading whitespace pattern for BOM detection.
_WS = re.compile(rb"^[\x20\x09\x0A\x0D]*")


def _ensure_no_surrogates(s: str) -> None:
    for ch in s:
        cp = ord(ch)
        if 0xD800 <= cp <= 0xDFFF:
            raise MapError(ERR_UTF8, "surrogate U+{:04X} in JSON string".format(cp))


# ── Float/integer interception ────────────────────────────────
#
# We need to distinguish the JSON token "1.0" (float → reject) from "1"
# (integer → accept) at parse time, before Python coerces them.
#
# Strategy: json.loads() calls parse_float for tokens with '.' or 'e',
# and parse_int for tokens without.  We return a sentinel for floats
# that json_to_canon_value will reject, and range-check integers eagerly.

class _FloatSentinel:
    """Placeholder for a JSON float token — will be rejected by the adapter."""
    __slots__ = ("token",)
    def __init__(self, token: str):
        self.token = token


def _intercept_float(s: str) -> _FloatSentinel:
    """Called by json.loads for any number with '.' or 'e'/'E'."""
    return _FloatSentinel(s)


def _intercept_int(s: str) -> int:
    """Called by json.loads for integer-shaped number tokens.

    We range-check here so overflow is caught even if the value is buried
    deep in a nested structure.  The error message includes the raw token
    for debuggability.
    """
    val = int(s)
    if val < INT64_MIN or val > INT64_MAX:
        raise MapError(ERR_TYPE, "integer overflow: {}".format(s))
    return val


# ── JSON parse with duplicate-key detection ───────────────────

def json_strict_parse_with_dups(raw: bytes) -> Tuple[Any, bool]:
    """Parse raw JSON bytes under JSON-STRICT rules.

    Returns (parsed_value, dup_found).  Duplicate detection does NOT
    short-circuit — we record the flag and keep parsing so that
    higher-precedence errors (ERR_TYPE from null, ERR_UTF8 from bad
    encoding) can still surface.  The caller raises ERR_DUP_KEY only
    if no higher-precedence error occurred.
    """
    if len(raw) > MAX_CANON_BYTES:
        raise MapError(ERR_LIMIT_SIZE, "input exceeds MAX_CANON_BYTES")

    # BOM rejection (§8.1.1): check after skipping JSON whitespace.
    m = _WS.match(raw)
    start = m.end() if m else 0
    if raw[start:start + 3] == b"\xef\xbb\xbf":
        raise MapError(ERR_SCHEMA, "UTF-8 BOM rejected")

    try:
        text = raw.decode("utf-8")
    except UnicodeDecodeError:
        raise MapError(ERR_UTF8, "invalid UTF-8 in JSON input")

    dup_found = False

    def pairs_hook(pairs: list) -> dict:
        nonlocal dup_found
        seen: set = set()
        result: dict = {}
        for key, value in pairs:
            if not isinstance(key, str):
                raise MapError(ERR_SCHEMA, "JSON key is not a string")
            _ensure_no_surrogates(key)
            # Duplicate detection happens after escape resolution (§8.3),
            # which json.loads has already done for us.
            if key in seen:
                dup_found = True
                continue  # keep first occurrence
            seen.add(key)
            result[key] = value
        return result

    try:
        obj = json.loads(
            text,
            object_pairs_hook=pairs_hook,
            parse_float=_intercept_float,
            parse_int=_intercept_int,
            parse_constant=lambda c: (_ for _ in ()).throw(
                MapError(ERR_CANON_MCF, "JSON constant not allowed")
            ),
        )
        return obj, dup_found
    except MapError:
        raise
    except json.JSONDecodeError:
        raise MapError(ERR_CANON_MCF, "JSON parse error")


# ── JSON value → canonical model ──────────────────────────────

def json_to_canon_value(x: Any, depth: int = 1) -> Any:
    """Convert a parsed JSON value to the MAP v1.1 canonical model.

    After this function, the value tree contains only:
        str, bytes, bool, int, list, dict
    which mcf_encode_value() knows how to serialize.
    """
    if depth > MAX_DEPTH:
        raise MapError(ERR_LIMIT_DEPTH, "exceeds MAX_DEPTH")

    if isinstance(x, dict):
        out: dict = {}
        for k, v in x.items():
            if not isinstance(k, str):
                raise MapError(ERR_SCHEMA, "JSON key must be string")
            _ensure_no_surrogates(k)
            child_depth = depth + 1 if isinstance(v, (dict, list)) else depth
            out[k] = json_to_canon_value(v, child_depth)
        return out

    if isinstance(x, list):
        result: list = []
        for v in x:
            child_depth = depth + 1 if isinstance(v, (dict, list)) else depth
            result.append(json_to_canon_value(v, child_depth))
        return result

    if isinstance(x, str):
        _ensure_no_surrogates(x)
        return x

    # bool before int — same reason as in the encoder.
    if isinstance(x, bool):
        return x

    if isinstance(x, int):
        return x  # range already validated by _intercept_int

    if x is None:
        raise MapError(ERR_TYPE, "JSON null not allowed")

    # Float sentinel from our parse_float hook.
    if isinstance(x, _FloatSentinel):
        raise MapError(ERR_TYPE, "JSON float not allowed: {}".format(x.token))

    # Shouldn't happen, but guard against it.
    if isinstance(x, float):
        raise MapError(ERR_TYPE, "JSON float not allowed")

    raise MapError(ERR_SCHEMA, "unexpected JSON type: {}".format(type(x).__name__))


# TODO: consider a prepare_json() variant that takes raw JSON bytes and
# returns normalized JSON bytes — useful for pipelines that never touch
# native Python types.  Would need to handle float token replacement
# in the raw JSON string before parsing.
