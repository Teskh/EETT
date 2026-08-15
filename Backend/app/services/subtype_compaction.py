from __future__ import annotations

from collections.abc import Callable
from typing import Any


RowSignature = Callable[[dict[str, Any]], object]


def compact_subtype_rows(
    rows: list[dict[str, Any]],
    subtype_nodes: list[dict[str, Any]],
    *,
    signature: RowSignature,
) -> list[dict[str, Any]]:
    """Keep parent rows and omit descendant variants that carry no distinct value."""

    if not rows or not subtype_nodes:
        return rows

    roots, children_by_id, known_ids = _variant_tree(subtype_nodes)
    rows_by_id = {
        int(row["subtype_id"]): row
        for row in rows
        if row.get("subtype_id") is not None and int(row["subtype_id"]) in known_ids
    }
    descendants_by_id: dict[int, list[int]] = {}

    def descendants_of(subtype_id: int) -> list[int]:
        if subtype_id in descendants_by_id:
            return descendants_by_id[subtype_id]
        descendants = [
            descendant_id
            for child_id in children_by_id.get(subtype_id, [])
            for descendant_id in (child_id, *descendants_of(child_id))
        ]
        descendants_by_id[subtype_id] = descendants
        return descendants

    compacted: list[dict[str, Any]] = [row for row in rows if row.get("subtype_id") is None]
    emitted_ids: set[int] = set()

    def emit_branch(subtype_id: int) -> None:
        row = rows_by_id.get(subtype_id)
        if row is not None:
            compacted.append(row)
            emitted_ids.add(subtype_id)

        descendant_ids = descendants_of(subtype_id)
        uniform = bool(
            row is not None
            and descendant_ids
            and all(
                descendant_id in rows_by_id and signature(rows_by_id[descendant_id]) == signature(row)
                for descendant_id in descendant_ids
            )
        )
        if uniform:
            emitted_ids.update(descendant_ids)
            return

        for child_id in children_by_id.get(subtype_id, []):
            emit_branch(child_id)

    for root_id in roots:
        emit_branch(root_id)

    compacted.extend(
        row
        for row in rows
        if row.get("subtype_id") is not None and int(row["subtype_id"]) not in emitted_ids
    )
    return compacted


def _variant_tree(
    nodes: list[dict[str, Any]],
) -> tuple[list[int], dict[int, list[int]], set[int]]:
    roots: list[int] = []
    children_by_id: dict[int, list[int]] = {}
    known_ids: set[int] = set()

    def visit(node: dict[str, Any], parent_variant_id: int | None) -> None:
        is_variant = str(node.get("kind") or "variant").lower() == "variant"
        next_parent_id = parent_variant_id
        if is_variant and node.get("id") is not None:
            subtype_id = int(node["id"])
            known_ids.add(subtype_id)
            if parent_variant_id is None:
                roots.append(subtype_id)
            else:
                children_by_id.setdefault(parent_variant_id, []).append(subtype_id)
            next_parent_id = subtype_id
        for child in node.get("children", []):
            visit(child, next_parent_id)

    for node in nodes:
        visit(node, None)
    return roots, children_by_id, known_ids
