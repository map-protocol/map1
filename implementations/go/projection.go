package map1

import "strings"

// FullProject returns the descriptor unchanged (§2.2).
func FullProject(descriptor Value) Value {
	return descriptor
}

// BindProject selects fields from descriptor by JSON Pointer paths (§2.3).
//
// Implements all normative rules:
//
//	(a) Parse every pointer per RFC 6901
//	(b) Reject duplicate pointers
//	(c) Unmatched pointer handling (fail-closed unless zero match)
//	(d) Subsumption of overlapping pointers
//	(e) Empty pointer "" = FULL-equivalent
//	(1) Omit siblings at each MAP level
//	(2) Minimal enclosing structure
//	(3) No match → empty MAP
//	(4) LIST traversal forbidden (ERR_SCHEMA)
func BindProject(descriptor Value, pointers []string) (Value, error) {
	// Root must be a MAP.
	root, ok := descriptor.(*Map)
	if !ok {
		return nil, newErr(ErrSchema, "BIND root must be a MAP")
	}

	// Rule (b): no duplicate pointer strings.
	seen := make(map[string]bool, len(pointers))
	for _, p := range pointers {
		if seen[p] {
			return nil, newErr(ErrSchema, "duplicate pointers")
		}
		seen[p] = true
	}

	// Rule (a): parse all pointers up front.
	type parsedPtr struct {
		raw    string
		tokens []string
	}
	parsed := make([]parsedPtr, len(pointers))
	for i, ptr := range pointers {
		tokens, err := parsePointer(ptr)
		if err != nil {
			return nil, err
		}
		parsed[i] = parsedPtr{raw: ptr, tokens: tokens}
	}

	// Walk each pointer to determine match status.
	type matchedPath struct {
		tokens []string
	}
	var matched []matchedPath
	anyMatch := false
	anyUnmatched := false

	for _, pp := range parsed {
		// Rule (e): empty pointer always matches.
		if pp.raw == "" {
			anyMatch = true
			continue
		}
		cur := Value(root)
		ok := true
		for _, tok := range pp.tokens {
			// Rule (4): LIST traversal forbidden.
			if _, isList := cur.(List); isList {
				return nil, newErr(ErrSchema, "BIND cannot traverse LIST")
			}
			m, isMap := cur.(*Map)
			if !isMap {
				ok = false
				break
			}
			found := false
			for j, k := range m.Keys {
				if k == tok {
					cur = m.Values[j]
					found = true
					break
				}
			}
			if !found {
				ok = false
				break
			}
		}
		if ok {
			anyMatch = true
			matched = append(matched, matchedPath{tokens: pp.tokens})
		} else {
			anyUnmatched = true
		}
	}

	// Rule (c): unmatched pointer handling.
	if !anyMatch {
		return EmptyMap(), nil // Rule (3)
	}
	if anyUnmatched {
		return nil, newErr(ErrSchema, "unmatched pointer in set")
	}

	// Rule (e): if any pointer is "", result is full descriptor.
	for _, pp := range parsed {
		if pp.raw == "" {
			return root, nil
		}
	}

	// Rule (d): discard subsumed pointers.
	effective := make([][]string, 0, len(matched))
	for _, mp := range matched {
		subsumed := false
		for _, other := range matched {
			if len(other.tokens) < len(mp.tokens) {
				if tokensPrefix(other.tokens, mp.tokens) {
					subsumed = true
					break
				}
			}
		}
		if !subsumed {
			effective = append(effective, mp.tokens)
		}
	}

	// Build projected tree — rule (1) omit-siblings, rule (2) minimal structure.
	projected := &Map{}
	for _, toks := range effective {
		cur := Value(root)
		// Resolve the leaf value.
		for _, tok := range toks {
			m := cur.(*Map) // safe — we already validated the path
			for j, k := range m.Keys {
				if k == tok {
					cur = m.Values[j]
					break
				}
			}
		}
		leaf := cur

		// Walk the projected tree, creating nested Maps as needed.
		target := projected
		for i, tok := range toks {
			if i == len(toks)-1 {
				// Leaf assignment.
				mapSet(target, tok, leaf)
			} else {
				existing := mapGet(target, tok)
				if existing == nil {
					child := &Map{}
					mapSet(target, tok, child)
					target = child
				} else {
					child, ok := existing.(*Map)
					if !ok {
						return nil, newErr(ErrSchema, "BIND path conflict")
					}
					target = child
				}
			}
		}
	}

	return projected, nil
}

// parsePointer parses an RFC 6901 JSON Pointer into reference tokens.
// "" → [] (whole-document pointer, rule 2.3.e).
func parsePointer(ptr string) ([]string, error) {
	if ptr == "" {
		return nil, nil
	}
	if !strings.HasPrefix(ptr, "/") {
		return nil, newErr(ErrSchema, "pointer must start with '/'")
	}
	parts := strings.Split(ptr[1:], "/")
	tokens := make([]string, len(parts))
	for i, raw := range parts {
		// RFC 6901 tilde decoding: ~0 → "~", ~1 → "/".
		// Process character-by-character to handle ~01 correctly.
		var b strings.Builder
		j := 0
		for j < len(raw) {
			if raw[j] != '~' {
				b.WriteByte(raw[j])
				j++
				continue
			}
			if j+1 >= len(raw) {
				return nil, newErr(ErrSchema, "dangling ~ in pointer")
			}
			switch raw[j+1] {
			case '0':
				b.WriteByte('~')
			case '1':
				b.WriteByte('/')
			default:
				return nil, newErr(ErrSchema, "bad tilde escape in pointer")
			}
			j += 2
		}
		tokens[i] = b.String()
	}
	return tokens, nil
}

// tokensPrefix returns true if a is a strict prefix of b.
func tokensPrefix(a, b []string) bool {
	if len(a) >= len(b) {
		return false
	}
	for i := range a {
		if a[i] != b[i] {
			return false
		}
	}
	return true
}

// Map helpers — these operate on our Map type (not Go's map).
func mapGet(m *Map, key string) Value {
	for i, k := range m.Keys {
		if k == key {
			return m.Values[i]
		}
	}
	return nil
}

func mapSet(m *Map, key string, val Value) {
	for i, k := range m.Keys {
		if k == key {
			m.Values[i] = val
			return
		}
	}
	m.Keys = append(m.Keys, key)
	m.Values = append(m.Values, val)
}
