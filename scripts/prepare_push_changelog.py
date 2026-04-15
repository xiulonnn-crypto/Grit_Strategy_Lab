from __future__ import annotations

import importlib.util
import sys
from pathlib import Path


def main() -> int:
    repo_root = Path(__file__).resolve().parents[1]
    workflow_path = repo_root / "src" / "grit_backtest_platform" / "release_workflow.py"
    spec = importlib.util.spec_from_file_location("grit_release_workflow", workflow_path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"Cannot load release workflow module from {workflow_path}")
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)

    return module.main()


if __name__ == "__main__":
    raise SystemExit(main())
