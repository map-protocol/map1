"use strict";

/**
 * MAP v1.1 conformance test suite.
 *
 * Runs all vectors from conformance_vectors_v11.json against
 * conformance_expected_v11.json.  Falls back to v1.0 filenames
 * if v1.1 files aren't present.
 *
 * Usage:
 *   node tests/test-conformance.js [--vectors-dir DIR]
 */

const fs = require("fs");
const path = require("path");

const {
  midFullJson,
  midBindJson,
  midFromCanonBytes,
  MapError,
} = require("../src/index");


// ── Locate conformance data ─────────────────────────────────

function findVectorsDir(override) {
  if (override) return override;

  const candidates = [
    path.join(__dirname, "..", "..", "..", "conformance"),
    path.join(__dirname, "..", "..", "conformance"),
    path.join(__dirname, "..", "conformance"),
    path.join(__dirname, ".."),
  ];

  for (const d of candidates) {
    if (fs.existsSync(path.join(d, "conformance_vectors_v11.json"))) return d;
    if (fs.existsSync(path.join(d, "conformance_vectors.json"))) return d;
  }

  throw new Error(
    "Cannot find conformance vectors.  Pass --vectors-dir or set MAP1_VECTORS_DIR."
  );
}


function loadData(dir) {
  // Try v1.1 first
  const v11Vec = path.join(dir, "conformance_vectors_v11.json");
  const v11Exp = path.join(dir, "conformance_expected_v11.json");

  if (fs.existsSync(v11Vec) && fs.existsSync(v11Exp)) {
    const vectors = JSON.parse(fs.readFileSync(v11Vec, "utf-8")).vectors;
    const expected = JSON.parse(fs.readFileSync(v11Exp, "utf-8")).expected;
    return { vectors, expected, version: "1.1" };
  }

  // Fall back to v1.0
  const vectors = JSON.parse(
    fs.readFileSync(path.join(dir, "conformance_vectors.json"), "utf-8")
  ).vectors;
  const expected = JSON.parse(
    fs.readFileSync(path.join(dir, "conformance_expected.json"), "utf-8")
  ).expected;
  return { vectors, expected, version: "1.0" };
}


// ── Vector execution ────────────────────────────────────────

function runVector(vec) {
  const { mode, input_b64, pointers } = vec;
  const raw = Buffer.from(input_b64, "base64");

  try {
    if (mode === "json_strict_full") {
      return { mid: midFullJson(raw) };
    } else if (mode === "json_strict_bind") {
      return { mid: midBindJson(raw, pointers || []) };
    } else if (mode === "canon_bytes") {
      return { mid: midFromCanonBytes(raw) };
    } else {
      return { err: "UNKNOWN_MODE" };
    }
  } catch (e) {
    if (e instanceof MapError) {
      return { err: e.code };
    }
    // Unexpected error — surface it clearly for debugging.
    return { err: `INTERNAL: ${e.message}` };
  }
}


// ── Main runner ─────────────────────────────────────────────

function main() {
  const args = process.argv.slice(2);
  let vectorsDir = process.env.MAP1_VECTORS_DIR || null;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--vectors-dir" && i + 1 < args.length) {
      vectorsDir = args[++i];
    }
  }

  const dir = findVectorsDir(vectorsDir);
  const { vectors, expected, version } = loadData(dir);

  let passed = 0;
  let failed = 0;
  const failures = [];

  for (const vec of vectors) {
    const tid = vec.test_id;
    const got = runVector(vec);
    const exp = expected[tid];

    // Deep-compare: both should be { mid: "..." } or { err: "..." }
    const match = (got.mid !== undefined && got.mid === exp.mid) ||
                  (got.err !== undefined && got.err === exp.err);

    if (match) {
      passed++;
    } else {
      failed++;
      failures.push({ tid, got, exp });
    }
  }

  const total = passed + failed;
  console.log(`CONFORMANCE (v${version}): ${passed}/${total} PASS`);

  for (const { tid, got, exp } of failures) {
    console.log(`  FAIL ${tid}: got=${JSON.stringify(got)} expected=${JSON.stringify(exp)}`);
  }

  process.exit(failed > 0 ? 1 : 0);
}

main();
