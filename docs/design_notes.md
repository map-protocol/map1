# Design Notes

This document explains a few choices behind MAP v1.0.

## Worked MCF Encoding Example

Input JSON:

    {"b":"2","a":"1"}

Step 1: Parse JSON. Two keys: "b" and "a".

Step 2: Sort keys by UTF-8 memcmp:
- "a" (0x61) < "b" (0x62)
Sorted order: [("a","1"), ("b","2")].

Step 3: Encode as MCF (hex):

    04                     ← MAP tag (0x04)
    00 00 00 02            ← count = 2 (uint32be)
    01 00 00 00 01 61      ← key "a": STRING tag + len=1 + 0x61
    01 00 00 00 01 31      ← val "1": STRING tag + len=1 + 0x31
    01 00 00 00 01 62      ← key "b": STRING tag + len=1 + 0x62
    01 00 00 00 01 32      ← val "2": STRING tag + len=1 + 0x32

Step 4: Prepend CANON_HDR:

    4d 41 50 31 00         ← "MAP1" + 0x00

Full CANON_BYTES (hex):

    4d 41 50 31 00 04 00 00 00 02 01 00 00 00 01 61
    01 00 00 00 01 31 01 00 00 00 01 62 01 00 00 00
    01 32

Step 5: MID = "map1:" + sha256(CANON_BYTES).

## Depth Counting

Containers increment depth. Scalars do not.

    {                          ← depth 1 (root MAP)
      "config": {              ← depth 2 (nested MAP)
        "rules": [             ← depth 3 (LIST inside MAP)
          "allow",             ← depth 3 (scalar, no increment)
          {                    ← depth 4 (MAP inside LIST)
            "port": "443"      ← depth 4 (scalar, no increment)
          }
        ]
      },
      "name": "prod"           ← depth 1 (scalar, no increment)
    }

MAX_DEPTH=32 means the deepest container can be at depth 32.
A container at depth 33 triggers ERR_LIMIT_DEPTH.

## Key Ordering (Why memcmp matters)

The spec requires unsigned-octet memcmp over UTF-8 bytes.
Any other ordering is a conformance violation.

Example:

- Key A: "\x7f" (U+007F) → UTF-8 bytes: 7F
- Key B: "\x80" (U+0080) → UTF-8 bytes: C2 80

UTF-8 memcmp compares bytes (unsigned):
- 0x7F < 0xC2 → "\x7f" sorts before "\x80" (required)

Do not use locale collation or language-native string ordering as a substitute.

## Why No Numbers

JSON numbers have ambiguous canonical forms. `1.0`, `1`, `1.00`, `1e0` represent the same value but have different text. IEEE 754 adds -0.0 vs +0.0, NaN behavior, and multiple NaN bit patterns.

MAP avoids numeric canonicalization entirely. Convert numbers to strings before computing MIDs.

## Why No null

`null` carries no information and forces awkward identity questions (`{"k": null}` vs `{}`). MAP rejects null. If you need to represent absence, omit the key.
