# Presupuesto por subtipología

El modelo de costos muestra una subtipología a la vez. La cantidad estimada de cada material incluye sus contribuciones generales y las cantidades resueltas de esa subtipología.

Cada material permite elegir una cantidad estimada, histórica o manual. El orden inicial usa el costo estimado. El orden por impacto histórico usa el valor absoluto de la diferencia entre el costo de la referencia y el presupuesto actual, por vivienda. Los totales incluyen todos los materiales de la subtipología, aunque la tabla esté filtrada.

## Referencia histórica

`POST /api/v1/projects/{project_id}/cost-model/history` recibe `subtype_id`, `start_date` y `end_date`.

Las viviendas iniciadas se identifican mediante sus vínculos individuales con el proyecto y la subtipología. Los movimientos de materiales son compartidos. La referencia aplica este reparto por SKU:

`cantidad estimada por vivienda × consumo del período ÷ cantidad estimada de todas las viviendas iniciadas`

El reparto usa el presupuesto original, sin los ajustes del modelo de costos. No representa consumo medido por subtipología. Cambiar el período no modifica cantidades que el usuario ya guardó.

No se ofrece referencia si no hay viviendas de la subtipología seleccionada, o si más del 5% de las viviendas del período no están vinculadas. Bajo ese límite, el consumo de las viviendas sin vincular se reparte entre las vinculadas y la pantalla lo advierte: la referencia puede quedar levemente alta. Una cantidad sin definir bloquea el reparto de ese material. La ausencia de movimientos no se interpreta como consumo cero. La pantalla mantiene disponibles la estimación y la edición manual cuando el histórico no está disponible.

## Cantidades guardadas y Excel

`quantity_scope = scenario` indica una cantidad completa por vivienda. Reemplaza la suma general y específica del material. Los ajustes anteriores conservan `quantity_scope = component` y su interpretación original.

La elección `source_kind = estimated` vuelve a usar la estimación actual. La elección `historic_allocated` conserva la cantidad adoptada, las fechas, el número de viviendas, el consumo repartido y la explicación del cálculo en `source_note`.

Excel expresa los ajustes como diferencias respecto de las cantidades originales. Para un ajuste de escenario, también descuenta la contribución general vigente. Así, el subtotal de la subtipología coincide con la cantidad completa elegida.

## Migración

Antes de iniciar el backend actualizado, ejecuta `alembic upgrade head` desde `Backend`, con el entorno Python del proyecto.

La revisión `20260923_0018` agrega `quantity_scope` a `project_cost_model_adjustments`, con el valor inicial `component`. No cambia las cantidades existentes.

Si la base registra una revisión que no existe en el checkout, recupera primero la cadena de migraciones correspondiente. No uses `alembic stamp` para ocultar la diferencia.

## Verificación

Desde `Frontend`, ejecuta `pnpm test -- src/pages/costModel` y `pnpm typecheck`.

Desde `Backend`, ejecuta `python -m unittest tests.test_cost_model_history tests.test_cost_model_export_adjustments tests.test_effective_bom tests.test_house_type_links`.

Las pruebas de integración de `tests.test_services` requieren `SPEC_SHEETS_TEST_DATABASE_URL`. Debe apuntar a una base exclusiva para pruebas: su preparación elimina y vuelve a crear las tablas.

## Validación local del 23 de septiembre de 2026

Pasaron 14 pruebas del frontend, 33 pruebas del backend y 6 pruebas de integración en una base temporal. Una prueba adicional se omitió porque no tenía configurada su base de integración. La base temporal se eliminó al terminar. La revisión en navegador usó datos de prueba y cubrió selección de fuente, aislamiento de subtipologías, cantidad cero, filtros, orden por impacto, error de guardado y acceso de lectura.

El chequeo de tipos normal encuentra usos previos de `Array.at` en `materialDashboard/houseComparison.test.ts`, incompatibles con la biblioteca ES2020 configurada. `tsc --noEmit --lib ES2022,DOM,DOM.Iterable` pasó. La compilación con Vite pasó.

El ejecutable del entorno Python local no pudo iniciar su intérprete base. Las pruebas usaron el Python incluido con Codex y las bibliotecas del entorno del proyecto. El comando `pnpm` intentó reconstruir las dependencias y se detuvo por falta de terminal interactiva. Las verificaciones se ejecutaron directamente con Node y las dependencias instaladas, con acceso fuera del sandbox debido a sus permisos de lectura.

La base local registra `20260824_0018`, una revisión ausente de este checkout. Tras confirmar el error `UndefinedColumn` al abrir el proyecto 10, se agregó únicamente `quantity_scope VARCHAR(20) DEFAULT 'component' NOT NULL` mediante una transacción con límites de espera. Se conservó el marcador de Alembic. La consulta del modelo de costos del proyecto 10 volvió a cargar sus 406 filas.

La migración verifica si esa columna ya existe y coincide con el esquema esperado, para permitir una actualización posterior sin intentar agregarla otra vez. Se comprobaron la primera ejecución, la repetición y la conservación de cantidades existentes en una base temporal en memoria. Todavía hace falta recuperar la revisión ausente para reconciliar la cadena completa de migraciones.
