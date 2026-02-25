"""MAP v1.1 error codes, exception class, and precedence logic.

Spec reference: §6 (Errors).

Error precedence matters for conformance — when multiple violations apply,
implementations MUST report the highest-precedence one.  The precedence
order is fixed by spec §6.2, and the safety-vs-precedence rule (§6.2)
governs short-circuit behavior.
"""

from __future__ import annotations

from typing import List

# ── Error codes (9 total, ordered by precedence) ─────────────
# The names match the spec exactly.  Grep-friendly for cross-language tests.

ERR_CANON_HDR: str = "ERR_CANON_HDR"      # bad 5-byte header
ERR_CANON_MCF: str = "ERR_CANON_MCF"      # malformed MCF structure
ERR_SCHEMA: str = "ERR_SCHEMA"            # bad shape (BIND into LIST, BOM, etc.)
ERR_TYPE: str = "ERR_TYPE"                # unsupported type (null, float)
ERR_UTF8: str = "ERR_UTF8"                # invalid UTF-8 or surrogates
ERR_DUP_KEY: str = "ERR_DUP_KEY"          # duplicate MAP key
ERR_KEY_ORDER: str = "ERR_KEY_ORDER"       # keys not in memcmp order
ERR_LIMIT_DEPTH: str = "ERR_LIMIT_DEPTH"  # exceeds MAX_DEPTH
ERR_LIMIT_SIZE: str = "ERR_LIMIT_SIZE"    # exceeds MAX_CANON_BYTES

# Precedence: index 0 wins.  This ordering is normative.
PRECEDENCE: List[str] = [
    ERR_CANON_HDR,
    ERR_CANON_MCF,
    ERR_SCHEMA,
    ERR_TYPE,
    ERR_UTF8,
    ERR_DUP_KEY,
    ERR_KEY_ORDER,
    ERR_LIMIT_DEPTH,
    ERR_LIMIT_SIZE,
]

_PREC_INDEX = {code: idx for idx, code in enumerate(PRECEDENCE)}


class MapError(Exception):
    """Exception for MAP v1 processing errors.

    The `.code` attribute is one of the ERR_* strings above and is what
    conformance tests compare against.
    """

    def __init__(self, code: str, msg: str = "") -> None:
        super().__init__(msg or code)
        self.code = code


def choose_reported_error(errors: List[str]) -> str:
    """Given multiple detected violations, return the highest-precedence code.

    This implements the "reported-code rule" from §6.2.  In practice most
    code paths raise immediately on first error; this helper is for cases
    where an implementation collects violations before deciding what to report
    (e.g., the JSON adapter collects duplicate keys while continuing to scan
    for higher-precedence type errors).
    """
    return min(errors, key=lambda e: _PREC_INDEX.get(e, 10_000))
