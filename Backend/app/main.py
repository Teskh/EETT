from __future__ import annotations

import json
import logging
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Annotated, Any

from fastapi import Body, Depends, FastAPI, Form, Header, HTTPException, Request, Response
from fastapi.exceptions import RequestValidationError
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles
from sqlalchemy.orm import Session, sessionmaker
from starlette.middleware.sessions import SessionMiddleware

from app.api_models import (
    ActivityGroupModel,
    ApprovalModel,
    AttributeValueInputModel,
    CatalogCategoryCreateRequest,
    CatalogComponentMutationResultModel,
    CatalogCategoryLinksUpdateRequest,
    CatalogComponentAttributesReplaceRequest,
    CatalogComponentCreateRequest,
    CatalogComponentMaterialsReplaceRequest,
    CatalogComponentUpdateRequest,
    CatalogMaterialSearchResponse,
    CatalogResponse,
    CommentModel,
    DashboardResponse,
    ExportJobModel,
    LoginRequest,
    MaterialDashboardCecoResponse,
    MaterialDashboardDetailResponse,
    MaterialDashboardMovementResponse,
    MaterialDashboardResponse,
    MaterialOccurrenceUpdateRequest,
    MaterialModeResponse,
    ManagedUserModel,
    MutationResultModel,
    NotificationModel,
    ProjectDetailResponse,
    ProjectCreateRequest,
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
    SessionUserResponse,
    SyncPreviewResponse,
    UserCreateRequest,
    UserDirectoryResponse,
    UserUpdateRequest,
)
from app.config import Settings
from app.database import create_engine_for_url, schema_is_ready, session_scope
from app.seed import seed_demo_data_if_empty
from app.services.audit import normalize_mutation_batch_id
from app.services.auth import (
    authenticate_user,
    get_current_user,
    resolve_current_user,
    require_project_create,
    require_catalog_edit,
    require_material_dashboard_access,
    require_erp_admin,
    require_project_edit,
    require_project_view,
    require_user_admin,
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
    update_attribute_definition,
    update_component,
)
from app.services.collaboration import (
    add_project_comment,
    decide_project_approval,
    get_activity_history,
    get_comment_payload,
    get_project_activity,
    get_project_approvals,
    get_project_comments,
    get_user_notifications,
    request_project_approval,
)
from app.services.dashboard import (
    get_material_dashboard_cost_centers,
    get_material_dashboard_detail,
    get_material_dashboard_history,
    get_project_material_dashboard,
    get_recent_material_dashboard,
)
from app.services.erp import erp_search_available, search_erp_material_candidates
from app.services.exports import get_project_export_jobs, request_project_export
from app.services.projects import (
    create_project,
    create_project_instance,
    create_project_instance_occurrence,
    create_project_subtype,
    delete_project_instance_occurrence,
    delete_project_subtype,
    delete_project_instance,
    get_project_instance_data,
    get_project_occurrence_data,
    get_instance_sync_preview,
    get_project_view_data,
    get_project_with_details,
    get_projects_page_data,
    refresh_instance_snapshot,
    replace_project_material_occurrence,
    set_project_material_mode,
    update_project_instance_occurrence,
    update_project_subtype,
    update_project_instance,
)
from app.services.public_api import list_project_public_skus, list_public_projects
from app.services.user_admin import create_user, delete_user, list_users, serialize_role_catalog, serialize_user, update_user
from app.ui import render_catalog_page, render_home_page, render_project_detail_page, render_projects_page

