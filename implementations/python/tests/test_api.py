"""Unit tests for the map1 v1.1 public API.

Organized by feature area.  Conformance testing against golden vectors
is in test_conformance.py; these tests exercise the API contracts and
edge cases that vectors don't cover.
"""

from __future__ import annotations

import json
import os
import struct
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
    prepare,
)


# ── FULL projection basics ────────────────────────────────────

class TestMidFull(unittest.TestCase):
    def test_basic_dict(self):
        mid = mid_full({"a": "b"})
        self.assertTrue(mid.startswith("map1:"))
        self.assertEqual(len(mid), 5 + 64)  # "map1:" + 64 hex chars

    def test_key_order_is_canonical(self):
        """Insertion order doesn't matter — keys sort by memcmp."""
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

    def test_bytes_value(self):
        mid = mid_full({"data": b"\x00\x01\x02"})
        self.assertTrue(mid.startswith("map1:"))


# ── v1.1 BOOLEAN type ────────────────────────────────────────

class TestBooleanType(unittest.TestCase):
    """v1.1: booleans are BOOLEAN, not STRING.  The whole point of v1.1."""

    def test_true_differs_from_string(self):
        self.assertNotEqual(mid_full({"k": True}), mid_full({"k": "true"}))

    def test_false_differs_from_string(self):
        self.assertNotEqual(mid_full({"k": False}), mid_full({"k": "false"}))

    def test_true_and_false_differ(self):
        self.assertNotEqual(mid_full(True), mid_full(False))

    def test_standalone_bool(self):
        """Bare boolean as root value — valid in FULL mode."""
        mid = mid_full(True)
        self.assertTrue(mid.startswith("map1:"))

    def test_bool_in_list(self):
        """List order matters for booleans too."""
        self.assertNotEqual(mid_full([True, False]), mid_full([False, True]))

    def test_canonical_bytes_true(self):
        cb = canonical_bytes_full(True)
        # header (5) + tag 0x05 + payload 0x01
        self.assertEqual(cb, b"MAP1\x00\x05\x01")

    def test_canonical_bytes_false(self):
        cb = canonical_bytes_full(False)
        self.assertEqual(cb, b"MAP1\x00\x05\x00")


# ── v1.1 INTEGER type ────────────────────────────────────────

class TestIntegerType(unittest.TestCase):
    def test_int_differs_from_string(self):
        self.assertNotEqual(mid_full({"n": 42}), mid_full({"n": "42"}))

    def test_zero_differs_from_string(self):
        self.assertNotEqual(mid_full(0), mid_full("0"))

    def test_negative(self):
        mid = mid_full(-1)
        self.assertTrue(mid.startswith("map1:"))

    def test_large_positive(self):
        mid = mid_full(1_000_000_000_000)
        self.assertTrue(mid.startswith("map1:"))

    def test_int64_max(self):
        mid = mid_full(2**63 - 1)
        self.assertTrue(mid.startswith("map1:"))

    def test_int64_min(self):
        mid = mid_full(-(2**63))
        self.assertTrue(mid.startswith("map1:"))

    def test_overflow_positive(self):
        with self.assertRaises(MapError) as ctx:
            mid_full(2**63)
        self.assertEqual(ctx.exception.code, ERR_SCHEMA)

    def test_overflow_negative(self):
        with self.assertRaises(MapError) as ctx:
            mid_full(-(2**63) - 1)
        self.assertEqual(ctx.exception.code, ERR_SCHEMA)

    def test_canonical_bytes_zero(self):
        cb = canonical_bytes_full(0)
        self.assertEqual(cb, b"MAP1\x00\x06" + b"\x00" * 8)

    def test_canonical_bytes_neg1(self):
        """Two's complement: -1 is all 0xFF bytes."""
        cb = canonical_bytes_full(-1)
        self.assertEqual(cb, b"MAP1\x00\x06" + b"\xff" * 8)

    def test_int64_min_sign_bit(self):
        """INT64_MIN = 0x8000000000000000 in two's complement."""
        cb = canonical_bytes_full(-(2**63))
        self.assertEqual(cb[6:], b"\x80" + b"\x00" * 7)


