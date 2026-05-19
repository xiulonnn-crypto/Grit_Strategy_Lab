from __future__ import annotations

import zipfile
from datetime import date
from io import BytesIO
import json

from grit_backtest_platform import stooq_provider as stooq_provider_module
from grit_backtest_platform.fallback_provider import ProviderExecutionSignal
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


def test_stooq_online_fallback_is_disabled_by_default(monkeypatch, tmp_path):
    missing_archive = tmp_path / "missing.zip"
    monkeypatch.setenv("GRIT_STOOQ_US_DAILY_ZIP", str(missing_archive))
    monkeypatch.delenv("GRIT_ENABLE_STOOQ_ONLINE", raising=False)

    provider = StooqZipPriceProvider()

    assert provider.availability().available is False
    try:
        provider.fetch_history("AAPL", date(2026, 4, 1), date(2026, 4, 2))
    except ProviderExecutionSignal as exc:
        assert exc.reason == "offline_archive_unavailable"
    else:
        raise AssertionError("Expected offline_archive_unavailable when online fallback is disabled.")


def test_stooq_online_fallback_fetches_csv_and_writes_manifest(monkeypatch, tmp_path):
    missing_archive = tmp_path / "missing.zip"
    cache_dir = tmp_path / "stooq-cache"
    requested_urls: list[str] = []

    class _Response(BytesIO):
        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc, tb):
            return False

    def fake_urlopen(url, timeout=20):
        requested_urls.append(str(url))
        return _Response(
            "\n".join(
                [
                    "Date,Open,High,Low,Close,Volume",
                    "2026-04-01,100,101,99,100.5,1000",
                    "2026-04-02,101,102,100,101.5,1200",
                ]
            ).encode("utf-8")
        )

    monkeypatch.setenv("GRIT_STOOQ_US_DAILY_ZIP", str(missing_archive))
    monkeypatch.setenv("GRIT_ENABLE_STOOQ_ONLINE", "1")
    monkeypatch.setenv("GRIT_STOOQ_ONLINE_CACHE_DIR", str(cache_dir))
    monkeypatch.setattr(stooq_provider_module.urllib.request, "urlopen", fake_urlopen)

    provider = StooqZipPriceProvider()
    result = provider.fetch_history("AAPL", date(2026, 4, 1), date(2026, 4, 2))

    assert provider.availability().available is True
    assert requested_urls == ["https://stooq.com/q/d/l/?s=AAPL.US&i=d"]
    assert result.source == "stooq"
    assert result.metadata["mode"] == "online_csv"
    assert result.metadata["provider_symbol"] == "AAPL.US"
    assert len(result.bars) == 2
    manifest = json.loads((cache_dir / "manifest.json").read_text(encoding="utf-8"))
    assert manifest["entries"]["AAPL"]["status"] == "READY"
    assert manifest["entries"]["AAPL"]["row_count"] == 2
    assert (cache_dir / "AAPL.csv").is_file()


def test_stooq_online_fallback_runs_when_archive_misses_symbol(monkeypatch, tmp_path):
    archive_path = tmp_path / "d_us_txt.zip"
    cache_dir = tmp_path / "stooq-cache"
    with zipfile.ZipFile(archive_path, "w") as archive:
        archive.writestr(
            "data/daily/us/nasdaq stocks/1/aapl.us.txt",
            "\n".join(
                [
                    "<TICKER>,<PER>,<DATE>,<TIME>,<OPEN>,<HIGH>,<LOW>,<CLOSE>,<VOL>,<OPENINT>",
                    "AAPL.US,D,20260401,000000,100,101,99,100.5,1000,0",
                ]
            ),
        )

    class _Response(BytesIO):
        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc, tb):
            return False

    monkeypatch.setenv("GRIT_STOOQ_US_DAILY_ZIP", str(archive_path))
    monkeypatch.setenv("GRIT_ENABLE_STOOQ_ONLINE", "1")
    monkeypatch.setenv("GRIT_STOOQ_ONLINE_CACHE_DIR", str(cache_dir))
    monkeypatch.setattr(
        stooq_provider_module.urllib.request,
        "urlopen",
        lambda url, timeout=20: _Response(
            "\n".join(
                [
                    "Date,Open,High,Low,Close,Volume",
                    "2026-04-01,20,21,19,20.5,2000",
                ]
            ).encode("utf-8")
        ),
    )

    result = StooqZipPriceProvider().fetch_history("ABGX", date(2026, 4, 1), date(2026, 4, 1))

    assert len(result.bars) == 1
    assert result.fallback_source == "stooq_offline_zip"
    assert result.metadata["mode"] == "online_csv_after_offline_miss"
    assert result.metadata["offline_fallback_reason"] == "symbol_invalid"
    assert result.warnings[0] == "Stooq offline ZIP fallback: symbol_invalid."


def test_stooq_online_fallback_classifies_empty_csv(monkeypatch, tmp_path):
    missing_archive = tmp_path / "missing.zip"
    cache_dir = tmp_path / "stooq-cache"

    class _Response(BytesIO):
        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc, tb):
            return False

    monkeypatch.setenv("GRIT_STOOQ_US_DAILY_ZIP", str(missing_archive))
    monkeypatch.setenv("GRIT_ENABLE_STOOQ_ONLINE", "1")
    monkeypatch.setenv("GRIT_STOOQ_ONLINE_CACHE_DIR", str(cache_dir))
    monkeypatch.setattr(
        stooq_provider_module.urllib.request,
        "urlopen",
        lambda url, timeout=20: _Response(b"Date,Open,High,Low,Close,Volume\n"),
    )

    provider = StooqZipPriceProvider()

    try:
        provider.fetch_history("BRK.B", date(2026, 4, 1), date(2026, 4, 2))
    except ProviderExecutionSignal as exc:
        assert exc.reason == "empty_response"
    else:
        raise AssertionError("Expected empty_response for empty Stooq CSV.")
    manifest = json.loads((cache_dir / "manifest.json").read_text(encoding="utf-8"))
    assert manifest["entries"]["BRK.B"]["provider_symbol"] == "BRK-B.US"
    assert manifest["entries"]["BRK.B"]["status"] == "NO_ROWS"
