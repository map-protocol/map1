package map1

import "fmt"

// Error codes (§6.1).  Names match the spec exactly.
const (
	ErrCanonHdr   = "ERR_CANON_HDR"
	ErrCanonMCF   = "ERR_CANON_MCF"
	ErrSchema     = "ERR_SCHEMA"
	ErrType       = "ERR_TYPE"
	ErrUTF8       = "ERR_UTF8"
	ErrDupKey     = "ERR_DUP_KEY"
	ErrKeyOrder   = "ERR_KEY_ORDER"
	ErrLimitDepth = "ERR_LIMIT_DEPTH"
	ErrLimitSize  = "ERR_LIMIT_SIZE"
)

// MapError is the canonical error type for MAP v1 processing.
// Conformance tests compare the Code field against ERR_* strings.
type MapError struct {
	Code string
	Msg  string
}

func (e *MapError) Error() string {
	if e.Msg != "" {
		return fmt.Sprintf("%s: %s", e.Code, e.Msg)
	}
	return e.Code
}

func newErr(code, msg string) *MapError {
	return &MapError{Code: code, Msg: msg}
}

// Precedence order (§6.2): index 0 wins.
var precedence = []string{
	ErrCanonHdr,
	ErrCanonMCF,
	ErrSchema,
	ErrType,
	ErrUTF8,
	ErrDupKey,
	ErrKeyOrder,
	ErrLimitDepth,
	ErrLimitSize,
}

var precIndex map[string]int

func init() {
	precIndex = make(map[string]int, len(precedence))
	for i, c := range precedence {
		precIndex[c] = i
	}
}

// ChooseReportedError returns the highest-precedence code from a set
// of detected violations (§6.2 reported-code rule).
func ChooseReportedError(codes []string) string {
	best := codes[0]
	bestIdx := precIndex[best]
	for _, c := range codes[1:] {
		if idx, ok := precIndex[c]; ok && idx < bestIdx {
			best = c
			bestIdx = idx
		}
	}
	return best
}
