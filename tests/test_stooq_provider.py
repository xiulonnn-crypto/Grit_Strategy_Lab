from __future__ import annotations

import zipfile
from datetime import date

from grit_backtest_platform import stooq_provider as stooq_provider_module
from grit_backtest_platform.stooq_provider import StooqZipPriceProvider


def test_stooq_provider_reads_offline_zip(monkeypatch, tmp_path):
    archive_path = tmp_path / "d_us_txt.zip"
    with zipfile.ZipFile(archive_path, "w") as archive:
        archive.writestr(
            "data/daily/us/nasdaq stocks/1/aapl.us.txt",
            "\n".join(
                [
                    "<TICKER>,<PER>,<DATE>,<TIME>,<OPEN>,<HIGH>,<LOW>,<CLOSE>,<VOL>,<OPENINT>",
                    "AAPL.US,D,20260401,000000,100,101,99,100.5,1000,0",
                    "AAPL.US,D,20260402,000000,101,102,100,101.5,1200,0",
                ]
            ),
        )
    monkeypatch.setenv("GRIT_STOOQ_US_DAILY_ZIP", str(archive_path))

    provider = StooqZipPriceProvider()
    result = provider.fetch_history("AAPL", date(2026, 4, 1), date(2026, 4, 2))

    assert provider.availability().available is True
    assert result.source == "stooq"
    assert len(result.bars) == 2
    assert result.bars[0].adj_close == result.bars[0].close
    assert result.metadata["actions_supported"] is False
    assert result.metadata["adj_close_proxy"] is True


def test_stooq_provider_normalizes_brk_b_lookup(monkeypatch, tmp_path):
    archive_path = tmp_path / "d_us_txt.zip"
    with zipfile.ZipFile(archive_path, "w") as archive:
        archive.writestr(
            "data/daily/us/nyse stocks/1/brk-b.us.txt",
            "\n".join(
                [
                    "<TICKER>,<PER>,<DATE>,<TIME>,<OPEN>,<HIGH>,<LOW>,<CLOSE>,<VOL>,<OPENINT>",
                    "BRK-B.US,D,20260401,000000,500,505,498,503,200,0",
                ]
            ),
        )
    monkeypatch.setenv("GRIT_STOOQ_US_DAILY_ZIP", str(archive_path))

    provider = StooqZipPriceProvider()

    dotted = provider.fetch_history("BRK.B", date(2026, 4, 1), date(2026, 4, 1))
    hyphenated = provider.fetch_history("BRK-B", date(2026, 4, 1), date(2026, 4, 1))

    assert dotted.bars[0].close == 503.0
    assert hyphenated.bars[0].close == 503.0


def test_stooq_provider_prefers_project_archive_when_present(monkeypatch, tmp_path):
    project_archive_path = tmp_path / "data" / "vendor" / "stooq" / "d_us_txt.zip"
    project_archive_path.parent.mkdir(parents=True)
    project_archive_path.write_bytes(b"zip-placeholder")
    downloads_archive_path = tmp_path / "Downloads" / "d_us_txt.zip"

    monkeypatch.delenv("GRIT_STOOQ_US_DAILY_ZIP", raising=False)
    monkeypatch.delenv("STOOQ_US_DAILY_ZIP", raising=False)
    monkeypatch.setattr(stooq_provider_module, "_project_stooq_archive_path", lambda: project_archive_path)
    monkeypatch.setattr(stooq_provider_module, "_downloads_stooq_archive_path", lambda: downloads_archive_path)

    provider = StooqZipPriceProvider()

    assert provider.archive_path == project_archive_path
