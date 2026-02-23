# Versioning

MAP uses two version tracks:

- Spec versions (protocol semantics)
- Implementation versions (SDK/package releases)

## Spec v1.0

v1.0 is frozen. See `FREEZE_CONTRACT.md`.

Future minor versions (v1.1, v1.2, …) may add features, but must not alter any v1.0 MID output for valid v1.0 input.

## Major versions

A major version (v2.0) would be a separate protocol. It would use a different CANON_HDR and a different MID prefix, so v1 and v2 identities cannot be confused.

## Conformance and versions

Conformance vectors track spec behavior.

- Passing the conformance suite is required for compatibility.
- Vectors are append-only.
