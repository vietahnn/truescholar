"""Client bất đồng bộ gọi Groq Chat Completions API."""

import httpx

from app.config import Settings, get_settings


class GroqError(Exception):
    def __init__(self, status_code: int, message: str):
        super().__init__(message)
        self.status_code = status_code
        self.message = message


async def groq_chat(
    messages: list[dict[str, str]],
    *,
    temperature: float = 0.3,
    settings: Settings | None = None,
    http_client: httpx.AsyncClient | None = None,
) -> str:
    cfg = settings or get_settings()
    if not cfg.groq_api_key:
        raise GroqError(500, "GROQ_API_KEY chưa được cấu hình.")

    payload = {
        "model": cfg.groq_model or "llama-3.3-70b-versatile",
        "messages": messages,
        "temperature": temperature,
    }
    headers = {
        "Authorization": f"Bearer {cfg.groq_api_key}",
        "Content-Type": "application/json",
    }

    owns_client = http_client is None
    client = http_client or httpx.AsyncClient(timeout=45.0)
    try:
        resp = await client.post(
            "https://api.groq.com/openai/v1/chat/completions",
            headers=headers,
            json=payload,
            timeout=45.0,
        )
    except httpx.TimeoutException as exc:
        raise GroqError(504, "Groq API quá thời gian phản hồi.") from exc
    except httpx.HTTPError as exc:
        raise GroqError(502, f"Lỗi kết nối Groq API: {exc}") from exc
    finally:
        if owns_client:
            await client.aclose()

    if resp.status_code >= 400:
        raise GroqError(502, f"Groq API lỗi {resp.status_code}: {resp.text[:300]}")

    data = resp.json()
    choices = data.get("choices") or []
    if not choices:
        return ""
    return choices[0].get("message", {}).get("content", "") or ""
