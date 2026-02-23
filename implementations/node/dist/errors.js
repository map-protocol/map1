"use strict";
// MAP v1.0 error codes and MapError class
Object.defineProperty(exports, "__esModule", { value: true });
exports.MapError = exports.ERR_LIMIT_SIZE = exports.ERR_LIMIT_DEPTH = exports.ERR_KEY_ORDER = exports.ERR_DUP_KEY = exports.ERR_UTF8 = exports.ERR_TYPE = exports.ERR_SCHEMA = exports.ERR_CANON_MCF = exports.ERR_CANON_HDR = void 0;
exports.ERR_CANON_HDR = "ERR_CANON_HDR";
exports.ERR_CANON_MCF = "ERR_CANON_MCF";
exports.ERR_SCHEMA = "ERR_SCHEMA";
exports.ERR_TYPE = "ERR_TYPE";
exports.ERR_UTF8 = "ERR_UTF8";
exports.ERR_DUP_KEY = "ERR_DUP_KEY";
exports.ERR_KEY_ORDER = "ERR_KEY_ORDER";
exports.ERR_LIMIT_DEPTH = "ERR_LIMIT_DEPTH";
exports.ERR_LIMIT_SIZE = "ERR_LIMIT_SIZE";
class MapError extends Error {
    constructor(code, msg) {
        super(msg || code);
        this.code = code;
        this.name = "MapError";
    }
}
exports.MapError = MapError;
