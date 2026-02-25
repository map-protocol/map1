//! MAP v1.1 error codes, error type, and precedence logic.
//!
//! Spec reference: §6 (Errors).
//!
//! Error precedence matters for conformance — when multiple violations apply,
//! implementations MUST report the highest-precedence one.  The precedence
//! order is fixed by spec §6.2, and the safety-vs-precedence rule governs
//! short-circuit behavior.

use std::fmt;

// ── Error codes (9 total, ordered by precedence) ─────────────
// Names match the spec exactly for cross-language grep-ability.

pub const ERR_CANON_HDR: &str = "ERR_CANON_HDR";
pub const ERR_CANON_MCF: &str = "ERR_CANON_MCF";
pub const ERR_SCHEMA: &str = "ERR_SCHEMA";
pub const ERR_TYPE: &str = "ERR_TYPE";
pub const ERR_UTF8: &str = "ERR_UTF8";
pub const ERR_DUP_KEY: &str = "ERR_DUP_KEY";
pub const ERR_KEY_ORDER: &str = "ERR_KEY_ORDER";
pub const ERR_LIMIT_DEPTH: &str = "ERR_LIMIT_DEPTH";
pub const ERR_LIMIT_SIZE: &str = "ERR_LIMIT_SIZE";

/// Precedence order: index 0 wins.  This ordering is normative (§6.2).
pub const PRECEDENCE: &[&str] = &[
    ERR_CANON_HDR,
    ERR_CANON_MCF,
    ERR_SCHEMA,
    ERR_TYPE,
    ERR_UTF8,
    ERR_DUP_KEY,
    ERR_KEY_ORDER,
    ERR_LIMIT_DEPTH,
    ERR_LIMIT_SIZE,
];

/// MAP v1 processing error.
///
/// The `code` field is one of the `ERR_*` constants and is what conformance
/// tests compare against.  The `message` field is human-readable context.
#[derive(Debug, Clone)]
pub struct MapError {
    pub code: &'static str,
    pub message: String,
}

impl MapError {
    pub fn new(code: &'static str, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
        }
    }
}

impl fmt::Display for MapError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}: {}", self.code, self.message)
    }
}

impl std::error::Error for MapError {}

/// Given multiple detected violations, return the highest-precedence code.
///
/// Implements the "reported-code rule" from §6.2.  Most code paths raise
/// immediately on first error; this helper is for cases where an implementation
/// collects violations before deciding what to report.
pub fn choose_reported_error<'a>(errors: &[&'a str]) -> &'a str {
    let mut best_idx = usize::MAX;
    let mut best_code: &str = errors[0];
    for &err in errors {
        if let Some(idx) = PRECEDENCE.iter().position(|&p| p == err) {
            if idx < best_idx {
                best_idx = idx;
                best_code = PRECEDENCE[idx];
            }
        }
    }
    best_code
}
