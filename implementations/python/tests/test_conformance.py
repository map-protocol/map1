"""MAP v1.1 conformance test suite.

Runs all vectors from conformance_vectors_v11.json against conformance_expected_v11.json.
Falls back to v1.0 filenames if v1.1 files aren't present.

Usage:
    python tests/test_conformance.py [--vectors-dir DIR]
    python -m pytest tests/test_conformance.py -v
    PYTHONPATH=. MAP1_VECTORS_DIR=../../conformance python tests/test_conformance.py
"""

from __future__ import annotations

import argparse
import base64
import json
import os
import sys
import unittest
from typing import Any, Dict, List, Optional, Tuple

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from map1 import (
    MapError,
    mid_from_canon_bytes,
    mid_full_json,
    mid_bind_json,
)

# ── Locate conformance data ───────────────────────────────────

_VECTORS_DIR: Optional[str] = os.environ.get("MAP1_VECTORS_DIR", None)


def _find_vectors_dir() -> str:
    if _VECTORS_DIR:
        return _VECTORS_DIR
    candidates = [
        os.path.join(os.path.dirname(__file__), "..", "..", "..", "conformance"),
        os.path.join(os.path.dirname(__file__), "..", "..", "conformance"),
        os.path.join(os.path.dirname(__file__), "..", "conformance"),
        os.path.join(os.path.dirname(__file__), ".."),
    ]
    for d in candidates:
        # Prefer v1.1 files, fall back to v1.0
        if os.path.isfile(os.path.join(d, "conformance_vectors_v11.json")):
            return d
        if os.path.isfile(os.path.join(d, "conformance_vectors.json")):
            return d
    raise FileNotFoundError(
        "Cannot find conformance vectors. Set MAP1_VECTORS_DIR or --vectors-dir."
    )


def _load_data() -> Tuple[List[dict], Dict[str, dict], str]:
    """Load vectors and expected values.  Returns (vectors, expected, version)."""
    d = _find_vectors_dir()

    # Try v1.1 first
    v11_vec = os.path.join(d, "conformance_vectors_v11.json")
    v11_exp = os.path.join(d, "conformance_expected_v11.json")
    if os.path.isfile(v11_vec) and os.path.isfile(v11_exp):
        with open(v11_vec, "r", encoding="utf-8") as f:
            vectors = json.load(f)["vectors"]
        with open(v11_exp, "r", encoding="utf-8") as f:
            expected = json.load(f)["expected"]
        return vectors, expected, "1.1"

    # Fall back to v1.0
    with open(os.path.join(d, "conformance_vectors.json"), "r", encoding="utf-8") as f:
        vectors = json.load(f)["vectors"]
    with open(os.path.join(d, "conformance_expected.json"), "r", encoding="utf-8") as f:
        expected = json.load(f)["expected"]
    return vectors, expected, "1.0"


def _run_vector(vec: dict) -> Dict[str, Any]:
    """Execute one conformance vector.  Returns {"mid": ...} or {"err": ...}."""
    mode = vec["mode"]
    raw = base64.b64decode(vec["input_b64"])
    ptrs = vec.get("pointers", [])

    try:
        if mode == "json_strict_full":
            return {"mid": mid_full_json(raw)}
        elif mode == "json_strict_bind":
            return {"mid": mid_bind_json(raw, ptrs)}
        elif mode == "canon_bytes":
            return {"mid": mid_from_canon_bytes(raw)}
        else:
            return {"err": "UNKNOWN_MODE"}
    except MapError as e:
        return {"err": e.code}


# ── unittest integration ──────────────────────────────────────

class ConformanceTests(unittest.TestCase):
    """Dynamically generated: one test method per vector."""
    pass


def _make_test(vec: dict, exp: dict):
    def test_fn(self: unittest.TestCase) -> None:
        got = _run_vector(vec)
        self.assertEqual(got, exp,
                         "{}: got {} expected {}".format(vec["test_id"], got, exp))
    return test_fn


# Attach test methods at import time.
try:
    _vectors, _expected, _version = _load_data()
    for _vec in _vectors:
        _tid = _vec["test_id"]
        _exp = _expected[_tid]
        _fn = _make_test(_vec, _exp)
        _fn.__name__ = "test_{}".format(_tid)
        _fn.__qualname__ = "ConformanceTests.test_{}".format(_tid)
        setattr(ConformanceTests, "test_{}".format(_tid), _fn)
except FileNotFoundError:
    pass


# ── Standalone CLI runner ─────────────────────────────────────

def main() -> None:
    global _VECTORS_DIR

    parser = argparse.ArgumentParser(description="MAP v1 conformance runner")
    parser.add_argument("--vectors-dir", default=None,
                        help="Directory with conformance vector files")
    args, _remaining = parser.parse_known_args()

    if args.vectors_dir:
        _VECTORS_DIR = args.vectors_dir
        os.environ["MAP1_VECTORS_DIR"] = args.vectors_dir

    vectors, expected, version = _load_data()

    passed = 0
    failed = 0
    failures: List[Tuple[str, dict, dict]] = []

    for vec in vectors:
        tid = vec["test_id"]
        got = _run_vector(vec)
        exp = expected[tid]
        if got == exp:
            passed += 1
        else:
            failed += 1
            failures.append((tid, got, exp))

    total = passed + failed
    print("CONFORMANCE (v{}): {}/{} PASS".format(version, passed, total))
    for tid, got, exp in failures:
        print("  FAIL {}: got={} expected={}".format(tid, got, exp))

    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
