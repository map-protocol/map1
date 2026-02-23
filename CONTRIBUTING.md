# Contributing

Thanks for contributing to map1.

map1 is a protocol implementation. Stability and determinism come first.

Repo: https://github.com/map-protocol/map1

## Rules (Conformance-First)

All contributions happen via pull request.

All PRs must:

- Pass CI (Python + Node test matrix)
- Preserve existing MID outputs
- Maintain spec compliance
- Include tests

Spec changes require:

- Updated spec text
- New conformance vectors + expected outputs
- A clear versioning statement

No changes may alter existing v1.0 MID outputs. See /spec/FREEZE_CONTRACT.md.

## Conformance Vectors

New conformance vectors are welcome and encouraged.

Vectors are append-only:

- Do not modify existing vectors
- Do not remove vectors
- Add new vectors only

PASS_REPORT generation details live in /conformance/README.md.

## Implementation Contributions

Implementation PRs must:

- Pass 53/53 vectors (zero tolerance)
- Include PASS_REPORT output
- Match existing style in that implementation

Bug fixes that do NOT change MID output follow the normal PR process.

Bug fixes that DO change MID output are treated as breaking and require maintainer review.

## Code Style

Match existing patterns in each implementation. No linter is enforced, but consistency within a file matters.
