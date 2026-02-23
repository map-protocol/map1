"use strict";
// MAP v1.0 constants
Object.defineProperty(exports, "__esModule", { value: true });
exports.MAX_LIST_ENTRIES = exports.MAX_MAP_ENTRIES = exports.MAX_DEPTH = exports.MAX_CANON_BYTES = exports.TAG_MAP = exports.TAG_LIST = exports.TAG_BYTES = exports.TAG_STRING = exports.CANON_HDR = void 0;
/** Canonical header: "MAP1\0" */
exports.CANON_HDR = Buffer.from("MAP1\0", "binary");
/** MCF type tags */
exports.TAG_STRING = 0x01;
exports.TAG_BYTES = 0x02;
exports.TAG_LIST = 0x03;
exports.TAG_MAP = 0x04;
/** Structural limits */
exports.MAX_CANON_BYTES = 1048576;
exports.MAX_DEPTH = 32;
exports.MAX_MAP_ENTRIES = 65535;
exports.MAX_LIST_ENTRIES = 65535;
