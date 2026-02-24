# Frequently Asked Questions

## Where's the spec and conformance suite?

- Spec: [spec/MAP_v1.0.md](spec/MAP_v1.0.md)
- Conformance vectors: [tests/](tests/)
- Freeze contract: [GOVERNANCE.md](GOVERNANCE.md)
- Python: `pip install map-protocol`
- Node: `npm install @map-protocol/map1`

## Why not just sort JSON keys and hash?

For flat objects in one language, that works fine. MAP exists for the cases where it doesn't:

- Nested structures where sort order needs to apply recursively
- Cross-language boundaries where different JSON parsers handle escaping, Unicode, and whitespace differently
- Situations where you need a guarantee, not a best effort

The conformance vectors include cases where naive "sort and hash" approaches diverge across implementations. If your use case is single-language and flat, you probably don't need MAP.

## Why no numbers?

JavaScript uses IEEE 754 doubles for everything. Python separates int from float. Go has six numeric types. When the "same" number crosses a language boundary, the byte representation can change.

MAP rejects numbers entirely and asks you to encode them as strings. `"500"` not `500`. You pick the representation. MAP keeps the identity stable.

More detail in [DESIGN.md](DESIGN.md#why-no-numbers).

## Why no nulls?

Python has `None`. JavaScript has `null` and `undefined`. Go has zero values and `nil`. SQL has `NULL` with its own logic. If two systems can disagree about what null means, it can't be part of a deterministic protocol.

Omit the key, or use a sentinel string like `"__null__"`. Your domain, your rules.

## Does `true` and `"true"` really produce the same MID?

Yes. MAP has no boolean type. Booleans collapse to their string representation. Documented as footgun #9 in the spec.

If you need to tell them apart, encode the distinction yourself - `"bool:true"` vs `"true"`, for example.

## How is MAP different from JCS (RFC 8785)?

JCS canonicalizes JSON to JSON. MAP canonicalizes structured data to binary.

Big differences:
- JCS supports numbers. MAP doesn't.
- JCS output is JSON text. MAP output is binary (MCF format).
- JCS is JSON-specific. MAP accepts structured input from any source.
- MAP includes BIND projection - you can select a subset of fields before computing identity.

If you need JSON canonicalization and IEEE 754 number handling works for you, JCS is solid. MAP is for cases where you need cross-language byte-identical output with no wiggle room.

## How is MAP different from content-addressed storage (Git, IPFS)?

Git and IPFS hash raw bytes. Two JSON files with the same data but different field ordering get different hashes.

MAP canonicalizes the structure first, then hashes. Same data, same MID, regardless of how it was serialized.

## How is MAP different from Protocol Buffers?

Protobuf is a serialization format with schemas. MAP is schemaless and computes identity, not serialization.

Protobuf answers "how do I encode this data?" MAP answers "is this the same data?" Different jobs.

## What's a MID?

MAP Identity. Looks like:

```
map1:a1b2c3d4e5f6...
```

`map1:` prefix identifies the protocol version. The rest is lowercase hex SHA-256 of the canonical bytes. If v2 ever happens, it gets a `map2:` prefix. No ambiguity between versions.

## What languages are supported?

Python and Node.js right now. Both zero-dependency, both conformance-tested against all 53 vectors.

Go and Rust are next. Any new implementation has to pass the full conformance suite before it ships.

## Can I contribute?

Yes. See [CONTRIBUTING.md](CONTRIBUTING.md). The spec is frozen but implementations, docs, tooling, and new conformance vectors are all open.

## Is this production-ready?

The spec is frozen. The implementations pass all conformance vectors. The vectors are append-only.

It's early in terms of adoption. But the protocol is designed for production use. MIDs computed today will be valid forever. That's the point.
