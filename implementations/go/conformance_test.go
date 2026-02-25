package map1_test

import (
	"encoding/base64"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"testing"

	map1 "github.com/map-protocol/map1/implementations/go"
)

type vectorEntry struct {
	TestID   string   `json:"test_id"`
	Mode     string   `json:"mode"`
	InputB64 string   `json:"input_b64"`
	Pointers []string `json:"pointers"`
}

type vectorsFile struct {
	Meta    json.RawMessage `json:"meta"`
	Vectors []vectorEntry   `json:"vectors"`
}

type expectedFile struct {
	Meta     json.RawMessage        `json:"meta"`
	Expected map[string]expectedVal `json:"expected"`
}

type expectedVal struct {
	MID string `json:"mid,omitempty"`
	Err string `json:"err,omitempty"`
}

func findVectorsDir() string {
	// Try relative to this test file.
	_, filename, _, _ := runtime.Caller(0)
	candidates := []string{
		filepath.Join(filepath.Dir(filename), "..", "..", "conformance"),
		filepath.Join(filepath.Dir(filename), "conformance"),
	}
	// Also try from env.
	if d := os.Getenv("MAP1_VECTORS_DIR"); d != "" {
		candidates = append([]string{d}, candidates...)
	}
	for _, d := range candidates {
		if _, err := os.Stat(filepath.Join(d, "conformance_vectors_v11.json")); err == nil {
			return d
		}
	}
	return ""
}

func runVector(vec vectorEntry) (mid string, errCode string) {
	raw, err := base64.StdEncoding.DecodeString(vec.InputB64)
	if err != nil {
		return "", "BASE64_DECODE_ERROR"
	}

	switch vec.Mode {
	case "json_strict_full":
		result, e := map1.MIDFullJSON(raw)
		if e != nil {
			if me, ok := e.(*map1.MapError); ok {
				return "", me.Code
			}
			return "", "UNKNOWN_ERROR"
		}
		return result, ""

	case "json_strict_bind":
		result, e := map1.MIDBindJSON(raw, vec.Pointers)
		if e != nil {
			if me, ok := e.(*map1.MapError); ok {
				return "", me.Code
			}
			return "", "UNKNOWN_ERROR"
		}
		return result, ""

	case "canon_bytes":
		result, e := map1.MIDFromCanonBytes(raw)
		if e != nil {
			if me, ok := e.(*map1.MapError); ok {
				return "", me.Code
			}
			return "", "UNKNOWN_ERROR"
		}
		return result, ""

	default:
		return "", "UNKNOWN_MODE"
	}
}

func TestConformance(t *testing.T) {
	dir := findVectorsDir()
	if dir == "" {
		t.Fatal("Cannot find conformance vectors. Set MAP1_VECTORS_DIR.")
	}

	vecData, err := os.ReadFile(filepath.Join(dir, "conformance_vectors_v11.json"))
	if err != nil {
		t.Fatalf("reading vectors: %v", err)
	}
	expData, err := os.ReadFile(filepath.Join(dir, "conformance_expected_v11.json"))
	if err != nil {
		t.Fatalf("reading expected: %v", err)
	}

	var vf vectorsFile
	if err := json.Unmarshal(vecData, &vf); err != nil {
		t.Fatalf("parsing vectors: %v", err)
	}
	var ef expectedFile
	if err := json.Unmarshal(expData, &ef); err != nil {
		t.Fatalf("parsing expected: %v", err)
	}

	passed := 0
	total := len(vf.Vectors)

	for _, vec := range vf.Vectors {
		exp, ok := ef.Expected[vec.TestID]
		if !ok {
			t.Errorf("no expected value for %s", vec.TestID)
			continue
		}

		t.Run(vec.TestID, func(t *testing.T) {
			gotMID, gotErr := runVector(vec)

			if exp.Err != "" {
				// Expect an error.
				if gotErr != exp.Err {
					t.Errorf("expected err=%s, got err=%q mid=%q", exp.Err, gotErr, gotMID)
				} else {
					passed++
				}
			} else {
				// Expect a MID.
				if gotErr != "" {
					t.Errorf("expected mid=%s, got err=%s", exp.MID, gotErr)
				} else if gotMID != exp.MID {
					t.Errorf("expected mid=%s, got mid=%s", exp.MID, gotMID)
				} else {
					passed++
				}
			}
		})
	}

	// Summary line.
	t.Logf("CONFORMANCE (v1.1): %d/%d PASS", passed, total)
}

