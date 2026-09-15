from __future__ import annotations

import json
import sys

sys.path.insert(0, "Backend")

from app.config import Settings
from app.services.erp import _open_connection


QUERY = """
SELECT TOP 80
    RTRIM(LTRIM(m.CodProd)) AS CodProd,
    MAX(RTRIM(LTRIM(p.DesProd))) AS DesProd,
    MAX(RTRIM(LTRIM(COALESCE(p.DesProd2, '')))) AS DesProd2,
    MAX(RTRIM(LTRIM(COALESCE(p.CodUMed, '')))) AS CodUMed,
    CAST(SUM(m.CantIngresada) AS decimal(18, 2)) AS Cantidad,
    CAST(SUM(m.TotLinea) AS decimal(18, 0)) AS GastoNeto,
    CAST(SUM(m.TotLinea) / NULLIF(SUM(m.CantIngresada), 0) AS decimal(18, 2)) AS PrecioPond,
    CAST(MIN(NULLIF(m.PreUniMB, 0)) AS decimal(18, 2)) AS PrecioMin,
    CAST(MAX(m.PreUniMB) AS decimal(18, 2)) AS PrecioMax,
    COUNT(DISTINCT h.CodAux) AS Proveedores,
    COUNT(*) AS Lineas,
    CONVERT(date, MIN(h.Fecha)) AS Desde,
    CONVERT(date, MAX(h.Fecha)) AS Hasta
FROM softland.iw_gsaen h
INNER JOIN softland.iw_gmovi m
    ON m.Tipo = h.Tipo AND m.NroInt = h.NroInt
LEFT JOIN softland.iw_tprod p
    ON RTRIM(LTRIM(p.CodProd)) = RTRIM(LTRIM(m.CodProd))
WHERE h.Tipo = 'E'
  AND h.Estado = 'V'
  AND h.Concepto IN ('01', '02')
  AND h.Fecha >= DATEADD(month, -3, CONVERT(date, GETDATE()))
  AND m.CantIngresada > 0
  AND m.TotLinea > 0
GROUP BY RTRIM(LTRIM(m.CodProd))
ORDER BY SUM(m.TotLinea) DESC
"""


with _open_connection(Settings()) as connection:
    cursor = connection.cursor()
    cursor.execute(QUERY)
    names = [column[0] for column in cursor.description]
    candidates = [dict(zip(names, row)) for row in cursor.fetchall()]

print(json.dumps(candidates, default=str, ensure_ascii=False, indent=2))
