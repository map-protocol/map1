// MAP v1.0 JSON-STRICT adapter
// Hand-rolled RFC 8259 parser with duplicate-key detection after escape resolution.

import {
  MapError,
  ERR_CANON_MCF, ERR_SCHEMA, ERR_TYPE, ERR_UTF8, ERR_DUP_KEY, ERR_LIMIT_SIZE,
} from "./errors";
import { MAX_CANON_BYTES } from "./constants";
import { rejectSurrogatesInString } from "./core";

// ────────── helpers ──────────

function isWS(ch: number): boolean {
  return ch === 0x20 || ch === 0x09 || ch === 0x0a || ch === 0x0d;
}

function rejectBomStrict(raw: Buffer): void {
  let i = 0;
  while (i < raw.length && isWS(raw[i])) i++;
  if (i + 3 <= raw.length && raw[i] === 0xef && raw[i + 1] === 0xbb && raw[i + 2] === 0xbf) {
    throw new MapError(ERR_SCHEMA, "BOM");
  }
}

function utf8DecodeStrict(raw: Buffer): string {
  try {
    const dec = new TextDecoder("utf-8", { fatal: true });
    return dec.decode(raw);
  } catch {
    throw new MapError(ERR_UTF8, "json utf8");
  }
}

// Number marker used to defer rejection
interface NumMarker { __num__: string }

type JsonValue = string | boolean | null | NumMarker | JsonValue[] | { [k: string]: JsonValue };

interface ParseResult {
  v: JsonValue;
  dupFound: boolean;
  surrogateFound: boolean;
}

// ────────── parser ──────────

function parseJsonStrictWithDups(raw: Buffer): ParseResult {
  if (raw.length > MAX_CANON_BYTES) throw new MapError(ERR_LIMIT_SIZE, "input too big");
  rejectBomStrict(raw);
  const text = utf8DecodeStrict(raw);
  let i = 0;
  let dupFound = false;
  let surrogateFound = false;

  function skipWS(): void {
    while (i < text.length && /\s/.test(text[i])) i++;
  }

  function expect(ch: string): void {
    skipWS();
    if (text[i] !== ch) throw new MapError(ERR_CANON_MCF, "json parse");
    i++;
  }

  function parseString(): string {
    if (text[i] !== '"') throw new MapError(ERR_CANON_MCF, "json parse");
    i++;
    let out = "";
    let closed = false;
    while (i < text.length) {
      const ch = text[i++];
      if (ch.charCodeAt(0) < 0x20) throw new MapError(ERR_CANON_MCF, "json parse");
      if (ch === '"') { closed = true; break; }
      if (ch === "\\") {
        if (i >= text.length) throw new MapError(ERR_CANON_MCF, "json parse");
        const esc = text[i++];
        if (esc === '"' || esc === "\\" || esc === "/") out += esc;
        else if (esc === "b") out += "\b";
        else if (esc === "f") out += "\f";
        else if (esc === "n") out += "\n";
        else if (esc === "r") out += "\r";
        else if (esc === "t") out += "\t";
        else if (esc === "u") {
          const hex = text.slice(i, i + 4);
          if (!/^[0-9a-fA-F]{4}$/.test(hex)) throw new MapError(ERR_CANON_MCF, "json parse");
          const code = parseInt(hex, 16);
          i += 4;
          if (code >= 0xd800 && code <= 0xdfff) {
            surrogateFound = true; // flag, do not append
          } else {
            out += String.fromCodePoint(code);
          }
        } else {
          throw new MapError(ERR_CANON_MCF, "json parse");
        }
      } else {
        out += ch;
      }
    }
    if (!closed) throw new MapError(ERR_CANON_MCF, "json parse");
    rejectSurrogatesInString(out);
    return out;
  }

  function parseValue(): JsonValue {
    skipWS();
    if (i >= text.length) throw new MapError(ERR_CANON_MCF, "json parse");
    const c = text[i];
    if (c === "{") return parseObject();
    if (c === "[") return parseArray();
    if (c === '"') return parseString();
    if (c === "t" && text.startsWith("true", i)) { i += 4; return true; }
    if (c === "f" && text.startsWith("false", i)) { i += 5; return false; }
    if (c === "n" && text.startsWith("null", i)) { i += 4; return null; }
    if (c === "-" || (c >= "0" && c <= "9")) {
      const m = text.slice(i).match(/^-?(0|[1-9]\d*)(\.\d+)?([eE][+-]?\d+)?/);
      if (!m) throw new MapError(ERR_CANON_MCF, "json parse");
      i += m[0].length;
      return { __num__: m[0] } as NumMarker;
    }
    throw new MapError(ERR_CANON_MCF, "json parse");
  }

  function parseObject(): Record<string, JsonValue> {
    const obj: Record<string, JsonValue> = {};
    const seen = new Set<string>();
    i++; // skip {
    skipWS();
    if (text[i] === "}") { i++; return obj; }
    while (true) {
      skipWS();
      const key = parseString();
      rejectSurrogatesInString(key);
      if (seen.has(key)) {
        dupFound = true;
        skipWS(); expect(":"); parseValue(); skipWS();
        if (text[i] === "}") { i++; break; }
        expect(","); continue;
      }
      seen.add(key);
      skipWS();
      expect(":");
      const val = parseValue();
      obj[key] = val;
      skipWS();
      if (text[i] === "}") { i++; break; }
      expect(",");
    }
    return obj;
  }

  function parseArray(): JsonValue[] {
    const arr: JsonValue[] = [];
    i++; // skip [
    skipWS();
    if (text[i] === "]") { i++; return arr; }
    while (true) {
      const v = parseValue();
      arr.push(v);
      skipWS();
      if (text[i] === "]") { i++; break; }
      expect(",");
    }
    return arr;
  }

  const v = parseValue();
  skipWS();
  if (i !== text.length) throw new MapError(ERR_CANON_MCF, "trailing json");
  return { v, dupFound, surrogateFound };
}

// ────────── JSON-to-canon value conversion ──────────

export function jsonToCanonValue(x: JsonValue): unknown {
  if (x && typeof x === "object" && "__num__" in x) throw new MapError(ERR_TYPE, "number");
  if (x === null) throw new MapError(ERR_TYPE, "null");
  if (typeof x === "boolean") return x ? "true" : "false";
  if (typeof x === "string") return x;
  if (Array.isArray(x)) return x.map(jsonToCanonValue);
  if (typeof x === "object") {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(x)) {
      out[k] = jsonToCanonValue(x[k]);
    }
    return out;
  }
  throw new MapError(ERR_TYPE, "unknown");
}

// ────────── public JSON adapter API ──────────

export { parseJsonStrictWithDups, ParseResult, JsonValue };
