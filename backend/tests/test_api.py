from typing import Any

from fastapi.testclient import TestClient

from app.clients.supabase import SupabaseError
from app.deps import AuthContext, get_current_auth, get_supabase
from app.main import create_app
from app.routers import assignments as assignments_router
from app.routers import chat as chat_router
from app.security import encrypt_sealed

TEST_KEY = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"


class FakeSupabase:
    def __init__(self):
        self.calls: list[tuple[str, str, bool, Any]] = []
        self.rpc_result: Any = []
        self.rest_handler = None
        self.uploaded: list[tuple[str, str]] = []
        self.deleted_paths: list[str] = []
        self.ensured_buckets: list[tuple[str, bool]] = []
        self.missing_bucket_once = False

    async def get_user(self, access_token: str) -> dict[str, Any]:
        return {"id": "user-1", "email": "sv@example.com"}

    async def rpc(self, fn_name: str, payload: dict[str, Any], **kwargs) -> Any:
        self.calls.append(("RPC", fn_name, False, payload))
        return self.rpc_result

    async def rest(self, method: str, table: str, **kwargs) -> tuple[Any, int | None]:
        use_admin = bool(kwargs.get("use_admin", False))
        self.calls.append((method, table, use_admin, kwargs.get("json_body")))
        if self.rest_handler:
            return self.rest_handler(method, table, **kwargs)
        return [], 0

    async def ensure_bucket(self, bucket: str, *, public: bool = False) -> None:
        self.ensured_buckets.append((bucket, public))
        self.missing_bucket_once = False

    async def storage_upload(
        self, bucket: str, path: str, content: bytes, content_type: str, **kwargs
    ):
        if self.missing_bucket_once:
            raise SupabaseError(400, "Bucket not found")
        self.uploaded.append((bucket, path))
        return {"Key": path}

    async def storage_delete(self, bucket: str, paths: list[str], **kwargs):
        self.deleted_paths.extend(paths)


def _make_client(role: str, fake_sb: FakeSupabase) -> TestClient:
    app = create_app()
    auth = AuthContext(
        user={"id": "user-1", "email": f"{role}@example.com"},
        profile={"id": "user-1", "full_name": "Tester", "role": role},
        access_token="tok-123",
    )
    app.dependency_overrides[get_current_auth] = lambda: auth
    app.dependency_overrides[get_supabase] = lambda: fake_sb
    return TestClient(app)


def test_health_and_unauthenticated():
    app = create_app()
    client = TestClient(app)
    res = client.get("/health")
    assert res.status_code == 200
    assert res.json()["status"] == "ok"

    res_whoami = client.get("/api/whoami")
    assert res_whoami.status_code == 401
    assert res_whoami.json()["error"] == "unauthenticated"


def test_chat_grounded_and_citations(monkeypatch):
    fake_sb = FakeSupabase()
    fake_sb.rpc_result = [
        {"id": "sec-1", "document_title": "Vật lý 1", "page_from": 3, "content": "F = m * a"}
    ]

    def handler(method: str, table: str, **kwargs):
        if method == "GET" and table == "chat_sessions":
            return [{"id": "sess-1", "title": "Cuộc trò chuyện mới"}], None
        if method == "GET" and table == "chat_messages":
            return [
                {"role": "assistant", "content": "Trả lời mới"},
                {"role": "user", "content": "Hỏi trước"},
            ], None
        if method == "POST" and table == "chat_messages":
            return kwargs.get("json_body"), None
        if method == "PATCH" and table == "chat_sessions":
            return [{"id": "sess-1"}], None
        return [], None

    fake_sb.rest_handler = handler
    captured_msgs: list[dict[str, str]] = []

    async def fake_groq(messages, **kwargs):
        captured_msgs.extend(messages)
        return "Theo định luật II Newton, F = m*a [1]."

    monkeypatch.setattr(chat_router, "groq_chat", fake_groq)

    client = _make_client("student", fake_sb)
    res = client.post(
        "/api/chat", json={"sessionId": "sess-1", "question": "Định luật II Newton là gì?"}
    )
    assert res.status_code == 200
    data = res.json()
    assert "[1]" in data["answer"]
    assert data["citations"] == [
        {"index": 1, "sectionId": "sec-1", "documentTitle": "Vật lý 1", "page": 3}
    ]
    # Kiểm tra lịch sử đảo ngược đúng thứ tự user -> assistant trước câu hỏi mới
    assert [m["content"] for m in captured_msgs[1:3]] == ["Hỏi trước", "Trả lời mới"]
    # PostgREST yêu cầu mọi phần tử trong bulk insert có cùng tập key
    msg_insert = next(c for c in fake_sb.calls if c[0] == "POST" and c[1] == "chat_messages")
    assert set(msg_insert[3][0].keys()) == set(msg_insert[3][1].keys())


