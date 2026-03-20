from __future__ import annotations

import argparse
import json
import sqlite3
import sys
from collections import defaultdict
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

REPO_ROOT = Path(__file__).resolve().parents[2]
BACKEND_DIR = REPO_ROOT / "Backend"
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from sqlalchemy import select
from sqlalchemy.orm import Session
from sqlalchemy.exc import OperationalError

from app.config import Settings
from app.database import create_engine_for_url, create_session_factory, schema_is_ready
from app.models import (
    CatalogAttributeDefinition,
    CatalogAttributeOption,
    CatalogCategory,
    CatalogCategoryLink,
    CatalogComponent,
    CommentMention,
    CommentNotification,
    ComponentMaterialRule,
    Material,
    MaterialRuleCondition,
    MaterialRuleGroup,
    NotificationType,
    Project,
    ProjectActivityLog,
    ProjectApproval,
    ProjectAuxiliaryMaterialSelection,
    ProjectBomEntry,
    ProjectComment,
    ProjectInstance,
    ProjectInstanceAttributeGroup,
    ProjectInstanceAttributeValue,
    ProjectInstanceLink,
    ProjectInstanceOccurrence,
    ProjectInstanceOccurrenceAttributeValue,
    ProjectInstanceOccurrenceTarget,
    ProjectMaterialMode,
    ProjectStatus,
    ProjectSubtype,
    SyncStatus,
    User,
)
from app.models.entities import (
    ApprovalStatus,
    AttributeScope,
    AttributeValueType,
    AuxiliaryMaterial,
    BomCalculationMode,
    CategoryScope,
    ComponentType,
    ProjectInstanceSyncState,
    MaterialMode,
)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="One-time importer from legacy SQLite catalog/projects databases into the new Postgres schema."
    )
    parser.add_argument("--main-db", required=True, help="Path to legacy main SQLite database.")
    parser.add_argument("--projects-db", required=True, help="Path to legacy projects SQLite database.")
    parser.add_argument(
        "--database-url",
        default=None,
        help="Target database URL. Defaults to SPEC_SHEETS_DATABASE_URL / backend settings.",
    )
    parser.add_argument(
        "--legacy-email-domain",
        default="legacy.local",
        help="Domain used for generated email addresses when importing legacy usernames.",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Run the import and print a summary, but roll back instead of committing.",
    )
    return parser.parse_args()


def connect_sqlite(path: str) -> sqlite3.Connection:
    conn = sqlite3.connect(path)
    conn.row_factory = sqlite3.Row
    return conn


def fetch_all(conn: sqlite3.Connection, query: str, params: tuple[Any, ...] = ()) -> list[sqlite3.Row]:
    return list(conn.execute(query, params).fetchall())


def fetch_grouped(conn: sqlite3.Connection, query: str, key_field: str) -> dict[Any, list[sqlite3.Row]]:
    grouped: dict[Any, list[sqlite3.Row]] = defaultdict(list)
    for row in fetch_all(conn, query):
        grouped[row[key_field]].append(row)
    return grouped


def normalize_text(value: Any) -> str | None:
    if value is None:
        return None
    text = str(value).strip()
    return text or None


def parse_json_like(value: Any) -> Any:
    if value is None:
        return None
    if isinstance(value, (dict, list, int, float, bool)):
        return value
    text = str(value).strip()
    if not text:
        return None
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        return text


def parse_string_list(value: Any) -> list[str]:
    parsed = parse_json_like(value)
    if parsed is None:
        return []
    if isinstance(parsed, list):
        return [str(item).strip() for item in parsed if str(item).strip()]
    if isinstance(parsed, str):
        if "," in parsed:
            return [item.strip() for item in parsed.split(",") if item.strip()]
        return [parsed] if parsed else []
    return [str(parsed).strip()]


def collapse_legacy_value(value: Any) -> str | None:
    items = parse_string_list(value)
    if not items:
        parsed = parse_json_like(value)
        if parsed in (None, "", []):
            return None
        return str(parsed).strip() or None
    if len(items) == 1:
        return items[0]
    return ", ".join(items)


def parse_datetime(value: Any) -> datetime | None:
    text = normalize_text(value)
    if not text:
        return None
    candidates = [text.replace("Z", "+00:00")]
    if " " in text and "T" not in text:
        candidates.append(text.replace(" ", "T"))
    for candidate in candidates:
        try:
            parsed = datetime.fromisoformat(candidate)
            if parsed.tzinfo is None:
                return parsed.replace(tzinfo=UTC)
            return parsed.astimezone(UTC)
        except ValueError:
            continue
    return None


def normalize_status(value: Any) -> ProjectStatus:
    text = (normalize_text(value) or "").casefold()
    if "tipo" in text or "template" in text:
        return ProjectStatus.TEMPLATE
    if "final" in text or "finish" in text:
        return ProjectStatus.FINISHED
    return ProjectStatus.EXECUTION


def guess_attribute_value_type(values: list[str]) -> AttributeValueType:
    if not values:
        return AttributeValueType.TEXT
    try:
        for value in values:
            float(value)
        return AttributeValueType.NUMBER
    except ValueError:
        pass
    if len(set(values)) > 1:
        return AttributeValueType.SELECT
    return AttributeValueType.TEXT


def sanitize_username(username: str) -> str:
    cleaned = "".join(char if char.isalnum() or char in {"_", ".", "-"} else "_" for char in username.strip())
    return cleaned[:80] or "legacy_user"


def action_label(value: Any) -> str:
    text = normalize_text(value)
    if not text:
        return "legacy_event"
    return text.replace(" ", "_").replace("/", "_").lower()


