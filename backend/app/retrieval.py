"""Tìm kiếm tài liệu thông minh: ưu tiên RPC search_sections, fallback RLS tiếng Việt."""

import re
import unicodedata
from typing import Any

from app.clients.supabase import SupabaseClient, SupabaseError

_STOPWORDS_FOLDED = {
    "a", "ai", "ạ", "an", "anh", "ba", "ban", "bao", "bay", "bi", "biet", "bo",
    "cac", "cai", "can", "cau", "chi", "cho", "chu", "chua", "co", "con", "cua",
    "cung", "da", "dang", "dau", "de", "den", "di", "do", "duoc", "em", "g", "gi",
    "giup", "hay", "het", "hien", "hieu", "ho", "hoac", "hoi", "it", "ke", "khi",
    "khong", "la", "lai", "lam", "len", "lieu", "luc", "ma", "may", "minh", "moi",
    "mot", "muon", "nao", "nay", "neu", "ngay", "nguoi", "nha", "nhe", "nhieu",
    "nhu", "nhung", "noi", "no", "o", "oi", "phai", "qua", "ra", "rat", "roi",
    "sao", "se", "so", "su", "ta", "tai", "tam", "tat", "ten", "thay", "the",
    "theo", "thi", "thich", "thong", "thoi", "thu", "tin", "to", "toi", "tren",
    "trong", "trung", "tu", "tuy", "va", "vao", "vay", "ve", "vi", "viec", "voi",
    "vua", "xem", "xin", "xuong",
}

_SUMMARY_HINTS = ("tom tat", "tong quan", "noi dung", "gioi thieu", "muc luc", "chuong")


def fold_vi(text: str) -> str:
    lowered = text.lower().replace("đ", "d")
    nfd = unicodedata.normalize("NFD", lowered)
    return "".join(ch for ch in nfd if unicodedata.category(ch) != "Mn")


def extract_query_terms(query: str) -> list[tuple[str, str]]:
    raw_words = re.findall(r"[\wÀ-ỹ]+", query.lower())
    terms: list[tuple[str, str]] = []
    seen: set[str] = set()
    for word in raw_words:
        folded = fold_vi(word)
        if not folded or folded in seen:
            continue
        if len(folded) == 1 and not folded.isdigit():
            continue
        if folded in _STOPWORDS_FOLDED:
            continue
        seen.add(folded)
        terms.append((word, folded))

    if not terms:
        for word in raw_words:
            folded = fold_vi(word)
            if folded and folded not in seen:
                seen.add(folded)
                terms.append((word, folded))
    return terms


def score_sections(
    query: str,
    sections: list[dict[str, Any]],
    *,
    limit: int = 6,
    expand_neighbors: bool = True,
) -> list[dict[str, Any]]:
    if not sections:
        return []

    terms = extract_query_terms(query)
    folded_query = " ".join(re.findall(r"[a-z0-9]+", fold_vi(query)))
    max_possible = max(1.0, len(terms) * 2.0 + (4.0 if len(terms) >= 2 else 0.0))

    by_doc: dict[str, list[dict[str, Any]]] = {}
    for sec in sections:
        doc_id = str(sec.get("document_id", ""))
        by_doc.setdefault(doc_id, []).append(sec)
    for doc_secs in by_doc.values():
        doc_secs.sort(key=lambda s: int(s.get("section_index") or 0))

    scored: list[tuple[float, dict[str, Any]]] = []
    for sec in sections:
        content = str(sec.get("content") or "")
        if not content.strip():
            continue
        doc_obj = sec.get("documents") or {}
        doc_title = str(sec.get("document_title") or doc_obj.get("title") or "")
        c_lower = f"{doc_title.lower()}\n{content.lower()}"
        c_folded = fold_vi(c_lower)

        score = 0.0
        matched = 0
        for raw_tok, folded_tok in terms:
            if re.search(rf"(?<!\w){re.escape(raw_tok)}(?!\w)", c_lower):
                score += 2.0
                matched += 1
            elif re.search(rf"(?<!\w){re.escape(folded_tok)}(?!\w)", c_folded):
                score += 1.2
                matched += 1
            elif len(folded_tok) >= 4 and folded_tok in c_folded:
                score += 0.8
                matched += 1

        if len(terms) >= 2 and folded_query and folded_query in " ".join(re.findall(r"[a-z0-9]+", c_folded)):
            score += 4.0

        if matched > 0:
            if len(content.strip()) >= 80:
                score += 0.35
            scored.append((score, sec))

    if not scored and any(h in fold_vi(query) for h in _SUMMARY_HINTS):
        # Khi người dùng hỏi tóm tắt chung chung mà không trúng từ khóa cụ thể
        fallback_items = sections[:limit]
        return [_format_section(s, 0.5, by_doc if expand_neighbors else None) for s in fallback_items]

    scored.sort(key=lambda item: item[0], reverse=True)
    top = scored[:limit]
    return [
        _format_section(sec, min(1.0, round(sc / max_possible, 4)), by_doc if expand_neighbors else None)
        for sc, sec in top
    ]


