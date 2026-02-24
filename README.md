[![CI](https://github.com/map-protocol/map1/actions/workflows/ci.yml/badge.svg)](https://github.com/map-protocol/map1/actions)
[![PyPI](https://img.shields.io/pypi/v/map-protocol)](https://pypi.org/project/map-protocol/)
[![npm](https://img.shields.io/npm/v/@map-protocol/map1)](https://www.npmjs.com/package/@map-protocol/map1)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Conformance](https://img.shields.io/badge/conformance-53%2F53-brightgreen)](conformance/)

# MAP v1.0 - Deterministic Identity for Structured Data

MAP is a small protocol I built after running into the same problem too many times: structured data crosses a system boundary and you can't reliably prove it's the same thing on the other side.

Same input, same ID, every time, regardless of what language produced it or how it was serialized along the way.

```
Input (any language/runtime)
        │
        ▼
   Canonicalize (MCF binary format)
        │
        ▼
     SHA-256
        │
        ▼
   map1:02f660...
```

---

## Get started

```
pip install map-protocol          # Python
npm install @map-protocol/map1    # Node
```

```python
from map1 import mid_full

mid_full({"action": "deploy", "target": "prod", "version": "2.1.0"})
# → map1:02f660092e372c2da0f87cefdecd1de9476eba39be2222b30637ba72178c5e7e
```

Don't trust me - verify it yourself: [browser playground](https://map-protocol.github.io/map1/)

Reorder the keys, re-serialize it, compute it in a different language - same MID:

```
{"version":"2.1.0","action":"deploy","target":"prod"}
→ map1:02f660092e372c2da0f87cefdecd1de9476eba39be2222b30637ba72178c5e7e
```

Change a single value and the MID changes:

```
{"action":"deploy","target":"staging","version":"2.1.0"}
→ map1:2c636ba86104e45afcbaacaf8df6e85d8e17cc05e02d114446a9e1081efefd5d
```

---

## Why does this exist?

JSON is not canonical. The same data serialized by different systems produces different bytes. Different bytes means different hashes. Different hashes means you can't answer the question "is this the same thing?" across a system boundary.

This matters when structured data passes through middleware, serializers, retry logic, orchestrators, or any pipeline where the payload might get reformatted between point A and point B. If you need to verify that what arrived is what was sent - not just similar, but identical - you need a canonicalization step before you hash.

MAP defines a canonical binary format (MCF) with exactly one valid encoding for any given input. No ambiguity, no implementation-dependent choices. Two conformant implementations will always produce the same bytes for the same logical data. The MID is just the SHA-256 of those bytes with a `map1:` prefix.

I built this after running into the same problem over and over. CI/CD pipelines, API idempotency checks, agent-driven workflows. There wasn't a clean protocol-level answer I could point to and say: use this.

More on the design reasoning: [DESIGN.md](DESIGN.md)

---

## What's in the box

- **Frozen spec** - 483 lines, locked under [governance contract](GOVERNANCE.md). It doesn't change.
- **Python implementation** - zero dependencies. `pip install map-protocol`
- **Node implementation** - zero dependencies. `npm install @map-protocol/map1`
- **53 conformance vectors** - append-only, never removed. Both implementations pass all 53 identically.
- **CLI tools** for both languages
- **Browser playground** - try it without installing anything: [map-protocol.github.io/map1/](https://map-protocol.github.io/map1/)
- **MIT licensed**

---

## Type system

MAP supports four types: **strings**, **bytes**, **lists**, and **maps**.

No numbers. No nulls. No booleans as a distinct type.

These are deliberate choices to ensure cross-language determinism. JavaScript's number handling is different from Python's is different from Go's. Rather than pick a side, MAP rejects them. If you need a number, encode it as a string.

Booleans collapse to their string representation (`true` becomes `"true"`). This means `[true]` and `["true"]` produce the same MID. That's documented as footgun #9 in the spec and explained in [DESIGN.md](DESIGN.md#why-do-booleans-collapse-to-strings).

If you're thinking "those are weird choices" - I understand. Read [DESIGN.md](DESIGN.md) for the full reasoning. The short version: determinism over convenience, every time.

---

## API

Python:

```python
from map1 import (
    mid_full,
    mid_bind,
    canonical_bytes_full,
    canonical_bytes_bind,
    mid_from_canon_bytes,
)
```

Node / TypeScript:

```javascript
import {
    midFull,
    midBind,
    canonicalBytesFull,
    canonicalBytesBind,
    midFromCanonBytes,
} from "map1"
```

| Function | What it does |
|---|---|
| `mid_full(descriptor)` | MID of the full descriptor |
| `mid_bind(descriptor, pointer_set)` | MID of selected fields only (BIND projection) |
| `canonical_bytes_full(descriptor)` | Raw canonical bytes before hashing |
| `mid_from_canon_bytes(canon_bytes)` | MID from pre-computed canonical bytes |

---

## CLI

```bash
echo '{"action":"deploy"}' | map1 mid --full
echo '{"action":"deploy"}' | map1 mid --bind /action
map1 mid --full --file mutation.json
map1 canon --full --file mutation.json | sha256sum
map1 version
```

---

## What MAP is not

MAP is intentionally narrow. It does one thing and tries to do it predictably. It's meant to be a primitive, not a framework.

- No policy or authorization
- No signing
- No storage
- No schema validation

It answers one question: **is this the same thing?**

What you build on top of that answer is up to you.

---

## Cross-language guarantee

Any conformant implementation produces the same MID for the same input. Currently: Python and Node. Planned: Go, Rust.

All implementations must pass the full [conformance suite](conformance/) (53 vectors, zero tolerance).

---

## Docs

- [DESIGN.md](DESIGN.md) - Why MAP makes the choices it makes
- [FAQ.md](FAQ.md) - Common questions and quick answers
- [Spec](spec/MAP_v1.0.md) - The full 483-line specification
- [Quickstart](docs/quickstart_10min.md) - Get running in 10 minutes
- [Use cases](docs/use_cases.md) - Where MAP fits
- [Common footguns](docs/common_footguns.md) - Things that will trip you up
- [Implementer checklist](docs/implementer_checklist.md) - Building a new implementation
- [Contributing](CONTRIBUTING.md) - How to help

---

## About

Built by [Aaron Davidson](https://www.linkedin.com/in/aaron-gerard-davidson/). Security architect. Spent my career watching structured data quietly change between systems and finally decided to do something about it.

Questions, feedback, or bugs: [open an issue](https://github.com/map-protocol/map1/issues) or email agdavidson@gmail.com.

---

License: [MIT](LICENSE)
