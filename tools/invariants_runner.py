#!/usr/bin/env python3
# tools/invariants_runner.py
#
# WS9 Determinism Invariants (property tests) + cross-implementation parity (python-mapref vs node-mapref).
#
# This runner:
# - generates random canonical models (MAP/LIST/STRING/BYTES) within limits
# - checks algebraic invariants in Python
# - compares MID/ERR against Node via tools/node_shim.js
#
# Exit code:
#   0 -> all checks passed
#   1 -> invariant violation or cross-impl mismatch

import os, sys, json, base64, random, hashlib, subprocess
from typing import Any, Dict, List, Optional

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
PY_IMPL = os.path.join(ROOT, "impl_python_mapref.py")
NODE_SHIM = os.path.join(ROOT, "tools", "node_shim.js")

# Import python mapref as a module
import importlib.util
spec = importlib.util.spec_from_file_location("mapref_py", PY_IMPL)
mapref = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mapref)

SEED = int(os.environ.get("MAP_SEED", "1337"))
TRIALS = int(os.environ.get("MAP_TRIALS", "2000"))
MAX_GEN_DEPTH = int(os.environ.get("MAP_GEN_MAX_DEPTH", "6"))
MAX_KEYS = int(os.environ.get("MAP_GEN_MAX_KEYS", "6"))
MAX_LIST = int(os.environ.get("MAP_GEN_MAX_LIST", "6"))
MAX_STR = int(os.environ.get("MAP_GEN_MAX_STR", "24"))
MAX_BYTES = int(os.environ.get("MAP_GEN_MAX_BYTES", "32"))

random.seed(SEED)

def b64(b: bytes) -> str:
    return base64.b64encode(b).decode("ascii")

def sha256_hex(b: bytes) -> str:
    return hashlib.sha256(b).hexdigest()

def rand_utf8_string() -> str:
    # Generate scalars excluding surrogate range; include tricky chars occasionally.
    out = []
    n = random.randint(0, MAX_STR)
    for _ in range(n):
        r = random.random()
        if r < 0.70:
            out.append(chr(random.randint(0x20, 0x7E)))
        elif r < 0.85:
            out.append(chr(random.randint(0xA0, 0xFF)))
        elif r < 0.95:
            cp = random.randint(0x0100, 0xD7FF)  # exclude surrogates
            out.append(chr(cp))
        else:
            cp = random.randint(0x10000, 0x10FFFF)
            out.append(chr(cp))
    return "".join(out)

def rand_bytes() -> bytes:
    return bytes(random.getrandbits(8) for _ in range(random.randint(0, MAX_BYTES)))

def gen_value(depth: int) -> Any:
    if depth >= MAX_GEN_DEPTH:
        return rand_utf8_string() if random.random() < 0.75 else rand_bytes()
    r = random.random()
    if r < 0.45:
        n = random.randint(0, MAX_KEYS)
        keys = [rand_utf8_string() for _ in range(n)]
        keys = list(dict.fromkeys(keys))  # de-dup
        d: Dict[str, Any] = {}
        for k in keys:
            d[k] = gen_value(depth + 1)
        return d
    if r < 0.75:
        n = random.randint(0, MAX_LIST)
        return [gen_value(depth + 1) for _ in range(n)]
    return rand_utf8_string() if random.random() < 0.7 else rand_bytes()

def mid_or_err_py(mode: str, input_bytes: bytes, pointers: Optional[List[str]] = None) -> Dict[str, str]:
    vec = {"mode": mode, "input_bytes": input_bytes}
    if pointers is not None:
        vec["pointers"] = pointers
    try:
        mid, err = mapref.run_vector(vec)
        if mid is not None:
            return {"mid": mid}
        return {"err": err}
    except mapref.MapError as e:
        return {"err": e.code}

def mid_or_err_node(mode: str, input_bytes: bytes, pointers: Optional[List[str]] = None) -> Dict[str, str]:
    payload = {"mode": mode, "input_b64": b64(input_bytes)}
    if pointers is not None:
        payload["pointers"] = pointers
    out = subprocess.check_output(["node", NODE_SHIM, json.dumps(payload)], cwd=ROOT)
    return json.loads(out.decode("utf-8"))

