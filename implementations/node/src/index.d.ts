/**
 * @map-protocol/map1 — MAP v1.1 TypeScript declarations.
 */

export declare const SPEC_VERSION: "1.1";

export declare class MapError extends Error {
  code: string;
  constructor(code: string, msg?: string);
}

// Error codes
export declare const ERR_CANON_HDR: "ERR_CANON_HDR";
export declare const ERR_CANON_MCF: "ERR_CANON_MCF";
export declare const ERR_SCHEMA: "ERR_SCHEMA";
export declare const ERR_TYPE: "ERR_TYPE";
export declare const ERR_UTF8: "ERR_UTF8";
export declare const ERR_DUP_KEY: "ERR_DUP_KEY";
export declare const ERR_KEY_ORDER: "ERR_KEY_ORDER";
export declare const ERR_LIMIT_DEPTH: "ERR_LIMIT_DEPTH";
export declare const ERR_LIMIT_SIZE: "ERR_LIMIT_SIZE";

/** Canonical-model value: string, Buffer, boolean, bigint, array, or plain object. */
export type CanonValue =
  | string
  | Buffer
  | boolean
  | bigint
  | CanonValue[]
  | { [key: string]: CanonValue };

/** Compute a MID over the full descriptor (FULL projection). */
export declare function midFull(descriptor: CanonValue): string;

/** Compute a MID over selected fields (BIND projection). */
export declare function midBind(
  descriptor: { [key: string]: CanonValue },
  pointers: string[]
): string;

/** Return CANON_BYTES for the full descriptor. */
export declare function canonicalBytesFull(descriptor: CanonValue): Buffer;

/** Return CANON_BYTES for selected fields (BIND projection). */
export declare function canonicalBytesBind(
  descriptor: { [key: string]: CanonValue },
  pointers: string[]
): Buffer;

/** Compute a MID from raw UTF-8 JSON bytes (JSON-STRICT + FULL). */
export declare function midFullJson(raw: Buffer): string;

/** Compute a MID from raw UTF-8 JSON bytes (JSON-STRICT + BIND). */
export declare function midBindJson(raw: Buffer, pointers: string[]): string;

/** Validate pre-built CANON_BYTES and return MID (fast-path §3.7). */
export declare function midFromCanonBytes(canon: Buffer | Uint8Array): string;

/** Normalize a JS object for MID computation (convenience). */
export declare function prepare(
  descriptor: Record<string, any>,
  opts?: { floatPrecision?: number; omitNulls?: boolean }
): Record<string, CanonValue>;

/** Given multiple error codes, return the highest-precedence one (§6.2). */
export declare function chooseReportedError(errors: string[]): string;