// TestVersion checks the spec version constant is correct.
func TestVersion(t *testing.T) {
	if map1.SpecVersion != "1.1" {
		t.Errorf("expected spec version 1.1, got %s", map1.SpecVersion)
	}
}

// TestEmptyMap ensures an empty MAP encodes correctly.
func TestEmptyMap(t *testing.T) {
	m := map1.EmptyMap()
	mid, err := map1.MIDFull(m)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if mid == "" {
		t.Error("MID should not be empty")
	}
	t.Logf("empty map MID: %s", mid)
}

// TestBasicMID checks a simple descriptor produces a deterministic MID.
func TestBasicMID(t *testing.T) {
	m := map1.NewMap(
		map1.MapEntry{Key: "action", Value: map1.String("deploy")},
		map1.MapEntry{Key: "target", Value: map1.String("prod")},
	)
	mid1, err := map1.MIDFull(m)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	mid2, err := map1.MIDFull(m)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if mid1 != mid2 {
		t.Errorf("MID not deterministic: %s vs %s", mid1, mid2)
	}
	t.Logf("basic MID: %s", mid1)
}

// TestBoolIntDistinction verifies v1.1 type distinction.
func TestBoolIntDistinction(t *testing.T) {
	t.Run("bool_vs_string", func(t *testing.T) {
		m1 := map1.NewMap(map1.MapEntry{Key: "v", Value: map1.Bool(true)})
		m2 := map1.NewMap(map1.MapEntry{Key: "v", Value: map1.String("true")})
		mid1, _ := map1.MIDFull(m1)
		mid2, _ := map1.MIDFull(m2)
		if mid1 == mid2 {
			t.Error("BOOLEAN true and STRING \"true\" should have different MIDs")
		}
	})

	t.Run("int_vs_string", func(t *testing.T) {
		m1 := map1.NewMap(map1.MapEntry{Key: "n", Value: map1.Integer(42)})
		m2 := map1.NewMap(map1.MapEntry{Key: "n", Value: map1.String("42")})
		mid1, _ := map1.MIDFull(m1)
		mid2, _ := map1.MIDFull(m2)
		if mid1 == mid2 {
			t.Error("INTEGER 42 and STRING \"42\" should have different MIDs")
		}
	})
}

// TestMIDFromCanonBytesRoundtrip encodes and validates.
func TestMIDFromCanonBytesRoundtrip(t *testing.T) {
	m := map1.NewMap(
		map1.MapEntry{Key: "a", Value: map1.String("1")},
		map1.MapEntry{Key: "b", Value: map1.Bool(true)},
		map1.MapEntry{Key: "c", Value: map1.Integer(42)},
	)
	canon, err := map1.CanonBytesFull(m)
	if err != nil {
		t.Fatalf("encode: %v", err)
	}
	mid1, err := map1.MIDFull(m)
	if err != nil {
		t.Fatalf("mid_full: %v", err)
	}
	mid2, err := map1.MIDFromCanonBytes(canon)
	if err != nil {
		t.Fatalf("mid_from_canon_bytes: %v", err)
	}
	if mid1 != mid2 {
		t.Errorf("roundtrip MID mismatch: %s vs %s", mid1, mid2)
	}
}

func TestConformanceSummary(t *testing.T) {
	dir := findVectorsDir()
	if dir == "" {
		t.Skip("Cannot find conformance vectors")
	}

	vecData, _ := os.ReadFile(filepath.Join(dir, "conformance_vectors_v11.json"))
	expData, _ := os.ReadFile(filepath.Join(dir, "conformance_expected_v11.json"))

	var vf vectorsFile
	json.Unmarshal(vecData, &vf)
	var ef expectedFile
	json.Unmarshal(expData, &ef)

	passed := 0
	failed := 0
	var failures []string

	for _, vec := range vf.Vectors {
		exp := ef.Expected[vec.TestID]
		gotMID, gotErr := runVector(vec)

		ok := false
		if exp.Err != "" {
			ok = (gotErr == exp.Err)
		} else {
			ok = (gotErr == "" && gotMID == exp.MID)
		}

		if ok {
			passed++
		} else {
			failed++
			failures = append(failures, fmt.Sprintf("  FAIL %s: got mid=%q err=%q expected mid=%q err=%q",
				vec.TestID, gotMID, gotErr, exp.MID, exp.Err))
		}
	}

	total := passed + failed
	fmt.Printf("\nCONFORMANCE (v1.1): %d/%d PASS\n", passed, total)
	for _, f := range failures {
		fmt.Println(f)
	}
	if failed > 0 {
		t.Fatalf("%d/%d tests failed", failed, total)
	}
}