def test_assignment_questions_hides_encrypted():
    fake_sb = FakeSupabase()

    def handler(method: str, table: str, **kwargs):
        if method == "GET" and table == "assignments":
            return [{"id": "asg-1"}], None
        if method == "GET" and table == "questions":
            return [
                {
                    "id": "q-1",
                    "assignment_id": "asg-1",
                    "position": 1,
                    "prompt": "Chọn A",
                    "kind": "mcq",
                    "options": [{"key": "A", "label": "10"}],
                    "variant_params": {},
                    "max_score": 10,
                }
            ], None
        if method == "GET" and table == "answer_keys":
            assert kwargs.get("use_admin") is True
            assert "encrypted" not in kwargs["params"]["select"]
            return [
                {
                    "question_id": "q-1",
                    "hint_ladder": [
                        {"level": 1, "content": "Xem chương 1", "unlock_after": 1, "penalty": 0}
                    ],
                    "public_criteria": "Chính xác",
                }
            ], None
        return [], None

    fake_sb.rest_handler = handler
    client = _make_client("student", fake_sb)
    res = client.get("/api/assignments/questions?assignmentId=asg-1")
    assert res.status_code == 200
    qs = res.json()["questions"]
    assert len(qs) == 1
    assert "encrypted" not in qs[0]
    assert qs[0]["hint_ladder"][0]["content"] == "Xem chương 1"


def test_submit_mcq_with_sealed_key(monkeypatch):
    monkeypatch.setenv("SEALED_KEY", TEST_KEY)
    from app.config import get_settings

    get_settings.cache_clear()
    encrypted = encrypt_sealed("A", key_hex=TEST_KEY)
    fake_sb = FakeSupabase()

    def handler(method: str, table: str, **kwargs):
        if method == "GET" and table == "questions":
            return [
                {
                    "id": "q-1",
                    "prompt": "Test?",
                    "kind": "mcq",
                    "max_score": 10,
                    "assignment_id": "asg-1",
                }
            ], None
        if method == "GET" and table == "assignments":
            return [{"max_attempts": 3}], None
        if method == "GET" and table == "attempts":
            return None, 0
        if method == "GET" and table == "answer_keys":
            assert kwargs.get("use_admin") is True
            return [{"encrypted": encrypted, "public_criteria": ""}], None
        if method == "POST" and table == "attempts":
            return [{"id": "att-1"}], None
        return [], None

    fake_sb.rest_handler = handler
    client = _make_client("student", fake_sb)
    res = client.post("/api/submit", json={"questionId": "q-1", "answer": "a"})
    assert res.status_code == 200
    assert res.json() == {
        "attemptId": "att-1",
        "score": 10.0,
        "correct": True,
        "feedback": "Đáp án chính xác.",
    }


def test_lecturer_only_endpoints_reject_student():
    fake_sb = FakeSupabase()
    student_client = _make_client("student", fake_sb)

    res_q = student_client.post(
        "/api/lecturer/questions",
        json={"assignmentId": "a1", "prompt": "P", "kind": "numeric", "answerKey": "5"},
    )
    assert res_q.status_code == 403

    res_d = student_client.post(
        "/api/lecturer/documents",
        data={"title": "Doc", "visibility": "center"},
        files={"file": ("doc.txt", b"Hello world content here", "text/plain")},
    )
    assert res_d.status_code == 403


def test_lecturer_create_question_and_rollback(monkeypatch):
    monkeypatch.setenv("SEALED_KEY", TEST_KEY)
    from app.config import get_settings

    get_settings.cache_clear()
    fake_sb = FakeSupabase()

    def handler(method: str, table: str, **kwargs):
        if method == "GET" and table == "assignments":
            return [{"id": "asg-1"}], None
        if method == "GET" and table == "questions":
            return [{"position": 2}], None
        if method == "POST" and table == "questions":
            return [
                {
                    "id": "q-new",
                    "assignment_id": "asg-1",
                    "position": 3,
                    "prompt": "F?",
                    "kind": "numeric",
                    "options": [],
                    "max_score": 10,
                }
            ], None
        if method == "POST" and table == "answer_keys":
            raise RuntimeError("DB failure")
        return [], None

    fake_sb.rest_handler = handler
    client = _make_client("lecturer", fake_sb)
    try:
        client.post(
            "/api/lecturer/questions",
            json={"assignmentId": "asg-1", "prompt": "F?", "kind": "numeric", "answerKey": "9.8"},
        )
    except RuntimeError:
        pass
    assert any(c[0] == "DELETE" and c[1] == "questions" for c in fake_sb.calls)


