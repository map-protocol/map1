# Use Cases

map1 computes a deterministic identifier for structured data. Here is where that matters.

---

## CI/CD drift detection

A deployment config gets approved. By the time it runs, something may have changed — a field added, a value tweaked, a key removed. You need to catch that.

Compute the MID at approval time. Store it. At deploy time, recompute and compare.

    from map1 import mid_full

    approved_mid = "map1:02f660092e372c2da0f87cefdecd1de9476eba39be2222b30637ba72178c5e7e"
    runtime = {"action": "deploy", "target": "prod", "version": "2.1.0"}

    assert mid_full(runtime) == approved_mid, "config drift detected"

The MID changes if any value changes. It does not change if keys are reordered.

---

## Idempotency without synthetic IDs

Same mutation, same MID. Use it as a natural dedup key instead of minting UUIDs.

    from map1 import mid_full

    mutation = {"action": "transfer", "from": "acct-1", "to": "acct-2", "amount": "500"}
    key = mid_full(mutation)

    if not cache.has(key):
        cache.set(key, process(mutation))
    return cache.get(key)

Two identical requests produce the same key. No coordination needed between sender and receiver.

---

## Audit trail anchoring

Log every mutation with its MID. Months later, recompute. If they disagree, the record was altered.

    record = {"action": "grant_access", "role": "admin", "user": "u-456"}
    log_entry = {"mutation": record, "mid": mid_full(record)}

    # At audit time
    assert mid_full(log_entry["mutation"]) == log_entry["mid"]

This works because the MID is derived from the content, not assigned by the system that wrote it. Anyone can verify it independently.

---

## Agent action receipts

An AI agent proposes an action. It passes through a safety filter, a formatting layer, maybe human approval. By execution time, you need proof that what ran is what was proposed.

    const { midFull } = require("map1");

    // Agent proposes
    const action = { tool: "send_email", to: "alice@co.com", subject: "Q3 report" };
    const receipt = midFull(action);

    // After safety review, formatting, approval...
    const executed = pipeline.getApproved();
    if (midFull(executed) !== receipt) {
      throw new Error("action modified after agent proposal");
    }

The MID is the receipt. It's computed by the agent, stored before any transformation, and verified at execution. No signatures, no certificates, no key management. Just content identity.

This matters now for tool-use agents (MCP, function calling). It will matter more as agents chain actions across services where no single system sees the whole pipeline.

---

## Multi-system mutation coordination

Three services, two agents, and a human approval step all touch the same mutation. The MID is how everyone confirms they're talking about the same thing.

Service A proposes a change. It computes the MID and puts it in a header. Service B receives the mutation, recomputes the MID, and checks. The human reviewer sees the MID in the approval UI. Service C executes and logs the MID.

    # Service A (proposer)
    mid = mid_full(mutation)
    send(mutation, headers={"x-mutation-id": mid})

    # Service B (validator)
    assert mid_full(received) == headers["x-mutation-id"]

    # Service C (executor)
    audit_log.write({"mutation": received, "mid": mid_full(received)})

No shared database. No distributed lock. Each system independently computes the same identifier from the same data.

---

## Regulatory compliance for AI actions

When regulators ask "what did your AI system do, and can you prove the record hasn't been altered?", MIDs provide the anchor.

Every agent action is structured data. Compute its MID at action time. Store both the action and the MID. At audit time, regulators (or their tools) recompute the MID from the stored action. If it matches, the record is intact. If not, something was changed after the fact.

    actions = load_audit_trail(agent_id="agent-7", date="2026-02-23")

    for entry in actions:
        if mid_full(entry["action"]) != entry["mid"]:
            flag_for_investigation(entry)

This is not speculative. Financial services already require audit trails for automated trading decisions. Healthcare requires records of automated triage. As AI agents take more actions in regulated domains, the need for tamper-evident action records becomes mandatory, not optional.

map1 doesn't solve compliance by itself. It provides the identity primitive that compliance systems can build on.
