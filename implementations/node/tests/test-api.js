"use strict";

/**
 * MAP v1.1 API unit tests.
 *
 * These test the public API directly — the conformance suite covers
 * wire-level correctness, while these tests verify the JS-specific API
 * surface, type handling, and edge cases.
 *
 * Run: node tests/test-api.js
 */

const assert = require("assert");

const {
  SPEC_VERSION,
  midFull,
  midBind,
  canonicalBytesFull,
  canonicalBytesBind,
  midFullJson,
  midBindJson,
  midFromCanonBytes,
  prepare,
  MapError,
  ERR_TYPE,
  ERR_SCHEMA,
  ERR_DUP_KEY,
  ERR_UTF8,
  ERR_LIMIT_DEPTH,
} = require("../src/index");

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    passed++;
  } catch (e) {
    failed++;
    console.log(`  FAIL: ${name}`);
    console.log(`    ${e.message}`);
  }
}

function expectError(fn, code) {
  try {
    fn();
    throw new Error(`expected ${code}, got no error`);
  } catch (e) {
    if (!(e instanceof MapError) || e.code !== code) {
      throw new Error(`expected ${code}, got ${e instanceof MapError ? e.code : e.message}`);
    }
  }
}


// ═══════════════════════════════════════════════════════════
// Version
// ═══════════════════════════════════════════════════════════

test("SPEC_VERSION is 1.1", () => {
  assert.strictEqual(SPEC_VERSION, "1.1");
});


// ═══════════════════════════════════════════════════════════
// Core API — midFull
// ═══════════════════════════════════════════════════════════

test("midFull: simple string map", () => {
  const mid = midFull({ action: "deploy", target: "prod" });
  assert.ok(mid.startsWith("map1:"), `expected map1: prefix, got ${mid}`);
  assert.strictEqual(mid.length, 5 + 64);  // "map1:" + 64 hex chars
});

test("midFull: deterministic (same input → same MID)", () => {
  const a = midFull({ x: "hello", y: "world" });
  const b = midFull({ x: "hello", y: "world" });
  assert.strictEqual(a, b);
});

// Why this matters: key ordering must be by raw UTF-8 bytes, not insertion order.
test("midFull: insertion order doesn't matter", () => {
  const a = midFull({ z: "last", a: "first" });
  const b = midFull({ a: "first", z: "last" });
  assert.strictEqual(a, b);
});


// ═══════════════════════════════════════════════════════════
// BOOLEAN — v1.1 type distinction
// ═══════════════════════════════════════════════════════════

// Why this matters: v1.0 mapped true → STRING "true", creating a collision.
// v1.1 uses BOOLEAN (tag 0x05), which must produce a different MID.
test("boolean true vs string 'true': different MIDs", () => {
  const boolMid = midFull({ active: true });
  const strMid = midFull({ active: "true" });
  assert.notStrictEqual(boolMid, strMid);
});

test("boolean false vs string 'false': different MIDs", () => {
  const boolMid = midFull({ active: false });
  const strMid = midFull({ active: "false" });
  assert.notStrictEqual(boolMid, strMid);
});


// ═══════════════════════════════════════════════════════════
// INTEGER — v1.1 type, BigInt handling
// ═══════════════════════════════════════════════════════════

// Why this matters: INTEGER values must be BigInt in the JS API.
// JS Number can't represent all int64 values without precision loss.
test("integer 42n produces a valid MID", () => {
  const mid = midFull({ count: 42n });
  assert.ok(mid.startsWith("map1:"));
});

test("integer 42n vs string '42': different MIDs", () => {
  const intMid = midFull({ count: 42n });
  const strMid = midFull({ count: "42" });
  assert.notStrictEqual(intMid, strMid);
});

test("integer 0n vs string '0': different MIDs", () => {
  const intMid = midFull({ val: 0n });
  const strMid = midFull({ val: "0" });
  assert.notStrictEqual(intMid, strMid);
});

// Why this matters: INT64_MAX (2^63-1) must be representable without precision loss.
test("INT64_MAX is accepted", () => {
  const max = 9223372036854775807n;
  const mid = midFull({ n: max });
  assert.ok(mid.startsWith("map1:"));
});

test("INT64_MIN is accepted", () => {
  const min = -9223372036854775808n;
  const mid = midFull({ n: min });
  assert.ok(mid.startsWith("map1:"));
});

test("INT64_MAX + 1 is rejected", () => {
  expectError(() => midFull({ n: 9223372036854775808n }), ERR_SCHEMA);
});


// ═══════════════════════════════════════════════════════════
// JSON-STRICT API
// ═══════════════════════════════════════════════════════════

