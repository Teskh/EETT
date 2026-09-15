from pathlib import Path
from types import SimpleNamespace as NS
import unittest

from app.services.export_projection import build_full_technical_export_sections


class FullTechnicalAccessoryTests(unittest.TestCase):
    def test_attached_accessory_has_full_entry_and_parent_mentions(self):
        def instance(id, name, kind):
            return NS(id=id, name=name, short_name=name, instance_type=NS(value=kind),
                      parent_links=[], child_links=[], occurrence_targets=[],
                      outgoing_occurrences=[], attribute_groups=[])

        parents = [instance(1, 'Muro', 'item'), instance(2, 'Cielo', 'item')]
        accessory = instance(3, 'Pintura', 'accessory')
        for parent in parents:
            target = NS(id=parent.id, target_instance=parent)
            occurrence = NS(id=parent.id, sort_order=0, source_instance=accessory,
                            context_label=parent.name, targets=[target], attribute_values=[])
            target.occurrence = occurrence
            parent.occurrence_targets.append(target)
            accessory.outgoing_occurrences.append(occurrence)
        project = NS(instances=[*parents, accessory])
        data = {'categories': [{'name': 'Terminaciones', 'instances': [
            {'id': i.id, 'name': i.name, 'type': i.instance_type.value,
             'description': 'Descripcion completa', 'installation': 'Dos manos',
             'materials': [{'material_name': 'Esmalte', 'sku': 'P1', 'unit': 'L',
                            'bom_entries': [{'quantity_state': 'value', 'quantity': 2}]}]}
            for i in project.instances
        ]}]}
        sections = build_full_technical_export_sections(project, data, static_dir=Path('.'))
        entries = sections[0]['instances']
        self.assertEqual([i['name'] for i in entries], ['Muro', 'Cielo', 'Pintura'])
        for parent in entries[:2]:
            self.assertEqual([a['name'] for a in parent['linked_accessories']], ['Pintura'])
        full = entries[2]
        self.assertEqual(full['description'], 'Descripcion completa')
        self.assertEqual(full['installation'], 'Dos manos')
        self.assertEqual([r['application'] for r in full['usage_rows']], ['Muro', 'Cielo'])
        self.assertEqual(full['materials'][0]['material_name'], 'Esmalte')

        data['categories'][0]['instances'][2]['export_settings'] = [
            {'target': 'full_technical_pdf', 'settings': {'include': False}}
        ]
        excluded = build_full_technical_export_sections(project, data, static_dir=Path('.'))
        self.assertEqual([i['name'] for i in excluded[0]['instances']], ['Muro', 'Cielo'])
