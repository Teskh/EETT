from __future__ import annotations

import ipaddress
from datetime import datetime
from pathlib import Path
from urllib.parse import urlsplit, urlunsplit
from uuid import uuid4

import httpx

from app.config import Settings
from app.services import backups as backup_service


EXPORT_PATH = "/api/v1/database-sync/export"
LOCAL_ENVIRONMENTS = {"dev", "development", "local"}
SYNC_TOKEN_HEADER = "X-Spec-Sheets-Sync-Token"


def is_loopback_host(host: str | None) -> bool:
    if not host:
        return False
    normalized = host.strip().strip("[]").lower()
    if normalized == "localhost":
        return True
    try:
        return ipaddress.ip_address(normalized).is_loopback
    except ValueError:
        return False


def is_local_sync_request(settings: Settings, *, request_host: str | None, client_host: str | None) -> bool:
    return (
        settings.environment.strip().lower() in LOCAL_ENVIRONMENTS
        and is_loopback_host(request_host)
        and is_loopback_host(client_host)
    )


def build_export_url(source_url: str) -> str:
    parsed = urlsplit(source_url.strip())
    if parsed.scheme.lower() != "https" or not parsed.hostname:
        raise ValueError("The production sync URL must be a valid HTTPS URL.")
    if parsed.username or parsed.password or parsed.query or parsed.fragment:
        raise ValueError("The production sync URL cannot contain credentials, a query, or a fragment.")
    base_path = parsed.path.rstrip("/")
    return urlunsplit((parsed.scheme, parsed.netloc, f"{base_path}{EXPORT_PATH}", "", ""))


def sync_status(
    settings: Settings,
    *,
    request_host: str | None,
    client_host: str | None,
) -> dict[str, object]:
    source_url = settings.database_sync_source_url.strip()
    if not is_local_sync_request(settings, request_host=request_host, client_host=client_host):
        return {
            "available": False,
            "source_url": source_url,
            "reason": "Database sync is available only from a local development server.",
        }
    if not settings.database_sync_token:
        return {
            "available": False,
            "source_url": source_url,
            "reason": "Database sync is not configured. Set SPEC_SHEETS_DATABASE_SYNC_TOKEN locally and in production.",
        }
    try:
        build_export_url(source_url)
    except ValueError as exc:
        return {"available": False, "source_url": source_url, "reason": str(exc)}
    return {"available": True, "source_url": source_url, "reason": None}


def create_export_dump(settings: Settings) -> Path:
    export_dir = Path(settings.backup_dir) / ".sync_exports"
    timestamp = datetime.now().astimezone().strftime("%Y%m%d_%H%M%S")
    output_path = export_dir / f"eett_production_{timestamp}_{uuid4().hex}.dump"
    backup_service.create_database_dump(settings, output_path)
    return output_path


def remove_export_dump(path: Path) -> None:
    path.unlink(missing_ok=True)
    try:
        path.parent.rmdir()
    except OSError:
        pass


def _remote_error(response: httpx.Response) -> str:
    body = response.read()[:4096]
    try:
        payload = httpx.Response(response.status_code, content=body).json()
    except ValueError:
        payload = None
    if isinstance(payload, dict) and isinstance(payload.get("detail"), str):
        return payload["detail"]
    return body.decode("utf-8", errors="replace").strip() or f"Production returned HTTP {response.status_code}."


def download_production_dump(settings: Settings, output_path: Path) -> int:
    if not settings.database_sync_token:
        raise ValueError("Database sync token is not configured.")
    export_url = build_export_url(settings.database_sync_source_url)
    max_bytes = max(int(settings.database_sync_max_dump_bytes), 1)
    timeout = httpx.Timeout(float(settings.database_sync_timeout_seconds), connect=20.0)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    downloaded = 0
    completed = False
    try:
        with httpx.Client(timeout=timeout, follow_redirects=False) as client:
            with client.stream(
                "POST",
                export_url,
                headers={SYNC_TOKEN_HEADER: settings.database_sync_token, "Accept": "application/octet-stream"},
            ) as response:
                if response.status_code != 200:
                    raise RuntimeError(f"Production export failed: {_remote_error(response)}")
                content_length = response.headers.get("content-length")
                if content_length and int(content_length) > max_bytes:
                    raise RuntimeError("Production dump exceeds the configured size limit.")
                with output_path.open("wb") as output:
                    for chunk in response.iter_bytes():
                        downloaded += len(chunk)
                        if downloaded > max_bytes:
                            raise RuntimeError("Production dump exceeds the configured size limit.")
                        output.write(chunk)
        if downloaded == 0:
            raise RuntimeError("Production returned an empty database dump.")
        with output_path.open("rb") as dump_file:
            if dump_file.read(5) != b"PGDMP":
                raise RuntimeError("Production returned an invalid PostgreSQL custom-format dump.")
        completed = True
        return downloaded
    except (httpx.HTTPError, OSError, ValueError) as exc:
        raise RuntimeError(f"Could not download the production database: {exc}") from exc
    finally:
        if not completed:
            output_path.unlink(missing_ok=True)


def sync_from_production(settings: Settings) -> dict[str, object]:
    sync_dir = Path(settings.backup_dir) / ".sync_downloads"
    timestamp = datetime.now().astimezone().strftime("%Y%m%d_%H%M%S")
    dump_path = sync_dir / f"production_sync_{timestamp}_{uuid4().hex}.dump"
    try:
        downloaded_size = download_production_dump(settings, dump_path)
        result = backup_service.restore_dump_file(
            settings,
            dump_path,
            restored_from=settings.database_sync_source_url,
            force_disconnect=True,
            checkpoint_label="Pre-production sync checkpoint",
        )
        return {
            **result,
            "downloaded_size_bytes": downloaded_size,
            "source_url": settings.database_sync_source_url,
        }
    finally:
        dump_path.unlink(missing_ok=True)
        try:
            sync_dir.rmdir()
        except OSError:
            pass

