"""Cấu hình ứng dụng FastAPI, tự động nạp biến môi trường từ .env gốc hoặc backend/.env."""

from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

_ROOT_ENV = Path(__file__).resolve().parents[2] / ".env"
_BACKEND_ENV = Path(__file__).resolve().parents[1] / ".env"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=[str(_ROOT_ENV), str(_BACKEND_ENV)],
        env_file_encoding="utf-8",
        extra="ignore",
    )

    next_public_supabase_url: str = ""
    next_public_supabase_anon_key: str = ""
    supabase_service_role_key: str = ""
    groq_api_key: str = ""
    groq_model: str = "llama-3.3-70b-versatile"
    sealed_key: str = ""
    next_public_app_url: str = "http://localhost:3000"
    cors_origins: str = ""

    @property
    def allowed_origins(self) -> list[str]:
        origins = [
            "http://localhost:3000",
            "http://127.0.0.1:3000",
        ]
        if self.next_public_app_url:
            origins.append(self.next_public_app_url.rstrip("/"))
        if self.cors_origins:
            origins.extend(
                o.strip().rstrip("/") for o in self.cors_origins.split(",") if o.strip()
            )
        return list(dict.fromkeys(origins))


@lru_cache
def get_settings() -> Settings:
    return Settings()
