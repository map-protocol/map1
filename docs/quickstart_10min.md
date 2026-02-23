# Quickstart (10 Minutes)

Compute a deterministic mutation ID.

No theory. Just run it.

---

## 1. Install

Python:

    pip install map1

Node:

    npm install map1

---

## 2. First MID (Python)

    from map1 import mid_full

    mid = mid_full({
        "action": "deploy",
        "target": "prod",
        "version": "2.1.0"
    })

    print(mid)
    # → map1:02f660092e372c2da0f87cefdecd1de9476eba39be2222b30637ba72178c5e7e

---

## 3. Same MID (Node)

    const { midFull } = require("map1");

    const mid = midFull({
        action: "deploy",
        target: "prod",
        version: "2.1.0"
    });

    console.log(mid);
    // → map1:02f660092e372c2da0f87cefdecd1de9476eba39be2222b30637ba72178c5e7e

Identical.

---

## 4. Change a Value → MID Changes

    mid_full({
        "action": "deploy",
        "target": "staging",
        "version": "2.1.0"
    })

    # → map1:2c636ba86104e45afcbaacaf8df6e85d8e17cc05e02d114446a9e1081efefd5d

---

## 5. Reorder Keys → Same MID

    mid_full({
        "version": "2.1.0",
        "action": "deploy",
        "target": "prod"
    })

    # → map1:02f660092e372c2da0f87cefdecd1de9476eba39be2222b30637ba72178c5e7e

Key order does not affect identity.

---

## 6. BIND Projection

    from map1 import mid_bind

    mid_bind(
        {
            "action": "deploy",
            "target": "prod",
            "version": "2.1.0",
            "_trace": "abc"
        },
        ["/action", "/target"]
    )

    # → map1:bd70ec1e184b4d5a3c44507584cbaf8a937300df8e13e68f2b22faf67347246f

Only selected fields contribute.

---

## 7. CLI

After `pip install map1`:

    echo '{"action":"deploy","target":"prod","version":"2.1.0"}' | map1 mid --full

Or from source:

    echo '{"action":"deploy","target":"prod","version":"2.1.0"}' | python -m map1 mid --full

---

## 8. CI Example

    PROPOSED=$(map1 mid --full --file proposed.json)
    RUNTIME=$(map1 mid --full --file runtime.json)

    if [ "$PROPOSED" != "$RUNTIME" ]; then
        echo "MID mismatch — aborting"
        exit 1
    fi

---

Next:

- Overview: /README.md
- Use cases: /docs/use_cases.md
- Canonical details: /spec/MAP_v1.0.md
- Conformance: /conformance/README.md
