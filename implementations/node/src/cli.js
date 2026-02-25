#!/usr/bin/env node
"use strict";

/**
 * map1 CLI — compute MIDs from JSON input.
 *
 * Usage:
 *   echo '{"action":"deploy"}' | map1
 *   echo '{"action":"deploy"}' | map1 --mode bind --pointers /action
 *   map1 --canon-bytes < binary_file
 *   map1 --version
 */

const fs = require("fs");
const { SPEC_VERSION } = require("./constants");
const {
  midFullJson, midBindJson, midFromCanonBytes, MapError,
} = require("./index");

function usage() {
  console.error(`map1 v${SPEC_VERSION} — MAP v1 deterministic identity

Usage:
  echo '{"key":"value"}' | map1 [OPTIONS]

Options:
  --mode full|bind     Projection mode (default: full)
  --pointers P1 P2...  JSON Pointers for bind mode
  --canon-bytes        Input is pre-built CANON_BYTES (binary), not JSON
  --version            Print version and exit
  --help               Show this message`);
}

function main() {
  const args = process.argv.slice(2);
  let mode = "full";
  let pointers = [];
  let canonBytesMode = false;

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case "--help":
      case "-h":
        usage();
        process.exit(0);
        break;
      case "--version":
        console.log(SPEC_VERSION);
        process.exit(0);
        break;
      case "--mode":
        mode = args[++i];
        if (mode !== "full" && mode !== "bind") {
          console.error(`error: mode must be 'full' or 'bind', got '${mode}'`);
          process.exit(1);
        }
        break;
      case "--pointers":
        // Consume remaining args as pointers until next flag or end
        i++;
        while (i < args.length && !args[i].startsWith("--")) {
          pointers.push(args[i]);
          i++;
        }
        i--;  // back up one since the loop will increment
        break;
      case "--canon-bytes":
        canonBytesMode = true;
        break;
      default:
        console.error(`unknown option: ${args[i]}`);
        usage();
        process.exit(1);
    }
  }

  // Read stdin
  const chunks = [];
  const stdin = fs.readFileSync(0);  // fd 0 = stdin
  const raw = Buffer.from(stdin);

  try {
    let mid;
    if (canonBytesMode) {
      mid = midFromCanonBytes(raw);
    } else if (mode === "bind") {
      mid = midBindJson(raw, pointers);
    } else {
      mid = midFullJson(raw);
    }
    console.log(mid);
  } catch (e) {
    if (e instanceof MapError) {
      console.error(`${e.code}: ${e.message}`);
      process.exit(1);
    }
    throw e;
  }
}

main();
