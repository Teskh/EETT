from __future__ import annotations

import unittest

from app.models import Material, Project, ProjectBomEntry, ProjectSubtype
from app.services.effective_bom import basis_quantity, build_project_expected_quantity_map, selectable_subtypes, subtype_path
from app.services.export_projection import iter_cost_model_rows


class EffectiveBomTests(unittest.TestCase):
    def _project(self) -> tuple[Project, ProjectSubtype, ProjectSubtype, ProjectSubtype, Material]:
        project = Project(id=1, name="Nested", status="execution")
        root = ProjectSubtype(id=10, project=project, name="THXS-A", kind="variant")
        child = ProjectSubtype(id=11, project=project, name="Espejada", kind="variant", parent=root)
        group = ProjectSubtype(id=12, project=project, name="Terminaciones", kind="group")
        material = Material(id=20, sku="SKU-1", name="Material", unit="un")
        return project, root, child, group, material

    def test_nested_variant_inherits_nearest_nonblank_quantity_and_ignores_dormant_general(self) -> None:
        project, root, child, _group, material = self._project()
        project.bom_entries = [
            ProjectBomEntry(
                id=1,
                project_id=project.id,
                instance_id=100,
                material_rule_id=200,
                material_id=material.id,
                material=material,
                subtype_id=None,
                quantity=99,
            ),
            ProjectBomEntry(
                id=2,
                project_id=project.id,
                instance_id=100,
                material_rule_id=200,
                material_id=material.id,
                material=material,
                subtype_id=root.id,
                subtype=root,
                quantity=5,
            ),
            ProjectBomEntry(
                id=3,
                project_id=project.id,
                instance_id=100,
                material_rule_id=200,
                material_id=material.id,
                material=material,
                subtype_id=child.id,
                subtype=child,
                quantity=None,
            ),
        ]

        result = build_project_expected_quantity_map(project)

        self.assertEqual(result["general"], {})
        self.assertEqual(result["by_subtype"][root.id], {"SKU-1": 5.0})
        self.assertEqual(result["by_subtype"][child.id], {"SKU-1": 5.0})
        self.assertEqual(result["missing_by_subtype"][child.id], 0)

    def test_zero_is_an_explicit_child_override(self) -> None:
        project, root, child, _group, material = self._project()
        project.bom_entries = [
            ProjectBomEntry(
                id=1,
                project_id=project.id,
                instance_id=100,
                material_rule_id=200,
                material_id=material.id,
                material=material,
                subtype_id=root.id,
                subtype=root,
                quantity=5,
            ),
            ProjectBomEntry(
                id=2,
                project_id=project.id,
                instance_id=100,
                material_rule_id=200,
                material_id=material.id,
                material=material,
                subtype_id=child.id,
                subtype=child,
                quantity=0,
            ),
        ]

        result = build_project_expected_quantity_map(project)
        self.assertEqual(result["by_subtype"][child.id], {"SKU-1": 0.0})

    def test_child_can_explicitly_add_to_inherited_quantity(self) -> None:
        project, root, child, _group, material = self._project()
        project.bom_entries = [
            ProjectBomEntry(
                id=1,
                project_id=project.id,
                instance_id=100,
                material_rule_id=200,
                material_id=material.id,
                material=material,
                subtype_id=root.id,
                subtype=root,
                quantity=5,
                inheritance_mode="override",
            ),
            ProjectBomEntry(
                id=2,
                project_id=project.id,
                instance_id=100,
                material_rule_id=200,
                material_id=material.id,
                material=material,
                subtype_id=child.id,
                subtype=child,
                quantity=2,
                inheritance_mode="add",
            ),
        ]

        result = build_project_expected_quantity_map(project)
        self.assertEqual(result["by_subtype"][child.id], {"SKU-1": 7.0})

    def test_groups_are_not_selectable_and_paths_are_unambiguous(self) -> None:
        project, root, child, group, _material = self._project()
        self.assertEqual([row.id for row in selectable_subtypes(project)], [root.id, child.id])
        self.assertEqual(subtype_path(child), "THXS-A › Espejada")
        self.assertNotIn(group.id, [row.id for row in selectable_subtypes(project)])

    def test_quantity_basis_picks_factory_site_or_both(self) -> None:
        # Q_fábrica blank is missing; Q_obra blank means nothing installed on site.
        self.assertEqual(basis_quantity(5, 2, "factory"), 5.0)
        self.assertEqual(basis_quantity(5, 2, "work"), 2.0)
        self.assertEqual(basis_quantity(5, 2, "total"), 7.0)
        self.assertEqual(basis_quantity(5, None, "work"), 0.0)
        self.assertIsNone(basis_quantity(None, 2, "total"))

        project, root, child, _group, material = self._project()
        site = Material(id=21, sku="SKU-2", name="Obra", unit="un")
        project.bom_entries = [
            ProjectBomEntry(id=1, project_id=project.id, instance_id=100, material_rule_id=200, material_id=material.id,
                            material=material, subtype_id=None, quantity=4, assembly_quantity=None),
            ProjectBomEntry(id=2, project_id=project.id, instance_id=101, material_rule_id=201, material_id=site.id,
                            material=site, subtype_id=root.id, subtype=root, quantity=1, assembly_quantity=3),
        ]
        self.assertEqual(build_project_expected_quantity_map(project, "factory")["general"], {"SKU-1": 4.0})
        work = build_project_expected_quantity_map(project, "work")
        self.assertEqual(work["general"], {"SKU-1": 0.0})
        self.assertEqual(work["by_subtype"][child.id], {"SKU-2": 3.0})
        self.assertEqual(build_project_expected_quantity_map(project, "total")["by_subtype"][root.id], {"SKU-2": 4.0})
        with self.assertRaises(ValueError):
            build_project_expected_quantity_map(project, "obra")

    def test_cost_model_rows_follow_the_basis_and_skip_what_is_not_installed_on_site(self) -> None:
        entry = lambda quantity, work: {"subtype": None, "subtype_id": None, "effective_quantity": quantity,
                                        "effective_quantity_state": "value" if quantity is not None else "blank",
                                        "effective_assembly_quantity": work, "effective_assembly_quantity_state": "value" if work is not None else "blank"}
        material = lambda sku, quantity, work: {"material_id": 1, "material_name": sku, "sku": sku, "unit": "un", "bom_entries": [entry(quantity, work)]}
        data = {"categories": [{"name": "Obra gruesa", "instances": [{"id": 1, "name": "Muro", "materials": [
            material("FAB", 4, None), material("OBRA", 2, 3), material("BLANK", None, None),
        ]}]}]}
        rows = lambda basis: {row["sku"]: (row["quantity"], row["quantity_state"]) for row in iter_cost_model_rows(data, basis)}
        self.assertEqual(rows("factory"), {"FAB": (4, "value"), "OBRA": (2, "value"), "BLANK": (None, "blank")})
        self.assertEqual(rows("work"), {"OBRA": (3.0, "value")})
        self.assertEqual(rows("total"), {"FAB": (4.0, "value"), "OBRA": (5.0, "value"), "BLANK": (None, "blank")})


if __name__ == "__main__":
    unittest.main()
