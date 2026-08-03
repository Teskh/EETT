from __future__ import annotations

import json
import sys
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[1]
BACKEND_DIR = REPO_ROOT / "Backend"
RESULT_PATH = REPO_ROOT / "deployment" / "erp-probe.json"
sys.path.insert(0, str(BACKEND_DIR))

from app.config import Settings
from app.services.dashboard import get_material_dashboard_cost_centers


try:
    settings = Settings()
    result = get_material_dashboard_cost_centers(settings, force_refresh=True)
    payload = {"ok": True, "cost_center_count": len(result.get("cecos", []))}
except Exception as exc:
    payload = {"ok": False, "error_type": type(exc).__name__, "message": str(exc)}

RESULT_PATH.write_text(json.dumps(payload), encoding="utf-8")
raise SystemExit(0 if payload["ok"] else 1)
