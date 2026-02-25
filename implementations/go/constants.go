package map1

// Spec references: §3.2 (type tags), §4 (limits), §5.1 (CANON_HDR).

const SpecVersion = "1.1"

// CANON_HDR is the 5-byte canonical header: ASCII "MAP1" + NUL.
// The "1" is the major version of the canonical framing, not the spec
// version.  See Appendix A6.
var canonHdr = []byte{0x4D, 0x41, 0x50, 0x31, 0x00}

// MCF type tags (single byte each).
// Tags 0x01–0x04 unchanged from v1.0.
// Tags 0x05–0x06 added in v1.1.
const (
	tagString  byte = 0x01
	tagBytes   byte = 0x02
	tagList    byte = 0x03
	tagMap     byte = 0x04
	tagBoolean byte = 0x05 // v1.1: payload 0x01 (true) or 0x00 (false)
	tagInteger byte = 0x06 // v1.1: payload int64 big-endian, always 8 bytes
)

// Normative safety limits (§4).
const (
	MaxCanonBytes  = 1_048_576 // 1 MiB total CANON_BYTES length
	MaxDepth       = 32        // max nesting of MAP/LIST containers
	MaxMapEntries  = 65_535
	MaxListEntries = 65_535
)
