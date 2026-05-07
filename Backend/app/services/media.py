from __future__ import annotations

import hashlib
import imghdr
import mimetypes
from pathlib import Path
from typing import BinaryIO

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import Settings
from app.models import MediaAsset, User
from app.models.entities import utcnow


MAX_IMAGE_BYTES = 15 * 1024 * 1024
SUPPORTED_IMAGE_TYPES = {
    "jpeg": ("jpg", "image/jpeg"),
    "png": ("png", "image/png"),
    "gif": ("gif", "image/gif"),
    "svg": ("svg", "image/svg+xml"),
}


def create_media_asset_from_upload(
    session: Session,
    *,
    settings: Settings,
    file: BinaryIO,
    original_filename: str | None,
    content_type: str | None,
    actor_user: User | None,
    commit: bool = True,
) -> MediaAsset:
    data = file.read()
    if not data:
        raise ValueError("Image file is empty.")
    if len(data) > MAX_IMAGE_BYTES:
        raise ValueError("Image file is too large.")

    detected = imghdr.what(None, data)
    if detected is None and b"<svg" in data[:512].lower():
        detected = "svg"
    if detected not in SUPPORTED_IMAGE_TYPES:
        raise ValueError("Unsupported image type. Use PNG, JPG, GIF, or SVG.")

    extension, canonical_content_type = SUPPORTED_IMAGE_TYPES[detected]
    if content_type and content_type not in {canonical_content_type, "application/octet-stream"}:
        guessed = mimetypes.guess_type(original_filename or "")[0]
        if guessed and guessed != canonical_content_type:
            raise ValueError("Uploaded file content does not match its image type.")

    digest = hashlib.sha256(data).hexdigest()
    existing = session.scalar(select(MediaAsset).where(MediaAsset.sha256 == digest, MediaAsset.deleted_at.is_(None)))
    if existing is not None:
        return existing

    storage_key = f"{digest[:2]}/{digest}.{extension}"
    target_path = resolve_media_storage_path(settings=settings, storage_key=storage_key)
    target_path.parent.mkdir(parents=True, exist_ok=True)
    if not target_path.exists():
        target_path.write_bytes(data)

    asset = MediaAsset(
        kind="image",
        storage_key=storage_key,
        uri=f"/media/assets/{digest}",
        original_filename=(original_filename or "").strip() or None,
        content_type=canonical_content_type,
        byte_size=len(data),
        sha256=digest,
        created_by=actor_user,
        created_at=utcnow(),
    )
    session.add(asset)
    session.flush()
    asset.uri = f"/api/v1/media/assets/{asset.id}/content"
    if commit:
        session.commit()
        session.refresh(asset)
    else:
        session.flush()
    return asset


def list_media_assets(session: Session, *, kind: str = "image") -> list[MediaAsset]:
    return session.scalars(
        select(MediaAsset)
        .where(MediaAsset.kind == kind, MediaAsset.deleted_at.is_(None))
        .order_by(MediaAsset.created_at.desc(), MediaAsset.id.desc())
    ).all()


def get_media_asset(session: Session, asset_id: int) -> MediaAsset | None:
    return session.scalar(select(MediaAsset).where(MediaAsset.id == asset_id, MediaAsset.deleted_at.is_(None)))


def resolve_media_storage_path(*, settings: Settings, storage_key: str) -> Path:
    root = settings.media_gallery_dir.resolve()
    path = (root / storage_key).resolve()
    if root not in path.parents and path != root:
        raise ValueError("Invalid media storage key.")
    return path


def serialize_media_asset(asset: MediaAsset) -> dict:
    return {
        "id": asset.id,
        "kind": asset.kind,
        "uri": asset.uri,
        "storage_key": asset.storage_key,
        "original_filename": asset.original_filename,
        "content_type": asset.content_type,
        "byte_size": asset.byte_size,
        "sha256": asset.sha256,
        "width": asset.width,
        "height": asset.height,
        "created_at": asset.created_at.isoformat() if asset.created_at else None,
    }


def serialize_media_link(link) -> dict:
    asset = getattr(link, "asset", None)
    if asset is not None:
        payload = serialize_media_asset(asset)
        payload.update(
            {
                "kind": link.kind if hasattr(link, "kind") else asset.kind,
                "caption": link.caption,
                "sort_order": link.sort_order,
            }
        )
        return payload
    return {
        "id": None,
        "kind": link.kind,
        "uri": link.uri,
        "caption": link.caption,
        "sort_order": link.sort_order,
    }
