# Security Policy

## Scope

map1 is an identity primitive. It computes deterministic canonical bytes and derives MIDs.

In scope:

- Implementation correctness (canonicalization, MCF encoding, hashing)
- Conformance divergence between implementations
- Bugs that could cause different MIDs for the same input
- Bugs that violate the freeze contract (see /spec/FREEZE_CONTRACT.md)

Not in scope:

- Application-level security of systems using map1
- Key management, access control, authorization, policy
- How consuming systems store, transmit, or interpret MIDs
- Security posture of tools or agents that happen to use map1

A MID proves “this is the same mutation.” It does not prove “this mutation is authorized.”

## Reporting

Responsible disclosure is preferred.

Email: agdavidson@gmail.com

No bug bounty program. Response time is best effort.
