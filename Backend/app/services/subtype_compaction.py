from __future__ import annotations

from collections.abc import Callable
from typing import Any


RowSignature = Callable[[dict[str, Any]], object]
_SUBTYPE_PATH_SEPARATOR = "\u203a"


def compact_subtype_rows(
    rows: list[dict[str, Any]],
    subtype_nodes: list[dict[str, Any]],
    *,
    signature: RowSignature,
) -> list[dict[str, Any]]:
    """Keep parent rows and omit descendant variants that carry no distinct value."""

    if not rows:
        return rows

    roots, children_by_id, known_ids, path_to_id = _variant_tree(subtype_nodes)
    rows_by_id: dict[int, dict[str, Any]] = {}
    resolved_id_by_index: dict[int, int] = {}

    def resolve_rows() -> None:
        rows_by_id.clear()
        resolved_id_by_index.clear()
        for index, row in enumerate(rows):
            subtype_id = _coerce_subtype_id(row.get("subtype_id"))
            if subtype_id not in known_ids:
                subtype_id = path_to_id.get(_normalize_path(row.get("subtype")))
            if subtype_id in known_ids:
                rows_by_id[subtype_id] = row
                resolved_id_by_index[index] = subtype_id

    resolve_rows()

    unresolved_subtype_rows = [
        row
        for index, row in enumerate(rows)
        if index not in resolved_id_by_index and _normalize_path(row.get("subtype")) not in {"", "general"}
    ]
    if unresolved_subtype_rows or not known_ids:
        roots, children_by_id, known_ids, path_to_id = _path_tree_from_rows(rows)
        resolve_rows()

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

    compacted: list[dict[str, Any]] = [
        row for index, row in enumerate(rows) if index not in resolved_id_by_index
    ]
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
        for index, row in enumerate(rows)
        if index in resolved_id_by_index and resolved_id_by_index[index] not in emitted_ids
    )
    return compacted


def _variant_tree(
    nodes: list[dict[str, Any]],
) -> tuple[list[int], dict[int, list[int]], set[int], dict[str, int]]:
    roots: list[int] = []
    children_by_id: dict[int, list[int]] = {}
    known_ids: set[int] = set()
    path_to_id: dict[str, int] = {}

    def visit(node: dict[str, Any], parent_variant_id: int | None, parent_path: str = "") -> None:
        is_variant = str(node.get("kind") or "variant").lower() == "variant"
        next_parent_id = parent_variant_id
        node_path = _normalize_path(node.get("path") or "")
        if not node_path:
            node_name = str(node.get("name") or "").strip()
            node_path = _normalize_path(
                f"{parent_path} {_SUBTYPE_PATH_SEPARATOR} {node_name}" if parent_path and node_name else node_name
            )
        if is_variant and node.get("id") is not None:
            subtype_id = int(node["id"])
            known_ids.add(subtype_id)
            if node_path:
                path_to_id[node_path] = subtype_id
            if parent_variant_id is None:
                roots.append(subtype_id)
            else:
                children_by_id.setdefault(parent_variant_id, []).append(subtype_id)
            next_parent_id = subtype_id
        for child in node.get("children", []):
            visit(child, next_parent_id, node_path)

    for node in nodes:
        visit(node, None)
    return roots, children_by_id, known_ids, path_to_id


def _path_tree_from_rows(
    rows: list[dict[str, Any]],
) -> tuple[list[int], dict[int, list[int]], set[int], dict[str, int]]:
    """Build a best-effort variant tree from the paths actually rendered in an export."""

    path_to_id: dict[str, int] = {}
    for index, row in enumerate(rows):
        path = _normalize_path(row.get("subtype"))
        if path and path != "general":
            path_to_id.setdefault(path, -(index + 1))

    roots: list[int] = []
    children_by_id: dict[int, list[int]] = {}
    known_ids = set(path_to_id.values())
    for path, subtype_id in sorted(
        path_to_id.items(),
        key=lambda item: (item[0].count(_SUBTYPE_PATH_SEPARATOR), item[0]),
    ):
        parts = [part.strip() for part in path.split(_SUBTYPE_PATH_SEPARATOR)]
        parent_id = None
        for parent_length in range(len(parts) - 1, 0, -1):
            parent_path = _normalize_path(
                f" {_SUBTYPE_PATH_SEPARATOR} ".join(parts[:parent_length])
            )
            parent_id = path_to_id.get(parent_path)
            if parent_id is not None:
                break
        if parent_id is None:
            roots.append(subtype_id)
        else:
            children_by_id.setdefault(parent_id, []).append(subtype_id)
    return roots, children_by_id, known_ids, path_to_id


def _coerce_subtype_id(value: object) -> int | None:
    try:
        return None if value is None else int(value)
    except (TypeError, ValueError):
        return None


def _normalize_path(value: object) -> str:
    return " ".join(str(value or "").strip().split()).lower()
