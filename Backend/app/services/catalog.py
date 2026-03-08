from __future__ import annotations

from collections import defaultdict

from sqlalchemy import func, select
from sqlalchemy.orm import Session, selectinload

from app.models import (
    CatalogAttributeDefinition,
    CatalogCategory,
    CatalogCategoryLink,
    CatalogComponent,
    ComponentMaterialRule,
    Material,
    MaterialRuleGroup,
)
from app.models.entities import CategoryScope, ComponentType


def get_catalog_page_data(session: Session, selected_category_id: int | None = None) -> dict:
    categories = session.scalars(
        select(CatalogCategory)
        .options(
            selectinload(CatalogCategory.components)
            .selectinload(CatalogComponent.attribute_definitions)
            .selectinload(CatalogAttributeDefinition.options),
            selectinload(CatalogCategory.components)
            .selectinload(CatalogComponent.material_rules)
            .selectinload(ComponentMaterialRule.material),
            selectinload(CatalogCategory.components)
            .selectinload(CatalogComponent.material_rules)
            .selectinload(ComponentMaterialRule.condition_groups)
            .selectinload(MaterialRuleGroup.conditions),
            selectinload(CatalogCategory.outgoing_links).selectinload(CatalogCategoryLink.linked_category),
        )
        .order_by(CatalogCategory.sort_order, CatalogCategory.name)
    ).all()

    counts_by_category = defaultdict(int)
    for category in categories:
        counts_by_category[category.id] = len(category.components)

    children_by_parent = defaultdict(list)
    for category in categories:
        children_by_parent[category.parent_id].append(category)

    roots = children_by_parent[None]
    selected = None
    if categories:
        selected = next((category for category in categories if category.id == selected_category_id), roots[0])

    return {
        "summary": {
            "categories": session.scalar(select(func.count(CatalogCategory.id))) or 0,
            "components": session.scalar(select(func.count(CatalogComponent.id))) or 0,
            "materials": session.scalar(select(func.count(Material.id))) or 0,
        },
        "tree": [_serialize_category_node(root, counts_by_category, children_by_parent) for root in roots],
        "selected": _serialize_selected_category(selected, children_by_parent) if selected else None,
        "link_targets": [
            {"id": category.id, "name": category.name}
            for category in categories
            if selected is None or category.id != selected.id
        ],
    }


def create_category(
    session: Session,
    *,
    name: str,
    description: str | None,
    scope: str,
    parent_id: int | None,
) -> CatalogCategory:
    siblings = session.scalars(
        select(CatalogCategory)
        .where(CatalogCategory.parent_id == parent_id)
        .order_by(CatalogCategory.sort_order.desc())
    ).all()
    next_order = siblings[0].sort_order + 1 if siblings else 1
    category = CatalogCategory(
        name=name.strip(),
        description=(description or "").strip() or None,
        scope=CategoryScope(scope),
        parent_id=parent_id,
        sort_order=next_order,
    )
    session.add(category)
    session.commit()
    session.refresh(category)
    return category


def create_component(
    session: Session,
    *,
    category_id: int,
    component_type: str,
    name: str,
    short_name: str | None,
    description: str | None,
    unit_type: str | None,
) -> CatalogComponent:
    component = CatalogComponent(
        category_id=category_id,
        component_type=ComponentType(component_type),
        name=name.strip(),
        short_name=(short_name or "").strip() or None,
        description=(description or "").strip() or None,
        short_description=(description or "").strip() or None,
        unit_type=(unit_type or "").strip() or None,
    )
    session.add(component)
    session.commit()
    session.refresh(component)
    return component


def update_category_links(session: Session, *, category_id: int, linked_category_ids: list[int]) -> None:
    current_links = session.scalars(
        select(CatalogCategoryLink).where(CatalogCategoryLink.category_id == category_id)
    ).all()
    current_ids = {link.linked_category_id for link in current_links}
    target_ids = set(linked_category_ids)

    for link in current_links:
        if link.linked_category_id not in target_ids:
            session.delete(link)
    for linked_id in target_ids - current_ids:
        session.add(CatalogCategoryLink(category_id=category_id, linked_category_id=linked_id))
    session.commit()


def _serialize_category_node(
    category: CatalogCategory,
    counts_by_category: dict[int, int],
    children_by_parent: dict[int | None, list[CatalogCategory]],
) -> dict:
    return {
        "id": category.id,
        "name": category.name,
        "scope": category.scope.value,
        "component_count": counts_by_category.get(category.id, 0),
        "children": [
            _serialize_category_node(child, counts_by_category, children_by_parent)
            for child in children_by_parent.get(category.id, [])
        ],
    }


def _serialize_selected_category(
    category: CatalogCategory,
    children_by_parent: dict[int | None, list[CatalogCategory]],
) -> dict:
    linked_ids = {link.linked_category_id for link in category.outgoing_links}
    return {
        "id": category.id,
        "name": category.name,
        "description": category.description,
        "scope": category.scope.value,
        "parent_id": category.parent_id,
        "linked_category_ids": list(linked_ids),
        "linked_categories": [
            {"id": link.linked_category.id, "name": link.linked_category.name}
            for link in sorted(category.outgoing_links, key=lambda item: item.linked_category.name)
        ],
        "child_categories": [
            {"id": child.id, "name": child.name, "scope": child.scope.value}
            for child in children_by_parent.get(category.id, [])
        ],
        "components": [_serialize_component(component) for component in category.components],
    }


def _serialize_component(component: CatalogComponent) -> dict:
    return {
        "id": component.id,
        "name": component.name,
        "short_name": component.short_name,
        "type": component.component_type.value,
        "description": component.description,
        "installation": component.installation,
        "unit_type": component.unit_type,
        "attributes": [
            {
                "name": definition.name,
                "value_type": definition.value_type.value,
                "options": [option.value for option in definition.options],
            }
            for definition in component.attribute_definitions
        ],
        "material_rules": [
            {
                "material_name": rule.material.name,
                "sku": rule.material.sku,
                "unit": rule.unit or rule.material.unit,
                "unit_qty_per_unit": rule.unit_qty_per_unit,
                "notes": rule.notes,
                "conditions": [
                    {
                        "group": group.group_key,
                        "clauses": [
                            {
                                "attribute_name": condition.attribute_name,
                                "operator": condition.operator,
                                "comparison_value": condition.comparison_value,
                                "comparison_value_secondary": condition.comparison_value_secondary,
                            }
                            for condition in group.conditions
                        ],
                    }
                    for group in rule.condition_groups
                ],
            }
            for rule in component.material_rules
        ],
    }
