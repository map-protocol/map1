#!/usr/bin/env python3
"""
verify_bundle.py — hostile-auditable verifier for MAP Freeze Candidate Bundle.

Checks:
1) manifest.sha256 integrity (sha256(file-bytes) for each listed artifact)
2) bundle_anchor_sha256 = sha256(manifest.sha256 bytes)
3) PASS report bindings: PASS_*.json must reference exact artifact hashes from byte hashes
4) Optional: re-run implementations to regenerate PASS reports and compare (requires python3 + node)

Exit code 0 on success; non-zero on failure.
"""
from __future__ import annotations
import argparse, hashlib, json, os, subprocess, sys
from pathlib import Path

def sha256_file(p: Path) -> str:
    return hashlib.sha256(p.read_bytes()).hexdigest()

def die(msg: str) -> None:
    print("FAIL:", msg, file=sys.stderr)
    sys.exit(2)

def parse_manifest(manifest_path: Path):
    lines = manifest_path.read_text(encoding="utf-8").splitlines()
    entries = []
    for ln in lines:
        ln = ln.strip()
        if not ln or ln.startswith("#"):
            continue
        parts = ln.split()
        if len(parts) != 2:
            die(f"bad manifest line: {ln!r}")
        h, rel = parts
        if len(h) != 64:
            die(f"bad sha256 in manifest line: {ln!r}")
        entries.append((h.lower(), rel))
    return entries

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dir", default=".", help="bundle directory")
    ap.add_argument("--rerun", action="store_true", help="re-run implementations and compare PASS outputs")
    args = ap.parse_args()

    root = Path(args.dir).resolve()
    manifest = root / "manifest.sha256"
    if not manifest.exists():
        die("manifest.sha256 missing")

    entries = parse_manifest(manifest)

    # 1) manifest integrity
    for expected_hash, rel in entries:
        p = root / rel
        if not p.exists():
            die(f"manifest references missing file: {rel}")
        got = sha256_file(p)
        if got != expected_hash:
            die(f"hash mismatch for {rel}: got {got} expected {expected_hash}")

    # 2) anchor hash (manifest is non-circular and does not list itself)
    anchor = hashlib.sha256(manifest.read_bytes()).hexdigest()
    print("bundle_anchor_sha256 =", anchor)

    # 3) PASS bindings must match computed byte hashes
    spec_h   = sha256_file(root / "MAP_v1_Uber_Spec_v0.2.6.txt")
    vec_h    = sha256_file(root / "conformance_vectors.json")
    exp_h    = sha256_file(root / "conformance_expected.json")
    schema_h = sha256_file(root / "PASS_REPORT.schema.json")

    for pass_name in ["PASS_python.json", "PASS_node.json"]:
        p = root / pass_name
        if not p.exists():
            die(f"missing {pass_name}")
        report = json.loads(p.read_text(encoding="utf-8"))
        for field, want in [("spec_sha256", spec_h), ("vectors_sha256", vec_h), ("expected_sha256", exp_h), ("schema_sha256", schema_h)]:
            if report.get(field) != want:
                die(f"{pass_name} field {field} mismatch: got {report.get(field)} expected {want}")
        if not (isinstance(report.get("fail_count"), int) and report.get("fail_count") == 0):
            die(f"{pass_name} fail_count != 0")
        # Ensure referenced hashes also exist in manifest
        manifest_hashes = {h for h,_ in entries}
        for h in [spec_h, vec_h, exp_h, schema_h]:
            if h not in manifest_hashes:
                die(f"{pass_name} references hash not present in manifest: {h}")

    # 4) Optional rerun
    if args.rerun:
        # rerun python
        py_out = root / "_PASS_python_rerun.json"
        cmd = [sys.executable, str(root/"impl_python_mapref.py"),
               "--spec", str(root/"MAP_v1_Uber_Spec_v0.2.6.txt"),
               "--vectors", str(root/"conformance_vectors.json"),
               "--expected", str(root/"conformance_expected.json"),
               "--schema", str(root/"PASS_REPORT.schema.json"),
               "--out", str(py_out)]
        subprocess.check_call(cmd)
        # rerun node
        node_out = root / "_PASS_node_rerun.json"
        cmd = ["node", str(root/"impl_node_mapref.js"),
               "--spec", str(root/"MAP_v1_Uber_Spec_v0.2.6.txt"),
               "--vectors", str(root/"conformance_vectors.json"),
               "--expected", str(root/"conformance_expected.json"),
               "--schema", str(root/"PASS_REPORT.schema.json"),
               "--out", str(node_out)]
        subprocess.check_call(cmd)

        # compare with shipped PASS (ignore timestamps/platform strings)
        def load_core(pth: Path):
            r = json.loads(pth.read_text(encoding="utf-8"))
            core_keys = ["implementation_name","implementation_version","language","limits",
                         "spec_sha256","vectors_sha256","expected_sha256","schema_sha256",
                         "total_tests","pass_count","fail_count","failures"]
            return {k: r.get(k) for k in core_keys}
        if load_core(py_out) != load_core(root/"PASS_python.json"):
            die("python rerun PASS core differs from shipped PASS_python.json")
        if load_core(node_out) != load_core(root/"PASS_node.json"):
            die("node rerun PASS core differs from shipped PASS_node.json")

        # cleanup
        py_out.unlink(missing_ok=True)
        node_out.unlink(missing_ok=True)

    print("OK")
    return 0

if __name__ == "__main__":
    raise SystemExit(main())
