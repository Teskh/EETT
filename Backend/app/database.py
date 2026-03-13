from __future__ import annotations

from contextlib import contextmanager
from typing import Iterator

from sqlalchemy import create_engine, inspect
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker


class Base(DeclarativeBase):
    pass


def create_engine_for_url(
    database_url: str,
    *,
    connect_timeout_seconds: int | None = None,
    statement_timeout_ms: int | None = None,
):
    engine_kwargs: dict[str, object] = {
        "future": True,
        "pool_pre_ping": True,
    }
    if database_url.startswith(("postgresql://", "postgresql+")):
        connect_args: dict[str, object] = {}
        if connect_timeout_seconds is not None and connect_timeout_seconds > 0:
            connect_args["connect_timeout"] = int(connect_timeout_seconds)
        if statement_timeout_ms is not None and statement_timeout_ms > 0:
            connect_args["options"] = f"-c statement_timeout={int(statement_timeout_ms)}"
        if connect_args:
            engine_kwargs["connect_args"] = connect_args
    return create_engine(database_url, **engine_kwargs)


def create_session_factory(
    database_url: str,
    *,
    connect_timeout_seconds: int | None = None,
    statement_timeout_ms: int | None = None,
) -> sessionmaker[Session]:
    engine = create_engine_for_url(
        database_url,
        connect_timeout_seconds=connect_timeout_seconds,
        statement_timeout_ms=statement_timeout_ms,
    )
    return sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)


def schema_is_ready(engine) -> bool:
    inspector = inspect(engine)
    return inspector.has_table("catalog_categories")


@contextmanager
def session_scope(session_factory: sessionmaker[Session]) -> Iterator[Session]:
    session = session_factory()
    try:
        yield session
        session.commit()
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()
