from __future__ import annotations

from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import Depends, FastAPI, Form, HTTPException, Request
from fastapi.responses import HTMLResponse, JSONResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles
from sqlalchemy.orm import Session, sessionmaker

from app.config import Settings
from app.database import create_engine_for_url, schema_is_ready, session_scope
from app.seed import seed_demo_data_if_empty
from app.services.catalog import create_category, create_component, get_catalog_page_data, update_category_links
from app.services.projects import create_project, get_project_view_data, get_projects_page_data
from app.ui import render_catalog_page, render_home_page, render_project_detail_page, render_projects_page


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
    app.state.settings = settings
    app.state.engine = engine
    app.state.session_factory = session_factory

    static_dir = Path(__file__).resolve().parent / "static"
    app.mount("/static", StaticFiles(directory=static_dir), name="static")

    def get_session(request: Request):
        with session_scope(request.app.state.session_factory) as session:
            yield session

    @app.get("/", response_class=HTMLResponse)
    async def home() -> str:
        return render_home_page()

    @app.get("/catalog", response_class=HTMLResponse)
    async def catalog(category_id: int | None = None, session: Session = Depends(get_session)) -> str:
        data = get_catalog_page_data(session, selected_category_id=category_id)
        selected = data["selected"]
        active_id = selected["id"] if selected else category_id
        return render_catalog_page(data, active_id)

    @app.post("/catalog/categories")
    async def create_catalog_category(
        name: str = Form(...),
        description: str | None = Form(default=None),
        scope: str = Form("item"),
        parent_id: int | None = Form(default=None),
        session: Session = Depends(get_session),
    ):
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
        unit_type: str | None = Form(default=None),
        session: Session = Depends(get_session),
    ):
        create_component(
            session,
            category_id=category_id,
            component_type=component_type,
            name=name,
            short_name=short_name,
            description=description,
            unit_type=unit_type,
        )
        return RedirectResponse(url=f"/catalog?category_id={category_id}", status_code=303)

    @app.post("/catalog/categories/{category_id}/links")
    async def save_catalog_links(
        category_id: int,
        request: Request,
        session: Session = Depends(get_session),
    ):
        form = await request.form()
        linked_ids = [int(value) for value in form.getlist("linked_category_ids")]
        update_category_links(session, category_id=category_id, linked_category_ids=linked_ids)
        return RedirectResponse(url=f"/catalog?category_id={category_id}", status_code=303)

    @app.get("/projects", response_class=HTMLResponse)
    async def projects(session: Session = Depends(get_session)) -> str:
        data = get_projects_page_data(session)
        return render_projects_page(data)

    @app.post("/projects")
    async def create_project_route(
        name: str = Form(...),
        description: str | None = Form(default=None),
        status: str = Form("template"),
        session: Session = Depends(get_session),
    ):
        project = create_project(session, name=name, description=description, status=status)
        return RedirectResponse(url=f"/projects/{project.id}", status_code=303)

    @app.get("/projects/{project_id}", response_class=HTMLResponse)
    async def project_detail(project_id: int, session: Session = Depends(get_session)) -> str:
        data = get_project_view_data(session, project_id)
        if data is None:
            raise HTTPException(status_code=404, detail="Project not found")
        return render_project_detail_page(data)

    @app.get("/api/catalog")
    async def catalog_api(category_id: int | None = None, session: Session = Depends(get_session)):
        return JSONResponse(get_catalog_page_data(session, selected_category_id=category_id))

    @app.get("/api/projects")
    async def projects_api(session: Session = Depends(get_session)):
        return JSONResponse(get_projects_page_data(session))

    @app.get("/api/projects/{project_id}")
    async def project_detail_api(project_id: int, session: Session = Depends(get_session)):
        data = get_project_view_data(session, project_id)
        if data is None:
            raise HTTPException(status_code=404, detail="Project not found")
        return JSONResponse(data)

    return app


app = create_app()
