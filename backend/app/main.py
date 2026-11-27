"""Điểm khởi chạy FastAPI cho backend TrueScholar MVP."""

from contextlib import asynccontextmanager

import httpx
from fastapi import FastAPI, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.clients.groq import GroqError
from app.clients.supabase import SupabaseClient, SupabaseError
from app.config import get_settings
from app.routers import assignments, auth, chat, documents, student


@asynccontextmanager
async def lifespan(app: FastAPI):
    settings = get_settings()
    http_client = httpx.AsyncClient(timeout=30.0)
    app.state.http_client = http_client
    app.state.supabase = SupabaseClient(settings=settings, http_client=http_client)
    try:
        yield
    finally:
        await http_client.aclose()


def create_app() -> FastAPI:
    settings = get_settings()
    app = FastAPI(
        title="TrueScholar MVP API",
        version="0.1.0",
        lifespan=lifespan,
    )

    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.allowed_origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    @app.exception_handler(HTTPException)
    async def http_exception_handler(_: Request, exc: HTTPException):
        msg = exc.detail if isinstance(exc.detail, str) else "Lỗi yêu cầu."
        return JSONResponse(
            status_code=exc.status_code,
            content={"error": msg, "detail": exc.detail},
        )

    @app.exception_handler(RequestValidationError)
    async def validation_exception_handler(_: Request, exc: RequestValidationError):
        return JSONResponse(
            status_code=400,
            content={"error": "Dữ liệu đầu vào không hợp lệ.", "detail": exc.errors()},
        )

    @app.exception_handler(SupabaseError)
    async def supabase_error_handler(_: Request, exc: SupabaseError):
        return JSONResponse(
            status_code=exc.status_code,
            content={"error": exc.message, "detail": exc.message, "code": exc.code},
        )

    @app.exception_handler(GroqError)
    async def groq_error_handler(_: Request, exc: GroqError):
        return JSONResponse(
            status_code=exc.status_code,
            content={"error": exc.message, "detail": exc.message},
        )

    @app.get("/health")
    async def health():
        return {"status": "ok", "service": "truescholar-fastapi"}

    app.include_router(auth.router)
    app.include_router(chat.router)
    app.include_router(assignments.router)
    app.include_router(documents.router)
    app.include_router(student.router)

    return app


app = create_app()
