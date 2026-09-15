from __future__ import annotations

import json
import sys

sys.path.insert(0, "Backend")

from app.config import Settings
from app.services.erp import _open_connection


CODES = (
    "PLAC0004", "PLAC0078", "MADE0059", "MADE0081", "MADE0086",
    "ACER0201", "ACER0006", "ACER0007", "AISL0034", "MEMB0011",
    "FIJA0073", "VETI0033", "ARBA0105", "ARCO0065", "ELEC0810",
)
placeholders = ", ".join("?" for _ in CODES)
query = f"""
SELECT
    CONVERT(date, h.Fecha) AS Fecha,
    RTRIM(LTRIM(m.CodProd)) AS CodProd,
    RTRIM(LTRIM(COALESCE(h.NomAux, ''))) AS Proveedor,
    CAST(m.CantIngresada AS decimal(18, 2)) AS Cantidad,
    CAST(m.PreUniMB AS decimal(18, 2)) AS PrecioNeto,
    CAST(m.TotLinea AS decimal(18, 0)) AS TotalNeto
FROM softland.iw_gsaen h
INNER JOIN softland.iw_gmovi m
    ON m.Tipo = h.Tipo AND m.NroInt = h.NroInt
WHERE h.Tipo = 'E'
  AND h.Estado = 'V'
  AND h.Concepto IN ('01', '02')
  AND h.Fecha >= DATEADD(month, -3, CONVERT(date, GETDATE()))
  AND RTRIM(LTRIM(m.CodProd)) IN ({placeholders})
ORDER BY CodProd, h.Fecha
"""

with _open_connection(Settings()) as connection:
    cursor = connection.cursor()
    cursor.execute(query, CODES)
    names = [column[0] for column in cursor.description]
    rows = [dict(zip(names, row)) for row in cursor.fetchall()]

print(json.dumps(rows, default=str, ensure_ascii=False, indent=2))
