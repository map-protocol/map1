//! Unit tests for the MAP v1.1 Rust public API.
//!
//! These are basic correctness tests that complement the conformance suite.
//! They exercise the MapValue-based API (not JSON-STRICT) and cover
//! edge cases specific to the Rust implementation.

use map1::*;

// ── mid_full basic ──────────────────────────────────────────

#[test]
fn mid_full_empty_map() {
    let val = MapValue::Map(vec![]);
    let mid = mid_full(&val).unwrap();
    assert!(mid.starts_with("map1:"));
    assert_eq!(mid.len(), 5 + 64); // "map1:" + 64 hex chars
}

#[test]
fn mid_full_simple_string_map() {
    let val = MapValue::Map(vec![
        ("a".into(), MapValue::String("1".into())),
        ("b".into(), MapValue::String("2".into())),
    ]);
    let mid = mid_full(&val).unwrap();
    assert!(mid.starts_with("map1:"));
}

#[test]
fn mid_full_deterministic() {
    let val = MapValue::Map(vec![
        ("x".into(), MapValue::String("hello".into())),
    ]);
    let mid1 = mid_full(&val).unwrap();
    let mid2 = mid_full(&val).unwrap();
    assert_eq!(mid1, mid2, "MID must be deterministic");
}

// ── Type distinction (v1.1) ─────────────────────────────────

#[test]
fn bool_true_differs_from_string_true() {
    let bool_val = MapValue::Map(vec![
        ("v".into(), MapValue::Boolean(true)),
    ]);
    let str_val = MapValue::Map(vec![
        ("v".into(), MapValue::String("true".into())),
    ]);
    assert_ne!(
        mid_full(&bool_val).unwrap(),
        mid_full(&str_val).unwrap(),
        "BOOLEAN true must differ from STRING \"true\""
    );
}

#[test]
fn int_42_differs_from_string_42() {
    let int_val = MapValue::Map(vec![
        ("v".into(), MapValue::Integer(42)),
    ]);
    let str_val = MapValue::Map(vec![
        ("v".into(), MapValue::String("42".into())),
    ]);
    assert_ne!(
        mid_full(&int_val).unwrap(),
        mid_full(&str_val).unwrap(),
        "INTEGER 42 must differ from STRING \"42\""
    );
}

// ── Key ordering ────────────────────────────────────────────

#[test]
fn key_order_violation_detected() {
    // Keys not sorted: "b" before "a"
    let val = MapValue::Map(vec![
        ("b".into(), MapValue::String("2".into())),
        ("a".into(), MapValue::String("1".into())),
    ]);
    let err = mid_full(&val).unwrap_err();
    assert_eq!(err.code, ERR_KEY_ORDER);
}

#[test]
fn duplicate_key_detected() {
    let val = MapValue::Map(vec![
        ("a".into(), MapValue::String("1".into())),
        ("a".into(), MapValue::String("2".into())),
    ]);
    let err = mid_full(&val).unwrap_err();
    assert_eq!(err.code, ERR_DUP_KEY);
}

// ── BIND projection ─────────────────────────────────────────

#[test]
fn bind_selects_single_key() {
    let val = MapValue::Map(vec![
        ("a".into(), MapValue::String("1".into())),
        ("b".into(), MapValue::String("2".into())),
    ]);
    let mid_bind_result = mid_bind(&val, &["/a"]).unwrap();
    // Should match a map with only {"a": "1"}
    let expected = MapValue::Map(vec![
        ("a".into(), MapValue::String("1".into())),
    ]);
    assert_eq!(mid_bind_result, mid_full(&expected).unwrap());
}

#[test]
fn bind_nonmap_root_rejected() {
    let val = MapValue::List(vec![MapValue::String("x".into())]);
    let err = mid_bind(&val, &["/0"]).unwrap_err();
    assert_eq!(err.code, ERR_SCHEMA);
}

#[test]
fn bind_list_traversal_rejected() {
    let val = MapValue::Map(vec![
        ("a".into(), MapValue::List(vec![MapValue::Boolean(true)])),
    ]);
    let err = mid_bind(&val, &["/a/0"]).unwrap_err();
    assert_eq!(err.code, ERR_SCHEMA);
}

#[test]
fn bind_no_match_returns_empty_map() {
    let val = MapValue::Map(vec![
        ("a".into(), MapValue::String("1".into())),
    ]);
    let mid_result = mid_bind(&val, &["/nonexistent"]).unwrap();
    let empty = MapValue::Map(vec![]);
    assert_eq!(mid_result, mid_full(&empty).unwrap());
}

// ── canon_bytes roundtrip ───────────────────────────────────

#[test]
fn canon_bytes_roundtrip() {
    let val = MapValue::Map(vec![
        ("key".into(), MapValue::String("value".into())),
    ]);
    let canon = canonical_bytes_full(&val).unwrap();
    let mid1 = mid_full(&val).unwrap();
    let mid2 = mid_from_canon_bytes(&canon).unwrap();
    assert_eq!(mid1, mid2, "MID from value and from canon_bytes must match");
}

// ── JSON-STRICT API ─────────────────────────────────────────

#[test]
fn json_full_simple() {
    let json = br#"{"action":"deploy"}"#;
    let mid = mid_full_json(json).unwrap();
    assert!(mid.starts_with("map1:"));
}

#[test]
fn json_null_rejected() {
    let json = br#"{"v":null}"#;
    let err = mid_full_json(json).unwrap_err();
    assert_eq!(err.code, ERR_TYPE);
}

#[test]
fn json_float_rejected() {
    let json = br#"{"v":3.14}"#;
    let err = mid_full_json(json).unwrap_err();
    assert_eq!(err.code, ERR_TYPE);
}

#[test]
fn json_integer_accepted() {
    let json = br#"{"v":42}"#;
    let mid = mid_full_json(json).unwrap();
    assert!(mid.starts_with("map1:"));
}

#[test]
fn json_bom_rejected() {
    let mut input = vec![0xEF, 0xBB, 0xBF]; // UTF-8 BOM
    input.extend_from_slice(br#"{"a":"b"}"#);
    let err = mid_full_json(&input).unwrap_err();
    assert_eq!(err.code, ERR_SCHEMA);
}

#[test]
fn spec_version_correct() {
    assert_eq!(SPEC_VERSION, "1.1");
}
