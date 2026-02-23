export declare function sha256Hex(buf: Buffer): string;
/** Unsigned byte-wise comparison (memcmp semantics). */
export declare function keyCmp(a: Buffer, b: Buffer): number;
/** Reject strings containing unpaired surrogates (lone high/low code units). */
export declare function rejectSurrogatesInString(s: string): void;
/** Validate a byte buffer as UTF-8 scalar values. Returns the decoded JS string. */
export declare function validateUtf8ScalarBytes(bytes: Uint8Array): string;
export declare function mcfEncodeValue(val: unknown, depth: number): Buffer;
/** Encode a descriptor value to canonical bytes (MAP1 header + MCF body). */
export declare function canonBytesFromValue(val: unknown): Buffer;
/** Compute MID from pre-formed canonical bytes. Validates header + MCF structure. */
export declare function midFromCanonBytes(canon: Buffer): string;
