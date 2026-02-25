package map1

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"math"
	"strconv"
	"strings"
)

// MIDFullJSON computes MID from raw UTF-8 JSON bytes (JSON-STRICT + FULL).
func MIDFullJSON(raw []byte) (string, error) {
	val, dupFound, err := jsonStrictParse(raw)
	if err != nil {
		return "", err
	}
	canon, err := CanonBytesFromValue(val)
	if err != nil {
		return "", err
	}
	// Raise dup_key only if no higher-precedence error already fired.
	if dupFound {
		return "", newErr(ErrDupKey, "duplicate key in JSON")
	}
	return "map1:" + sha256hex(canon), nil
}

// MIDBindJSON computes MID from raw UTF-8 JSON bytes (JSON-STRICT + BIND).
func MIDBindJSON(raw []byte, pointers []string) (string, error) {
	val, dupFound, err := jsonStrictParse(raw)
	if err != nil {
		return "", err
	}
	proj, err := BindProject(val, pointers)
	if err != nil {
		return "", err
	}
	canon, err := CanonBytesFromValue(proj)
	if err != nil {
		return "", err
	}
	if dupFound {
		return "", newErr(ErrDupKey, "duplicate key in JSON")
	}
	return "map1:" + sha256hex(canon), nil
}

// jsonStrictParse parses raw JSON under JSON-STRICT rules (§8).
// Returns (canonical_value, dup_found, error).
//
// Duplicate detection is deferred: we record the flag and keep parsing
// so higher-precedence errors (ERR_TYPE, ERR_UTF8) can surface first.
func jsonStrictParse(raw []byte) (Value, bool, error) {
	if len(raw) > MaxCanonBytes {
		return nil, false, newErr(ErrLimitSize, "input exceeds MAX_CANON_BYTES")
	}

	// BOM rejection (§8.1.1): check after skipping JSON whitespace.
	// Reject BOM even if preceded by whitespace.
	idx := 0
	for idx < len(raw) {
		b := raw[idx]
		if b == ' ' || b == '\t' || b == '\n' || b == '\r' {
			idx++
			continue
		}
		break
	}
	if idx+3 <= len(raw) && raw[idx] == 0xEF && raw[idx+1] == 0xBB && raw[idx+2] == 0xBF {
		return nil, false, newErr(ErrSchema, "UTF-8 BOM rejected")
	}

	// Pre-scan for lone surrogate escape sequences (§8.1).
	// Go's encoding/json silently replaces \uD800–\uDFFF with U+FFFD,
	// so ensureNoSurrogates() on the decoded string never catches them.
	// We must detect them at the raw byte level before parsing.
	if err := scanForSurrogateEscapes(raw); err != nil {
		return nil, false, err
	}

	// Parse JSON using token-level decoder for duplicate detection.
	dec := json.NewDecoder(bytes.NewReader(raw))
	dec.UseNumber()

	dupFound := false
	val, err := decodeJSONValue(dec, &dupFound, 1)
	if err != nil {
		return nil, false, err
	}

	// Check for trailing non-whitespace after the root value.
	// json.Decoder might leave extra tokens in the stream.
	tok, err2 := dec.Token()
	if err2 == nil {
		// There's another token — that's ERR_CANON_MCF (two roots, etc.).
		_ = tok
		return nil, false, newErr(ErrCanonMCF, "trailing JSON content")
	}
	// err2 should be io.EOF for well-formed single-root JSON.
	if err2 != io.EOF {
		// Some parse error in trailing content.
		return nil, false, newErr(ErrCanonMCF, "JSON parse error in trailing content")
	}

	return val, dupFound, nil
}

// decodeJSONValue recursively decodes one JSON value from the decoder.
// depth tracks container nesting for the canonical model (root MAP/LIST = 1).
func decodeJSONValue(dec *json.Decoder, dupFound *bool, depth int) (Value, error) {
	tok, err := dec.Token()
	if err != nil {
		// Distinguish JSON syntax errors from EOF.
		if err == io.EOF {
			return nil, newErr(ErrCanonMCF, "unexpected EOF")
		}
		return nil, newErr(ErrCanonMCF, "JSON parse error")
	}

	switch v := tok.(type) {

	case json.Delim:
		switch v {
		case '{':
			return decodeJSONObject(dec, dupFound, depth)
		case '[':
			return decodeJSONArray(dec, dupFound, depth)
		default:
			return nil, newErr(ErrCanonMCF, "unexpected delimiter")
		}

	case string:
		// Check for surrogates in the decoded string.
		if err := ensureNoSurrogates(v); err != nil {
			return nil, err
		}
		return String(v), nil

	case bool:
		return Bool(v), nil

	case json.Number:
		return convertJSONNumber(v)

	case nil:
		// JSON null → ERR_TYPE.
		return nil, newErr(ErrType, "JSON null not allowed")

	default:
		return nil, newErr(ErrSchema, fmt.Sprintf("unexpected JSON type: %T", tok))
	}
}

