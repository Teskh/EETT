from __future__ import annotations

from datetime import datetime, timedelta
import re
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.orm import Session, selectinload

from app.models import (
    ApprovalStatus,
    CommentMention,
    CommentNotification,
    NotificationType,
    Project,
    ProjectActivityGroup,
    ProjectActivityLog,
    ProjectApproval,
    ProjectComment,
    ProjectInstance,
    ProjectStatus,
    User,
)
from app.models.entities import utcnow
from app.services.audit import build_activity_details, build_audit_context, ensure_activity_group, record_project_activity
from app.services.auth import can_view_project

MENTION_PATTERN = re.compile(r"@([a-zA-Z0-9_.-]+)")
LEGACY_SUBJECT_TOKEN_PATTERN = re.compile(r"[\w/-]{3,}", re.UNICODE)

PROJECT_STATUS_LABELS = {
    ProjectStatus.TEMPLATE.value: "Template",
    ProjectStatus.EXECUTION.value: "Execution",
    ProjectStatus.FINISHED.value: "Finished",
}


def get_project_comments(session: Session, project_id: int, *, instance_id: int | None = None, user: User | None = None) -> list[dict]:
    filters = [ProjectComment.project_id == project_id, ProjectComment.parent_comment_id.is_(None)]
    if instance_id is not None:
        filters.append(ProjectComment.instance_id == instance_id)
    comments = session.scalars(
        select(ProjectComment)
        .where(*filters)
        .options(
            selectinload(ProjectComment.author),
            selectinload(ProjectComment.instance),
            selectinload(ProjectComment.mentions).selectinload(CommentMention.user),
            selectinload(ProjectComment.replies).selectinload(ProjectComment.author),
            selectinload(ProjectComment.replies).selectinload(ProjectComment.instance),
            selectinload(ProjectComment.replies).selectinload(ProjectComment.mentions).selectinload(CommentMention.user),
        )
        .order_by(ProjectComment.created_at)
    ).all()
    return [_serialize_comment(comment, user=user) for comment in comments]


def get_comment_payload(session: Session, comment_id: int, *, user: User | None = None) -> dict | None:
    comment = session.scalar(
        select(ProjectComment)
        .where(ProjectComment.id == comment_id)
        .options(
            selectinload(ProjectComment.author),
            selectinload(ProjectComment.instance),
            selectinload(ProjectComment.mentions).selectinload(CommentMention.user),
            selectinload(ProjectComment.replies).selectinload(ProjectComment.author),
            selectinload(ProjectComment.replies).selectinload(ProjectComment.instance),
            selectinload(ProjectComment.replies).selectinload(ProjectComment.mentions).selectinload(CommentMention.user),
        )
    )
    if comment is None:
        return None
    return _serialize_comment(comment, user=user)


def add_project_comment(
    session: Session,
    *,
    project: Project,
    author: User,
    body: str,
    instance: ProjectInstance | None = None,
    parent_comment: ProjectComment | None = None,
    mutation_batch_id: str | None = None,
) -> ProjectComment:
    comment = ProjectComment(
        project=project,
        instance=instance,
        parent_comment=parent_comment,
        author=author,
        body=body.strip(),
    )
    session.add(comment)
    session.flush()

    mentioned_usernames = sorted(set(MENTION_PATTERN.findall(body)))
    mentioned_user_ids: set[int] = set()
    for username in mentioned_usernames:
        user = session.scalar(select(User).where(User.username == username))
        if user is None:
            continue
        mentioned_user_ids.add(user.id)
        session.add(CommentMention(comment=comment, user=user))
        if user.id != author.id:
            session.add(
                CommentNotification(
                    user=user,
                    comment=comment,
                    notification_type=NotificationType.COMMENT_MENTION,
                    route=_build_comment_route(project.id, comment.id),
                )
            )

    if parent_comment is not None and parent_comment.author_user_id != author.id and parent_comment.author_user_id not in mentioned_user_ids:
        session.add(
            CommentNotification(
                user=parent_comment.author,
                comment=comment,
                notification_type=NotificationType.COMMENT_REPLY,
                route=_build_comment_route(project.id, comment.id),
            )
        )

    audit_context = build_audit_context(
        actor=author,
        mutation_batch_id=mutation_batch_id,
        title="Comment added",
        scope_type="instance" if instance else "project",
        scope_id=instance.id if instance else project.id,
    )
    record_project_activity(
        session,
        project=project,
        context=audit_context,
        entity_type="ProjectComment",
        entity_id=comment.id,
        action="commented",
        title=f"Comment on {instance.name}" if instance else "Comment on project",
        scope_type="instance" if instance else "project",
        scope_id=instance.id if instance else project.id,
        details=build_activity_details(
            headline="Comment added",
            subject_name=instance.name if instance else project.name,
            notes=[
                _comment_preview(comment.body),
                "Reply to an earlier comment" if parent_comment else "",
                f"Mentioned: {', '.join(f'@{username}' for username in mentioned_usernames)}" if mentioned_usernames else "",
            ],
            kind="comment",
        ),
    )
    session.commit()
    session.refresh(comment)
    return comment


