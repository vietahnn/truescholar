"""Endpoints tổng quan lớp học và tài liệu dành cho sinh viên."""

from typing import Annotated, Any

from fastapi import APIRouter, Depends, Query

from app.clients.supabase import SupabaseClient
from app.deps import AuthContext, get_current_auth, get_supabase
from app.retrieval import search_accessible_sections

router = APIRouter(prefix="/api/student", tags=["student"])


@router.get("/search")
async def search_knowledge(
    q: Annotated[str, Query(min_length=1, max_length=500)],
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    supabase: Annotated[SupabaseClient, Depends(get_supabase)],
    limit: Annotated[int, Query(ge=1, le=20)] = 10,
):
    results = await search_accessible_sections(
        supabase,
        access_token=auth.access_token,
        query=q.strip(),
        limit=limit,
        expand_neighbors=False,
    )
    return {"results": results}


@router.get("/overview")
async def get_student_overview(
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    supabase: Annotated[SupabaseClient, Depends(get_supabase)],
):
    enroll_rows, _ = await supabase.rest(
        "GET",
        "enrollments",
        access_token=auth.access_token,
        params={"select": "id,class_id", "user_id": f"eq.{auth.user_id}"},
    )
    enrollments = enroll_rows if isinstance(enroll_rows, list) else []
    class_ids = list(
        dict.fromkeys(str(e["class_id"]) for e in enrollments if e.get("class_id"))
    )

    classes_out: list[dict[str, Any]] = []
    course_ids: list[str] = []
    courses_by_id: dict[str, dict[str, Any]] = {}

    if class_ids:
        cls_filter = f"({','.join(class_ids)})"
        cls_rows, _ = await supabase.rest(
            "GET",
            "classes",
            use_admin=True,
            params={
                "select": "id,name,course_id",
                "id": f"in.{cls_filter}",
                "order": "name.asc",
            },
        )
        cls_list = cls_rows if isinstance(cls_rows, list) else []
        course_ids = list(
            dict.fromkeys(str(c["course_id"]) for c in cls_list if c.get("course_id"))
        )

        if course_ids:
            course_filter = f"({','.join(course_ids)})"
            course_rows, _ = await supabase.rest(
                "GET",
                "courses",
                use_admin=True,
                params={"select": "id,code,title", "id": f"in.{course_filter}"},
            )
            for cr in course_rows if isinstance(course_rows, list) else []:
                courses_by_id[str(cr["id"])] = cr

        for c in cls_list:
            cid = str(c.get("course_id", ""))
            classes_out.append(
                {
                    "id": c["id"],
                    "name": c["name"],
                    "course": courses_by_id.get(cid),
                }
            )

    doc_params: dict[str, str] = {
        "select": "id,title,visibility,course_id,created_at",
        "status": "eq.published",
        "order": "created_at.desc",
    }
    if course_ids:
        doc_params["or"] = f"(visibility.eq.center,course_id.in.({','.join(course_ids)}))"
    else:
        doc_params["visibility"] = "eq.center"

    doc_rows, _ = await supabase.rest(
        "GET",
        "documents",
        use_admin=True,
        params=doc_params,
    )
    docs_list = doc_rows if isinstance(doc_rows, list) else []

    missing_course_ids = list(
        dict.fromkeys(
            str(d["course_id"])
            for d in docs_list
            if d.get("course_id") and str(d["course_id"]) not in courses_by_id
        )
    )
    if missing_course_ids:
        extra_rows, _ = await supabase.rest(
            "GET",
            "courses",
            use_admin=True,
            params={
                "select": "id,code,title",
                "id": f"in.({','.join(missing_course_ids)})",
            },
        )
        for cr in extra_rows if isinstance(extra_rows, list) else []:
            courses_by_id[str(cr["id"])] = cr

    lesson_counts: dict[str, int] = {}
    if docs_list:
        doc_ids = [str(d["id"]) for d in docs_list]
        sec_rows, _ = await supabase.rest(
            "GET",
            "document_sections",
            use_admin=True,
            params={
                "select": "document_id",
                "decision": "eq.lesson",
                "document_id": f"in.({','.join(doc_ids)})",
            },
        )
        for sec in sec_rows if isinstance(sec_rows, list) else []:
            did = str(sec.get("document_id", ""))
            lesson_counts[did] = lesson_counts.get(did, 0) + 1

    documents_out = [
        {
            "id": d["id"],
            "title": d["title"],
            "visibility": d["visibility"],
            "course": courses_by_id.get(str(d.get("course_id", ""))),
            "lessonSections": lesson_counts.get(str(d["id"]), 0),
        }
        for d in docs_list
    ]

    return {
        "classes": classes_out,
        "documents": documents_out,
    }
