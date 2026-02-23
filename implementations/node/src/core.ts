// MAP v1.0 core: MCF binary format encode/decode, key comparison, UTF-8 validation

import { createHash } from "crypto";
import {
  CANON_HDR,
  TAG_STRING, TAG_BYTES, TAG_LIST, TAG_MAP,
  MAX_CANON_BYTES, MAX_DEPTH, MAX_MAP_ENTRIES, MAX_LIST_ENTRIES,
} from "./constants";
import {
  MapError,
  ERR_CANON_HDR, ERR_CANON_MCF, ERR_SCHEMA,
  ERR_UTF8, ERR_DUP_KEY, ERR_KEY_ORDER,
  ERR_LIMIT_DEPTH, ERR_LIMIT_SIZE,
} from "./errors";

// ────────── helpers ──────────

export function sha256Hex(buf: Buffer): string {
  return createHash("sha256").update(buf).digest("hex");
}

/** Unsigned byte-wise comparison (memcmp semantics). */
export function keyCmp(a: Buffer, b: Buffer): number {
  const m = Math.min(a.length, b.length);
  for (let i = 0; i < m; i++) {
    if (a[i] !== b[i]) return a[i] < b[i] ? -1 : 1;
  }
  if (a.length === b.length) return 0;
  return a.length < b.length ? -1 : 1;
}

/** Reject strings containing unpaired surrogates (lone high/low code units). */
export function rejectSurrogatesInString(s: string): void {
  for (let i = 0; i < s.length; i++) {
    const cu = s.charCodeAt(i);
    if (cu >= 0xd800 && cu <= 0xdbff) {
      if (i + 1 >= s.length) throw new MapError(ERR_UTF8, "unpaired surrogate");
      const cu2 = s.charCodeAt(i + 1);
      if (!(cu2 >= 0xdc00 && cu2 <= 0xdfff)) throw new MapError(ERR_UTF8, "unpaired surrogate");
      i++; // consume well-formed pair (astral scalar)
      continue;
    }
    if (cu >= 0xdc00 && cu <= 0xdfff) throw new MapError(ERR_UTF8, "unpaired surrogate");
  }
}

/** Validate a byte buffer as UTF-8 scalar values. Returns the decoded JS string. */
export function validateUtf8ScalarBytes(bytes: Uint8Array): string {
  let s: string;
  try {
    const dec = new TextDecoder("utf-8", { fatal: true });
    s = dec.decode(bytes);
  } catch {
    throw new MapError(ERR_UTF8, "invalid utf8");
  }
  rejectSurrogatesInString(s);
  return s;
}

function u32be(n: number): Buffer {
  const b = Buffer.alloc(4);
  b.writeUInt32BE(n >>> 0, 0);
  return b;
}

function readU32BE(buf: Buffer, off: number): [number, number] {
  if (off + 4 > buf.length) throw new MapError(ERR_CANON_MCF, "truncated u32");
  return [buf.readUInt32BE(off), off + 4];
}

// ────────── MCF decode ──────────

type McfValue = string | Buffer | McfValue[] | { [key: string]: McfValue };

function mcfDecodeOne(buf: Buffer, off: number, depth: number): [McfValue, number, Buffer | null] {
  if (off >= buf.length) throw new MapError(ERR_CANON_MCF, "truncated tag");
  const tag = buf[off]; off += 1;

  if (tag === TAG_STRING) {
    let n: number; [n, off] = readU32BE(buf, off);
    if (off + n > buf.length) throw new MapError(ERR_CANON_MCF, "truncated string");
    const sb = buf.subarray(off, off + n); off += n;
    const s = validateUtf8ScalarBytes(sb);
    return [s, off, Buffer.from(sb)];
  }

  if (tag === TAG_BYTES) {
    let n: number; [n, off] = readU32BE(buf, off);
    if (off + n > buf.length) throw new MapError(ERR_CANON_MCF, "truncated bytes");
    const b = buf.subarray(off, off + n); off += n;
    return [Buffer.from(b), off, null];
  }

  if (tag === TAG_LIST) {
    if (depth + 1 > MAX_DEPTH) throw new MapError(ERR_LIMIT_DEPTH, "depth");
    let count: number; [count, off] = readU32BE(buf, off);
    if (count > MAX_LIST_ENTRIES) throw new MapError(ERR_LIMIT_SIZE, "list entries");
    const arr: McfValue[] = [];
    for (let i = 0; i < count; i++) {
      const res = mcfDecodeOne(buf, off, depth + 1);
      arr.push(res[0]);
      off = res[1];
    }
    return [arr, off, null];
  }

  if (tag === TAG_MAP) {
    if (depth + 1 > MAX_DEPTH) throw new MapError(ERR_LIMIT_DEPTH, "depth");
    let count: number; [count, off] = readU32BE(buf, off);
    if (count > MAX_MAP_ENTRIES) throw new MapError(ERR_LIMIT_SIZE, "map entries");
    const obj: Record<string, McfValue> = {};
    let prevKeyBytes: Buffer | null = null;
    for (let i = 0; i < count; i++) {
      if (off >= buf.length) throw new MapError(ERR_CANON_MCF, "truncated map key tag");
      if (buf[off] !== TAG_STRING) throw new MapError(ERR_SCHEMA, "map key not string");
      const [k, offK, kBytes] = mcfDecodeOne(buf, off, depth + 1);
      off = offK;
      const kb = kBytes!;
      if (prevKeyBytes !== null) {
        const c = keyCmp(prevKeyBytes, kb);
        if (c === 0) throw new MapError(ERR_DUP_KEY, "dup");
        if (c > 0) throw new MapError(ERR_KEY_ORDER, "order");
      }
      prevKeyBytes = kb;
      const resV = mcfDecodeOne(buf, off, depth + 1);
      off = resV[1];
      obj[k as string] = resV[0];
    }
    return [obj, off, null];
  }

  throw new MapError(ERR_CANON_MCF, "unknown tag");
}

