# Presupuesto por subtipología

El modelo de costos muestra una subtipología a la vez. La cantidad estimada de cada material incluye sus contribuciones generales y las cantidades resueltas de esa subtipología.

Cada material permite elegir una cantidad estimada, histórica o manual. El orden inicial usa el costo estimado. El orden por impacto histórico usa el valor absoluto de la diferencia entre el costo de la referencia y el presupuesto actual, por vivienda. Los totales incluyen todos los materiales de la subtipología, aunque la tabla esté filtrada.

## Referencia histórica

`POST /api/v1/projects/{project_id}/cost-model/study` recibe `start_date` y `end_date`. Devuelve, para cada material del proyecto, la cantidad histórica por vivienda de cada subtipología, su confianza y una sugerencia. También devuelve el consumo fuera de presupuesto del período. El cálculo está en `app/services/consumption_study.py` (funciones puras) y `app/services/cost_model_study.py` (carga de datos).

### Modelo

Las salidas de bodega no identifican la vivienda. Por eso se comparan las salidas de cada material en el período con el consumo esperado de todas las viviendas cuyo consumo cae en el período:

`razón = salidas del período ÷ consumo esperado en el período`

La cantidad histórica de cada subtipología es su cantidad estimada multiplicada por la razón del proyecto. La mezcla de viviendas es implícita: son las viviendas que se iniciaron en el período. El reparto usa el presupuesto original, sin los ajustes del modelo de costos. Cambiar el período no modifica cantidades que el usuario ya guardó.

Una vivienda no consume todo en la semana de inicio. Hay dos flujos:

- Fábrica: 65% la semana de inicio, 30% la siguiente y 5% la subsiguiente. Se ajustó con los cierres de Sol de Quillón y Jardines de San Pedro, donde las salidas cayeron a la mitad la semana siguiente al último inicio.
- Obra (área 11): se reparte entre las semanas 5 y 26 después del inicio. Las salidas de obra de Jardines de San Pedro siguieron seis meses después del último inicio.

Cada material reparte su cantidad entre ambos flujos según su propio historial de salidas.

Cuando otros proyectos comparten el período, la razón supone que todos se desvían igual. Si la mezcla cambió lo suficiente durante el período, se separa la razón del proyecto de la del resto con mínimos cuadrados sobre bloques de dos semanas. En las transiciones de Jardines de San Pedro y Los Escritores, separar redujo el error de 12,6% a 9,1% y de 16% a 10%. En Sol de Quillón no cambió.

Una cantidad sin definir en algún presupuesto del período anula la referencia de ese material. La ausencia de salidas no se interpreta como consumo cero.

### Confianza y sugerencia

Cada material se califica como alta, media o baja según estas señales:

| Señal | Qué detecta |
| --- | --- |
| Seguimiento | Distancia máxima entre las curvas acumuladas de salidas y de consumo esperado. |
| Semanas con salidas | Retiros en bloque, por ejemplo mensuales. |
| Sensibilidad a los bordes | Cambio de la razón al quitar dos semanas al inicio o al final. |
| Cambio de nivel | La razón antes y después del mejor punto de corte. Un quiebre suele indicar un reemplazo. |
| Flujo de obra | Materiales que se retiran meses después del inicio. |
| Muestra | Viviendas del proyecto y su participación en la producción. |

Los umbrales se calibraron con una prueba retrospectiva. Cada campaña limpia (Jardines de San Pedro, Sol de Quillón y Los Escritores) se dividió en dos mitades, y se comparó la razón de la primera con la de la segunda. Error mediano entre mitades: alta 9%, media 21%, baja 57%.

Se sugiere la histórica cuando la diferencia con la estimación supera 10% y la confianza es alta. Con confianza media se marca "por revisar". Con confianza baja se mantiene la estimación. "Aplicar sugerencias" solo adopta las sugeridas, tras una confirmación.

### Período sugerido

`GET /api/v1/projects/{project_id}/cost-model/timeline` devuelve las viviendas iniciadas por semana de cada proyecto y subtipología, y un período sugerido. El período sugerido es el tramo continuo en que el proyecto domina la producción: cada semana suma sus viviendas y resta la mitad de las de otros proyectos. Se omiten las primeras semanas del registro de producción, porque faltan viviendas anteriores que aún consumían. La pantalla usa el período sugerido si el usuario no eligió otro. El período elegido se recuerda por proyecto en el navegador.

