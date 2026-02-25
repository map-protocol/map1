package map1

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
)

// CanonBytesFromValue encodes a canonical-model value to CANON_BYTES.
// CANON_BYTES = CANON_HDR || MCF(root_value)  (§5.2)
func CanonBytesFromValue(v Value) ([]byte, error) {
	body, err := mcfEncode(v, 0)
	if err != nil {
		return nil, err
	}
	canon := make([]byte, 0, len(canonHdr)+len(body))
	canon = append(canon, canonHdr...)
	canon = append(canon, body...)
	if len(canon) > MaxCanonBytes {
		return nil, newErr(ErrLimitSize, "canon bytes exceed MAX_CANON_BYTES")
	}
	return canon, nil
}

// MIDFromValue computes a MID from a canonical-model value.
// MID = "map1:" + hex_lower(sha256(CANON_BYTES))  (§5.3)
func MIDFromValue(v Value) (string, error) {
	canon, err := CanonBytesFromValue(v)
	if err != nil {
		return "", err
	}
	return "map1:" + sha256hex(canon), nil
}

// MIDFromCanonBytes validates pre-built CANON_BYTES and returns MID.
// This is the "fast-path" entry point (§3.7): fully validates the binary
// structure but hashes the input bytes directly rather than re-encoding.
func MIDFromCanonBytes(canon []byte) (string, error) {
	if len(canon) > MaxCanonBytes {
		return "", newErr(ErrLimitSize, "canon bytes exceed MAX_CANON_BYTES")
	}
	if !bytes.HasPrefix(canon, canonHdr) {
		return "", newErr(ErrCanonHdr, "bad CANON_HDR")
	}
	off := len(canonHdr)
	_, end, err := mcfDecodeOne(canon, off, 0)
	if err != nil {
		return "", err
	}
	// Exactly one root MCF value, no trailing bytes (§3.7.f).
	if end != len(canon) {
		return "", newErr(ErrCanonMCF, "trailing bytes after MCF root")
	}
	return "map1:" + sha256hex(canon), nil
}

// ── FULL projection API (§7) ────────────────────────────────

// CanonBytesFull returns CANON_BYTES for FULL projection.
func CanonBytesFull(descriptor Value) ([]byte, error) {
	return CanonBytesFromValue(descriptor)
}

// CanonBytesBind returns CANON_BYTES for BIND projection.
func CanonBytesBind(descriptor Value, pointers []string) ([]byte, error) {
	proj, err := BindProject(descriptor, pointers)
	if err != nil {
		return nil, err
	}
	return CanonBytesFromValue(proj)
}

// MIDFull computes MID over the full descriptor (§7.2).
func MIDFull(descriptor Value) (string, error) {
	return MIDFromValue(descriptor)
}

// MIDBind computes MID over selected fields (§7.2).
func MIDBind(descriptor Value, pointers []string) (string, error) {
	proj, err := BindProject(descriptor, pointers)
	if err != nil {
		return "", err
	}
	return MIDFromValue(proj)
}

func sha256hex(data []byte) string {
	h := sha256.Sum256(data)
	return hex.EncodeToString(h[:])
}
