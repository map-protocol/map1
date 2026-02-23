"""MAP v1 conformance test suite.

Runs all vectors from conformance_vectors.json against conformance_expected.json.
Usage:
    python tests/test_conformance.py [--vectors-dir DIR]
    python -m pytest tests/test_conformance.py -v
"""

from __future__ import annotations

import argparse
import base64
import json
import os
import sys
import unittest
from typing import Any, Dict, Optional, Tuple

# Ensure the package is importable when running from repo root
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from map1 import (
    MapError,
    mid_from_canon_bytes,
    mid_full_json,
    mid_bind_json,
)

# ── Locate conformance data ────────────────────────────────

_DEFAULT_VECTORS_DIR = os.path.join(
    os.path.dirname(__file__), "..", "..", "map1-bundle"
)

_VECTORS_DIR: Optional[str] = os.environ.get(
    "MAP1_VECTORS_DIR", None
)


def _vectors_dir() -> str:
    if _VECTORS_DIR:
        return _VECTORS_DIR
    # Try common locations
    candidates = [
        _DEFAULT_VECTORS_DIR,
        os.path.join(os.path.dirname(__file__), "..", "conformance"),
        os.path.join(os.path.dirname(__file__), ".."),
    ]
    for d in candidates:
        if os.path.isfile(os.path.join(d, "conformance_vectors.json")):
            return d
    raise FileNotFoundError(
        "Cannot locate conformance_vectors.json. "
        "Set MAP1_VECTORS_DIR or pass --vectors-dir."
    )


def _load_data() -> Tuple[list, dict]:
    d = _vectors_dir()
    with open(os.path.join(d, "conformance_vectors.json"), "r", encoding="utf-8") as f:
        vectors = json.load(f)["vectors"]
    with open(os.path.join(d, "conformance_expected.json"), "r", encoding="utf-8") as f:
        expected = json.load(f)["expected"]
    return vectors, expected


def _run_vector(vec: dict) -> Dict[str, Any]:
    """Run one conformance vector. Returns {"mid": ...} or {"err": ...}."""
    mode = vec["mode"]
    raw = base64.b64decode(vec["input_b64"])
    pointers = vec.get("pointers", [])

    try:
        if mode == "json_strict_full":
            mid = mid_full_json(raw)
            return {"mid": mid}
        elif mode == "json_strict_bind":
            mid = mid_bind_json(raw, pointers)
            return {"mid": mid}
        elif mode == "canon_bytes":
            mid = mid_from_canon_bytes(raw)
            return {"mid": mid}
        else:
            raise MapError("ERR_SCHEMA", f"unknown mode: {mode}")
    except MapError as e:
        return {"err": e.code}


# ── Unittest-based test class ──────────────────────────────

class ConformanceTests(unittest.TestCase):
    """Dynamically generated conformance tests (one per vector)."""
    pass


def _make_test(vec: dict, exp: dict):
    def test_method(self: unittest.TestCase) -> None:
        got = _run_vector(vec)
        self.assertEqual(got, exp, f"Vector {vec['test_id']}: got {got}, expected {exp}")
    return test_method


# Load vectors at module level and attach test methods
try:
    _vectors, _expected = _load_data()
    for _vec in _vectors:
        _tid = _vec["test_id"]
        _exp = _expected[_tid]
        _test_fn = _make_test(_vec, _exp)
        _test_fn.__name__ = f"test_{_tid}"
        _test_fn.__qualname__ = f"ConformanceTests.test_{_tid}"
        setattr(ConformanceTests, f"test_{_tid}", _test_fn)
except FileNotFoundError:
    pass  # Tests will simply not be generated


# ── CLI runner ──────────────────────────────────────────────

def main() -> None:
    global _VECTORS_DIR
    parser = argparse.ArgumentParser(description="MAP v1 conformance runner")
    parser.add_argument("--vectors-dir", default=None,
                        help="Directory containing conformance_vectors.json and conformance_expected.json")
    args, remaining = parser.parse_known_args()

    if args.vectors_dir:
        _VECTORS_DIR = args.vectors_dir
        os.environ["MAP1_VECTORS_DIR"] = args.vectors_dir

    # Quick standalone run (no unittest overhead)
    vectors, expected = _load_data()
    pass_count = 0
    fail_count = 0
    failures = []
    for vec in vectors:
        tid = vec["test_id"]
        got = _run_vector(vec)
        exp = expected[tid]
        if got == exp:
            pass_count += 1
        else:
            fail_count += 1
            failures.append((tid, got, exp))

    total = pass_count + fail_count
    print(f"CONFORMANCE: {pass_count}/{total} PASS")
    for tid, got, exp in failures:
        print(f"  FAIL {tid}: got={got} expected={exp}")

    if fail_count > 0:
        sys.exit(1)


if __name__ == "__main__":
    main()