def delete_project_comment(session: Session, *, comment: ProjectComment, user: User) -> dict:
    if comment.author_user_id != user.id:
        raise PermissionError("No tienes permiso para eliminar este comentario.")

    has_replies = bool(comment.replies)
    comment_id = comment.id
    if not has_replies:
        session.delete(comment)
        session.commit()
        return {"ok": True, "comment_id": comment_id, "soft_deleted": False}

    if comment.deleted_at is None:
        comment.body = "[eliminado]"
        comment.deleted_at = utcnow()
        comment.mentions.clear()
        comment.notifications.clear()
    session.commit()
    return {"ok": True, "comment_id": comment_id, "soft_deleted": True}


def get_comment_context(session: Session, comment_id: int) -> dict | None:
    comment = session.scalar(
        select(ProjectComment)
        .where(ProjectComment.id == comment_id)
        .options(selectinload(ProjectComment.instance), selectinload(ProjectComment.project))
    )
    if comment is None:
        return None
    return {
        "project_id": comment.project_id,
        "instance_id": comment.instance_id,
        "comment_id": comment.id,
        "parent_comment_id": comment.parent_comment_id,
    }


def get_project_activity(session: Session, project_id: int) -> list[dict]:
    groups = session.scalars(
        select(ProjectActivityGroup)
        .where(ProjectActivityGroup.project_id == project_id)
        .options(
            selectinload(ProjectActivityGroup.project).selectinload(Project.instances),
            selectinload(ProjectActivityGroup.actor),
            selectinload(ProjectActivityGroup.events).selectinload(ProjectActivityLog.actor),
            selectinload(ProjectActivityGroup.approvals).selectinload(ProjectApproval.requested_by),
            selectinload(ProjectActivityGroup.approvals).selectinload(ProjectApproval.decided_by),
        )
        .order_by(ProjectActivityGroup.created_at.desc())
    ).all()
    return _merge_activity_groups([_serialize_activity_group(group) for group in groups])


def get_activity_history(session: Session, user: User) -> list[dict]:
    groups = session.scalars(
        select(ProjectActivityGroup)
        .options(
            selectinload(ProjectActivityGroup.project).selectinload(Project.instances),
            selectinload(ProjectActivityGroup.actor),
            selectinload(ProjectActivityGroup.events).selectinload(ProjectActivityLog.actor),
            selectinload(ProjectActivityGroup.approvals).selectinload(ProjectApproval.requested_by),
            selectinload(ProjectActivityGroup.approvals).selectinload(ProjectApproval.decided_by),
        )
        .order_by(ProjectActivityGroup.created_at.desc())
    ).all()
    return _merge_activity_groups([
        _serialize_activity_group(group)
        for group in groups
        if group.project is not None and can_view_project(user, group.project)
    ])


def get_project_approvals(session: Session, project_id: int) -> list[dict]:
    approvals = session.scalars(
        select(ProjectApproval)
        .where(ProjectApproval.project_id == project_id)
        .options(
            selectinload(ProjectApproval.requested_by),
            selectinload(ProjectApproval.decided_by),
        )
        .order_by(ProjectApproval.created_at.desc())
    ).all()
    return [
        {
            "id": approval.id,
            "status": approval.status.value,
            "summary": approval.summary,
            "requested_by": approval.requested_by.username,
            "decided_by": approval.decided_by.username if approval.decided_by else None,
            "created_at": approval.created_at.isoformat(),
            "decided_at": approval.decided_at.isoformat() if approval.decided_at else None,
        }
        for approval in approvals
    ]


