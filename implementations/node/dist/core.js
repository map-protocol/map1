"use strict";
// MAP v1.0 core: MCF binary format encode/decode, key comparison, UTF-8 validation
Object.defineProperty(exports, "__esModule", { value: true });
exports.sha256Hex = sha256Hex;
exports.keyCmp = keyCmp;
exports.rejectSurrogatesInString = rejectSurrogatesInString;
exports.validateUtf8ScalarBytes = validateUtf8ScalarBytes;
exports.mcfEncodeValue = mcfEncodeValue;
exports.canonBytesFromValue = canonBytesFromValue;
exports.midFromCanonBytes = midFromCanonBytes;
const crypto_1 = require("crypto");
const constants_1 = require("./constants");
const errors_1 = require("./errors");
// ────────── helpers ──────────
function sha256Hex(buf) {
    return (0, crypto_1.createHash)("sha256").update(buf).digest("hex");
}
/** Unsigned byte-wise comparison (memcmp semantics). */
function keyCmp(a, b) {
    const m = Math.min(a.length, b.length);
    for (let i = 0; i < m; i++) {
        if (a[i] !== b[i])
            return a[i] < b[i] ? -1 : 1;
    }
    if (a.length === b.length)
        return 0;
    return a.length < b.length ? -1 : 1;
}
/** Reject strings containing unpaired surrogates (lone high/low code units). */
function rejectSurrogatesInString(s) {
    for (let i = 0; i < s.length; i++) {
        const cu = s.charCodeAt(i);
        if (cu >= 0xd800 && cu <= 0xdbff) {
            if (i + 1 >= s.length)
                throw new errors_1.MapError(errors_1.ERR_UTF8, "unpaired surrogate");
            const cu2 = s.charCodeAt(i + 1);
            if (!(cu2 >= 0xdc00 && cu2 <= 0xdfff))
                throw new errors_1.MapError(errors_1.ERR_UTF8, "unpaired surrogate");
            i++; // consume well-formed pair (astral scalar)
            continue;
        }
        if (cu >= 0xdc00 && cu <= 0xdfff)
            throw new errors_1.MapError(errors_1.ERR_UTF8, "unpaired surrogate");
    }
}
/** Validate a byte buffer as UTF-8 scalar values. Returns the decoded JS string. */
function validateUtf8ScalarBytes(bytes) {
    let s;
    try {
        const dec = new TextDecoder("utf-8", { fatal: true });
        s = dec.decode(bytes);
    }
    catch {
        throw new errors_1.MapError(errors_1.ERR_UTF8, "invalid utf8");
    }
    rejectSurrogatesInString(s);
    return s;
}
function u32be(n) {
    const b = Buffer.alloc(4);
    b.writeUInt32BE(n >>> 0, 0);
    return b;
}
function readU32BE(buf, off) {
    if (off + 4 > buf.length)
        throw new errors_1.MapError(errors_1.ERR_CANON_MCF, "truncated u32");
    return [buf.readUInt32BE(off), off + 4];
}
function mcfDecodeOne(buf, off, depth) {
    if (off >= buf.length)
        throw new errors_1.MapError(errors_1.ERR_CANON_MCF, "truncated tag");
    const tag = buf[off];
    off += 1;
    if (tag === constants_1.TAG_STRING) {
        let n;
        [n, off] = readU32BE(buf, off);
        if (off + n > buf.length)
            throw new errors_1.MapError(errors_1.ERR_CANON_MCF, "truncated string");
        const sb = buf.subarray(off, off + n);
        off += n;
        const s = validateUtf8ScalarBytes(sb);
        return [s, off, Buffer.from(sb)];
    }
    if (tag === constants_1.TAG_BYTES) {
        let n;
        [n, off] = readU32BE(buf, off);
        if (off + n > buf.length)
            throw new errors_1.MapError(errors_1.ERR_CANON_MCF, "truncated bytes");
        const b = buf.subarray(off, off + n);
        off += n;
        return [Buffer.from(b), off, null];
    }
    if (tag === constants_1.TAG_LIST) {
        if (depth + 1 > constants_1.MAX_DEPTH)
            throw new errors_1.MapError(errors_1.ERR_LIMIT_DEPTH, "depth");
        let count;
        [count, off] = readU32BE(buf, off);
        if (count > constants_1.MAX_LIST_ENTRIES)
            throw new errors_1.MapError(errors_1.ERR_LIMIT_SIZE, "list entries");
        const arr = [];
        for (let i = 0; i < count; i++) {
            const res = mcfDecodeOne(buf, off, depth + 1);
            arr.push(res[0]);
            off = res[1];
        }
        return [arr, off, null];
    }
    if (tag === constants_1.TAG_MAP) {
        if (depth + 1 > constants_1.MAX_DEPTH)
            throw new errors_1.MapError(errors_1.ERR_LIMIT_DEPTH, "depth");
        let count;
        [count, off] = readU32BE(buf, off);
        if (count > constants_1.MAX_MAP_ENTRIES)
            throw new errors_1.MapError(errors_1.ERR_LIMIT_SIZE, "map entries");
        const obj = {};
        let prevKeyBytes = null;
        for (let i = 0; i < count; i++) {
            if (off >= buf.length)
                throw new errors_1.MapError(errors_1.ERR_CANON_MCF, "truncated map key tag");
            if (buf[off] !== constants_1.TAG_STRING)
                throw new errors_1.MapError(errors_1.ERR_SCHEMA, "map key not string");
            const [k, offK, kBytes] = mcfDecodeOne(buf, off, depth + 1);
            off = offK;
            const kb = kBytes;
            if (prevKeyBytes !== null) {
                const c = keyCmp(prevKeyBytes, kb);
                if (c === 0)
                    throw new errors_1.MapError(errors_1.ERR_DUP_KEY, "dup");
                if (c > 0)
                    throw new errors_1.MapError(errors_1.ERR_KEY_ORDER, "order");
            }
            prevKeyBytes = kb;
            const resV = mcfDecodeOne(buf, off, depth + 1);
            off = resV[1];
            obj[k] = resV[0];
        }
        return [obj, off, null];
    }
    throw new errors_1.MapError(errors_1.ERR_CANON_MCF, "unknown tag");
}
// ────────── MCF encode ──────────
function mcfEncodeValue(val, depth) {
    if (typeof val === "string") {
        const b = Buffer.from(val, "utf8");
        validateUtf8ScalarBytes(b);
        return Buffer.concat([Buffer.from([constants_1.TAG_STRING]), u32be(b.length), b]);
    }
    if (Buffer.isBuffer(val)) {
        return Buffer.concat([Buffer.from([constants_1.TAG_BYTES]), u32be(val.length), val]);
    }
    if (Array.isArray(val)) {
        if (depth + 1 > constants_1.MAX_DEPTH)
            throw new errors_1.MapError(errors_1.ERR_LIMIT_DEPTH, "depth");
        if (val.length > constants_1.MAX_LIST_ENTRIES)
            throw new errors_1.MapError(errors_1.ERR_LIMIT_SIZE, "list entries");
        const parts = [Buffer.from([constants_1.TAG_LIST]), u32be(val.length)];
        for (const it of val)
            parts.push(mcfEncodeValue(it, depth + 1));
        return Buffer.concat(parts);
    }
    if (val && typeof val === "object") {
        if (depth + 1 > constants_1.MAX_DEPTH)
            throw new errors_1.MapError(errors_1.ERR_LIMIT_DEPTH, "depth");
        const keys = Object.keys(val);
        const sorted = keys.slice().sort((ka, kb) => keyCmp(Buffer.from(ka, "utf8"), Buffer.from(kb, "utf8")));
        // enforce ordering and uniqueness
        for (let i = 1; i < sorted.length; i++) {
            const a = Buffer.from(sorted[i - 1], "utf8");
            const b = Buffer.from(sorted[i], "utf8");
            const c = keyCmp(a, b);
            if (c === 0)
                throw new errors_1.MapError(errors_1.ERR_DUP_KEY, "dup");
            if (c > 0)
                throw new errors_1.MapError(errors_1.ERR_KEY_ORDER, "order");
        }
        if (sorted.length > constants_1.MAX_MAP_ENTRIES)
            throw new errors_1.MapError(errors_1.ERR_LIMIT_SIZE, "map entries");
        const parts = [Buffer.from([constants_1.TAG_MAP]), u32be(sorted.length)];
        for (const k of sorted) {
            const kb = Buffer.from(k, "utf8");
            parts.push(Buffer.concat([Buffer.from([constants_1.TAG_STRING]), u32be(kb.length), kb]));
            parts.push(mcfEncodeValue(val[k], depth + 1));
        }
        return Buffer.concat(parts);
    }
    throw new errors_1.MapError(errors_1.ERR_SCHEMA, "unsupported type");
}
// ────────── public core API ──────────
/** Encode a descriptor value to canonical bytes (MAP1 header + MCF body). */
function canonBytesFromValue(val) {
    const body = mcfEncodeValue(val, 0);
    const canon = Buffer.concat([constants_1.CANON_HDR, body]);
    if (canon.length > constants_1.MAX_CANON_BYTES)
        throw new errors_1.MapError(errors_1.ERR_LIMIT_SIZE, "too big");
    return canon;
}
/** Compute MID from pre-formed canonical bytes. Validates header + MCF structure. */
function midFromCanonBytes(canon) {
    if (canon.length > constants_1.MAX_CANON_BYTES)
        throw new errors_1.MapError(errors_1.ERR_LIMIT_SIZE, "canon exceeds");
    if (canon.subarray(0, constants_1.CANON_HDR.length).compare(constants_1.CANON_HDR) !== 0) {
        throw new errors_1.MapError(errors_1.ERR_CANON_HDR, "bad header");
    }
    let off = constants_1.CANON_HDR.length;
    const res = mcfDecodeOne(canon, off, 0);
    off = res[1];
    if (off !== canon.length)
        throw new errors_1.MapError(errors_1.ERR_CANON_MCF, "trailing bytes");
    return "map1:" + sha256Hex(canon);
}
