# Conformance Suite

The conformance suite defines compatibility for map1.

## Files

- `conformance_vectors.json` — inputs and test parameters
- `conformance_expected.json` — expected outputs (`mid` or `err`)
- `PASS_REPORT.schema.json` — machine-verifiable report schema
- `verify_bundle.py` — bundle verification tooling

## Vectors

There are 53 vectors covering:

- FULL and BIND modes
- Canon-bytes input mode
- All error codes and edge cases

Each vector includes:

- `test_id`
- `mode`
- `input_b64`
- `pointers` (optional)

Modes include:

- `json_strict_full`
- `json_strict_bind`
- `canon_bytes`

Expected outputs are either:

- `{"mid": "map1:..."}`
- `{"err": "ERR_*"}`

All implementations must pass 53/53. Zero tolerance.

Vectors are append-only: never modify or remove existing vectors.

## Running

Python (from repo root):

    PYTHONPATH=implementations/python MAP1_VECTORS_DIR=conformance python implementations/python/tests/test_conformance.py

Node (from repo root):

    MAP1_VECTORS_DIR=conformance node --test implementations/node/tests/conformance.test.js

`MAP1_VECTORS_DIR` must point to this directory.

## PASS_REPORT

Implementations must emit a PASS_REPORT (see schema):

- implementation name + version
- spec version
- vectors passed/failed
- `spec_sha256`, `vectors_sha256`, `expected_sha256`

PASS_REPORT is how we prevent silent conformance drift.
