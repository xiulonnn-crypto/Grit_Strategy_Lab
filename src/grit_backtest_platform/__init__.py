from __future__ import annotations

import importlib
import sys


_RESTORED_SUBMODULES = {
    "storage": "._storage_restored",
    "creation_templates": "._creation_templates_rebuilt",
    "market_data_repository": "._market_data_repository_restored",
    "backtest_engine": "._backtest_engine_restored",
    "backtest_metrics": "._backtest_metrics_restored",
    "service": "._service_rebuilt",
    "real_service": "._real_service_rebuilt",
}


for _public_name, _restored_path in _RESTORED_SUBMODULES.items():
    _fq_name = f"{__name__}.{_public_name}"
    if _fq_name not in sys.modules:
        sys.modules[_fq_name] = importlib.import_module(_restored_path, __name__)
    setattr(sys.modules[__name__], _public_name, sys.modules[_fq_name])


__all__ = []
