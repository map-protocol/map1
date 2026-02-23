# Governance

map1 is maintained by Aaron Gerard Davidson (@adavidson510).

Contributions are welcome via pull request.

## Compatibility

The conformance suite is the compatibility contract.

- Spec changes require conformance vector coverage.
- Breaking changes to the frozen protocol surface will not be accepted.

See: /spec/FREEZE_CONTRACT.md

## Decision Rule

If a change would alter any v1.0 MID output for valid v1.0 input, it is rejected.
