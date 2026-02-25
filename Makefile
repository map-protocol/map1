.PHONY: test conformance lint clean help

PYTHON_DIR = implementations/python
NODE_DIR   = implementations/node
GO_DIR     = implementations/go
RUST_DIR   = implementations/rust
VECTORS    = conformance

help:
	@echo "make test         - run all tests (all languages)"
	@echo "make conformance  - run conformance suite only"
	@echo "make test-python  - python tests"
	@echo "make test-node    - node tests"
	@echo "make test-go      - go tests"
	@echo "make test-rust    - rust tests"
	@echo "make lint         - lint python + node"
	@echo "make clean        - remove build artifacts"

# ── all tests ─────────────────────────────────────────────────

test: test-python test-node test-go test-rust

conformance: conformance-python conformance-node conformance-go conformance-rust

# ── python ────────────────────────────────────────────────────

test-python:
	cd $(PYTHON_DIR) && python tests/test_api.py -v && MAP1_VECTORS_DIR=../../$(VECTORS) python tests/test_conformance.py

conformance-python:
	cd $(PYTHON_DIR) && MAP1_VECTORS_DIR=../../$(VECTORS) python tests/test_conformance.py

# ── node ──────────────────────────────────────────────────────

test-node:
	cd $(NODE_DIR) && node tests/test-api.js && MAP1_VECTORS_DIR=../../$(VECTORS) node tests/test-conformance.js

conformance-node:
	cd $(NODE_DIR) && MAP1_VECTORS_DIR=../../$(VECTORS) node tests/test-conformance.js

# ── go ────────────────────────────────────────────────────────

test-go:
	cd $(GO_DIR) && go test ./... -v

conformance-go:
	cd $(GO_DIR) && MAP1_VECTORS_DIR=../../$(VECTORS) go test -run TestConformance -v

# ── rust ──────────────────────────────────────────────────────

test-rust:
	cd $(RUST_DIR) && cargo test

conformance-rust:
	cd $(RUST_DIR) && MAP1_VECTORS_DIR=../../$(VECTORS) cargo test conformance

# ── lint ──────────────────────────────────────────────────────
# not enforcing yet on go/rust, their toolchains handle it differently

lint:
	cd $(PYTHON_DIR) && python -m py_compile map1/__init__.py map1/_core.py map1/_json_adapter.py
	cd $(NODE_DIR) && npx tsc --noEmit 2>/dev/null || true

# ── clean ─────────────────────────────────────────────────────

clean:
	find . -type d -name __pycache__ -exec rm -rf {} + 2>/dev/null || true
	find . -type f -name '*.pyc' -delete 2>/dev/null || true
	cd $(NODE_DIR) && rm -rf node_modules dist 2>/dev/null || true
	cd $(GO_DIR) && go clean 2>/dev/null || true
	cd $(RUST_DIR) && cargo clean 2>/dev/null || true
