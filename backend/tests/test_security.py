import pytest

from app.retrieval import score_sections
from app.routers.assignments import parse_grade_json
from app.routers.documents import detect_section_kind, extract_sections, sanitize_filename
from app.security import decrypt_sealed, encrypt_sealed

TEST_KEY = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"


def test_sealed_roundtrip():
    token = encrypt_sealed("6.96 s", key_hex=TEST_KEY)
    parts = token.split(".")
    assert len(parts) == 3
    assert len(parts[0]) == 24
    assert len(parts[1]) == 32
    assert decrypt_sealed(token, key_hex=TEST_KEY) == "6.96 s"


def test_sealed_rejects_bad_payload_or_tamper():
    token = encrypt_sealed("A", key_hex=TEST_KEY)
    iv_hex, tag_hex, enc_hex = token.split(".")
    tampered = f"{iv_hex}.{tag_hex}.{'00' * (len(enc_hex) // 2)}"
    with pytest.raises(ValueError):
        decrypt_sealed(tampered, key_hex=TEST_KEY)
    with pytest.raises(ValueError):
        decrypt_sealed("bad.payload", key_hex=TEST_KEY)
    with pytest.raises(ValueError):
        encrypt_sealed("A", key_hex="short")


def test_parse_grade_json_clamps_and_handles_invalid():
    assert parse_grade_json('{"correct": true, "score": 15, "feedback": "Tốt"}', 10) == {
        "score": 10.0,
        "correct": True,
        "feedback": "Tốt",
    }
    assert parse_grade_json('{"score": -3, "feedback": "Sai"}', 10) == {
        "score": 0.0,
        "correct": False,
        "feedback": "Sai",
    }
    fallback = parse_grade_json("not json", 10)
    assert fallback["score"] == 0.0
    assert fallback["correct"] is False


def test_document_helpers():
    assert sanitize_filename("Bài giảng Vật lý (1).pdf") == "Bai-giang-Vat-ly-1-.pdf"
    assert detect_section_kind("Đáp án: Câu 1 chọn A") == "suspected_answer"
    assert detect_section_kind("Định luật II Newton phát biểu rằng F = m*a.") == "lesson"

    sections = extract_sections(
        "notes.txt",
        "Đoạn một đủ dài để tách thành mục thứ nhất.\n\nĐáp án: Câu 1 là 9.81 m/s2.".encode(),
    )
    assert len(sections) == 2


def test_retrieval_natural_vi_and_neighbor_expansion():
    sections = [
        {
            "id": "s4",
            "document_id": "d1",
            "section_index": 4,
            "content": "## CHƯƠNG 1: ĐỘNG HỌC CHẤT ĐIỂM",
            "page_from": None,
            "page_to": None,
            "documents": {"title": "phy"},
        },
        {
            "id": "s5",
            "document_id": "d1",
            "section_index": 5,
            "content": "Vận tốc tức thời là đạo hàm của vectơ vị trí theo thời gian.",
            "page_from": None,
            "page_to": None,
            "documents": {"title": "phy"},
        },
    ]
    hits = score_sections("Chương 1 động học chất điểm nói về gì?", sections, limit=4)
    assert len(hits) >= 1
    assert hits[0]["id"] == "s4"
    assert "Vận tốc tức thời" in hits[0]["content"]

    accent_hits = score_sections("van toc tuc thoi", sections, limit=4)
    assert accent_hits[0]["id"] == "s5"
