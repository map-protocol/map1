# Why MAP Makes the Choices It Makes

**Quick version:** MAP produces a deterministic fingerprint for structured data. It uses four types (string, bytes, list, map), rejects numbers and nulls, canonicalizes to a binary format, and ships with 53 conformance vectors. The spec is frozen. These choices are opinionated. Here's why.

---

I'm a security architect. I've spent my career watching structured data move between systems and quietly change along the way. MAP exists because I needed a protocol-level answer to a question that kept coming up: **is this the same thing?**

The spec tells you *what*. This document tells you *why*.

---

## Why only four types?

MAP supports strings, bytes, lists, and maps. That's it.

I went back and forth on this. Five types? Six? Every time I added one, I added a new surface where two implementations in two languages could disagree about encoding. And disagreement is the one thing this protocol can't tolerate.

Four types is the minimum set that can represent meaningful structured data while keeping determinism airtight. Strings cover text. Bytes cover binary. Lists cover ordered sequences. Maps cover key-value structures. Everything else you can build from these.

## Why no numbers?

This draws the most pushback and I get it. Numbers feel fundamental. But they're also the single biggest source of cross-language divergence in structured data.

Try serializing `1000000000000000.5` across a few languages:

- JavaScript uses IEEE 754 doubles for everything. That value quietly loses precision.
- Python separates `int` (arbitrary precision) from `float` (IEEE 754). The same JSON number might parse as either depending on whether it has a decimal point.
- Go has `int`, `int32`, `int64`, `float32`, `float64`. Same JSON, different types, different behavior.
- Erlang, Rust, Java - all different again.

For most applications these differences don't matter. For a deterministic identity protocol, they break the whole thing. If two languages can reasonably disagree about how to represent the same number in canonical bytes, then the MID isn't stable. And an unstable MID is worse than no MID.

I considered three options:

1. **Pick a canonical number format** like IEEE 754 double. But this silently loses precision for integers larger than 2^53, which includes things like database row IDs and financial amounts. Not acceptable for a security tool.
2. **Support multiple number types** (int, float, bigint, decimal). But then every implementation has to agree on type selection rules from ambiguous input. This is where things like JCS get complicated.
3. **Reject numbers entirely.** Make users encode them as strings with their own rules. `"500"` not `500`.

I went with option 3. It's the most restrictive, but it's the only one where I can guarantee determinism without caveats. If you need numbers, encode them as strings. You control the representation. MAP controls the identity.

## Why no nulls?

Null means different things depending on where you are:

- JSON has `null`
- Python has `None`
- JavaScript has `null` AND `undefined`
- Go has zero values plus `nil`
- SQL has `NULL` with three-valued logic
- Some formats distinguish "field is null" from "field is absent"

If two systems can reasonably disagree about what null means, then including it in the type system creates ambiguity. And ambiguity is what MAP exists to eliminate.

Instead: omit the key, or use a sentinel string like `"__null__"` with whatever semantics make sense for your domain. The choice of how to represent absence should be yours, not the protocol's.

## Why do booleans collapse to strings?

There's no boolean type in MAP. When it sees `true`, it encodes it as the string `"true"`. Same for `false`.

So yes - `[true]` and `["true"]` produce the same MID. This is documented as [footgun #9](spec/MAP_v1.0.md) in the spec.

I thought about adding a fifth type for booleans. But booleans have a fuzzy boundary problem. In JSON they're clear. But MAP isn't just for JSON - it accepts structured data from anywhere. In YAML, environment variables, CLI arguments, database values, the line between "boolean" and "string that looks like a boolean" gets blurry fast.

So I collapsed them. The cost is you can't distinguish `true` from `"true"` at the MID level. If that matters in your domain, encode it differently - `"bool:true"` vs `"true"`, for example.

Consistency over expressiveness. I went back and forth on this one too.

## Why a custom binary format?

JCS (RFC 8785) exists. It canonicalizes JSON to JSON. Why not use it?

Two things bothered me about that approach:

**JSON isn't unambiguous at the byte level.** Even canonicalized, JSON allows multiple valid UTF-8 representations of the same string (escaped vs unescaped characters). JCS handles a lot of these cases, but the surface area for string encoding divergence across implementations is bigger than I was comfortable with.

**JCS supports numbers.** Which means JCS includes number canonicalization rules based on IEEE 754 double serialization. See above for why that's a problem.

MAP's canonical format (MCF) is binary with exactly one valid encoding for any given value. No alternatives, no options, no implementation-dependent choices. If two implementations produce different bytes for the same input, one of them has a bug, full stop. The [conformance vectors](tests/) exist to catch exactly that.

## Why 53 conformance vectors?

Every vector is there because it represents a real edge case where a naive "sort keys and hash" approach produces divergent results across implementations.

Some examples:

- Unicode strings outside the Basic Multilingual Plane
- Strings at Unicode scalar boundary values
- Maps with keys that differ only in normalization
- Deeply nested structures
- Empty everything - strings, maps, lists
- Byte sequences that look like valid UTF-8 but get handled differently by different decoders

The vectors are append-only. Once added, never removed. The bar only goes up.

Both Python and Node pass all 53. Any future implementation (Go, Rust, whatever) has to pass them too before it ships. No exceptions.

## Why freeze the spec?

A deterministic identity protocol is only useful if you can trust that the same input produces the same identity forever. If the spec changes, old MIDs might not match new ones computed from the same data. That kills the whole point.

So MAP v1.0 is frozen. The spec doesn't change. If we need improvements, they go into MAP v2 with a different prefix. v1 MIDs stay valid indefinitely.

This means v1 might not be perfect. But it will always be consistent. For an identity protocol, I'll take consistent over perfect every time.

## Why memcmp ordering for map keys?

Map keys are sorted by raw byte comparison. Not Unicode collation, not locale-specific ordering. Raw bytes.

It's the simplest ordering that works identically everywhere. Unicode collation varies by locale and implementation. Byte comparison doesn't. Two implementations sorting the same bytes by memcmp will always agree.

Simple. Universal. Done.

## Why reject duplicate keys?

If a map has the same key twice, which value wins?

- Python: last one
- JavaScript: last one (usually)
- Go: last one
- Some XML/YAML parsers: first one
- Some strict parsers: error

Rather than pick a winner, MAP rejects duplicates. If your input has duplicate keys, fix your input. You can't build a deterministic identity on top of ambiguous data.

## The short version

MAP says no to a lot of things. No numbers, no nulls, no booleans as a distinct type, no duplicate keys, no spec changes. Every "no" closes a door where two implementations could disagree.

The value of MAP depends entirely on those doors staying closed. That's the whole design philosophy in one sentence.

If you disagree with a decision, I want to hear it. Open an issue. These choices were made carefully but I don't pretend they're the only valid ones. The spec is frozen, but the conversation isn't.

-AD
