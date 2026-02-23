#!/usr/bin/env python3
# tools/fuzz_runner.py
#
# WS11 Differential fuzzing (python-mapref vs node-mapref).
#
# Generates three fuzz categories:
#   A) random VALID canon trees -> canon_bytes -> canon_bytes mode
#   B) random JSON-STRICT texts (valid + invalid) -> json_strict_full
#   C) random BIND pointer sets -> json_strict_bind
#
# Any mismatch prints a minimal repro payload and exits non-zero.

import os, sys, json, base64, random, hashlib, subprocess
from typing import Any, Dict, List, Optional, Tuple

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
PY_IMPL = os.path.join(ROOT, "impl_python_mapref.py")
NODE_SHIM = os.path.join(ROOT, "tools", "node_shim.js")

import importlib.util
spec = importlib.util.spec_from_file_location("mapref_py", PY_IMPL)
mapref = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mapref)

SEED = int(os.environ.get("MAP_SEED", "4242"))
ROUNDS = int(os.environ.get("MAP_FUZZ_ROUNDS", "5000"))

random.seed(SEED)

def b64(b: bytes) -> str:
    return base64.b64encode(b).decode("ascii")

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

def mismatch(label: str, py: Dict[str,str], node: Dict[str,str], ctx: Dict[str,Any]) -> None:
    print("MISMATCH:", label)
    print("PY :", py)
    print("NODE:", node)
    print("CTX:", json.dumps(ctx, ensure_ascii=False)[:4000])
    raise SystemExit(1)

# --- generators ---

def rand_ascii(nmax: int) -> str:
    n = random.randint(0, nmax)
    return "".join(chr(random.randint(0x20,0x7E)) for _ in range(n))

def rand_json_valid() -> bytes:
    # JSON-eligible only: MAP/LIST/STRING
    def gen(depth: int):
        if depth > 5 or random.random() < 0.4:
            return rand_ascii(18)
        if random.random() < 0.6:
            d = {}
            for _ in range(random.randint(0,5)):
                d[rand_ascii(10)] = gen(depth+1)
            return d
        return [gen(depth+1) for _ in range(random.randint(0,5))]
    obj = gen(0)
    if not isinstance(obj, dict):
        obj = {"root": obj}
    return json.dumps(obj, ensure_ascii=False).encode("utf-8")

def rand_json_invalid() -> bytes:
    # Small set of known-invalid templates; keeps it deterministic.
    templates = [
        b'{"a":',                # unterminated
        b'{"a":"x",}',           # trailing comma
        b'{}{}',                 # two roots
        b'{"a":"\uD800"}',      # surrogate escape (should be ERR_UTF8)
        b'{"a":"\u0000',        # bad escape termination
    ]
    t = random.choice(templates)
    # Occasionally add random trailing bytes
    if random.random() < 0.3:
        t += b'xyz'
    return t

def rand_canon_tree() -> Any:
    # Canon-eligible: MAP/LIST/STRING/BYTES; ensure root is MAP
    def gen(depth: int):
        if depth > 5 or random.random() < 0.35:
            if random.random() < 0.75:
                return rand_ascii(18)
            return bytes(random.getrandbits(8) for _ in range(random.randint(0,24)))
        if random.random() < 0.6:
            d = {}
            for _ in range(random.randint(0,5)):
                d[rand_ascii(10)] = gen(depth+1)
            return d
        return [gen(depth+1) for _ in range(random.randint(0,5))]
    v = gen(0)
    return v if isinstance(v, dict) else {"root": v}

def esc_ptr_token(token: str) -> str:
    return token.replace("~","~0").replace("/","~1")

def pointers_for_obj(obj: dict) -> List[str]:
    keys = list(obj.keys())
    if not keys:
        return ["/nope"]
    k = random.choice(keys)
    ps = ["/"+esc_ptr_token(k)]
    if random.random() < 0.25:
        ps.append("/nope")
    if random.random() < 0.10:
        ps = [""] + ps
    random.shuffle(ps)
    out=[]
    for p in ps:
        if p not in out:
            out.append(p)
    return out

def main() -> int:
    for i in range(ROUNDS):
        r = random.random()

        # A) canonical trees -> canon_bytes mode
        if r < 0.40:
            tree = rand_canon_tree()
            cb = mapref.canon_bytes_from_value(tree)
            py = mid_or_err_py("canon_bytes", cb)
            node = mid_or_err_node("canon_bytes", cb)
            if py != node:
                mismatch("A canon_bytes", py, node, {"round": i})
            continue

        # B) JSON strict full (valid + invalid mix)
        if r < 0.75:
            raw = rand_json_valid() if random.random() < 0.7 else rand_json_invalid()
            py = mid_or_err_py("json_strict_full", raw)
            node = mid_or_err_node("json_strict_full", raw)
            if py != node:
                mismatch("B json_strict_full", py, node, {"round": i, "input_b64": b64(raw)})
            continue

        # C) JSON strict bind pointer fuzz
        raw = rand_json_valid()
        try:
            obj = json.loads(raw.decode("utf-8"))
        except Exception:
            continue
        if not isinstance(obj, dict):
            obj = {"root": obj}
        P = pointers_for_obj(obj)
        py = mid_or_err_py("json_strict_bind", raw, pointers=P)
        node = mid_or_err_node("json_strict_bind", raw, pointers=P)
        if py != node:
            mismatch("C json_strict_bind", py, node, {"round": i, "pointers": P, "input_b64": b64(raw)})

    print(f"OK: fuzz rounds={ROUNDS} seed={SEED} (no mismatches)")
    return 0

if __name__ == "__main__":
    raise SystemExit(main())
