//! MAP v1.1 conformance test suite.
//!
//! Runs all 95 vectors from conformance_vectors_v11.json against
//! conformance_expected_v11.json.  Each vector is a separate test
//! function for granular reporting.

use base64::Engine;
use serde::Deserialize;
use std::collections::HashMap;

use map1::{mid_bind_json, mid_from_canon_bytes, mid_full_json, MapError};

// ── Load conformance data ────────────────────────────────────

#[derive(Deserialize, Debug)]
struct VectorsFile {
    vectors: Vec<Vector>,
}

#[derive(Deserialize, Debug, Clone)]
struct Vector {
    test_id: String,
    input_b64: String,
    mode: String,
    #[serde(default)]
    pointers: Vec<String>,
}

#[derive(Deserialize, Debug)]
struct ExpectedFile {
    expected: HashMap<String, Expected>,
}

#[derive(Deserialize, Debug, Clone)]
struct Expected {
    #[serde(default)]
    mid: Option<String>,
    #[serde(default)]
    err: Option<String>,
}

#[derive(Debug, PartialEq)]
enum TestResult {
    Mid(String),
    Err(String),
}

fn run_vector(vec: &Vector) -> TestResult {
    let raw = base64::engine::general_purpose::STANDARD
        .decode(&vec.input_b64)
        .expect("base64 decode failed");
    let ptrs: Vec<&str> = vec.pointers.iter().map(|s| s.as_str()).collect();

    let result: Result<String, MapError> = match vec.mode.as_str() {
        "json_strict_full" => mid_full_json(&raw),
        "json_strict_bind" => mid_bind_json(&raw, &ptrs),
        "canon_bytes" => mid_from_canon_bytes(&raw),
        other => panic!("unknown mode: {}", other),
    };

    match result {
        Ok(mid) => TestResult::Mid(mid),
        Err(e) => TestResult::Err(e.code.to_string()),
    }
}

fn expected_to_result(exp: &Expected) -> TestResult {
    if let Some(ref mid) = exp.mid {
        TestResult::Mid(mid.clone())
    } else if let Some(ref err) = exp.err {
        TestResult::Err(err.clone())
    } else {
        panic!("expected must have either mid or err");
    }
}

// ── Load test data once ───────────────────────────────────────

fn load_vectors() -> (Vec<Vector>, HashMap<String, Expected>) {
    let vec_json = include_str!("../../../conformance/conformance_vectors_v11.json");
    let exp_json = include_str!("../../../conformance/conformance_expected_v11.json");

    let vectors: VectorsFile =
        serde_json::from_str(vec_json).expect("failed to parse vectors");
    let expected: ExpectedFile =
        serde_json::from_str(exp_json).expect("failed to parse expected");

    (vectors.vectors, expected.expected)
}

// ── Test runner ──────────────────────────────────────────────

#[test]
fn conformance_all_vectors() {
    let (vectors, expected) = load_vectors();

    let mut passed = 0;
    let mut failed = 0;
    let mut failures: Vec<(String, TestResult, TestResult)> = Vec::new();

    for vec in &vectors {
        let exp = expected
            .get(&vec.test_id)
            .unwrap_or_else(|| panic!("no expected for {}", vec.test_id));
        let got = run_vector(vec);
        let want = expected_to_result(exp);

        if got == want {
            passed += 1;
        } else {
            failed += 1;
            failures.push((vec.test_id.clone(), got, want));
        }
    }

    let total = passed + failed;
    eprintln!("CONFORMANCE (v1.1): {}/{} PASS", passed, total);
    for (tid, got, want) in &failures {
        eprintln!("  FAIL {}: got={:?} expected={:?}", tid, got, want);
    }

    assert_eq!(failed, 0, "{} conformance tests failed", failed);
}

// ── Individual vector tests (for granular CI reporting) ──────

macro_rules! conformance_test {
    ($name:ident) => {
        #[test]
        fn $name() {
            let (vectors, expected) = load_vectors();
            let test_id = stringify!($name)
                .strip_prefix("test_")
                .unwrap_or(stringify!($name));

            let vec = vectors
                .iter()
                .find(|v| v.test_id == test_id)
                .unwrap_or_else(|| panic!("vector {} not found", test_id));
            let exp = expected
                .get(test_id)
                .unwrap_or_else(|| panic!("expected {} not found", test_id));

            let got = run_vector(vec);
            let want = expected_to_result(exp);
            assert_eq!(got, want, "{}: got={:?} expected={:?}", test_id, got, want);
        }
    };
}

