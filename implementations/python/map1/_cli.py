"""MAP v1 command-line interface.

Usage:
    echo '{"a":"b"}' | python3 -m map1 mid [--full | --bind /ptr1 /ptr2 ...]
    echo '{"a":"b"}' | python3 -m map1 canon [--full | --bind /ptr1 /ptr2 ...]
    python3 -m map1 mid --full --input file.json
    python3 -m map1 version
"""

from __future__ import annotations

import argparse
import base64
import json
import sys
from typing import List, Optional

from . import (
    MapError,
    __version__,
    canonical_bytes_full,
    canonical_bytes_bind,
    mid_full,
    mid_bind,
    mid_full_json,
    mid_bind_json,
)


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="map1",
        description="MAP v1 — deterministic identifiers for structured descriptors",
    )
    sub = parser.add_subparsers(dest="command")

    # ── mid ──
    mid_p = sub.add_parser("mid", help="Compute a MID")
    mid_g = mid_p.add_mutually_exclusive_group(required=True)
    mid_g.add_argument("--full", action="store_true", help="FULL projection")
    mid_g.add_argument("--bind", nargs="+", metavar="PTR",
                       help="BIND projection: JSON pointers to include")
    mid_p.add_argument("--input", "-i", metavar="FILE",
                       help="Read JSON from FILE instead of stdin")
    mid_p.add_argument("--json-strict", action="store_true",
                       help="Use JSON-STRICT pipeline (raw bytes, dup-key detection)")

    # ── canon ──
    canon_p = sub.add_parser("canon", help="Emit canonical bytes (base64)")
    canon_g = canon_p.add_mutually_exclusive_group(required=True)
    canon_g.add_argument("--full", action="store_true", help="FULL projection")
    canon_g.add_argument("--bind", nargs="+", metavar="PTR",
                         help="BIND projection: JSON pointers to include")
    canon_p.add_argument("--input", "-i", metavar="FILE",
                         help="Read JSON from FILE instead of stdin")

    # ── version ──
    sub.add_parser("version", help="Print version and exit")

    return parser


def _read_input(filepath: Optional[str]) -> bytes:
    """Read JSON bytes from a file or stdin."""
    if filepath:
        with open(filepath, "rb") as f:
            return f.read()
    if sys.stdin.isatty():
        print("map1: reading from stdin (Ctrl-D to end)...", file=sys.stderr)
    return sys.stdin.buffer.read()


def _cmd_mid(args: argparse.Namespace) -> None:
    raw = _read_input(args.input)

    if args.json_strict:
        # JSON-STRICT path: operate on raw bytes
        if args.full:
            print(mid_full_json(raw))
        else:
            print(mid_bind_json(raw, args.bind))
    else:
        # Dict path: parse JSON, then compute
        descriptor = json.loads(raw)
        if args.full:
            print(mid_full(descriptor))
        else:
            print(mid_bind(descriptor, args.bind))


def _cmd_canon(args: argparse.Namespace) -> None:
    raw = _read_input(args.input)
    descriptor = json.loads(raw)

    if args.full:
        cb = canonical_bytes_full(descriptor)
    else:
        cb = canonical_bytes_bind(descriptor, args.bind)
    # Output base64 for safe terminal display
    print(base64.b64encode(cb).decode("ascii"))


def main(argv: Optional[List[str]] = None) -> None:
    parser = _build_parser()
    args = parser.parse_args(argv)

    if args.command is None:
        parser.print_help()
        sys.exit(1)

    if args.command == "version":
        print(f"map1 {__version__}")
        return

    try:
        if args.command == "mid":
            _cmd_mid(args)
        elif args.command == "canon":
            _cmd_canon(args)
    except MapError as e:
        print(f"map1: error [{e.code}]: {e}", file=sys.stderr)
        sys.exit(2)
    except json.JSONDecodeError as e:
        print(f"map1: JSON parse error: {e}", file=sys.stderr)
        sys.exit(2)


if __name__ == "__main__":
    main()
