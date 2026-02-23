// MAP v1.0 API test suite
const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

const {
  midFull,
  midBind,
  canonicalBytesFull,
  canonicalBytesBind,
  midFullJson,
  midBindJson,
  midFromCanonBytes,
  MapError,
  ERR_CANON_HDR,
  ERR_CANON_MCF,
  ERR_SCHEMA,
  ERR_TYPE,
  ERR_UTF8,
  ERR_DUP_KEY,
  ERR_KEY_ORDER,
  ERR_LIMIT_DEPTH,
  ERR_LIMIT_SIZE,
} = require("../dist");

// ────────── midFull ──────────

describe("midFull", () => {
  it("simple map", () => {
    const mid = midFull({ a: "b" });
    assert.ok(mid.startsWith("map1:"));
    assert.equal(mid.length, 5 + 64); // "map1:" + 64 hex chars
  });

  it("deterministic", () => {
    assert.equal(midFull({ x: "1", y: "2" }), midFull({ y: "2", x: "1" }));
  });

  it("nested structures", () => {
    const mid = midFull({ a: { b: { c: "d" } } });
    assert.ok(mid.startsWith("map1:"));
  });

  it("arrays", () => {
    const mid = midFull({ items: ["a", "b", "c"] });
    assert.ok(mid.startsWith("map1:"));
  });

  it("empty map", () => {
    const mid = midFull({});
    assert.ok(mid.startsWith("map1:"));
  });

  it("boolean mapping", () => {
    // booleans become strings "true"/"false" in MAP
    const mid1 = midFull({ flag: "true" });
    // Note: JS booleans are not valid MAP descriptor values via midFull
    // midFull expects pre-converted string/array/map descriptors
  });

  it("rejects unsupported types", () => {
    assert.throws(() => midFull({ n: 42 }), MapError);
    assert.throws(() => midFull({ n: null }), MapError);
  });
});

// ────────── midBind ──────────

describe("midBind", () => {
  it("projects subset", () => {
    const full = midFull({ a: "1", b: "2" });
    const bound = midBind({ a: "1", b: "2" }, ["/a"]);
    assert.notEqual(full, bound);
    assert.equal(bound, midFull({ a: "1" }));
  });

  it("empty pointer returns full", () => {
    const desc = { a: "1", b: "2" };
    assert.equal(midBind(desc, [""]), midFull(desc));
  });

  it("rejects duplicate pointers", () => {
    assert.throws(() => midBind({ a: "1" }, ["/a", "/a"]), (e) => {
      return e instanceof MapError && e.code === ERR_SCHEMA;
    });
  });

  it("no match returns empty map MID", () => {
    const mid = midBind({ a: "1" }, ["/nope"]);
    assert.equal(mid, midFull({}));
  });

  it("mixed match/unmatch throws", () => {
    assert.throws(() => midBind({ a: "1", b: "2" }, ["/a", "/nope"]), (e) => {
      return e instanceof MapError && e.code === ERR_SCHEMA;
    });
  });

  it("nested pointer", () => {
    const desc = { a: { b: "c" }, d: "e" };
    const mid = midBind(desc, ["/a/b"]);
    assert.equal(mid, midFull({ a: { b: "c" } }));
  });

  it("list traversal rejected", () => {
    assert.throws(() => midBind({ a: ["x"] }, ["/a/0"]), (e) => {
      return e instanceof MapError && e.code === ERR_SCHEMA;
    });
  });
});

// ────────── canonicalBytesFull / canonicalBytesBind ──────────

describe("canonicalBytesFull", () => {
  it("returns Buffer starting with MAP1 header", () => {
    const buf = canonicalBytesFull({ a: "b" });
    assert.ok(Buffer.isBuffer(buf));
    assert.equal(buf.subarray(0, 5).toString("binary"), "MAP1\0");
  });

  it("roundtrips through midFromCanonBytes", () => {
    const desc = { hello: "world" };
    const canon = canonicalBytesFull(desc);
    const mid1 = midFull(desc);
    const mid2 = midFromCanonBytes(canon);
    assert.equal(mid1, mid2);
  });
});

describe("canonicalBytesBind", () => {
  it("returns projected canon bytes", () => {
    const buf = canonicalBytesBind({ a: "1", b: "2" }, ["/a"]);
    assert.ok(Buffer.isBuffer(buf));
    const mid = midFromCanonBytes(buf);
    assert.equal(mid, midBind({ a: "1", b: "2" }, ["/a"]));
  });
});

