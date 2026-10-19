import os
from logging.config import fileConfig

from alembic import context
from dotenv import dotenv_values
from sqlalchemy import create_engine, pool

import app.db_models  # noqa: F401  (đăng ký mọi bảng vào Base.metadata)
from app.core.database import Base

config = context.config
if config.config_file_name is not None:
    fileConfig(config.config_file_name)

target_metadata = Base.metadata


def _url() -> str:
    # Biến môi trường thắng; nếu không có thì đọc backend/.env như ứng dụng (không cần SESSION_SECRET).
    url = os.environ.get("DATABASE_URL") or dotenv_values(".env").get("DATABASE_URL")
    if not url:
        raise RuntimeError("Thiếu DATABASE_URL (biến môi trường hoặc backend/.env)")
    return url


def run_migrations_offline() -> None:
    context.configure(url=_url(), target_metadata=target_metadata, literal_binds=True)
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    engine = create_engine(_url(), poolclass=pool.NullPool)
    with engine.connect() as connection:
        context.configure(connection=connection, target_metadata=target_metadata)
        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
