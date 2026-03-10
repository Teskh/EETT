from __future__ import annotations

from collections import defaultdict

from sqlalchemy import func, select
from sqlalchemy.orm import Session, selectinload

from app.models import (
    AttributeValueType,
    CatalogAttributeDefinition,
    CatalogAttributeOption,
    CatalogCategory,
    CatalogCategoryLink,
    CatalogComponent,
    ComponentMaterialRule,
    Material,
    MaterialRuleGroup,
)
from app.models.entities import CategoryScope, ComponentType, utcnow


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
    short_description: str | None,
    installation: str | None,
    unit_type: str | None,
) -> CatalogComponent:
    clean_description = (description or "").strip() or None
    clean_short_description = (short_description or "").strip() or None
    component = CatalogComponent(
        category_id=category_id,
        component_type=ComponentType(component_type),
        name=name.strip(),
        short_name=(short_name or "").strip() or None,
        description=clean_description,
        short_description=clean_short_description,
        installation=(installation or "").strip() or None,
        unit_type=(unit_type or "").strip() or None,
    )
    session.add(component)
    session.commit()
    session.refresh(component)
    return component


def update_component(
    session: Session,
    *,
    component_id: int,
    name: str,
    short_name: str | None,
    description: str | None,
    short_description: str | None,
    installation: str | None,
    unit_type: str | None,
    component_type: str,
) -> CatalogComponent | None:
    component = session.get(CatalogComponent, component_id)
    if component is None:
        return None

    clean_description = (description or "").strip() or None
    clean_short_description = (short_description or "").strip() or None
    component.name = name.strip()
    component.short_name = (short_name or "").strip() or None
    component.description = clean_description
    component.short_description = clean_short_description
    component.installation = (installation or "").strip() or None
    component.unit_type = (unit_type or "").strip() or None
    component.component_type = ComponentType(component_type)
    session.commit()
    session.refresh(component)
    return component


def delete_component(session: Session, *, component_id: int) -> int | None:
    component = session.get(CatalogComponent, component_id)
    if component is None:
        return None
    if component.instances:
        raise ValueError("Cannot delete a catalog component that is already used by project instances.")

    category_id = component.category_id
    session.delete(component)
    session.commit()
    return category_id


def create_attribute_definition(
    session: Session,
    *,
    component_id: int,
    name: str,
    value_type: str,
    options_text: str | None,
) -> CatalogAttributeDefinition | None:
    component = session.scalar(
        select(CatalogComponent)
        .where(CatalogComponent.id == component_id)
        .options(selectinload(CatalogComponent.attribute_definitions).selectinload(CatalogAttributeDefinition.options))
    )
    if component is None:
        return None

    definition = CatalogAttributeDefinition(
        component=component,
        name=name.strip(),
        value_type=AttributeValueType(value_type),
        sort_order=(component.attribute_definitions[-1].sort_order + 1) if component.attribute_definitions else 1,
    )
    session.add(definition)
    session.flush()
    _replace_attribute_options(definition, options_text)
    _touch_component(component)
    session.commit()
    session.refresh(definition)
    return definition


def update_attribute_definition(
    session: Session,
    *,
    attribute_definition_id: int,
    name: str,
    value_type: str,
    options_text: str | None,
) -> CatalogAttributeDefinition | None:
    definition = session.scalar(
        select(CatalogAttributeDefinition)
        .where(CatalogAttributeDefinition.id == attribute_definition_id)
        .options(
            selectinload(CatalogAttributeDefinition.component),
            selectinload(CatalogAttributeDefinition.options),
        )
    )
    if definition is None:
        return None

    definition.name = name.strip()
    definition.value_type = AttributeValueType(value_type)
    _replace_attribute_options(definition, options_text)
    _touch_component(definition.component)
    session.commit()
    session.refresh(definition)
    return definition


def delete_attribute_definition(session: Session, *, attribute_definition_id: int) -> int | None:
    definition = session.scalar(
        select(CatalogAttributeDefinition)
        .where(CatalogAttributeDefinition.id == attribute_definition_id)
        .options(selectinload(CatalogAttributeDefinition.component))
    )
    if definition is None:
        return None

    category_id = definition.component.category_id
    _touch_component(definition.component)
    session.delete(definition)
    session.commit()
    return category_id


def replace_component_attributes(
    session: Session,
    *,
    component_id: int,
    attributes: list[dict],
) -> CatalogComponent | None:
    component = session.scalar(
        select(CatalogComponent)
        .where(CatalogComponent.id == component_id)
        .options(selectinload(CatalogComponent.attribute_definitions).selectinload(CatalogAttributeDefinition.options))
    )
    if component is None:
        return None

    component.attribute_definitions.clear()
    session.flush()

    for index, attribute in enumerate(attributes, start=1):
        name = (attribute.get("name") or "").strip()
        value_type = AttributeValueType(attribute.get("value_type") or AttributeValueType.TEXT.value)
        options = _normalize_attribute_option_list(attribute.get("options"))
        if not name and not options:
            continue

        definition = CatalogAttributeDefinition(
            component=component,
            name=name,
            value_type=value_type,
            sort_order=index,
        )
        session.add(definition)
        session.flush()
        _replace_attribute_options(definition, options)

    _touch_component(component)
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
        "category_id": component.category_id,
        "name": component.name,
        "short_name": component.short_name,
        "type": component.component_type.value,
        "description": component.description,
        "short_description": component.short_description,
        "installation": component.installation,
        "unit_type": component.unit_type,
        "attributes": [
            {
                "id": definition.id,
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


def _replace_attribute_options(definition: CatalogAttributeDefinition, options_source: str | list[str] | None) -> None:
    normalized_options = _normalize_attribute_option_list(options_source)
    definition.options.clear()
    if definition.value_type != AttributeValueType.SELECT:
        return

    for index, option in enumerate(normalized_options, start=1):
        definition.options.append(
            CatalogAttributeOption(
                value=option,
                sort_order=index,
            )
        )


def _normalize_attribute_option_list(raw_value: str | list[str] | None) -> list[str]:
    if raw_value is None:
        return []

    if isinstance(raw_value, list):
        return [str(value).strip() for value in raw_value if str(value).strip()]

    normalized = raw_value.replace("\r", "\n")
    parts = []
    for chunk in normalized.split("\n"):
        pieces = [piece.strip() for piece in chunk.split(",")]
        parts.extend(piece for piece in pieces if piece)
    return parts


def _touch_component(component: CatalogComponent) -> None:
    component.updated_at = utcnow()
