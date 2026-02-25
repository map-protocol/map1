# FAQ

## Does MAP solve data type differences between systems?

No. MAP is transit integrity, not type reconciliation.

If System A produces `{"temperature": 98.6}` (a float) and System B produces `{"temperature": "98.6"}` (a string), those are different data and MAP will correctly give them different MIDs. MAP doesn't try to make heterogeneous systems agree on representation — that's a schema design problem, not an identity problem.

What MAP does: you author a structured payload at point A, it moves through a pipeline (serialization, middleware, queues, gateways), and at point B you verify that nothing changed. You control the schema. You decide the representation before the payload enters the pipeline. MAP tells you if the bytes survived transit intact.

## Why can't I use floats?

MAP rejects floats because IEEE 754 makes cross-platform agreement impossible. NaN, signed zero, precision loss, and representation ambiguity all break determinism.

Encode floats as strings with your desired precision. Python's `prepare()` helper does this automatically:

```python
from map1 import prepare, mid_full

raw = {"temperature": 98.6, "active": True, "retries": 3}
prepared = prepare(raw)
# {'temperature': '98.600000', 'active': True, 'retries': 3}
mid_full(prepared)
```

In other languages, convert floats to strings before passing them to MAP.

## What happens if I pass `3.14`?

`ERR_TYPE`. The JSON-STRICT adapter rejects any number with a decimal point or exponent. Encode it as the string `"3.14"` instead.

## What about `1.0`? It's mathematically an integer.

Still `ERR_TYPE`. The token `1.0` contains a decimal point, so it's classified as a float and rejected. MAP makes this decision at the token level, not the mathematical level. Use `1` for an integer, or `"1.0"` (a string) if you need the decimal representation.

## What about big integers beyond int64 range?

`ERR_TYPE`. MAP supports signed 64-bit integers: −9,223,372,036,854,775,808 to 9,223,372,036,854,775,807. Anything outside that range is rejected.

Encode large integers as strings:

```python
mid_full({"big_number": str(2**128)})
```

## My boolean MIDs changed from v1.0!

Yes. This is intentional and documented in the [CHANGELOG](../CHANGELOG.md).

In v1.0, booleans were collapsed to strings: `true` → `"true"`. In v1.1, booleans have their own type tag. This means `{"active": true}` produces a different MID in v1.1 than it did in v1.0. Descriptors that only contain strings, bytes, lists, and maps are unaffected.

If you have stored v1.0 MIDs for descriptors containing booleans, you'll need to recompute them under v1.1.

## Can I use MAP for content-addressable storage?

Yes. MIDs are SHA-256 digests over deterministic canonical bytes, so they work well as storage keys. Two descriptors with the same content always produce the same MID — deduplication is automatic.

One thing to be aware of: MIDs identify the canonical form, not the original serialization. Two JSON documents that differ only in whitespace or key order will produce the same MID. That's usually what you want.

## Is MAP a replacement for JCS (RFC 8785)?

No. Different scope.

JCS canonicalizes JSON text — it defines a single "correct" way to serialize a JSON value as bytes. The output is still JSON. MAP defines a binary canonical form for a six-type data model, then hashes it. The output is an identifier, not serialization.

MAP doesn't care whether your input was JSON, CBOR, YAML, or a language-native data structure. If you need canonical JSON, use JCS. If you need a deterministic identifier for structured data regardless of where it came from, use MAP.

## Does MAP normalize Unicode?

No, by design. See [DESIGN.md](DESIGN.md) for the rationale.

If `"café"` is encoded as NFC in one descriptor and NFD in another, they produce different MIDs. If your application needs normalization, normalize before calling MAP.

## What's the difference between FULL and BIND projection?

FULL computes the MID over the entire descriptor. BIND selects specific fields by JSON Pointer path and computes the MID over only those fields.

```python
descriptor = {"action": "deploy", "target": "prod", "debug": True}

mid_full(descriptor)  # includes all three fields
mid_bind(descriptor, ["/action", "/target"])  # only action and target
```

BIND is useful when you want a stable identity over a subset — for example, binding to just the action and target while ignoring volatile metadata.

## What types does MAP support?

Six types in v1.1: STRING, BYTES, LIST, MAP, BOOLEAN, INTEGER.

These are the types every mainstream language agrees on. Notably absent: floats (not portable), nulls (semantics diverge across languages), dates/times (encode as STRING), and sets (use LIST with application-level dedup).

## How do I handle `None`/`null` values?

Omit the key. MAP rejects null values with `ERR_TYPE`.

Python's `prepare()` function strips `None` keys by default:

```python
from map1 import prepare, mid_full

raw = {"name": "test", "notes": None}
prepared = prepare(raw)
# {'name': 'test'}  — notes key omitted
mid_full(prepared)
```

## What happens with duplicate keys in JSON?

The JSON-STRICT adapter detects duplicate keys after JSON escape resolution and raises `ERR_DUP_KEY`. The first occurrence is kept during parsing, but the error is raised after checking for higher-precedence errors like `ERR_TYPE` from nulls or `ERR_UTF8` from surrogates.
