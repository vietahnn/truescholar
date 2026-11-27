"""Client bất đồng bộ gọi Supabase Auth, PostgREST, RPC và Storage qua httpx."""

from typing import Any
from urllib.parse import quote

import httpx

from app.config import Settings, get_settings


class SupabaseError(Exception):
    def __init__(self, status_code: int, message: str, code: str | None = None):
        super().__init__(message)
        self.status_code = status_code
        self.message = message
        self.code = code


def _extract_error(resp: httpx.Response) -> tuple[str, str | None]:
    try:
        data = resp.json()
        if isinstance(data, dict):
            msg = (
                data.get("message")
                or data.get("msg")
                or data.get("error_description")
                or data.get("error")
                or resp.text
            )
            return str(msg), data.get("code")
    except ValueError:
        pass
    return resp.text[:300] or f"HTTP {resp.status_code}", None


def _parse_content_range(header_val: str | None) -> int | None:
    if not header_val or "/" not in header_val:
        return None
    total = header_val.split("/")[-1].strip()
    if total == "*" or not total.isdigit():
        return None
    return int(total)


class SupabaseClient:
    def __init__(
        self,
        settings: Settings | None = None,
        http_client: httpx.AsyncClient | None = None,
    ):
        self.settings = settings or get_settings()
        self._external_client = http_client is not None
        self._client = http_client or httpx.AsyncClient(timeout=30.0)

    async def aclose(self) -> None:
        if not self._external_client:
            await self._client.aclose()

    @property
    def base_url(self) -> str:
        url = self.settings.next_public_supabase_url.rstrip("/")
        if not url:
            raise SupabaseError(500, "Thiếu NEXT_PUBLIC_SUPABASE_URL.")
        return url

    def _headers(
        self,
        *,
        access_token: str | None = None,
        use_admin: bool = False,
        prefer: str | None = None,
    ) -> dict[str, str]:
        if use_admin:
            key = self.settings.supabase_service_role_key
            if not key:
                raise SupabaseError(500, "Thiếu SUPABASE_SERVICE_ROLE_KEY.")
            headers = {
                "apikey": key,
                "Authorization": f"Bearer {key}",
                "Content-Type": "application/json",
            }
        else:
            anon = self.settings.next_public_supabase_anon_key
            if not anon:
                raise SupabaseError(500, "Thiếu NEXT_PUBLIC_SUPABASE_ANON_KEY.")
            if not access_token:
                raise SupabaseError(401, "unauthenticated")
            headers = {
                "apikey": anon,
                "Authorization": f"Bearer {access_token}",
                "Content-Type": "application/json",
            }
        if prefer:
            headers["Prefer"] = prefer
        return headers

    async def get_user(self, access_token: str) -> dict[str, Any]:
        anon = self.settings.next_public_supabase_anon_key
        if not anon:
            raise SupabaseError(500, "Thiếu NEXT_PUBLIC_SUPABASE_ANON_KEY.")
        resp = await self._client.get(
            f"{self.base_url}/auth/v1/user",
            headers={
                "apikey": anon,
                "Authorization": f"Bearer {access_token}",
            },
        )
        if resp.status_code >= 400:
            msg, code = _extract_error(resp)
            status = 401 if resp.status_code in (401, 403) else resp.status_code
            raise SupabaseError(status, msg, code)
        return resp.json()

    async def rest(
        self,
        method: str,
        table: str,
        *,
        access_token: str | None = None,
        use_admin: bool = False,
        params: dict[str, str] | list[tuple[str, str]] | None = None,
        json_body: Any = None,
        prefer: str | None = None,
        exact_count: bool = False,
        head_only: bool = False,
    ) -> tuple[Any, int | None]:
        prefs: list[str] = []
        if prefer:
            prefs.append(prefer)
        if exact_count:
            prefs.append("count=exact")
        headers = self._headers(
            access_token=access_token,
            use_admin=use_admin,
            prefer=",".join(prefs) if prefs else None,
        )
        req_method = "HEAD" if head_only else method.upper()
        resp = await self._client.request(
            req_method,
            f"{self.base_url}/rest/v1/{table}",
            headers=headers,
            params=params,
            json=json_body,
        )
        if resp.status_code >= 400:
            msg, code = _extract_error(resp)
            raise SupabaseError(resp.status_code, msg, code)

        total = _parse_content_range(resp.headers.get("content-range"))
        if req_method == "HEAD" or not resp.content:
            return None, total
        return resp.json(), total

    async def rpc(
        self,
        fn_name: str,
        payload: dict[str, Any],
        *,
        access_token: str | None = None,
        use_admin: bool = False,
    ) -> Any:
        headers = self._headers(access_token=access_token, use_admin=use_admin)
        resp = await self._client.post(
            f"{self.base_url}/rest/v1/rpc/{fn_name}",
            headers=headers,
            json=payload,
        )
        if resp.status_code >= 400:
            msg, code = _extract_error(resp)
            raise SupabaseError(resp.status_code, msg, code)
        return resp.json() if resp.content else []

    async def ensure_bucket(self, bucket: str, *, public: bool = False) -> None:
        headers = self._headers(use_admin=True)
        resp = await self._client.post(
            f"{self.base_url}/storage/v1/bucket",
            headers=headers,
            json={"id": bucket, "name": bucket, "public": public},
        )
        if resp.status_code in (200, 201, 409):
            return
        msg, code = _extract_error(resp)
        if "already exists" in msg.lower() or "duplicate" in msg.lower():
            return
        raise SupabaseError(resp.status_code, msg, code)

    async def storage_upload(
        self,
        bucket: str,
        path: str,
        content: bytes,
        content_type: str,
        *,
        access_token: str | None = None,
        use_admin: bool = False,
    ) -> Any:
        headers = self._headers(access_token=access_token, use_admin=use_admin)
        headers["Content-Type"] = content_type or "application/octet-stream"
        headers["x-upsert"] = "false"
        encoded_path = "/".join(quote(seg, safe="") for seg in path.split("/"))
        resp = await self._client.post(
            f"{self.base_url}/storage/v1/object/{bucket}/{encoded_path}",
            headers=headers,
            content=content,
        )
        if resp.status_code >= 400:
            msg, code = _extract_error(resp)
            raise SupabaseError(resp.status_code, msg, code)
        return resp.json() if resp.content else {"Key": path}

    async def storage_delete(
        self,
        bucket: str,
        paths: list[str],
        *,
        access_token: str | None = None,
        use_admin: bool = False,
    ) -> None:
        if not paths:
            return
        headers = self._headers(access_token=access_token, use_admin=use_admin)
        resp = await self._client.request(
            "DELETE",
            f"{self.base_url}/storage/v1/object/{bucket}",
            headers=headers,
            json={"prefixes": paths},
        )
        if resp.status_code >= 400:
            msg, code = _extract_error(resp)
            raise SupabaseError(resp.status_code, msg, code)
