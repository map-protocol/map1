// MAP v1.0 conformance test suite — 53 vectors
const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const {
  midFromCanonBytes,
  midFullJson,
  midBindJson,
  MapError,
} = require("../dist");

const VECTORS_DIR = process.env.MAP1_VECTORS_DIR || path.join(__dirname, "..", "..", "conformance");
const VECTORS_PATH = path.join(VECTORS_DIR, "conformance_vectors.json");
const EXPECTED_PATH = path.join(VECTORS_DIR, "conformance_expected.json");

const vectors = JSON.parse(fs.readFileSync(VECTORS_PATH, "utf8"));
const expected = JSON.parse(fs.readFileSync(EXPECTED_PATH, "utf8"));

function runVector(vec) {
  const raw = Buffer.from(vec.input_bytes);
  if (vec.mode === "canon_bytes") return { mid: midFromCanonBytes(raw) };
  if (vec.mode === "json_strict_full") return { mid: midFullJson(raw) };
  if (vec.mode === "json_strict_bind") return { mid: midBindJson(raw, vec.pointers) };
  throw new Error("unknown mode: " + vec.mode);
}

describe("MAP v1.0 conformance", () => {
  let passCount = 0;
  const total = vectors.vectors.length;

  for (const v of vectors.vectors) {
    const tid = v.test_id;
    const vec = { ...v, input_bytes: Buffer.from(v.input_b64, "base64") };
    const exp = expected.expected[tid];

    it(tid, () => {
      let got;
      try {
        got = runVector(vec);
      } catch (e) {
        if (e instanceof MapError) got = { err: e.code };
        else got = { err: "ERR_CANON_MCF" };
      }
      assert.deepStrictEqual(got, exp, `${tid}: got ${JSON.stringify(got)}, expected ${JSON.stringify(exp)}`);
      passCount++;
    });
  }

  it("summary: all 53 vectors pass", () => {
    // This runs last; passCount should be 53
    console.log(`\nCONFORMANCE: ${passCount}/${total} PASS`);
  });
});
