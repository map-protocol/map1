# map1

Deterministic identity for structured data.

map1 canonicalizes structured input and derives a stable identifier:

    MID = "map1:" + sha256(CANON_BYTES)

Identical input → identical MID, across languages and runtimes.

Repo: https://github.com/map-protocol/map1  
Maintainer: Aaron Gerard Davidson  
Contact: agdavidson@gmail.com

---

## Install

Python:

    pip install map1

Node:

    npm install map1

---

## Example

Input:

    {"action":"deploy","target":"prod","version":"2.1.0"}

FULL MID:

    map1:02f660092e372c2da0f87cefdecd1de9476eba39be2222b30637ba72178c5e7e

Python:

    from map1 import mid_full
    print(mid_full({"action":"deploy","target":"prod","version":"2.1.0"}))
    # → map1:02f660092e372c2da0f87cefdecd1de9476eba39be2222b30637ba72178c5e7e

Node:

    const { midFull } = require("map1");
    console.log(midFull({action:"deploy",target:"prod",version:"2.1.0"}));
    // → map1:02f660092e372c2da0f87cefdecd1de9476eba39be2222b30637ba72178c5e7e

Reordered keys produce the same MID:

    {"version":"2.1.0","action":"deploy","target":"prod"}
    → map1:02f660092e372c2da0f87cefdecd1de9476eba39be2222b30637ba72178c5e7e

Changing a value changes the MID:

    {"action":"deploy","target":"staging","version":"2.1.0"}
    → map1:2c636ba86104e45afcbaacaf8df6e85d8e17cc05e02d114446a9e1081efefd5d

---

## API (v1.0)

Python:

    from map1 import (
        mid_full,
        mid_bind,
        canonical_bytes_full,
        canonical_bytes_bind,
        mid_from_canon_bytes,
    )

Node / TS:

    import {
        midFull,
        midBind,
        canonicalBytesFull,
        canonicalBytesBind,
        midFromCanonBytes,
    } from "map1"

Functions:

    mid_full(descriptor) → "map1:..."
    mid_bind(descriptor, pointer_set) → "map1:..."
    mid_full_json(raw_bytes) → "map1:..."
    mid_bind_json(raw_bytes, pointer_set) → "map1:..."
    canonical_bytes_full(descriptor) → bytes / Buffer
    canonical_bytes_bind(descriptor, pointer_set) → bytes / Buffer
    mid_from_canon_bytes(canon_bytes) → "map1:..."

---

## CLI

    echo '{"action":"deploy"}' | map1 mid --full
    echo '{"action":"deploy"}' | map1 mid --bind /action
    map1 mid --full --file mutation.json
    map1 canon --full --file mutation.json | sha256sum
    map1 version

---

## Not Included

- No policy or authorization
- No signing
- No storage
- No schema validation

map1 is identity only.

---

## Why Not Just Hash the JSON?

JSON is not canonical. Key order, whitespace, escape sequences, and number formatting vary across serializers. `sha256('{"a":"1","b":"2"}')` and `sha256('{"b":"2","a":"1"}')` produce different hashes for the same data. map1 solves this.

---

## Cross-Language Guarantee

map1 v1.0 guarantees identical MID output for identical input across all conformant implementations.

Current: Python, Node  
Planned: Go, Rust

---

## Conformance

All implementations must pass the official conformance suite (53/53 vectors).

- Spec: /spec/MAP_v1.0.md
- Quickstart: /docs/quickstart_10min.md
- Use cases: /docs/use_cases.md
- Conformance: /conformance/
- Implementer checklist: /docs/implementer_checklist.md
- Common footguns: /docs/common_footguns.md
- Design notes: /docs/design_notes.md

---

License: MIT
