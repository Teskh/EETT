from __future__ import annotations

import unittest

from app.models import Material, Project, ProjectBomEntry, ProjectSubtype
from app.services.effective_bom import build_project_expected_quantity_map, selectable_subtypes, subtype_path


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


if __name__ == "__main__":
    unittest.main()
