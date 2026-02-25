# Use Cases

MAP computes deterministic identifiers for structured data you control. The pattern is always the same: a payload is authored at one point, moves through a pipeline, and is verified at another. Here's where that matters.

## Agent Action Receipts

An AI agent proposes an action. A human (or policy engine) approves it. The agent executes it. Between approval and execution, the action descriptor passes through middleware, message queues, maybe an orchestration layer. How do you prove the thing that executed is the same thing that was approved?

Compute the MID at approval time:

```python
from map1 import mid_full

action = {
    "action": "deploy",
    "target": "prod",
    "version": "2.1.0",
    "port": 8443,          # INTEGER — distinct from "8443"
    "force": False,         # BOOLEAN — distinct from "false"
}
receipt = mid_full(action)
# map1:...
```

Store the receipt. At execution time, reconstruct the descriptor from whatever arrived through the pipeline and recompute. If the MIDs match, nothing was tampered with. If they differ, something changed — fail closed.

v1.1's type system makes this more expressive. Changing `"force"` from `False` to `True` changes the MID. Changing it from `False` to `"false"` also changes the MID — different type, different identity. An attacker (or a buggy serializer) can't substitute a string for a boolean without the MID changing.

## CI/CD Pipeline Identity

A build configuration is defined in your CI system, passed through template rendering, environment variable substitution, and maybe a config management tool before it reaches the build runner. Did anything get lost or changed along the way?

```python
config = {
    "repo": "github.com/org/service",
    "branch": "main",
    "commit": "a1b2c3d4e5f6",
    "build_number": 1042,    # INTEGER
    "debug": False,          # BOOLEAN
}
build_id = mid_full(config)
```

Tag every build artifact with this MID. If two builds have the same config MID, the inputs were identical. If the config changed, the MID changed — you can trace exactly which configuration produced which artifact.

BIND projection lets you compute partial identities. Maybe you want to track the source identity separately from the build parameters:

```python
from map1 import mid_bind

source_id = mid_bind(config, ["/repo", "/commit"])
```

## Configuration Drift Detection

Store the MID of your expected configuration. Periodically recompute the MID of the live configuration. If they differ, something drifted. The MID doesn't tell you *what* changed — it tells you *that* something changed, which is the first question you need answered before digging into diffs.

This works across language boundaries. Your Python management plane and your Go data plane can both compute MIDs over the same configuration and compare them. Same config means same MID, regardless of which language computed it.

## Audit Trails

Every state transition in a system can be described as a structured record. Compute the MID and log it. The result is an append-only sequence of compact, deterministic identifiers.

Because MAP is language-independent, the audit log can be verified by any system with a MAP implementation — your Python service writes the log, a Go compliance tool verifies it, a Rust validator does spot checks. They'll all compute the same MID for the same input. No coordination required beyond agreeing on the descriptor schema.

## Content-Addressable Storage

Use MIDs as storage keys. Two descriptors with the same content produce the same MID, so deduplication is automatic. Same principle behind Git's content-addressable object store, but for arbitrary structured data instead of blobs and trees.

## Idempotency Keys

If your descriptor fully describes a request, the MID is a natural idempotency key. No synthetic UUIDs, no client-generated request IDs. Two requests with the same content produce the same MID, and you can detect duplicates at the receiving end without any prior coordination.
