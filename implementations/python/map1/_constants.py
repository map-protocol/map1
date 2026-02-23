"""MAP v1 constants: canonical header, MCF type tags, and normative limits."""

from __future__ import annotations

# 5-byte canonical header: ASCII "MAP1" + 0x00
CANON_HDR = b"MAP1\x00"

# MCF type tags (single-byte)
TAG_STRING: int = 0x01
TAG_BYTES: int = 0x02
TAG_LIST: int = 0x03
TAG_MAP: int = 0x04

# Normative safety limits
MAX_CANON_BYTES: int = 1_048_576   # 1 MiB
MAX_DEPTH: int = 32
MAX_MAP_ENTRIES: int = 65_535
MAX_LIST_ENTRIES: int = 65_535
