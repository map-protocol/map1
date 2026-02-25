# 10-Minute Quickstart

Install MAP, compute your first MID, and understand the basics.

## Install

Pick your language:

```bash
# Python (3.9+)
pip install map-protocol

# Node.js / TypeScript (18+)
npm install @map-protocol/map1

# Go (1.21+)
go get github.com/map-protocol/map1-go

# Rust (1.70+)
cargo add map1
```

## Compute a MID

**Python:**

```python
from map1 import mid_full

mid = mid_full({"action": "deploy", "target": "prod", "version": "2.1.0"})
print(mid)
# map1:02f660092e372c2da0f87cefdecd1de9476eba39be2222b30637ba72178c5e7e
```

**Node.js:**

```typescript
import { midFull } from '@map-protocol/map1';

const mid = midFull({ action: 'deploy', target: 'prod', version: '2.1.0' });
console.log(mid);
// map1:02f660092e372c2da0f87cefdecd1de9476eba39be2222b30637ba72178c5e7e
```

**Go:**

```go
import "github.com/map-protocol/map1-go"

mid, err := map1.MidFull(map[string]any{
    "action": "deploy", "target": "prod", "version": "2.1.0",
})
// map1:02f660092e372c2da0f87cefdecd1de9476eba39be2222b30637ba72178c5e7e
```

**Rust:**

```rust
use map1::mid_full;
use std::collections::BTreeMap;

let mut desc = BTreeMap::new();
desc.insert("action", "deploy");
desc.insert("target", "prod");
desc.insert("version", "2.1.0");
let mid = mid_full(&desc)?;
// map1:02f660092e372c2da0f87cefdecd1de9476eba39be2222b30637ba72178c5e7e
```

Same input → same MID, regardless of language.

## The Six Types

MAP v1.1 supports six types. Here's what each looks like:

```python
from map1 import mid_full

# STRING
mid_full("hello")

# BYTES
mid_full(b"\x00\x01\x02")

# BOOLEAN (v1.1)
mid_full(True)   # map1:725480164f1866ff09e52192d3a6e4ed30814b7ad2eadf01e2c47225ffd5ca53
mid_full(False)  # map1:2bac0aba4b5dc2bc0f6d0aa3782558d0278c8a3b1dc0f9121b821c433e030e5c

# INTEGER (v1.1)
mid_full(42)     # map1:5e941bea34cb86e0c10493cd731b7856d5356d70a59a336d432e88f720a29396
mid_full(0)      # map1:2e8e314c798c7ddaa3bce20a9a5428f2990cdf30f64c2ea8e257aa2007bdfaa4

# LIST
mid_full([1, 2, 3])

# MAP
mid_full({"active": True, "count": 42, "name": "test"})
# map1:cd04f06f8fcfa1136cb8b1dc405fc161e8e783968d3f889582506a18e83f4b0c
```

Booleans and integers are distinct from their string representations:

```python
mid_full(True) != mid_full("true")    # True — different types, different MIDs
mid_full(42)   != mid_full("42")      # True — different types, different MIDs
```

## Handling Floats

MAP rejects floats. Encode them as strings with your desired precision:

```python
from map1 import prepare, mid_full

# prepare() converts floats to strings automatically
raw = {"temperature": 98.6, "active": True, "retries": 3}
prepared = prepare(raw)
# {'temperature': '98.600000', 'active': True, 'retries': 3}

mid_full(prepared)
```

You can control precision:

```python
prepared = prepare(raw, float_precision=2)
# {'temperature': '98.60', 'active': True, 'retries': 3}
```

## BIND Projection

Select specific fields instead of hashing everything:

```python
from map1 import mid_bind

descriptor = {
    "action": "deploy",
    "target": "prod",
    "version": "2.1.0",
    "timestamp": "2026-02-24T10:00:00Z",
    "debug": False,
}

# Only action and target contribute to the MID
mid_bind(descriptor, ["/action", "/target"])
```

Changing `timestamp` or `debug` won't affect the BIND MID. Only `action` and `target` matter.

## JSON-STRICT Mode

For untrusted JSON input, use the JSON-STRICT API:

```python
from map1 import mid_full_json

raw_json = b'{"active": true, "count": 42, "name": "test"}'
mid = mid_full_json(raw_json)
# map1:cd04f06f8fcfa1136cb8b1dc405fc161e8e783968d3f889582506a18e83f4b0c
```

JSON-STRICT adds BOM rejection, lone surrogate detection, duplicate-key detection, and strict type mapping (floats → `ERR_TYPE`, null → `ERR_TYPE`).

## CLI

```bash
# FULL MID from JSON
echo '{"action":"deploy","target":"prod","version":"2.1.0"}' | python -m map1 mid --full
# map1:02f660092e372c2da0f87cefdecd1de9476eba39be2222b30637ba72178c5e7e

# With JSON-STRICT
echo '{"active":true,"count":42}' | python -m map1 mid --full --json-strict

# BIND projection
echo '{"action":"deploy","target":"prod","version":"2.1.0"}' | python -m map1 mid --bind /action /target

# From file
python -m map1 mid --full --input descriptor.json
```

## Next Steps

- [Design Decisions](DESIGN.md) — why MAP works the way it does
- [Common Footguns](gotchas.md) — things that trip people up
- [FAQ](FAQ.md) — answers to common questions
- [Specification](../spec/MAP_v1.1.md) — the normative reference