def request_project_approval(
    session: Session,
    *,
    project: Project,
    requested_by: User,
    summary: str,
    mutation_batch_id: str | None = None,
) -> ProjectApproval:
    audit_context = build_audit_context(
        actor=requested_by,
        mutation_batch_id=mutation_batch_id,
        title="Approval requested",
        scope_type="project",
        scope_id=project.id,
    )
    activity_group = ensure_activity_group(session, project=project, context=audit_context)
    approval = ProjectApproval(
        project=project,
        activity_group=activity_group,
        requested_by=requested_by,
        status=ApprovalStatus.PENDING,
        summary=summary.strip(),
    )
    session.add(approval)
    session.flush()
    record_project_activity(
        session,
        project=project,
        context=audit_context,
        entity_type="ProjectApproval",
        entity_id=approval.id,
        action="approval_requested",
        title="Approval requested",
        scope_type="project",
        scope_id=project.id,
        details=build_activity_details(
            headline="Approval requested",
            subject_name=project.name,
            notes=[approval.summary],
            kind="approval",
        ),
    )
    session.commit()
    session.refresh(approval)
    return approval


def decide_project_approval(
    session: Session,
    *,
    approval_id: int,
    decided_by: User,
    status: str,
    mutation_batch_id: str | None = None,
) -> ProjectApproval | None:
    approval = session.scalar(
        select(ProjectApproval)
        .where(ProjectApproval.id == approval_id)
        .options(selectinload(ProjectApproval.project))
    )
    if approval is None:
        return None

    approval.status = ApprovalStatus(status)
    approval.decided_by = decided_by
    approval.decided_at = utcnow()
    audit_context = build_audit_context(
        actor=decided_by,
        mutation_batch_id=mutation_batch_id,
        title=f"Approval {approval.status.value}",
        scope_type="project",
        scope_id=approval.project_id,
    )
    approval.activity_group = ensure_activity_group(session, project=approval.project, context=audit_context)
    record_project_activity(
        session,
        project=approval.project,
        context=audit_context,
        entity_type="ProjectApproval",
        entity_id=approval.id,
        action=f"approval_{approval.status.value}",
        title=f"{approval.status.value.capitalize()} project changes",
        scope_type="project",
        scope_id=approval.project_id,
        details=build_activity_details(
            headline=f"Approval {approval.status.value}",
            subject_name=approval.project.name if approval.project else None,
            notes=[approval.summary],
            kind="approval",
        ),
    )
    session.commit()
    session.refresh(approval)
    return approval


def get_user_notifications(session: Session, user: User) -> list[dict]:
    session.refresh(user)
    notifications = session.scalars(
        select(CommentNotification)
        .where(CommentNotification.user_id == user.id)
        .options(
            selectinload(CommentNotification.comment).selectinload(ProjectComment.author),
            selectinload(CommentNotification.comment).selectinload(ProjectComment.project),
            selectinload(CommentNotification.comment).selectinload(ProjectComment.instance),
        )
        .order_by(CommentNotification.created_at.desc())
    ).all()
    return [
        {
            "id": notification.id,
            "type": notification.notification_type.value,
            "route": notification.route,
            "is_read": notification.is_read,
            "comment_id": notification.comment_id,
            "project_id": notification.comment.project_id,
            "instance_id": notification.comment.instance_id,
            "body": _comment_preview(notification.comment.body),
            "author": notification.comment.author.username,
            "project_name": notification.comment.project.name,
            "instance_name": notification.comment.instance.name if notification.comment.instance else None,
            "created_at": notification.created_at.isoformat(),
        }
        for notification in notifications
    ]


def get_unread_notification_count(session: Session, user: User) -> int:
    return int(
        session.scalar(
            select(func.count(CommentNotification.id)).where(
                CommentNotification.user_id == user.id,
                CommentNotification.is_read.is_(False),
            )
        )
        or 0
    )


def mark_notification_read(session: Session, *, notification_id: int, user: User) -> dict | None:
    notification = session.scalar(
        select(CommentNotification).where(CommentNotification.id == notification_id, CommentNotification.user_id == user.id)
    )
    if notification is None:
        return None
    notification.is_read = True
    session.commit()
    return {"ok": True, "notification_id": notification.id, "is_read": notification.is_read}


def mark_instance_notifications_read(session: Session, *, project_id: int, instance_id: int, user: User) -> dict:
    notifications = session.scalars(
        select(CommentNotification)
        .join(ProjectComment, CommentNotification.comment_id == ProjectComment.id)
        .where(
            CommentNotification.user_id == user.id,
            CommentNotification.is_read.is_(False),
            ProjectComment.project_id == project_id,
            ProjectComment.instance_id == instance_id,
        )
    ).all()
    for notification in notifications:
        notification.is_read = True
    session.commit()
    return {"ok": True, "updated": len(notifications)}


