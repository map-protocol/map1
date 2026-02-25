//! MAP v1.1 JSON-STRICT adapter — converts raw UTF-8 JSON bytes into the
//! canonical model.
//!
//! Type mapping (§8.2):
//!   JSON object  → MAP
//!   JSON array   → LIST
//!   JSON string  → STRING
//!   JSON boolean → BOOLEAN    (v1.1 — was STRING in v1.0)
//!   JSON integer → INTEGER    (v1.1 — was ERR_TYPE in v1.0)
//!   JSON float   → ERR_TYPE   (decimal point or exponent = rejected)
//!   JSON null    → ERR_TYPE
//!
//! The trickiest part of this module is float vs integer detection.  With
//! serde_json's `arbitrary_precision` feature, numbers arrive through the
//! deserializer as a special map with key "$serde_json::private::Number"
//! containing the raw JSON token string.  This lets us inspect for '.'
//! and 'e'/'E' directly per §8.2.1.
//!
//! Duplicate key detection requires a custom deserialization strategy since
//! serde_json's default Value type deduplicates keys silently.  Our custom
//! Deserialize impl preserves all key-value pairs via visit_map.

use serde::de::{self, Deserialize, Deserializer, MapAccess, SeqAccess, Visitor};
use std::fmt;

use crate::constants::*;
use crate::errors::*;
use crate::value::MapValue;

// The magic key serde_json uses internally to pass raw number tokens
// through serde's deserialization when arbitrary_precision is enabled.
// This is a serde_json implementation detail, but it's stable and
// well-documented in their codebase.
const SERDE_JSON_NUMBER_KEY: &str = "$serde_json::private::Number";

// ── Custom JSON value that preserves duplicate keys ────────────
// serde_json::Value uses a BTreeMap/Map which deduplicates keys.  We need
// to preserve all pairs to detect duplicates after escape resolution,
// which serde has already done for us.

#[derive(Debug)]
enum ParsedJson {
    Null,
    Bool(bool),
    /// Raw number token string (preserved by arbitrary_precision feature).
    /// Contains the exact JSON source token, e.g. "42", "3.14", "1e5".
    Number(String),
    String(String),
    Array(Vec<ParsedJson>),
    /// Preserves all key-value pairs including duplicates.
    Object(Vec<(String, ParsedJson)>),
}

struct ParsedJsonVisitor;

impl<'de> Visitor<'de> for ParsedJsonVisitor {
    type Value = ParsedJson;

    fn expecting(&self, formatter: &mut fmt::Formatter) -> fmt::Result {
        formatter.write_str("any JSON value")
    }

    fn visit_bool<E: de::Error>(self, v: bool) -> Result<ParsedJson, E> {
        Ok(ParsedJson::Bool(v))
    }

    // Fallback numeric visitors — with arbitrary_precision these normally
    // won't fire (numbers route through visit_map with the magic key),
    // but we handle them defensively.
    fn visit_i64<E: de::Error>(self, v: i64) -> Result<ParsedJson, E> {
        Ok(ParsedJson::Number(v.to_string()))
    }

    fn visit_u64<E: de::Error>(self, v: u64) -> Result<ParsedJson, E> {
        Ok(ParsedJson::Number(v.to_string()))
    }

    fn visit_f64<E: de::Error>(self, v: f64) -> Result<ParsedJson, E> {
        Ok(ParsedJson::Number(v.to_string()))
    }

    fn visit_str<E: de::Error>(self, v: &str) -> Result<ParsedJson, E> {
        Ok(ParsedJson::String(v.to_string()))
    }

    fn visit_string<E: de::Error>(self, v: String) -> Result<ParsedJson, E> {
        Ok(ParsedJson::String(v))
    }

    fn visit_unit<E: de::Error>(self) -> Result<ParsedJson, E> {
        Ok(ParsedJson::Null)
    }

    fn visit_seq<A: SeqAccess<'de>>(self, mut seq: A) -> Result<ParsedJson, A::Error> {
        let mut items = Vec::new();
        while let Some(item) = seq.next_element::<ParsedJson>()? {
            items.push(item);
        }
        Ok(ParsedJson::Array(items))
    }

    fn visit_map<A: MapAccess<'de>>(self, mut map: A) -> Result<ParsedJson, A::Error> {
        // With serde_json's arbitrary_precision feature, numbers are routed
        // through visit_map as: {"$serde_json::private::Number": "raw_token"}.
        // We detect this by checking the first key.
        let first_key: Option<String> = map.next_key()?;

        match first_key {
            Some(ref key) if key == SERDE_JSON_NUMBER_KEY => {
                // This is a raw number token from serde_json's arbitrary_precision
                let raw: String = map.next_value()?;
                Ok(ParsedJson::Number(raw))
            }
            Some(first_key) => {
                // Regular JSON object — collect all pairs including duplicates
                let mut pairs = Vec::new();
                let first_value: ParsedJson = map.next_value()?;
                pairs.push((first_key, first_value));

                while let Some(key) = map.next_key::<String>()? {
                    let value: ParsedJson = map.next_value()?;
                    pairs.push((key, value));
                }
                Ok(ParsedJson::Object(pairs))
            }
            None => {
                // Empty object {}
                Ok(ParsedJson::Object(Vec::new()))
            }
        }
    }
}

