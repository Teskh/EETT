from __future__ import annotations

import re

from sqlalchemy import select
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

PROJECT_STATUS_LABELS = {
    ProjectStatus.TEMPLATE.value: "Template",
    ProjectStatus.EXECUTION.value: "Execution",
    ProjectStatus.FINISHED.value: "Finished",
}


def get_project_comments(session: Session, project_id: int) -> list[dict]:
    comments = session.scalars(
        select(ProjectComment)
        .where(ProjectComment.project_id == project_id, ProjectComment.parent_comment_id.is_(None))
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
    return [_serialize_comment(comment) for comment in comments]


def get_comment_payload(session: Session, comment_id: int) -> dict | None:
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
    return _serialize_comment(comment)


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
    for username in mentioned_usernames:
        user = session.scalar(select(User).where(User.username == username))
        if user is None:
            continue
        session.add(CommentMention(comment=comment, user=user))
        session.add(
            CommentNotification(
                user=user,
                comment=comment,
                notification_type=NotificationType.COMMENT_MENTION,
                route=_build_comment_route(project.id, comment.id),
            )
        )

    if parent_comment is not None and parent_comment.author_user_id != author.id:
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


def get_project_activity(session: Session, project_id: int) -> list[dict]:
    groups = session.scalars(
        select(ProjectActivityGroup)
        .where(ProjectActivityGroup.project_id == project_id)
        .options(
            selectinload(ProjectActivityGroup.project),
            selectinload(ProjectActivityGroup.actor),
            selectinload(ProjectActivityGroup.events).selectinload(ProjectActivityLog.actor),
            selectinload(ProjectActivityGroup.approvals).selectinload(ProjectApproval.requested_by),
            selectinload(ProjectActivityGroup.approvals).selectinload(ProjectApproval.decided_by),
        )
        .order_by(ProjectActivityGroup.created_at.desc())
    ).all()
    return [_serialize_activity_group(group) for group in groups]


def get_activity_history(session: Session, user: User) -> list[dict]:
    groups = session.scalars(
        select(ProjectActivityGroup)
        .options(
            selectinload(ProjectActivityGroup.project),
            selectinload(ProjectActivityGroup.actor),
            selectinload(ProjectActivityGroup.events).selectinload(ProjectActivityLog.actor),
            selectinload(ProjectActivityGroup.approvals).selectinload(ProjectApproval.requested_by),
            selectinload(ProjectActivityGroup.approvals).selectinload(ProjectApproval.decided_by),
        )
        .order_by(ProjectActivityGroup.created_at.desc())
    ).all()
    return [
        _serialize_activity_group(group)
        for group in groups
        if group.project is not None and can_view_project(user, group.project)
    ]


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
        .options(selectinload(CommentNotification.comment))
        .order_by(CommentNotification.created_at.desc())
    ).all()
    return [
        {
            "id": notification.id,
            "type": notification.notification_type.value,
            "route": notification.route,
            "is_read": notification.is_read,
            "comment_id": notification.comment_id,
            "created_at": notification.created_at.isoformat(),
        }
        for notification in notifications
    ]


def _serialize_comment(comment: ProjectComment) -> dict:
    return {
        "id": comment.id,
        "body": comment.body,
        "author": comment.author.username,
        "instance": comment.instance.name if comment.instance else None,
        "created_at": comment.created_at.isoformat(),
        "mentions": [mention.user.username for mention in comment.mentions],
        "replies": [_serialize_comment(reply) for reply in sorted(comment.replies, key=lambda item: item.created_at)],
    }


def _build_comment_route(project_id: int, comment_id: int) -> str:
    return f"/projects/{project_id}#comment-{comment_id}"


def _serialize_activity_group(group: ProjectActivityGroup) -> dict:
    entries = [_serialize_activity_event(entry) for entry in sorted(group.events, key=lambda item: item.created_at)]
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


def _default_group_title(group: ProjectActivityGroup) -> str:
    first_event = min(group.events, key=lambda item: item.created_at, default=None)
    if first_event is None:
        return "Project activity"
    details = first_event.details or {}
    headline = details.get("headline") if isinstance(details, dict) else None
    if isinstance(headline, str) and headline.strip():
        return headline.strip()
    return "Project activity"


def _serialize_activity_event(entry: ProjectActivityLog) -> dict:
    details = entry.details or {}
    notes = details.get("notes") if isinstance(details.get("notes"), list) else []
    changes = details.get("changes") if isinstance(details.get("changes"), list) else []
    return {
        "id": f"event-{entry.id}",
        "kind": str(details.get("kind") or entry.entity_type).lower(),
        "headline": str(details.get("headline") or entry.action.replace("_", " ").strip()),
        "subject_name": str(details.get("subject_name")).strip() if isinstance(details.get("subject_name"), str) else None,
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
