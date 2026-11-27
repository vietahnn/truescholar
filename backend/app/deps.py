"""Dependencies xác thực Supabase JWT, phân quyền staff và inject clients."""

from dataclasses import dataclass
from typing import Annotated, Any

from fastapi import Depends, Header, HTTPException, Request

from app.clients.supabase import SupabaseClient, SupabaseError


@dataclass
class AuthContext:
    user: dict[str, Any]
    profile: dict[str, Any]
    access_token: str

    @property
    def user_id(self) -> str:
        return str(self.user["id"])

    @property
    def role(self) -> str:
        return str(self.profile.get("role", "student"))


def get_supabase(request: Request) -> SupabaseClient:
    client = getattr(request.app.state, "supabase", None)
    if client is not None:
        return client
    return SupabaseClient()


async def get_current_auth(
    supabase: Annotated[SupabaseClient, Depends(get_supabase)],
    authorization: Annotated[str | None, Header()] = None,
) -> AuthContext:
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(status_code=401, detail="unauthenticated")
    token = authorization.split(" ", 1)[1].strip()
    if not token:
        raise HTTPException(status_code=401, detail="unauthenticated")

    try:
        user = await supabase.get_user(token)
    except SupabaseError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.message) from exc

    user_id = str(user.get("id", ""))
    if not user_id:
        raise HTTPException(status_code=401, detail="unauthenticated")

    rows, _ = await supabase.rest(
        "GET",
        "profiles",
        access_token=token,
        params={"select": "id,full_name,role,created_at", "id": f"eq.{user_id}", "limit": "1"},
    )
    profile = rows[0] if isinstance(rows, list) and rows else None

    if profile is None:
        meta = user.get("user_metadata") or {}
        meta_role = meta.get("role")
        safe_role = "lecturer" if meta_role == "lecturer" else "student"
        full_name = meta.get("full_name") if isinstance(meta.get("full_name"), str) else ""
        created, _ = await supabase.rest(
            "POST",
            "profiles",
            use_admin=True,
            params={"on_conflict": "id"},
            json_body={"id": user_id, "full_name": full_name, "role": safe_role},
            prefer="resolution=merge-duplicates,return=representation",
        )
        if not isinstance(created, list) or not created:
            raise HTTPException(status_code=500, detail="Không khởi tạo được hồ sơ người dùng.")
        profile = created[0]

    return AuthContext(user=user, profile=profile, access_token=token)


async def require_staff(auth: Annotated[AuthContext, Depends(get_current_auth)]) -> AuthContext:
    if auth.role not in ("lecturer", "admin"):
        raise HTTPException(status_code=403, detail="forbidden")
    return auth
