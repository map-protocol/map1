//! MAP v1.1 projection — FULL and BIND modes.
//!
//! FULL (§2.2): the identity function on the descriptor MAP.
//! BIND (§2.3): select specific fields by RFC 6901 JSON Pointer paths,
//!              producing a minimal enclosing MAP structure.
//!
//! BIND is where most of the complexity lives.  The spec has five pointer-set
//! rules (a–e) plus four structural rules (1–4) that interact in non-obvious
//! ways.  The comments below reference specific spec rules so implementers
//! can trace each branch back to normative text.

use crate::errors::*;
use crate::value::MapValue;

// ── RFC 6901 JSON Pointer parsing ─────────────────────────────
// RFC 6901 is simple but has one sharp edge: tilde escaping.
// "~0" → literal "~" and "~1" → literal "/".  The order matters —
// if you decode "~1" before "~0", the string "~01" decodes wrong.
// We handle this character-by-character to avoid that trap.

fn parse_pointer(ptr: &str) -> Result<Vec<String>, MapError> {
    if ptr.is_empty() {
        return Ok(Vec::new()); // whole-document pointer (rule 2.3.e)
    }
    if !ptr.starts_with('/') {
        return Err(MapError::new(ERR_SCHEMA, "pointer must start with '/'"));
    }

    let mut tokens = Vec::new();
    for raw in ptr[1..].split('/') {
        let mut decoded = String::new();
        let chars: Vec<char> = raw.chars().collect();
        let mut i = 0;
        while i < chars.len() {
            if chars[i] != '~' {
                decoded.push(chars[i]);
                i += 1;
                continue;
            }
            // Must have a character after ~
            if i + 1 >= chars.len() {
                return Err(MapError::new(ERR_SCHEMA, "dangling ~ in pointer"));
            }
            match chars[i + 1] {
                '0' => decoded.push('~'),
                '1' => decoded.push('/'),
                c => {
                    return Err(MapError::new(
                        ERR_SCHEMA,
                        format!("bad ~{} escape in pointer", c),
                    ));
                }
            }
            i += 2;
        }
        tokens.push(decoded);
    }
    Ok(tokens)
}

// ── FULL projection (§2.2) ────────────────────────────────────

/// FULL projection: identity on the descriptor.
pub fn full_project(descriptor: &MapValue) -> MapValue {
    descriptor.clone()
}

// ── BIND projection (§2.3) ────────────────────────────────────