// ────────── midFromCanonBytes ──────────

describe("midFromCanonBytes", () => {
  it("rejects bad header", () => {
    assert.throws(() => midFromCanonBytes(Buffer.from("NOPE\0")), (e) => {
      return e instanceof MapError && e.code === ERR_CANON_HDR;
    });
  });

  it("rejects empty buffer", () => {
    assert.throws(() => midFromCanonBytes(Buffer.alloc(0)), (e) => {
      return e instanceof MapError && e.code === ERR_CANON_HDR;
    });
  });

  it("rejects trailing bytes", () => {
    const canon = canonicalBytesFull({ a: "b" });
    const extended = Buffer.concat([canon, Buffer.from([0xff])]);
    assert.throws(() => midFromCanonBytes(extended), (e) => {
      return e instanceof MapError && e.code === ERR_CANON_MCF;
    });
  });
});

// ────────── midFullJson ──────────

describe("midFullJson", () => {
  it("simple JSON object", () => {
    const raw = Buffer.from('{"a":"b"}', "utf8");
    const mid = midFullJson(raw);
    assert.equal(mid, midFull({ a: "b" }));
  });

  it("rejects JSON with numbers", () => {
    assert.throws(() => midFullJson(Buffer.from('{"a":1}', "utf8")), (e) => {
      return e instanceof MapError && e.code === ERR_TYPE;
    });
  });

  it("rejects JSON with null", () => {
    assert.throws(() => midFullJson(Buffer.from('{"a":null}', "utf8")), (e) => {
      return e instanceof MapError && e.code === ERR_TYPE;
    });
  });

  it("detects duplicate keys after unescape", () => {
    // "a" and "\u0061" are the same key after unescape
    const raw = Buffer.from('{"a":"1","\\u0061":"2"}', "utf8");
    assert.throws(() => midFullJson(raw), (e) => {
      return e instanceof MapError && e.code === ERR_DUP_KEY;
    });
  });

  it("rejects BOM", () => {
    const raw = Buffer.from("\xEF\xBB\xBF{}", "binary");
    assert.throws(() => midFullJson(raw), (e) => {
      return e instanceof MapError && e.code === ERR_SCHEMA;
    });
  });

  it("maps booleans to strings", () => {
    const raw = Buffer.from('{"flag":true}', "utf8");
    const mid = midFullJson(raw);
    assert.equal(mid, midFull({ flag: "true" }));
  });

  it("rejects trailing content", () => {
    assert.throws(() => midFullJson(Buffer.from('{"a":"b"}  extra', "utf8")), (e) => {
      return e instanceof MapError && e.code === ERR_CANON_MCF;
    });
  });
});

// ────────── midBindJson ──────────

describe("midBindJson", () => {
  it("projects JSON subset", () => {
    const raw = Buffer.from('{"a":"1","b":"2"}', "utf8");
    const mid = midBindJson(raw, ["/a"]);
    assert.equal(mid, midBind({ a: "1", b: "2" }, ["/a"]));
  });

  it("detects dups in bind mode", () => {
    const raw = Buffer.from('{"a":"1","a":"2"}', "utf8");
    assert.throws(() => midBindJson(raw, ["/a"]), (e) => {
      return e instanceof MapError && e.code === ERR_DUP_KEY;
    });
  });
});

// ────────── MapError ──────────

describe("MapError", () => {
  it("has code and message", () => {
    const e = new MapError(ERR_SCHEMA, "test message");
    assert.equal(e.code, ERR_SCHEMA);
    assert.equal(e.message, "test message");
    assert.ok(e instanceof Error);
    assert.ok(e instanceof MapError);
  });

  it("defaults message to code", () => {
    const e = new MapError(ERR_UTF8);
    assert.equal(e.message, ERR_UTF8);
  });
});

// ────────── Error code exports ──────────

describe("error code exports", () => {
  it("all codes are strings", () => {
    for (const code of [
      ERR_CANON_HDR, ERR_CANON_MCF, ERR_SCHEMA, ERR_TYPE,
      ERR_UTF8, ERR_DUP_KEY, ERR_KEY_ORDER, ERR_LIMIT_DEPTH, ERR_LIMIT_SIZE,
    ]) {
      assert.equal(typeof code, "string");
      assert.ok(code.startsWith("ERR_"));
    }
  });
});
