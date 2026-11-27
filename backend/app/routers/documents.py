"""Endpoint tải lên và phân tách mục tài liệu (.txt, .md, .pdf, .docx, .pptx) phía backend."""

import io
import re
import time
import unicodedata
from typing import Annotated, Any

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile

from app.clients.supabase import SupabaseClient, SupabaseError
from app.deps import AuthContext, get_supabase, require_staff

router = APIRouter(prefix="/api/lecturer", tags=["documents"])

_ANSWER_HINT_RE = re.compile(
    r"(?:đáp án|lời giải|hướng dẫn giải|answer key|solution)\s*[:\-]?",
    re.IGNORECASE,
)


def sanitize_filename(name: str) -> str:
    norm = unicodedata.normalize("NFD", name)
    ascii_only = "".join(ch for ch in norm if unicodedata.category(ch) != "Mn")
    cleaned = re.sub(r"[^a-zA-Z0-9._-]+", "-", ascii_only).strip("-")
    return cleaned or "document"


def detect_section_kind(content: str) -> str:
    return "suspected_answer" if _ANSWER_HINT_RE.search(content) else "lesson"


def _split_text_sections(
    text: str, page_from: int | None = None, page_to: int | None = None
) -> list[dict[str, Any]]:
    cleaned = text.strip()
    if not cleaned:
        return []
    raw_parts = [p.strip() for p in re.split(r"\n\s*\n", cleaned) if p.strip()]
    if not raw_parts:
        return []

    # Gom các đoạn bài học ngắn thành chunk ~600-1000 ký tự, tách riêng đoạn nghi đáp án
    merged: list[str] = []
    buf: list[str] = []
    buf_len = 0
    buf_kind = "lesson"
    for part in raw_parts:
        is_heading = part.startswith("#")
        part_kind = detect_section_kind(part)
        kind_changed = bool(buf) and part_kind != buf_kind
        if buf and (kind_changed or (is_heading and buf_len >= 250) or buf_len + len(part) > 1000):
            merged.append("\n\n".join(buf)[:8000])
            buf = []
            buf_len = 0
        if not buf:
            buf_kind = part_kind
        buf.append(part)
        buf_len += len(part)
    if buf:
        merged.append("\n\n".join(buf)[:8000])

    return [
        {
            "content": chunk,
            "page_from": page_from,
            "page_to": page_to,
        }
        for chunk in merged
        if len(chunk) > 10 or len(merged) == 1
    ]


def extract_sections(filename: str, raw_bytes: bytes) -> list[dict[str, Any]]:
    lower = filename.lower()
    sections: list[dict[str, Any]] = []

    if lower.endswith((".txt", ".md")):
        text = raw_bytes.decode("utf-8", errors="replace")
        sections = _split_text_sections(text)

    elif lower.endswith(".pdf"):
        import fitz

        with fitz.open(stream=raw_bytes, filetype="pdf") as pdf:
            for idx, page in enumerate(pdf, start=1):
                page_text = page.get_text("text") or ""
                sections.extend(_split_text_sections(page_text, page_from=idx, page_to=idx))

    elif lower.endswith(".docx"):
        import docx

        document = docx.Document(io.BytesIO(raw_bytes))
        paragraphs = [
            p.text.strip() for p in document.paragraphs if p.text and len(p.text.strip()) > 10
        ]
        if paragraphs:
            buf: list[str] = []
            for p in paragraphs:
                buf.append(p)
                if sum(len(x) for x in buf) >= 700:
                    sections.append(
                        {"content": "\n\n".join(buf)[:8000], "page_from": None, "page_to": None}
                    )
                    buf = []
            if buf:
                sections.append(
                    {"content": "\n\n".join(buf)[:8000], "page_from": None, "page_to": None}
                )

    elif lower.endswith(".pptx"):
        import pptx

        prs = pptx.Presentation(io.BytesIO(raw_bytes))
        for idx, slide in enumerate(prs.slides, start=1):
            texts: list[str] = []
            for shape in slide.shapes:
                if getattr(shape, "has_text_frame", False) and shape.text_frame:
                    txt = shape.text_frame.text.strip()
                    if txt:
                        texts.append(txt)
            joined = "\n".join(texts).strip()
            if joined:
                sections.append({"content": joined[:8000], "page_from": idx, "page_to": idx})

    return sections[:50]


