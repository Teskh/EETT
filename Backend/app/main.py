from __future__ import annotations

import asyncio
import json
import logging
from contextlib import asynccontextmanager
from datetime import date
from pathlib import Path
from typing import Annotated, Any

from sqlalchemy import select
from fastapi import Body, Depends, FastAPI, File, Form, Header, HTTPException, Request, Response, UploadFile
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles
from sqlalchemy.orm import Session, selectinload, sessionmaker
from starlette.middleware.sessions import SessionMiddleware

from app.api_models import (
    ActivityGroupModel,
    ApprovalModel,
    AttributeValueInputModel,
    BackupCreateRequest,
    BackupCreateResponse,
    BackupRecordModel,
    BackupRestoreRequest,
    BackupRestoreResponse,
    BackupSettingsModel,
    BackupSettingsUpdateRequest,
    CatalogCategoryCreateRequest,
    CatalogComponentMutationResultModel,
    CatalogCategoryLinksUpdateRequest,
    CatalogComponentAttributesReplaceRequest,
    CatalogComponentCreateRequest,
    CatalogComponentMediaUpdateRequest,
    CatalogComponentMaterialsReplaceRequest,
    CatalogComponentUpdateRequest,
    CatalogMaterialSearchResponse,
    CatalogResponse,
    CommentContextResponse,
    CommentCreateRequest,
    CommentDeleteResponse,
    CommentModel,
    CommentNotificationReadResponse,
    CommentUnreadCountResponse,
    CostModelAdjustmentDeleteRequest,
    CostModelAdjustmentUpsertRequest,
    CostModelViewResponse,
    DashboardResponse,
    ExportJobModel,
    LoginRequest,
    MaterialDashboardCecoResponse,
    MaterialDashboardDateRangeRequest,
    MaterialDashboardDetailResponse,
    MaterialDashboardEconomicMetricsResponse,
    MaterialDashboardFilterRequest,
    MaterialDashboardGroupDetailResponse,
    MaterialDashboardGroupHouseComparisonResponse,
    MaterialDashboardGroupMovementResponse,
    MaterialDashboardHouseComparisonRequest,
    MaterialDashboardHouseComparisonResponse,
    MaterialDashboardProjectUsageResponse,
    MaterialDashboardHouseTypesResponse,
    MaterialDashboardMaterialStudyResponse,
    MaterialDashboardListRequest,
    MaterialDashboardMovementResponse,
    MaterialDashboardResponse,
    ManualMaterialAddRequest,
    MaterialCalculationSheetResponse,
    MaterialCalculationSheetUpdateRequest,
    MaterialStudyGroupListResponse,
    MaterialStudyGroupModel,
    MaterialStudyGroupPayloadModel,
    MaterialOccurrenceUpdateRequest,
    MaterialModeResponse,
    MediaAssetListResponse,
    MediaAssetModel,
    ManagedUserModel,
    MentionableUsersResponse,
    MutationResultModel,
    NotificationModel,
    ProjectDetailResponse,
    ProjectCreateRequest,
    ProjectStatusUpdateRequest,
    ProjectInstanceMutationResultModel,
    ProjectOccurrenceUpdateRequest,
    ProjectOccurrenceMutationResultModel,
    ProjectInstanceCreateRequest,
    ProjectInstanceUpdateRequest,
    ProjectSubtypeCreateRequest,
    ProjectSubtypeUpdateRequest,
    ProjectsBoardResponse,
    PublicProjectListResponse,
    PublicProjectSkuResponse,
    RolePageAccessUpdateRequest,
    SessionUserResponse,
    SyncAttributeSchemaUpdateRequest,
    SyncFieldApplyRequest,
    SyncPreviewResponse,
    UserCreateRequest,
    UserDirectoryResponse,
    UserUpdateRequest,
)
from app.config import Settings
from app.database import create_engine_for_url, schema_is_ready, session_scope
from app.models import Project, ProjectComment, ProjectExportJob, ProjectMembership, User, UserRole
from app.seed import seed_demo_data_if_empty
from app.services import backups as backup_service
from app.services.audit import normalize_mutation_batch_id
from app.services.auth import (
    authenticate_user,
    get_current_user,
    resolve_current_user,
    require_project_create,
    require_catalog_edit,
    require_cost_model_export,
    require_material_dashboard_access,
    require_erp_admin,
    can_read_page,
    require_project_edit,
    require_project_status_change,
    require_project_view,
    require_page_edit,
    require_page_read,
    require_user_admin,
    serialize_page_catalog,
    serialize_session_user,
)
from app.services.catalog import create_category, create_component, get_catalog_page_data, update_category_links
from app.services.catalog import (
    create_attribute_definition,
    delete_attribute_definition,
    delete_component,
    get_catalog_component_data,
    replace_component_material_rules,
    replace_component_attributes,
    search_material_candidates,
    set_component_primary_media,
    update_attribute_definition,
    update_component,
)
from app.services.collaboration import (
    add_project_comment,
    delete_project_comment,
    decide_project_approval,
    get_comment_context,
    get_activity_history,
    get_comment_payload,
    get_project_activity,
    get_project_approvals,
    get_project_comments,
    get_unread_notification_count,
    get_user_notifications,
    mark_instance_notifications_read,
    mark_notification_read,
    request_project_approval,
)
from app.services.dashboard import (
    get_material_dashboard_cost_centers,
    get_material_dashboard_detail,
    get_material_dashboard_economic_metrics,
    get_material_dashboard_history,
    get_material_dashboard_project_comparison,
    get_material_dashboard_project_quantity_map,
    get_material_dashboard_project_usage,
    get_project_material_dashboard,
    get_recent_material_dashboard,
)
from app.services.erp import erp_search_available, search_erp_material_candidates
from app.services.material_groups import (
    create_material_study_group,
    delete_material_study_group,
    get_material_dashboard_group_detail,
    get_material_dashboard_group_history,
    get_material_dashboard_group_house_comparison,
    get_material_dashboard_groups,
    update_material_study_group,
)
from app.services.material_calculation_sheets import get_material_calculation_sheet, replace_material_calculation_sheet
from app.services.production_dashboard import (
    get_material_dashboard_house_start_comparison,
    get_material_dashboard_house_types,
)
from app.services.exports import build_project_export_artifact, execute_project_export, get_project_export_job_for_artifact, get_project_export_jobs, request_project_export
from app.services.media import (
    create_media_asset_from_upload,
    get_media_asset,
    list_media_assets,
    resolve_media_storage_path,
    serialize_media_asset,
)
from app.services.projects import (
    apply_catalog_value_to_instance_field,
    apply_instance_value_to_catalog_field,
    add_project_instance_manual_material,
    create_project,
    create_project_instance,
    create_project_instance_occurrence,
    create_project_subtype,
    delete_project_instance_occurrence,
    delete_project_instance_material,
    delete_project_subtype,
    delete_project_instance,
    get_project_instance_data,
    get_project_occurrence_data,
    get_instance_sync_preview,
    get_project_view_data,
    get_project_with_details,
    get_projects_page_data,
    reconcile_instance_base_attributes,
    refresh_instance_snapshot,
    replace_project_material_occurrence,
    set_project_material_mode,
    update_project_status,
    update_project_instance_occurrence,
    update_project_subtype,
    update_project_instance,
)
from app.services.public_api import list_project_public_skus, list_public_projects
from app.services.user_admin import create_user, delete_user, list_roles, list_users, serialize_roles_with_access, serialize_user, update_role_page_access, update_user
from app.ui import render_catalog_page, render_home_page, render_project_detail_page, render_projects_page


