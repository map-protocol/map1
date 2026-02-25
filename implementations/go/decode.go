package map1

import (
	"bytes"
	"encoding/binary"
)

// mcfDecodeOne decodes one MCF value from buf at offset (§3.7 fast-path).
// Returns the decoded Value and the new offset, or an error.
// Depth semantics mirror the encoder.
func mcfDecodeOne(buf []byte, off int, depth int) (Value, int, error) {
	if off >= len(buf) {
		return nil, off, newErr(ErrCanonMCF, "truncated tag")
	}
	tag := buf[off]
	off++

	switch tag {

	case tagString:
		n, newOff, err := readU32BE(buf, off)
		if err != nil {
			return nil, off, err
		}
		off = newOff
		if off+int(n) > len(buf) {
			return nil, off, newErr(ErrCanonMCF, "truncated string payload")
		}
		raw := buf[off : off+int(n)]
		off += int(n)
		if err := validateUTF8Scalar(raw); err != nil {
			return nil, off, err
		}
		return String(raw), off, nil

	case tagBytes:
		n, newOff, err := readU32BE(buf, off)
		if err != nil {
			return nil, off, err
		}
		off = newOff
		if off+int(n) > len(buf) {
			return nil, off, newErr(ErrCanonMCF, "truncated bytes payload")
		}
		raw := make([]byte, n)
		copy(raw, buf[off:off+int(n)])
		off += int(n)
		return Bytes(raw), off, nil

	case tagList:
		if depth+1 > MaxDepth {
			return nil, off, newErr(ErrLimitDepth, "depth exceeds MAX_DEPTH")
		}
		count, newOff, err := readU32BE(buf, off)
		if err != nil {
			return nil, off, err
		}
		off = newOff
		if count > MaxListEntries {
			return nil, off, newErr(ErrLimitSize, "list entry count exceeds limit")
		}
		arr := make(List, 0, count)
		for i := uint32(0); i < count; i++ {
			item, newOff, err := mcfDecodeOne(buf, off, depth+1)
			if err != nil {
				return nil, off, err
			}
			off = newOff
			arr = append(arr, item)
		}
		return arr, off, nil

	case tagMap:
		if depth+1 > MaxDepth {
			return nil, off, newErr(ErrLimitDepth, "depth exceeds MAX_DEPTH")
		}
		count, newOff, err := readU32BE(buf, off)
		if err != nil {
			return nil, off, err
		}
		off = newOff
		if count > MaxMapEntries {
			return nil, off, newErr(ErrLimitSize, "map entry count exceeds limit")
		}

		keys := make([]string, 0, count)
		vals := make([]Value, 0, count)
		var prevKey []byte

		for i := uint32(0); i < count; i++ {
			// Keys must be STRING-tagged (§3.2).
			if off >= len(buf) {
				return nil, off, newErr(ErrCanonMCF, "truncated map key tag")
			}
			if buf[off] != tagString {
				return nil, off, newErr(ErrSchema, "map key must be STRING")
			}
			kv, newOff, err := mcfDecodeOne(buf, off, depth+1)
			if err != nil {
				return nil, off, err
			}
			off = newOff
			k, ok := kv.(String)
			if !ok {
				return nil, off, newErr(ErrSchema, "map key decoded to non-string")
			}
			kb := []byte(string(k))

			// Enforce ordering and uniqueness on the wire.
			if prevKey != nil {
				cmp := bytes.Compare(prevKey, kb)
				if cmp == 0 {
					return nil, off, newErr(ErrDupKey, "duplicate key in MCF")
				}
				if cmp > 0 {
					return nil, off, newErr(ErrKeyOrder, "key order violation in MCF")
				}
			}
			prevKey = kb

			v, newOff2, err := mcfDecodeOne(buf, off, depth+1)
			if err != nil {
				return nil, off, err
			}
			off = newOff2

			keys = append(keys, string(k))
			vals = append(vals, v)
		}

		return &Map{Keys: keys, Values: vals}, off, nil

	case tagBoolean:
		// BOOLEAN: exactly 1 payload byte, must be 0x00 or 0x01 (§3.2).
		if off >= len(buf) {
			return nil, off, newErr(ErrCanonMCF, "truncated boolean payload")
		}
		payload := buf[off]
		if payload != 0x00 && payload != 0x01 {
			return nil, off + 1, newErr(ErrCanonMCF, "invalid boolean payload")
		}
		return Bool(payload == 0x01), off + 1, nil

	case tagInteger:
		// INTEGER: exactly 8 payload bytes, signed big-endian (§3.2).
		if off+8 > len(buf) {
			return nil, off, newErr(ErrCanonMCF, "truncated integer payload")
		}
		val := int64(binary.BigEndian.Uint64(buf[off : off+8]))
		return Integer(val), off + 8, nil

	default:
		return nil, off, newErr(ErrCanonMCF, "unknown MCF tag")
	}
}

func readU32BE(buf []byte, off int) (uint32, int, error) {
	if off+4 > len(buf) {
		return 0, off, newErr(ErrCanonMCF, "truncated u32")
	}
	n := binary.BigEndian.Uint32(buf[off : off+4])
	return n, off + 4, nil
}
