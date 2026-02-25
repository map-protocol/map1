//! MAP v1.1 canonical model value type.
//!
//! The six canonical types (§3.1) are represented as a Rust enum.
//! MapValue owns its data — strings are `String`, byte arrays are `Vec<u8>`,
//! and containers hold owned children.  The encoder borrows via `&MapValue`.
//!
//! MAP entries are stored as `Vec<(String, MapValue)>` rather than a HashMap
//! to preserve insertion order and enable pre-sorted construction.  The
//! encoder validates sort order and uniqueness at encode time.

use std::fmt;

/// A value in the MAP v1.1 canonical model.
///
/// Six types per §3.1: STRING, BYTES, LIST, MAP, BOOLEAN, INTEGER.
/// MAP keys are always strings and must be sorted by raw UTF-8 byte order
/// (unsigned-octet lexicographic comparison, §3.5).
#[derive(Debug, Clone, PartialEq)]
pub enum MapValue {
    /// UTF-8 text.  Must contain only Unicode scalar values (no surrogates).
    String(String),
    /// Arbitrary byte sequence.
    Bytes(Vec<u8>),
    /// Ordered sequence of values.
    List(Vec<MapValue>),
    /// Ordered key/value pairs.  Keys must be pre-sorted by raw UTF-8 byte
    /// order and must be unique.  The encoder validates this at encode time.
    Map(Vec<(String, MapValue)>),
    /// Boolean value (v1.1).  Distinct from STRING "true"/"false".
    Boolean(bool),
    /// Signed 64-bit integer (v1.1).  Distinct from STRING representation.
    Integer(i64),
}

impl fmt::Display for MapValue {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            MapValue::String(s) => write!(f, "\"{}\"", s),
            MapValue::Bytes(b) => write!(f, "<{} bytes>", b.len()),
            MapValue::List(items) => write!(f, "[{} items]", items.len()),
            MapValue::Map(entries) => write!(f, "{{{} entries}}", entries.len()),
            MapValue::Boolean(b) => write!(f, "{}", b),
            MapValue::Integer(i) => write!(f, "{}", i),
        }
    }
}