logger = logging.getLogger(__name__)


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or Settings()
    engine = create_engine_for_url(settings.database_url)
    session_factory = sessionmaker(
        bind=engine,
        autoflush=False,
        expire_on_commit=False,
    )

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        if settings.require_schema and not schema_is_ready(engine):
            raise RuntimeError(
                "Database schema is missing. Run `alembic upgrade head` against the configured PostgreSQL database before starting the app."
            )
        if settings.seed_demo_data:
            seed_demo_data_if_empty(session_factory)
        yield

    app = FastAPI(title=settings.app_name, lifespan=lifespan)

    @app.exception_handler(RequestValidationError)
    async def request_validation_exception_handler(request: Request, exc: RequestValidationError):
        logger.error(
            "Request validation failed for %s %s: %s",
            request.method,
            request.url.path,
            exc.errors(),
        )
        return JSONResponse(status_code=422, content={"detail": exc.errors()})
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
        require_catalog_edit(current_user)
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
        description: str | None = Form(default=None),
        status: str = Form("template"),
        session: Session = Depends(get_session),
        current_user=Depends(get_actor_user),
    ):
        require_project_create(current_user)
        project = create_project(session, name=name, description=description, status=status, actor_user=current_user)
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
        return {
            "users": [serialize_user(user) for user in list_users(session)],
            "roles": serialize_role_catalog(),
        }

    @app.post("/api/v1/users", response_model=ManagedUserModel)
    async def create_user_api(
        payload: UserCreateRequest,
        session: Session = Depends(get_session),
        current_user=Depends(get_actor_user),
    ):
        require_user_admin(current_user)
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
        try:
            deleted = delete_user(session, user_id=user_id)
        except ValueError as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc
        if not deleted:
            raise HTTPException(status_code=404, detail="User not found")
        return {"ok": True, "deleted_id": user_id}

    @app.get("/api/v1/catalog", response_model=CatalogResponse)
    async def catalog_v1(category_id: int | None = None, session: Session = Depends(get_session), current_user=Depends(get_actor_user)):
        require_catalog_edit(current_user)
        return get_catalog_page_data(session, selected_category_id=category_id)

    @app.post("/api/v1/catalog/categories", response_model=MutationResultModel)
    async def create_catalog_category_v1(
        payload: CatalogCategoryCreateRequest,
        session: Session = Depends(get_session),
        current_user=Depends(get_actor_user),
    ):
        require_catalog_edit(current_user)
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
        require_catalog_edit(current_user)
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
        require_catalog_edit(current_user)
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

    @app.delete("/api/v1/catalog/components/{component_id}", response_model=MutationResultModel)
    async def delete_catalog_component_v1(
        component_id: int,
        session: Session = Depends(get_session),
        current_user=Depends(get_actor_user),
    ):
        require_catalog_edit(current_user)
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
        require_catalog_edit(current_user)
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
        require_catalog_edit(current_user)
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
        require_catalog_edit(current_user)
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
        require_catalog_edit(current_user)
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
        return get_projects_page_data(session, user=current_user)

    @app.post("/api/v1/projects", response_model=MutationResultModel)
    async def create_project_v1(
        payload: ProjectCreateRequest,
        session: Session = Depends(get_session),
        current_user=Depends(get_actor_user),
        mutation_batch_id: str | None = Depends(get_mutation_batch_id),
    ):
        require_project_create(current_user)
        project = create_project(
            session,
            name=payload.name,
            description=payload.description,
            status=payload.status,
            actor_user=current_user,
            mutation_batch_id=mutation_batch_id,
        )
        return {"ok": True, "project_id": project.id}

    @app.get("/api/v1/projects/{project_id}", response_model=ProjectDetailResponse)
    async def project_detail_v1(project_id: int, session: Session = Depends(get_session), current_user=Depends(get_actor_user)):
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

    @app.put("/api/v1/projects/{project_id}/instances/{instance_id}/materials/{rule_id}", response_model=MutationResultModel)
    async def update_project_material_occurrence_v1(
        project_id: int,
        instance_id: int,
        rule_id: int,
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
                rule_id=rule_id,
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
            logger.error(
                "Material update rejected for project=%s instance=%s rule=%s payload=%s reason=%s",
                project_id,
                instance_id,
                rule_id,
                payload.model_dump(),
                str(exc),
            )
            raise HTTPException(status_code=422, detail=str(exc)) from exc
        if not updated:
            raise HTTPException(status_code=404, detail="Project instance not found")
        return {"ok": True, "project_id": project.id, "instance_id": instance_id}

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

    @app.get("/api/v1/projects/{project_id}/comments", response_model=list[CommentModel])
    async def project_comments_api(project_id: int, session: Session = Depends(get_session), current_user=Depends(get_actor_user)):
        project = get_project_with_details(session, project_id)
        if project is None:
            raise HTTPException(status_code=404, detail="Project not found")
        require_project_view(current_user, project)
        return get_project_comments(session, project_id)

    @app.post("/api/v1/projects/{project_id}/comments", response_model=CommentModel)
    async def add_comment_api(
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
        instance = None
        if payload.get("instance_id"):
            instance = next((item for item in project.instances if item.id == payload["instance_id"]), None)
            if instance is None:
                raise HTTPException(status_code=404, detail="Project instance not found")
        parent_comment = None
        if payload.get("parent_comment_id"):
            parent_comment = next((item for item in project.comments if item.id == payload["parent_comment_id"]), None)
            if parent_comment is None:
                raise HTTPException(status_code=404, detail="Parent comment not found")
        comment = add_project_comment(
            session,
            project=project,
            author=current_user,
            body=payload["body"],
            instance=instance,
            parent_comment=parent_comment,
            mutation_batch_id=mutation_batch_id,
        )
        payload_out = get_comment_payload(session, comment.id)
        if payload_out is None:
            raise HTTPException(status_code=500, detail="Comment could not be loaded after creation")
        return payload_out

    @app.get("/api/v1/projects/{project_id}/activity", response_model=list[ActivityGroupModel])
    async def project_activity_api(project_id: int, session: Session = Depends(get_session), current_user=Depends(get_actor_user)):
        project = get_project_with_details(session, project_id)
        if project is None:
            raise HTTPException(status_code=404, detail="Project not found")
        require_project_view(current_user, project)
        return get_project_activity(session, project_id)

    @app.get("/api/v1/activity", response_model=list[ActivityGroupModel])
    async def activity_history_api(session: Session = Depends(get_session), current_user=Depends(get_actor_user)):
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
        project_id: int,
        session: Session = Depends(get_session),
        current_user=Depends(get_actor_user),
        payload: dict[str, Any] = Body(...),
    ):
        project = get_project_with_details(session, project_id)
        if project is None:
            raise HTTPException(status_code=404, detail="Project not found")
        require_project_view(current_user, project)
        request_project_export(
            session,
            project=project,
            requested_by=current_user,
            export_kind=payload["kind"],
            payload=payload.get("payload"),
        )
        return get_project_export_jobs(session, project_id)[0]

    @app.get("/api/v1/dashboard/projects/{project_id}/materials", response_model=DashboardResponse)
    async def dashboard_api(project_id: int, session: Session = Depends(get_session), current_user=Depends(get_actor_user)):
        require_erp_admin(current_user)
        data = get_project_material_dashboard(session, project_id)
        if data is None:
            raise HTTPException(status_code=404, detail="Project not found")
        return data

    @app.get("/api/v1/dashboard/materials", response_model=MaterialDashboardResponse)
    async def material_dashboard_v1(
        request: Request,
        current_user=Depends(get_actor_user),
    ):
        require_material_dashboard_access(current_user)
        ceco_filters = request.query_params.getlist("ceco")
        try:
            return get_recent_material_dashboard(request.app.state.settings, cost_centers=ceco_filters)
        except RuntimeError as exc:
            raise HTTPException(status_code=503, detail=str(exc)) from exc

    @app.get("/api/v1/dashboard/materials/cecos", response_model=MaterialDashboardCecoResponse)
    async def material_dashboard_cecos_v1(
        request: Request,
        current_user=Depends(get_actor_user),
    ):
        require_material_dashboard_access(current_user)
        try:
            return get_material_dashboard_cost_centers(request.app.state.settings)
        except RuntimeError as exc:
            raise HTTPException(status_code=503, detail=str(exc)) from exc

    @app.get("/api/v1/dashboard/materials/{sku}", response_model=MaterialDashboardDetailResponse)
    async def material_dashboard_detail_v1(
        sku: str,
        request: Request,
        current_user=Depends(get_actor_user),
    ):
        require_material_dashboard_access(current_user)
        ceco_filters = request.query_params.getlist("ceco")
        try:
            detail = get_material_dashboard_detail(request.app.state.settings, sku, cost_centers=ceco_filters)
        except RuntimeError as exc:
            raise HTTPException(status_code=503, detail=str(exc)) from exc
        if detail is None:
            raise HTTPException(status_code=404, detail="Material not found")
        return detail

    @app.get("/api/v1/dashboard/materials/{sku}/movements", response_model=MaterialDashboardMovementResponse)
    async def material_dashboard_movements_v1(
        sku: str,
        request: Request,
        current_user=Depends(get_actor_user),
    ):
        require_material_dashboard_access(current_user)
        ceco_filters = request.query_params.getlist("ceco")
        try:
            return get_material_dashboard_history(request.app.state.settings, sku, cost_centers=ceco_filters)
        except RuntimeError as exc:
            raise HTTPException(status_code=503, detail=str(exc)) from exc

    @app.get("/api/v1/notifications", response_model=list[NotificationModel])
    async def notifications_api(session: Session = Depends(get_session), current_user=Depends(get_actor_user)):
        return get_user_notifications(session, current_user)

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
