from __future__ import annotations

import json
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT / "Backend"))

from app.config import Settings
from app.services.erp import _open_connection


def main() -> None:
    settings = Settings()
    with _open_connection(settings) as connection:
        cursor = connection.cursor()
        cursor.execute(
            """
            SELECT TABLE_NAME, COLUMN_NAME, DATA_TYPE
            FROM INFORMATION_SCHEMA.COLUMNS
            WHERE TABLE_SCHEMA = 'softland'
              AND TABLE_NAME IN ('iw_gmovi', 'iw_gsaen', 'iw_tprod')
            ORDER BY TABLE_NAME, ORDINAL_POSITION
            """
        )
        columns = [
            {"table": row[0], "column": row[1], "type": row[2]}
            for row in cursor.fetchall()
        ]

        cursor.execute(
            """
            SELECT TOP 5
                CONVERT(date, h.Fecha) AS Fecha,
                RTRIM(LTRIM(m.CodProd)) AS CodProd,
                m.CantIngresada,
                m.PreUniMB,
                m.TotLinea,
                RTRIM(LTRIM(m.CodUMed)) AS CodUMed
            FROM softland.iw_gsaen h
            INNER JOIN softland.iw_gmovi m
                ON m.Tipo = h.Tipo AND m.NroInt = h.NroInt
            WHERE h.Tipo = 'E'
              AND h.Estado = 'V'
              AND h.Concepto IN ('01', '02')
              AND RTRIM(LTRIM(m.CodProd)) = 'PLAC0008'
            ORDER BY h.Fecha DESC
            """
        )
        sample = [list(row) for row in cursor.fetchall()]

    print(json.dumps({"columns": columns, "sample": sample}, default=str))


if __name__ == "__main__":
    main()