# ── Mixed types in containers ─────────────────────────────────

class TestMixedTypes(unittest.TestCase):
    def test_map_with_all_types(self):
        d = {"flag": True, "count": 42, "name": "test", "data": b"\x00"}
        mid = mid_full(d)
        self.assertTrue(mid.startswith("map1:"))

    def test_list_with_mixed_types(self):
        mid = mid_full([True, False, 42, -1, "hello"])
        self.assertTrue(mid.startswith("map1:"))

    def test_key_order_unaffected_by_value_type(self):
        """Keys sort by memcmp regardless of what type the value is."""
        d1 = {"a": True, "b": 42, "c": "x"}
        d2 = {"c": "x", "a": True, "b": 42}
        self.assertEqual(mid_full(d1), mid_full(d2))


# ── BIND projection ───────────────────────────────────────────

class TestMidBind(unittest.TestCase):
    def test_single_pointer(self):
        d = {"a": "1", "b": "2", "c": "3"}
        mid = mid_bind(d, ["/a"])
        self.assertTrue(mid.startswith("map1:"))
        self.assertNotEqual(mid, mid_full(d))

    def test_bind_selects_boolean(self):
        d = {"flag": True, "name": "x"}
        mid = mid_bind(d, ["/flag"])
        self.assertTrue(mid.startswith("map1:"))

    def test_bind_selects_integer(self):
        d = {"count": 42, "name": "x"}
        mid = mid_bind(d, ["/count"])
        self.assertTrue(mid.startswith("map1:"))

    def test_nonexistent_field_error(self):
        with self.assertRaises(MapError) as ctx:
            mid_bind({"a": "1"}, ["/a", "/nope"])
        self.assertEqual(ctx.exception.code, ERR_SCHEMA)

    def test_all_nonexistent_returns_empty_map(self):
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


# ── Canonical bytes / round-trip ──────────────────────────────

class TestCanonicalBytes(unittest.TestCase):
    def test_starts_with_header(self):
        cb = canonical_bytes_full({"a": "b"})
        self.assertTrue(cb.startswith(b"MAP1\x00"))

    def test_round_trip_string_only(self):
        d = {"hello": "world", "nested": {"k": "v"}}
        self.assertEqual(mid_full(d), mid_from_canon_bytes(canonical_bytes_full(d)))

    def test_round_trip_with_bool_and_int(self):
        d = {"active": True, "count": 42, "name": "test"}
        cb = canonical_bytes_full(d)
        self.assertEqual(mid_full(d), mid_from_canon_bytes(cb))

    def test_round_trip_all_scalars(self):
        for val in [True, False, 0, -1, 42, "hello", b"\x00\xff"]:
            with self.subTest(val=val):
                cb = canonical_bytes_full(val)
                self.assertEqual(mid_full(val), mid_from_canon_bytes(cb))


# ── mid_from_canon_bytes validation ───────────────────────────