@router.post("/documents", status_code=201)
async def upload_document(
    title: Annotated[str, Form(...)],
    file: Annotated[UploadFile, File(...)],
    auth: Annotated[AuthContext, Depends(require_staff)],
    supabase: Annotated[SupabaseClient, Depends(get_supabase)],
    visibility: Annotated[str, Form()] = "course",
    courseId: Annotated[str, Form()] = "",
):
    clean_title = title.strip()
    clean_course_id = courseId.strip() or None
    if visibility not in ("course", "center"):
        raise HTTPException(status_code=400, detail="Phạm vi hiển thị không hợp lệ.")
    if not clean_title or (visibility == "course" and not clean_course_id):
        raise HTTPException(
            status_code=400,
            detail="Điền đủ tiêu đề và chọn môn học (nếu phạm vi môn).",
        )
    if not file.filename:
        raise HTTPException(status_code=400, detail="Thiếu tệp tài liệu.")

    raw_bytes = await file.read()
    if not raw_bytes:
        raise HTTPException(status_code=400, detail="Tệp tải lên đang rỗng.")

    safe_name = sanitize_filename(file.filename)
    storage_path = f"docs/{auth.user_id}/{int(time.time() * 1000)}-{safe_name}"
    content_type = file.content_type or "application/octet-stream"

    # FastAPI đã xác thực staff qua require_staff; dùng service role cho Storage
    # và tự động tạo bucket 'documents' (private) nếu chưa có trên Supabase.
    try:
        await supabase.storage_upload(
            "documents",
            storage_path,
            raw_bytes,
            content_type,
            use_admin=True,
        )
    except SupabaseError as exc:
        if "bucket" in exc.message.lower() and "not found" in exc.message.lower():
            await supabase.ensure_bucket("documents", public=False)
            await supabase.storage_upload(
                "documents",
                storage_path,
                raw_bytes,
                content_type,
                use_admin=True,
            )
        else:
            raise

    doc_rows, _ = await supabase.rest(
        "POST",
        "documents",
        access_token=auth.access_token,
        json_body={
            "title": clean_title,
            "course_id": clean_course_id,
            "uploaded_by": auth.user_id,
            "visibility": visibility,
            "storage_path": storage_path,
        },
        prefer="return=representation",
    )
    if not isinstance(doc_rows, list) or not doc_rows:
        await supabase.storage_delete("documents", [storage_path], use_admin=True)
        raise HTTPException(status_code=500, detail="Không tạo được bản ghi tài liệu.")
    doc = doc_rows[0]

    extracted: list[dict[str, Any]] = []
    parse_warning: str | None = None
    try:
        extracted = extract_sections(file.filename, raw_bytes)
    except (ValueError, OSError, RuntimeError, UnicodeError) as exc:
        parse_warning = f"Đã lưu tệp nhưng không trích xuất được nội dung tự động: {exc}"

    if extracted:
        payload = [
            {
                "document_id": doc["id"],
                "section_index": i,
                "content": sec["content"],
                "page_from": sec["page_from"],
                "page_to": sec["page_to"],
                "detection": detect_section_kind(sec["content"]),
                "decision": None,
            }
            for i, sec in enumerate(extracted)
        ]
        try:
            await supabase.rest(
                "POST",
                "document_sections",
                access_token=auth.access_token,
                json_body=payload,
            )
        except Exception:
            await supabase.rest(
                "DELETE",
                "documents",
                access_token=auth.access_token,
                params={"id": f"eq.{doc['id']}"},
            )
            await supabase.storage_delete(
                "documents", [storage_path], use_admin=True
            )
            raise

    return {
        "document": doc,
        "sectionsCount": len(extracted),
        "warning": parse_warning,
    }
