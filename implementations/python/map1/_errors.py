"""MAP v1 error codes, exception class, and precedence logic."""

from __future__ import annotations
from typing import List

# ── Error codes (9 total) ──
ERR_CANON_HDR: str = "ERR_CANON_HDR"
ERR_CANON_MCF: str = "ERR_CANON_MCF"
ERR_SCHEMA: str = "ERR_SCHEMA"
ERR_TYPE: str = "ERR_TYPE"
ERR_UTF8: str = "ERR_UTF8"
ERR_DUP_KEY: str = "ERR_DUP_KEY"
ERR_KEY_ORDER: str = "ERR_KEY_ORDER"
ERR_LIMIT_DEPTH: str = "ERR_LIMIT_DEPTH"
ERR_LIMIT_SIZE: str = "ERR_LIMIT_SIZE"

# Precedence order (index 0 = highest precedence)
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
    """Exception raised for MAP v1 processing errors.

    Attributes:
        code: One of the ERR_* error code strings.
    """

    def __init__(self, code: str, msg: str = "") -> None:
        super().__init__(msg or code)
        self.code = code


def choose_reported_error(errors: List[str]) -> str:
    """Given multiple error codes, return the one with highest precedence."""
    return min(errors, key=lambda e: _PREC_INDEX.get(e, 10_000))