impl<'de> Deserialize<'de> for ParsedJson {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        deserializer.deserialize_any(ParsedJsonVisitor)
    }
}

// ── Surrogate detection ──────────────────────────────────────
// Rust's str type guarantees valid UTF-8 (which excludes encoded surrogates),
// so in practice this check is defense-in-depth.  serde_json correctly
// rejects lone surrogates during parsing as well.

fn ensure_no_surrogates(s: &str) -> Result<(), MapError> {
    for ch in s.chars() {
        let cp = ch as u32;
        if (0xD800..=0xDFFF).contains(&cp) {
            return Err(MapError::new(
                ERR_UTF8,
                format!("surrogate U+{:04X} in JSON string", cp),
            ));
        }
    }
    Ok(())
}

/// Pre-scan raw JSON bytes for \uD800–\uDFFF escape sequences.
///
/// serde_json catches these too, but reports them as generic parse errors
/// whose message text varies across library versions.  Scanning ourselves
/// guarantees the spec-required ERR_UTF8 code regardless of serde version.
/// A high surrogate followed by a low surrogate is still rejected — JSON
/// text is UTF-8, and surrogates are only meaningful in UTF-16.
fn scan_for_surrogate_escapes(raw: &[u8]) -> Result<(), MapError> {
    let mut in_string = false;
    let mut i = 0;
    while i < raw.len() {
        let b = raw[i];
        if !in_string {
            if b == b'"' {
                in_string = true;
            }
            i += 1;
            continue;
        }
        // Inside a string.
        if b == b'\\' {
            i += 1;
            if i >= raw.len() {
                break;
            }
            if raw[i] == b'u' && i + 4 < raw.len() {
                if let Ok(hex) = std::str::from_utf8(&raw[i + 1..i + 5]) {
                    if let Ok(cp) = u16::from_str_radix(hex, 16) {
                        if cp >= 0xD800 && cp <= 0xDFFF {
                            return Err(MapError::new(
                                ERR_UTF8,
                                format!("surrogate escape \\u{}", hex),
                            ));
                        }
                    }
                }
                i += 5;
                continue;
            }
            i += 1;
            continue;
        }
        if b == b'"' {
            in_string = false;
        }
        i += 1;
    }
    Ok(())
}

// ── JSON parse with BOM and duplicate detection ────────────────

/// Parse raw JSON bytes under JSON-STRICT rules.
///
/// Returns `(parsed_value, dup_found)`.  Duplicate detection does NOT
/// short-circuit — we record the flag and keep parsing so that
/// higher-precedence errors (ERR_TYPE from null, ERR_UTF8 from bad
/// encoding) can still surface.  The caller raises ERR_DUP_KEY only
/// if no higher-precedence error occurred.
fn json_strict_parse_with_dups(raw: &[u8]) -> Result<(ParsedJson, bool), MapError> {
    if raw.len() > MAX_CANON_BYTES {
        return Err(MapError::new(
            ERR_LIMIT_SIZE,
            "input exceeds MAX_CANON_BYTES",
        ));
    }

    // BOM rejection (§8.1.1): check after skipping JSON whitespace.
    // JSON whitespace per RFC 8259: space (0x20), tab (0x09), LF (0x0A), CR (0x0D).
    let start = raw
        .iter()
        .position(|&b| b != 0x20 && b != 0x09 && b != 0x0A && b != 0x0D)
        .unwrap_or(raw.len());
    if start < raw.len() && raw[start..].starts_with(&[0xEF, 0xBB, 0xBF]) {
        return Err(MapError::new(ERR_SCHEMA, "UTF-8 BOM rejected"));
    }

    // Validate UTF-8
    let text = std::str::from_utf8(raw)
        .map_err(|_| MapError::new(ERR_UTF8, "invalid UTF-8 in JSON input"))?;

    // Pre-scan for surrogate escape sequences (§8.1).
    // serde_json rejects \uD800–\uDFFF but reports them as generic parse
    // errors whose message text varies across versions.  We scan the raw
    // bytes ourselves so the error is always ERR_UTF8 per spec precedence.
    // Same approach as the Go implementation's scanForSurrogateEscapes.
    scan_for_surrogate_escapes(raw)?;

    // Parse with our custom type that preserves duplicate keys.
    // serde_json with arbitrary_precision preserves raw number tokens.
    let parsed: ParsedJson = serde_json::from_str(text).map_err(|_| {
        MapError::new(ERR_CANON_MCF, "JSON parse error")
    })?;

    // Detect duplicates by scanning all Object nodes.
    // Duplicate detection occurs after escape resolution (§8.3) which
    // serde_json has already done for us.
    let mut dup_found = false;
    check_duplicates(&parsed, &mut dup_found)?;

    Ok((parsed, dup_found))
}