def test_lecturer_upload_document():
    fake_sb = FakeSupabase()

    def handler(method: str, table: str, **kwargs):
        if method == "POST" and table == "documents":
            return [{"id": "doc-1", "title": "Bài 1"}], None
        if method == "POST" and table == "document_sections":
            return kwargs.get("json_body"), None
        return [], None

    fake_sb.rest_handler = handler
    client = _make_client("lecturer", fake_sb)
    res = client.post(
        "/api/lecturer/documents",
        data={"title": "Bài 1", "visibility": "center"},
        files={"file": ("chuong1.txt", "Lý thuyết Newton.\n\nĐáp án: 10 m/s.".encode(), "text/plain")},
    )
    assert res.status_code == 201
    assert res.json()["sectionsCount"] == 2
    assert len(fake_sb.uploaded) == 1
    sec_insert = next(c for c in fake_sb.calls if c[0] == "POST" and c[1] == "document_sections")
    assert sec_insert[3][0]["detection"] == "lesson"
    assert sec_insert[3][1]["detection"] == "suspected_answer"


def test_lecturer_upload_auto_creates_missing_bucket():
    fake_sb = FakeSupabase()
    fake_sb.missing_bucket_once = True

    def handler(method: str, table: str, **kwargs):
        if method == "POST" and table == "documents":
            return [{"id": "doc-2", "title": "Bài 2"}], None
        if method == "POST" and table == "document_sections":
            return kwargs.get("json_body"), None
        return [], None

    fake_sb.rest_handler = handler
    client = _make_client("lecturer", fake_sb)
    res = client.post(
        "/api/lecturer/documents",
        data={"title": "Bài 2", "visibility": "center"},
        files={"file": ("bai2.txt", "Nội dung bài học vật lý cơ bản.".encode(), "text/plain")},
    )
    assert res.status_code == 201
    assert fake_sb.ensured_buckets == [("documents", False)]
    assert len(fake_sb.uploaded) == 1


def test_submit_numeric_uses_groq_and_clamps(monkeypatch):
    monkeypatch.setenv("SEALED_KEY", TEST_KEY)
    from app.config import get_settings

    get_settings.cache_clear()
    encrypted = encrypt_sealed("6.96 s", key_hex=TEST_KEY)
    fake_sb = FakeSupabase()

    def handler(method: str, table: str, **kwargs):
        if method == "GET" and table == "questions":
            return [
                {
                    "id": "q-2",
                    "prompt": "Chu kỳ?",
                    "kind": "numeric",
                    "max_score": 10,
                    "assignment_id": "asg-1",
                }
            ], None
        if method == "GET" and table == "assignments":
            return [{"max_attempts": 3}], None
        if method == "GET" and table == "attempts":
            return None, 1
        if method == "GET" and table == "answer_keys":
            return [{"encrypted": encrypted, "public_criteria": ""}], None
        if method == "POST" and table == "attempts":
            return [{"id": "att-2"}], None
        return [], None

    fake_sb.rest_handler = handler

    async def fake_groq(messages, **kwargs):
        return '{"correct": true, "score": 9.5, "feedback": "Chính xác."}'

    monkeypatch.setattr(assignments_router, "groq_chat", fake_groq)
    client = _make_client("student", fake_sb)
    res = client.post("/api/submit", json={"questionId": "q-2", "answer": "6.96s"})
    assert res.status_code == 200
    assert res.json()["score"] == 9.5
    assert res.json()["correct"] is True