def _format_section(
    sec: dict[str, Any],
    rank: float,
    by_doc: dict[str, list[dict[str, Any]]] | None,
) -> dict[str, Any]:
    content = str(sec.get("content") or "")
    doc_id = str(sec.get("document_id", ""))
    doc_obj = sec.get("documents") or {}
    doc_title = str(sec.get("document_title") or doc_obj.get("title") or "")

    # Nếu đoạn khớp quá ngắn (thường là tiêu đề chương/mục), ghép thêm 1-2 đoạn kế tiếp
    if by_doc and len(content.strip()) < 260:
        siblings = by_doc.get(doc_id, [])
        cur_idx = int(sec.get("section_index") or 0)
        extra_parts = [content.strip()]
        for sib in siblings:
            sib_idx = int(sib.get("section_index") or 0)
            if cur_idx < sib_idx <= cur_idx + 2:
                sib_text = str(sib.get("content") or "").strip()
                if sib_text:
                    extra_parts.append(sib_text)
        content = "\n\n".join(extra_parts)

    return {
        "id": sec.get("id"),
        "document_id": doc_id,
        "content": content,
        "page_from": sec.get("page_from"),
        "page_to": sec.get("page_to"),
        "document_title": doc_title,
        "rank": rank,
    }


async def search_accessible_sections(
    supabase: SupabaseClient,
    *,
    access_token: str,
    query: str,
    limit: int = 6,
    expand_neighbors: bool = True,
) -> list[dict[str, Any]]:
    rpc_chunks: list[dict[str, Any]] = []
    try:
        raw = await supabase.rpc(
            "search_sections",
            {"p_query": query, "p_limit": limit},
            access_token=access_token,
        )
        if isinstance(raw, list):
            rpc_chunks = raw
    except SupabaseError:
        rpc_chunks = []

    has_rich_rpc = bool(rpc_chunks) and any(
        len(str(c.get("content") or "").strip()) >= 220 for c in rpc_chunks
    )
    if has_rich_rpc:
        return rpc_chunks[:limit]

    # Fallback truy vấn theo RLS của chính user (chỉ lấy decision='lesson' và status='published')
    rows, _ = await supabase.rest(
        "GET",
        "document_sections",
        access_token=access_token,
        params={
            "select": "id,document_id,section_index,content,page_from,page_to,documents!inner(title,status)",
            "decision": "eq.lesson",
            "documents.status": "eq.published",
            "order": "section_index.asc",
            "limit": "500",
        },
    )
    sec_list = rows if isinstance(rows, list) else []
    fallback_chunks = score_sections(
        query,
        sec_list,
        limit=limit,
        expand_neighbors=expand_neighbors,
    )

    if fallback_chunks:
        return fallback_chunks
    return rpc_chunks[:limit]
