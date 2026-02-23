"""MAP v1 core: MCF encode/decode, UTF-8 validation, key ordering, MID computation."""

from __future__ import annotations

import hashlib
import struct
from typing import Any, List, Optional, Tuple

from ._constants import (
    CANON_HDR,
    MAX_CANON_BYTES,
    MAX_DEPTH,
    MAX_LIST_ENTRIES,
    MAX_MAP_ENTRIES,
    TAG_BYTES,
    TAG_LIST,
    TAG_MAP,
    TAG_STRING,
)
from ._errors import (
    ERR_CANON_HDR,
    ERR_CANON_MCF,
    ERR_DUP_KEY,
    ERR_KEY_ORDER,
    ERR_LIMIT_DEPTH,
    ERR_LIMIT_SIZE,
    ERR_SCHEMA,
    ERR_UTF8,
    MapError,
)


# ── SHA-256 helper ──────────────────────────────────────────

def _sha256_hex(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


# ── UTF-8 scalar validation ────────────────────────────────

def validate_utf8_scalar(b: bytes) -> None:
    """Validate that *b* is well-formed UTF-8 with no surrogate code-points."""
    try:
        s = b.decode("utf-8", errors="strict")
    except UnicodeDecodeError:
        raise MapError(ERR_UTF8, "invalid utf-8")
    for ch in s:
        cp = ord(ch)
        if 0xD800 <= cp <= 0xDFFF:
            raise MapError(ERR_UTF8, "surrogate code-point in UTF-8")


# ── Key ordering (unsigned-octet memcmp) ────────────────────

def _key_cmp(a: bytes, b: bytes) -> int:
    """Compare two byte-strings using unsigned-octet memcmp semantics."""
    min_len = min(len(a), len(b))
    for i in range(min_len):
        if a[i] != b[i]:
            return -1 if a[i] < b[i] else 1
    if len(a) == len(b):
        return 0
    return -1 if len(a) < len(b) else 1


def _ensure_sorted_unique(keys: List[bytes]) -> None:
    """Assert *keys* are strictly ascending by memcmp (no duplicates)."""
    for i in range(1, len(keys)):
        c = _key_cmp(keys[i - 1], keys[i])
        if c == 0:
            raise MapError(ERR_DUP_KEY, "duplicate key")
        if c > 0:
            raise MapError(ERR_KEY_ORDER, "key order violation")


# ── MCF encode ──────────────────────────────────────────────

def _u32be(n: int) -> bytes:
    if n < 0 or n > 0xFFFFFFFF:
        raise MapError(ERR_CANON_MCF, "u32 out of range")
    return struct.pack(">I", n)


def mcf_encode_value(val: Any, depth: int = 0) -> bytes:
    """Encode a canonical-model value into MCF bytes.

    Depth model:
      - *depth* counts the nesting level of containers.
      - The root call uses depth=0.  When we encounter a container
        (MAP or LIST), we check ``depth + 1 > MAX_DEPTH`` before
        recursing, then recurse with ``depth + 1``.
      - Scalars (STRING, BYTES) do not increment depth.
    """
    # bool MUST be checked before str (bool is not str, but before other checks)
    # and before any hypothetical int check (bool is subclass of int in Python)
    if isinstance(val, bool):
        val = "true" if val else "false"
        # fall through to str handling below

    if isinstance(val, str):
        b = val.encode("utf-8")
        validate_utf8_scalar(b)
        return bytes([TAG_STRING]) + _u32be(len(b)) + b

    if isinstance(val, bytes):
        return bytes([TAG_BYTES]) + _u32be(len(val)) + val

    if isinstance(val, list):
        if depth + 1 > MAX_DEPTH:
            raise MapError(ERR_LIMIT_DEPTH, "depth exceeds MAX_DEPTH")
        if len(val) > MAX_LIST_ENTRIES:
            raise MapError(ERR_LIMIT_SIZE, "list entry count exceeds limit")
        parts: List[bytes] = [bytes([TAG_LIST]), _u32be(len(val))]
        for item in val:
            parts.append(mcf_encode_value(item, depth + 1))
        return b"".join(parts)

    if isinstance(val, dict):
        if depth + 1 > MAX_DEPTH:
            raise MapError(ERR_LIMIT_DEPTH, "depth exceeds MAX_DEPTH")
        if len(val) > MAX_MAP_ENTRIES:
            raise MapError(ERR_LIMIT_SIZE, "map entry count exceeds limit")
        items: List[Tuple[bytes, Any]] = []
        for k, v in val.items():
            if not isinstance(k, str):
                raise MapError(ERR_SCHEMA, "map key must be a string")
            kb = k.encode("utf-8")
            validate_utf8_scalar(kb)
            items.append((kb, v))
        # Sort by unsigned-octet memcmp, then verify uniqueness
        items.sort(key=lambda kv: kv[0])
        _ensure_sorted_unique([kv[0] for kv in items])
        parts = [bytes([TAG_MAP]), _u32be(len(items))]
        for kb, v in items:
            parts.append(bytes([TAG_STRING]) + _u32be(len(kb)) + kb)
            parts.append(mcf_encode_value(v, depth + 1))
        return b"".join(parts)

    raise MapError(ERR_SCHEMA, "unsupported Python type for canonical model")


# ── MCF decode (for fast-path validation) ───────────────────

def _read_u32be(buf: bytes, off: int) -> Tuple[int, int]:
    if off + 4 > len(buf):
        raise MapError(ERR_CANON_MCF, "truncated u32")
    return struct.unpack(">I", buf[off:off + 4])[0], off + 4


def _mcf_decode_one(buf: bytes, off: int, depth: int) -> Tuple[Any, int]:
    """Decode one MCF value from *buf* at *off*.  *depth* semantics mirror encode."""
    if off >= len(buf):
        raise MapError(ERR_CANON_MCF, "truncated tag")
    tag = buf[off]
    off += 1

    if tag == TAG_STRING:
        n, off = _read_u32be(buf, off)
        if off + n > len(buf):
            raise MapError(ERR_CANON_MCF, "truncated string payload")
        s_bytes = buf[off:off + n]
        off += n
        validate_utf8_scalar(s_bytes)
        return s_bytes.decode("utf-8"), off

    if tag == TAG_BYTES:
        n, off = _read_u32be(buf, off)
        if off + n > len(buf):
            raise MapError(ERR_CANON_MCF, "truncated bytes payload")
        b = buf[off:off + n]
        off += n
        return b, off

    if tag == TAG_LIST:
        if depth + 1 > MAX_DEPTH:
            raise MapError(ERR_LIMIT_DEPTH, "depth exceeds MAX_DEPTH")
        count, off = _read_u32be(buf, off)
        if count > MAX_LIST_ENTRIES:
            raise MapError(ERR_LIMIT_SIZE, "list entry count exceeds limit")
        arr = []
        for _ in range(count):
            item, off = _mcf_decode_one(buf, off, depth + 1)
            arr.append(item)
        return arr, off

    if tag == TAG_MAP:
        if depth + 1 > MAX_DEPTH:
            raise MapError(ERR_LIMIT_DEPTH, "depth exceeds MAX_DEPTH")
        count, off = _read_u32be(buf, off)
        if count > MAX_MAP_ENTRIES:
            raise MapError(ERR_LIMIT_SIZE, "map entry count exceeds limit")
        items: List[Tuple[bytes, str, Any]] = []
        prev_key: Optional[bytes] = None
        for _ in range(count):
            if off >= len(buf):
                raise MapError(ERR_CANON_MCF, "truncated map key tag")
            if buf[off] != TAG_STRING:
                raise MapError(ERR_SCHEMA, "map key must be a STRING")
            k, off = _mcf_decode_one(buf, off, depth + 1)
            if not isinstance(k, str):
                raise MapError(ERR_SCHEMA, "map key decoded to non-string")
            kb = k.encode("utf-8")
            if prev_key is not None:
                c = _key_cmp(prev_key, kb)
                if c == 0:
                    raise MapError(ERR_DUP_KEY, "duplicate key in MCF")
                if c > 0:
                    raise MapError(ERR_KEY_ORDER, "key order violation in MCF")
            prev_key = kb
            v, off = _mcf_decode_one(buf, off, depth + 1)
            items.append((kb, k, v))
        d = {k: v for (_, k, v) in items}
        return d, off

    raise MapError(ERR_CANON_MCF, f"unknown MCF tag 0x{tag:02x}")


# ── Public helpers ──────────────────────────────────────────

def canon_bytes_from_value(val: Any) -> bytes:
    """Encode a canonical-model value to CANON_BYTES (header + MCF)."""
    body = mcf_encode_value(val)
    canon = CANON_HDR + body
    if len(canon) > MAX_CANON_BYTES:
        raise MapError(ERR_LIMIT_SIZE, "encoded canon bytes exceed MAX_CANON_BYTES")
    return canon


def mid_from_value(val: Any) -> str:
    """Compute MID from a canonical-model value."""
    canon = canon_bytes_from_value(val)
    return "map1:" + _sha256_hex(canon)


def mid_from_canon_bytes(canon: bytes) -> str:
    """Validate pre-built CANON_BYTES (fast-path) and return MID.

    Per spec §3.7 this performs full structural validation but hashes
    the *input* bytes directly (no re-encode).
    """
    if len(canon) > MAX_CANON_BYTES:
        raise MapError(ERR_LIMIT_SIZE, "canon bytes exceed MAX_CANON_BYTES")
    if not canon.startswith(CANON_HDR):
        raise MapError(ERR_CANON_HDR, "bad CANON_HDR")
    off = len(CANON_HDR)
    _val, off2 = _mcf_decode_one(canon, off, depth=0)
    if off2 != len(canon):
        raise MapError(ERR_CANON_MCF, "trailing bytes after MCF root value")
    return "map1:" + _sha256_hex(canon)