def test_student_overview_returns_enrolled_classes_and_docs():
    fake_sb = FakeSupabase()

    def handler(method: str, table: str, **kwargs):
        if method == "GET" and table == "enrollments":
            return [{"id": "en-1", "class_id": "cls-1"}], None
        if method == "GET" and table == "classes":
            return [{"id": "cls-1", "name": "PHY-01", "course_id": "crs-1"}], None
        if method == "GET" and table == "courses":
            return [{"id": "crs-1", "code": "PHY", "title": "Vật lý 1"}], None
        if method == "GET" and table == "documents":
            assert "(visibility.eq.center,course_id.in.(crs-1))" in kwargs["params"]["or"]
            return [
                {"id": "doc-1", "title": "Bài giảng PHY", "visibility": "course", "course_id": "crs-1"},
                {"id": "doc-2", "title": "Sổ tay Trung tâm", "visibility": "center", "course_id": None},
            ], None
        if method == "GET" and table == "document_sections":
            assert kwargs["params"]["decision"] == "eq.lesson"
            return [
                {"document_id": "doc-1"},
                {"document_id": "doc-1"},
                {"document_id": "doc-2"},
            ], None
        return [], None

    fake_sb.rest_handler = handler
    client = _make_client("student", fake_sb)
    res = client.get("/api/student/overview")
    assert res.status_code == 200
    body = res.json()
    assert body["classes"] == [
        {"id": "cls-1", "name": "PHY-01", "course": {"id": "crs-1", "code": "PHY", "title": "Vật lý 1"}}
    ]
    assert body["documents"] == [
        {
            "id": "doc-1",
            "title": "Bài giảng PHY",
            "visibility": "course",
            "course": {"id": "crs-1", "code": "PHY", "title": "Vật lý 1"},
            "lessonSections": 2,
        },
        {
            "id": "doc-2",
            "title": "Sổ tay Trung tâm",
            "visibility": "center",
            "course": None,
            "lessonSections": 1,
        },
    ]


def test_chat_fallback_when_rpc_empty_and_student_search(monkeypatch):
    fake_sb = FakeSupabase()
    fake_sb.rpc_result = []

    def handler(method: str, table: str, **kwargs):
        if method == "GET" and table == "chat_sessions":
            return [{"id": "sess-2", "title": "Cuộc trò chuyện mới"}], None
        if method == "GET" and table == "chat_messages":
            return [], None
        if method == "GET" and table == "document_sections":
            assert kwargs["params"]["decision"] == "eq.lesson"
            return [
                {
                    "id": "s4",
                    "document_id": "d1",
                    "section_index": 4,
                    "content": "## CHƯƠNG 1: ĐỘNG HỌC CHẤT ĐIỂM",
                    "page_from": None,
                    "page_to": None,
                    "documents": {"title": "phy", "status": "published"},
                },
                {
                    "id": "s5",
                    "document_id": "d1",
                    "section_index": 5,
                    "content": "Động học nghiên cứu chuyển động của vật mà không xét nguyên nhân.",
                    "page_from": None,
                    "page_to": None,
                    "documents": {"title": "phy", "status": "published"},
                },
            ], None
        if method == "POST" and table == "chat_messages":
            return kwargs.get("json_body"), None
        return [], None

    fake_sb.rest_handler = handler
    captured: list[dict[str, str]] = []

    async def fake_groq(messages, **kwargs):
        captured.extend(messages)
        return "Chương 1 giới thiệu về động học chất điểm [1]."

    monkeypatch.setattr(chat_router, "groq_chat", fake_groq)
    client = _make_client("student", fake_sb)

    res = client.post("/api/chat", json={"sessionId": "sess-2", "question": "Chương 1 nói về gì?"})
    assert res.status_code == 200
    assert "Động học nghiên cứu chuyển động" in captured[0]["content"]
    assert res.json()["citations"][0]["documentTitle"] == "phy"

    res_search = client.get("/api/student/search?q=động+học")
    assert res_search.status_code == 200
    assert len(res_search.json()["results"]) >= 1


def test_chat_greeting_bypasses_search_and_includes_policy(monkeypatch):
    fake_sb = FakeSupabase()

    def handler(method: str, table: str, **kwargs):
        if method == "GET" and table == "chat_sessions":
            return [{"id": "sess-3", "title": "Cuộc trò chuyện mới"}], None
        if method == "GET" and table == "documents":
            return [{"title": "phy", "courses": {"code": "PHY", "title": "Vật lý"}}], None
        if method == "GET" and table == "chat_messages":
            return [], None
        if method == "POST" and table == "chat_messages":
            return kwargs.get("json_body"), None
        return [], None

    fake_sb.rest_handler = handler
    captured: list[dict[str, str]] = []

    async def fake_groq(messages, **kwargs):
        captured.extend(messages)
        return "Chào bạn! Mình là trợ lý học thuật TrueScholar."

    monkeypatch.setattr(chat_router, "groq_chat", fake_groq)
    client = _make_client("student", fake_sb)
    res = client.post("/api/chat", json={"sessionId": "sess-3", "question": "hello"})
    assert res.status_code == 200
    assert res.json()["citations"] == []
    assert not any(c[0] == "RPC" for c in fake_sb.calls)
    sys_msg = captured[0]["content"]
    assert "GIAO TIẾP CƠ BẢN" in sys_msg
    assert "NGOÀI TOPIC" in sys_msg
    assert "không chắc" in sys_msg
    assert "phy (PHY - Vật lý)" in sys_msg
