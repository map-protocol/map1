export declare const ERR_CANON_HDR = "ERR_CANON_HDR";
export declare const ERR_CANON_MCF = "ERR_CANON_MCF";
export declare const ERR_SCHEMA = "ERR_SCHEMA";
export declare const ERR_TYPE = "ERR_TYPE";
export declare const ERR_UTF8 = "ERR_UTF8";
export declare const ERR_DUP_KEY = "ERR_DUP_KEY";
export declare const ERR_KEY_ORDER = "ERR_KEY_ORDER";
export declare const ERR_LIMIT_DEPTH = "ERR_LIMIT_DEPTH";
export declare const ERR_LIMIT_SIZE = "ERR_LIMIT_SIZE";
export declare class MapError extends Error {
    readonly code: string;
    constructor(code: string, msg?: string);
}
