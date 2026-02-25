"""MAP v1.1 projection — FULL and BIND modes.

FULL (§2.2): the identity function on the descriptor MAP.
BIND (§2.3): select specific fields by RFC 6901 JSON Pointer paths,
             producing a minimal enclosing MAP structure.

BIND is where most of the complexity lives.  The spec has five pointer-set
rules (a–e) plus four structural rules (1–4) that interact in non-obvious
ways.  The comments below reference specific spec rules so implementers
can trace each branch back to normative text.
"""

from __future__ import annotations

from typing import Any, Dict, List, Tuple

from ._errors import ERR_SCHEMA, MapError


# ── RFC 6901 JSON Pointer parsing ─────────────────────────────
# RFC 6901 is simple but has one sharp edge: tilde escaping.
# "~0" → literal "~" and "~1" → literal "/".  The order matters —
# if you decode "~1" before "~0", the string "~01" decodes wrong.
# We handle this character-by-character to avoid that trap.

def _parse_pointer(ptr: str) -> List[str]:
    """Parse an RFC 6901 pointer into reference tokens.

    "" (empty string) → [] (whole-document pointer, rule 2.3.e).
    Otherwise must start with "/".
    """
    if ptr == "":
        return []
    if not ptr.startswith("/"):
        raise MapError(ERR_SCHEMA, "pointer must start with '/'")

    tokens: List[str] = []
    for raw in ptr.split("/")[1:]:
        decoded = ""
        i = 0
        while i < len(raw):
            if raw[i] != "~":
                decoded += raw[i]
                i += 1
                continue
            # Must have a character after ~
            if i + 1 >= len(raw):
                raise MapError(ERR_SCHEMA, "dangling ~ in pointer")
            nxt = raw[i + 1]
            if nxt == "0":
                decoded += "~"
            elif nxt == "1":
                decoded += "/"
            else:
                raise MapError(ERR_SCHEMA, "bad ~{} escape in pointer".format(nxt))
            i += 2
        tokens.append(decoded)
    return tokens


# ── FULL projection (§2.2) ────────────────────────────────────

def full_project(descriptor: Any) -> Any:
    """FULL projection: identity on the descriptor."""
    return descriptor


# ── BIND projection (§2.3) ────────────────────────────────────

def bind_project(descriptor: Any, pointers: List[str]) -> Any:
    """BIND projection: select fields by JSON Pointer paths.

    Implements all normative rules from §2.3:
      (a) Parse every pointer per RFC 6901
      (b) Reject duplicate pointers
      (c) Unmatched pointer handling (fail-closed unless zero match)
      (d) Subsumption of overlapping pointers
      (e) Empty pointer "" = FULL-equivalent
      (1) Omit siblings at each MAP level
      (2) Minimal enclosing structure
      (3) No match → empty MAP (not an error)
      (4) LIST traversal is forbidden (ERR_SCHEMA)
    """
    # Root must be a MAP.
    if not isinstance(descriptor, dict):
        raise MapError(ERR_SCHEMA, "BIND root must be a MAP")

    # Rule (b): no duplicate pointer strings.
    if len(set(pointers)) != len(pointers):
        raise MapError(ERR_SCHEMA, "duplicate pointers")

    # Rule (a): parse all pointers up front so parse failures are caught
    # before we start traversing the descriptor.
    parsed: List[Tuple[str, List[str]]] = []
    for ptr in pointers:
        tokens = _parse_pointer(ptr)
        parsed.append((ptr, tokens))

    # Walk each pointer against the descriptor to determine match status.
    matched_paths: List[List[str]] = []
    any_match = False
    any_unmatched = False

    for ptr, tokens in parsed:
        # Rule (e): empty pointer always matches the MAP root.
        if ptr == "":
            any_match = True
            continue

        cur: Any = descriptor
        ok = True
        for tok in tokens:
            # Rule (4): LIST traversal is forbidden.
            if isinstance(cur, list):
                raise MapError(ERR_SCHEMA, "BIND cannot traverse LIST")
            if not isinstance(cur, dict) or tok not in cur:
                ok = False
                break
            cur = cur[tok]

        if ok:
            any_match = True
            matched_paths.append(tokens)
        else:
            any_unmatched = True

    # Rule (c): unmatched pointer handling.
    if not any_match:
        return {}  # Rule (3): all pointers unmatched → empty MAP
    if any_unmatched:
        # At least one matched but another didn't → fail-closed.
        raise MapError(ERR_SCHEMA, "unmatched pointer in set")

    # Rule (e): if any pointer is "", result is the full descriptor.
    if any(ptr == "" for ptr, _ in parsed):
        return descriptor

    # Rule (d): discard subsumed pointers (P1 is prefix of P2 → P2 is redundant).
    def is_subsumed(toks: List[str]) -> bool:
        for other in matched_paths:
            if len(other) < len(toks) and toks[:len(other)] == other:
                return True
        return False

    effective = [t for t in matched_paths if not is_subsumed(t)]

    # Build the projected tree — rule (1) omit-siblings, rule (2) minimal structure.
    projected: Dict[str, Any] = {}
    for toks in effective:
        cur = descriptor
        path_keys: List[Tuple[dict, str]] = []
        for tok in toks:
            if isinstance(cur, list):
                raise MapError(ERR_SCHEMA, "BIND cannot traverse LIST")
            if not isinstance(cur, dict):
                raise MapError(ERR_SCHEMA, "cannot traverse non-MAP")
            path_keys.append((cur, tok))
            cur = cur[tok]

        # Walk the projected tree, creating nested MAPs as needed.
        target = projected
        for i, (_node, tok) in enumerate(path_keys):
            if i == len(path_keys) - 1:
                target[tok] = cur  # leaf value
            else:
                nxt = target.get(tok)
                if nxt is None:
                    nxt = {}
                    target[tok] = nxt
                if not isinstance(nxt, dict):
                    raise MapError(ERR_SCHEMA, "BIND path conflict")
                target = nxt

    return projected
