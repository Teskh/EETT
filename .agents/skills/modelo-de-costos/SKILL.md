---
name: modelo-de-costos
description: Use when the user asks to use "Modelo de costos" (the cost model page) to estimate the cost of a house, house type or subtype (e.g. "costo de la Puelo Original", "UF/m2 de la Espejada", "¿cuánto cuesta esta vivienda?"), or to decide whether materials should use the historic or the estimated (BOM) quantity. Covers the tools to pull the budget, the historic consumption study and the materials outside the BOM; how to pick historic vs estimated; and, above all, how to search for complementary SKUs (substitutes, the other subtype's SKU, excluded cost centers) before settling on an answer.
---

# Estimating a house's cost with Modelo de costos

The cost of a house here is its **factory materials**: the BOM of its subtype
at ERP prices, corrected with the historic consumption where the data supports
it, plus the materials withdrawn for it that the BOM misses ("fuera de
presupuesto"). Labor, overhead and site work (CECO 11, Obra) are out of scope:
say so in every answer.

The page's **Cantidad** selector (`?basis=` in the API, `--basis` in the
snapshot script) picks the BOM quantity: `factory` (Q_fábrica, default),
`work` (Q_obra, site installation) or `total` (both). Each basis has its own
excluded cost centers, adjustments and decisions on materials outside the BOM,
so decisions made under one basis don't carry over. Answer with `factory`
unless the user asks for the installed house. Under `work`, history is weak:
site work happens months after the factory start the study aligns to, and Obra
cost centers are per site. Also check that Q_obra doesn't repeat Q_fábrica
(some SKUs hold the same value in both).

The hard part is not the arithmetic. It is judging which deviations between
BOM and consumption are real. **A material that looks over- or under-consumed
on its own is very often half of a pair**: its substitute, its other-hand
version in another subtype, or the same material withdrawn through an excluded
cost center. Look for that other half before deciding.

## Tools

Everything runs locally from `Backend/` with its venv against the local
database (`Settings().database_url`). On Windows set `PYTHONIOENCODING=utf-8`.

- **Snapshot (start here):** from `Backend/`, `venv/Scripts/python.exe ../.agents/skills/modelo-de-costos/scripts/cost_snapshot.py --project <id> [--subtypes 19,20] [--basis factory|work|total] [--start --end] --out <file>`
  prints per-subtype totals and writes every line (estimate, budget, historic,
  grade, reasons, excluded share, change point), the study, the materials
  outside the BOM with their decisions, and the material groups. It is
  read-only. Find project and subtype ids in the `projects` and
  `project_subtypes` tables. A production house type (e.g. "Puelo Original")
  maps to a project and subtype; `get_cost_model_timeline` lists the mapping.
- Services behind the page, for anything the snapshot lacks:
  `app/services/cost_model.py` (`get_cost_model_view`: BOM rows, prices,
  adjustments), `cost_model_study.py` (`get_cost_model_timeline`: suggested
  period; `get_cost_model_study`: historic ratio, grade, reasons and
  `quantity_per_house` per material, plus `unbudgeted` with detected
  `replaces`), `cost_model_extras.py` (decisions on materials outside the BOM),
  `material_groups.py` (groups of interchangeable SKUs, with a conversion
  factor to a common unit).
- The page's own rules live in `Frontend/src/pages/costModel/`: `budget.ts`
  (`suggest`: default criteria are high confidence, any deviation, impact
  ≥ $15.000 per house), `groupValidation.ts` (historic validated by a group,
  see below), `extras.ts` (materials outside the BOM: included by default).
- Writes (adjustments, extras decisions, groups) go through
  `upsert_cost_model_adjustments`, `upsert_cost_model_extra` and
  `create/update_material_study_group`. **Only write when the user asks.** Use
  `quantity_scope="scenario"`, one row per subtype, and a `source_note` that
  says why. The local database may be overwritten by a sync from production:
  mention it when you write.

## Process

1. **Scope.** Confirm project, subtypes and period. Use the suggested period
   (where the project dominates production) unless the user picks another. Note
   how many houses it covers and whether production distinguishes the subtypes
   (it often maps everything to one, e.g. all Puelo Original to "Normal").
2. **Snapshot.** Run the script. Check missing prices and quantities; zero
   quantities in the BOM for things obviously consumed (a roof at 0) are BOM
   gaps, not savings.
3. **Materials outside the BOM: include by default, justify each exclusion.**
   Exclude only with a concrete reason: another model's product (other
   project's cost center, 1–2 active weeks, sizes the house doesn't use), or
   plant supplies (Maestranza-Fábrica). Keep small miscellaneous consumables.
   Anything excluded is listed with its reason.
