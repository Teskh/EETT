"""Show or refresh the stored copy of ERP withdrawals.

The app keeps it current on its own (see app/services/erp_history.py); this is
for checking on it, or forcing a full re-check outside the nightly schedule.

    python scripts/sync_erp_history.py            # status
    python scripts/sync_erp_history.py --full     # re-fetch the whole window now
"""

from __future__ import annotations

import argparse
import json
import logging
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
BACKEND_DIR = REPO_ROOT / "Backend"
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from app.config import Settings
from app.database import create_session_factory
from app.services import erp_history


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--full", action="store_true", help="Re-fetch the whole history window now, paced like the nightly sync.")
    args = parser.parse_args()

    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(message)s")
    settings = Settings()
    session_factory = create_session_factory(
        settings.database_url,
        connect_timeout_seconds=settings.database_connect_timeout_seconds,
        statement_timeout_ms=settings.database_statement_timeout_ms,
    )
    if args.full:
        stored = erp_history.run_full_resync(settings, session_factory)
        print(f"Stored {stored} withdrawal documents.")
    with session_factory() as session:
        print(json.dumps(erp_history.get_sync_status(session), indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
