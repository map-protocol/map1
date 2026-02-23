"""Unit tests for the map1 public API."""

from __future__ import annotations

import json
import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from map1 import (
    MapError,
    ERR_CANON_HDR,
    ERR_CANON_MCF,
    ERR_DUP_KEY,
    ERR_KEY_ORDER,
    ERR_LIMIT_DEPTH,
    ERR_LIMIT_SIZE,
    ERR_SCHEMA,
    ERR_TYPE,
    ERR_UTF8,
    mid_full,
    mid_bind,
    canonical_bytes_full,
    canonical_bytes_bind,
    mid_full_json,
    mid_bind_json,
    mid_from_canon_bytes,
)


class TestMidFull(unittest.TestCase):
    def test_simple_dict(self):
        mid = mid_full({"a": "b"})
        self.assertTrue(mid.startswith("map1:"))
        self.assertEqual(len(mid), 5 + 64)  # "map1:" + 64 hex chars

    def test_reordered_keys_same_mid(self):
        """Key ordering is canonical; insertion order doesn't matter."""
        d1 = {"z": "1", "a": "2", "m": "3"}
        d2 = {"a": "2", "m": "3", "z": "1"}
        self.assertEqual(mid_full(d1), mid_full(d2))

    def test_empty_dict(self):
        mid = mid_full({})
        self.assertTrue(mid.startswith("map1:"))

    def test_nested_dict(self):
        mid = mid_full({"outer": {"inner": "val"}})
        self.assertTrue(mid.startswith("map1:"))

    def test_list_value(self):
        mid = mid_full({"items": ["a", "b", "c"]})
        self.assertTrue(mid.startswith("map1:"))

    def test_bool_true_maps_to_string(self):
        """bool True becomes STRING 'true' → same MID as explicit string."""
        self.assertEqual(mid_full({"k": True}), mid_full({"k": "true"}))

    def test_bool_false_maps_to_string(self):
        self.assertEqual(mid_full({"k": False}), mid_full({"k": "false"}))

    def test_bytes_value(self):
        mid = mid_full({"data": b"\x00\x01\x02"})
        self.assertTrue(mid.startswith("map1:"))


class TestMidBind(unittest.TestCase):
    def test_single_pointer(self):
        d = {"a": "1", "b": "2", "c": "3"}
        mid = mid_bind(d, ["/a"])
        self.assertTrue(mid.startswith("map1:"))
        # Should differ from full (omit-siblings)
        self.assertNotEqual(mid, mid_full(d))

    def test_nonexistent_field_error(self):
        """Pointer to non-existent field → ERR_SCHEMA (unmatched)."""
        # Need at least one matching pointer to trigger unmatched error
        with self.assertRaises(MapError) as ctx:
            mid_bind({"a": "1"}, ["/a", "/nonexistent"])
        # /a matches, /nonexistent does not → ERR_SCHEMA
        self.assertEqual(ctx.exception.code, ERR_SCHEMA)

    def test_all_nonexistent_returns_empty(self):
        """All pointers unmatched → empty MAP (not an error)."""
        mid = mid_bind({"a": "1"}, ["/x"])
        self.assertEqual(mid, mid_full({}))

    def test_empty_pointer_full_equivalent(self):
        d = {"a": "1", "b": "2"}
        self.assertEqual(mid_bind(d, [""]), mid_full(d))

    def test_duplicate_pointers_error(self):
        with self.assertRaises(MapError) as ctx:
            mid_bind({"a": "1"}, ["/a", "/a"])
        self.assertEqual(ctx.exception.code, ERR_SCHEMA)

    def test_list_traversal_error(self):
        with self.assertRaises(MapError) as ctx:
            mid_bind({"a": ["x"]}, ["/a/0"])
        self.assertEqual(ctx.exception.code, ERR_SCHEMA)


class TestCanonicalBytes(unittest.TestCase):
    def test_full_starts_with_header(self):
        cb = canonical_bytes_full({"a": "b"})
        self.assertTrue(cb.startswith(b"MAP1\x00"))

    def test_bind_starts_with_header(self):
        cb = canonical_bytes_bind({"a": "b", "c": "d"}, ["/a"])
        self.assertTrue(cb.startswith(b"MAP1\x00"))

    def test_round_trip(self):
        """canon_bytes → mid_from_canon_bytes should equal mid_full."""
        d = {"hello": "world", "nested": {"k": "v"}}
        cb = canonical_bytes_full(d)
        mid1 = mid_full(d)
        mid2 = mid_from_canon_bytes(cb)
        self.assertEqual(mid1, mid2)


class TestMidFromCanonBytes(unittest.TestCase):
    def test_valid_canon_bytes(self):
        cb = canonical_bytes_full({"x": "y"})
        mid = mid_from_canon_bytes(cb)
        self.assertTrue(mid.startswith("map1:"))

    def test_bad_header(self):
        with self.assertRaises(MapError) as ctx:
            mid_from_canon_bytes(b"BADH\x00\x04\x00\x00\x00\x00")
        self.assertEqual(ctx.exception.code, ERR_CANON_HDR)

    def test_truncated(self):
        with self.assertRaises(MapError) as ctx:
            mid_from_canon_bytes(b"MAP1\x00\x04")
        self.assertEqual(ctx.exception.code, ERR_CANON_MCF)

    def test_trailing_bytes(self):
        cb = canonical_bytes_full({"a": "b"})
        with self.assertRaises(MapError) as ctx:
            mid_from_canon_bytes(cb + b"\x00")
        self.assertEqual(ctx.exception.code, ERR_CANON_MCF)