4. **Historic vs estimated, material by material.** Apply the page's rule
   (high confidence and impact ≥ $15.000). Then take the medium/low-confidence
   materials with a large impact and **search for complements** (next section)
   before deciding. Sort by |historic − estimate| × price.
5. **Totals.** Cost per house = BOM budget + included materials outside the
   BOM. UF/m² = cost / UF of the day / m² of the house. Get the UF from an
   official source (Banco Central, SII, mindicador.cl) and say which value and
   date you used. The database has no m²: ask the user or cite the source you
   used, e.g. the product page, and say it is the base (non-expanded) area.
6. **Report** in the user's language (Spanish here), brief: a totals table per
   subtype, the decisions that move the number, what is excluded and why, and
   pending BOM fixes. Separate the facts from your judgment calls.

## Searching for complements

For each material with a large deviation and medium/low confidence, find what
explains it, then decide by what the complement is:

| Complement | How to spot it | Decision |
|---|---|---|
| **A substitute in the plant** (dry pine for impregnated, MDP RH for P5, another panel size) | A `replaces` link in `unbudgeted`, a material group, same family by name or dimensions, a change point at the same week, opposite deviations | If the group (members at historic + included substitutes) matches the estimate in **cost** within ~10%: historic for **all** members, substitutes included. Never one side alone: that counts the material twice, or leaves it out. |
| **A switch with a date** | `signals.stability` shows `ratio_after` ≈ 0 and the substitute has `quantity_per_house_since` | Budget forward: the substitute at its rate since the switch, the old SKU at its post-switch level (manual). The period average mixes both regimes. The page's "adopt replacement" does exactly this. |
| **The other subtype's SKU** (left/right hand door) | Each hand at ~50%, its pair has `no_expected` or sits in the other subtype's BOM | Keep the estimate: the pair adds up to 1 per house, and production just doesn't tell the subtypes apart. |
| **An excluded cost center** (Obra) | `excluded_share` ≥ ~20% (PVC pipes, sealants, anchors installed on site) | Keep the estimate: the factory history is biased low by design. |
| **None, and the group stays low** | Group ratio still far from 1 with complements counted | The lower consumption is real: historic is defensible even at medium confidence; say so. |
| **None, and no explanation** | Uniform shortfall (all windows at 0.92) or an extreme ratio with nothing around it | Keep the estimate (timing, stock, 1 per opening) or flag it for review with production; do not adopt it silently. |

Checks that keep groups honest:
- Compare in cost and in a physical unit (metres, m², litres, units per box).
  The group's `factor_to_study_unit` must convert to that unit: 2.4 m and 3.2 m
  boards are not "1 un = 1 un". Cost can match while quantity does not, e.g.
  cheaper wood used 20% more; report both.
- A timing-only `replaces` match can be wrong (a 2x8 "replacing" a 2x4): check
  dimensions.
- `GroupAnalysis` on the page uses dashboard data without the study's cost
  center exclusions; the study's numbers are the budget's reference.

## Example (Nuevo Sol de Quillón, Puelo Original Normal + Espejada, Sep 2026)

188 houses. BOM estimate $11.31 MM. The page's rule alone put 4 plates on
historic. Impregnated pine read 0.33–0.89 at low/medium confidence, and dry pine
outside the BOM ($0.73 MM) was included by default: pine counted twice, giving
6.34 UF/m². Grouped by section and measured in metres, the pine matched the
estimate in cost (+1.8%), so all members went historic. MDP P5 stopped on
9 March (`ratio_after` 0) and was replaced 1:1 in m² by MDP RH, so it was
budgeted at the post-switch rate. Doors stayed on the estimate (right-hand +
left-hand ≈ 1.00 per house), and so did PVC and sealants (Obra). Nails went
historic (the group stays at 0.53). The roof was missing from the BOM (qty 0)
and entered through the materials outside it. Result ≈ $11.78 MM ≈ 5.86 UF/m²
(49 m², UF $41.030).