class TestMidFromCanonBytes(unittest.TestCase):
    def test_bad_header(self):
        with self.assertRaises(MapError) as ctx:
            mid_from_canon_bytes(b"BADH\x00\x04\x00\x00\x00\x00")
        self.assertEqual(ctx.exception.code, ERR_CANON_HDR)

    def test_truncated_mcf(self):
        with self.assertRaises(MapError) as ctx:
            mid_from_canon_bytes(b"MAP1\x00\x04")
        self.assertEqual(ctx.exception.code, ERR_CANON_MCF)

    def test_trailing_bytes(self):
        cb = canonical_bytes_full({"a": "b"})
        with self.assertRaises(MapError) as ctx:
            mid_from_canon_bytes(cb + b"\x00")
        self.assertEqual(ctx.exception.code, ERR_CANON_MCF)

    def test_bad_boolean_payload(self):
        """BOOLEAN with payload 0x02 is malformed MCF, not a type error."""
        with self.assertRaises(MapError) as ctx:
            mid_from_canon_bytes(b"MAP1\x00\x05\x02")
        self.assertEqual(ctx.exception.code, ERR_CANON_MCF)

    def test_truncated_integer(self):
        with self.assertRaises(MapError) as ctx:
            mid_from_canon_bytes(b"MAP1\x00\x06\x00\x00")
        self.assertEqual(ctx.exception.code, ERR_CANON_MCF)

    def test_unknown_tag(self):
        with self.assertRaises(MapError) as ctx:
            mid_from_canon_bytes(b"MAP1\x00\xFF")
        self.assertEqual(ctx.exception.code, ERR_CANON_MCF)

    def test_key_order_violation(self):
        hdr = b"MAP1\x00"
        # MAP with 2 entries, key "b" before "a" (wrong order)
        k1 = b"\x01" + struct.pack(">I", 1) + b"b"
        v1 = b"\x01" + struct.pack(">I", 1) + b"1"
        k2 = b"\x01" + struct.pack(">I", 1) + b"a"
        v2 = b"\x01" + struct.pack(">I", 1) + b"2"
        canon = hdr + b"\x04" + struct.pack(">I", 2) + k1 + v1 + k2 + v2
        with self.assertRaises(MapError) as ctx:
            mid_from_canon_bytes(canon)
        self.assertEqual(ctx.exception.code, ERR_KEY_ORDER)


# ── JSON-STRICT adapter ──────────────────────────────────────

class TestJsonStrict(unittest.TestCase):
    def test_simple_json(self):
        self.assertEqual(mid_full_json(b'{"a": "b"}'), mid_full({"a": "b"}))

    def test_json_boolean(self):
        """v1.1: JSON true → BOOLEAN, not STRING."""
        self.assertEqual(mid_full_json(b'{"k": true}'), mid_full({"k": True}))
        self.assertNotEqual(mid_full_json(b'{"k": true}'), mid_full({"k": "true"}))

    def test_json_integer(self):
        """v1.1: JSON integers → INTEGER."""
        self.assertEqual(mid_full_json(b'{"n": 42}'), mid_full({"n": 42}))
        self.assertNotEqual(mid_full_json(b'{"n": 42}'), mid_full({"n": "42"}))

    def test_json_float_rejected(self):
        for raw in [b'{"n": 3.14}', b'{"n": 1.0}', b'{"n": 1e5}']:
            with self.subTest(raw=raw):
                with self.assertRaises(MapError) as ctx:
                    mid_full_json(raw)
                self.assertEqual(ctx.exception.code, ERR_TYPE)

    def test_json_null_rejected(self):
        with self.assertRaises(MapError) as ctx:
            mid_full_json(b'{"k": null}')
        self.assertEqual(ctx.exception.code, ERR_TYPE)

    def test_json_reordered_keys(self):
        self.assertEqual(
            mid_full_json(b'{"z": "1", "a": "2"}'),
            mid_full_json(b'{"a": "2", "z": "1"}'),
        )

    def test_duplicate_key(self):
        with self.assertRaises(MapError) as ctx:
            mid_full_json(b'{"a": "1", "a": "2"}')
        self.assertEqual(ctx.exception.code, ERR_DUP_KEY)

    def test_bom_rejected(self):
        with self.assertRaises(MapError) as ctx:
            mid_full_json(b'\xef\xbb\xbf{"a": "b"}')
        self.assertEqual(ctx.exception.code, ERR_SCHEMA)

    def test_invalid_utf8(self):
        with self.assertRaises(MapError) as ctx:
            mid_full_json(b'{"k": "\xff"}')
        self.assertEqual(ctx.exception.code, ERR_UTF8)

    def test_integer_overflow(self):
        with self.assertRaises(MapError) as ctx:
            mid_full_json(b'{"n": 9223372036854775808}')
        self.assertEqual(ctx.exception.code, ERR_TYPE)