### Consumo fuera de presupuesto

Son los retiros de materiales que no están en el presupuesto del proyecto y que los presupuestos de las demás viviendas del período no explican. Con un buen filtro de centros de costo no deberían existir: son consumibles no presupuestados o equivalentes que reemplazan a un material presupuestado. Un material que otro proyecto presupuesta también aparece si su consumo excede con creces lo que ese proyecto explica. Por ejemplo, el MDP de Jardines de San Pedro coincidió con una sola vivienda de Sol de Quillón, que presupuesta MDP. Solo se lista el exceso no explicado. Se valoriza con el costo de línea del ERP (`TotLinea`) y se reparte entre todas las viviendas que consumían.

Un material presupuestado se propone como reemplazado por una de estas dos evidencias:

- Cambio: el material presupuestado casi dejó de retirarse (queda en 35% o menos de su nivel) y el otro material empezó dentro de tres semanas. Deben ser de la misma familia y de la misma unidad, con montos por vivienda dentro de 2 veces. Así se detecta el reemplazo del piso OSB Top Notch (`PLAC0003`) por MDP 18 mm (`PLAC0075`) en Jardines de San Pedro, desde la semana del 17 de noviembre de 2025. También se informa cuánto usa una vivienda desde el cambio: unas 11,4 planchas de MDP.
- Nombre: los nombres comparten palabras y los montos están dentro de 3 veces.

Cada material presupuestado se asocia como máximo a un reemplazo, el más parecido en monto. No se proponen reemplazos de menos de $2.000 por vivienda. El ritmo semanal parecido no es evidencia, porque en producción constante todos los materiales se mueven juntos.

Con estas reglas quedan entre 4 y 11 reemplazos posibles por proyecto. La mayoría son plausibles, como códigos nuevos del mismo producto o cambios de proveedor, pero algunos no. Por eso se presentan para confirmar y no se aplican solos.

### Centros de costo excluidos

`GET` y `PUT /api/v1/cost-model/ceco-exclusions` administran una política única para todos los proyectos. Las reglas pueden ser de tres tipos:

- un área: `06`;
- un sitio en cualquier área: `*-34`;
- un centro exacto: `04-16-16`.

Las reglas predeterminadas excluyen por tema (área), nunca por sitio: los centros de costo se imputan mal con frecuencia, y un sitio con un nombre poco claro puede ser de una vivienda. Salen de las salidas de septiembre de 2025 a septiembre de 2026:

- Áreas cuyas salidas casi no son materiales de algún presupuesto: Prevención 0%, Logística 1%, Administración 10%, Urbanización 32% y Mantención 36%. Las áreas de producción rondan 92–96%.
- Postventa, porque repara viviendas ya entregadas, y Obra, porque es instalación en terreno meses después.

Un material que se retira principalmente (más de 50%) por centros excluidos queda sin referencia histórica: lo que queda no representa su consumo. Con Obra excluida, esto pasa con 8 a 61 materiales por proyecto.

Mientras la migración no se aplique, se usan las reglas predeterminadas y no se pueden editar.

### Base de cantidad: fábrica, obra o ambas

La página elige qué cantidad del BOM presupuesta: `factory` (Q_fábrica, por defecto), `work` (Q_obra) o `total` (Q_fábrica + Q_obra). Todos los endpoints del modelo de costos reciben `?basis=`, y el esperado del estudio usa la misma cantidad.

- Q_fábrica vacía es una cantidad faltante. Q_obra vacía significa que no se instala nada en terreno: vale cero. Con `work`, el presupuesto solo muestra los materiales con Q_obra.
- Cada base tiene su lista de centros excluidos, sus ajustes y sus decisiones sobre materiales fuera del presupuesto. Las listas iniciales (revisión `20260927_0021`) son:
  - `factory`: la lista anterior, que excluye 11 Obra.
  - `work`: solo cuenta Obra. Excluye lo mismo que `factory` salvo 11, y además las áreas de fábrica: 01 Preparación de materiales, 02 Paneles, 03 Armado, 04 Terminaciones y 13 Maestranza.
  - `total`: lo mismo que `factory`, pero sin excluir 11 Obra.