/// BIND projection: select fields by JSON Pointer paths.
///
/// Implements all normative rules from §2.3:
///   (a) Parse every pointer per RFC 6901
///   (b) Reject duplicate pointers
///   (c) Unmatched pointer handling (fail-closed unless zero match)
///   (d) Subsumption of overlapping pointers
///   (e) Empty pointer "" = FULL-equivalent
///   (1) Omit siblings at each MAP level
///   (2) Minimal enclosing structure
///   (3) No match → empty MAP (not an error)
///   (4) LIST traversal is forbidden (ERR_SCHEMA)
pub fn bind_project(descriptor: &MapValue, pointers: &[&str]) -> Result<MapValue, MapError> {
    // Root must be a MAP.
    let root_entries = match descriptor {
        MapValue::Map(entries) => entries,
        _ => return Err(MapError::new(ERR_SCHEMA, "BIND root must be a MAP")),
    };

    // Rule (b): no duplicate pointer strings.
    {
        let mut seen = std::collections::HashSet::new();
        for ptr in pointers {
            if !seen.insert(*ptr) {
                return Err(MapError::new(ERR_SCHEMA, "duplicate pointers"));
            }
        }
    }

    // Rule (a): parse all pointers up front so parse failures are caught
    // before we start traversing the descriptor.
    let parsed: Vec<(&str, Vec<String>)> = pointers
        .iter()
        .map(|&ptr| {
            let tokens = parse_pointer(ptr)?;
            Ok((ptr, tokens))
        })
        .collect::<Result<Vec<_>, MapError>>()?;

    // Walk each pointer against the descriptor to determine match status.
    let mut matched_paths: Vec<Vec<String>> = Vec::new();
    let mut any_match = false;
    let mut any_unmatched = false;

    for (ptr, tokens) in &parsed {
        // Rule (e): empty pointer always matches the MAP root.
        if ptr.is_empty() {
            any_match = true;
            continue;
        }

        let mut cur: &MapValue = descriptor;
        let mut ok = true;
        for tok in tokens {
            match cur {
                // Rule (4): LIST traversal is forbidden.
                MapValue::List(_) => {
                    return Err(MapError::new(ERR_SCHEMA, "BIND cannot traverse LIST"));
                }
                MapValue::Map(entries) => {
                    if let Some((_k, v)) = entries.iter().find(|(k, _)| k == tok) {
                        cur = v;
                    } else {
                        ok = false;
                        break;
                    }
                }
                _ => {
                    ok = false;
                    break;
                }
            }
        }

        if ok {
            any_match = true;
            matched_paths.push(tokens.clone());
        } else {
            any_unmatched = true;
        }
    }

    // Rule (c): unmatched pointer handling.
    if !any_match {
        // Rule (3): all pointers unmatched → empty MAP
        return Ok(MapValue::Map(Vec::new()));
    }
    if any_unmatched {
        // At least one matched but another didn't → fail-closed.
        return Err(MapError::new(ERR_SCHEMA, "unmatched pointer in set"));
    }

    // Rule (e): if any pointer is "", result is the full descriptor.
    if parsed.iter().any(|(ptr, _)| ptr.is_empty()) {
        return Ok(descriptor.clone());
    }

    // Rule (d): discard subsumed pointers (P1 is prefix of P2 → P2 is redundant).
    let effective: Vec<&Vec<String>> = matched_paths
        .iter()
        .filter(|toks| {
            !matched_paths.iter().any(|other| {
                other.len() < toks.len() && toks[..other.len()] == other[..]
            })
        })
        .collect();

    // Build the projected tree — rule (1) omit-siblings, rule (2) minimal structure.
    build_projected(root_entries, &effective)
}

/// Build the projected MAP from effective pointer paths.
fn build_projected(
    root_entries: &[(String, MapValue)],
    paths: &[&Vec<String>],
) -> Result<MapValue, MapError> {
    // Group paths by their first token (the key at this MAP level)
    let mut key_groups: Vec<(String, Vec<Vec<String>>)> = Vec::new();

    for path in paths {
        if path.is_empty() {
            // Shouldn't happen at this point (empty pointers handled above)
            continue;
        }
        let first = &path[0];
        let rest: Vec<String> = path[1..].to_vec();

        if let Some(group) = key_groups.iter_mut().find(|(k, _)| k == first) {
            group.1.push(rest);
        } else {
            key_groups.push((first.clone(), vec![rest]));
        }
    }

    let mut result: Vec<(String, MapValue)> = Vec::new();
    for (key, sub_paths) in &key_groups {
        // Find this key in the root entries
        let (_k, val) = root_entries
            .iter()
            .find(|(k, _)| k == key)
            .ok_or_else(|| MapError::new(ERR_SCHEMA, "BIND path key not found"))?;

        // Check if any sub_path is empty (meaning this key is a leaf selection)
        if sub_paths.iter().any(|p| p.is_empty()) {
            // This key's value is selected directly
            result.push((key.clone(), val.clone()));
        } else {
            // Need to recurse into this value (must be a MAP)
            match val {
                MapValue::List(_) => {
                    return Err(MapError::new(ERR_SCHEMA, "BIND cannot traverse LIST"));
                }
                MapValue::Map(entries) => {
                    let sub_refs: Vec<&Vec<String>> = sub_paths.iter().collect();
                    let projected = build_projected(entries, &sub_refs)?;
                    result.push((key.clone(), projected));
                }
                _ => {
                    return Err(MapError::new(ERR_SCHEMA, "cannot traverse non-MAP"));
                }
            }
        }
    }

    // Sort the result by raw UTF-8 byte order (§3.5)
    result.sort_by(|(a, _), (b, _)| a.as_bytes().cmp(b.as_bytes()));

    Ok(MapValue::Map(result))
}

// TODO: consider a non-cloning projection that borrows from the
// descriptor, using Cow<str> for keys and Cow<MapValue> for values.
