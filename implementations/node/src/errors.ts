// MAP v1.0 error codes and MapError class

export const ERR_CANON_HDR   = "ERR_CANON_HDR";
export const ERR_CANON_MCF   = "ERR_CANON_MCF";
export const ERR_SCHEMA      = "ERR_SCHEMA";
export const ERR_TYPE        = "ERR_TYPE";
export const ERR_UTF8        = "ERR_UTF8";
export const ERR_DUP_KEY     = "ERR_DUP_KEY";
export const ERR_KEY_ORDER   = "ERR_KEY_ORDER";
export const ERR_LIMIT_DEPTH = "ERR_LIMIT_DEPTH";
export const ERR_LIMIT_SIZE  = "ERR_LIMIT_SIZE";

export class MapError extends Error {
  readonly code: string;
  constructor(code: string, msg?: string) {
    super(msg || code);
    this.code = code;
    this.name = "MapError";
  }
}
