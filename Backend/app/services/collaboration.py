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
    ProjectActivityLog,
    ProjectApproval,
    ProjectComment,
    ProjectInstance,
    User,
)
from app.models.entities import utcnow

MENTION_PATTERN = re.compile(r"@([a-zA-Z0-9_.-]+)")


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

    session.add(
        ProjectActivityLog(
            project=project,
            actor=author,
            entity_type="ProjectComment",
            entity_id=comment.id,
            action="commented",
            details={"instance_id": instance.id if instance else None},
        )
    )
    session.commit()
    session.refresh(comment)
    return comment


def get_project_activity(session: Session, project_id: int) -> list[dict]:
    entries = session.scalars(
        select(ProjectActivityLog)
        .where(ProjectActivityLog.project_id == project_id)
        .options(selectinload(ProjectActivityLog.actor))
        .order_by(ProjectActivityLog.created_at.desc())
    ).all()
    return [
        {
            "id": entry.id,
            "entity_type": entry.entity_type,
            "entity_id": entry.entity_id,
            "action": entry.action,
            "details": entry.details or {},
            "created_at": entry.created_at.isoformat(),
            "actor": entry.actor.username if entry.actor else None,
        }
        for entry in entries
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


def request_project_approval(session: Session, *, project: Project, requested_by: User, summary: str) -> ProjectApproval:
    approval = ProjectApproval(
        project=project,
        requested_by=requested_by,
        status=ApprovalStatus.PENDING,
        summary=summary.strip(),
    )
    session.add(approval)
    session.flush()
    session.add(
        ProjectActivityLog(
            project=project,
            actor=requested_by,
            entity_type="ProjectApproval",
            entity_id=approval.id,
            action="approval_requested",
            details={"summary": approval.summary},
        )
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
    session.add(
        ProjectActivityLog(
            project=approval.project,
            actor=decided_by,
            entity_type="ProjectApproval",
            entity_id=approval.id,
            action=f"approval_{approval.status.value}",
            details={"summary": approval.summary},
        )
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