class LegacyImporter:
    def __init__(
        self,
        *,
        session: Session,
        main_conn: sqlite3.Connection,
        projects_conn: sqlite3.Connection,
        legacy_email_domain: str,
    ) -> None:
        self.session = session
        self.main_conn = main_conn
        self.projects_conn = projects_conn
        self.legacy_email_domain = legacy_email_domain
        self.warnings: list[str] = []
        self.stats: dict[str, int] = defaultdict(int)

        self.category_by_legacy_id: dict[int, CatalogCategory] = {}
        self.component_by_legacy_key: dict[tuple[str, int], CatalogComponent] = {}
        self.material_rule_by_legacy_id: dict[int, ComponentMaterialRule] = {}
        self.material_by_sku: dict[str, Material] = {}
        self.auxiliary_by_legacy_id: dict[int, AuxiliaryMaterial] = {}
        self.project_by_legacy_id: dict[int, Project] = {}
        self.subtype_by_legacy_id: dict[int, ProjectSubtype] = {}
        self.instance_by_legacy_key: dict[tuple[str, int], ProjectInstance] = {}
        self.user_by_username: dict[str, User] = {}
        self.comment_by_legacy_id: dict[int, ProjectComment] = {}
        self.fallback_category_by_scope: dict[CategoryScope, CatalogCategory] = {}
        self.fallback_material_rule_by_key: dict[tuple[int, int], ComponentMaterialRule] = {}
        self.bom_entry_by_key: dict[tuple[int, int, int, int | None], ProjectBomEntry] = {}

    def run(self) -> None:
        self.import_catalog()
        self.import_projects()

    def import_catalog(self) -> None:
        categories = fetch_all(
            self.main_conn,
            'SELECT category_id, name, parent_id, linked_categories, item_type, "order" FROM Categories ORDER BY COALESCE(parent_id, 0), COALESCE("order", 0), category_id',
        )
        items = fetch_all(
            self.main_conn,
            "SELECT item_id, name, short_name, description, short_description, installation, category_id FROM Items ORDER BY item_id",
        )
        accessories = fetch_all(
            self.main_conn,
            "SELECT accesory_id, name, short_name, description, short_description, installation, category_id FROM Accesory_Item ORDER BY accesory_id",
        )
        item_attributes = fetch_grouped(
            self.main_conn,
            'SELECT attribute_id, item_id, name, value, "order" FROM Item_Attributes ORDER BY item_id, COALESCE("order", 0), attribute_id',
            "item_id",
        )
        accessory_attributes = fetch_grouped(
            self.main_conn,
            'SELECT attribute_id, accesory_id, name, value, "order" FROM Accesory_Attributes ORDER BY accesory_id, COALESCE("order", 0), attribute_id',
            "accesory_id",
        )
        materials = fetch_all(
            self.main_conn,
            "SELECT material_id, item_id, accesory_id, material_name, SKU, Units, display_order FROM Materials ORDER BY material_id",
        )
        conditions_by_material = fetch_grouped(
            self.main_conn,
            "SELECT condition_id, material_id, group_id, attribute_name, operator, value FROM Material_Conditions ORDER BY material_id, group_id, condition_id",
            "material_id",
        )
        auxiliary_materials = fetch_all(
            self.main_conn,
            "SELECT auxiliary_id, name, code, price, category FROM Auxiliary_Materials ORDER BY auxiliary_id",
        )

        for row in categories:
            self.import_category(row, categories)
        self.import_category_links(categories)

        for row in items:
            component = self.import_component(row=row, component_type=ComponentType.ITEM)
            self.component_by_legacy_key[("item", row["item_id"])] = component
            self.import_catalog_attributes(component, item_attributes.get(row["item_id"], []))

        for row in accessories:
            component = self.import_component(row=row, component_type=ComponentType.ACCESSORY)
            self.component_by_legacy_key[("accessory", row["accesory_id"])] = component
            self.import_catalog_attributes(component, accessory_attributes.get(row["accesory_id"], []))

        for row in materials:
            self.import_material_rule(row, conditions_by_material.get(row["material_id"], []))

        for row in auxiliary_materials:
            self.import_auxiliary_material(row)

    def import_projects(self) -> None:
        projects = fetch_all(
            self.projects_conn,
            "SELECT project_id, name, created_date, modified_date, estado FROM Projects ORDER BY project_id",
        )
        subtypes = fetch_all(
            self.projects_conn,
            "SELECT subtype_id, project_id, parent_subtype_id, name, created_date, modified_date FROM Project_Subtypes ORDER BY project_id, subtype_id",
        )
        item_instances = fetch_all(
            self.projects_conn,
            "SELECT instance_id, project_id, item_id, name, short_name, description, short_description, installation, created_date, modified_date FROM Item_Instances ORDER BY project_id, instance_id",
        )
        accessory_instances = fetch_all(
            self.projects_conn,
            "SELECT accessory_instance_id, project_id, accessory_id, name, short_name, description, short_description, installation, created_date, modified_date FROM Accessory_Instance ORDER BY project_id, accessory_instance_id",
        )
        item_instance_attributes = fetch_grouped(
            self.projects_conn,
            "SELECT attribute_id, instance_id, name, value, created_date, modified_date FROM Item_Instance_Attributes ORDER BY instance_id, attribute_id",
            "instance_id",
        )
        accessory_instance_attributes = fetch_grouped(
            self.projects_conn,
            "SELECT attribute_id, accessory_instance_id, application, name, value, group_id, created_date, modified_date FROM Accessory_Instance_Attributes ORDER BY accessory_instance_id, COALESCE(group_id, ''), attribute_id",
            "accessory_instance_id",
        )
        bom_rows = fetch_all(
            self.projects_conn,
            "SELECT bom_id, project_id, subtype_id, material_id, quantity, assembly_kit, unit, item_instance_id, accessory_instance_id FROM Bill_Of_Materials ORDER BY project_id, bom_id",
        )
        material_config_rows = fetch_grouped(
            self.projects_conn,
            "SELECT project_id, material_id, is_per_subtype FROM Project_Material_Config ORDER BY project_id, material_id",
            "project_id",
        )
        export_settings = fetch_all(
            self.projects_conn,
            "SELECT project_id, instance_type, instance_id, target, settings, created_date, modified_date FROM Instance_Export_Settings ORDER BY project_id, instance_type, instance_id",
        )
        auxiliary_selections = fetch_all(
            self.projects_conn,
            "SELECT project_auxiliary_id, project_id, auxiliary_id, subtype_id FROM Project_Auxiliary_Materials ORDER BY project_id, project_auxiliary_id",
        )
        comments = fetch_all(
            self.projects_conn,
            "SELECT comment_id, project_id, item_instance_id, accessory_instance_id, parent_comment_id, author_username, body, created_at, updated_at FROM Instance_Comments ORDER BY comment_id",
        )
        mentions = fetch_grouped(
            self.projects_conn,
            "SELECT mention_id, comment_id, mentioned_username FROM Comment_Mentions ORDER BY mention_id",
            "comment_id",
        )
        notifications = fetch_grouped(
            self.projects_conn,
            "SELECT notification_id, username, comment_id, notification_type, is_read, created_at FROM Comment_Notifications ORDER BY notification_id",
            "comment_id",
        )
        changelog_rows = fetch_all(
            self.projects_conn,
            "SELECT log_id, timestamp, project_id, user_id, entity_type, entity_id, action, field_name, old_value, new_value, details, project_estado, approved_by, approved_date FROM Changelog ORDER BY log_id",
        )

        for row in projects:
            self.import_project(row)

        subtype_rows_by_project = defaultdict(list)
        for row in subtypes:
            subtype_rows_by_project[row["project_id"]].append(row)
        for project_id in subtype_rows_by_project:
            self.import_project_subtypes(project_id, subtype_rows_by_project[project_id])

        for row in item_instances:
            instance = self.import_project_instance(
                row=row,
                component_type=ComponentType.ITEM,
                legacy_component_key=("item", row["item_id"]),
            )
            self.instance_by_legacy_key[("item", row["instance_id"])] = instance
            self.import_base_attribute_group(instance, item_instance_attributes.get(row["instance_id"], []))

        for row in accessory_instances:
            instance = self.import_project_instance(
                row=row,
                component_type=ComponentType.ACCESSORY,
                legacy_component_key=("accessory", row["accessory_id"]),
            )
            self.instance_by_legacy_key[("accessory", row["accessory_instance_id"])] = instance
            self.import_accessory_groups_and_occurrences(instance, accessory_instance_attributes.get(row["accessory_instance_id"], []))

        for row in auxiliary_selections:
            self.import_auxiliary_selection(row)

        for row in export_settings:
            self.import_export_setting(row)

        self.import_project_material_modes(projects, material_config_rows, bom_rows)

        for row in bom_rows:
            self.import_bom_row(row)

        for row in comments:
            self.import_comment(row)

        for legacy_comment_id, mention_rows in mentions.items():
            self.import_comment_mentions(legacy_comment_id, mention_rows)
        for legacy_comment_id, notification_rows in notifications.items():
            self.import_comment_notifications(legacy_comment_id, notification_rows)

        for row in changelog_rows:
            self.import_changelog_row(row)

    def import_category(self, row: sqlite3.Row, all_rows: list[sqlite3.Row]) -> CatalogCategory:
        legacy_id = int(row["category_id"])
        if legacy_id in self.category_by_legacy_id:
            return self.category_by_legacy_id[legacy_id]

        parent = None
        if row["parent_id"] is not None:
            parent_row = next((candidate for candidate in all_rows if candidate["category_id"] == row["parent_id"]), None)
            if parent_row is None:
                self.warnings.append(f"Category {legacy_id} references missing parent {row['parent_id']}.")
            else:
                parent = self.import_category(parent_row, all_rows)

        category = self.session.scalar(
            select(CatalogCategory).where(
                CatalogCategory.name == row["name"],
                CatalogCategory.parent_id == (parent.id if parent else None),
            )
        )
        if category is None:
            raw_scope = (normalize_text(row["item_type"]) or "item").casefold()
            if raw_scope == "accessory":
                scope = CategoryScope.ACCESSORY
            elif raw_scope == "mixed":
                scope = CategoryScope.MIXED
            else:
                scope = CategoryScope.ITEM
            category = CatalogCategory(
                name=row["name"],
                parent=parent,
                scope=scope,
                sort_order=int(row["order"] or 0),
            )
            self.session.add(category)
            self.session.flush()
            self.stats["categories"] += 1
        self.category_by_legacy_id[legacy_id] = category
        return category

    def import_category_links(self, category_rows: list[sqlite3.Row]) -> None:
        for row in category_rows:
            source = self.category_by_legacy_id[int(row["category_id"])]
            for linked_id_text in parse_string_list(row["linked_categories"]):
                try:
                    linked_id = int(linked_id_text)
                except ValueError:
                    self.warnings.append(
                        f"Category {row['category_id']} has non-numeric linked category value {linked_id_text!r}."
                    )
                    continue
                target = self.category_by_legacy_id.get(linked_id)
                if target is None:
                    self.warnings.append(
                        f"Category {row['category_id']} references missing linked category {linked_id}."
                    )
                    continue
                existing = self.session.scalar(
                    select(CatalogCategoryLink).where(
                        CatalogCategoryLink.category_id == source.id,
                        CatalogCategoryLink.linked_category_id == target.id,
                    )
                )
                if existing is None:
                    self.session.add(CatalogCategoryLink(category=source, linked_category=target))
                    self.stats["category_links"] += 1

    def import_component(self, *, row: sqlite3.Row, component_type: ComponentType) -> CatalogComponent:
        legacy_id_field = "item_id" if component_type == ComponentType.ITEM else "accesory_id"
        legacy_key = ("item" if component_type == ComponentType.ITEM else "accessory", int(row[legacy_id_field]))
        mapped = self.component_by_legacy_key.get(legacy_key)
        if mapped is not None:
            return mapped

        category = self.category_by_legacy_id.get(int(row["category_id"]))
        if category is None:
            raise ValueError(f"Component {legacy_key} references missing category {row['category_id']}.")

        component = self.session.scalar(
            select(CatalogComponent).where(
                CatalogComponent.category_id == category.id,
                CatalogComponent.component_type == component_type,
                CatalogComponent.name == row["name"],
            )
        )
        if component is None:
            component = CatalogComponent(
                category=category,
                component_type=component_type,
                name=row["name"],
                short_name=normalize_text(row["short_name"]),
                description=normalize_text(row["description"]),
                short_description=normalize_text(row["short_description"]),
                installation=normalize_text(row["installation"]),
            )
            self.session.add(component)
            self.session.flush()
            self.stats["components"] += 1
        return component

    def import_catalog_attributes(self, component: CatalogComponent, attribute_rows: list[sqlite3.Row]) -> None:
        for index, row in enumerate(attribute_rows, start=1):
            option_values = parse_string_list(row["value"])
            value_type = guess_attribute_value_type(option_values)
            definition = self.session.scalar(
                select(CatalogAttributeDefinition).where(
                    CatalogAttributeDefinition.component_id == component.id,
                    CatalogAttributeDefinition.name == row["name"],
                    CatalogAttributeDefinition.scope == AttributeScope.BASE,
                )
            )
            if definition is None:
                definition = CatalogAttributeDefinition(
                    component=component,
                    name=row["name"],
                    scope=AttributeScope.BASE,
                    value_type=value_type,
                    sort_order=int(row["order"] or index),
                )
                self.session.add(definition)
                self.session.flush()
                self.stats["attribute_definitions"] += 1
            elif definition.value_type == AttributeValueType.TEXT and value_type != AttributeValueType.TEXT:
                definition.value_type = value_type

            for option_index, option_value in enumerate(option_values, start=1):
                existing = self.session.scalar(
                    select(CatalogAttributeOption).where(
                        CatalogAttributeOption.attribute_definition_id == definition.id,
                        CatalogAttributeOption.value == option_value,
                    )
                )
                if existing is None:
                    self.session.add(
                        CatalogAttributeOption(
                            attribute_definition=definition,
                            value=option_value,
                            sort_order=option_index,
                        )
                    )
                    self.stats["attribute_options"] += 1

    def import_material_rule(self, row: sqlite3.Row, condition_rows: list[sqlite3.Row]) -> None:
        legacy_material_id = int(row["material_id"])
        if legacy_material_id in self.material_rule_by_legacy_id:
            return

        if row["item_id"] is not None:
            component = self.component_by_legacy_key.get(("item", int(row["item_id"])))
        else:
            component = self.component_by_legacy_key.get(("accessory", int(row["accesory_id"])))
        if component is None:
            self.warnings.append(f"Legacy material {legacy_material_id} references a missing component.")
            return

        sku = normalize_text(row["SKU"])
        material_name = normalize_text(row["material_name"]) or sku or f"legacy-material-{legacy_material_id}"
        if sku is None:
            sku = f"LEGACY-{legacy_material_id}"
            self.warnings.append(f"Legacy material {legacy_material_id} had no SKU; generated {sku}.")

        material = self.material_by_sku.get(sku)
        if material is None:
            material = self.session.scalar(select(Material).where(Material.sku == sku))
            if material is None:
                material = Material(
                    sku=sku,
                    name=material_name,
                    unit=normalize_text(row["Units"]),
                )
                self.session.add(material)
                self.session.flush()
                self.stats["materials"] += 1
            self.material_by_sku[sku] = material
        elif material.name != material_name:
            self.warnings.append(
                f"SKU {sku} appears with multiple names ({material.name!r} and {material_name!r}); keeping the first."
            )

        rule = self.session.scalar(
            select(ComponentMaterialRule).where(
                ComponentMaterialRule.component_id == component.id,
                ComponentMaterialRule.material_id == material.id,
                ComponentMaterialRule.display_order == int(row["display_order"] or 0),
            )
        )
        if rule is None:
            rule = ComponentMaterialRule(
                component=component,
                material=material,
                display_order=int(row["display_order"] or 0),
                unit=normalize_text(row["Units"]),
            )
            self.session.add(rule)
            self.session.flush()
            self.stats["material_rules"] += 1

        grouped_conditions: dict[str, list[sqlite3.Row]] = defaultdict(list)
        for condition_row in condition_rows:
            grouped_conditions[str(condition_row["group_id"])].append(condition_row)

        for group_key, rows in grouped_conditions.items():
            group = self.session.scalar(
                select(MaterialRuleGroup).where(
                    MaterialRuleGroup.rule_id == rule.id,
                    MaterialRuleGroup.group_key == group_key,
                )
            )
            if group is None:
                group = MaterialRuleGroup(rule=rule, group_key=group_key)
                self.session.add(group)
                self.session.flush()
                self.stats["material_rule_groups"] += 1
            for condition_row in rows:
                operator = (normalize_text(condition_row["operator"]) or "=").upper()
                comparison_value, comparison_value_secondary = self.parse_condition_values(
                    operator=operator,
                    raw_value=condition_row["value"],
                )
                existing = self.session.scalar(
                    select(MaterialRuleCondition).where(
                        MaterialRuleCondition.group_id == group.id,
                        MaterialRuleCondition.attribute_name == condition_row["attribute_name"],
                        MaterialRuleCondition.operator == operator,
                        MaterialRuleCondition.comparison_value == comparison_value,
                        MaterialRuleCondition.comparison_value_secondary == comparison_value_secondary,
                    )
                )
                if existing is None:
                    self.session.add(
                        MaterialRuleCondition(
                            group=group,
                            attribute_name=condition_row["attribute_name"],
                            operator=operator,
                            comparison_value=comparison_value,
                            comparison_value_secondary=comparison_value_secondary,
                        )
                    )
                    self.stats["material_rule_conditions"] += 1

        self.material_rule_by_legacy_id[legacy_material_id] = rule

    def parse_condition_values(self, *, operator: str, raw_value: Any) -> tuple[str | None, str | None]:
        values = parse_string_list(raw_value)
        if operator == "IS NOT NULL":
            return None, None
        if operator == "BETWEEN":
            if len(values) >= 2:
                return values[0], values[1]
            text = collapse_legacy_value(raw_value)
            if text and "," in text:
                left, _, right = text.partition(",")
                return left.strip() or None, right.strip() or None
            self.warnings.append(f"BETWEEN condition {raw_value!r} did not contain two values.")
            return text, None
        if operator == "IN":
            return ",".join(values), None
        return collapse_legacy_value(raw_value), None

    def import_auxiliary_material(self, row: sqlite3.Row) -> None:
        legacy_id = int(row["auxiliary_id"])
        material = self.session.scalar(select(AuxiliaryMaterial).where(AuxiliaryMaterial.code == row["code"]))
        if material is None:
            material = AuxiliaryMaterial(
                code=row["code"],
                name=row["name"],
                category=normalize_text(row["category"]),
                price=float(row["price"]),
            )
            self.session.add(material)
            self.session.flush()
            self.stats["auxiliary_materials"] += 1
        self.auxiliary_by_legacy_id[legacy_id] = material

    def import_project(self, row: sqlite3.Row) -> Project:
        legacy_id = int(row["project_id"])
        project = self.session.scalar(select(Project).where(Project.name == row["name"]))
        if project is None:
            project = Project(
                name=row["name"],
                status=normalize_status(row["estado"]),
                created_at=parse_datetime(row["created_date"]) or datetime.now(UTC),
                updated_at=parse_datetime(row["modified_date"]) or datetime.now(UTC),
            )
            self.session.add(project)
            self.session.flush()
            self.stats["projects"] += 1
        self.project_by_legacy_id[legacy_id] = project
        return project

    def import_project_subtypes(self, project_id: int, rows: list[sqlite3.Row]) -> None:
        by_legacy_id = {int(row["subtype_id"]): row for row in rows}

        def import_subtype(legacy_id: int) -> ProjectSubtype:
            existing = self.subtype_by_legacy_id.get(legacy_id)
            if existing is not None:
                return existing
            row = by_legacy_id[legacy_id]
            project = self.project_by_legacy_id[int(row["project_id"])]
            parent = None
            if row["parent_subtype_id"] is not None:
                parent = import_subtype(int(row["parent_subtype_id"]))
            subtype = self.session.scalar(
                select(ProjectSubtype).where(
                    ProjectSubtype.project_id == project.id,
                    ProjectSubtype.parent_id == (parent.id if parent else None),
                    ProjectSubtype.name == row["name"],
                )
            )
            if subtype is None:
                subtype = ProjectSubtype(
                    project=project,
                    parent=parent,
                    name=row["name"],
                )
                self.session.add(subtype)
                self.session.flush()
                self.stats["subtypes"] += 1
            self.subtype_by_legacy_id[legacy_id] = subtype
            return subtype

        for row in rows:
            import_subtype(int(row["subtype_id"]))

    def import_project_instance(
        self,
        *,
        row: sqlite3.Row,
        component_type: ComponentType,
        legacy_component_key: tuple[str, int],
    ) -> ProjectInstance:
        legacy_instance_id = int(row["instance_id"] if "instance_id" in row.keys() else row["accessory_instance_id"])
        existing_mapped = self.instance_by_legacy_key.get(
            ("item", legacy_instance_id) if component_type == ComponentType.ITEM else ("accessory", legacy_instance_id)
        )
        if existing_mapped is not None:
            return existing_mapped

        project = self.project_by_legacy_id[int(row["project_id"])]
        component = self.component_by_legacy_key.get(legacy_component_key)
        if component is None:
            component = self.create_placeholder_component_from_instance(
                row=row,
                component_type=component_type,
                legacy_component_key=legacy_component_key,
            )
        instance = ProjectInstance(
            project=project,
            component=component,
            category_id=component.category_id,
            instance_type=component_type,
            name=row["name"],
            short_name=normalize_text(row["short_name"]),
            description=normalize_text(row["description"]),
            short_description=normalize_text(row["short_description"]),
            installation=normalize_text(row["installation"]),
        )
        self.session.add(instance)
        self.session.flush()
        self.stats["instances"] += 1
        sync_state = instance.sync_state
        if sync_state is None:
            self.session.add(
                ProjectInstanceSyncState(
                    instance=instance,
                    sync_status=SyncStatus.UP_TO_DATE,
                )
            )
        return instance

    def create_placeholder_component_from_instance(
        self,
        *,
        row: sqlite3.Row,
        component_type: ComponentType,
        legacy_component_key: tuple[str, int],
    ) -> CatalogComponent:
        existing = self.component_by_legacy_key.get(legacy_component_key)
        if existing is not None:
            return existing
        scope = CategoryScope.ITEM if component_type == ComponentType.ITEM else CategoryScope.ACCESSORY
        category = self.get_or_create_fallback_category(scope)
        component = self.session.scalar(
            select(CatalogComponent).where(
                CatalogComponent.category_id == category.id,
                CatalogComponent.component_type == component_type,
                CatalogComponent.name == f"Legacy missing {legacy_component_key[0]} {legacy_component_key[1]}",
            )
        )
        if component is None:
            component = CatalogComponent(
                category=category,
                component_type=component_type,
                name=f"Legacy missing {legacy_component_key[0]} {legacy_component_key[1]}",
                short_name=normalize_text(row["short_name"]),
                description=normalize_text(row["description"]),
                short_description=normalize_text(row["short_description"]),
                installation=normalize_text(row["installation"]),
            )
            self.session.add(component)
            self.session.flush()
            self.stats["placeholder_components"] += 1
            self.warnings.append(
                f"Created placeholder component for missing legacy {legacy_component_key[0]} id {legacy_component_key[1]}."
            )
        self.component_by_legacy_key[legacy_component_key] = component
        return component

    def get_or_create_fallback_category(self, scope: CategoryScope) -> CatalogCategory:
        cached = self.fallback_category_by_scope.get(scope)
        if cached is not None:
            return cached
        name = "Legacy imported items" if scope == CategoryScope.ITEM else "Legacy imported accessories"
        category = self.session.scalar(
            select(CatalogCategory).where(
                CatalogCategory.name == name,
                CatalogCategory.parent_id.is_(None),
            )
        )
        if category is None:
            category = CatalogCategory(
                name=name,
                scope=scope,
                sort_order=9999,
            )
            self.session.add(category)
            self.session.flush()
            self.stats["fallback_categories"] += 1
        self.fallback_category_by_scope[scope] = category
        return category

    def import_base_attribute_group(self, instance: ProjectInstance, attribute_rows: list[sqlite3.Row]) -> None:
        if not attribute_rows:
            return
        group = self.session.scalar(
            select(ProjectInstanceAttributeGroup).where(
                ProjectInstanceAttributeGroup.instance_id == instance.id,
                ProjectInstanceAttributeGroup.application_label.is_(None),
                ProjectInstanceAttributeGroup.name == "Imported attributes",
            )
        )
        if group is None:
            group = ProjectInstanceAttributeGroup(
                instance=instance,
                name="Imported attributes",
                application_label=None,
                sort_order=1,
            )
            self.session.add(group)
            self.session.flush()
            self.stats["attribute_groups"] += 1
        for index, row in enumerate(attribute_rows, start=1):
            value = collapse_legacy_value(row["value"])
            existing = self.session.scalar(
                select(ProjectInstanceAttributeValue).where(
                    ProjectInstanceAttributeValue.group_id == group.id,
                    ProjectInstanceAttributeValue.attribute_name == row["name"],
                )
            )
            if existing is None:
                self.session.add(
                    ProjectInstanceAttributeValue(
                        group=group,
                        attribute_name=row["name"],
                        value=value,
                        sort_order=index,
                    )
                )
                self.stats["attribute_values"] += 1
            else:
                existing.value = value

    def import_accessory_groups_and_occurrences(self, instance: ProjectInstance, attribute_rows: list[sqlite3.Row]) -> None:
        if not attribute_rows:
            return

        grouped_rows: dict[tuple[str | None, str | None], list[sqlite3.Row]] = defaultdict(list)
        for row in attribute_rows:
            group_key = normalize_text(row["group_id"])
            application_label = normalize_text(row["application"])
            grouped_rows[(group_key, application_label)].append(row)

        target_lookup = self.build_project_instance_name_lookup(instance.project_id, ComponentType.ITEM)
        group_index = 0
        for (_, application_label), rows in grouped_rows.items():
            group_index += 1
            group_name = application_label or f"Imported usage {group_index}"
            group = self.session.scalar(
                select(ProjectInstanceAttributeGroup).where(
                    ProjectInstanceAttributeGroup.instance_id == instance.id,
                    ProjectInstanceAttributeGroup.name == group_name,
                    ProjectInstanceAttributeGroup.application_label == application_label,
                )
            )
            if group is None:
                group = ProjectInstanceAttributeGroup(
                    instance=instance,
                    name=group_name,
                    application_label=application_label,
                    sort_order=group_index,
                )
                self.session.add(group)
                self.session.flush()
                self.stats["attribute_groups"] += 1

            occurrence_values: dict[str, str | None] = {}
            for index, row in enumerate(rows, start=1):
                value = collapse_legacy_value(row["value"])
                occurrence_values[row["name"]] = value
                existing = self.session.scalar(
                    select(ProjectInstanceAttributeValue).where(
                        ProjectInstanceAttributeValue.group_id == group.id,
                        ProjectInstanceAttributeValue.attribute_name == row["name"],
                    )
                )
                if existing is None:
                    self.session.add(
                        ProjectInstanceAttributeValue(
                            group=group,
                            attribute_name=row["name"],
                            value=value,
                            sort_order=index,
                        )
                    )
                    self.stats["attribute_values"] += 1
                else:
                    existing.value = value

            if application_label is None and len(grouped_rows) == 1:
                continue

            target_instance = target_lookup.get((application_label or "").casefold()) if application_label else None
            occurrence = self.session.scalar(
                select(ProjectInstanceOccurrence).where(
                    ProjectInstanceOccurrence.source_instance_id == instance.id,
                    ProjectInstanceOccurrence.relationship_type == "applied_to",
                    ProjectInstanceOccurrence.context_label == application_label,
                    ProjectInstanceOccurrence.sort_order == group_index,
                )
            )
            if occurrence is None:
                occurrence = ProjectInstanceOccurrence(
                    source_instance=instance,
                    relationship_type="applied_to",
                    context_label=application_label,
                    sort_order=group_index,
                )
                self.session.add(occurrence)
                self.session.flush()
                self.stats["occurrences"] += 1

            if target_instance is not None:
                existing_target = self.session.scalar(
                    select(ProjectInstanceOccurrenceTarget).where(
                        ProjectInstanceOccurrenceTarget.occurrence_id == occurrence.id,
                        ProjectInstanceOccurrenceTarget.target_instance_id == target_instance.id,
                    )
                )
                if existing_target is None:
                    self.session.add(
                        ProjectInstanceOccurrenceTarget(
                            occurrence=occurrence,
                            target_instance=target_instance,
                            sort_order=1,
                        )
                    )
                    self.stats["occurrence_targets"] += 1
                self.import_legacy_link(parent_instance=target_instance, child_instance=instance, application_label=application_label)
            elif application_label:
                self.warnings.append(
                    f"Could not match accessory application {application_label!r} to an item instance in project {instance.project.name!r}."
                )

            for index, (name, value) in enumerate(sorted(occurrence_values.items()), start=1):
                existing_value = self.session.scalar(
                    select(ProjectInstanceOccurrenceAttributeValue).where(
                        ProjectInstanceOccurrenceAttributeValue.occurrence_id == occurrence.id,
                        ProjectInstanceOccurrenceAttributeValue.attribute_name == name,
                    )
                )
                if existing_value is None:
                    self.session.add(
                        ProjectInstanceOccurrenceAttributeValue(
                            occurrence=occurrence,
                            attribute_name=name,
                            value=value,
                            sort_order=index,
                        )
                    )
                    self.stats["occurrence_attribute_values"] += 1
                else:
                    existing_value.value = value

    def build_project_instance_name_lookup(
        self,
        project_id: int,
        instance_type: ComponentType,
    ) -> dict[str, ProjectInstance]:
        matches = self.session.scalars(
            select(ProjectInstance).where(
                ProjectInstance.project_id == project_id,
                ProjectInstance.instance_type == instance_type,
            )
        ).all()
        lookup: dict[str, ProjectInstance] = {}
        for row in matches:
            key = row.name.casefold()
            lookup.setdefault(key, row)
        return lookup

    def import_legacy_link(
        self,
        *,
        parent_instance: ProjectInstance,
        child_instance: ProjectInstance,
        application_label: str | None,
    ) -> None:
        existing = self.session.scalar(
            select(ProjectInstanceLink).where(
                ProjectInstanceLink.parent_instance_id == parent_instance.id,
                ProjectInstanceLink.child_instance_id == child_instance.id,
                ProjectInstanceLink.relationship_type == "applied_accessory",
                ProjectInstanceLink.application_label == (application_label or ""),
            )
        )
        if existing is None:
            self.session.add(
                ProjectInstanceLink(
                    parent_instance=parent_instance,
                    child_instance=child_instance,
                    relationship_type="applied_accessory",
                    application_label=application_label or "",
                    sort_order=1,
                )
            )
            self.stats["instance_links"] += 1

    def import_auxiliary_selection(self, row: sqlite3.Row) -> None:
        project = self.project_by_legacy_id.get(int(row["project_id"]))
        auxiliary = self.auxiliary_by_legacy_id.get(int(row["auxiliary_id"]))
        if project is None or auxiliary is None:
            self.warnings.append(f"Skipping auxiliary selection {dict(row)} because the project or material is missing.")
            return
        subtype = self.subtype_by_legacy_id.get(int(row["subtype_id"])) if row["subtype_id"] is not None else None
        existing = self.session.scalar(
            select(ProjectAuxiliaryMaterialSelection).where(
                ProjectAuxiliaryMaterialSelection.project_id == project.id,
                ProjectAuxiliaryMaterialSelection.auxiliary_material_id == auxiliary.id,
            )
        )
        if existing is None:
            self.session.add(
                ProjectAuxiliaryMaterialSelection(
                    project=project,
                    auxiliary_material=auxiliary,
                    subtype=subtype,
                )
            )
            self.stats["project_auxiliary_materials"] += 1
        else:
            existing.subtype = subtype

    def import_export_setting(self, row: sqlite3.Row) -> None:
        project = self.project_by_legacy_id.get(int(row["project_id"]))
        instance_key = (normalize_text(row["instance_type"]) or "", int(row["instance_id"]))
        if instance_key[0] == "item":
            instance = self.instance_by_legacy_key.get(("item", instance_key[1]))
        else:
            instance = self.instance_by_legacy_key.get(("accessory", instance_key[1]))
        if project is None or instance is None:
            self.warnings.append(f"Skipping export setting {dict(row)} because the project or instance is missing.")
            return
        from app.models import InstanceExportSetting

        target = normalize_text(row["target"]) or "commercial"
        settings = parse_json_like(row["settings"])
        if not isinstance(settings, dict):
            settings = {"legacy_value": settings}
        existing = self.session.scalar(
            select(InstanceExportSetting).where(
                InstanceExportSetting.project_id == project.id,
                InstanceExportSetting.instance_id == instance.id,
                InstanceExportSetting.target == target,
            )
        )
        if existing is None:
            self.session.add(
                InstanceExportSetting(
                    project=project,
                    instance=instance,
                    target=target,
                    settings=settings,
                    created_at=parse_datetime(row["created_date"]) or datetime.now(UTC),
                    updated_at=parse_datetime(row["modified_date"]) or datetime.now(UTC),
                )
            )
            self.stats["export_settings"] += 1
        else:
            existing.settings = settings

    def import_project_material_modes(
        self,
        projects: list[sqlite3.Row],
        material_config_rows: dict[int, list[sqlite3.Row]],
        bom_rows: list[sqlite3.Row],
    ) -> None:
        bom_by_project: dict[int, list[sqlite3.Row]] = defaultdict(list)
        for row in bom_rows:
            bom_by_project[int(row["project_id"])].append(row)

        for project_row in projects:
            project = self.project_by_legacy_id[int(project_row["project_id"])]
            mode = MaterialMode.GENERAL
            if any(bool(row["is_per_subtype"]) for row in material_config_rows.get(int(project_row["project_id"]), [])):
                mode = MaterialMode.PER_SUBTYPE
            elif any(row["subtype_id"] is not None for row in bom_by_project.get(int(project_row["project_id"]), [])):
                mode = MaterialMode.PER_SUBTYPE

            existing = self.session.scalar(
                select(ProjectMaterialMode).where(ProjectMaterialMode.project_id == project.id)
            )
            if existing is None:
                self.session.add(ProjectMaterialMode(project=project, mode=mode, updated_at=project.updated_at))
                self.stats["project_material_modes"] += 1
            else:
                existing.mode = mode
                existing.updated_at = project.updated_at

    def import_bom_row(self, row: sqlite3.Row) -> None:
        project = self.project_by_legacy_id.get(int(row["project_id"]))
        subtype = self.subtype_by_legacy_id.get(int(row["subtype_id"])) if row["subtype_id"] is not None else None
        rule = self.material_rule_by_legacy_id.get(int(row["material_id"]))
        if row["item_instance_id"] is not None:
            instance = self.instance_by_legacy_key.get(("item", int(row["item_instance_id"])))
        else:
            instance = self.instance_by_legacy_key.get(("accessory", int(row["accessory_instance_id"])))
        if rule is None and instance is not None:
            rule = self.create_placeholder_rule_for_missing_bom_material(instance=instance, row=row)
        if project is None or instance is None or rule is None:
            self.warnings.append(f"Skipping BOM row {dict(row)} because one or more targets could not be mapped.")
            return
        key = (project.id, instance.id, rule.id, subtype.id if subtype else None)
        existing = self.bom_entry_by_key.get(key)
        if existing is None:
            existing = self.session.scalar(
                select(ProjectBomEntry).where(
                    ProjectBomEntry.project_id == project.id,
                    ProjectBomEntry.instance_id == instance.id,
                    ProjectBomEntry.material_rule_id == rule.id,
                    ProjectBomEntry.subtype_id == (subtype.id if subtype else None),
                )
            )
        if existing is None:
            existing = ProjectBomEntry(
                project=project,
                instance=instance,
                material_rule=rule,
                material=rule.material,
                subtype=subtype,
                quantity=float(row["quantity"]) if row["quantity"] is not None else None,
                assembly_quantity=float(row["assembly_kit"]) if row["assembly_kit"] is not None else None,
                unit=normalize_text(row["unit"]) or rule.unit or rule.material.unit,
                calculation_mode=BomCalculationMode.MANUAL,
                calculation_formula=None,
            )
            self.session.add(existing)
            self.bom_entry_by_key[key] = existing
            self.stats["bom_entries"] += 1
        else:
            if key in self.bom_entry_by_key:
                self.warnings.append(
                    f"Duplicate legacy BOM row for project {row['project_id']}, material {row['material_id']}, instance {row['item_instance_id'] or row['accessory_instance_id']}; keeping the later values."
                )
            else:
                self.bom_entry_by_key[key] = existing
            existing.quantity = float(row["quantity"]) if row["quantity"] is not None else None
            existing.assembly_quantity = float(row["assembly_kit"]) if row["assembly_kit"] is not None else None
            existing.unit = normalize_text(row["unit"]) or existing.unit

    def create_placeholder_rule_for_missing_bom_material(
        self,
        *,
        instance: ProjectInstance,
        row: sqlite3.Row,
    ) -> ComponentMaterialRule:
        legacy_material_id = int(row["material_id"])
        cache_key = (instance.component_id, legacy_material_id)
        cached = self.fallback_material_rule_by_key.get(cache_key)
        if cached is not None:
            return cached

        sku = f"LEGACY-MATERIAL-{legacy_material_id}"
        material = self.material_by_sku.get(sku)
        if material is None:
            material = self.session.scalar(select(Material).where(Material.sku == sku))
            if material is None:
                material = Material(
                    sku=sku,
                    name=f"Legacy missing material {legacy_material_id}",
                    unit=normalize_text(row["unit"]),
                )
                self.session.add(material)
                self.session.flush()
                self.stats["placeholder_materials"] += 1
                self.warnings.append(f"Created placeholder material for missing legacy material id {legacy_material_id}.")
            self.material_by_sku[sku] = material

        rule = self.session.scalar(
            select(ComponentMaterialRule).where(
                ComponentMaterialRule.component_id == instance.component_id,
                ComponentMaterialRule.material_id == material.id,
            )
        )
        if rule is None:
            next_display_order = len(instance.component.material_rules) + 1000
            rule = ComponentMaterialRule(
                component=instance.component,
                material=material,
                display_order=next_display_order,
                unit=normalize_text(row["unit"]) or material.unit,
            )
            self.session.add(rule)
            self.session.flush()
            self.stats["placeholder_material_rules"] += 1
        self.material_rule_by_legacy_id[legacy_material_id] = rule
        self.fallback_material_rule_by_key[cache_key] = rule
        return rule

    def import_comment(self, row: sqlite3.Row) -> None:
        project = self.project_by_legacy_id.get(int(row["project_id"]))
        if project is None:
            self.warnings.append(f"Skipping comment {row['comment_id']} because the project is missing.")
            return
        if row["item_instance_id"] is not None:
            instance = self.instance_by_legacy_key.get(("item", int(row["item_instance_id"])))
        else:
            instance = self.instance_by_legacy_key.get(("accessory", int(row["accessory_instance_id"]))) if row["accessory_instance_id"] is not None else None
        author = self.ensure_legacy_user(normalize_text(row["author_username"])) or self.legacy_system_user()
        parent = self.comment_by_legacy_id.get(int(row["parent_comment_id"])) if row["parent_comment_id"] is not None else None
        created_at = parse_datetime(row["created_at"]) or datetime.now(UTC)
        existing = self.session.scalar(
            select(ProjectComment).where(
                ProjectComment.project_id == project.id,
                ProjectComment.instance_id == (instance.id if instance else None),
                ProjectComment.author_user_id == (author.id if author else None),
                ProjectComment.body == row["body"],
                ProjectComment.created_at == created_at,
            )
        )
        if existing is None:
            existing = ProjectComment(
                project=project,
                instance=instance,
                parent_comment=parent,
                author=author,
                body=row["body"],
                created_at=created_at,
                updated_at=parse_datetime(row["updated_at"]) or created_at,
            )
            self.session.add(existing)
            self.session.flush()
            self.stats["comments"] += 1
        self.comment_by_legacy_id[int(row["comment_id"])] = existing

    def import_comment_mentions(self, legacy_comment_id: int, rows: list[sqlite3.Row]) -> None:
        comment = self.comment_by_legacy_id.get(legacy_comment_id)
        if comment is None:
            return
        for row in rows:
            user = self.ensure_legacy_user(normalize_text(row["mentioned_username"]))
            if user is None:
                continue
            existing = self.session.scalar(
                select(CommentMention).where(
                    CommentMention.comment_id == comment.id,
                    CommentMention.mentioned_user_id == user.id,
                )
            )
            if existing is None:
                self.session.add(CommentMention(comment=comment, user=user))
                self.stats["comment_mentions"] += 1

    def import_comment_notifications(self, legacy_comment_id: int, rows: list[sqlite3.Row]) -> None:
        comment = self.comment_by_legacy_id.get(legacy_comment_id)
        if comment is None:
            return
        for row in rows:
            user = self.ensure_legacy_user(normalize_text(row["username"]))
            if user is None:
                continue
            raw_type = (normalize_text(row["notification_type"]) or "mention").casefold()
            notification_type = NotificationType.COMMENT_REPLY if raw_type == "reply" else NotificationType.COMMENT_MENTION
            existing = self.session.scalar(
                select(CommentNotification).where(
                    CommentNotification.user_id == user.id,
                    CommentNotification.comment_id == comment.id,
                    CommentNotification.notification_type == notification_type,
                )
            )
            if existing is None:
                self.session.add(
                    CommentNotification(
                        user=user,
                        comment=comment,
                        notification_type=notification_type,
                        route=f"/projects/{comment.project_id}",
                        is_read=bool(row["is_read"]),
                        created_at=parse_datetime(row["created_at"]) or datetime.now(UTC),
                    )
                )
                self.stats["comment_notifications"] += 1

    def import_changelog_row(self, row: sqlite3.Row) -> None:
        project = self.project_by_legacy_id.get(int(row["project_id"]))
        if project is None:
            self.warnings.append(f"Skipping changelog row {row['log_id']} because the project is missing.")
            return
        created_at = parse_datetime(row["timestamp"]) or datetime.now(UTC)
        actor = self.ensure_legacy_user(normalize_text(row["user_id"]))
        entity_id: int | None = None
        entity_text = normalize_text(row["entity_id"])
        if entity_text and entity_text.isdigit():
            entity_id = int(entity_text)
        details = {
            "legacy_log_id": row["log_id"],
            "legacy_field_name": normalize_text(row["field_name"]),
            "legacy_old_value": normalize_text(row["old_value"]),
            "legacy_new_value": normalize_text(row["new_value"]),
            "legacy_details": normalize_text(row["details"]),
            "legacy_project_status": normalize_text(row["project_estado"]),
            "legacy_entity_id": entity_text if entity_id is None else None,
            "legacy_approved_by": normalize_text(row["approved_by"]),
            "legacy_approved_date": normalize_text(row["approved_date"]),
        }
        existing = self.session.scalar(
            select(ProjectActivityLog).where(
                ProjectActivityLog.project_id == project.id,
                ProjectActivityLog.created_at == created_at,
                ProjectActivityLog.entity_type == (normalize_text(row["entity_type"]) or "LegacyEntity"),
                ProjectActivityLog.action == action_label(row["action"]),
            )
        )
        if existing is None:
            self.session.add(
                ProjectActivityLog(
                    project=project,
                    actor=actor,
                    entity_type=normalize_text(row["entity_type"]) or "LegacyEntity",
                    entity_id=entity_id,
                    action=action_label(row["action"]),
                    details=details,
                    created_at=created_at,
                )
            )
            self.stats["activity_logs"] += 1

        approved_by = normalize_text(row["approved_by"])
        if approved_by:
            approver = self.ensure_legacy_user(approved_by)
            summary = normalize_text(row["details"]) or normalize_text(row["action"]) or "Imported legacy approval"
            existing_approval = self.session.scalar(
                select(ProjectApproval).where(
                    ProjectApproval.project_id == project.id,
                    ProjectApproval.summary == summary,
                    ProjectApproval.created_at == created_at,
                )
            )
            if existing_approval is None:
                self.session.add(
                    ProjectApproval(
                        project=project,
                        requested_by=actor or approver or self.legacy_system_user(),
                        decided_by=approver,
                        status=ApprovalStatus.APPROVED,
                        summary=summary,
                        created_at=created_at,
                        decided_at=parse_datetime(row["approved_date"]) or created_at,
                    )
                )
                self.stats["approvals"] += 1

    def ensure_legacy_user(self, username: str | None) -> User | None:
        if not username:
            return None
        cached = self.user_by_username.get(username.casefold())
        if cached is not None:
            return cached

        user = self.session.scalar(select(User).where(User.username == username))
        if user is None:
            clean_username = sanitize_username(username)
            user = self.session.scalar(select(User).where(User.username == clean_username))
            if user is None:
                base_email_local = clean_username.replace(" ", "_")
                email = f"{base_email_local}@{self.legacy_email_domain}"
                suffix = 1
                while self.session.scalar(select(User).where(User.email == email)) is not None:
                    suffix += 1
                    email = f"{base_email_local}_{suffix}@{self.legacy_email_domain}"
                user = User(
                    username=clean_username,
                    display_name=username,
                    email=email,
                    is_active=False,
                    created_at=datetime.now(UTC),
                )
                self.session.add(user)
                self.session.flush()
                self.stats["users"] += 1
        self.user_by_username[username.casefold()] = user
        return user

    def legacy_system_user(self) -> User:
        user = self.ensure_legacy_user("legacy_system")
        if user is None:
            raise RuntimeError("Failed to create fallback legacy_system user.")
        return user


