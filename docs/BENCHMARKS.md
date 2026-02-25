# Benchmarks

These are real numbers from real code on a single core. Not marketing numbers. No warm cache tricks. Just `time.perf_counter()` and `process.hrtime.bigint()` in a loop.

Environment: Linux x86_64, Python 3.12, Node.js v22. Your numbers will vary but the shape should be the same.

## Python -- `mid_full` (dict API)

```
Payload                          ops/sec       µs/op
-------------------------------  ----------    ------
small (3 keys, all strings)      ~149,000       6.7
mixed types (string+bool+int)    ~102,000       9.8
medium (50 keys, all strings)     ~10,000      99.8
```

## Python -- `mid_full_json` (bytes API)

```
Payload                          ops/sec       µs/op
-------------------------------  ----------    ------
small JSON (3 keys)               ~64,000      15.6
mixed JSON (v1.1 types)           ~52,000      19.3
medium JSON (50 keys)              ~5,900     169.8
```

The JSON path is slower because it runs the full JSON-STRICT adapter (duplicate key detection, BOM check, surrogate rejection) before canonicalization. Thats the cost of untrusted input validation. If your input is already a native dict, use `mid_full` directly.

## Node.js -- `midFull` (object API)

```
Payload                          ops/sec       µs/op
-------------------------------  ----------    ------
small (3 keys, all strings)       ~42,000      23.7
mixed types (string+bool+bigint) ~100,000      10.0
medium (50 keys, all strings)     ~16,000      61.7
```

## Node.js -- `midFullJson` (buffer API)

```
Payload                          ops/sec       µs/op
-------------------------------  ----------    ------
small JSON (3 keys)               ~87,000      11.5
mixed JSON (v1.1 types)           ~80,000      12.5
medium JSON (50 keys)             ~10,700      93.0
```

Node's JSON path is faster than Python's because the custom streaming parser and the SHA-256 hashing both benefit from V8's JIT. The object API is slower for small payloads due to type-checking overhead on plain JS objects vs the parser's direct model construction.

## What This Means

For most use cases you wont notice MAP in your profile. A typical agent action descriptor (5-10 keys, mixed types) takes under 25µs in either language. Thats 40,000+ MIDs per second per core before you've thought about optimization.

The 50-key case shows where time actually goes: key sorting (O(n log n)) and MCF encoding (linear). SHA-256 itself is not the bottleneck at these payload sizes.

## Go and Rust

No published numbers yet. Expect Go to be 5-10x faster then Python and Rust to be 10-50x faster, based on typical crypto-hashing benchmarks. We'll publish these once the implementations are integrated into the monorepo CI.

If you run benchmarks on Go or Rust, please open a Discussion -- we'd like to include community numbers here.

## Reproducing

Python:
```python
import time
from map1 import mid_full

payload = {"action": "deploy", "target": "prod", "version": "2.1.0"}
n = 10000
start = time.perf_counter()
for _ in range(n):
    mid_full(payload)
elapsed = time.perf_counter() - start
print(f"{n / elapsed:,.0f} ops/sec")
```

Node:
```javascript
const { midFull } = require('@map-protocol/map1');

const payload = { action: 'deploy', target: 'prod', version: '2.1.0' };
const n = 10000;
const start = process.hrtime.bigint();
for (let i = 0; i < n; i++) midFull(payload);
const elapsed = Number(process.hrtime.bigint() - start) / 1e9;
console.log(`${Math.round(n / elapsed).toLocaleString()} ops/sec`);
```

Nothing fancy. Run it yourself.
