# Freeze Contract — MAP v1.0

This document is the trust anchor for MAP v1.0.

Developers store MIDs in databases. Those MIDs must remain valid.

## Frozen (will never change)

The following protocol surfaces are frozen and will never change:

- CANON_HDR: `b"MAP1\x00"`
- MCF type tags:
  - STRING = `0x01`
  - BYTES  = `0x02`
  - LIST   = `0x03`
  - MAP    = `0x04`
- MID prefix: `"map1:"`
- Hash algorithm: SHA-256
- Key ordering: unsigned-octet memcmp over UTF-8 bytes

Any MID produced by a conformant v1.0 implementation will be reproducible by all future versions of MAP.

## May be added in future versions

Future versions may add:

- New MCF type tags (`0x05+`)
- New adapter profiles
- New projection modes
- Additional conformance vectors

## Will never be done

Future versions will never:

- Change behavior of existing types
- Change behavior of existing projections
- Remove or modify existing conformance vectors
- Change the MID output for any input that is valid under v1.0

## Conformance vectors

Conformance vectors are append-only:

- Add new vectors as needed
- Never modify or remove existing vectors