class TestJsonBindStrict(unittest.TestCase):
    def test_bind_json(self):
        mid = mid_bind_json(b'{"a": "1", "b": "2"}', ["/a"])
        self.assertTrue(mid.startswith("map1:"))

    def test_bind_json_with_bool(self):
        mid = mid_bind_json(b'{"flag": true, "name": "x"}', ["/flag"])
        self.assertTrue(mid.startswith("map1:"))


# ── prepare() convenience function ────────────────────────────

class TestPrepare(unittest.TestCase):
    def test_float_to_string(self):
        result = prepare({"temp": 98.6})
        self.assertEqual(result["temp"], "98.600000")

    def test_float_precision(self):
        result = prepare({"pi": 3.14159}, float_precision=2)
        self.assertEqual(result["pi"], "3.14")

    def test_none_omitted_by_default(self):
        result = prepare({"a": "keep", "b": None})
        self.assertNotIn("b", result)
        self.assertEqual(result["a"], "keep")

    def test_none_raises_when_not_omitted(self):
        with self.assertRaises(MapError) as ctx:
            prepare({"a": None}, omit_none=False)
        self.assertEqual(ctx.exception.code, ERR_TYPE)

    def test_bool_passes_through(self):
        result = prepare({"active": True})
        self.assertIs(result["active"], True)

    def test_int_passes_through(self):
        result = prepare({"count": 42})
        self.assertEqual(result["count"], 42)

    def test_int_overflow_detected(self):
        with self.assertRaises(MapError):
            prepare({"big": 2**63})

    def test_nested_preparation(self):
        result = prepare({"config": {"temp": 72.5, "active": True, "notes": None}})
        self.assertEqual(result["config"]["temp"], "72.500000")
        self.assertIs(result["config"]["active"], True)
        self.assertNotIn("notes", result["config"])

    def test_list_preparation(self):
        """None in lists gets filtered out when omit_none=True."""
        result = prepare({"values": [1.5, None, True, 42]})
        # None is removed, float is stringified, bool and int pass through
        self.assertEqual(result["values"], ["1.500000", True, 42])

    def test_result_is_mid_compatible(self):
        """prepare() output should be directly usable with mid_full()."""
        raw = {"temp": 98.6, "active": True, "retries": 3}
        prepped = prepare(raw)
        mid = mid_full(prepped)
        self.assertTrue(mid.startswith("map1:"))


# ── Depth limits ──────────────────────────────────────────────

class TestDepthLimits(unittest.TestCase):
    def test_depth_32_ok(self):
        """32 levels of nesting is the maximum allowed."""
        d: dict = {"k": "leaf"}
        for _ in range(31):
            d = {"n": d}
        mid = mid_full(d)
        self.assertTrue(mid.startswith("map1:"))

    def test_depth_33_fails(self):
        d: dict = {"k": "leaf"}
        for _ in range(32):
            d = {"n": d}
        with self.assertRaises(MapError) as ctx:
            mid_full(d)
        self.assertEqual(ctx.exception.code, ERR_LIMIT_DEPTH)


# ── Size limits ───────────────────────────────────────────────

class TestSizeLimits(unittest.TestCase):
    def test_oversize_canon_bytes(self):
        with self.assertRaises(MapError) as ctx:
            mid_from_canon_bytes(b"MAP1\x00" + b"\x00" * (1_048_576 + 1))
        self.assertEqual(ctx.exception.code, ERR_LIMIT_SIZE)


# ── v1.0 backward compatibility ──────────────────────────────

class TestV10Compatibility(unittest.TestCase):
    """String-only MIDs should be identical between v1.0 and v1.1."""

    def test_deploy_prod_mid_unchanged(self):
        """The canonical example from the README."""
        mid = mid_full({"action": "deploy", "target": "prod", "version": "2.1.0"})
        self.assertEqual(
            mid,
            "map1:02f660092e372c2da0f87cefdecd1de9476eba39be2222b30637ba72178c5e7e",
        )


if __name__ == "__main__":
    unittest.main()
