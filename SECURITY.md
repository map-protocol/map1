# Security

## Reporting a Vulnerability

Email **agdavidson@gmail.com** with the subject line `MAP security: <brief description>`.

You'll get an acknowledgment within 48 hours. If the issue is confirmed, we'll coordinate a fix before public disclosure. Please don't open a public issue for security bugs.

## Threat Model

MAP is an identity protocol, not an authority protocol. It computes deterministic hashes — it does not sign, encrypt, authenticate, or authorize. MAP does not provide authorization or access control. If you're using MAP correctly, a vulnerability means one of:

1. **Collision at the canonical layer.** Two semantically different descriptors produce identical CANON_BYTES. This would be a spec bug. SHA-256 collisions are outside MAP's threat model (they're a hash function problem, not a canonical encoding problem).

2. **Fork at the adapter layer.** Two conforming implementations produce different CANON_BYTES for the same input. This is the most likely class of bug — the JSON adapter has the most surface area (Unicode escapes, duplicate keys, number parsing). The conformance suite exists specifically to catch these.

3. **Denial of service via limits.** Deeply nested or oversized inputs that bypass safety limits and cause excessive allocation. MAX_CANON_BYTES (1 MiB), MAX_DEPTH (32), and entry count limits exist for this reason. Implementations must enforce limits before allocation.

## What MAP Does NOT Protect Against

- **Orphan MIDs.** If you accept a MID from an untrusted source without reconstructing CANON_BYTES yourself, you're trusting the caller's encoding. Always recompute at trust boundaries (see spec Appendix A2).
- **Semantic attacks.** MAP doesn't know what `{"action":"deploy"}` means. A valid MID doesn't mean the action is safe, approved, or authorized. MAP tells you the payload wasn't modified — not that the payload is good.
- **Hash preimage attacks.** MAP uses SHA-256. If SHA-256 is broken, MAP's security properties degrade accordingly.

## Supported Versions

| Version | Supported |
|---------|-----------|
| 1.1.x   | ✅        |
| 1.0.x   | ❌ (upgrade to 1.1) |
