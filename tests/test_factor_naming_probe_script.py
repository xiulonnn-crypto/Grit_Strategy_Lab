from __future__ import annotations

import json
import sqlite3
import subprocess
import sys
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path


def _create_probe_db(path: Path, *, factor_id: str, display_name: str) -> None:
    conn = sqlite3.connect(path)
    try:
        conn.executescript(
            """
            CREATE TABLE factor_definitions (
                id TEXT PRIMARY KEY,
                name TEXT,
                source TEXT,
                lifecycle_status TEXT,
                diagnostic_status TEXT,
                frequency TEXT,
                expression TEXT,
                deleted_at TEXT
            );
            CREATE TABLE factor_versions (
                id TEXT PRIMARY KEY,
                factor_id TEXT,
                version INTEGER,
                expression TEXT,
                status TEXT,
                metadata_json TEXT,
                created_at TEXT
            );
            CREATE TABLE factor_lineage_edges (
                source_type TEXT,
                source_id TEXT,
                target_type TEXT,
                target_id TEXT,
                relation_type TEXT,
                metadata_json TEXT,
                created_at TEXT
            );
            """
        )
        conn.execute(
            """
            INSERT INTO factor_definitions (
                id, name, source, lifecycle_status, diagnostic_status, frequency,
                expression, deleted_at
            )
            VALUES (?, ?, 'PUBLIC_FACTOR_IMPORT', 'VERIFIED', 'COMPLETED', 'DAILY', 'ExternalFactor(demo)', NULL)
            """,
            (factor_id, display_name),
        )
        conn.execute(
            """
            INSERT INTO factor_versions (
                id, factor_id, version, expression, status, metadata_json, created_at
            )
            VALUES (?, ?, 1, 'ExternalFactor(demo)', 'ACTIVE', ?, '2026-05-26T00:00:00Z')
            """,
            (
                f"{factor_id}-v1",
                factor_id,
                json.dumps(
                    {
                        "publish_naming_rule": "external_factor_import_projection",
                        "publish_metadata": {
                            "display_name_cn": display_name,
                            "base_display_name_cn": display_name,
                            "name_audit": {
                                "structured_components": {
                                    "style_family": "[External]",
                                    "core_semantic": "Demo external factor",
                                    "governance_tag": "Raw",
                                }
                            },
                        },
                    }
                ),
            ),
        )
        conn.execute(
            """
            INSERT INTO factor_lineage_edges (
                source_type, source_id, target_type, target_id, relation_type,
                metadata_json, created_at
            )
            VALUES ('factor', 'external:demo', 'factor', ?, 'DERIVED_FROM', '{}', '2026-05-26T00:00:00Z')
            """,
            (factor_id,),
        )
        conn.commit()
    finally:
        conn.close()


class _ProbeHandler(BaseHTTPRequestHandler):
    factor_id = ""
    display_name = ""

    def do_GET(self) -> None:  # noqa: N802
        if self.path.startswith("/factor-factory/overview"):
            payload = {
                "publishable_factors": [
                    {
                        "candidate_id": "fq_demo",
                        "factor_id": self.factor_id,
                        "display_name_cn": self.display_name,
                        "base_display_name_cn": self.display_name,
                    }
                ]
            }
        elif self.path.startswith("/factors?"):
            payload = {
                "items": [
                    {
                        "id": self.factor_id,
                        "name": self.display_name,
                        "display_name_cn": self.display_name,
                        "base_display_name_cn": self.display_name,
                        "name_audit": {
                            "structured_components": {
                                "style_family": "[External]",
                                "core_semantic": "Demo external factor",
                                "governance_tag": "Raw",
                            }
                        },
                    }
                ]
            }
        elif self.path.startswith(f"/factors/{self.factor_id}"):
            payload = {
                "id": self.factor_id,
                "name": self.display_name,
                "display_name_cn": self.display_name,
                "base_display_name_cn": self.display_name,
                "name_audit": {
                    "structured_components": {
                        "style_family": "[External]",
                        "core_semantic": "Demo external factor",
                        "governance_tag": "Raw",
                    }
                },
            }
        else:
            self.send_response(404)
            self.end_headers()
            return
        data = json.dumps(payload).encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def log_message(self, format: str, *args: object) -> None:
        return