// Generate individual test functions for each vector ID
conformance_test!(test_BIND_LIST_1);
conformance_test!(test_BIND_LIST_ROOT_EMPTY_PTR_ERR_1);
conformance_test!(test_BIND_NONMAP_BADPTR_1);
conformance_test!(test_BIND_NONMAP_ROOT_LIST_1);
conformance_test!(test_BIND_OMIT_1);
conformance_test!(test_BIND_ROOT_PTR_1);
conformance_test!(test_BOM_REJECT_1);
conformance_test!(test_BOM_REJECT_WS_1);
conformance_test!(test_BOOL_MAP_FALSE);
conformance_test!(test_BOOL_MAP_TRUE);
conformance_test!(test_DEPTH_32_OK);
conformance_test!(test_DEPTH_33_BAD);
conformance_test!(test_DUP_RAW_1);
conformance_test!(test_DUP_UNESC_1);
conformance_test!(test_ESC_EQ_1);
conformance_test!(test_ESC_EQ_2);
conformance_test!(test_JSON_INF_1);
conformance_test!(test_JSON_NAN_1);
conformance_test!(test_JSON_NEGINF_1);
conformance_test!(test_JS_BAD_ESCAPE_1);
conformance_test!(test_JS_BOM_WS_1);
conformance_test!(test_JS_DUP_AFTER_UNESC_1);
conformance_test!(test_JS_SURROGATE_VAL_1);
conformance_test!(test_JS_TWO_ROOTS_1);
conformance_test!(test_KEY_ORDER_BAD_1);
conformance_test!(test_KEY_ORDER_GOOD_1);
conformance_test!(test_KEY_ORDER_SIGNED_TRAP_BAD);
conformance_test!(test_LONE_SURR_1);
conformance_test!(test_NULL_REJECT_1);
conformance_test!(test_NUM_REJECT_1);
conformance_test!(test_PTR_TILDE_1);
conformance_test!(test_SAFE_PREC_HDR_WINS);
conformance_test!(test_SAFE_PREC_MCF_WINS);
conformance_test!(test_SIZE_OVER_MAX_1);
conformance_test!(test_TRAIL_BYTES_1);
conformance_test!(test_UTF8_BAD_MCF_1);
conformance_test!(test_UTF8_OVERLONG_KEY_1);
conformance_test!(test_UTF8_TRUNC_KEY_1);
conformance_test!(test_WS1_MULTIFAULT_DUPKEY_NUM_1);
conformance_test!(test_WS2_JSON_UNTERM_OBJ_1);
conformance_test!(test_WS2_JSON_TRAILING_COMMA_1);
conformance_test!(test_WS4_ASTRAL_KEY_ORDER_1);
conformance_test!(test_WS4_NO_NORMALIZE_NFC_NFD_1);
conformance_test!(test_WS4_EMBEDDED_NUL_VALUE_1);
conformance_test!(test_WS4_NONCHAR_VALUE_1);
conformance_test!(test_WS2_DUPKEY_BIND_1);
conformance_test!(test_WS7_BIND_NOMATCH_EMPTYMAP_1);
conformance_test!(test_WS7_BIND_MIXED_MATCH_UNMATCH_1);
conformance_test!(test_WS7_BIND_EMPTY_PTR_PLUS_NOPE_1);
conformance_test!(test_WS5_DEPTH_MAP_PASS_32);
conformance_test!(test_WS5_DEPTH_MAP_FAIL_33);
conformance_test!(test_WS5_DEPTH_LIST_PASS_31);
conformance_test!(test_WS5_DEPTH_LIST_FAIL_32);
conformance_test!(test_BOOL_TRUE_VS_STRING);
conformance_test!(test_BOOL_STRING_TRUE);
conformance_test!(test_BOOL_FALSE_VS_STRING);
conformance_test!(test_BOOL_STRING_FALSE);
conformance_test!(test_BOOL_LIST_TRUE);
conformance_test!(test_BOOL_LIST_STRING_TRUE);
conformance_test!(test_BOOL_STANDALONE_TRUE);
conformance_test!(test_BOOL_STANDALONE_FALSE);
conformance_test!(test_INT_SIMPLE_42);
conformance_test!(test_INT_VS_STRING_42);
conformance_test!(test_INT_ZERO);
conformance_test!(test_INT_VS_STRING_ZERO);
conformance_test!(test_INT_NEGATIVE);
conformance_test!(test_INT_NEGATIVE_LARGE);
conformance_test!(test_INT_STANDALONE_42);
conformance_test!(test_INT_STANDALONE_NEG);
conformance_test!(test_INT_MAX);
conformance_test!(test_INT_MIN);
conformance_test!(test_INT_OVERFLOW_POS);
conformance_test!(test_INT_OVERFLOW_NEG);
conformance_test!(test_FLOAT_REJECT_DECIMAL);
conformance_test!(test_FLOAT_REJECT_1_DOT_0);
conformance_test!(test_FLOAT_REJECT_EXP_LOWER);
conformance_test!(test_FLOAT_REJECT_EXP_UPPER);
conformance_test!(test_FLOAT_REJECT_NEG_EXP);
conformance_test!(test_FLOAT_REJECT_ZERO_DOT);
conformance_test!(test_MIXED_MAP);
conformance_test!(test_MIXED_LIST);
conformance_test!(test_MIXED_NESTED);
conformance_test!(test_BOOL_CANON_TRUE);
conformance_test!(test_BOOL_CANON_FALSE);
conformance_test!(test_BOOL_CANON_BAD_PAYLOAD);
conformance_test!(test_BOOL_CANON_BAD_PAYLOAD_FF);
conformance_test!(test_INT_CANON_42);
conformance_test!(test_INT_CANON_ZERO);
conformance_test!(test_INT_CANON_NEG1);
conformance_test!(test_INT_CANON_MAX);
conformance_test!(test_INT_CANON_MIN);
conformance_test!(test_INT_CANON_TRUNCATED);
conformance_test!(test_BIND_BOOL_SELECT);
conformance_test!(test_BIND_INT_SELECT);
conformance_test!(test_NULL_IN_LIST);