def _serialize_comment(comment: ProjectComment, *, user: User | None = None) -> dict:
    return {
        "id": comment.id,
        "body": comment.body,
        "author": comment.author.username,
        "author_display_name": comment.author.display_name,
        "project_id": comment.project_id,
        "instance_id": comment.instance_id,
        "instance": comment.instance.name if comment.instance else None,
        "parent_comment_id": comment.parent_comment_id,
        "created_at": comment.created_at.isoformat(),
        "updated_at": comment.updated_at.isoformat(),
        "is_author": bool(user and comment.author_user_id == user.id),
        "is_deleted": comment.deleted_at is not None,
        "mentions": [mention.user.username for mention in comment.mentions],
        "replies": [_serialize_comment(reply, user=user) for reply in sorted(comment.replies, key=lambda item: item.created_at)],
    }


def _build_comment_route(project_id: int, comment_id: int) -> str:
    return f"/projects/{project_id}#comment-{comment_id}"


def _serialize_activity_group(group: ProjectActivityGroup) -> dict:
    entries = [_serialize_activity_event(entry, project=group.project) for entry in sorted(group.events, key=lambda item: item.created_at)]
    return {
        "id": group.id,
        "title": group.title or _default_group_title(group),
        "project": {
            "id": group.project.id,
            "name": group.project.name,
            "status": group.project.status.value,
            "status_label": PROJECT_STATUS_LABELS[group.project.status.value],
        },
        "created_at": group.created_at.isoformat(),
        "updated_at": group.updated_at.isoformat(),
        "actor": _display_actor(group.actor),
        "entry_count": len(entries),
        "entries": entries,
    }


def _merge_activity_groups(groups: list[dict]) -> list[dict]:
    merged: list[dict] = []
    for group in groups:
        if merged and _can_merge_activity_groups(merged[-1], group):
            _merge_group_into_previous(merged[-1], group)
            continue
        merged.append(group)
    return merged


def _can_merge_activity_groups(newer_group: dict, older_group: dict) -> bool:
    if newer_group["project"]["id"] != older_group["project"]["id"]:
        return False
    if newer_group.get("actor") != older_group.get("actor"):
        return False
    if newer_group.get("title") != older_group.get("title"):
        return False
    if newer_group.get("entry_count") != 1 or older_group.get("entry_count") != 1:
        return False
    newer_entry = newer_group["entries"][0]
    older_entry = older_group["entries"][0]
    if not _can_merge_material_entries(newer_entry, older_entry):
        return False
    return _within_merge_window(newer_group["created_at"], older_group["created_at"], seconds=60)


def _can_merge_material_entries(newer_entry: dict, older_entry: dict) -> bool:
    if newer_entry.get("kind") != "material" or older_entry.get("kind") != "material":
        return False
    if newer_entry.get("headline") != older_entry.get("headline"):
        return False
    if newer_entry.get("subject_name") != older_entry.get("subject_name"):
        return False
    return tuple(newer_entry.get("notes") or []) == tuple(older_entry.get("notes") or [])


def _within_merge_window(newer_created_at: str, older_created_at: str, *, seconds: int) -> bool:
    try:
        newer = datetime.fromisoformat(newer_created_at)
        older = datetime.fromisoformat(older_created_at)
    except ValueError:
        return False
    return newer - older <= timedelta(seconds=seconds)


def _merge_group_into_previous(newer_group: dict, older_group: dict) -> None:
    newer_entry = newer_group["entries"][0]
    older_entry = older_group["entries"][0]
    newer_entry["changes"] = _merge_entry_changes(older_entry.get("changes") or [], newer_entry.get("changes") or [])
    newer_entry["notes"] = _merge_unique_strings((older_entry.get("notes") or []) + (newer_entry.get("notes") or []))
    newer_group["entry_count"] = len(newer_group["entries"])
    older_created = older_group.get("created_at")
    newer_updated = newer_group.get("updated_at")
    if older_created and older_created < newer_group["created_at"]:
        newer_group["created_at"] = older_created
    if older_group.get("updated_at") and older_group["updated_at"] > (newer_updated or ""):
        newer_group["updated_at"] = older_group["updated_at"]


