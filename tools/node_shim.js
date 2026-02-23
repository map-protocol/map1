#!/usr/bin/env node
// tools/node_shim.js
// Evaluate impl_node_mapref.js without running main(), then call runVector(vec) and print JSON {mid|err}.
//
// Usage:
//   node tools/node_shim.js '<json_payload>'
// where json_payload is like:
//   {"mode":"json_strict_full","input_b64":"...","pointers":["/a"]}

const fs = require("fs");
const path = require("path");

function die(msg) {
  console.error(msg);
  process.exit(2);
}

if (process.argv.length < 3) die("node_shim: missing json payload arg");
const payload = JSON.parse(process.argv[2]);

const implPath = path.join(__dirname, "..", "impl_node_mapref.js");
let code = fs.readFileSync(implPath, "utf8");

// Strip the final call to main(); (impl script ends with main();)
code = code.replace(/\bmain\(\);\s*$/m, "");

try {
  eval(code);
} catch (e) {
  die("node_shim: eval failed: " + e);
}

function b64ToBuf(b64) {
  return Buffer.from(b64, "base64");
}

try {
  const vec = { mode: payload.mode, input_bytes: b64ToBuf(payload.input_b64) };
  if (payload.pointers) vec.pointers = payload.pointers;
  const out = runVector(vec);
  process.stdout.write(JSON.stringify(out));
} catch (e) {
  if (e && e.code) {
    process.stdout.write(JSON.stringify({ err: e.code }));
  } else {
    die("node_shim: exception: " + e);
  }
}
