# TrueScholar MVP — FastAPI Backend

Backend Python độc lập sử dụng **FastAPI**, kết nối tới **Supabase** (PostgREST, Auth, Storage, RPC) và **Groq API**, đồng thời giữ toàn bộ khóa bí mật (`SEALED_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `GROQ_API_KEY`) ở phía server.

## Chạy cục bộ

Từ thư mục gốc dự án hoặc `backend/`:

```bash
cd backend
uvicorn app.main:app --reload --port 8000
```

File `.env` ở thư mục gốc dự án sẽ tự động được nạp. Trên frontend Next.js, mặc định gọi `http://localhost:8000` (có thể ghi đè bằng `NEXT_PUBLIC_API_URL` hoặc `API_URL`).

## Tài liệu API

Khi server chạy:
- Swagger UI: `http://localhost:8000/docs`
- Healthcheck: `http://localhost:8000/health`

## Chạy kiểm thử

```bash
cd backend
pytest
```