// ────────── MCF encode ──────────

export function mcfEncodeValue(val: unknown, depth: number): Buffer {
  if (typeof val === "string") {
    const b = Buffer.from(val, "utf8");
    validateUtf8ScalarBytes(b);
    return Buffer.concat([Buffer.from([TAG_STRING]), u32be(b.length), b]);
  }
  if (Buffer.isBuffer(val)) {
    return Buffer.concat([Buffer.from([TAG_BYTES]), u32be(val.length), val]);
  }
  if (Array.isArray(val)) {
    if (depth + 1 > MAX_DEPTH) throw new MapError(ERR_LIMIT_DEPTH, "depth");
    if (val.length > MAX_LIST_ENTRIES) throw new MapError(ERR_LIMIT_SIZE, "list entries");
    const parts: Buffer[] = [Buffer.from([TAG_LIST]), u32be(val.length)];
    for (const it of val) parts.push(mcfEncodeValue(it, depth + 1));
    return Buffer.concat(parts);
  }
  if (val && typeof val === "object") {
    if (depth + 1 > MAX_DEPTH) throw new MapError(ERR_LIMIT_DEPTH, "depth");
    const keys = Object.keys(val as Record<string, unknown>);
    const sorted = keys.slice().sort((ka, kb) => keyCmp(Buffer.from(ka, "utf8"), Buffer.from(kb, "utf8")));
    // enforce ordering and uniqueness
    for (let i = 1; i < sorted.length; i++) {
      const a = Buffer.from(sorted[i - 1], "utf8");
      const b = Buffer.from(sorted[i], "utf8");
      const c = keyCmp(a, b);
      if (c === 0) throw new MapError(ERR_DUP_KEY, "dup");
      if (c > 0) throw new MapError(ERR_KEY_ORDER, "order");
    }
    if (sorted.length > MAX_MAP_ENTRIES) throw new MapError(ERR_LIMIT_SIZE, "map entries");
    const parts: Buffer[] = [Buffer.from([TAG_MAP]), u32be(sorted.length)];
    for (const k of sorted) {
      const kb = Buffer.from(k, "utf8");
      parts.push(Buffer.concat([Buffer.from([TAG_STRING]), u32be(kb.length), kb]));
      parts.push(mcfEncodeValue((val as Record<string, unknown>)[k], depth + 1));
    }
    return Buffer.concat(parts);
  }
  throw new MapError(ERR_SCHEMA, "unsupported type");
}

// ────────── public core API ──────────

/** Encode a descriptor value to canonical bytes (MAP1 header + MCF body). */
export function canonBytesFromValue(val: unknown): Buffer {
  const body = mcfEncodeValue(val, 0);
  const canon = Buffer.concat([CANON_HDR, body]);
  if (canon.length > MAX_CANON_BYTES) throw new MapError(ERR_LIMIT_SIZE, "too big");
  return canon;
}

/** Compute MID from pre-formed canonical bytes. Validates header + MCF structure. */
export function midFromCanonBytes(canon: Buffer): string {
  if (canon.length > MAX_CANON_BYTES) throw new MapError(ERR_LIMIT_SIZE, "canon exceeds");
  if (canon.subarray(0, CANON_HDR.length).compare(CANON_HDR) !== 0) {
    throw new MapError(ERR_CANON_HDR, "bad header");
  }
  let off = CANON_HDR.length;
  const res = mcfDecodeOne(canon, off, 0);
  off = res[1];
  if (off !== canon.length) throw new MapError(ERR_CANON_MCF, "trailing bytes");
  return "map1:" + sha256Hex(canon);
}
