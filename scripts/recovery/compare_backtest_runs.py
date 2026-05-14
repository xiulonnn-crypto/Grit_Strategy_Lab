from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[2]
SRC_ROOT = REPO_ROOT / "src"
if str(SRC_ROOT) not in sys.path:
    sys.path.insert(0, str(SRC_ROOT))

from grit_backtest_platform.backtest_forensics import (  # noqa: E402
    compare_backtest_runs,
    format_backtest_run_comparison_report,
)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description=(
            "Compare two persisted backtest runs directly from the local SQLite archive. "
            "This is intended for historical-run forensics before replaying code."
        )
    )
    parser.add_argument("--run-a", required=True, help="First backtest run id.")
    parser.add_argument("--run-b", required=True, help="Second backtest run id.")
    parser.add_argument(
        "--db",
        default=str(REPO_ROOT / ".grit_backtest_platform.sqlite3"),
        help="Path to the backtest SQLite database. Defaults to the repo root database.",
    )
    parser.add_argument(
        "--json",
        action="store_true",
        help="Emit the comparison report as JSON instead of a human-readable summary.",
    )
    return parser


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)

    try:
        report = compare_backtest_runs(args.db, args.run_a, args.run_b)
    except KeyError as exc:
        parser.error(str(exc))
        return 2

    if args.json:
        print(json.dumps(report, ensure_ascii=False, indent=2))
    else:
        print(format_backtest_run_comparison_report(report))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
