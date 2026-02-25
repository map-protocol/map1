# FAQ

## Does MAP solve data type differences between systems?

No. And it shouldn't.

If System A produces `{"temperature": 98.6}` (a float) and System B produces `{"temperature": "98.6"}` (a string), those are different data and MAP will correctly give them different MIDs. MAP doesn't try to make heterogeneous systems agree on representation -- that's a schema design problem, not an identity problem.

What MAP does: you author a structured payload at point A, it moves through a pipeline (serialization, middleware, queues, gateways), and at point B you verify that nothing changed. You control the schema. You decide the representation before the payload enters the pipeline. MAP tells you if the bytes survived transit intact.

## Why can't I use floats?

MAP rejects floats because IEEE 754 makes cross-platform agreement impossible. NaN, signed zero, precision loss, and representation ambiguity all break determinism. This isn't us being difficult -- its just math.

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

Still `ERR_TYPE`. The token `1.0` contains a decimal point, so its classified as a float and rejected. MAP makes this decision at the token level, not the mathematical level. Use `1` for an integer, or `"1.0"` (a string) if you need the decimal representation.

We know this feels aggressive. It's intentional. The alternative is a class of bugs where `1.0` and `1` silently produce the same MID on some platforms and different MIDs on others. We chose loud failure over silent divergence.

## What about big integers beyond int64 range?

`ERR_TYPE`. MAP supports signed 64-bit integers: -9,223,372,036,854,775,808 to 9,223,372,036,854,775,807. Anything outside that range is rejected.

Encode large integers as strings:

```python
mid_full({"big_number": str(2**128)})
```

## My boolean MIDs changed from v1.0!

Yes. This is intentional and documented in the [CHANGELOG](../CHANGELOG.md).

In v1.0, booleans were collapsed to strings: `true` -> `"true"`. This meant `{"active": true}` and `{"active": "true"}` produced the same MID, which is a real problem if one means "the system asserted yes" and the other means "someone typed the word true into a text field." v1.1 fixes this. Booleans have there own type tag now. Different types, different MIDs.

Descriptors that only contain strings, bytes, lists, and maps are unaffected.

## Why not just use JCS?

JCS (RFC 8785) canonicalizes JSON text. MAP canonicalizes a data model. If your data is always JSON and always stays JSON and never crosses a language boundary, JCS might be fine for your use case.

MAP exists for the case where a descriptor starts as a Python dict, gets serialized to JSON, passes through a Node.js middleware, gets deserialized and reserialized, and arrives at a Go service. JCS would require every hop to produce identical JSON text. MAP doesn't care about the text -- it hashes a canonical binary encoding of the data model, so the serialization path is irrelevant.

## Is MAP a replacement for digital signatures?

No. MAP tells you *what* was said. Signatures tell you *who* said it. They solve different problems and are complementary. A reasonable pattern: sign the MID, not the raw payload. The MID is compact, deterministic, and doesn't depend on serialization format.

## Can I use MAP with CBOR/MessagePack/Protobuf?

MAP's canonical model is format-agnostic. The current normative adapter is JSON-STRICT, but theres nothing stopping you from writing an adapter that ingests CBOR or any other format and maps it to the six canonical types. The MID will be the same as long as the canonical model values are the same.

A CBOR adapter profile is on the roadmap. See the [issues](https://github.com/map-protocol/map1/issues).

## Why is the header "MAP1\x00" and not something more descriptive?

Five bytes. The "1" is the major version of the canonical framing. The NUL terminator makes it easy to detect in a hex dump and provides a clean boundary for C-style string handling. Its short because it prefixes every single CANON_BYTES value and we didn't want to waste space on vanity.