def main() -> int:
    args = parse_args()
    settings = Settings()
    database_url = args.database_url or settings.database_url
    engine = create_engine_for_url(
        database_url,
        connect_timeout_seconds=settings.database_connect_timeout_seconds,
        statement_timeout_ms=settings.database_statement_timeout_ms,
    )
    try:
        if not schema_is_ready(engine):
            print("Target database schema is missing. Run `alembic upgrade head` first.", file=sys.stderr)
            return 1
    except OperationalError as exc:
        print(
            "Could not connect to the target database.\n"
            f"Database URL: {database_url}\n"
            "Check that PostgreSQL is running, the URL is correct, and the database is reachable.",
            file=sys.stderr,
        )
        print(f"Driver error: {exc}", file=sys.stderr)
        return 1

    session_factory = create_session_factory(
        database_url,
        connect_timeout_seconds=settings.database_connect_timeout_seconds,
        statement_timeout_ms=settings.database_statement_timeout_ms,
    )

    main_conn = connect_sqlite(args.main_db)
    projects_conn = connect_sqlite(args.projects_db)
    try:
        with session_factory() as session:
            importer = LegacyImporter(
                session=session,
                main_conn=main_conn,
                projects_conn=projects_conn,
                legacy_email_domain=args.legacy_email_domain,
            )
            try:
                importer.run()
                if args.dry_run:
                    session.rollback()
                else:
                    session.commit()
            except Exception:
                session.rollback()
                raise

            print("Legacy import summary")
            for key in sorted(importer.stats):
                print(f"- {key}: {importer.stats[key]}")
            if importer.warnings:
                print("\nWarnings")
                for warning in importer.warnings:
                    print(f"- {warning}")
            if args.dry_run:
                print("\nDry run only; no changes were committed.")
    finally:
        main_conn.close()
        projects_conn.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
