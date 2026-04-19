from __future__ import annotations

from pathlib import Path
from typing import Any

from openpyxl import Workbook
from openpyxl.styles import Alignment, Font, PatternFill

from app.services.export_projection import iter_material_context_rows


HEADER_FILL = PatternFill(fill_type="solid", start_color="D7E3F4", end_color="D7E3F4")
CATEGORY_FILL = PatternFill(fill_type="solid", start_color="E7EDF5", end_color="E7EDF5")
INSTANCE_FILL = PatternFill(fill_type="solid", start_color="F4F7FB", end_color="F4F7FB")


def build_materials_workbook(project_data: dict[str, Any], output_path: Path) -> None:
    workbook = Workbook()
    workbook.remove(workbook.active)

    context_rows = list(iter_material_context_rows(project_data))

    totals_sheet = workbook.create_sheet("Total Materials")
    _populate_total_materials_sheet(totals_sheet, context_rows)

    context_sheet = workbook.create_sheet("By Context")
    _populate_context_sheet(context_sheet, context_rows, quantity_key="quantity", title="Project quantities by category and instance")

    assembly_sheet = workbook.create_sheet("Assembly Kit")
    _populate_context_sheet(
        assembly_sheet,
        context_rows,
        quantity_key="assembly_quantity",
        title="Assembly-kit quantities by category and instance",
    )

    workbook.properties.title = f"{project_data['project']['name']} - Materials Workbook"
    output_path.parent.mkdir(parents=True, exist_ok=True)
    workbook.save(output_path)

def _populate_total_materials_sheet(ws, context_rows: list[dict[str, Any]]) -> None:
    ws.sheet_view.showGridLines = False
    ws.freeze_panes = "A2"
    ws.append(["Material", "SKU", "Quantity", "Unit"])
    _style_header_row(ws, row_index=1, column_count=4)

    totals: dict[str, dict[str, Any]] = {}
    for row in context_rows:
        sku = row["sku"]
        entry = totals.setdefault(
            sku,
            {
                "material_name": row["material_name"],
                "sku": sku,
                "unit": row["unit"],
                "quantity_total": 0.0,
                "has_numeric_quantity": False,
                "has_blank_quantity": False,
            },
        )
        state = row["quantity_state"]
        value = row["quantity"]
        if state == "value" and value is not None:
            entry["has_numeric_quantity"] = True
            entry["quantity_total"] += float(value)
        elif state == "blank":
            entry["has_blank_quantity"] = True

    next_row = 2
    for entry in sorted(totals.values(), key=lambda item: (item["material_name"], item["sku"])):
        if not entry["has_numeric_quantity"] and not entry["has_blank_quantity"]:
            continue
        quantity_value = entry["quantity_total"] if entry["has_numeric_quantity"] else None
        ws.append([entry["material_name"], entry["sku"], quantity_value, entry["unit"]])
        _style_data_row(ws, next_row, numeric_columns={3})
        next_row += 1

    _set_column_widths(ws, {"A": 42, "B": 16, "C": 14, "D": 10})


def _populate_context_sheet(ws, context_rows: list[dict[str, Any]], *, quantity_key: str, title: str) -> None:
    ws.sheet_view.showGridLines = False
    ws.freeze_panes = "A3"

    ws.append([title])
    ws.merge_cells("A1:E1")
    title_cell = ws["A1"]
    title_cell.font = Font(name="Calibri", size=12, bold=True)
    title_cell.alignment = Alignment(horizontal="left", vertical="center")

    ws.append(["Material", "SKU", "Subtype", "Quantity", "Unit"])
    _style_header_row(ws, row_index=2, column_count=5)

    quantity_state_key = f"{quantity_key}_state"
    visible_rows = [row for row in context_rows if _include_context_row(row, quantity_key=quantity_key, quantity_state_key=quantity_state_key)]

    if not visible_rows:
        ws.append(["No rows available for this export."])
        ws.merge_cells("A3:E3")
        ws["A3"].alignment = Alignment(horizontal="left", vertical="center")
        _set_column_widths(ws, {"A": 42, "B": 16, "C": 18, "D": 14, "E": 10})
        return

    current_row = 3
    active_category: str | None = None
    active_instance: str | None = None

    for row in visible_rows:
        if row["category_label"] != active_category:
            ws.append([row["category_label"]])
            ws.merge_cells(start_row=current_row, start_column=1, end_row=current_row, end_column=5)
            _style_group_row(ws, current_row, fill=CATEGORY_FILL, bold=True)
            active_category = row["category_label"]
            active_instance = None
            current_row += 1

        if row["instance_label"] != active_instance:
            ws.append([f"  {row['instance_label']}"])
            ws.merge_cells(start_row=current_row, start_column=1, end_row=current_row, end_column=5)
            _style_group_row(ws, current_row, fill=INSTANCE_FILL, bold=False)
            active_instance = row["instance_label"]
            current_row += 1

        numeric_value = row[quantity_key] if row[quantity_state_key] == "value" else None
        subtype_value = row["subtype"] if row["subtype"] != "General" else "General"
        ws.append([row["material_name"], row["sku"], subtype_value, numeric_value, row["unit"]])
        _style_data_row(ws, current_row, numeric_columns={4})
        current_row += 1

    _set_column_widths(ws, {"A": 42, "B": 16, "C": 18, "D": 14, "E": 10})


def _include_context_row(row: dict[str, Any], *, quantity_key: str, quantity_state_key: str) -> bool:
    if quantity_key == "assembly_quantity":
        return row.get(quantity_state_key) == "value"
    state = row.get(quantity_state_key)
    return state in {"value", "blank"}


def _style_header_row(ws, *, row_index: int, column_count: int) -> None:
    for column_index in range(1, column_count + 1):
        cell = ws.cell(row=row_index, column=column_index)
        cell.font = Font(name="Calibri", size=11, bold=True)
        cell.fill = HEADER_FILL
        cell.alignment = Alignment(horizontal="center", vertical="center")


def _style_group_row(ws, row_index: int, *, fill: PatternFill, bold: bool) -> None:
    cell = ws.cell(row=row_index, column=1)
    cell.font = Font(name="Calibri", size=11, bold=bold)
    cell.fill = fill
    cell.alignment = Alignment(horizontal="left", vertical="center")


def _style_data_row(ws, row_index: int, *, numeric_columns: set[int]) -> None:
    for column_index in range(1, ws.max_column + 1):
        cell = ws.cell(row=row_index, column=column_index)
        cell.font = Font(name="Calibri", size=10)
        cell.alignment = Alignment(
            horizontal="right" if column_index in numeric_columns else "left",
            vertical="center",
            wrap_text=column_index == 1,
        )
        if column_index in numeric_columns and isinstance(cell.value, (int, float)):
            cell.number_format = "0.######"


def _set_column_widths(ws, widths: dict[str, float]) -> None:
    for column_letter, width in widths.items():
        ws.column_dimensions[column_letter].width = width
