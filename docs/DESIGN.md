# Design Decisions

This document explains the "why" behind MAP's design choices. If you're looking for "how," see the [spec](../spec/MAP_v1.1.md). If you're looking for "what do I do when," see the [FAQ](FAQ.md).

## What Problem MAP Solves (and What It Doesn't)

MAP solves transit integrity for structured data. You author a descriptor at point A — an agent action, a build configuration, a policy document — and it moves through your pipeline. Middleware, queues, API gateways, config renderers. At point B, you need to know: is this the same payload I started with?

MAP gives you a deterministic identifier (a MID) that answers that question. Same content, same MID, regardless of key order, serialization format, or programming language. Different content, different MID.

MAP does **not** solve data compatibility between heterogeneous systems. If System A represents a temperature as `98.6` (float) and System B represents it as `"98.6"` (string), MAP will correctly give those different MIDs — because they are, in fact, different data. MAP doesn't reconcile type differences between systems. It tells you whether data you control survived a pipeline without mutation. The "you control" part is critical: you decide the representation before the payload enters the pipeline.

## Why Six Types?

MAP v1.1 recognizes six types: STRING, BYTES, LIST, MAP, BOOLEAN, and INTEGER.

These are the structural primitives that every mainstream programming language agrees on. Python, JavaScript, Go, Rust, Java, C# — they all have strings, byte arrays, ordered collections, key-value maps, booleans, and integers. The type system is the intersection of what's portable.

v1.0 had four types (STRING, BYTES, LIST, MAP). That turned out to be insufficient — see the next two sections.

## Why Not Four Types?

v1.0 collapsed booleans to strings: `true` became `"true"`, `false` became `"false"`. This created a collision: `{"active": true}` and `{"active": "true"}` produced the same MID.

That's a real problem. Consider an agent receipt where `{"approved": true}` means "human approved this action" and `{"approved": "true"}` means "the string 'true' was in a text field." Those are semantically different and must produce different identities.

v1.1 fixes this by giving booleans their own type tag (0x05). The canonical bytes for `true` are `4d415031000501` — the MAP1 header, tag 0x05, payload 0x01. The canonical bytes for `"true"` start with tag 0x01 (STRING). Different bytes, different hash, different MID.

## Why Integers but Not Floats?

Integers are portable. Every language can represent 42 as 42, and the bit pattern for a signed 64-bit integer is the same everywhere. MAP encodes integers as 8-byte big-endian int64. No ambiguity.

Floats are not portable. IEEE 754 has edge cases that break cross-platform agreement:

- **NaN.** IEEE 754 defines many NaN bit patterns. `NaN != NaN` in most languages. Which NaN is canonical?
- **Signed zero.** `-0.0` and `+0.0` compare equal but have different bit patterns.
- **Precision.** `0.1 + 0.2 != 0.3` in IEEE 754. Different runtimes can produce different least-significant bits for the same computation.
- **Representation.** Is it `1.0`, `1.00`, `1e0`, or `10e-1`? All represent the same value but produce different bytes when serialized.

MAP's job is deterministic identity. Floats undermine that, so they're excluded. If you have float data, encode it as a string with your desired precision: `"3.14"`, `"98.600000"`. Python's `prepare()` does this automatically. See the [FAQ](FAQ.md) for examples in other languages.

## Why Booleans Are Distinct

`true` and `"true"` must produce different MIDs because they carry different semantic weight. A boolean `true` in a descriptor means the system asserted a binary yes/no. A string `"true"` means four characters appeared in a text field. Conflating them — as v1.0 did — is a source of subtle bugs and potential security issues in authorization flows.

In v1.1, `true` encodes as `MAP1\x00\x05\x01` and `"true"` encodes with tag `0x01` (STRING) plus a 4-byte length and the UTF-8 bytes. Different type tags, different canonical bytes, different MIDs:

- `true` → `map1:725480164f1866ff09e52192d3a6e4ed30814b7ad2eadf01e2c47225ffd5ca53`
- `false` → `map1:2bac0aba4b5dc2bc0f6d0aa3782558d0278c8a3b1dc0f9121b821c433e030e5c`

## Why No Nulls?

Null means different things in different languages and contexts. In JSON it's a value, in Python `None` is a singleton, in SQL it means "unknown" with three-valued logic, in Go the zero value of a pointer is `nil` but the zero value of an `int` is `0`. Many APIs treat a missing key and a key with value `null` as different things; others don't.

MAP can't pick a canonical semantics for null without being wrong for someone. Instead: if a field has no value, omit the key. If you need to distinguish "absent" from "explicitly empty," use a sentinel string like `""`. Python's `prepare()` function strips `None` keys by default.

## Why No Unicode Normalization?

Unicode defines multiple ways to encode the same visual character. The letter "é" can be a single code point (U+00E9, NFC) or a base letter plus combining accent (U+0065 U+0301, NFD). Most humans can't tell them apart. Most software doesn't normalize consistently.

MAP does not normalize. If you feed in NFC, you get one MID. NFD, a different MID. This is intentional.

Normalization is a silent data transformation. If MAP normalized, then two descriptors that are byte-for-byte different would produce the same MID — breaking the property that MID equality implies byte-level input equality. It would also mean every MAP implementation needs a Unicode normalization library, which is a complex, version-dependent dependency.

If your application needs normalization, normalize before calling MAP. That way the choice is explicit and visible, not hidden inside the identity computation.

## Why memcmp Key Ordering?

MAP sorts MAP keys by comparing their raw UTF-8 byte sequences — `memcmp` ordering. Not locale-aware alphabetical order. Not Unicode code point order. Not UTF-16 code unit order. Raw unsigned-byte comparison.

This is the simplest possible ordering rule. Every language has a way to compare byte arrays. No locale tables, no collation algorithms, no platform-dependent behavior.

One subtlety worth knowing: `memcmp` ordering differs from JavaScript's default string sort for characters above U+007F because JavaScript sorts by UTF-16 code units, not UTF-8 bytes. And Java's `String.compareTo()` uses signed byte comparison, which puts bytes above 0x7F in the wrong position. MAP implementations must sort by unsigned UTF-8 bytes regardless of the host language's quirks.

## Why Token-Level Float Detection?

MAP rejects `1.0` even though the mathematical value is an integer. The decision is made at the JSON token level, not the mathematical value level. If the token contains a decimal point or exponent notation, it's a float, and floats are rejected.

Why not accept `1.0` as integer 1? Because Python's `json.loads("1.0")` returns `float(1.0)`, which is mathematically equal to `int(1)` — but the JSON source had a decimal point. If we accepted `1.0` as an integer, then `{"count": 1}` and `{"count": 1.0}` would produce the same MID, hiding a real difference in the source data.

The rule is simple: integers look like `42`, `-7`, `0`. Anything with `.` or `e`/`E` is rejected. Use `"1.0"` (a string) if you need to represent a decimal value.
