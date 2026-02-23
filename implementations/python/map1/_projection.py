"""MAP v1 projection: BIND and FULL projection modes."""

from __future__ import annotations

from typing import Any, Dict, List, Tuple

from ._errors import ERR_SCHEMA, MapError


# ── RFC 6901 JSON Pointer parsing ───────────────────────────

def _parse_json_pointer(ptr: str) -> List[str]:
    """Parse an RFC 6901 JSON Pointer into reference tokens.

    - ``""`` (empty string) → empty token list (whole-document pointer).
    - Otherwise must start with ``/``.
    - ``~1`` decodes to ``/``, ``~0`` decodes to ``~``.
    - Any other ``~`` escape is invalid.
    """
    if ptr == "":
        return []
    if not ptr.startswith("/"):
        raise MapError(ERR_SCHEMA, "JSON pointer must start with '/'")

    raw_tokens = ptr.split("/")[1:]  # skip empty string before leading '/'
    tokens: List[str] = []
    for raw in raw_tokens:
        decoded = ""
        i = 0
        while i < len(raw):
            ch = raw[i]
            if ch != "~":
                decoded += ch
                i += 1
                continue
            if i + 1 >= len(raw):
                raise MapError(ERR_SCHEMA, "invalid ~ escape in JSON pointer")
            nxt = raw[i + 1]
            if nxt == "0":
                decoded += "~"
            elif nxt == "1":
                decoded += "/"
            else:
                raise MapError(ERR_SCHEMA, "invalid ~ escape in JSON pointer")
            i += 2
        tokens.append(decoded)
    return tokens


# ── FULL projection ─────────────────────────────────────────

def full_project(descriptor: Any) -> Any:
    """FULL projection: identity on the descriptor."""
    return descriptor


# ── BIND projection ─────────────────────────────────────────

def bind_project(descriptor: Any, pointers: List[str]) -> Any:
    """BIND projection: select fields from *descriptor* by JSON Pointer paths.

    Implements all normative rules from spec §2.3:
      (a) Pointer parsing
      (b) Duplicate pointer rejection
      (c) Unmatched pointer handling (fail-closed, empty-MAP exception)
      (d) Subsumption (overlapping pointers)
      (e) Empty pointer "" → FULL-equivalent
      (1) Omit-siblings rule
      (2) Minimal enclosing structure
      (3) No-match → empty MAP
    """
    # Root must be a MAP (dict)
    if not isinstance(descriptor, dict):
        raise MapError(ERR_SCHEMA, "BIND root descriptor must be a MAP")

    # (b) Duplicate pointers
    if len(set(pointers)) != len(pointers):
        raise MapError(ERR_SCHEMA, "duplicate pointers in pointer set")

    # (a) Parse all pointers
    parsed: List[Tuple[str, List[str]]] = []
    for ptr in pointers:
        tokens = _parse_json_pointer(ptr)
        parsed.append((ptr, tokens))

    # Evaluate which pointers match
    matched_token_lists: List[List[str]] = []
    any_match = False
    any_unmatched = False

    for ptr, tokens in parsed:
        # Empty pointer "" always matches the MAP root (rule e)
        if ptr == "":
            any_match = True
            continue
        # Walk the descriptor
        cur: Any = descriptor
        ok = True
        for tok in tokens:
            if isinstance(cur, list):
                raise MapError(ERR_SCHEMA, "BIND does not traverse LIST nodes")
            if not isinstance(cur, dict):
                ok = False
                break
            if tok not in cur:
                ok = False
                break
            cur = cur[tok]
        if ok:
            any_match = True
            matched_token_lists.append(tokens)
        else:
            any_unmatched = True

    # (c) Unmatched pointer handling
    if not any_match:
        # No pointers matched → empty MAP (rule 3)
        return {}
    if any_unmatched:
        raise MapError(ERR_SCHEMA, "unmatched pointer in pointer set")

    # (e) Empty pointer → return full descriptor
    if any(ptr == "" for ptr, _ in parsed):
        return descriptor

    # (d) Subsumption: discard pointers that are strict prefixes of another
    def _is_subsumed(toks: List[str]) -> bool:
        for other in matched_token_lists:
            if len(other) < len(toks) and toks[: len(other)] == other:
                return True
        return False

    effective = [t for t in matched_token_lists if not _is_subsumed(t)]

    # Build projected tree (omit-siblings rule)
    projected: Dict[str, Any] = {}
    for toks in effective:
        # Walk descriptor to collect path + leaf value
        cur = descriptor
        path_nodes: List[Tuple[dict, str]] = []
        for tok in toks:
            if isinstance(cur, list):
                raise MapError(ERR_SCHEMA, "BIND does not traverse LIST nodes")
            if not isinstance(cur, dict):
                raise MapError(ERR_SCHEMA, "cannot traverse non-MAP")
            path_nodes.append((cur, tok))
            cur = cur[tok]

        # Build into projected dict
        out_cur = projected
        for i, (_node, tok) in enumerate(path_nodes):
            if i == len(path_nodes) - 1:
                # Leaf — insert the selected value
                out_cur[tok] = cur
            else:
                nxt = out_cur.get(tok)
                if nxt is None:
                    nxt = {}
                    out_cur[tok] = nxt
                if not isinstance(nxt, dict):
                    raise MapError(ERR_SCHEMA, "BIND path conflict")
                out_cur = nxt

    return projected
