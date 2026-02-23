export { MapError } from "./errors";
export { ERR_CANON_HDR, ERR_CANON_MCF, ERR_SCHEMA, ERR_TYPE, ERR_UTF8, ERR_DUP_KEY, ERR_KEY_ORDER, ERR_LIMIT_DEPTH, ERR_LIMIT_SIZE, } from "./errors";
export { midFromCanonBytes } from "./core";
/** Compute the FULL MID from a JS descriptor (plain object/string/array/boolean tree). */
export declare function midFull(descriptor: Record<string, unknown>): string;
/** Compute the BIND MID from a JS descriptor + pointer list. */
export declare function midBind(descriptor: Record<string, unknown>, pointers: string[]): string;
/** Compute FULL canonical bytes from a JS descriptor. */
export declare function canonicalBytesFull(descriptor: Record<string, unknown>): Buffer;
/** Compute BIND canonical bytes from a JS descriptor + pointer list. */
export declare function canonicalBytesBind(descriptor: Record<string, unknown>, pointers: string[]): Buffer;
/** Compute FULL MID from raw JSON bytes. Detects duplicate keys after escape resolution. */
export declare function midFullJson(raw: Buffer): string;
/** Compute BIND MID from raw JSON bytes + pointer list. */
export declare function midBindJson(raw: Buffer, pointers: string[]): string;
