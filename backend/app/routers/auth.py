"""Endpoints xác thực / kiểm tra hồ sơ người dùng hiện tại."""

from typing import Annotated

from fastapi import APIRouter, Depends

from app.deps import AuthContext, get_current_auth

router = APIRouter(prefix="/api", tags=["auth"])


@router.get("/whoami")
async def whoami(auth: Annotated[AuthContext, Depends(get_current_auth)]):
    return {
        "user": {
            "id": auth.user_id,
            "email": auth.user.get("email"),
        },
        "profile": auth.profile,
    }