- El histórico de Obra es menos confiable. La obra ocurre meses después del inicio en fábrica, que es la fecha con que el estudio reparte el consumo, y sus centros son por sitio (11-41-41 es Sol de Quillón; 11-16-16, Jardines). Conviene preferir la estimada o un período desplazado.
- El gráfico de un grupo usa el esperado del Material Dashboard, que sigue Q_fábrica. Con otra base muestra solo retiros, y la comparación válida es la del resumen del grupo.

### Materiales fuera del presupuesto como líneas

`GET /api/v1/projects/{project_id}/cost-model/extras` devuelve el criterio del proyecto y sus decisiones. `PUT .../extras/default` fija el criterio: `include` (se cuentan salvo que se excluyan) o `exclude` (se muestran, pero solo cuentan si se incluyen). `PUT .../extras` guarda una decisión por material y `DELETE .../extras/{sku}` la borra.

Las líneas incluidas suman al presupuesto por vivienda de todas las subtipologías. Su cantidad sigue el período consultado, salvo que esté fija. Cada material indica el centro de costo del que más salió, para detectar imputaciones de otros sitios.

"Adoptar reemplazo" hace dos cosas. Incluye el material nuevo con cantidad fija, la que usa una vivienda desde el cambio. Y deja el material anterior, en todas las subtipologías, en su nivel posterior al cambio, como cantidad manual con una nota. El material anterior sigue en el presupuesto técnico, así que el historial de las viviendas previas no se pierde.

El Excel agrega la hoja "Fuera de presupuesto" con las líneas incluidas que envía la pantalla, porque dependen del período mostrado.

## Cantidades guardadas y Excel

`quantity_scope = scenario` indica una cantidad completa por vivienda. Reemplaza la suma general y específica del material. Los ajustes anteriores conservan `quantity_scope = component` y su interpretación original.

La elección `source_kind = estimated` vuelve a usar la estimación actual. La elección `historic_allocated` conserva la cantidad adoptada, las fechas, el número de viviendas, el consumo repartido y la explicación del cálculo en `source_note`.

Excel expresa los ajustes como diferencias respecto de las cantidades originales. Para un ajuste de escenario, también descuenta la contribución general vigente. Así, el subtotal de la subtipología coincide con la cantidad completa elegida.

## Migración

Antes de iniciar el backend actualizado, ejecuta `alembic upgrade head` desde `Backend`, con el entorno Python del proyecto.

- La revisión `20260824_0018` no cambia el esquema. Producción registra ese identificador, pero su archivo nunca llegó al repositorio, y su esquema coincide con `20260813_0017`. Esta revisión puente permite ejecutar `alembic upgrade head` en bases sincronizadas desde producción.
- La revisión `20260923_0018` agrega `quantity_scope` a `project_cost_model_adjustments`, con el valor inicial `component`. No cambia las cantidades existentes.
- La revisión `20260924_0019` crea `consumption_ceco_exclusions`, con las 16 reglas predeterminadas por área. También crea `project_cost_model_extras` y `project_cost_model_settings`.
- La revisión `20260927_0021` agrega la base de cantidad (`basis` en `consumption_ceco_exclusions`, `quantity_basis` en ajustes y decisiones fuera del presupuesto). Lo existente queda como `factory`, y siembra las listas de `work` y `total`.

Si la base registra una revisión que no existe en el checkout, recupera primero la cadena de migraciones correspondiente. No uses `alembic stamp` para ocultar la diferencia.

## Verificación

Desde `Frontend`, ejecuta `pnpm test -- src/pages/costModel` y `pnpm typecheck`.

Desde `Backend`, ejecuta `python -m unittest tests.test_consumption_study tests.test_cost_model_export_adjustments tests.test_effective_bom tests.test_house_type_links`.

Las pruebas de integración de `tests.test_services` requieren `SPEC_SHEETS_TEST_DATABASE_URL`. Debe apuntar a una base exclusiva para pruebas: su preparación elimina y vuelve a crear las tablas.

## Validación local del 23 de septiembre de 2026

Pasaron 14 pruebas del frontend, 33 pruebas del backend y 6 pruebas de integración en una base temporal. Una prueba adicional se omitió porque no tenía configurada su base de integración. La base temporal se eliminó al terminar. La revisión en navegador usó datos de prueba y cubrió selección de fuente, aislamiento de subtipologías, cantidad cero, filtros, orden por impacto, error de guardado y acceso de lectura.

