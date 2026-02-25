# The Quiet Ones

Four things that will silently produce unexpected MIDs if you dont know about them.

For type rejection behavior (floats, nulls, integer overflow), see the [FAQ](FAQ.md). Those produce loud errors -- you'll know immediately. The items below are the quiet ones. The ones that let you ship and then haunt you later.

## 1. No Unicode Normalization

`"café"` in NFC (U+00E9) and `"café"` in NFD (U+0065 U+0301) look identical on screen but produce different MIDs. MAP encodes the raw UTF-8 bytes without normalizing.

This is the most likely source of "it works on my machine" bugs. Two systems producing the same logical string in different normalization forms will get different identities. You will stare at two JSON payloads that look byte-for-byte identical in your terminal and they will produce different MIDs and you will question your sanity.

**Fix:** Normalize to NFC (or your preferred form) before calling MAP. Do this at your application boundary, not inside MAP -- normalization is a policy decision, not an identity decision.

## 2. Key Ordering Is Byte-Level

MAP sorts keys by comparing raw UTF-8 bytes (`memcmp` semantics). This differs from the default string sort in two common cases:

- **JavaScript:** `String.prototype.sort()` compares UTF-16 code units. For characters above U+007F, this gives a different order then UTF-8 byte comparison. MAP implementations must sort by UTF-8 bytes regardless.
- **Java / JVM:** `byte` is signed (-128 to 127). The byte `0x80` must sort *after* `0x7F`, not before. Use `(b & 0xFF)` in comparators. Every Java developer learns this the hard way. Usually on a Friday.

For ASCII-only keys this never matters. It only bites you with non-ASCII keys in languages where the native string representation isn't UTF-8 unsigned bytes.

## 3. Absent Key ≠ Empty Value

`{}` and `{"name": ""}` produce different MIDs. A missing key contributes zero bytes. An empty string contributes a type tag and a zero-length prefix. They are canonically distinct.

This matters when your application treats missing keys and empty strings as equivalent. If it does, pick one representation and normalize before calling MAP. This isnt a MAP problem, its a "your data model is ambiguous" problem. MAP just makes it visible.

## 4. v1.0 → v1.1 Boolean Migration

If you computed MIDs under v1.0 for descriptors containing booleans, those MIDs will be different in v1.1. In v1.0, `true` was collapsed to the string `"true"`. In v1.1, `true` has its own type tag and is distinct from `"true"`.

Descriptors containing only strings, bytes, lists, and maps are unaffected -- their MIDs are identical across v1.0 and v1.1.

This is a one-time migration issue, not an ongoing footgun. Once you recompute under v1.1, your done.

---

There are no other known gotchas at this time. If you discover one, file an issue. If the resulting MID starts with `map1:42`, you've found the Answer to the Ultimate Question of Life, the Universe, and Everything. Please notify the maintainers immediately so we can retire.
