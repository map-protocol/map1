# Common Footguns

If you do the wrong thing, you will get the wrong identity. These are common failure modes.

## 1) Passing numbers or null through the JSON adapter

JSON numbers and null are not part of the MAP canonical model. If your JSON contains `{"count": 42}` or `{"value": null}`, the JSON-STRICT adapter will raise `ERR_TYPE`.

Why: MAP's type system is STRING, BYTES, LIST, MAP. Numbers have ambiguous canonical forms (is `1.0` the same as `1`? is `0.0` the same as `-0.0`?). `null` carries no meaningful identity contribution. Both are rejected to prevent canonicalization divergence.

Fix: Convert numbers to strings before passing to MAP. `{"count": "42"}` works. `{"count": 42}` does not.

## 2) Expecting key insertion order to matter

It doesn't. MAP sorts keys by unsigned-octet `memcmp` over their UTF-8 byte representation. `{"z":"1","a":"2"}` and `{"a":"2","z":"1"}` produce identical MIDs.

If you're using key order to carry meaning, MAP will erase it.

## 3) Assuming JSON.parse() detects duplicate keys

It doesn't. `JSON.parse('{"a":"1","a":"2"}')` silently keeps the last value.

MAP's JSON-STRICT adapter detects duplicates after escape resolution and raises `ERR_DUP_KEY`.

If you build from a language dict/map object (Python dict, JS object), duplicates have already been dropped. Use the JSON adapter if you need strict duplicate detection on raw JSON.

## 4) Unicode normalization differences

MAP does NOT normalize Unicode. NFC and NFD forms are different byte sequences and produce different MIDs.

If your system normalizes Unicode at ingestion, MIDs computed before and after normalization will differ.

Recommendation: Normalize to NFC before computing MIDs, and document this as policy for your system. MAP won't do it for you.

## 5) Mixing FULL and BIND MIDs

`mid_full(d)` and `mid_bind(d, ["/action", "/target"])` produce different MIDs. BIND is a projection; FULL is the entire descriptor.

Do not compare a FULL MID to a BIND MID and expect them to match.

## 6) Surrogate code points in strings

If your strings contain unpaired UTF-16 surrogates (possible in JavaScript edge cases), MAP will reject them with `ERR_UTF8`.

This is correct behavior. Surrogates are not valid Unicode scalar values. Clean your strings before passing to MAP.

## 7) Depth limit surprise

MAP enforces `MAX_DEPTH = 32` for nested containers. Deeply nested descriptors can hit `ERR_LIMIT_DEPTH`.

This is a safety limit. If you need deeper nesting, flatten your structure or reconsider your data model.

## 8) Bytes in the dict API vs JSON API

The dict/object API accepts Python `bytes` / Node `Buffer` values (BYTES type in MCF). JSON has no binary type, so JSON-STRICT cannot represent BYTES.

If you need cross-language parity through JSON, base64-encode bytes into a STRING and standardize that convention in your system.

## 9) Boolean mapping is silent

Both the dict API and JSON adapter map booleans to strings: `true → "true"`, `false → "false"`.

This means `{"k": true}` and `{"k": "true"}` produce the same MID.

If your system distinguishes boolean vs string `"true"`, MAP will not preserve that distinction.
