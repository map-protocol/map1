# MAP v1 -- Deterministic Identity for Structured Data

[![CI](https://github.com/map-protocol/map1/actions/workflows/ci.yml/badge.svg)](https://github.com/map-protocol/map1/actions)
[![npm](https://img.shields.io/npm/v/@map-protocol/map1)](https://www.npmjs.com/package/@map-protocol/map1)
[![PyPI](https://img.shields.io/pypi/v/map-protocol)](https://pypi.org/project/map-protocol/)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

MAP computes deterministic identifiers for structured data. Same input, same hash, every language, every time. No opinions, no magic.

A payload is authored at point A, passes through serialization boundaries (middleware, queues, API gateways), and MAP lets you verify at point B that nothing changed. Not semantically equivalent. Identical.

MAP is identity-only. It does not grant authority, assert safety, or have feelings about your architecture.

```
Descriptor --> Canonical Bytes (MCF) --> SHA-256 --> MID
                                                    map1:02f660...
```

The full picture:

```
     +--------+       +--------------+       +----------+
     | Author |------>|   Pipeline   |------>| Consumer |
     +--------+       +--------------+       +----------+
      mid_full()       queues, APIs,          mid_full()
      = "receipt"      agents, LLMs,          = recompute
                       gateways               compare. done.
```

## Don't Panic!

A deployment descriptor is approved:

```python
from map1 import mid_full

approved = {"action": "deploy", "target": "prod", "version": "2.1.0"}
receipt = mid_full(approved)
# map1:02f660092e372c2da0f87cefdecd1de9476eba39be2222b30637ba72178c5e7e
```

Later, at execution time, the system reconstructs the descriptor from whatever it received -- maybe it went through a message queue, a config renderer, an API gateway -- and recomputes:

```python
received = {"target": "prod", "action": "deploy", "version": "2.1.0"}  # keys reordered
assert mid_full(received) == receipt  # same MID -- nothing was mutated
```

Different key order, same MID. Run it in Node, Go, or Rust -- same MID. Thats the entire point.

## Where It Fits

MAP produces identifiers you can use as receipts, anchors, and audit evidence. Every example below is the same pattern: a single structured payload moves through a pipeline, and you need to know whether it arrived intact.

- **Agent action receipts.** An AI agent proposes an action. A human approves it. Before execution, recompute the MID. If it doesn't match the approval receipt, something was mutated between authorization and execution. Fail closed.
- **CI/CD artifact identity.** Tag build outputs with the MID of their build configuration. If the config MID matches a previous build, the inputs were identical.
- **Configuration drift.** Store the MID of expected configuration. Periodically recompute from live state. Different MID means something drifted.
- **Audit trails.** Log the MID of every state transition. Compact, deterministic, independently verifiable across languages.
- **Idempotency keys.** Use the MID as a natural dedup key -- no synthetic UUIDs.
- **Delegated actions.** If a payload gets narrowed or rewritten across multiple services, compute a new MID at each hop. Identity makes delegation auditable.

### When NOT to Use MAP

If you control both ends of your pipeline and your serialization is already deterministic, you probably don't need MAP. If you just need a checksum inside one language, use hashlib. If you need semantic equivalence (is this float *close enough* to that float?), MAP is the wrong tool -- it's bitwise-identical or it's different, theres no "close enough." MAP exists for the messy middle: structured data crossing boundaries you dont fully control, where you need to know it survived intact.

## Install

```bash
pip install map-protocol          # Python 3.9+
npm install @map-protocol/map1    # Node 16+
```

Go and Rust implementations are also available under `implementations/`.

## Try It

```bash
echo '{"action":"deploy","target":"prod","version":"2.1.0"}' | map1 mid --full
# map1:02f660092e372c2da0f87cefdecd1de9476eba39be2222b30637ba72178c5e7e
```

Reorder the keys, run it again. Same MID.

Or try it in the browser: **[Interactive Playground](https://map-protocol.github.io/map1/playground/)** -- paste JSON, see the full MCF pipeline.

## Python

```python
from map1 import mid_full, prepare

# Strings, booleans, integers -- all produce deterministic MIDs
mid_full({"action": "deploy", "target": "prod", "version": "2.1.0"})
# -> 'map1:02f660092e372c2da0f87cefdecd1de9476eba39be2222b30637ba72178c5e7e'

# v1.1 type distinction: booleans and integers are their own types
mid_full({"active": True, "count": 42, "name": "test"})
# -> 'map1:cd04f06f8fcfa1136cb8b1dc405fc161e8e783968d3f889582506a18e83f4b0c'

# Got floats? prepare() converts them to strings
raw = {"temp": 98.6, "active": True, "notes": None}
mid_full(prepare(raw))
# floats -> strings, None -> omitted, then hashed
```

## Node.js / TypeScript

```typescript
import { midFull, midFullJson } from '@map-protocol/map1';

midFull({ action: 'deploy', target: 'prod', version: '2.1.0' });
// -> 'map1:02f660092e372c2da0f87cefdecd1de9476eba39be2222b30637ba72178c5e7e'

// JSON-STRICT mode for untrusted input (catches dups, surrogates, BOM)
midFullJson(Buffer.from('{"active":true,"count":42,"name":"test"}'));
// -> 'map1:cd04f06f8fcfa1136cb8b1dc405fc161e8e783968d3f889582506a18e83f4b0c'
```

## CLI

```bash
# FULL -- hash everything
echo '{"action":"deploy","target":"prod"}' | map1 mid --full

# BIND -- hash only selected fields
echo '{"action":"deploy","target":"prod","ts":"2026-02-24"}' | map1 mid --bind /action /target

# Strict validation (duplicate keys, BOM, surrogates)
map1 mid --full --json-strict < descriptor.json

# Canonical bytes for debugging
echo '{"a":"b"}' | map1 canon --full
```

## But, What Is This?!

MAP defines a six-type data model (STRING, BYTES, LIST, MAP, BOOLEAN, INTEGER), a binary encoding called MCF, and a SHA-256 hash over the result. The output is a `map1:`-prefixed hex digest called a MID.

The guarantee: if two descriptors have the same content, they produce the same MID -- regardless of JSON key order, whitespace, serialization format, or programming language. MAP doesn't care whether the input came from JSON, CBOR, YAML, or a native data structure.

An important distinction: MAP is not a tool for making two different systems agree on what a value *means*. If System A represents a quantity as a float and System B represents it as an integer, MAP won't reconcile that -- and shouldn't try. MAP verifies that a specific payload you authored wasn't modified in transit. You control the schema and the representation. MAP verifies the bytes didn't change between where you produced them and where you consumed them.

## How MAP Compares

| | MAP | JCS (RFC 8785) | Content hashing |
|---|---|---|---|
| **Output** | Identifier (MID) | Canonical JSON text | Raw hash |
| **Deterministic** | Yes -- binary canonical form | Yes -- within JSON | No -- key order, whitespace vary |
| **Input format** | Any (JSON, native types, CBOR) | JSON only | JSON only |
| **Cross-language** | Yes -- spec + 95 conformance vectors | Depends on implementation | No guarantee |
| **Floats** | Rejected (encode as string) | IEEE 754 normalization | Included (non-deterministic) |

JCS canonicalizes JSON *text*. MAP canonicalizes a *data model* and hashes it. If you need canonical JSON output, use JCS. If you need a deterministic identifier for structured data that might cross language and serialization boundaries, MAP is what you want.

## On the Subject of Floats

MAP rejects floats because IEEE 754 makes cross-platform determinism impossible. Encode them as strings with your desired precision -- Python's `prepare()` does this automatically. See [DESIGN.md](docs/DESIGN.md) for the full rationale and [FAQ.md](docs/FAQ.md) if your still not convinced.

## Projections

FULL hashes the entire descriptor. BIND selects specific fields by JSON Pointer path -- useful when you want a stable identity over a subset while ignoring volatile metadata like timestamps.

```python
from map1 import mid_bind

descriptor = {"action": "deploy", "target": "prod", "version": "2.1.0", "timestamp": "2026-02-24T10:00:00Z"}
mid_bind(descriptor, ["/action", "/target"])
# Only "action" and "target" contribute to the MID
```

## 95 Vectors. Zero Tolerance.

Four implementations. Every vector must match exactly -- both MID output and error codes. If two implementations disagree on a single bit, thats a protocol failure.

```bash
make conformance    # runs all languages
```

## Performance

Not a bottleneck. Python does ~150k MIDs/sec for typical small descriptors, Node is comparable. O(n log n) for key sorting, linear in payload size, SHA-256 only, no allocations you wouldn't expect. See [benchmarks](docs/BENCHMARKS.md) for real numbers across payload sizes.

## Resources

- [Specification (v1.1)](spec/MAP_v1.1.md)
- [10-Minute Quickstart](docs/quickstart_10min.md)
- [Design Decisions](docs/DESIGN.md)
- [FAQ](docs/FAQ.md)
- [Benchmarks](docs/BENCHMARKS.md)
- [Gotchas](docs/gotchas.md)
- [Implementer Checklist](docs/implementer_checklist.md)
- [Playground](https://map-protocol.github.io/map1/playground/)
- [Changelog](CHANGELOG.md)

## License

MIT
