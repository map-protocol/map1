// Package map1 implements the MAP v1.1 specification — deterministic
// identity for structured descriptors.
//
// MAP v1 defines a six-type canonical model (STRING, BYTES, LIST, MAP,
// BOOLEAN, INTEGER), a deterministic binary encoding (MCF), and a
// content-addressed identifier (MID) computed as sha256 over canonical
// bytes prefixed by "MAP1\0".
//
// This package provides the required API surface (§7): canonical_bytes
// and MID computation for FULL and BIND projections, plus fast-path
// validation of pre-serialized CANON_BYTES.  A JSON-STRICT adapter (§8)
// converts raw UTF-8 JSON into the canonical model.
//
// Zero external dependencies beyond the standard library.
package map1

// Value is a canonical model value.  Concrete types:
//
//   - String  (STRING, §3.1)
//   - Bytes   (BYTES, §3.1)
//   - List    (LIST, §3.1)
//   - Map     (MAP, §3.1)
//   - Bool    (BOOLEAN, §3.1 — v1.1)
//   - Integer (INTEGER, §3.1 — v1.1)
type Value interface {
	mapValue() // sealed marker — only types in this package implement Value
}

// String is a MAP v1 STRING value.  Must be valid UTF-8 scalar values.
type String string

// Bytes is a MAP v1 BYTES value.  Arbitrary byte sequence.
type Bytes []byte

// List is a MAP v1 LIST value.  Ordered sequence of Values.
type List []Value

// Map is a MAP v1 MAP value.  Ordered key/value pairs with unique string keys.
// Keys are stored as raw strings; ordering/uniqueness enforced at encode time.
type Map struct {
	Keys   []string
	Values []Value
}

// Bool is a MAP v1 BOOLEAN value (v1.1).
type Bool bool

// Integer is a MAP v1 INTEGER value (v1.1).  Signed 64-bit.
type Integer int64

func (String) mapValue()  {}
func (Bytes) mapValue()   {}
func (List) mapValue()    {}
func (*Map) mapValue()    {}
func (Bool) mapValue()    {}
func (Integer) mapValue() {}

// MapEntry is a convenience type for building Map values.
type MapEntry struct {
	Key   string
	Value Value
}

// NewMap creates a Map from entries.  Does NOT sort or validate —
// that happens at encode time.
func NewMap(entries ...MapEntry) *Map {
	m := &Map{
		Keys:   make([]string, len(entries)),
		Values: make([]Value, len(entries)),
	}
	for i, e := range entries {
		m.Keys[i] = e.Key
		m.Values[i] = e.Value
	}
	return m
}

// EmptyMap returns a Map with zero entries.
func EmptyMap() *Map {
	return &Map{}
}
