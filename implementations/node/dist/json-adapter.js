"use strict";
// MAP v1.0 JSON-STRICT adapter
// Hand-rolled RFC 8259 parser with duplicate-key detection after escape resolution.
Object.defineProperty(exports, "__esModule", { value: true });
exports.jsonToCanonValue = jsonToCanonValue;
exports.parseJsonStrictWithDups = parseJsonStrictWithDups;
const errors_1 = require("./errors");
const constants_1 = require("./constants");
const core_1 = require("./core");
// ────────── helpers ──────────
function isWS(ch) {
    return ch === 0x20 || ch === 0x09 || ch === 0x0a || ch === 0x0d;
}
function rejectBomStrict(raw) {
    let i = 0;
    while (i < raw.length && isWS(raw[i]))
        i++;
    if (i + 3 <= raw.length && raw[i] === 0xef && raw[i + 1] === 0xbb && raw[i + 2] === 0xbf) {
        throw new errors_1.MapError(errors_1.ERR_SCHEMA, "BOM");
    }
}
function utf8DecodeStrict(raw) {
    try {
        const dec = new TextDecoder("utf-8", { fatal: true });
        return dec.decode(raw);
    }
    catch {
        throw new errors_1.MapError(errors_1.ERR_UTF8, "json utf8");
    }
}
// ────────── parser ──────────
function parseJsonStrictWithDups(raw) {
    if (raw.length > constants_1.MAX_CANON_BYTES)
        throw new errors_1.MapError(errors_1.ERR_LIMIT_SIZE, "input too big");
    rejectBomStrict(raw);
    const text = utf8DecodeStrict(raw);
    let i = 0;
    let dupFound = false;
    let surrogateFound = false;
    function skipWS() {
        while (i < text.length && /\s/.test(text[i]))
            i++;
    }
    function expect(ch) {
        skipWS();
        if (text[i] !== ch)
            throw new errors_1.MapError(errors_1.ERR_CANON_MCF, "json parse");
        i++;
    }
    function parseString() {
        if (text[i] !== '"')
            throw new errors_1.MapError(errors_1.ERR_CANON_MCF, "json parse");
        i++;
        let out = "";
        let closed = false;
        while (i < text.length) {
            const ch = text[i++];
            if (ch.charCodeAt(0) < 0x20)
                throw new errors_1.MapError(errors_1.ERR_CANON_MCF, "json parse");
            if (ch === '"') {
                closed = true;
                break;
            }
            if (ch === "\\") {
                if (i >= text.length)
                    throw new errors_1.MapError(errors_1.ERR_CANON_MCF, "json parse");
                const esc = text[i++];
                if (esc === '"' || esc === "\\" || esc === "/")
                    out += esc;
                else if (esc === "b")
                    out += "\b";
                else if (esc === "f")
                    out += "\f";
                else if (esc === "n")
                    out += "\n";
                else if (esc === "r")
                    out += "\r";
                else if (esc === "t")
                    out += "\t";
                else if (esc === "u") {
                    const hex = text.slice(i, i + 4);
                    if (!/^[0-9a-fA-F]{4}$/.test(hex))
                        throw new errors_1.MapError(errors_1.ERR_CANON_MCF, "json parse");
                    const code = parseInt(hex, 16);
                    i += 4;
                    if (code >= 0xd800 && code <= 0xdfff) {
                        surrogateFound = true; // flag, do not append
                    }
                    else {
                        out += String.fromCodePoint(code);
                    }
                }
                else {
                    throw new errors_1.MapError(errors_1.ERR_CANON_MCF, "json parse");
                }
            }
            else {
                out += ch;
            }
        }
        if (!closed)
            throw new errors_1.MapError(errors_1.ERR_CANON_MCF, "json parse");
        (0, core_1.rejectSurrogatesInString)(out);
        return out;
    }
    function parseValue() {
        skipWS();
        if (i >= text.length)
            throw new errors_1.MapError(errors_1.ERR_CANON_MCF, "json parse");
        const c = text[i];
        if (c === "{")
            return parseObject();
        if (c === "[")
            return parseArray();
        if (c === '"')
            return parseString();
        if (c === "t" && text.startsWith("true", i)) {
            i += 4;
            return true;
        }
        if (c === "f" && text.startsWith("false", i)) {
            i += 5;
            return false;
        }
        if (c === "n" && text.startsWith("null", i)) {
            i += 4;
            return null;
        }
        if (c === "-" || (c >= "0" && c <= "9")) {
            const m = text.slice(i).match(/^-?(0|[1-9]\d*)(\.\d+)?([eE][+-]?\d+)?/);
            if (!m)
                throw new errors_1.MapError(errors_1.ERR_CANON_MCF, "json parse");
            i += m[0].length;
            return { __num__: m[0] };
        }
        throw new errors_1.MapError(errors_1.ERR_CANON_MCF, "json parse");
    }
    function parseObject() {
        const obj = {};
        const seen = new Set();
        i++; // skip {
        skipWS();
        if (text[i] === "}") {
            i++;
            return obj;
        }
        while (true) {
            skipWS();
            const key = parseString();
            (0, core_1.rejectSurrogatesInString)(key);
            if (seen.has(key)) {
                dupFound = true;
                skipWS();
                expect(":");
                parseValue();
                skipWS();
                if (text[i] === "}") {
                    i++;
                    break;
                }
                expect(",");
                continue;
            }
            seen.add(key);
            skipWS();
            expect(":");
            const val = parseValue();
            obj[key] = val;
            skipWS();
            if (text[i] === "}") {
                i++;
                break;
            }
            expect(",");
        }
        return obj;
    }
    function parseArray() {
        const arr = [];
        i++; // skip [
        skipWS();
        if (text[i] === "]") {
            i++;
            return arr;
        }
        while (true) {
            const v = parseValue();
            arr.push(v);
            skipWS();
            if (text[i] === "]") {
                i++;
                break;
            }
            expect(",");
        }
        return arr;
    }
    const v = parseValue();
    skipWS();
    if (i !== text.length)
        throw new errors_1.MapError(errors_1.ERR_CANON_MCF, "trailing json");
    return { v, dupFound, surrogateFound };
}
// ────────── JSON-to-canon value conversion ──────────
function jsonToCanonValue(x) {
    if (x && typeof x === "object" && "__num__" in x)
        throw new errors_1.MapError(errors_1.ERR_TYPE, "number");
    if (x === null)
        throw new errors_1.MapError(errors_1.ERR_TYPE, "null");
    if (typeof x === "boolean")
        return x ? "true" : "false";
    if (typeof x === "string")
        return x;
    if (Array.isArray(x))
        return x.map(jsonToCanonValue);
    if (typeof x === "object") {
        const out = {};
        for (const k of Object.keys(x)) {
            out[k] = jsonToCanonValue(x[k]);
        }
        return out;
    }
    throw new errors_1.MapError(errors_1.ERR_TYPE, "unknown");
}