def canon_bytes_from_value(v: Any) -> bytes:
    return mapref.canon_bytes_from_value(v)

def bind_project(v: Any, pointers: List[str]) -> Any:
    return mapref.bind_project(v, pointers)

def check_equal(label: str, a: Dict[str, str], b: Dict[str, str], context: Dict[str, Any]) -> None:
    if a != b:
        print("MISMATCH:", label)
        print("PY :", a)
        print("NODE:", b)
        print("CTX:", json.dumps(context, ensure_ascii=False)[:2000])
        raise SystemExit(1)

def esc_ptr_token(token: str) -> str:
    return token.replace("~", "~0").replace("/", "~1")

def sample_pointers_from_map(v: Any) -> List[str]:
    # generate pointer set over existing keys only (MAP-only traversal)
    if not isinstance(v, dict) or len(v) == 0:
        return ["/nope"]
    keys = list(v.keys())
    k = random.choice(keys)
    p = "/" + esc_ptr_token(k)
    ps = [p]
    if isinstance(v.get(k), dict) and v[k]:
        ck = random.choice(list(v[k].keys()))
        ps.append(p + "/" + esc_ptr_token(ck))
    if random.random() < 0.25:
        ps.append("/nope")
    if random.random() < 0.10:
        ps = [""] + ps
    random.shuffle(ps)
    out = []
    for x in ps:
        if x not in out:
            out.append(x)
    return out

def main() -> int:
    for t in range(TRIALS):
        v = gen_value(0)
        root = v if isinstance(v, dict) else {"root": v}

        # (1) Canonical encode stability (encode twice same bytes)
        cb1 = canon_bytes_from_value(root)
        cb2 = canon_bytes_from_value(root)
        if cb1 != cb2:
            print("INVARIANT FAIL: canon encode stability")
            return 1

        # (2) Canon bytes parity python vs node (MID/ERR)
        py_out = mid_or_err_py("canon_bytes", cb1)
        node_out = mid_or_err_node("canon_bytes", cb1)
        check_equal("canon_bytes parity", py_out, node_out, {"trial": t})

        # (3)-(5) Projection invariants on JSON adapter path (only JSON-eligible trees; skip if bytes present)
        # We'll use json.dumps; if bytes exist, it will fail -> skip this trial for bind invariants.
        try:
            j = json.dumps(root, ensure_ascii=False).encode("utf-8")
        except TypeError:
            continue

        P = sample_pointers_from_map(root)

        py_proj = mid_or_err_py("json_strict_bind", j, pointers=P)
        node_proj = mid_or_err_node("json_strict_bind", j, pointers=P)
        check_equal("bind parity", py_proj, node_proj, {"trial": t, "pointers": P})

        if "mid" in py_proj:
            proj1 = bind_project(root, P)
            proj2 = bind_project(proj1, P)
            if canon_bytes_from_value(proj1) != canon_bytes_from_value(proj2):
                print("INVARIANT FAIL: projection idempotence", P)
                return 1

            # subsumption: if we have a parent/child pointer in P, verify parent alone equals parent+child
            for p in P:
                if p != "" and "/" in p[1:]:
                    parent = p.rsplit("/", 1)[0]
                    a = bind_project(root, [parent])
                    b = bind_project(root, [parent, p])
                    if canon_bytes_from_value(a) != canon_bytes_from_value(b):
                        print("INVARIANT FAIL: subsumption", parent, p)
                        return 1
                    break

            # order invariance
            P2 = list(P)
            random.shuffle(P2)
            a = bind_project(root, P)
            b = bind_project(root, P2)
            if canon_bytes_from_value(a) != canon_bytes_from_value(b):
                print("INVARIANT FAIL: pointer order invariance", P, P2)
                return 1

    print(f"OK: invariants passed for TRIALS={TRIALS} seed={SEED}")
    return 0

if __name__ == "__main__":
    raise SystemExit(main())