def _merge_entry_changes(older_changes: list[dict], newer_changes: list[dict]) -> list[dict]:
    merged: list[dict] = []
    by_label: dict[str, dict] = {}
    for change in older_changes + newer_changes:
        label = str(change.get("label", "")).strip()
        if not label:
            continue
        current = by_label.get(label)
        if current is None:
            current = {
                "label": label,
                "before": change.get("before"),
                "after": change.get("after"),
            }
            by_label[label] = current
            merged.append(current)
            continue
        if current.get("before") is None and change.get("before") is not None:
            current["before"] = change.get("before")
        if change.get("after") is not None:
            current["after"] = change.get("after")
    return [change for change in merged if change.get("before") != change.get("after")]


def _merge_unique_strings(values: list[str]) -> list[str]:
    seen: set[str] = set()
    merged: list[str] = []
    for value in values:
        text = str(value).strip()
        if not text or text in seen:
            continue
        seen.add(text)
        merged.append(text)
    return merged


def _default_group_title(group: ProjectActivityGroup) -> str:
    first_event = min(group.events, key=lambda item: item.created_at, default=None)
    if first_event is None:
        return "Project activity"
    details = first_event.details or {}
    headline = details.get("headline") if isinstance(details, dict) else None
    if isinstance(headline, str) and headline.strip():
        return headline.strip()
    return "Project activity"


def _normalize_legacy_subject_text(value: str) -> str:
    return " ".join(value.casefold().split())


def _legacy_subject_tokens(value: str) -> set[str]:
    normalized = _normalize_legacy_subject_text(value)
    return {token for token in LEGACY_SUBJECT_TOKEN_PATTERN.findall(normalized) if len(token) >= 3}


def _legacy_subject_context(details_text: str) -> str:
    lines: list[str] = []
    for raw_line in details_text.splitlines():
        line = raw_line.strip()
        if not line:
            continue
        lowered = line.casefold()
        if lowered.startswith("materiales eliminados"):
            break
        lines.append(line)
    return "\n".join(lines)


def _recover_legacy_subject_name(details: dict[str, Any], *, project: Project | None, kind: str) -> str | None:
    if project is None:
        return None
    legacy_details = details.get("legacy_details")
    if not isinstance(legacy_details, str) or not legacy_details.strip():
        return None

    candidate_type = kind.casefold()
    context = _legacy_subject_context(legacy_details)
    context_tokens = _legacy_subject_tokens(context)
    if not context_tokens:
        return None

    best_name: str | None = None
    best_score = 0
    for instance in project.instances:
        if instance.instance_type.value != candidate_type:
            continue
        name = (instance.name or "").strip()
        if not name:
            continue
        name_tokens = _legacy_subject_tokens(name)
        profile_tokens = _legacy_subject_tokens(
            " ".join(
                part
                for part in (
                    instance.name,
                    instance.short_name,
                    instance.description,
                    instance.short_description,
                    instance.installation,
                )
                if part
            )
        )
        score = 4 * len(context_tokens & name_tokens) + len(context_tokens & profile_tokens)
        if score > best_score:
            best_score = score
            best_name = name

    return best_name if best_score >= 4 else None


def _serialize_activity_event(entry: ProjectActivityLog, *, project: Project | None = None) -> dict:
    details = entry.details or {}
    notes = details.get("notes") if isinstance(details.get("notes"), list) else []
    changes = details.get("changes") if isinstance(details.get("changes"), list) else []
    kind = str(details.get("kind") or entry.entity_type).lower()
    subject_name = str(details.get("subject_name")).strip() if isinstance(details.get("subject_name"), str) else None
    if subject_name is None and isinstance(details, dict):
        subject_name = _recover_legacy_subject_name(details, project=project, kind=kind)
    return {
        "id": f"event-{entry.id}",
        "kind": kind,
        "headline": str(details.get("headline") or entry.action.replace("_", " ").strip()),
        "subject_name": subject_name,
        "notes": [str(note).strip() for note in notes if str(note).strip()],
        "changes": [
            {
                "label": str(change.get("label", "")).strip(),
                "before": str(change.get("before")).strip() if change.get("before") is not None else None,
                "after": str(change.get("after")).strip() if change.get("after") is not None else None,
            }
            for change in changes
            if isinstance(change, dict) and str(change.get("label", "")).strip()
        ],
        "created_at": entry.created_at.isoformat(),
        "actor": _display_actor(entry.actor),
        "is_minor": bool(details.get("minor")),
    }


def _display_actor(user: User | None) -> str | None:
    if user is None:
        return None
    return user.display_name or user.username


def _comment_preview(body: str) -> str:
    compact = " ".join(body.split())
    if len(compact) <= 140:
        return compact
    return f"{compact[:137].rstrip()}..."