class _FactoryOnlyProbeHandler(BaseHTTPRequestHandler):
    factor_id = ""
    display_name = ""

    def do_GET(self) -> None:  # noqa: N802
        if self.path.startswith("/factor-factory/overview"):
            payload = {
                "external_import_quarantine": {
                    "items": [
                        {
                            "id": "fq_demo",
                            "target_factor_id": self.factor_id,
                            "display_name_cn": self.display_name,
                            "base_display_name_cn": self.display_name,
                        }
                    ]
                }
            }
        elif self.path.startswith("/factors?"):
            payload = {"items": []}
        elif self.path.startswith(f"/factors/{self.factor_id}"):
            self.send_response(404)
            self.end_headers()
            return
        else:
            self.send_response(404)
            self.end_headers()
            return
        data = json.dumps(payload).encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def log_message(self, format: str, *args: object) -> None:
        return


def test_factor_naming_probe_compares_four_surfaces(tmp_path: Path) -> None:
    factor_id = "s_f2_external_demo"
    display_name = "[External] Demo Factor (Daily) [Raw]"
    db_path = tmp_path / "probe.sqlite3"
    _create_probe_db(db_path, factor_id=factor_id, display_name=display_name)

    handler = type(
        "ProbeHandler",
        (_ProbeHandler,),
        {"factor_id": factor_id, "display_name": display_name},
    )
    server = ThreadingHTTPServer(("127.0.0.1", 0), handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        out_path = tmp_path / "probe.json"
        trace_path = tmp_path / "trace.md"
        completed = subprocess.run(
            [
                sys.executable,
                "scripts/factor_naming_probe.py",
                "--factor-id",
                factor_id,
                "--db",
                str(db_path),
                "--api-base",
                f"http://127.0.0.1:{server.server_port}",
                "--expected-name",
                display_name,
                "--reject-name",
                "EXTERNALDEMO",
                "--out",
                str(out_path),
                "--trace-matrix",
                str(trace_path),
                "--strict",
            ],
            cwd=Path(__file__).resolve().parents[1],
            text=True,
            capture_output=True,
            check=False,
        )
    finally:
        server.shutdown()
        thread.join(timeout=5)

    assert completed.returncode == 0, completed.stderr + completed.stdout
    payload = json.loads(out_path.read_text(encoding="utf-8"))
    assert payload["status"] == "OK"
    assert payload["factory_overview"]["match_count"] == 1
    assert payload["factor_list"]["matched_projection"]["display_name_cn"] == display_name
    assert payload["factor_detail"]["projection"]["display_name_cn"] == display_name
    assert "Result:" in trace_path.read_text(encoding="utf-8")


def test_factor_naming_probe_accepts_factory_only_candidates(tmp_path: Path) -> None:
    factor_id = "s_f2_external_candidate_only"
    display_name = "[External] Candidate Only (Monthly) [Refined]"
    db_path = tmp_path / "missing.sqlite3"

    handler = type(
        "FactoryOnlyProbeHandler",
        (_FactoryOnlyProbeHandler,),
        {"factor_id": factor_id, "display_name": display_name},
    )
    server = ThreadingHTTPServer(("127.0.0.1", 0), handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        out_path = tmp_path / "factory-only-probe.json"
        trace_path = tmp_path / "factory-only-trace.md"
        completed = subprocess.run(
            [
                sys.executable,
                "scripts/factor_naming_probe.py",
                "--factor-id",
                factor_id,
                "--db",
                str(db_path),
                "--api-base",
                f"http://127.0.0.1:{server.server_port}",
                "--expected-name",
                display_name,
                "--reject-name",
                "Wrong Candidate Name",
                "--acceptance-surface",
                "factory",
                "--out",
                str(out_path),
                "--trace-matrix",
                str(trace_path),
                "--strict",
            ],
            cwd=Path(__file__).resolve().parents[1],
            text=True,
            capture_output=True,
            check=False,
        )
    finally:
        server.shutdown()
        thread.join(timeout=5)

    assert completed.returncode == 0, completed.stderr + completed.stdout
    payload = json.loads(out_path.read_text(encoding="utf-8"))
    assert payload["status"] == "OK"
    assert payload["acceptance_surface"] == "factory"
    assert payload["warnings"] == []
    assert payload["db"]["ok"] is False
    assert payload["factor_detail"]["status_code"] == 404
    assert payload["factory_overview"]["matched_projection"]["display_name_cn"] == display_name
    trace = trace_path.read_text(encoding="utf-8")
    assert "Acceptance surface: `factory`" in trace
    assert "OUT_OF_SCOPE" in trace