logger = logging.getLogger(__name__)


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or Settings()
    engine = create_engine_for_url(
        settings.database_url,
        connect_timeout_seconds=settings.database_connect_timeout_seconds,
        statement_timeout_ms=settings.database_statement_timeout_ms,
    )
    session_factory = sessionmaker(
        bind=engine,
        autoflush=False,
        expire_on_commit=False,
    )

    async def _run_backup_scheduler() -> None:
        poll_seconds = max(settings.backup_scheduler_poll_seconds, 10)
        while True:
            try:
                settings_data = backup_service.load_backup_settings(settings)
                if backup_service.is_backup_due(settings_data):
                    await asyncio.to_thread(backup_service.create_backup, settings, "scheduled")
            except Exception as exc:  # pragma: no cover - defensive against scheduler errors
                logger.warning("Backup scheduler error: %s", exc)
            await asyncio.sleep(poll_seconds)

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        if settings.require_schema and not schema_is_ready(engine):
            raise RuntimeError(
                "Database schema is missing. Run `alembic upgrade head` against the configured PostgreSQL database before starting the app."
            )
        settings.media_gallery_dir.mkdir(parents=True, exist_ok=True)
        settings.backup_dir.mkdir(parents=True, exist_ok=True)
        if settings.seed_demo_data:
            seed_demo_data_if_empty(session_factory)
        backup_task: asyncio.Task | None = None
        if settings.backup_scheduler_enabled:
            backup_task = asyncio.create_task(_run_backup_scheduler())
            app.state.backup_task = backup_task
        try:
            yield
        finally:
            if backup_task is not None:
                backup_task.cancel()
                try:
                    await backup_task
                except asyncio.CancelledError:
                    pass

    app = FastAPI(title=settings.app_name, lifespan=lifespan)

    app.state.settings = settings
    app.state.engine = engine
    app.state.session_factory = session_factory
    app.add_middleware(
        SessionMiddleware,
        secret_key=settings.session_secret,
        session_cookie=settings.session_cookie_name,
        same_site="lax",
        https_only=settings.environment == "production",
    )

    static_dir = Path(__file__).resolve().parent / "static"
    frontend_index = static_dir / "app" / "index.html"
    app.mount("/static", StaticFiles(directory=static_dir), name="static")

    def get_session(request: Request):
        with session_scope(request.app.state.session_factory) as session:
            yield session

    def get_actor_user(
        request: Request,
        session: Session = Depends(get_session),
        x_spec_sheets_user: Annotated[str | None, Header()] = None,
    ):
        return get_current_user(
            session,
            session_username=request.session.get("username"),
            trusted_username=x_spec_sheets_user,
            allow_trusted_username=request.app.state.settings.allow_trusted_user_header,
        )

    def get_optional_actor_user(
        request: Request,
        session: Session = Depends(get_session),
        x_spec_sheets_user: Annotated[str | None, Header()] = None,
    ):
        return resolve_current_user(
            session,
            session_username=request.session.get("username"),
            trusted_username=x_spec_sheets_user,
            allow_trusted_username=request.app.state.settings.allow_trusted_user_header,
        )

    def parse_optional_float(raw_value: str | None) -> float | None:
        value = (raw_value or "").strip()
        if not value:
            return None
        try:
            return float(value)
        except ValueError as exc:
            raise HTTPException(status_code=422, detail=f"Invalid numeric value: {raw_value}") from exc

    def parse_refresh_flag(raw_value: str | None) -> bool:
        return (raw_value or "").strip().lower() in {"1", "true", "yes", "y"}

    def attach_project_comparison(
        comparison: dict,
        *,
        project_id: int | None,
        sku_factors: dict[str, float],
        session: Session,
        current_user,
    ) -> dict:
        if project_id is None:
            comparison["project_comparison"] = None
            return comparison
        project_comparison = get_material_dashboard_project_comparison(
            session,
            project_id=project_id,
            sku_factors=sku_factors,
            total_house_starts=int(comparison.get("total_house_starts") or 0),
        )
        if project_comparison is None:
            raise HTTPException(status_code=404, detail="Project not found")
        require_project_view(current_user, project_comparison["project"])
        comparison["project_comparison"] = project_comparison["comparison"]
        return comparison

    def parse_attribute_values_json(raw_value: str | None) -> dict[str, str | None]:
        if not raw_value:
            return {}
        try:
            parsed = json.loads(raw_value)
        except json.JSONDecodeError as exc:
            raise HTTPException(status_code=422, detail="Invalid attribute value payload") from exc
        if not isinstance(parsed, list):
            raise HTTPException(status_code=422, detail="Attribute value payload must be a list")

        values: dict[str, str | None] = {}
        for row in parsed:
            if not isinstance(row, dict):
                continue
            name = str(row.get("name") or "").strip()
            if not name:
                continue
            raw_value_item = row.get("value")
            values[name] = str(raw_value_item).strip() if raw_value_item is not None else None
        return values

    def parse_attribute_values_rows(rows: list[AttributeValueInputModel] | None) -> dict[str, str | None]:
        values: dict[str, str | None] = {}
        for row in rows or []:
            name = row.name.strip()
            if not name:
                continue
            values[name] = row.value.strip() if row.value is not None else None
        return values

    def get_mutation_batch_id(
        x_mutation_batch_id: Annotated[str | None, Header(alias="X-Mutation-Batch-Id")] = None,
    ) -> str | None:
        return normalize_mutation_batch_id(x_mutation_batch_id)

    def serve_frontend_app(fallback_html: str | None = None) -> FileResponse | HTMLResponse:
        if frontend_index.exists():
            return FileResponse(frontend_index)
        return HTMLResponse(fallback_html or "")

    @app.get("/", response_class=HTMLResponse)
    async def home() -> str:
        return serve_frontend_app(render_home_page())

    @app.get("/login", response_class=HTMLResponse)
    async def login_page() -> str:
        return serve_frontend_app(render_home_page())

    @app.get("/exports/{artifact_name}")
    async def view_export_artifact(
        artifact_name: str,
        request: Request,
        session: Session = Depends(get_session),
        current_user=Depends(get_actor_user),
    ):
        artifact_uri = f"/exports/{artifact_name}"
        job = get_project_export_job_for_artifact(session, artifact_uri)
        if job is None or job.project is None:
            raise HTTPException(status_code=404, detail="Export artifact not found")
        require_project_view(current_user, job.project)
        if job.export_kind.value == "cost_model_workbook":
            require_cost_model_export(current_user)
        try:
            artifact = build_project_export_artifact(
                session,
                job=job,
                settings=request.app.state.settings,
            )
        except ValueError as exc:
            raise HTTPException(status_code=404, detail="Export artifact not found") from exc
        disposition = "inline" if artifact.inline else "attachment"
        return Response(
            content=artifact.content,
            media_type=artifact.media_type,
            headers={"Content-Disposition": f'{disposition}; filename="{artifact.filename}"'},
        )

    @app.get("/api/v1/media/assets", response_model=MediaAssetListResponse)
    async def list_media_assets_v1(
        kind: str = "image",
        session: Session = Depends(get_session),
        current_user=Depends(get_actor_user),
    ):
        return {"assets": [serialize_media_asset(asset) for asset in list_media_assets(session, kind=kind)]}

    @app.post("/api/v1/media/assets", response_model=MediaAssetModel)
    async def upload_media_asset_v1(
        file: UploadFile = File(...),
        session: Session = Depends(get_session),
        current_user=Depends(get_actor_user),
    ):
        try:
            asset = create_media_asset_from_upload(
                session,
                settings=app.state.settings,
                file=file.file,
                original_filename=file.filename,
                content_type=file.content_type,
                actor_user=current_user,
            )
        except ValueError as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc
        return serialize_media_asset(asset)

    @app.get("/api/v1/media/assets/{asset_id}/content", response_class=FileResponse)
    async def download_media_asset_v1(
        asset_id: int,
        session: Session = Depends(get_session),
        current_user=Depends(get_actor_user),
    ):
        asset = get_media_asset(session, asset_id)
        if asset is None:
            raise HTTPException(status_code=404, detail="Media asset not found")
        try:
            asset_path = resolve_media_storage_path(settings=app.state.settings, storage_key=asset.storage_key)
        except ValueError as exc:
            raise HTTPException(status_code=404, detail="Media asset not found") from exc
        if not asset_path.is_file():
            raise HTTPException(status_code=404, detail="Media asset file not found")
        return FileResponse(asset_path, media_type=asset.content_type, filename=asset.original_filename or asset_path.name)

    @app.get("/catalog", response_class=HTMLResponse)
    async def catalog(
        category_id: int | None = None,
        session: Session = Depends(get_session),
        current_user=Depends(get_optional_actor_user),
    ) -> str:
        if frontend_index.exists():
            return serve_frontend_app()
        if current_user is None:
            raise HTTPException(status_code=401, detail="Authentication required")
        require_catalog_edit(current_user)
        data = get_catalog_page_data(session, selected_category_id=category_id)
        selected = data["selected"]
        active_id = selected["id"] if selected else category_id
        return serve_frontend_app(render_catalog_page(data, active_id))

    @app.post("/catalog/categories")
    async def create_catalog_category(
        name: str = Form(...),
        description: str | None = Form(default=None),
        scope: str = Form("item"),
        parent_id: int | None = Form(default=None),
        session: Session = Depends(get_session),
        current_user=Depends(get_actor_user),
    ):
        require_catalog_edit(current_user)
        category = create_category(
            session,
            name=name,
            description=description,
            scope=scope,
            parent_id=parent_id,
        )
        return RedirectResponse(url=f"/catalog?category_id={category.id}", status_code=303)

    @app.post("/catalog/components")
    async def create_catalog_component(
        category_id: int = Form(...),
        component_type: str = Form(...),
        name: str = Form(...),
        short_name: str | None = Form(default=None),
        description: str | None = Form(default=None),
        short_description: str | None = Form(default=None),
        installation: str | None = Form(default=None),
        unit_type: str | None = Form(default=None),
        session: Session = Depends(get_session),
        current_user=Depends(get_actor_user),
    ):
        require_catalog_edit(current_user)
        create_component(
            session,
            category_id=category_id,
            component_type=component_type,
            name=name,
            short_name=short_name,
            description=description,
            short_description=short_description,
            installation=installation,
            unit_type=unit_type,
        )
        return RedirectResponse(url=f"/catalog?category_id={category_id}", status_code=303)

    @app.post("/catalog/components/{component_id}/update")
    async def update_catalog_component(
        component_id: int,
        name: str = Form(...),
        short_name: str | None = Form(default=None),
        description: str | None = Form(default=None),
        short_description: str | None = Form(default=None),
        installation: str | None = Form(default=None),
        unit_type: str | None = Form(default=None),
        component_type: str = Form(...),
        session: Session = Depends(get_session),
        current_user=Depends(get_actor_user),
    ):
        require_page_edit(current_user, "catalog")
        require_catalog_edit(current_user)
        component = update_component(
            session,
            component_id=component_id,
            name=name,
            short_name=short_name,
            description=description,
            short_description=short_description,
            installation=installation,
            unit_type=unit_type,
            component_type=component_type,
        )
        if component is None:
            raise HTTPException(status_code=404, detail="Catalog component not found")
        return RedirectResponse(url=f"/catalog?category_id={component.category_id}", status_code=303)

    @app.post("/catalog/components/{component_id}/delete")
    async def delete_catalog_component(
        component_id: int,
        category_id: int = Form(...),
        session: Session = Depends(get_session),
        current_user=Depends(get_actor_user),
    ):
        require_page_edit(current_user, "catalog")
        require_catalog_edit(current_user)
        try:
            deleted_category_id = delete_component(session, component_id=component_id)
        except ValueError as exc:
            raise HTTPException(status_code=409, detail=str(exc)) from exc
        if deleted_category_id is None:
            raise HTTPException(status_code=404, detail="Catalog component not found")
        return RedirectResponse(url=f"/catalog?category_id={deleted_category_id or category_id}", status_code=303)

    @app.post("/catalog/components/{component_id}/attributes")
    async def create_catalog_attribute(
        component_id: int,
        name: str = Form(...),
        value_type: str = Form(...),
        options_text: str | None = Form(default=None),
        session: Session = Depends(get_session),
        current_user=Depends(get_actor_user),
    ):
        require_page_edit(current_user, "catalog")
        require_catalog_edit(current_user)
        definition = create_attribute_definition(
            session,
            component_id=component_id,
            name=name,
            value_type=value_type,
            options_text=options_text,
        )
        if definition is None:
            raise HTTPException(status_code=404, detail="Catalog component not found")
        return RedirectResponse(url=f"/catalog?category_id={definition.component.category_id}", status_code=303)

    @app.post("/catalog/attributes/{attribute_definition_id}/update")
    async def update_catalog_attribute(
        attribute_definition_id: int,
        name: str = Form(...),
        value_type: str = Form(...),
        options_text: str | None = Form(default=None),
        session: Session = Depends(get_session),
        current_user=Depends(get_actor_user),
    ):
        require_page_edit(current_user, "catalog")
        require_catalog_edit(current_user)
        definition = update_attribute_definition(
            session,
            attribute_definition_id=attribute_definition_id,
            name=name,
            value_type=value_type,
            options_text=options_text,
        )
        if definition is None:
            raise HTTPException(status_code=404, detail="Catalog attribute not found")
        return RedirectResponse(url=f"/catalog?category_id={definition.component.category_id}", status_code=303)

    @app.post("/catalog/attributes/{attribute_definition_id}/delete")
    async def delete_catalog_attribute(
        attribute_definition_id: int,
        category_id: int = Form(...),
        session: Session = Depends(get_session),
        current_user=Depends(get_actor_user),
    ):
        require_page_edit(current_user, "catalog")
        require_catalog_edit(current_user)
        deleted_category_id = delete_attribute_definition(session, attribute_definition_id=attribute_definition_id)
        if deleted_category_id is None:
            raise HTTPException(status_code=404, detail="Catalog attribute not found")
        return RedirectResponse(url=f"/catalog?category_id={deleted_category_id or category_id}", status_code=303)

    @app.post("/catalog/components/{component_id}/attributes/update")
    async def replace_catalog_component_attributes(
        component_id: int,
        request: Request,
        attributes_json: str = Form("[]"),
        session: Session = Depends(get_session),
        current_user=Depends(get_actor_user),
    ):
        require_page_edit(current_user, "catalog")
        require_catalog_edit(current_user)
        try:
            attributes = json.loads(attributes_json)
        except json.JSONDecodeError as exc:
            raise HTTPException(status_code=422, detail="Invalid attribute payload") from exc
        if not isinstance(attributes, list):
            raise HTTPException(status_code=422, detail="Attribute payload must be a list")

        component = replace_component_attributes(
            session,
            component_id=component_id,
            scope="base",
            attributes=attributes,
        )
        if component is None:
            raise HTTPException(status_code=404, detail="Catalog component not found")
        if request and request.headers.get("x-requested-with") == "fetch":
            return JSONResponse({"ok": True, "component_id": component.id, "category_id": component.category_id})
        return RedirectResponse(url=f"/catalog?category_id={component.category_id}", status_code=303)

    @app.post("/catalog/categories/{category_id}/links")
    async def save_catalog_links(
        category_id: int,
        request: Request,
        session: Session = Depends(get_session),
        current_user=Depends(get_actor_user),
    ):
        require_page_read(current_user, "catalog")
        form = await request.form()
        linked_ids = [int(value) for value in form.getlist("linked_category_ids")]
        update_category_links(session, category_id=category_id, linked_category_ids=linked_ids)
        return RedirectResponse(url=f"/catalog?category_id={category_id}", status_code=303)

    @app.get("/projects", response_class=HTMLResponse)
    async def projects(session: Session = Depends(get_session), current_user=Depends(get_optional_actor_user)) -> str:
        if frontend_index.exists():
            return serve_frontend_app()
        if current_user is None:
            raise HTTPException(status_code=401, detail="Authentication required")
        data = get_projects_page_data(session, user=current_user)
        return serve_frontend_app(render_projects_page(data))

    @app.post("/projects")
    async def create_project_route(
        name: str = Form(...),
        status: str = Form("template"),
        session: Session = Depends(get_session),
        current_user=Depends(get_actor_user),
    ):
        require_project_create(current_user)
        project = create_project(session, name=name, status=status, actor_user=current_user)
        return RedirectResponse(url=f"/projects/{project.id}", status_code=303)

    @app.get("/projects/{project_id}", response_class=HTMLResponse)
    async def project_detail(project_id: int, session: Session = Depends(get_session), current_user=Depends(get_optional_actor_user)) -> str:
        if frontend_index.exists():
            return serve_frontend_app()
        if current_user is None:
            raise HTTPException(status_code=401, detail="Authentication required")
        project = get_project_with_details(session, project_id)
        if project is None:
            raise HTTPException(status_code=404, detail="Project not found")
        require_project_view(current_user, project)
        data = get_project_view_data(session, project_id, user=current_user)
        if data is None:
            raise HTTPException(status_code=404, detail="Project not found")
        return serve_frontend_app(render_project_detail_page(data))

    @app.get("/users", response_class=HTMLResponse)
    async def user_editor_page() -> str:
        return serve_frontend_app(render_home_page())

    @app.get("/settings", response_class=HTMLResponse)
    async def settings_page() -> str:
        return serve_frontend_app(render_home_page())

    @app.get("/history", response_class=HTMLResponse)
    async def history_page() -> str:
        return serve_frontend_app(render_home_page())

    @app.get("/dashboard/materials", response_class=HTMLResponse)
    async def material_dashboard_page() -> str:
        return serve_frontend_app(render_home_page())

    @app.post("/projects/{project_id}/instances")
    async def create_project_instance_route(
        project_id: int,
        category_id: int = Form(...),
        component_id: int = Form(...),
        name: str = Form(...),
        short_name: str | None = Form(default=None),
        description: str | None = Form(default=None),
        short_description: str | None = Form(default=None),
        installation: str | None = Form(default=None),
        unit_amount: str | None = Form(default=None),
        attribute_values_json: str | None = Form(default=None),
        session: Session = Depends(get_session),
        current_user=Depends(get_actor_user),
    ):
        project = get_project_with_details(session, project_id)
        if project is None:
            raise HTTPException(status_code=404, detail="Project not found")
        require_project_edit(current_user, project)
        try:
            create_project_instance(
                session,
                project=project,
                category_id=category_id,
                component_id=component_id,
                name=name,
                short_name=short_name,
                description=description,
                short_description=short_description,
                installation=installation,
                unit_amount=parse_optional_float(unit_amount),
                attribute_values=parse_attribute_values_json(attribute_values_json),
            )
        except ValueError as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc
        return RedirectResponse(url=f"/projects/{project_id}#category-{category_id}", status_code=303)

    @app.post("/projects/{project_id}/instances/{instance_id}/update")
    async def update_project_instance_route(
        project_id: int,
        instance_id: int,
        category_id: int = Form(...),
        name: str = Form(...),
        short_name: str | None = Form(default=None),
        description: str | None = Form(default=None),
        short_description: str | None = Form(default=None),
        installation: str | None = Form(default=None),
        unit_amount: str | None = Form(default=None),
        attribute_values_json: str | None = Form(default=None),
        session: Session = Depends(get_session),
        current_user=Depends(get_actor_user),
    ):
        project = get_project_with_details(session, project_id)
        if project is None:
            raise HTTPException(status_code=404, detail="Project not found")
        require_project_edit(current_user, project)
        instance = update_project_instance(
            session,
            project=project,
            instance_id=instance_id,
            name=name,
            short_name=short_name,
            description=description,
            short_description=short_description,
            installation=installation,
            unit_amount=parse_optional_float(unit_amount),
            attribute_values=parse_attribute_values_json(attribute_values_json),
        )
        if instance is None:
            raise HTTPException(status_code=404, detail="Project instance not found")
        return RedirectResponse(url=f"/projects/{project_id}#category-{category_id}", status_code=303)

    @app.post("/projects/{project_id}/instances/{instance_id}/delete")
    async def delete_project_instance_route(
        project_id: int,
        instance_id: int,
        category_id: int = Form(...),
        session: Session = Depends(get_session),
        current_user=Depends(get_actor_user),
    ):
        project = get_project_with_details(session, project_id)
        if project is None:
            raise HTTPException(status_code=404, detail="Project not found")
        require_project_edit(current_user, project)
        deleted = delete_project_instance(session, project=project, instance_id=instance_id)
        if not deleted:
            raise HTTPException(status_code=404, detail="Project instance not found")
        return RedirectResponse(url=f"/projects/{project_id}#category-{category_id}", status_code=303)

    @app.get("/api/catalog")
    async def catalog_api(category_id: int | None = None, session: Session = Depends(get_session), current_user=Depends(get_actor_user)):
        require_catalog_edit(current_user)
        return get_catalog_page_data(session, selected_category_id=category_id)

    @app.get("/api/projects")
    async def projects_api(session: Session = Depends(get_session), current_user=Depends(get_actor_user)):
        return get_projects_page_data(session, user=current_user)

    @app.get("/api/projects/{project_id}")
    async def project_detail_api(project_id: int, session: Session = Depends(get_session), current_user=Depends(get_actor_user)):
        data = get_project_view_data(session, project_id, user=current_user)
        if data is None:
            raise HTTPException(status_code=404, detail="Project not found")
        return data

    @app.post("/api/v1/login", response_model=SessionUserResponse)
    async def login_api(
        payload: LoginRequest,
        request: Request,
        session: Session = Depends(get_session),
    ):
        user = authenticate_user(session, payload.username, payload.password)
        if user is None:
            raise HTTPException(status_code=401, detail="Invalid username or password")
        request.session.clear()
        request.session["username"] = user.username
        return serialize_session_user(user)

    @app.post("/api/v1/logout", status_code=204)
    async def logout_api(request: Request) -> Response:
        request.session.clear()
        return Response(status_code=204)

    @app.get("/api/v1/session", response_model=SessionUserResponse)
    async def session_api(session: Session = Depends(get_session), current_user=Depends(get_actor_user)):
        return serialize_session_user(current_user)

    @app.get("/api/v1/users", response_model=UserDirectoryResponse)
    async def list_users_api(session: Session = Depends(get_session), current_user=Depends(get_actor_user)):
        require_user_admin(current_user)
        require_page_read(current_user, "settings")
        return {
            "users": [serialize_user(user) for user in list_users(session)],
            "roles": serialize_roles_with_access(list_roles(session)),
            "pages": serialize_page_catalog(),
        }

    @app.put("/api/v1/roles/page-access", response_model=UserDirectoryResponse)
    async def update_role_page_access_api(
        payload: RolePageAccessUpdateRequest,
        session: Session = Depends(get_session),
        current_user=Depends(get_actor_user),
    ):
        require_user_admin(current_user)
        require_page_edit(current_user, "settings")
        try:
            roles = update_role_page_access(
                session,
                {role_code: {page_key: access.model_dump() for page_key, access in pages.items()} for role_code, pages in payload.role_access.items()},
            )
        except ValueError as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc
        return {
            "users": [serialize_user(user) for user in list_users(session)],
            "roles": serialize_roles_with_access(roles),
            "pages": serialize_page_catalog(),
        }

    @app.post("/api/v1/users", response_model=ManagedUserModel)
    async def create_user_api(
        payload: UserCreateRequest,
        session: Session = Depends(get_session),
        current_user=Depends(get_actor_user),
    ):
        require_user_admin(current_user)
        require_page_edit(current_user, "settings")
        try:
            user = create_user(
                session,
                username=payload.username,
                display_name=payload.display_name,
                email=payload.email,
                password=payload.password,
                role_codes_to_assign=payload.role_codes,
                is_active=payload.is_active,
            )
        except ValueError as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc
        return serialize_user(user)

    @app.put("/api/v1/users/{user_id}", response_model=ManagedUserModel)
    async def update_user_api(
        user_id: int,
        payload: UserUpdateRequest,
        session: Session = Depends(get_session),
        current_user=Depends(get_actor_user),
    ):
        require_user_admin(current_user)
        require_page_edit(current_user, "settings")
        try:
            user = update_user(
                session,
                user_id=user_id,
                display_name=payload.display_name,
                email=payload.email,
                password=payload.password,
                role_codes_to_assign=payload.role_codes,
                is_active=payload.is_active,
            )
        except ValueError as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc
        if user is None:
            raise HTTPException(status_code=404, detail="User not found")
        return serialize_user(user)

    @app.delete("/api/v1/users/{user_id}", response_model=MutationResultModel)
    async def delete_user_api(
        user_id: int,
        session: Session = Depends(get_session),
        current_user=Depends(get_actor_user),
    ):
        require_user_admin(current_user)
        require_page_edit(current_user, "settings")
        try:
            deleted = delete_user(session, user_id=user_id)
        except ValueError as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc
        if not deleted:
            raise HTTPException(status_code=404, detail="User not found")
        return {"ok": True, "deleted_id": user_id}

    @app.get("/api/v1/backups", response_model=list[BackupRecordModel])
    async def list_backups_api(request: Request, current_user=Depends(get_actor_user)):
        require_user_admin(current_user)
        require_page_read(current_user, "settings")
        return backup_service.list_backups(request.app.state.settings)

    @app.post("/api/v1/backups", response_model=BackupCreateResponse, status_code=201)
    async def create_backup_api(
        payload: BackupCreateRequest,
        request: Request,
        current_user=Depends(get_actor_user),
    ):
        require_user_admin(current_user)
        require_page_edit(current_user, "settings")
        try:
            backup, backup_settings, pruned = backup_service.create_backup(request.app.state.settings, payload.label)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        except RuntimeError as exc:
            raise HTTPException(status_code=500, detail=str(exc)) from exc
        return {"backup": backup, "settings": backup_settings, "pruned": pruned}

    @app.get("/api/v1/backups/settings", response_model=BackupSettingsModel)
    async def get_backup_settings_api(request: Request, current_user=Depends(get_actor_user)):
        require_user_admin(current_user)
        require_page_read(current_user, "settings")
        return backup_service.load_backup_settings(request.app.state.settings)

    @app.put("/api/v1/backups/settings", response_model=BackupSettingsModel)
    async def update_backup_settings_api(
        payload: BackupSettingsUpdateRequest,
        request: Request,
        current_user=Depends(get_actor_user),
    ):
        require_user_admin(current_user)
        require_page_edit(current_user, "settings")
        try:
            return backup_service.update_backup_settings(
                request.app.state.settings,
                payload.model_dump(exclude_unset=True),
            )
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc

    @app.post("/api/v1/backups/restore", response_model=BackupRestoreResponse)
    async def restore_backup_api(
        payload: BackupRestoreRequest,
        request: Request,
        current_user=Depends(get_actor_user),
    ):
        require_user_admin(current_user)
        require_page_edit(current_user, "settings")
        try:
            result = backup_service.restore_backup(
                request.app.state.settings,
                payload.filename,
                force_disconnect=payload.force_disconnect,
            )
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        except RuntimeError as exc:
            raise HTTPException(status_code=500, detail=str(exc)) from exc
        return result

    @app.get("/api/v1/catalog", response_model=CatalogResponse)
    async def catalog_v1(category_id: int | None = None, session: Session = Depends(get_session), current_user=Depends(get_actor_user)):
        require_page_read(current_user, "catalog")
        return get_catalog_page_data(session, selected_category_id=category_id)

    @app.post("/api/v1/catalog/categories", response_model=MutationResultModel)
    async def create_catalog_category_v1(
        payload: CatalogCategoryCreateRequest,
        session: Session = Depends(get_session),
        current_user=Depends(get_actor_user),
    ):
        require_page_edit(current_user, "catalog")
        category = create_category(
            session,
            name=payload.name,
            description=payload.description,
            scope=payload.scope,
            parent_id=payload.parent_id,
        )
        return {"ok": True, "category_id": category.id}

    @app.post("/api/v1/catalog/components", response_model=CatalogComponentMutationResultModel)
    async def create_catalog_component_v1(
        payload: CatalogComponentCreateRequest,
        session: Session = Depends(get_session),
        current_user=Depends(get_actor_user),
    ):
        require_page_edit(current_user, "catalog")
        component = create_component(
            session,
            category_id=payload.category_id,
            component_type=payload.component_type,
            name=payload.name,
            short_name=payload.short_name,
            description=payload.description,
            short_description=payload.short_description,
            installation=payload.installation,
            unit_type=payload.unit_type,
        )
        return {
            "ok": True,
            "category_id": component.category_id,
            "component_id": component.id,
            "component": get_catalog_component_data(session, component.id),
        }

    @app.put("/api/v1/catalog/components/{component_id}", response_model=CatalogComponentMutationResultModel)
    async def update_catalog_component_v1(
        component_id: int,
        payload: CatalogComponentUpdateRequest,
        session: Session = Depends(get_session),
        current_user=Depends(get_actor_user),
    ):
        require_page_edit(current_user, "catalog")
        component = update_component(
            session,
            component_id=component_id,
            name=payload.name,
            short_name=payload.short_name,
            description=payload.description,
            short_description=payload.short_description,
            installation=payload.installation,
            unit_type=payload.unit_type,
            component_type=payload.component_type,
        )
        if component is None:
            raise HTTPException(status_code=404, detail="Catalog component not found")
        return {
            "ok": True,
            "category_id": component.category_id,
            "component_id": component.id,
            "component": get_catalog_component_data(session, component.id),
        }

    @app.put("/api/v1/catalog/components/{component_id}/media", response_model=CatalogComponentMutationResultModel)
    async def update_catalog_component_media_v1(
        component_id: int,
        payload: CatalogComponentMediaUpdateRequest,
        session: Session = Depends(get_session),
        current_user=Depends(get_actor_user),
    ):
        require_page_edit(current_user, "catalog")
        if payload.media_asset_id is not None and get_media_asset(session, payload.media_asset_id) is None:
            raise HTTPException(status_code=404, detail="Media asset not found")
        component = set_component_primary_media(
            session,
            component_id=component_id,
            media_asset_id=payload.media_asset_id,
            caption=payload.caption,
        )
        if component is None:
            raise HTTPException(status_code=404, detail="Catalog component not found")
        return {
            "ok": True,
            "category_id": component.category_id,
            "component_id": component.id,
            "component": get_catalog_component_data(session, component.id),
        }

    @app.delete("/api/v1/catalog/components/{component_id}", response_model=MutationResultModel)
    async def delete_catalog_component_v1(
        component_id: int,
        session: Session = Depends(get_session),
        current_user=Depends(get_actor_user),
    ):
        require_page_edit(current_user, "catalog")
        try:
            deleted_category_id = delete_component(session, component_id=component_id)
        except ValueError as exc:
            raise HTTPException(status_code=409, detail=str(exc)) from exc
        if deleted_category_id is None:
            raise HTTPException(status_code=404, detail="Catalog component not found")
        return {"ok": True, "category_id": deleted_category_id, "deleted_id": component_id}

    @app.put("/api/v1/catalog/components/{component_id}/attributes", response_model=CatalogComponentMutationResultModel)
    async def replace_catalog_component_attributes_v1(
        component_id: int,
        payload: CatalogComponentAttributesReplaceRequest,
        session: Session = Depends(get_session),
        current_user=Depends(get_actor_user),
    ):
        require_page_edit(current_user, "catalog")
        component = replace_component_attributes(
            session,
            component_id=component_id,
            scope=payload.scope,
            attributes=[attribute.model_dump() for attribute in payload.attributes],
        )
        if component is None:
            raise HTTPException(status_code=404, detail="Catalog component not found")
        return {
            "ok": True,
            "category_id": component.category_id,
            "component_id": component.id,
            "component": get_catalog_component_data(session, component.id),
        }

    @app.put("/api/v1/catalog/components/{component_id}/materials", response_model=CatalogComponentMutationResultModel)
    async def replace_catalog_component_materials_v1(
        component_id: int,
        payload: CatalogComponentMaterialsReplaceRequest,
        session: Session = Depends(get_session),
        current_user=Depends(get_actor_user),
    ):
        require_page_edit(current_user, "catalog")
        component = replace_component_material_rules(
            session,
            component_id=component_id,
            rules=[rule.model_dump() for rule in payload.rules],
        )
        if component is None:
            raise HTTPException(status_code=404, detail="Catalog component not found")
        return {
            "ok": True,
            "category_id": component.category_id,
            "component_id": component.id,
            "component": get_catalog_component_data(session, component.id),
        }

    @app.put("/api/v1/catalog/categories/{category_id}/links", response_model=MutationResultModel)
    async def update_catalog_category_links_v1(
        category_id: int,
        payload: CatalogCategoryLinksUpdateRequest,
        session: Session = Depends(get_session),
        current_user=Depends(get_actor_user),
    ):
        require_page_edit(current_user, "catalog")
        update_category_links(session, category_id=category_id, linked_category_ids=payload.linked_category_ids)
        return {"ok": True, "category_id": category_id, "linked_category_ids": payload.linked_category_ids}

    @app.get("/api/v1/catalog/materials/search", response_model=CatalogMaterialSearchResponse)
    async def search_catalog_materials_v1(
        request: Request,
        q: str,
        limit: int = 12,
        session: Session = Depends(get_session),
        current_user=Depends(get_actor_user),
    ):
        require_page_read(current_user, "catalog")
        capped_limit = max(1, min(limit, 20))
        local_results = search_material_candidates(session, query=q, limit=capped_limit)
        settings: Settings = request.app.state.settings
        live_results = search_erp_material_candidates(q, settings, limit=capped_limit)

        merged: list[dict[str, Any]] = []
        merged_by_sku: dict[str, dict[str, Any]] = {}
        for result in local_results:
            merged.append(result)
            merged_by_sku[result["sku"]] = result
        for result in live_results:
            existing = merged_by_sku.get(result["sku"])
            if existing is not None:
                existing["has_erp_data"] = True
                if not existing.get("unit"):
                    existing["unit"] = result.get("unit")
                if not existing.get("name"):
                    existing["name"] = result.get("name")
                continue
            merged.append(result)
            merged_by_sku[result["sku"]] = result

        return {
            "results": merged[:capped_limit],
            "live_erp_available": erp_search_available(settings),
        }

    @app.get("/api/v1/projects", response_model=ProjectsBoardResponse)
    async def projects_v1(session: Session = Depends(get_session), current_user=Depends(get_actor_user)):
        if not can_read_page(current_user, "projects") and not can_read_page(current_user, "cost_model"):
            require_page_read(current_user, "projects")
        return get_projects_page_data(session, user=current_user)

    @app.post("/api/v1/projects", response_model=MutationResultModel)
    async def create_project_v1(
        payload: ProjectCreateRequest,
        session: Session = Depends(get_session),
        current_user=Depends(get_actor_user),
        mutation_batch_id: str | None = Depends(get_mutation_batch_id),
    ):
        require_page_edit(current_user, "projects")
        require_project_create(current_user)
        project = create_project(
            session,
            name=payload.name,
            status=payload.status,
            actor_user=current_user,
            mutation_batch_id=mutation_batch_id,
        )
        return {"ok": True, "project_id": project.id}

    @app.put("/api/v1/projects/{project_id}/status", response_model=MutationResultModel)
    async def update_project_status_v1(
        project_id: int,
        payload: ProjectStatusUpdateRequest,
        session: Session = Depends(get_session),
        current_user=Depends(get_actor_user),
        mutation_batch_id: str | None = Depends(get_mutation_batch_id),
    ):
        project = get_project_with_details(session, project_id)
        if project is None:
            raise HTTPException(status_code=404, detail="Project not found")
        require_project_status_change(current_user, project)
        try:
            update_project_status(
                session,
                project=project,
                status=payload.status,
                actor_user=current_user,
                mutation_batch_id=mutation_batch_id,
            )
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        return {"ok": True, "project_id": project.id}

    @app.get("/api/v1/projects/{project_id}", response_model=ProjectDetailResponse)
    async def project_detail_v1(project_id: int, session: Session = Depends(get_session), current_user=Depends(get_actor_user)):
        require_page_read(current_user, "projects")
        project = get_project_with_details(session, project_id)
        if project is None:
            raise HTTPException(status_code=404, detail="Project not found")
        require_project_view(current_user, project)
        data = get_project_view_data(session, project_id, user=current_user)
        if data is None:
            raise HTTPException(status_code=404, detail="Project not found")
        return data

    @app.post("/api/v1/projects/{project_id}/subtypes", response_model=MutationResultModel)
    async def create_project_subtype_v1(
        project_id: int,
        payload: ProjectSubtypeCreateRequest,
        session: Session = Depends(get_session),
        current_user=Depends(get_actor_user),
        mutation_batch_id: str | None = Depends(get_mutation_batch_id),
    ):
        project = get_project_with_details(session, project_id)
        if project is None:
            raise HTTPException(status_code=404, detail="Project not found")
        require_project_edit(current_user, project)
        try:
            subtype = create_project_subtype(
                session,
                project=project,
                name=payload.name,
                parent_id=payload.parent_id,
                actor_user=current_user,
                mutation_batch_id=mutation_batch_id,
            )
        except ValueError as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc
        return {"ok": True, "project_id": project.id, "subtype_id": subtype.id}

    @app.put("/api/v1/projects/{project_id}/subtypes/{subtype_id}", response_model=MutationResultModel)
    async def update_project_subtype_v1(
        project_id: int,
        subtype_id: int,
        payload: ProjectSubtypeUpdateRequest,
        session: Session = Depends(get_session),
        current_user=Depends(get_actor_user),
        mutation_batch_id: str | None = Depends(get_mutation_batch_id),
    ):
        project = get_project_with_details(session, project_id)
        if project is None:
            raise HTTPException(status_code=404, detail="Project not found")
        require_project_edit(current_user, project)
        try:
            subtype = update_project_subtype(
                session,
                project=project,
                subtype_id=subtype_id,
                name=payload.name,
                actor_user=current_user,
                mutation_batch_id=mutation_batch_id,
            )
        except ValueError as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc
        if subtype is None:
            raise HTTPException(status_code=404, detail="Project subtype not found")
        return {"ok": True, "project_id": project.id, "subtype_id": subtype.id}

    @app.delete("/api/v1/projects/{project_id}/subtypes/{subtype_id}", response_model=MutationResultModel)
    async def delete_project_subtype_v1(
        project_id: int,
        subtype_id: int,
        session: Session = Depends(get_session),
        current_user=Depends(get_actor_user),
        mutation_batch_id: str | None = Depends(get_mutation_batch_id),
    ):
        project = get_project_with_details(session, project_id)
        if project is None:
            raise HTTPException(status_code=404, detail="Project not found")
        require_project_edit(current_user, project)
        deleted = delete_project_subtype(
            session,
            project=project,
            subtype_id=subtype_id,
            actor_user=current_user,
            mutation_batch_id=mutation_batch_id,
        )
        if not deleted:
            raise HTTPException(status_code=404, detail="Project subtype not found")
        return {"ok": True, "project_id": project.id, "deleted_id": subtype_id}

    @app.post("/api/v1/projects/{project_id}/instances", response_model=ProjectInstanceMutationResultModel)
    async def create_project_instance_v1(
        project_id: int,
        payload: ProjectInstanceCreateRequest,
        session: Session = Depends(get_session),
        current_user=Depends(get_actor_user),
        mutation_batch_id: str | None = Depends(get_mutation_batch_id),
    ):
        project = get_project_with_details(session, project_id)
        if project is None:
            raise HTTPException(status_code=404, detail="Project not found")
        require_project_edit(current_user, project)
        if payload.media_asset_id is not None and get_media_asset(session, payload.media_asset_id) is None:
            raise HTTPException(status_code=404, detail="Media asset not found")
        try:
            instance = create_project_instance(
                session,
                project=project,
                category_id=payload.category_id,
                component_id=payload.component_id,
                name=payload.name,
                short_name=payload.short_name,
                description=payload.description,
                short_description=payload.short_description,
                installation=payload.installation,
                unit_amount=payload.unit_amount,
                attribute_values=parse_attribute_values_rows(payload.attribute_values),
                selected_material_rule_ids=payload.selected_material_rule_ids,
                media_asset_id=payload.media_asset_id,
                actor_user=current_user,
                mutation_batch_id=mutation_batch_id,
            )
        except ValueError as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc
        return {
            "ok": True,
            "project_id": project_id,
            "category_id": payload.category_id,
            "instance_id": instance.id,
            "instance": get_project_instance_data(session, project_id, instance.id),
        }

    @app.put("/api/v1/projects/{project_id}/instances/{instance_id}", response_model=ProjectInstanceMutationResultModel)
    async def update_project_instance_v1(
        project_id: int,
        instance_id: int,
        payload: ProjectInstanceUpdateRequest,
        session: Session = Depends(get_session),
        current_user=Depends(get_actor_user),
        mutation_batch_id: str | None = Depends(get_mutation_batch_id),
    ):
        project = get_project_with_details(session, project_id)
        if project is None:
            raise HTTPException(status_code=404, detail="Project not found")
        require_project_edit(current_user, project)
        if payload.media_asset_id is not None and get_media_asset(session, payload.media_asset_id) is None:
            raise HTTPException(status_code=404, detail="Media asset not found")
        instance = update_project_instance(
            session,
            project=project,
            instance_id=instance_id,
            name=payload.name,
            short_name=payload.short_name,
            description=payload.description,
            short_description=payload.short_description,
            installation=payload.installation,
            unit_amount=payload.unit_amount,
            attribute_values=parse_attribute_values_rows(payload.attribute_values),
            media_asset_id=payload.media_asset_id,
            update_media=payload.clear_media or payload.media_asset_id is not None,
            actor_user=current_user,
            mutation_batch_id=mutation_batch_id,
        )
        if instance is None:
            raise HTTPException(status_code=404, detail="Project instance not found")
        return {
            "ok": True,
            "project_id": project_id,
            "instance_id": instance.id,
            "instance": get_project_instance_data(session, project_id, instance.id),
        }

    @app.post("/api/v1/projects/{project_id}/instances/{instance_id}/occurrences", response_model=ProjectOccurrenceMutationResultModel)
    async def create_project_occurrence_v1(
        project_id: int,
        instance_id: int,
        payload: ProjectOccurrenceUpdateRequest,
        session: Session = Depends(get_session),
        current_user=Depends(get_actor_user),
        mutation_batch_id: str | None = Depends(get_mutation_batch_id),
    ):
        project = get_project_with_details(session, project_id)
        if project is None:
            raise HTTPException(status_code=404, detail="Project not found")
        require_project_edit(current_user, project)
        try:
            occurrence = create_project_instance_occurrence(
                session,
                project=project,
                instance_id=instance_id,
                relationship_type=payload.relationship_type,
                context_label=payload.context_label,
                target_instance_id=payload.target_instance_id,
                attribute_values=parse_attribute_values_rows(payload.attribute_values),
                actor_user=current_user,
                mutation_batch_id=mutation_batch_id,
            )
        except ValueError as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc
        if occurrence is None:
            raise HTTPException(status_code=404, detail="Project instance not found")
        return {
            "ok": True,
            "project_id": project_id,
            "instance_id": instance_id,
            "occurrence_id": occurrence.id,
            "occurrence": get_project_occurrence_data(session, project_id, instance_id, occurrence.id),
        }

    @app.put("/api/v1/projects/{project_id}/instances/{instance_id}/occurrences/{occurrence_id}", response_model=ProjectOccurrenceMutationResultModel)
    async def update_project_occurrence_v1(
        project_id: int,
        instance_id: int,
        occurrence_id: int,
        payload: ProjectOccurrenceUpdateRequest,
        session: Session = Depends(get_session),
        current_user=Depends(get_actor_user),
        mutation_batch_id: str | None = Depends(get_mutation_batch_id),
    ):
        project = get_project_with_details(session, project_id)
        if project is None:
            raise HTTPException(status_code=404, detail="Project not found")
        require_project_edit(current_user, project)
        try:
            occurrence = update_project_instance_occurrence(
                session,
                project=project,
                instance_id=instance_id,
                occurrence_id=occurrence_id,
                relationship_type=payload.relationship_type,
                context_label=payload.context_label,
                target_instance_id=payload.target_instance_id,
                attribute_values=parse_attribute_values_rows(payload.attribute_values),
                actor_user=current_user,
                mutation_batch_id=mutation_batch_id,
            )
        except ValueError as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc
        if occurrence is None:
            raise HTTPException(status_code=404, detail="Project occurrence not found")
        return {
            "ok": True,
            "project_id": project_id,
            "instance_id": instance_id,
            "occurrence_id": occurrence.id,
            "occurrence": get_project_occurrence_data(session, project_id, instance_id, occurrence.id),
        }

    @app.delete("/api/v1/projects/{project_id}/instances/{instance_id}/occurrences/{occurrence_id}", response_model=MutationResultModel)
    async def delete_project_occurrence_v1(
        project_id: int,
        instance_id: int,
        occurrence_id: int,
        session: Session = Depends(get_session),
        current_user=Depends(get_actor_user),
        mutation_batch_id: str | None = Depends(get_mutation_batch_id),
    ):
        project = get_project_with_details(session, project_id)
        if project is None:
            raise HTTPException(status_code=404, detail="Project not found")
        require_project_edit(current_user, project)
        deleted = delete_project_instance_occurrence(
            session,
            project=project,
            instance_id=instance_id,
            occurrence_id=occurrence_id,
            actor_user=current_user,
            mutation_batch_id=mutation_batch_id,
        )
        if not deleted:
            raise HTTPException(status_code=404, detail="Project occurrence not found")
        return {"ok": True, "project_id": project_id, "instance_id": instance_id, "deleted_id": occurrence_id}

    @app.delete("/api/v1/projects/{project_id}/instances/{instance_id}", response_model=MutationResultModel)
    async def delete_project_instance_v1(
        project_id: int,
        instance_id: int,
        session: Session = Depends(get_session),
        current_user=Depends(get_actor_user),
        mutation_batch_id: str | None = Depends(get_mutation_batch_id),
    ):
        project = get_project_with_details(session, project_id)
        if project is None:
            raise HTTPException(status_code=404, detail="Project not found")
        require_project_edit(current_user, project)
        deleted = delete_project_instance(
            session,
            project=project,
            instance_id=instance_id,
            actor_user=current_user,
            mutation_batch_id=mutation_batch_id,
        )
        if not deleted:
            raise HTTPException(status_code=404, detail="Project instance not found")
        return {"ok": True, "project_id": project_id, "deleted_id": instance_id}

    @app.post("/api/v1/projects/{project_id}/instances/{instance_id}/materials", response_model=MutationResultModel)
    async def add_project_manual_material_v1(
        project_id: int,
        instance_id: int,
        payload: ManualMaterialAddRequest,
        session: Session = Depends(get_session),
        current_user=Depends(get_actor_user),
        mutation_batch_id: str | None = Depends(get_mutation_batch_id),
    ):
        project = get_project_with_details(session, project_id)
        if project is None:
            raise HTTPException(status_code=404, detail="Project not found")
        require_project_edit(current_user, project)
        try:
            added = add_project_instance_manual_material(
                session,
                project=project,
                instance_id=instance_id,
                material_id=payload.material_id,
                actor_user=current_user,
                mutation_batch_id=mutation_batch_id,
            )
        except ValueError as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc
        if not added:
            raise HTTPException(status_code=404, detail="Project instance not found")
        return {"ok": True, "project_id": project.id, "instance_id": instance_id}

    @app.put("/api/v1/projects/{project_id}/instances/{instance_id}/materials/{material_key}", response_model=MutationResultModel)
    async def update_project_material_occurrence_v1(
        project_id: int,
        instance_id: int,
        material_key: str,
        payload: MaterialOccurrenceUpdateRequest,
        session: Session = Depends(get_session),
        current_user=Depends(get_actor_user),
        mutation_batch_id: str | None = Depends(get_mutation_batch_id),
    ):
        project = get_project_with_details(session, project_id)
        if project is None:
            raise HTTPException(status_code=404, detail="Project not found")
        require_project_edit(current_user, project)
        try:
            updated = replace_project_material_occurrence(
                session,
                project=project,
                instance_id=instance_id,
                material_key=material_key,
                mode=payload.mode,
                entries=[
                    {
                        "subtype_id": row.subtype_id,
                        "quantity": row.quantity,
                        "assembly_quantity": row.assembly_quantity,
                    }
                    for row in payload.entries
                ],
                actor_user=current_user,
                mutation_batch_id=mutation_batch_id,
            )
        except ValueError as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc
        if not updated:
            raise HTTPException(status_code=404, detail="Project instance not found")
        return {"ok": True, "project_id": project.id, "instance_id": instance_id}

    @app.delete("/api/v1/projects/{project_id}/instances/{instance_id}/materials/{material_key}", response_model=MutationResultModel)
    async def delete_project_material_occurrence_v1(
        project_id: int,
        instance_id: int,
        material_key: str,
        session: Session = Depends(get_session),
        current_user=Depends(get_actor_user),
        mutation_batch_id: str | None = Depends(get_mutation_batch_id),
    ):
        project = get_project_with_details(session, project_id)
        if project is None:
            raise HTTPException(status_code=404, detail="Project not found")
        require_project_edit(current_user, project)
        try:
            deleted = delete_project_instance_material(
                session,
                project=project,
                instance_id=instance_id,
                material_key=material_key,
                actor_user=current_user,
                mutation_batch_id=mutation_batch_id,
            )
        except ValueError as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc
        if not deleted:
            raise HTTPException(status_code=404, detail="Project instance not found")
        return {"ok": True, "project_id": project.id, "instance_id": instance_id}

    @app.get(
        "/api/v1/projects/{project_id}/instances/{instance_id}/materials/{rule_id}/calculation-sheet",
        response_model=MaterialCalculationSheetResponse,
    )
    async def get_project_material_calculation_sheet_v1(
        project_id: int,
        instance_id: int,
        rule_id: int,
        session: Session = Depends(get_session),
        current_user=Depends(get_actor_user),
    ):
        project = get_project_with_details(session, project_id)
        if project is None:
            raise HTTPException(status_code=404, detail="Project not found")
        require_project_view(current_user, project)
        try:
            sheet = get_material_calculation_sheet(
                session,
                project=project,
                instance_id=instance_id,
                rule_id=rule_id,
            )
        except ValueError as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc
        if sheet is None:
            raise HTTPException(status_code=404, detail="Project instance not found")
        return sheet

    @app.put(
        "/api/v1/projects/{project_id}/instances/{instance_id}/materials/{rule_id}/calculation-sheet",
        response_model=MaterialCalculationSheetResponse,
    )
    async def update_project_material_calculation_sheet_v1(
        project_id: int,
        instance_id: int,
        rule_id: int,
        payload: MaterialCalculationSheetUpdateRequest,
        session: Session = Depends(get_session),
        current_user=Depends(get_actor_user),
    ):
        project = get_project_with_details(session, project_id)
        if project is None:
            raise HTTPException(status_code=404, detail="Project not found")
        require_project_edit(current_user, project)
        try:
            sheet = replace_material_calculation_sheet(
                session,
                project=project,
                instance_id=instance_id,
                rule_id=rule_id,
                cells=[
                    {
                        "row_index": row.row_index,
                        "column_index": row.column_index,
                        "raw_input": row.raw_input,
                    }
                    for row in payload.cells
                ],
            )
        except ValueError as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc
        if sheet is None:
            raise HTTPException(status_code=404, detail="Project instance not found")
        return sheet

    @app.get("/api/v1/projects/{project_id}/material-mode", response_model=MaterialModeResponse)
    async def project_material_mode_api(project_id: int, session: Session = Depends(get_session), current_user=Depends(get_actor_user)):
        project = get_project_with_details(session, project_id)
        if project is None:
            raise HTTPException(status_code=404, detail="Project not found")
        require_project_view(current_user, project)
        material_mode = project.material_mode
        return {
            "project_id": project.id,
            "mode": material_mode.mode.value if material_mode else "general",
            "updated_at": material_mode.updated_at.isoformat() if material_mode else project.updated_at.isoformat(),
            "changed_by": material_mode.changed_by.username if material_mode and material_mode.changed_by else None,
        }

    @app.get("/api/v1/projects/{project_id}/cost-model", response_model=CostModelViewResponse)
    async def get_project_cost_model_api(
        project_id: int,
        request: Request,
        session: Session = Depends(get_session),
        current_user=Depends(get_actor_user),
    ):
        from app.services.cost_model import get_cost_model_view

        require_page_read(current_user, "cost_model")
        view = get_cost_model_view(
            session,
            project_id,
            settings=request.app.state.settings,
            user=current_user,
        )
        if view is None:
            raise HTTPException(status_code=404, detail="Project not found")
        return view

    @app.put("/api/v1/projects/{project_id}/cost-model/adjustments", response_model=CostModelViewResponse)
    async def upsert_project_cost_model_adjustment_api(
        project_id: int,
        payload: CostModelAdjustmentUpsertRequest,
        request: Request,
        session: Session = Depends(get_session),
        current_user=Depends(get_actor_user),
    ):
        from app.services.cost_model import get_cost_model_view, upsert_cost_model_adjustment

        project = get_project_with_details(session, project_id)
        if project is None:
            raise HTTPException(status_code=404, detail="Project not found")
        require_page_edit(current_user, "cost_model")
        require_project_edit(current_user, project)
        try:
            upsert_cost_model_adjustment(
                session,
                project=project,
                material_id=payload.material_id,
                subtype_id=payload.subtype_id,
                adjusted_quantity=payload.adjusted_quantity,
                source_kind=payload.source_kind,
                source_note=payload.source_note,
                source_house_type_id=payload.source_house_type_id,
                source_range_start=payload.source_range_start,
                source_range_end=payload.source_range_end,
                source_sample_houses=payload.source_sample_houses,
                source_total_consumption=payload.source_total_consumption,
                actor=current_user,
            )
        except ValueError as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc

        view = get_cost_model_view(
            session,
            project_id,
            settings=request.app.state.settings,
            user=current_user,
        )
        if view is None:
            raise HTTPException(status_code=404, detail="Project not found")
        return view

    @app.delete("/api/v1/projects/{project_id}/cost-model/adjustments", response_model=CostModelViewResponse)
    async def delete_project_cost_model_adjustment_api(
        project_id: int,
        payload: CostModelAdjustmentDeleteRequest,
        request: Request,
        session: Session = Depends(get_session),
        current_user=Depends(get_actor_user),
    ):
        from app.services.cost_model import delete_cost_model_adjustment, get_cost_model_view

        project = get_project_with_details(session, project_id)
        if project is None:
            raise HTTPException(status_code=404, detail="Project not found")
        require_page_edit(current_user, "cost_model")
        require_project_edit(current_user, project)
        delete_cost_model_adjustment(
            session,
            project=project,
            material_id=payload.material_id,
            subtype_id=payload.subtype_id,
        )
        view = get_cost_model_view(
            session,
            project_id,
            settings=request.app.state.settings,
            user=current_user,
        )
        if view is None:
            raise HTTPException(status_code=404, detail="Project not found")
        return view

    @app.put("/api/v1/projects/{project_id}/material-mode", response_model=MaterialModeResponse)
    async def update_project_material_mode_api(
        project_id: int,
        session: Session = Depends(get_session),
        current_user=Depends(get_actor_user),
        payload: dict[str, Any] = Body(...),
        mutation_batch_id: str | None = Depends(get_mutation_batch_id),
    ):
        project = get_project_with_details(session, project_id)
        if project is None:
            raise HTTPException(status_code=404, detail="Project not found")
        require_project_edit(current_user, project)
        material_mode = set_project_material_mode(
            session,
            project=project,
            mode=payload["mode"],
            actor_user=current_user,
            mutation_batch_id=mutation_batch_id,
        )
        return {
            "project_id": project.id,
            "mode": material_mode.mode.value,
            "updated_at": material_mode.updated_at.isoformat(),
            "changed_by": material_mode.changed_by.username if material_mode.changed_by else None,
        }

    @app.get("/api/v1/projects/{project_id}/instances/{instance_id}/sync-preview", response_model=SyncPreviewResponse)
    async def sync_preview_api(
        project_id: int,
        instance_id: int,
        session: Session = Depends(get_session),
        current_user=Depends(get_actor_user),
    ):
        project = get_project_with_details(session, project_id)
        if project is None:
            raise HTTPException(status_code=404, detail="Project not found")
        require_project_view(current_user, project)
        if not any(item.id == instance_id for item in project.instances):
            raise HTTPException(status_code=404, detail="Project instance not found")
        preview = get_instance_sync_preview(session, instance_id)
        if preview is None:
            raise HTTPException(status_code=404, detail="Project instance not found")
        return preview

    @app.post("/api/v1/projects/{project_id}/instances/{instance_id}/refresh", response_model=SyncPreviewResponse)
    async def refresh_instance_api(
        project_id: int,
        instance_id: int,
        session: Session = Depends(get_session),
        current_user=Depends(get_actor_user),
        mutation_batch_id: str | None = Depends(get_mutation_batch_id),
    ):
        project = get_project_with_details(session, project_id)
        if project is None:
            raise HTTPException(status_code=404, detail="Project not found")
        require_project_edit(current_user, project)
        if not any(item.id == instance_id for item in project.instances):
            raise HTTPException(status_code=404, detail="Project instance not found")
        preview = refresh_instance_snapshot(
            session,
            instance_id=instance_id,
            actor_user=current_user,
            mutation_batch_id=mutation_batch_id,
        )
        if preview is None:
            raise HTTPException(status_code=404, detail="Project instance not found")
        return preview

    @app.post("/api/v1/projects/{project_id}/instances/{instance_id}/sync-fields/apply-catalog", response_model=SyncPreviewResponse)
    async def apply_catalog_value_to_instance_field_api(
        project_id: int,
        instance_id: int,
        payload: SyncFieldApplyRequest,
        session: Session = Depends(get_session),
        current_user=Depends(get_actor_user),
        mutation_batch_id: str | None = Depends(get_mutation_batch_id),
    ):
        project = get_project_with_details(session, project_id)
        if project is None:
            raise HTTPException(status_code=404, detail="Project not found")
        require_project_edit(current_user, project)
        if not any(item.id == instance_id for item in project.instances):
            raise HTTPException(status_code=404, detail="Project instance not found")
        try:
            preview = apply_catalog_value_to_instance_field(
                session,
                instance_id=instance_id,
                field=payload.field,
                actor_user=current_user,
                mutation_batch_id=mutation_batch_id,
            )
        except ValueError as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc
        if preview is None:
            raise HTTPException(status_code=404, detail="Project instance not found")
        return preview

    @app.post("/api/v1/projects/{project_id}/instances/{instance_id}/sync-fields/apply-instance", response_model=SyncPreviewResponse)
    async def apply_instance_value_to_catalog_field_api(
        project_id: int,
        instance_id: int,
        payload: SyncFieldApplyRequest,
        session: Session = Depends(get_session),
        current_user=Depends(get_actor_user),
        mutation_batch_id: str | None = Depends(get_mutation_batch_id),
    ):
        project = get_project_with_details(session, project_id)
        if project is None:
            raise HTTPException(status_code=404, detail="Project not found")
        require_project_edit(current_user, project)
        require_catalog_edit(current_user)
        if not any(item.id == instance_id for item in project.instances):
            raise HTTPException(status_code=404, detail="Project instance not found")
        try:
            preview = apply_instance_value_to_catalog_field(
                session,
                instance_id=instance_id,
                field=payload.field,
                actor_user=current_user,
                mutation_batch_id=mutation_batch_id,
            )
        except ValueError as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc
        if preview is None:
            raise HTTPException(status_code=404, detail="Project instance not found")
        return preview

    @app.post("/api/v1/projects/{project_id}/instances/{instance_id}/sync-attributes/reconcile", response_model=SyncPreviewResponse)
    async def reconcile_instance_base_attributes_api(
        project_id: int,
        instance_id: int,
        payload: SyncAttributeSchemaUpdateRequest,
        session: Session = Depends(get_session),
        current_user=Depends(get_actor_user),
        mutation_batch_id: str | None = Depends(get_mutation_batch_id),
    ):
        project = get_project_with_details(session, project_id)
        if project is None:
            raise HTTPException(status_code=404, detail="Project not found")
        require_project_edit(current_user, project)
        if not any(item.id == instance_id for item in project.instances):
            raise HTTPException(status_code=404, detail="Project instance not found")
        preview = reconcile_instance_base_attributes(
            session,
            instance_id=instance_id,
            add_attribute_names=payload.add_attribute_names,
            remove_attribute_names=payload.remove_attribute_names,
            actor_user=current_user,
            mutation_batch_id=mutation_batch_id,
        )
        if preview is None:
            raise HTTPException(status_code=404, detail="Project instance not found")
        return preview

    @app.get("/api/v1/projects/{project_id}/comments", response_model=list[CommentModel])
    async def project_comments_api(
        project_id: int,
        instance_id: int | None = None,
        session: Session = Depends(get_session),
        current_user=Depends(get_actor_user),
    ):
        project = get_project_with_details(session, project_id)
        if project is None:
            raise HTTPException(status_code=404, detail="Project not found")
        require_project_view(current_user, project)
        if instance_id is not None and not any(instance.id == instance_id for instance in project.instances):
            raise HTTPException(status_code=404, detail="Project instance not found")
        return get_project_comments(session, project_id, instance_id=instance_id, user=current_user)

    @app.post("/api/v1/projects/{project_id}/comments", response_model=CommentModel)
    async def add_comment_api(
        project_id: int,
        session: Session = Depends(get_session),
        current_user=Depends(get_actor_user),
        payload: CommentCreateRequest = Body(...),
        mutation_batch_id: str | None = Depends(get_mutation_batch_id),
    ):
        project = get_project_with_details(session, project_id)
        if project is None:
            raise HTTPException(status_code=404, detail="Project not found")
        require_project_view(current_user, project)
        body = payload.body.strip()
        if not body:
            raise HTTPException(status_code=400, detail="Comment body is required")
        instance = None
        if payload.instance_id:
            instance = next((item for item in project.instances if item.id == payload.instance_id), None)
            if instance is None:
                raise HTTPException(status_code=404, detail="Project instance not found")
        parent_comment = None
        if payload.parent_comment_id:
            parent_comment = next((item for item in project.comments if item.id == payload.parent_comment_id), None)
            if parent_comment is None:
                raise HTTPException(status_code=404, detail="Parent comment not found")
            if parent_comment.project_id != project.id or parent_comment.instance_id != (instance.id if instance else None):
                raise HTTPException(status_code=400, detail="Parent comment does not belong to this context")
        comment = add_project_comment(
            session,
            project=project,
            author=current_user,
            body=body,
            instance=instance,
            parent_comment=parent_comment,
            mutation_batch_id=mutation_batch_id,
        )
        payload_out = get_comment_payload(session, comment.id, user=current_user)
        if payload_out is None:
            raise HTTPException(status_code=500, detail="Comment could not be loaded after creation")
        return payload_out

    @app.delete("/api/v1/projects/{project_id}/comments/{comment_id}", response_model=CommentDeleteResponse)
    async def delete_comment_api(project_id: int, comment_id: int, session: Session = Depends(get_session), current_user=Depends(get_actor_user)):
        project = get_project_with_details(session, project_id)
        if project is None:
            raise HTTPException(status_code=404, detail="Project not found")
        require_project_view(current_user, project)
        comment = session.scalar(
            select(ProjectComment)
            .where(ProjectComment.id == comment_id, ProjectComment.project_id == project_id)
            .options(selectinload(ProjectComment.replies), selectinload(ProjectComment.mentions), selectinload(ProjectComment.notifications))
        )
        if comment is None:
            raise HTTPException(status_code=404, detail="Comment not found")
        try:
            return delete_project_comment(session, comment=comment, user=current_user)
        except PermissionError as exc:
            raise HTTPException(status_code=403, detail=str(exc)) from exc

    @app.get("/api/v1/comments/mentionable-users", response_model=MentionableUsersResponse)
    async def mentionable_users_api(
        project_id: int | None = None,
        session: Session = Depends(get_session),
        current_user=Depends(get_actor_user),
    ):
        del current_user
        role_codes = {role.code.lower() for role in list_roles(session)}
        if project_id is not None:
            users = session.scalars(
                select(User)
                .join(ProjectMembership, ProjectMembership.user_id == User.id)
                .where(ProjectMembership.project_id == project_id, User.is_active.is_(True))
                .options(selectinload(User.roles).selectinload(UserRole.role))
                .order_by(User.display_name, User.username)
            ).all()
        else:
            users = [user for user in list_users(session) if user.is_active]
        users = [user for user in users if user.username.lower() not in role_codes]
        return {"users": [serialize_user(user) for user in users]}

    @app.get("/api/v1/comments/{comment_id}/context", response_model=CommentContextResponse)
    async def comment_context_api(comment_id: int, session: Session = Depends(get_session), current_user=Depends(get_actor_user)):
        context = get_comment_context(session, comment_id)
        if context is None:
            raise HTTPException(status_code=404, detail="Comment not found")
        project = get_project_with_details(session, context["project_id"])
        if project is None:
            raise HTTPException(status_code=404, detail="Project not found")
        require_project_view(current_user, project)
        return context

    @app.get("/api/v1/projects/{project_id}/activity", response_model=list[ActivityGroupModel])
    async def project_activity_api(project_id: int, session: Session = Depends(get_session), current_user=Depends(get_actor_user)):
        project = get_project_with_details(session, project_id)
        if project is None:
            raise HTTPException(status_code=404, detail="Project not found")
        require_project_view(current_user, project)
        return get_project_activity(session, project_id)

    @app.get("/api/v1/activity", response_model=list[ActivityGroupModel])
    async def activity_history_api(session: Session = Depends(get_session), current_user=Depends(get_actor_user)):
        require_page_read(current_user, "history")
        return get_activity_history(session, current_user)

    @app.get("/api/v1/projects/{project_id}/approvals", response_model=list[ApprovalModel])
    async def project_approvals_api(project_id: int, session: Session = Depends(get_session), current_user=Depends(get_actor_user)):
        project = get_project_with_details(session, project_id)
        if project is None:
            raise HTTPException(status_code=404, detail="Project not found")
        require_project_view(current_user, project)
        return get_project_approvals(session, project_id)

    @app.post("/api/v1/projects/{project_id}/approvals", response_model=ApprovalModel)
    async def create_project_approval_api(
        project_id: int,
        session: Session = Depends(get_session),
        current_user=Depends(get_actor_user),
        payload: dict[str, Any] = Body(...),
        mutation_batch_id: str | None = Depends(get_mutation_batch_id),
    ):
        project = get_project_with_details(session, project_id)
        if project is None:
            raise HTTPException(status_code=404, detail="Project not found")
        require_project_edit(current_user, project)
        approval = request_project_approval(
            session,
            project=project,
            requested_by=current_user,
            summary=payload["summary"],
            mutation_batch_id=mutation_batch_id,
        )
        return get_project_approvals(session, project_id)[0]

    @app.post("/api/v1/approvals/{approval_id}/decision", response_model=ApprovalModel)
    async def decide_project_approval_api(
        approval_id: int,
        session: Session = Depends(get_session),
        current_user=Depends(get_actor_user),
        payload: dict[str, Any] = Body(...),
        mutation_batch_id: str | None = Depends(get_mutation_batch_id),
    ):
        require_page_edit(current_user, "material_dashboard")
        require_erp_admin(current_user)
        approval = decide_project_approval(
            session,
            approval_id=approval_id,
            decided_by=current_user,
            status=payload["status"],
            mutation_batch_id=mutation_batch_id,
        )
        if approval is None:
            raise HTTPException(status_code=404, detail="Approval not found")
        return get_project_approvals(session, approval.project_id)[0]

    @app.get("/api/v1/projects/{project_id}/exports", response_model=list[ExportJobModel])
    async def project_exports_api(project_id: int, session: Session = Depends(get_session), current_user=Depends(get_actor_user)):
        project = get_project_with_details(session, project_id)
        if project is None:
            raise HTTPException(status_code=404, detail="Project not found")
        require_project_view(current_user, project)
        return get_project_export_jobs(session, project_id)

    @app.post("/api/v1/projects/{project_id}/exports", response_model=ExportJobModel)
    async def request_project_export_api(
        request: Request,
        project_id: int,
        session: Session = Depends(get_session),
        current_user=Depends(get_actor_user),
        payload: dict[str, Any] = Body(...),
    ):
        project = get_project_with_details(session, project_id)
        if project is None:
            raise HTTPException(status_code=404, detail="Project not found")
        require_project_view(current_user, project)
        if payload["kind"] == "cost_model_workbook":
            require_cost_model_export(current_user)
        request_project_export(
            session,
            project=project,
            requested_by=current_user,
            export_kind=payload["kind"],
            payload=payload.get("payload"),
        )
        latest_job = session.scalar(
            select(ProjectExportJob)
            .where(ProjectExportJob.project_id == project_id)
            .order_by(ProjectExportJob.created_at.desc())
        )
        if latest_job is None:
            raise HTTPException(status_code=500, detail="Export job could not be created")
        execute_project_export(session, job=latest_job, settings=request.app.state.settings)
        return get_project_export_jobs(session, project_id)[0]

    @app.get("/api/v1/dashboard/projects/{project_id}/materials", response_model=DashboardResponse)
    async def dashboard_api(project_id: int, session: Session = Depends(get_session), current_user=Depends(get_actor_user)):
        require_erp_admin(current_user)
        data = get_project_material_dashboard(session, project_id)
        if data is None:
            raise HTTPException(status_code=404, detail="Project not found")
        return data

    @app.get("/api/v1/dashboard/materials", response_model=MaterialDashboardResponse)
    def material_dashboard_v1(
        request: Request,
        session: Session = Depends(get_session),
        current_user=Depends(get_actor_user),
    ):
        require_material_dashboard_access(current_user)
        ceco_filters = request.query_params.getlist("ceco")
        force_refresh = parse_refresh_flag(request.query_params.get("refresh"))
        movement_days_param = request.query_params.get("movement_days")
        try:
            movement_days = max(int(movement_days_param), 1) if movement_days_param is not None else 60
        except ValueError as exc:
            raise HTTPException(status_code=422, detail="movement_days must be a positive integer") from exc
        try:
            return get_recent_material_dashboard(
                request.app.state.settings,
                session=session,
                movement_days=movement_days,
                cost_centers=ceco_filters,
                force_refresh=force_refresh,
            )
        except RuntimeError as exc:
            raise HTTPException(status_code=503, detail=str(exc)) from exc

    @app.post("/api/v1/dashboard/materials", response_model=MaterialDashboardResponse)
    def material_dashboard_v1_post(
        payload: MaterialDashboardListRequest,
        request: Request,
        session: Session = Depends(get_session),
        current_user=Depends(get_actor_user),
    ):
        require_material_dashboard_access(current_user)
        if payload.start_date and payload.end_date and payload.start_date > payload.end_date:
            raise HTTPException(status_code=422, detail="start_date must be on or before end_date")
        try:
            return get_recent_material_dashboard(
                request.app.state.settings,
                session=session,
                movement_days=payload.movement_days,
                start_date=payload.start_date,
                end_date=payload.end_date,
                cost_centers=payload.cecos,
                excluded_cost_centers=payload.excluded_cecos,
                force_refresh=payload.refresh,
            )
        except ValueError as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc
        except RuntimeError as exc:
            raise HTTPException(status_code=503, detail=str(exc)) from exc

    @app.get("/api/v1/dashboard/materials/search", response_model=CatalogMaterialSearchResponse)
    async def search_material_dashboard_materials_v1(
        request: Request,
        q: str,
        limit: int = 10,
        current_user=Depends(get_actor_user),
    ):
        require_material_dashboard_access(current_user)
        capped_limit = max(1, min(limit, 20))
        settings: Settings = request.app.state.settings
        return {
            "results": search_erp_material_candidates(q, settings, limit=capped_limit),
            "live_erp_available": erp_search_available(settings),
        }

    @app.get("/api/v1/dashboard/materials/cecos", response_model=MaterialDashboardCecoResponse)
    def material_dashboard_cecos_v1(
        request: Request,
        session: Session = Depends(get_session),
        current_user=Depends(get_actor_user),
    ):
        require_material_dashboard_access(current_user)
        force_refresh = parse_refresh_flag(request.query_params.get("refresh"))
        try:
            return get_material_dashboard_cost_centers(
                request.app.state.settings,
                session=session,
                force_refresh=force_refresh,
            )
        except RuntimeError as exc:
            raise HTTPException(status_code=503, detail=str(exc)) from exc

    @app.get("/api/v1/dashboard/materials/house-types", response_model=MaterialDashboardHouseTypesResponse)
    def material_dashboard_house_types_v1(
        current_user=Depends(get_actor_user),
    ):
        require_material_dashboard_access(current_user)
        try:
            return get_material_dashboard_house_types(app.state.settings)
        except RuntimeError as exc:
            raise HTTPException(status_code=503, detail=str(exc)) from exc

    @app.get("/api/v1/dashboard/material-groups", response_model=MaterialStudyGroupListResponse)
    def material_study_groups_v1(
        request: Request,
        session: Session = Depends(get_session),
        current_user=Depends(get_actor_user),
    ):
        require_material_dashboard_access(current_user)
        ceco_filters = request.query_params.getlist("ceco")
        movement_days_param = request.query_params.get("movement_days")
        try:
            movement_days = max(int(movement_days_param), 1) if movement_days_param is not None else 60
        except ValueError as exc:
            raise HTTPException(status_code=422, detail="movement_days must be a positive integer") from exc
        try:
            return get_material_dashboard_groups(
                request.app.state.settings,
                session=session,
                movement_days=movement_days,
                cost_centers=ceco_filters,
            )
        except RuntimeError as exc:
            raise HTTPException(status_code=503, detail=str(exc)) from exc

    @app.post("/api/v1/dashboard/material-groups/query", response_model=MaterialStudyGroupListResponse)
    def material_study_groups_v1_post(
        payload: MaterialDashboardListRequest,
        request: Request,
        session: Session = Depends(get_session),
        current_user=Depends(get_actor_user),
    ):
        require_material_dashboard_access(current_user)
        if payload.start_date and payload.end_date and payload.start_date > payload.end_date:
            raise HTTPException(status_code=422, detail="start_date must be on or before end_date")
        try:
            return get_material_dashboard_groups(
                request.app.state.settings,
                session=session,
                movement_days=payload.movement_days,
                start_date=payload.start_date,
                end_date=payload.end_date,
                cost_centers=payload.cecos,
                excluded_cost_centers=payload.excluded_cecos,
            )
        except ValueError as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc
        except RuntimeError as exc:
            raise HTTPException(status_code=503, detail=str(exc)) from exc

    @app.post("/api/v1/dashboard/material-groups", response_model=MaterialStudyGroupModel)
    def create_material_study_group_v1(
        payload: MaterialStudyGroupPayloadModel,
        session: Session = Depends(get_session),
        current_user=Depends(get_actor_user),
    ):
        require_page_edit(current_user, "material_dashboard")
        try:
            return create_material_study_group(
                session,
                name=payload.name,
                description=payload.description,
                study_unit=payload.study_unit,
                members=[member.model_dump() for member in payload.members],
            )
        except ValueError as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc

    @app.put("/api/v1/dashboard/material-groups/{group_id}", response_model=MaterialStudyGroupModel)
    def update_material_study_group_v1(
        group_id: int,
        payload: MaterialStudyGroupPayloadModel,
        session: Session = Depends(get_session),
        current_user=Depends(get_actor_user),
    ):
        require_page_edit(current_user, "material_dashboard")
        try:
            group = update_material_study_group(
                session,
                group_id,
                name=payload.name,
                description=payload.description,
                study_unit=payload.study_unit,
                members=[member.model_dump() for member in payload.members],
            )
        except ValueError as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc
        if group is None:
            raise HTTPException(status_code=404, detail="Material group not found")
        return group

    @app.delete("/api/v1/dashboard/material-groups/{group_id}", response_model=MutationResultModel)
    def delete_material_study_group_v1(
        group_id: int,
        session: Session = Depends(get_session),
        current_user=Depends(get_actor_user),
    ):
        require_page_edit(current_user, "material_dashboard")
        if not delete_material_study_group(session, group_id):
            raise HTTPException(status_code=404, detail="Material group not found")
        return {"ok": True}

    @app.get("/api/v1/dashboard/material-groups/{group_id}/detail", response_model=MaterialDashboardGroupDetailResponse)
    def material_dashboard_group_detail_v1(
        group_id: int,
        request: Request,
        session: Session = Depends(get_session),
        current_user=Depends(get_actor_user),
    ):
        require_material_dashboard_access(current_user)
        ceco_filters = request.query_params.getlist("ceco")
        try:
            detail = get_material_dashboard_group_detail(
                request.app.state.settings,
                group_id,
                session=session,
                cost_centers=ceco_filters,
            )
        except RuntimeError as exc:
            raise HTTPException(status_code=503, detail=str(exc)) from exc
        if detail is None:
            raise HTTPException(status_code=404, detail="Material group not found")
        return detail

    @app.post("/api/v1/dashboard/material-groups/{group_id}/detail", response_model=MaterialDashboardGroupDetailResponse)
    def material_dashboard_group_detail_v1_post(
        group_id: int,
        payload: MaterialDashboardFilterRequest,
        request: Request,
        session: Session = Depends(get_session),
        current_user=Depends(get_actor_user),
    ):
        require_material_dashboard_access(current_user)
        try:
            detail = get_material_dashboard_group_detail(
                request.app.state.settings,
                group_id,
                session=session,
                cost_centers=payload.cecos,
                excluded_cost_centers=payload.excluded_cecos,
            )
        except RuntimeError as exc:
            raise HTTPException(status_code=503, detail=str(exc)) from exc
        if detail is None:
            raise HTTPException(status_code=404, detail="Material group not found")
        return detail

    @app.get("/api/v1/dashboard/material-groups/{group_id}/house-comparison", response_model=MaterialDashboardGroupHouseComparisonResponse)
    def material_dashboard_group_house_comparison_v1(
        group_id: int,
        house_type_id: int,
        request: Request,
        project_id: int | None = None,
        session: Session = Depends(get_session),
        current_user=Depends(get_actor_user),
    ):
        require_material_dashboard_access(current_user)
        ceco_filters = request.query_params.getlist("ceco")
        start_date = request.query_params.get("start_date")
        end_date = request.query_params.get("end_date")
        try:
            requested_start_date = date.fromisoformat(start_date) if start_date else None
            requested_end_date = date.fromisoformat(end_date) if end_date else None
        except ValueError as exc:
            raise HTTPException(status_code=422, detail="Invalid date range; expected YYYY-MM-DD") from exc
        if requested_start_date and requested_end_date and requested_start_date > requested_end_date:
            raise HTTPException(status_code=422, detail="start_date must be on or before end_date")
        history_days = (
            max((requested_end_date - requested_start_date).days + 1, 1)
            if requested_start_date and requested_end_date
            else 90
        )
        try:
            comparison = get_material_dashboard_group_house_comparison(
                request.app.state.settings,
                group_id,
                session=session,
                house_type_id=house_type_id,
                cost_centers=ceco_filters,
                history_days=history_days,
                start_date=requested_start_date,
                end_date=requested_end_date,
            )
        except ValueError as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc
        except RuntimeError as exc:
            raise HTTPException(status_code=503, detail=str(exc)) from exc
        if comparison is None:
            raise HTTPException(status_code=404, detail="Material group not found")
        return attach_project_comparison(
            comparison,
            project_id=project_id,
            sku_factors={
                str(member.get("sku") or ""): float(member.get("factor_to_study_unit") or 0.0)
                for member in comparison.get("members", [])
            },
            session=session,
            current_user=current_user,
        )

    @app.post("/api/v1/dashboard/material-groups/{group_id}/house-comparison", response_model=MaterialDashboardGroupHouseComparisonResponse)
    def material_dashboard_group_house_comparison_v1_post(
        group_id: int,
        payload: MaterialDashboardHouseComparisonRequest,
        request: Request,
        session: Session = Depends(get_session),
        current_user=Depends(get_actor_user),
    ):
        require_material_dashboard_access(current_user)
        if payload.start_date and payload.end_date and payload.start_date > payload.end_date:
            raise HTTPException(status_code=422, detail="start_date must be on or before end_date")
        history_days = (
            max((payload.end_date - payload.start_date).days + 1, 1)
            if payload.start_date and payload.end_date
            else 90
        )
        try:
            comparison = get_material_dashboard_group_house_comparison(
                request.app.state.settings,
                group_id,
                session=session,
                house_type_id=payload.house_type_id,
                cost_centers=payload.cecos,
                excluded_cost_centers=payload.excluded_cecos,
                history_days=history_days,
                start_date=payload.start_date,
                end_date=payload.end_date,
            )
        except ValueError as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc
        except RuntimeError as exc:
            raise HTTPException(status_code=503, detail=str(exc)) from exc
        if comparison is None:
            raise HTTPException(status_code=404, detail="Material group not found")
        return attach_project_comparison(
            comparison,
            project_id=payload.project_id,
            sku_factors={
                str(member.get("sku") or ""): float(member.get("factor_to_study_unit") or 0.0)
                for member in comparison.get("members", [])
            },
            session=session,
            current_user=current_user,
        )

    @app.get("/api/v1/dashboard/material-groups/{group_id}/movements", response_model=MaterialDashboardGroupMovementResponse)
    def material_dashboard_group_movements_v1(
        group_id: int,
        request: Request,
        session: Session = Depends(get_session),
        current_user=Depends(get_actor_user),
    ):
        require_material_dashboard_access(current_user)
        ceco_filters = request.query_params.getlist("ceco")
        start_date = request.query_params.get("start_date")
        end_date = request.query_params.get("end_date")
        try:
            requested_start_date = date.fromisoformat(start_date) if start_date else None
            requested_end_date = date.fromisoformat(end_date) if end_date else None
        except ValueError as exc:
            raise HTTPException(status_code=422, detail="Invalid date range provided for movement history") from exc
        if requested_start_date and requested_end_date and requested_start_date > requested_end_date:
            raise HTTPException(status_code=422, detail="start_date must be on or before end_date")
        history_days = (
            max((requested_end_date - requested_start_date).days + 1, 1)
            if requested_start_date and requested_end_date
            else 90
        )
        try:
            history = get_material_dashboard_group_history(
                request.app.state.settings,
                group_id,
                session=session,
                history_days=history_days,
                start_date=requested_start_date,
                end_date=requested_end_date,
                cost_centers=ceco_filters,
            )
        except ValueError as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc
        except RuntimeError as exc:
            raise HTTPException(status_code=503, detail=str(exc)) from exc
        if history is None:
            raise HTTPException(status_code=404, detail="Material group not found")
        return history

    @app.post("/api/v1/dashboard/material-groups/{group_id}/movements", response_model=MaterialDashboardGroupMovementResponse)
    def material_dashboard_group_movements_v1_post(
        group_id: int,
        payload: MaterialDashboardDateRangeRequest,
        request: Request,
        session: Session = Depends(get_session),
        current_user=Depends(get_actor_user),
    ):
        require_material_dashboard_access(current_user)
        if payload.start_date and payload.end_date and payload.start_date > payload.end_date:
            raise HTTPException(status_code=422, detail="start_date must be on or before end_date")
        history_days = (
            max((payload.end_date - payload.start_date).days + 1, 1)
            if payload.start_date and payload.end_date
            else 90
        )
        try:
            history = get_material_dashboard_group_history(
                request.app.state.settings,
                group_id,
                session=session,
                history_days=history_days,
                start_date=payload.start_date,
                end_date=payload.end_date,
                cost_centers=payload.cecos,
                excluded_cost_centers=payload.excluded_cecos,
            )
        except ValueError as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc
        except RuntimeError as exc:
            raise HTTPException(status_code=503, detail=str(exc)) from exc
        if history is None:
            raise HTTPException(status_code=404, detail="Material group not found")
        return history

    @app.post("/api/v1/dashboard/materials/economic-metrics", response_model=MaterialDashboardEconomicMetricsResponse)
    def material_dashboard_economic_metrics_v1_post(
        payload: MaterialDashboardHouseComparisonRequest,
        request: Request,
        session: Session = Depends(get_session),
        current_user=Depends(get_actor_user),
    ):
        require_material_dashboard_access(current_user)
        if payload.start_date and payload.end_date and payload.start_date > payload.end_date:
            raise HTTPException(status_code=422, detail="start_date must be on or before end_date")
        movement_days = (
            max((payload.end_date - payload.start_date).days + 1, 1)
            if payload.start_date and payload.end_date
            else 90
        )
        project_quantity_by_sku: dict[str, float] = {}
        if payload.project_id is not None:
            project, project_quantity_by_sku = get_material_dashboard_project_quantity_map(
                session,
                project_id=payload.project_id,
            )
            if project is None:
                raise HTTPException(status_code=404, detail="Project not found")
            require_project_view(current_user, project)
        try:
            return get_material_dashboard_economic_metrics(
                request.app.state.settings,
                session=session,
                house_type_id=payload.house_type_id,
                project_id=payload.project_id,
                project_quantity_by_sku=project_quantity_by_sku,
                movement_days=movement_days,
                start_date=payload.start_date,
                end_date=payload.end_date,
                cost_centers=payload.cecos,
                excluded_cost_centers=payload.excluded_cecos,
                force_refresh=payload.refresh,
            )
        except ValueError as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc
        except RuntimeError as exc:
            raise HTTPException(status_code=503, detail=str(exc)) from exc

    @app.get("/api/v1/dashboard/materials/{sku}", response_model=MaterialDashboardDetailResponse)
    def material_dashboard_detail_v1(
        sku: str,
        request: Request,
        session: Session = Depends(get_session),
        current_user=Depends(get_actor_user),
    ):
        require_material_dashboard_access(current_user)
        ceco_filters = request.query_params.getlist("ceco")
        force_refresh = parse_refresh_flag(request.query_params.get("refresh"))
        try:
            detail = get_material_dashboard_detail(
                request.app.state.settings,
                sku,
                session=session,
                cost_centers=ceco_filters,
                force_refresh=force_refresh,
            )
        except RuntimeError as exc:
            raise HTTPException(status_code=503, detail=str(exc)) from exc
        if detail is None:
            raise HTTPException(status_code=404, detail="Material not found")
        return detail

    @app.post("/api/v1/dashboard/materials/{sku}", response_model=MaterialDashboardDetailResponse)
    def material_dashboard_detail_v1_post(
        sku: str,
        payload: MaterialDashboardFilterRequest,
        request: Request,
        session: Session = Depends(get_session),
        current_user=Depends(get_actor_user),
    ):
        require_material_dashboard_access(current_user)
        try:
            detail = get_material_dashboard_detail(
                request.app.state.settings,
                sku,
                session=session,
                cost_centers=payload.cecos,
                excluded_cost_centers=payload.excluded_cecos,
                force_refresh=payload.refresh,
            )
        except RuntimeError as exc:
            raise HTTPException(status_code=503, detail=str(exc)) from exc
        if detail is None:
            raise HTTPException(status_code=404, detail="Material not found")
        return detail

    @app.post("/api/v1/dashboard/materials/{sku}/study", response_model=MaterialDashboardMaterialStudyResponse)
    def material_dashboard_material_study_v1_post(
        sku: str,
        payload: MaterialDashboardHouseComparisonRequest,
        request: Request,
        session: Session = Depends(get_session),
        current_user=Depends(get_actor_user),
    ):
        require_material_dashboard_access(current_user)
        if payload.start_date and payload.end_date and payload.start_date > payload.end_date:
            raise HTTPException(status_code=422, detail="start_date must be on or before end_date")
        history_days = (
            max((payload.end_date - payload.start_date).days + 1, 1)
            if payload.start_date and payload.end_date
            else 90
        )
        try:
            detail = get_material_dashboard_detail(
                request.app.state.settings,
                sku,
                session=session,
                cost_centers=payload.cecos,
                excluded_cost_centers=payload.excluded_cecos,
                force_refresh=payload.refresh,
            )
            if detail is None:
                raise HTTPException(status_code=404, detail="Material not found")
            history = get_material_dashboard_history(
                request.app.state.settings,
                sku,
                session=session,
                history_days=history_days,
                start_date=payload.start_date,
                end_date=payload.end_date,
                cost_centers=payload.cecos,
                excluded_cost_centers=payload.excluded_cecos,
                force_refresh=payload.refresh,
            )
            comparison = get_material_dashboard_house_start_comparison(
                request.app.state.settings,
                sku=sku,
                movements=history.get("movements", []),
                house_type_id=payload.house_type_id,
                cost_centers=payload.cecos,
                history_days=int(history.get("movement_days") or history_days),
                start_date=payload.start_date.isoformat() if payload.start_date else None,
                end_date=payload.end_date.isoformat() if payload.end_date else None,
            )
            comparison = attach_project_comparison(
                comparison,
                project_id=payload.project_id,
                sku_factors={sku: 1.0},
                session=session,
                current_user=current_user,
            )
            return {
                "detail": detail,
                "history": history,
                "comparison": comparison,
            }
        except HTTPException:
            raise
        except ValueError as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc
        except RuntimeError as exc:
            raise HTTPException(status_code=503, detail=str(exc)) from exc

    @app.get("/api/v1/dashboard/materials/{sku}/project-usage", response_model=MaterialDashboardProjectUsageResponse)
    def material_dashboard_project_usage_v1(
        sku: str,
        project_id: int,
        session: Session = Depends(get_session),
        current_user=Depends(get_actor_user),
    ):
        require_material_dashboard_access(current_user)
        project = session.get(Project, project_id)
        if project is None:
            raise HTTPException(status_code=404, detail="Project not found")
        require_project_view(current_user, project)
        usage = get_material_dashboard_project_usage(
            session,
            project_id=project_id,
            sku=sku,
        )
        if usage is None:
            raise HTTPException(status_code=404, detail="Project not found")
        return usage

    @app.get("/api/v1/dashboard/materials/{sku}/house-comparison", response_model=MaterialDashboardHouseComparisonResponse)
    def material_dashboard_house_comparison_v1(
        sku: str,
        house_type_id: int,
        request: Request,
        project_id: int | None = None,
        session: Session = Depends(get_session),
        current_user=Depends(get_actor_user),
    ):
        require_material_dashboard_access(current_user)
        ceco_filters = request.query_params.getlist("ceco")
        force_refresh = parse_refresh_flag(request.query_params.get("refresh"))
        start_date = request.query_params.get("start_date")
        end_date = request.query_params.get("end_date")
        try:
            requested_start_date = date.fromisoformat(start_date) if start_date else None
            requested_end_date = date.fromisoformat(end_date) if end_date else None
        except ValueError as exc:
            raise HTTPException(status_code=422, detail="Invalid date range; expected YYYY-MM-DD") from exc
        if requested_start_date and requested_end_date and requested_start_date > requested_end_date:
            raise HTTPException(status_code=422, detail="start_date must be on or before end_date")
        history_days = (
            max((requested_end_date - requested_start_date).days + 1, 1)
            if requested_start_date and requested_end_date
            else 90
        )
        try:
            history = get_material_dashboard_history(
                request.app.state.settings,
                sku,
                session=session,
                cost_centers=ceco_filters,
                history_days=history_days,
                force_refresh=force_refresh,
            )
            comparison = get_material_dashboard_house_start_comparison(
                request.app.state.settings,
                sku=sku,
                movements=history.get("movements", []),
                house_type_id=house_type_id,
                cost_centers=ceco_filters,
                history_days=int(history.get("movement_days") or history_days),
                start_date=start_date,
                end_date=end_date,
            )
            return attach_project_comparison(
                comparison,
                project_id=project_id,
                sku_factors={sku: 1.0},
                session=session,
                current_user=current_user,
            )
        except ValueError as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc
        except RuntimeError as exc:
            raise HTTPException(status_code=503, detail=str(exc)) from exc

    @app.post("/api/v1/dashboard/materials/{sku}/house-comparison", response_model=MaterialDashboardHouseComparisonResponse)
    def material_dashboard_house_comparison_v1_post(
        sku: str,
        payload: MaterialDashboardHouseComparisonRequest,
        request: Request,
        session: Session = Depends(get_session),
        current_user=Depends(get_actor_user),
    ):
        require_material_dashboard_access(current_user)
        if payload.start_date and payload.end_date and payload.start_date > payload.end_date:
            raise HTTPException(status_code=422, detail="start_date must be on or before end_date")
        history_days = (
            max((payload.end_date - payload.start_date).days + 1, 1)
            if payload.start_date and payload.end_date
            else 90
        )
        try:
            history = get_material_dashboard_history(
                request.app.state.settings,
                sku,
                session=session,
                cost_centers=payload.cecos,
                excluded_cost_centers=payload.excluded_cecos,
                history_days=history_days,
                start_date=payload.start_date,
                end_date=payload.end_date,
                force_refresh=payload.refresh,
            )
            comparison = get_material_dashboard_house_start_comparison(
                request.app.state.settings,
                sku=sku,
                movements=history.get("movements", []),
                house_type_id=payload.house_type_id,
                cost_centers=payload.cecos,
                history_days=int(history.get("movement_days") or history_days),
                start_date=payload.start_date.isoformat() if payload.start_date else None,
                end_date=payload.end_date.isoformat() if payload.end_date else None,
            )
            return attach_project_comparison(
                comparison,
                project_id=payload.project_id,
                sku_factors={sku: 1.0},
                session=session,
                current_user=current_user,
            )
        except ValueError as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc
        except RuntimeError as exc:
            raise HTTPException(status_code=503, detail=str(exc)) from exc

    @app.get("/api/v1/dashboard/materials/{sku}/movements", response_model=MaterialDashboardMovementResponse)
    def material_dashboard_movements_v1(
        sku: str,
        request: Request,
        session: Session = Depends(get_session),
        current_user=Depends(get_actor_user),
    ):
        require_material_dashboard_access(current_user)
        ceco_filters = request.query_params.getlist("ceco")
        force_refresh = parse_refresh_flag(request.query_params.get("refresh"))
        start_date = request.query_params.get("start_date")
        end_date = request.query_params.get("end_date")
        try:
            requested_start_date = date.fromisoformat(start_date) if start_date else None
            requested_end_date = date.fromisoformat(end_date) if end_date else None
        except ValueError as exc:
            raise HTTPException(status_code=422, detail="Invalid date range provided for movement history") from exc
        if requested_start_date and requested_end_date and requested_start_date > requested_end_date:
            raise HTTPException(status_code=422, detail="start_date must be on or before end_date")
        history_days = (
            max((requested_end_date - requested_start_date).days + 1, 1)
            if requested_start_date and requested_end_date
            else 90
        )
        try:
            return get_material_dashboard_history(
                request.app.state.settings,
                sku,
                session=session,
                history_days=history_days,
                start_date=requested_start_date,
                end_date=requested_end_date,
                cost_centers=ceco_filters,
                force_refresh=force_refresh,
            )
        except ValueError as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc
        except RuntimeError as exc:
            raise HTTPException(status_code=503, detail=str(exc)) from exc

    @app.post("/api/v1/dashboard/materials/{sku}/movements", response_model=MaterialDashboardMovementResponse)
    def material_dashboard_movements_v1_post(
        sku: str,
        payload: MaterialDashboardDateRangeRequest,
        request: Request,
        session: Session = Depends(get_session),
        current_user=Depends(get_actor_user),
    ):
        require_material_dashboard_access(current_user)
        if payload.start_date and payload.end_date and payload.start_date > payload.end_date:
            raise HTTPException(status_code=422, detail="start_date must be on or before end_date")
        history_days = (
            max((payload.end_date - payload.start_date).days + 1, 1)
            if payload.start_date and payload.end_date
            else 90
        )
        try:
            return get_material_dashboard_history(
                request.app.state.settings,
                sku,
                session=session,
                history_days=history_days,
                start_date=payload.start_date,
                end_date=payload.end_date,
                cost_centers=payload.cecos,
                excluded_cost_centers=payload.excluded_cecos,
                force_refresh=payload.refresh,
            )
        except ValueError as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc
        except RuntimeError as exc:
            raise HTTPException(status_code=503, detail=str(exc)) from exc

    @app.get("/api/v1/notifications", response_model=list[NotificationModel])
    async def notifications_api(session: Session = Depends(get_session), current_user=Depends(get_actor_user)):
        return get_user_notifications(session, current_user)

    @app.get("/api/v1/notifications/unread-count", response_model=CommentUnreadCountResponse)
    async def notification_unread_count_api(session: Session = Depends(get_session), current_user=Depends(get_actor_user)):
        return {"unread": get_unread_notification_count(session, current_user)}

    @app.post("/api/v1/notifications/{notification_id}/read", response_model=CommentNotificationReadResponse)
    async def mark_notification_read_api(notification_id: int, session: Session = Depends(get_session), current_user=Depends(get_actor_user)):
        result = mark_notification_read(session, notification_id=notification_id, user=current_user)
        if result is None:
            raise HTTPException(status_code=404, detail="Notification not found")
        return result

    @app.post("/api/v1/projects/{project_id}/instances/{instance_id}/notifications/read", response_model=MutationResultModel)
    async def mark_instance_notifications_read_api(
        project_id: int,
        instance_id: int,
        session: Session = Depends(get_session),
        current_user=Depends(get_actor_user),
    ):
        project = get_project_with_details(session, project_id)
        if project is None:
            raise HTTPException(status_code=404, detail="Project not found")
        require_project_view(current_user, project)
        if not any(instance.id == instance_id for instance in project.instances):
            raise HTTPException(status_code=404, detail="Project instance not found")
        result = mark_instance_notifications_read(session, project_id=project_id, instance_id=instance_id, user=current_user)
        return {"ok": True, "deleted_id": result["updated"]}

    @app.get("/api/v1/public/projects", response_model=PublicProjectListResponse)
    async def public_projects_api(session: Session = Depends(get_session)):
        return {"projects": list_public_projects(session)}

    @app.get("/api/v1/public/projects/{project_id}/skus", response_model=PublicProjectSkuResponse)
    async def public_project_skus_api(project_id: int, session: Session = Depends(get_session)):
        data = list_project_public_skus(session, project_id)
        if data is None:
            raise HTTPException(status_code=404, detail="Project not found")
        return data

    return app


app = create_app()