El chequeo de tipos normal encuentra usos previos de `Array.at` en `materialDashboard/houseComparison.test.ts`, incompatibles con la biblioteca ES2020 configurada. `tsc --noEmit --lib ES2022,DOM,DOM.Iterable` pasó. La compilación con Vite pasó.

El ejecutable del entorno Python local no pudo iniciar su intérprete base. Las pruebas usaron el Python incluido con Codex y las bibliotecas del entorno del proyecto. El comando `pnpm` intentó reconstruir las dependencias y se detuvo por falta de terminal interactiva. Las verificaciones se ejecutaron directamente con Node y las dependencias instaladas, con acceso fuera del sandbox debido a sus permisos de lectura.

La base local registra `20260824_0018`, una revisión ausente de este checkout. Tras confirmar el error `UndefinedColumn` al abrir el proyecto 10, se agregó únicamente `quantity_scope VARCHAR(20) DEFAULT 'component' NOT NULL` mediante una transacción con límites de espera. Se conservó el marcador de Alembic. La consulta del modelo de costos del proyecto 10 volvió a cargar sus 406 filas.

La migración verifica si esa columna ya existe y coincide con el esquema esperado, para permitir una actualización posterior sin intentar agregarla otra vez. Se comprobaron la primera ejecución, la repetición y la conservación de cantidades existentes en una base temporal en memoria.

El 25 de septiembre de 2026 se agregó la revisión puente `20260824_0018`, sin cambios de esquema, antes de `20260923_0018`. Una base recién sincronizada desde producción tenía tablas y columnas idénticas a `20260813_0017`. Con la revisión puente, `alembic upgrade head` aplicó `20260923_0018` y `20260924_0019` sin usar `alembic stamp`. Después, el esquema coincidió con los modelos.

## Validación del estudio histórico, 24 de septiembre de 2026

Con datos reales, las 16 reglas por área y el período sugerido:

| Proyecto | Período sugerido | Viviendas (participación) | Confianza alta / media / baja / sin referencia | Sugeridas / por revisar | Fuera de BOM por vivienda |
| --- | --- | --- | --- | --- | --- |
| Jardines de San Pedro | 22-09-2025 a 12-12-2025 | 106 (96%) | 83 / 75 / 103 / 69 | 46 / 68 | $1.392.868 |
| Nuevo Sol de Quillón | 15-12-2025 a 24-04-2026 | 188 (98%) | 76 / 54 / 65 / 84 | 35 / 43 | $1.823.399 |
| Condominio Now | 20-07-2026 a 18-09-2026 | 56 (59%) | 17 / 80 / 62 / 46 | 9 / 50 | $804.731 |
| Laguna Townhouse Padre Hurtado | 13-07-2026 a 04-09-2026 | 32 (41%) | 14 / 136 / 126 / 103 | 12 / 106 | $1.030.060 |

Sin exclusiones por sitio, el consumo fuera de BOM casi se duplica. En Jardines de San Pedro, 79% de ese valor salió de sus propios centros de costo. En Now, cerca de la mitad salió de otros sitios, como Pinamar (19%), FG Chiguayante (12%) y Quilaco (8%). Por eso cada material muestra su centro de costo principal y se puede excluir a mano.

Los proyectos que se produjeron casi solos obtienen muchas más referencias confiables. En Now y Padre Hurtado, que se produjeron a la vez, la mayoría queda por revisar.

Algunos reemplazos detectados:

- Sol de Quillón: puertas `PUER0145` en lugar de `PUER0144`, y `PUER0141` en lugar de `PUER0140`.
- Padre Hurtado: cubierta `HOJL0038` en lugar de `HOJL0072`.

Un estudio tarda alrededor de un segundo con las salidas en caché (dos horas en la base y diez minutos en memoria). La primera consulta después de que vence la caché lee el ERP.

Pasaron 17 pruebas del estudio (`tests.test_consumption_study`), las de exportación, las pruebas de integración del modelo de costos en una base temporal (ya eliminada) y la migración `20260924_0019` en ambos sentidos. Del frontend pasaron 54 pruebas y la compilación. No se revisó la pantalla en el navegador.

El conjunto completo de integración tiene 45 fallas previas, ajenas a este cambio: parchean funciones que ya no existen o que se importan dentro de otras funciones. Además, `alembic upgrade head` desde una base vacía falla en una migración antigua (`component_material_rules.notes`).
