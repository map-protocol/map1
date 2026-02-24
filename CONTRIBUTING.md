# Contributing to MAP

Thanks for looking at this. MAP is early and contributions make a real difference.

## What's frozen and what's not

**The spec is frozen.** [MAP v1.0](spec/MAP_v1.0.md) (483 lines) is locked under a [governance contract](GOVERNANCE.md). It doesn't change. If there's a problem serious enough to warrant a change, it goes into MAP v2 as a separate protocol with a separate prefix. Open an issue if you think you've found something.

**Everything else is open:**

- **New implementations** - This is the highest-value contribution right now. Go and Rust are at the top of the list but any language works. The requirement: pass all 53 conformance vectors with output identical to the Python and Node reference implementations.
- **Documentation** - The spec is dense on purpose (it's a conformance target), but the rest of the docs can always be clearer. If something confused you, it probably confuses others too.
- **Conformance vectors** - New vectors are welcome. They're append-only, so once added they never get removed. If you find an edge case where naive canonicalization diverges, that's a great candidate.
- **Tooling** - CLI improvements, editor plugins, CI integrations, whatever makes MAP easier to use in practice.
- **Bug reports** - If two implementations produce different output for the same input, that's a conformance bug and I want to know about it.

## How to contribute a new implementation

1. Read the spec ([spec/MAP_v1.0.md](spec/MAP_v1.0.md)). All 483 lines. The density is intentional.
2. Read [DESIGN.md](DESIGN.md) for the reasoning behind the decisions. It'll save you time.
3. Implement against the spec.
4. Run the conformance vectors. All 53 must pass. No exceptions.
5. Open a PR with your implementation and the test results.

Zero dependencies is strongly preferred. The reference implementations don't need any because the protocol is simple enough on its own, and every dependency is a place where behavior could diverge.

## How to file a conformance bug

If you think an implementation is producing wrong output, include:

- The input (JSON or canonical bytes)
- Expected MID or error
- Actual MID or error
- Which implementation and version
- OS and runtime version (e.g., Python 3.11.2, Node 20.x, macOS 14)

The more specific you are, the faster I can figure out what's going on.

## Design priorities

MAP is a protocol-grade identity primitive. The design prioritizes:

1. **Determinism over expressiveness.** If a feature could cause two implementations to diverge, it doesn't go in.
2. **Strictness over convenience.** Bad input gets an error, not a guess.
3. **Stability over iteration.** The spec is frozen. MIDs from today work forever.

If you want to propose something that adds expressiveness but might affect determinism, the answer is probably no. But I'd still like to hear the argument.

## Code of conduct

Be good to each other. Technical disagreement is welcome. Personal attacks aren't.

## Questions?

Open an issue. I'd rather answer a question than have someone guess wrong and get frustrated.

- Aaron
