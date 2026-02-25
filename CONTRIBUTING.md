# Contributing

Read the spec first. Then read the code. If something doesnt make sense after that, open an issue and ask. We're happy to explain, but the spec is the source of truth and its not that long.

## Bug reports

Open an issue. Include what you expected vs what happened, which implementation (Python, Node, Go, Rust), and enough detail to reproduce it. A failing test case is better then a paragraph of explanation.

## Questions

Use Discussions. Issues are for tracked work.

## Code changes

Fork, branch, PR. For small fixes (typos, doc corrections, obvious bugs) just send it. For anything that touches canonicalization, encoding, or projection semantics -- open an issue first. Those paths have zero room for ambiguity and we'll want to talk through it before anyone writes code.

## The one non-negotiable rule

All four implementations pass all 95 conformance vectors. Zero tolerance. If your change breaks conformance in any language, it does not ship. This isnt pedantry, this is literally the point of the project. Two implementations producing different MIDs for the same input is a protocol failure.

```bash
make conformance
```

Run it before you open the PR. We will run it too.

## Spec changes

The v1.1 spec is frozen. If you believe the spec itself needs modification, make your case in Discussions first. Changing a frozen spec affects every implementation and every downstream consumer. The bar is high and should be.

## Style

Follow whatever the existing code in that implementation does. We'll sort out nits during review. Dont let formatting stop you from contributing.

## License

MIT. Your contributions are too.
