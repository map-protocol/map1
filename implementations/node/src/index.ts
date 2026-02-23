// MAP v1.0 — Node/TypeScript package public API

export { MapError } from "./errors";
export {
  ERR_CANON_HDR,
  ERR_CANON_MCF,
  ERR_SCHEMA,
  ERR_TYPE,
  ERR_UTF8,
  ERR_DUP_KEY,
  ERR_KEY_ORDER,
  ERR_LIMIT_DEPTH,
  ERR_LIMIT_SIZE,
} from "./errors";

import { sha256Hex, canonBytesFromValue, midFromCanonBytes as _midFromCanonBytes } from "./core";
import { parseJsonStrictWithDups, jsonToCanonValue } from "./json-adapter";
import { bindProject } from "./projection";
import { MapError } from "./errors";
import { ERR_DUP_KEY, ERR_UTF8 } from "./errors";

export { midFromCanonBytes } from "./core";

// ────────── Descriptor-based API (JS objects) ──────────

/** Compute the FULL MID from a JS descriptor (plain object/string/array/boolean tree). */
export function midFull(descriptor: Record<string, unknown>): string {
  const canon = canonBytesFromValue(descriptor);
  return "map1:" + sha256Hex(canon);
}

/** Compute the BIND MID from a JS descriptor + pointer list. */
export function midBind(
  descriptor: Record<string, unknown>,
  pointers: string[],
): string {
  const proj = bindProject(descriptor, pointers);
  const canon = canonBytesFromValue(proj);
  return "map1:" + sha256Hex(canon);
}

/** Compute FULL canonical bytes from a JS descriptor. */
export function canonicalBytesFull(descriptor: Record<string, unknown>): Buffer {
  return canonBytesFromValue(descriptor);
}

/** Compute BIND canonical bytes from a JS descriptor + pointer list. */
export function canonicalBytesBind(
  descriptor: Record<string, unknown>,
  pointers: string[],
): Buffer {
  const proj = bindProject(descriptor, pointers);
  return canonBytesFromValue(proj);
}

// ────────── JSON-STRICT API (raw bytes) ──────────

/** Compute FULL MID from raw JSON bytes. Detects duplicate keys after escape resolution. */
export function midFullJson(raw: Buffer): string {
  const parsed = parseJsonStrictWithDups(raw);
  const val = jsonToCanonValue(parsed.v);
  const canon = canonBytesFromValue(val);
  if (parsed.dupFound) throw new MapError(ERR_DUP_KEY, "dup key");
  if (parsed.surrogateFound) throw new MapError(ERR_UTF8, "surrogate escape");
  return "map1:" + sha256Hex(canon);
}

/** Compute BIND MID from raw JSON bytes + pointer list. */
export function midBindJson(raw: Buffer, pointers: string[]): string {
  const parsed = parseJsonStrictWithDups(raw);
  const val = jsonToCanonValue(parsed.v);
  const proj = bindProject(val as Record<string, unknown>, pointers);
  const canon = canonBytesFromValue(proj);
  if (parsed.dupFound) throw new MapError(ERR_DUP_KEY, "dup key");
  if (parsed.surrogateFound) throw new MapError(ERR_UTF8, "surrogate escape");
  return "map1:" + sha256Hex(canon);
}
