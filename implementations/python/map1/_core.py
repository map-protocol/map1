"""MAP v1.1 core — MCF encode/decode, UTF-8 validation, key ordering, MID.

This module implements the canonical model (§3), CANON_BYTES (§5), and
MID computation (§5.3).  The six canonical types are:

    STRING  (0x01)  — UTF-8 text, scalar code-points only
    BYTES   (0x02)  — raw byte sequence
    LIST    (0x03)  — ordered array of values
    MAP     (0x04)  — sorted key/value pairs, string keys only
    BOOLEAN (0x05)  — true or false, 1-byte payload (v1.1)
    INTEGER (0x06)  — signed 64-bit, big-endian (v1.1)

Encoding philosophy: every value is self-describing via its type tag,
and every container encodes its count as uint32be.  No implicit typing,
no schema negotiation, no optional fields.
"""

from __future__ import annotations

import hashlib
import struct
from typing import Any, List, Optional, Tuple

from ._constants import (
    CANON_HDR,
    INT64_MAX,
    INT64_MIN,
    MAX_CANON_BYTES,
    MAX_DEPTH,
    MAX_LIST_ENTRIES,
    MAX_MAP_ENTRIES,
    TAG_BOOLEAN,
    TAG_BYTES,
    TAG_INTEGER,
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


def _sha256_hex(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


# ── UTF-8 scalar validation (§3.4) ───────────────────────────
# "Scalar values only" means no surrogates (U+D800–U+DFFF).  Python's
# UTF-8 codec doesn't normally produce surrogates, but we check anyway
# because MAP requires fail-fast on any surrogate — even if the source
# language wouldn't naturally generate one.

def validate_utf8_scalar(b: bytes) -> None:
    """Reject invalid UTF-8 or any surrogate code-point."""
    try:
        s = b.decode("utf-8", errors="strict")
    except UnicodeDecodeError:
        raise MapError(ERR_UTF8, "invalid utf-8")
    for ch in s:
        cp = ord(ch)
        if 0xD800 <= cp <= 0xDFFF:
            raise MapError(ERR_UTF8, "surrogate code-point U+{:04X}".format(cp))


# ── Key ordering (§3.5) ──────────────────────────────────────
# This is the single most critical fork surface in the entire spec.
# Ordering is raw unsigned-octet comparison (memcmp semantics), NOT
# Unicode code-point order, NOT locale collation, NOT UTF-16 order.
# Java implementers: mask bytes with & 0xFF.

def _key_cmp(a: bytes, b: bytes) -> int:
    """Compare two byte-strings using unsigned-octet memcmp."""
    min_len = min(len(a), len(b))
    for i in range(min_len):
        if a[i] != b[i]:
            return -1 if a[i] < b[i] else 1
    if len(a) == len(b):
        return 0
    # Prefix rule: shorter key sorts first
    return -1 if len(a) < len(b) else 1


# TODO: benchmark whether a single memoryview comparison is faster than
# byte-by-byte iteration for typical key lengths (5–30 bytes).

def _ensure_sorted_unique(keys: List[bytes]) -> None:
    """Assert keys are strictly ascending by memcmp (no duplicates)."""
    for i in range(1, len(keys)):
        c = _key_cmp(keys[i - 1], keys[i])
        if c == 0:
            raise MapError(ERR_DUP_KEY, "duplicate key")
        if c > 0:
            raise MapError(ERR_KEY_ORDER, "key order violation")


# ── MCF encode (§3.2) ────────────────────────────────────────

def _u32be(n: int) -> bytes:
    """Pack an unsigned 32-bit big-endian integer."""
    if n < 0 or n > 0xFFFFFFFF:
        raise MapError(ERR_CANON_MCF, "u32 out of range")
    return struct.pack(">I", n)


def mcf_encode_value(val: Any, depth: int = 0) -> bytes:
    """Encode a canonical-model value into MCF bytes.

    The depth parameter tracks container nesting:
      - Root call starts at depth=0.
      - Entering a MAP or LIST checks depth+1 against MAX_DEPTH.
      - Scalars (STRING, BYTES, BOOLEAN, INTEGER) don't increment depth.
    """
    # ── bool must be checked before int ──────────────────────
    # In Python, bool is a subclass of int: isinstance(True, int) is True.
    # If we checked int first, True would encode as INTEGER 1 instead of
    # BOOLEAN true — a silent, spec-violating fork.
    # See: https://docs.python.org/3/library/functions.html#bool
    # This is a CPython design decision from PEP 285 (2002) that bites
    # everyone who writes type-dispatch code over Python values.
    if isinstance(val, bool):
        return bytes([TAG_BOOLEAN, 0x01 if val else 0x00])

    # ── int (not bool) → INTEGER ─────────────────────────────
    # Python ints are arbitrary-precision.  The spec requires signed 64-bit,
    # so we must range-check explicitly.  Go/Rust get this for free.
    if isinstance(val, int):
        if val < INT64_MIN or val > INT64_MAX:
            raise MapError(ERR_SCHEMA, "integer out of int64 range")
        return bytes([TAG_INTEGER]) + struct.pack(">q", val)

    if isinstance(val, str):
        raw = val.encode("utf-8")
        validate_utf8_scalar(raw)
        return bytes([TAG_STRING]) + _u32be(len(raw)) + raw

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

        # Collect keys as UTF-8 bytes, validate, then sort by memcmp.
        items: List[Tuple[bytes, Any]] = []
        for k, v in val.items():
            if not isinstance(k, str):
                raise MapError(ERR_SCHEMA, "map key must be a string")
            kb = k.encode("utf-8")
            validate_utf8_scalar(kb)
            items.append((kb, v))

        items.sort(key=lambda kv: kv[0])
        _ensure_sorted_unique([kv[0] for kv in items])

        parts = [bytes([TAG_MAP]), _u32be(len(items))]
        for kb, v in items:
            # Keys are always STRING-tagged, even inside MAP entries.
            parts.append(bytes([TAG_STRING]) + _u32be(len(kb)) + kb)
            parts.append(mcf_encode_value(v, depth + 1))
        return b"".join(parts)

    raise MapError(ERR_SCHEMA, "unsupported type: {}".format(type(val).__name__))


# TODO: for large descriptors, consider a streaming encoder that writes
# directly to a hashlib.sha256() object instead of building a full byte
# buffer.  Would cut peak memory roughly in half.


# ── MCF decode (§3.7 fast-path validation) ────────────────────

def _read_u32be(buf: bytes, off: int) -> Tuple[int, int]:
    if off + 4 > len(buf):
        raise MapError(ERR_CANON_MCF, "truncated u32")
    return struct.unpack(">I", buf[off:off + 4])[0], off + 4


def _mcf_decode_one(buf: bytes, off: int, depth: int) -> Tuple[Any, int]:
    """Decode one MCF value from buf at offset.  Depth semantics mirror encode."""
    if off >= len(buf):
        raise MapError(ERR_CANON_MCF, "truncated tag")
    tag = buf[off]
    off += 1

    if tag == TAG_STRING:
        n, off = _read_u32be(buf, off)
        if off + n > len(buf):
            raise MapError(ERR_CANON_MCF, "truncated string payload")
        raw = buf[off:off + n]
        off += n
        validate_utf8_scalar(raw)
        return raw.decode("utf-8"), off

    if tag == TAG_BYTES:
        n, off = _read_u32be(buf, off)
        if off + n > len(buf):
            raise MapError(ERR_CANON_MCF, "truncated bytes payload")
        val = buf[off:off + n]
        off += n
        return val, off

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
            # Keys must be STRING-tagged per §3.2.
            if off >= len(buf):
                raise MapError(ERR_CANON_MCF, "truncated map key tag")
            if buf[off] != TAG_STRING:
                raise MapError(ERR_SCHEMA, "map key must be STRING")
            k, off = _mcf_decode_one(buf, off, depth + 1)
            if not isinstance(k, str):
                raise MapError(ERR_SCHEMA, "map key decoded to non-string")
            kb = k.encode("utf-8")

            # Enforce ordering and uniqueness on the wire.
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

    # ── v1.1 types ────────────────────────────────────────────
    # BOOLEAN: exactly 1 payload byte, must be 0x00 or 0x01.
    # Any other value is a malformed encoding, not a type error.
    if tag == TAG_BOOLEAN:
        if off >= len(buf):
            raise MapError(ERR_CANON_MCF, "truncated boolean payload")
        payload = buf[off]
        if payload not in (0x00, 0x01):
            raise MapError(ERR_CANON_MCF, "invalid boolean payload 0x{:02x}".format(payload))
        return (payload == 0x01), off + 1

    # INTEGER: exactly 8 payload bytes, signed big-endian.
    if tag == TAG_INTEGER:
        if off + 8 > len(buf):
            raise MapError(ERR_CANON_MCF, "truncated integer payload")
        val = struct.unpack(">q", buf[off:off + 8])[0]
        return val, off + 8

    raise MapError(ERR_CANON_MCF, "unknown MCF tag 0x{:02x}".format(tag))


# ── Public helpers ────────────────────────────────────────────

def canon_bytes_from_value(val: Any) -> bytes:
    """Encode a canonical-model value to CANON_BYTES = header + MCF."""
    body = mcf_encode_value(val)
    canon = CANON_HDR + body
    if len(canon) > MAX_CANON_BYTES:
        raise MapError(ERR_LIMIT_SIZE, "canon bytes exceed MAX_CANON_BYTES")
    return canon


def mid_from_value(val: Any) -> str:
    """Compute MID from a canonical-model value."""
    return "map1:" + _sha256_hex(canon_bytes_from_value(val))


def mid_from_canon_bytes(canon: bytes) -> str:
    """Validate pre-built CANON_BYTES and return MID.

    This is the "fast-path" entry point (§3.7) — it fully validates the
    binary structure but hashes the input bytes directly rather than
    re-encoding through the model layer.
    """
    if len(canon) > MAX_CANON_BYTES:
        raise MapError(ERR_LIMIT_SIZE, "canon bytes exceed MAX_CANON_BYTES")
    if not canon.startswith(CANON_HDR):
        raise MapError(ERR_CANON_HDR, "bad CANON_HDR")

    off = len(CANON_HDR)
    _val, end = _mcf_decode_one(canon, off, depth=0)
    if end != len(canon):
        raise MapError(ERR_CANON_MCF, "trailing bytes after MCF root")
    return "map1:" + _sha256_hex(canon)