// decodeJSONObject decodes a JSON object with duplicate key detection.
// The opening '{' has already been consumed.
func decodeJSONObject(dec *json.Decoder, dupFound *bool, depth int) (Value, error) {
	if depth > MaxDepth {
		return nil, newErr(ErrLimitDepth, "exceeds MAX_DEPTH")
	}

	keys := make([]string, 0, 8)
	vals := make([]Value, 0, 8)
	seen := make(map[string]bool, 8)

	for dec.More() {
		// Read key token.
		kTok, err := dec.Token()
		if err != nil {
			return nil, newErr(ErrCanonMCF, "JSON parse error reading key")
		}
		key, ok := kTok.(string)
		if !ok {
			return nil, newErr(ErrSchema, "JSON key is not a string")
		}
		if err := ensureNoSurrogates(key); err != nil {
			return nil, err
		}

		// Duplicate detection after escape resolution (§8.3).
		// json.Decoder has already resolved \uXXXX escapes.
		if seen[key] {
			*dupFound = true
			// Keep parsing to find higher-precedence errors, but skip this value.
			childDepth := depth // don't increment for the skipped value's children
			_, err := decodeJSONValue(dec, dupFound, childDepth)
			if err != nil {
				return nil, err
			}
			continue
		}
		seen[key] = true

		// Compute child depth: only containers increment.
		childDepth := depth + 1
		val, err := decodeJSONValue(dec, dupFound, childDepth)
		if err != nil {
			return nil, err
		}
		keys = append(keys, key)
		vals = append(vals, val)
	}

	// Consume closing '}'.
	tok, err := dec.Token()
	if err != nil {
		return nil, newErr(ErrCanonMCF, "JSON parse error: missing '}'")
	}
	if d, ok := tok.(json.Delim); !ok || d != '}' {
		return nil, newErr(ErrCanonMCF, "expected '}'")
	}

	return &Map{Keys: keys, Values: vals}, nil
}

// decodeJSONArray decodes a JSON array.
// The opening '[' has already been consumed.
func decodeJSONArray(dec *json.Decoder, dupFound *bool, depth int) (Value, error) {
	if depth > MaxDepth {
		return nil, newErr(ErrLimitDepth, "exceeds MAX_DEPTH")
	}

	arr := make(List, 0, 8)
	for dec.More() {
		childDepth := depth + 1
		val, err := decodeJSONValue(dec, dupFound, childDepth)
		if err != nil {
			return nil, err
		}
		arr = append(arr, val)
	}

	// Consume closing ']'.
	tok, err := dec.Token()
	if err != nil {
		return nil, newErr(ErrCanonMCF, "JSON parse error: missing ']'")
	}
	if d, ok := tok.(json.Delim); !ok || d != ']' {
		return nil, newErr(ErrCanonMCF, "expected ']'")
	}

	return arr, nil
}

// convertJSONNumber inspects the raw JSON number token string to
// distinguish integers from floats (§8.2.1).
//
// json.Number is a string wrapper that preserves the exact token — this
// is critical because we need to reject "1.0" even though its numeric
// value is integral.  We inspect the string for '.' and 'e'/'E', then
// parse with strconv.ParseInt for range checking.
func convertJSONNumber(n json.Number) (Value, error) {
	s := n.String()

	// Condition (a)/(b): reject if decimal point or exponent present.
	if strings.ContainsAny(s, ".eE") {
		return nil, newErr(ErrType, "JSON float not allowed: "+s)
	}

	// Parse as signed 64-bit integer.
	val, err := strconv.ParseInt(s, 10, 64)
	if err != nil {
		// Range overflow → ERR_TYPE (not ERR_CANON_MCF).
		return nil, newErr(ErrType, "integer overflow: "+s)
	}
	// Additional range check (strconv.ParseInt already handles int64 range,
	// but be explicit for clarity).
	if val < math.MinInt64 || val > math.MaxInt64 {
		return nil, newErr(ErrType, "integer out of int64 range: "+s)
	}
	return Integer(val), nil
}

// ensureNoSurrogates checks for surrogate code points in a decoded string.
// Go's encoding/json decoder can produce surrogates from \uD800-\uDFFF
// escape sequences (it decodes them as replacement characters or passes
// them through depending on version), but we must reject any surrogate.
func ensureNoSurrogates(s string) error {
	for _, r := range s {
		if r >= 0xD800 && r <= 0xDFFF {
			return newErr(ErrUTF8, fmt.Sprintf("surrogate U+%04X in JSON string", r))
		}
	}
	return nil
}

// scanForSurrogateEscapes scans raw JSON bytes for \uD800–\uDFFF escape
// sequences.  Go's encoding/json silently converts these to U+FFFD, so
// we must catch them here before the decoder swallows them.
//
// A high surrogate (\uD800–\uDBFF) followed by a low surrogate (\uDC00–\uDFFF)
// is a valid surrogate pair — but JSON-STRICT still rejects them because
// JSON text is UTF-8, and surrogates are only meaningful in UTF-16.
func scanForSurrogateEscapes(raw []byte) error {
	inString := false
	i := 0
	for i < len(raw) {
		b := raw[i]
		if !inString {
			if b == '"' {
				inString = true
			}
			i++
			continue
		}
		// Inside a string.
		if b == '\\' {
			i++
			if i >= len(raw) {
				break
			}
			if raw[i] == 'u' && i+4 < len(raw) {
				hex := string(raw[i+1 : i+5])
				cp, err := strconv.ParseUint(hex, 16, 16)
				if err == nil && cp >= 0xD800 && cp <= 0xDFFF {
					return newErr(ErrUTF8, fmt.Sprintf("surrogate escape \\u%s", hex))
				}
				i += 5
				continue
			}
			i++
			continue
		}
		if b == '"' {
			inString = false
		}
		i++
	}
	return nil
}
