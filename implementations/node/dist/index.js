"use strict";
// MAP v1.0 — Node/TypeScript package public API
Object.defineProperty(exports, "__esModule", { value: true });
exports.midFromCanonBytes = exports.ERR_LIMIT_SIZE = exports.ERR_LIMIT_DEPTH = exports.ERR_KEY_ORDER = exports.ERR_DUP_KEY = exports.ERR_UTF8 = exports.ERR_TYPE = exports.ERR_SCHEMA = exports.ERR_CANON_MCF = exports.ERR_CANON_HDR = exports.MapError = void 0;
exports.midFull = midFull;
exports.midBind = midBind;
exports.canonicalBytesFull = canonicalBytesFull;
exports.canonicalBytesBind = canonicalBytesBind;
exports.midFullJson = midFullJson;
exports.midBindJson = midBindJson;
var errors_1 = require("./errors");
Object.defineProperty(exports, "MapError", { enumerable: true, get: function () { return errors_1.MapError; } });
var errors_2 = require("./errors");
Object.defineProperty(exports, "ERR_CANON_HDR", { enumerable: true, get: function () { return errors_2.ERR_CANON_HDR; } });
Object.defineProperty(exports, "ERR_CANON_MCF", { enumerable: true, get: function () { return errors_2.ERR_CANON_MCF; } });
Object.defineProperty(exports, "ERR_SCHEMA", { enumerable: true, get: function () { return errors_2.ERR_SCHEMA; } });
Object.defineProperty(exports, "ERR_TYPE", { enumerable: true, get: function () { return errors_2.ERR_TYPE; } });
Object.defineProperty(exports, "ERR_UTF8", { enumerable: true, get: function () { return errors_2.ERR_UTF8; } });
Object.defineProperty(exports, "ERR_DUP_KEY", { enumerable: true, get: function () { return errors_2.ERR_DUP_KEY; } });
Object.defineProperty(exports, "ERR_KEY_ORDER", { enumerable: true, get: function () { return errors_2.ERR_KEY_ORDER; } });
Object.defineProperty(exports, "ERR_LIMIT_DEPTH", { enumerable: true, get: function () { return errors_2.ERR_LIMIT_DEPTH; } });
Object.defineProperty(exports, "ERR_LIMIT_SIZE", { enumerable: true, get: function () { return errors_2.ERR_LIMIT_SIZE; } });
const core_1 = require("./core");
const json_adapter_1 = require("./json-adapter");
const projection_1 = require("./projection");
const errors_3 = require("./errors");
const errors_4 = require("./errors");
var core_2 = require("./core");
Object.defineProperty(exports, "midFromCanonBytes", { enumerable: true, get: function () { return core_2.midFromCanonBytes; } });
// ────────── Descriptor-based API (JS objects) ──────────
/** Compute the FULL MID from a JS descriptor (plain object/string/array/boolean tree). */
function midFull(descriptor) {
    const canon = (0, core_1.canonBytesFromValue)(descriptor);
    return "map1:" + (0, core_1.sha256Hex)(canon);
}
/** Compute the BIND MID from a JS descriptor + pointer list. */
function midBind(descriptor, pointers) {
    const proj = (0, projection_1.bindProject)(descriptor, pointers);
    const canon = (0, core_1.canonBytesFromValue)(proj);
    return "map1:" + (0, core_1.sha256Hex)(canon);
}
/** Compute FULL canonical bytes from a JS descriptor. */
function canonicalBytesFull(descriptor) {
    return (0, core_1.canonBytesFromValue)(descriptor);
}
/** Compute BIND canonical bytes from a JS descriptor + pointer list. */
function canonicalBytesBind(descriptor, pointers) {
    const proj = (0, projection_1.bindProject)(descriptor, pointers);
    return (0, core_1.canonBytesFromValue)(proj);
}
// ────────── JSON-STRICT API (raw bytes) ──────────
/** Compute FULL MID from raw JSON bytes. Detects duplicate keys after escape resolution. */
function midFullJson(raw) {
    const parsed = (0, json_adapter_1.parseJsonStrictWithDups)(raw);
    const val = (0, json_adapter_1.jsonToCanonValue)(parsed.v);
    const canon = (0, core_1.canonBytesFromValue)(val);
    if (parsed.dupFound)
        throw new errors_3.MapError(errors_4.ERR_DUP_KEY, "dup key");
    if (parsed.surrogateFound)
        throw new errors_3.MapError(errors_4.ERR_UTF8, "surrogate escape");
    return "map1:" + (0, core_1.sha256Hex)(canon);
}
/** Compute BIND MID from raw JSON bytes + pointer list. */
function midBindJson(raw, pointers) {
    const parsed = (0, json_adapter_1.parseJsonStrictWithDups)(raw);
    const val = (0, json_adapter_1.jsonToCanonValue)(parsed.v);
    const proj = (0, projection_1.bindProject)(val, pointers);
    const canon = (0, core_1.canonBytesFromValue)(proj);
    if (parsed.dupFound)
        throw new errors_3.MapError(errors_4.ERR_DUP_KEY, "dup key");
    if (parsed.surrogateFound)
        throw new errors_3.MapError(errors_4.ERR_UTF8, "surrogate escape");
    return "map1:" + (0, core_1.sha256Hex)(canon);
}