class TestMidFullJson(unittest.TestCase):
    def test_simple_json(self):
        raw = b'{"a": "b"}'
        mid = mid_full_json(raw)
        self.assertEqual(mid, mid_full({"a": "b"}))

    def test_json_bool_maps_to_string(self):
        raw = b'{"k": true}'
        mid = mid_full_json(raw)
        self.assertEqual(mid, mid_full({"k": "true"}))

    def test_json_with_reordered_keys(self):
        raw1 = b'{"z": "1", "a": "2"}'
        raw2 = b'{"a": "2", "z": "1"}'
        self.assertEqual(mid_full_json(raw1), mid_full_json(raw2))


class TestMidBindJson(unittest.TestCase):
    def test_bind_json(self):
        raw = b'{"a": "1", "b": "2"}'
        mid = mid_bind_json(raw, ["/a"])
        self.assertTrue(mid.startswith("map1:"))


class TestErrorCodes(unittest.TestCase):
    """At least one test per error code."""

    def test_err_canon_hdr(self):
        with self.assertRaises(MapError) as ctx:
            mid_from_canon_bytes(b"NOPE\x00\x01\x00\x00\x00\x00")
        self.assertEqual(ctx.exception.code, ERR_CANON_HDR)

    def test_err_canon_mcf(self):
        # Valid header but malformed MCF (unknown tag 0xFF)
        with self.assertRaises(MapError) as ctx:
            mid_from_canon_bytes(b"MAP1\x00\xFF")
        self.assertEqual(ctx.exception.code, ERR_CANON_MCF)

    def test_err_schema_non_dict_root_bind(self):
        with self.assertRaises(MapError) as ctx:
            mid_bind("not a dict", ["/a"])  # type: ignore
        self.assertEqual(ctx.exception.code, ERR_SCHEMA)

    def test_err_type_null(self):
        raw = b'{"k": null}'
        with self.assertRaises(MapError) as ctx:
            mid_full_json(raw)
        self.assertEqual(ctx.exception.code, ERR_TYPE)

    def test_err_type_number(self):
        raw = b'{"k": 42}'
        with self.assertRaises(MapError) as ctx:
            mid_full_json(raw)
        self.assertEqual(ctx.exception.code, ERR_TYPE)

    def test_err_utf8_bad_bytes(self):
        # Invalid UTF-8 in JSON
        raw = b'{"k": "\xff"}'
        with self.assertRaises(MapError) as ctx:
            mid_full_json(raw)
        self.assertEqual(ctx.exception.code, ERR_UTF8)

    def test_err_dup_key(self):
        raw = b'{"a": "1", "a": "2"}'
        with self.assertRaises(MapError) as ctx:
            mid_full_json(raw)
        self.assertEqual(ctx.exception.code, ERR_DUP_KEY)

    def test_err_key_order_in_canon_bytes(self):
        # Manually build MCF with wrong key order: key "b" before "a"
        import struct
        hdr = b"MAP1\x00"
        tag_map = bytes([0x04])
        count = struct.pack(">I", 2)
        # key "b", value "1"
        k1 = b"\x01" + struct.pack(">I", 1) + b"b"
        v1 = b"\x01" + struct.pack(">I", 1) + b"1"
        # key "a", value "2"
        k2 = b"\x01" + struct.pack(">I", 1) + b"a"
        v2 = b"\x01" + struct.pack(">I", 1) + b"2"
        canon = hdr + tag_map + count + k1 + v1 + k2 + v2
        with self.assertRaises(MapError) as ctx:
            mid_from_canon_bytes(canon)
        self.assertEqual(ctx.exception.code, ERR_KEY_ORDER)

    def test_err_limit_depth(self):
        # Build 33-deep nested dict
        d: dict = {"k": "leaf"}
        for _ in range(32):
            d = {"n": d}
        with self.assertRaises(MapError) as ctx:
            mid_full(d)
        self.assertEqual(ctx.exception.code, ERR_LIMIT_DEPTH)

    def test_err_limit_size(self):
        # Oversized canon bytes
        with self.assertRaises(MapError) as ctx:
            mid_from_canon_bytes(b"MAP1\x00" + b"\x00" * (1_048_576 + 1))
        self.assertEqual(ctx.exception.code, ERR_LIMIT_SIZE)

    def test_err_schema_bom(self):
        raw = b'\xef\xbb\xbf{"a": "b"}'
        with self.assertRaises(MapError) as ctx:
            mid_full_json(raw)
        self.assertEqual(ctx.exception.code, ERR_SCHEMA)


if __name__ == "__main__":
    unittest.main()