test("midFullJson: simple object", () => {
  const raw = Buffer.from('{"key":"value"}', "utf-8");
  const mid = midFullJson(raw);
  assert.ok(mid.startsWith("map1:"));
});

// Why this matters: JSON integers go through the custom parser that preserves
// precision via BigInt — JSON.parse would silently corrupt large integers.
test("midFullJson: integer value", () => {
  const raw = Buffer.from('{"n":42}', "utf-8");
  const mid = midFullJson(raw);
  assert.ok(mid.startsWith("map1:"));
});

test("midFullJson: large integer preserves precision", () => {
  // This integer exceeds Number.MAX_SAFE_INTEGER.  JSON.parse would
  // silently truncate it.  Our custom parser uses BigInt.
  const raw = Buffer.from('{"n":9223372036854775807}', "utf-8");
  const mid = midFullJson(raw);
  assert.ok(mid.startsWith("map1:"));
});

test("midFullJson: float rejected", () => {
  expectError(() => midFullJson(Buffer.from('{"n":3.14}')), ERR_TYPE);
});

test("midFullJson: 1.0 rejected (token-level check)", () => {
  expectError(() => midFullJson(Buffer.from('{"n":1.0}')), ERR_TYPE);
});

test("midFullJson: exponent rejected", () => {
  expectError(() => midFullJson(Buffer.from('{"n":1e5}')), ERR_TYPE);
});

test("midFullJson: null rejected", () => {
  expectError(() => midFullJson(Buffer.from('{"k":null}')), ERR_TYPE);
});

test("midFullJson: duplicate keys rejected", () => {
  expectError(() => midFullJson(Buffer.from('{"a":1,"a":2}')), ERR_DUP_KEY);
});

test("midFullJson: BOM rejected", () => {
  const bom = Buffer.from([0xEF, 0xBB, 0xBF]);
  const json = Buffer.from('{"a":"b"}');
  expectError(() => midFullJson(Buffer.concat([bom, json])), ERR_SCHEMA);
});


// ═══════════════════════════════════════════════════════════
// BIND projection
// ═══════════════════════════════════════════════════════════

test("midBind: select single field", () => {
  const descriptor = { action: "deploy", target: "prod", debug: true };
  const mid = midBind(descriptor, ["/action"]);
  // Should only depend on the "action" field
  const expected = midFull({ action: "deploy" });
  assert.strictEqual(mid, expected);
});

test("midBind: no match → empty map MID", () => {
  const descriptor = { a: "1" };
  const mid = midBind(descriptor, ["/zzz"]);
  const emptyMid = midFull({});
  assert.strictEqual(mid, emptyMid);
});


// ═══════════════════════════════════════════════════════════
// canon_bytes round-trip
// ═══════════════════════════════════════════════════════════

test("canonicalBytesFull → midFromCanonBytes round-trip", () => {
  const descriptor = { action: "deploy", flag: true, count: 42n };
  const canon = canonicalBytesFull(descriptor);
  const mid1 = midFull(descriptor);
  const mid2 = midFromCanonBytes(canon);
  assert.strictEqual(mid1, mid2);
});


// ═══════════════════════════════════════════════════════════
// prepare() convenience
// ═══════════════════════════════════════════════════════════

test("prepare: converts JS number to BigInt", () => {
  const prepared = prepare({ count: 42 });
  assert.strictEqual(prepared.count, 42n);
});

test("prepare: converts float to string", () => {
  const prepared = prepare({ temp: 98.6 });
  assert.strictEqual(typeof prepared.temp, "string");
  assert.ok(prepared.temp.includes("98.6"));
});

test("prepare: omits null by default", () => {
  const prepared = prepare({ a: "keep", b: null });
  assert.strictEqual(prepared.a, "keep");
  assert.strictEqual("b" in prepared, false);
});

test("prepare: preserves booleans", () => {
  const prepared = prepare({ flag: true });
  assert.strictEqual(prepared.flag, true);
});


// ═══════════════════════════════════════════════════════════
// Mixed-type containers
// ═══════════════════════════════════════════════════════════

test("midFull: mixed types in map", () => {
  const mid = midFull({ s: "hello", b: true, n: 42n });
  assert.ok(mid.startsWith("map1:"));
});

test("midFull: mixed types in list (via JSON)", () => {
  const raw = Buffer.from('{"items":["hello",true,42]}');
  const mid = midFullJson(raw);
  assert.ok(mid.startsWith("map1:"));
});


// ═══════════════════════════════════════════════════════════
// Results
// ═══════════════════════════════════════════════════════════

console.log(`\nUnit tests: ${passed}/${passed + failed} PASS`);
if (failed > 0) {
  process.exit(1);
}
