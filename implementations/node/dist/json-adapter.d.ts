interface NumMarker {
    __num__: string;
}
type JsonValue = string | boolean | null | NumMarker | JsonValue[] | {
    [k: string]: JsonValue;
};
interface ParseResult {
    v: JsonValue;
    dupFound: boolean;
    surrogateFound: boolean;
}
declare function parseJsonStrictWithDups(raw: Buffer): ParseResult;
export declare function jsonToCanonValue(x: JsonValue): unknown;
export { parseJsonStrictWithDups, ParseResult, JsonValue };
