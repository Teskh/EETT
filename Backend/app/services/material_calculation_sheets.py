from __future__ import annotations

from dataclasses import dataclass

from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.models import CatalogComponent, ComponentMaterialRule, Project, ProjectInstance, ProjectMaterialCalculationCell, ProjectMaterialCalculationSheet
from app.models.entities import utcnow


@dataclass
class MaterialCalculationContext:
    instance: ProjectInstance
    rule: ComponentMaterialRule


def get_material_calculation_sheet(
    session: Session,
    *,
    project: Project,
    instance_id: int,
    rule_id: int,
) -> dict | None:
    context = _load_material_context(session, project_id=project.id, instance_id=instance_id, rule_id=rule_id)
    if context is None:
        return None

    sheet = _load_sheet(
        session,
        project_id=project.id,
        instance_id=context.instance.id,
        material_id=context.rule.material_id,
    )
    return _serialize_sheet(sheet, context=context)


def replace_material_calculation_sheet(
    session: Session,
    *,
    project: Project,
    instance_id: int,
    rule_id: int,
    cells: list[dict],
) -> dict | None:
    context = _load_material_context(session, project_id=project.id, instance_id=instance_id, rule_id=rule_id)
    if context is None:
        return None

    normalized_cells = _normalize_cells(cells)
    sheet = _load_sheet(
        session,
        project_id=project.id,
        instance_id=context.instance.id,
        material_id=context.rule.material_id,
    )

    if not normalized_cells:
        if sheet is not None:
            session.delete(sheet)
            session.commit()
        return _serialize_sheet(None, context=context)

    if sheet is None:
        sheet = ProjectMaterialCalculationSheet(
            project=project,
            instance=context.instance,
            material=context.rule.material,
        )
        session.add(sheet)
        session.flush()
    else:
        sheet.updated_at = utcnow()

    sheet.cells = [
        ProjectMaterialCalculationCell(
            row_index=row["row_index"],
            column_index=row["column_index"],
            raw_input=row["raw_input"],
        )
        for row in normalized_cells
    ]
    session.commit()
    session.refresh(sheet)
    return _serialize_sheet(sheet, context=context)


def _load_material_context(
    session: Session,
    *,
    project_id: int,
    instance_id: int,
    rule_id: int,
) -> MaterialCalculationContext | None:
    instance = session.scalar(
        select(ProjectInstance)
        .where(ProjectInstance.id == instance_id, ProjectInstance.project_id == project_id)
        .options(
            selectinload(ProjectInstance.component)
            .selectinload(CatalogComponent.material_rules)
            .selectinload(ComponentMaterialRule.material)
        )
    )
    if instance is None:
        return None

    rule = next((item for item in instance.component.material_rules if item.id == rule_id), None)
    if rule is None:
        raise ValueError("Material was not found on this instance.")

    return MaterialCalculationContext(instance=instance, rule=rule)


def _load_sheet(
    session: Session,
    *,
    project_id: int,
    instance_id: int,
    material_id: int,
) -> ProjectMaterialCalculationSheet | None:
    return session.scalar(
        select(ProjectMaterialCalculationSheet)
        .where(
            ProjectMaterialCalculationSheet.project_id == project_id,
            ProjectMaterialCalculationSheet.instance_id == instance_id,
            ProjectMaterialCalculationSheet.material_id == material_id,
        )
        .options(selectinload(ProjectMaterialCalculationSheet.cells), selectinload(ProjectMaterialCalculationSheet.material))
    )


def _normalize_cells(cells: list[dict]) -> list[dict]:
    if len(cells) > 5000:
        raise ValueError("Calculation sheets are limited to 5000 non-empty cells.")

    normalized_cells: list[dict] = []
    seen_positions: set[tuple[int, int]] = set()
    for row in cells:
        row_index = int(row.get("row_index", -1))
        column_index = int(row.get("column_index", -1))
        raw_input = str(row.get("raw_input") or "")
        if row_index < 0 or column_index < 0:
            raise ValueError("Calculation cell coordinates must be zero or greater.")
        if len(raw_input) > 1000:
            raise ValueError("Calculation cell contents cannot exceed 1000 characters.")
        if not raw_input.strip():
            continue
        position = (row_index, column_index)
        if position in seen_positions:
            raise ValueError("Duplicate calculation cell coordinates are not allowed.")
        seen_positions.add(position)
        normalized_cells.append(
            {
                "row_index": row_index,
                "column_index": column_index,
                "raw_input": raw_input,
            }
        )

    normalized_cells.sort(key=lambda item: (item["row_index"], item["column_index"]))
    return normalized_cells


def _serialize_sheet(
    sheet: ProjectMaterialCalculationSheet | None,
    *,
    context: MaterialCalculationContext,
) -> dict:
    cells = sheet.cells if sheet is not None else []
    material = sheet.material if sheet is not None else context.rule.material
    return {
        "project_id": context.instance.project_id,
        "instance_id": context.instance.id,
        "rule_id": context.rule.id,
        "material_id": material.id,
        "material_name": material.name,
        "sku": material.sku,
        "cell_count": len(cells),
        "updated_at": sheet.updated_at.isoformat() if sheet is not None else None,
        "cells": [
            {
                "row_index": cell.row_index,
                "column_index": cell.column_index,
                "raw_input": cell.raw_input,
            }
            for cell in cells
        ],
    }
