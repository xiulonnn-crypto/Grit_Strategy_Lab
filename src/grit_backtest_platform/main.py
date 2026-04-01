from __future__ import annotations

import argparse
import json
import os
from pathlib import Path

import uvicorn

from .api import create_app
from .real_service import RealBacktestPlatformService
from .yahoo_provider import YahooMarketDataProvider

app = create_app()


def _default_db_path() -> Path:
    configured = os.getenv("GRIT_BACKTEST_DB")
    return Path(configured) if configured else Path.cwd() / ".grit_backtest_platform.sqlite3"


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(prog="grit_backtest_platform.main")
    parser.add_argument("command", nargs="?", default="serve", choices=["serve", "refresh-snapshots"])
    parser.add_argument("--reason", dest="reason", default=None)
    parser.add_argument("--db-path", dest="db_path", default=None)
    args = parser.parse_args(argv)

    if args.command == "refresh-snapshots":
        service = RealBacktestPlatformService(
            args.db_path or _default_db_path(),
            market_data_provider=YahooMarketDataProvider(),
        )
        overview = service.refresh_snapshots({"reason": args.reason} if args.reason else {})
        print(json.dumps(overview, ensure_ascii=False))
        return

    uvicorn.run(app, host="0.0.0.0", port=8000)


if __name__ == "__main__":
    main()
