// MAP v1.0 constants

/** Canonical header: "MAP1\0" */
export const CANON_HDR: Buffer = Buffer.from("MAP1\0", "binary");

/** MCF type tags */
export const TAG_STRING = 0x01;
export const TAG_BYTES  = 0x02;
export const TAG_LIST   = 0x03;
export const TAG_MAP    = 0x04;

/** Structural limits */
export const MAX_CANON_BYTES  = 1_048_576;
export const MAX_DEPTH        = 32;
export const MAX_MAP_ENTRIES  = 65_535;
export const MAX_LIST_ENTRIES = 65_535;
