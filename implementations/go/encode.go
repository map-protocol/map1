package map1

import (
	"bytes"
	"encoding/binary"
	"sort"
	"unicode/utf8"
)

// mcfEncode encodes a canonical model value into MCF bytes (§3.2).
//
// Depth tracks container nesting:
//   - Root call starts at depth=0.
//   - Entering a MAP or LIST checks depth+1 against MaxDepth.
//   - Scalars (STRING, BYTES, BOOLEAN, INTEGER) don't increment depth.
func mcfEncode(v Value, depth int) ([]byte, error) {
	// TODO: use sync.Pool for encode buffers to reduce GC pressure
	// on high-throughput MID computation.
	var buf bytes.Buffer
	if err := mcfEncodeTo(&buf, v, depth); err != nil {
		return nil, err
	}
	return buf.Bytes(), nil
}

func mcfEncodeTo(buf *bytes.Buffer, v Value, depth int) error {
	switch val := v.(type) {

	case Bool:
		buf.WriteByte(tagBoolean)
		if bool(val) {
			buf.WriteByte(0x01)
		} else {
			buf.WriteByte(0x00)
		}

	case Integer:
		buf.WriteByte(tagInteger)
		// Signed int64 → big-endian via cast to uint64.
		// This preserves two's complement representation correctly.
		var b [8]byte
		binary.BigEndian.PutUint64(b[:], uint64(val))
		buf.Write(b[:])

	case String:
		raw := []byte(string(val))
		if err := validateUTF8Scalar(raw); err != nil {
			return err
		}
		buf.WriteByte(tagString)
		writeU32BE(buf, uint32(len(raw)))
		buf.Write(raw)

	case Bytes:
		buf.WriteByte(tagBytes)
		writeU32BE(buf, uint32(len(val)))
		buf.Write([]byte(val))

	case List:
		if depth+1 > MaxDepth {
			return newErr(ErrLimitDepth, "depth exceeds MAX_DEPTH")
		}
		if len(val) > MaxListEntries {
			return newErr(ErrLimitSize, "list entry count exceeds limit")
		}
		buf.WriteByte(tagList)
		writeU32BE(buf, uint32(len(val)))
		for _, item := range val {
			if err := mcfEncodeTo(buf, item, depth+1); err != nil {
				return err
			}
		}

	case *Map:
		if depth+1 > MaxDepth {
			return newErr(ErrLimitDepth, "depth exceeds MAX_DEPTH")
		}
		if len(val.Keys) > MaxMapEntries {
			return newErr(ErrLimitSize, "map entry count exceeds limit")
		}
		// Collect keys as UTF-8 bytes, validate, then sort by memcmp.
		type kv struct {
			keyBytes []byte
			val      Value
		}
		items := make([]kv, len(val.Keys))
		for i, k := range val.Keys {
			kb := []byte(k)
			if err := validateUTF8Scalar(kb); err != nil {
				return err
			}
			items[i] = kv{keyBytes: kb, val: val.Values[i]}
		}
		// Sort by raw UTF-8 bytes — unsigned-octet lexicographic (§3.5).
		// TODO: benchmark bytes.Compare vs manual loop for typical key sizes.
		sort.Slice(items, func(i, j int) bool {
			return bytes.Compare(items[i].keyBytes, items[j].keyBytes) < 0
		})
		// Validate uniqueness and ordering.
		sortedKeys := make([][]byte, len(items))
		for i, kv := range items {
			sortedKeys[i] = kv.keyBytes
		}
		if err := ensureSortedUniqueKeys(sortedKeys); err != nil {
			return err
		}
		buf.WriteByte(tagMap)
		writeU32BE(buf, uint32(len(items)))
		for _, kv := range items {
			// Keys are always STRING-tagged (§3.2).
			buf.WriteByte(tagString)
			writeU32BE(buf, uint32(len(kv.keyBytes)))
			buf.Write(kv.keyBytes)
			if err := mcfEncodeTo(buf, kv.val, depth+1); err != nil {
				return err
			}
		}

	default:
		return newErr(ErrSchema, "unsupported value type")
	}
	return nil
}

func writeU32BE(buf *bytes.Buffer, n uint32) {
	var b [4]byte
	binary.BigEndian.PutUint32(b[:], n)
	buf.Write(b[:])
}

// validateUTF8Scalar rejects invalid UTF-8 and surrogate code points (§3.4).
// Go strings are UTF-8 by convention but not enforced, so we must check.
func validateUTF8Scalar(b []byte) error {
	if !utf8.Valid(b) {
		return newErr(ErrUTF8, "invalid UTF-8")
	}
	// Surrogates U+D800–U+DFFF are forbidden.  utf8.Valid doesn't reject
	// them because Go's internal representation can't actually contain
	// surrogates encoded as valid UTF-8 — but we check defensively.
	for i := 0; i < len(b); {
		r, sz := utf8.DecodeRune(b[i:])
		if r == utf8.RuneError && sz <= 1 {
			return newErr(ErrUTF8, "invalid UTF-8 rune")
		}
		if r >= 0xD800 && r <= 0xDFFF {
			return newErr(ErrUTF8, "surrogate code point")
		}
		i += sz
	}
	return nil
}

func ensureSortedUniqueKeys(keys [][]byte) error {
	for i := 1; i < len(keys); i++ {
		c := bytes.Compare(keys[i-1], keys[i])
		if c == 0 {
			return newErr(ErrDupKey, "duplicate key")
		}
		if c > 0 {
			return newErr(ErrKeyOrder, "key order violation")
		}
	}
	return nil
}
