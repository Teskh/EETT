from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import Project, ProjectActivityGroup, ProjectActivityLog, User


@dataclass(slots=True)
class AuditContext:
    actor: User | None = None
    mutation_batch_id: str | None = None
    title: str | None = None
    scope_type: str | None = None
    scope_id: int | None = None


def _stringify_activity_value(value: Any) -> str | None:
    if value is None:
        return None
    if isinstance(value, bool):
        return "Yes" if value else "No"
    if isinstance(value, float):
        if value.is_integer():
            return str(int(value))
        return f"{value:g}"
    if isinstance(value, (int, str)):
        text = str(value).strip()
        return text or None
    if isinstance(value, list):
        parts = [_stringify_activity_value(item) for item in value]
        return ", ".join(part for part in parts if part) or None
    if isinstance(value, dict):
        return ", ".join(
            f"{key}: {formatted}"
            for key, item in value.items()
            if (formatted := _stringify_activity_value(item)) is not None
        ) or None
    text = str(value).strip()
    return text or None


def build_activity_change(label: str, before: Any = None, after: Any = None) -> dict[str, str | None]:
    return {
        "label": label.strip(),
        "before": _stringify_activity_value(before),
        "after": _stringify_activity_value(after),
    }


def build_activity_details(
    *,
    headline: str,
    subject_name: str | None = None,
    notes: list[str] | None = None,
    changes: list[dict[str, Any]] | None = None,
    kind: str | None = None,
    minor: bool = False,
) -> dict[str, Any]:
    normalized_notes = [note.strip() for note in (notes or []) if isinstance(note, str) and note.strip()]
    normalized_changes = [
        {
            "label": str(change.get("label", "")).strip(),
            "before": _stringify_activity_value(change.get("before")),
            "after": _stringify_activity_value(change.get("after")),
        }
        for change in (changes or [])
        if str(change.get("label", "")).strip()
    ]
    return {
        "headline": headline.strip(),
        "subject_name": (subject_name or "").strip() or None,
        "notes": normalized_notes,
        "changes": normalized_changes,
        "kind": (kind or "").strip() or None,
        "minor": bool(minor),
    }


def normalize_mutation_batch_id(value: str | None) -> str | None:
    if value is None:
        return None
    normalized = value.strip()
    return normalized[:80] if normalized else None


def build_audit_context(
    *,
    actor: User | None,
    mutation_batch_id: str | None,
    title: str | None = None,
    scope_type: str | None = None,
    scope_id: int | None = None,
) -> AuditContext:
    return AuditContext(
        actor=actor,
        mutation_batch_id=normalize_mutation_batch_id(mutation_batch_id),
        title=(title or "").strip() or None,
        scope_type=(scope_type or "").strip() or None,
        scope_id=scope_id,
    )


def ensure_activity_group(
    session: Session,
    *,
    project: Project,
    context: AuditContext,
    title: str | None = None,
    scope_type: str | None = None,
    scope_id: int | None = None,
) -> ProjectActivityGroup:
    resolved_title = (title or context.title or "").strip()
    resolved_scope_type = (scope_type or context.scope_type or "").strip() or None
    resolved_scope_id = scope_id if scope_id is not None else context.scope_id

    if context.mutation_batch_id and context.actor is not None:
        existing = session.scalar(
            select(ProjectActivityGroup).where(
                ProjectActivityGroup.project_id == project.id,
                ProjectActivityGroup.actor_user_id == context.actor.id,
                ProjectActivityGroup.mutation_batch_id == context.mutation_batch_id,
            )
        )
        if existing is not None:
            if resolved_title and not existing.title:
                existing.title = resolved_title
            if resolved_scope_type and not existing.scope_type:
                existing.scope_type = resolved_scope_type
            if resolved_scope_id is not None and existing.scope_id is None:
                existing.scope_id = resolved_scope_id
            return existing

    group = ProjectActivityGroup(
        project=project,
        actor=context.actor,
        mutation_batch_id=context.mutation_batch_id,
        title=resolved_title,
        scope_type=resolved_scope_type,
        scope_id=resolved_scope_id,
    )
    session.add(group)
    session.flush()
    return group


def record_project_activity(
    session: Session,
    *,
    project: Project,
    context: AuditContext,
    entity_type: str,
    entity_id: int | None,
    action: str,
    details: dict | None = None,
    title: str | None = None,
    scope_type: str | None = None,
    scope_id: int | None = None,
) -> ProjectActivityLog:
    group = ensure_activity_group(
        session,
        project=project,
        context=context,
        title=title,
        scope_type=scope_type,
        scope_id=scope_id,
    )
    entry = ProjectActivityLog(
        project=project,
        group=group,
        actor=context.actor,
        entity_type=entity_type,
        entity_id=entity_id,
        action=action,
        details=details or {},
    )
    session.add(entry)
    session.flush()
    return entry