/// Recursively check for duplicate keys in all objects and validate
/// string surrogate freedom.
fn check_duplicates(val: &ParsedJson, dup_found: &mut bool) -> Result<(), MapError> {
    match val {
        ParsedJson::Object(pairs) => {
            let mut seen = std::collections::HashSet::new();
            for (key, value) in pairs {
                ensure_no_surrogates(key)?;
                if !seen.insert(key.as_str()) {
                    *dup_found = true;
                }
                check_duplicates(value, dup_found)?;
            }
        }
        ParsedJson::Array(items) => {
            for item in items {
                check_duplicates(item, dup_found)?;
            }
        }
        ParsedJson::String(s) => {
            ensure_no_surrogates(s)?;
        }
        _ => {}
    }
    Ok(())
}

// ── JSON value → canonical model ─────────────────────────────

/// Convert a parsed JSON value to a MapValue.
///
/// After this function, the value tree contains only the six canonical types.
/// Depth tracking starts at 1 for the root (which is a container).
fn json_to_canon_value(x: &ParsedJson, depth: u32) -> Result<MapValue, MapError> {
    if depth > MAX_DEPTH {
        return Err(MapError::new(ERR_LIMIT_DEPTH, "exceeds MAX_DEPTH"));
    }

    match x {
        ParsedJson::Object(pairs) => {
            // Collect unique keys (first occurrence wins, matching Python reference).
            let mut seen = std::collections::HashSet::new();
            let mut entries: Vec<(String, MapValue)> = Vec::new();

            for (key, val) in pairs {
                ensure_no_surrogates(key)?;
                if !seen.insert(key.clone()) {
                    continue; // skip duplicates (keep first)
                }
                let child_depth = match val {
                    ParsedJson::Object(_) | ParsedJson::Array(_) => depth + 1,
                    _ => depth,
                };
                let child = json_to_canon_value(val, child_depth)?;
                entries.push((key.clone(), child));
            }

            // Sort by raw UTF-8 byte order (§3.5).
            // Rust's &[u8] Ord is unsigned-byte lexicographic, which is correct.
            entries.sort_by(|(a, _), (b, _)| a.as_bytes().cmp(b.as_bytes()));

            Ok(MapValue::Map(entries))
        }

        ParsedJson::Array(items) => {
            let mut result = Vec::with_capacity(items.len());
            for item in items {
                let child_depth = match item {
                    ParsedJson::Object(_) | ParsedJson::Array(_) => depth + 1,
                    _ => depth,
                };
                result.push(json_to_canon_value(item, child_depth)?);
            }
            Ok(MapValue::List(result))
        }

        ParsedJson::String(s) => {
            ensure_no_surrogates(s)?;
            Ok(MapValue::String(s.clone()))
        }

        ParsedJson::Bool(b) => Ok(MapValue::Boolean(*b)),

        ParsedJson::Null => Err(MapError::new(ERR_TYPE, "JSON null not allowed")),

        ParsedJson::Number(token) => {
            // §8.2.1: Token-level check on the raw JSON number string.
            // Reject if contains '.' or 'e'/'E' — this is intentional.
            // Prevents silent coercion of e.g. "1.0" to integer 1.
            if token.contains('.') || token.contains('e') || token.contains('E') {
                return Err(MapError::new(
                    ERR_TYPE,
                    format!("JSON float not allowed: {}", token),
                ));
            }

            // Parse as integer and range-check against i64 bounds.
            // Use i128 to detect overflow without panicking.
            let val: i128 = token.parse().map_err(|_| {
                MapError::new(ERR_TYPE, format!("invalid integer: {}", token))
            })?;

            if val < i64::MIN as i128 || val > i64::MAX as i128 {
                return Err(MapError::new(
                    ERR_TYPE,
                    format!("integer overflow: {}", token),
                ));
            }

            Ok(MapValue::Integer(val as i64))
        }
    }
}

// ── Public JSON-STRICT API ───────────────────────────────────

/// Parse raw UTF-8 JSON bytes under JSON-STRICT rules and convert to MapValue.
///
/// Returns `(canonical_value, dup_found)`.  The caller decides whether to
/// raise ERR_DUP_KEY based on error precedence — if we made it this far
/// without a higher-precedence error, and dup_found is true, the caller
/// should reject with ERR_DUP_KEY.
pub fn parse_json_strict(raw: &[u8]) -> Result<(MapValue, bool), MapError> {
    let (parsed, dup_found) = json_strict_parse_with_dups(raw)?;
    let val = json_to_canon_value(&parsed, 1)?;
    Ok((val, dup_found))
}
