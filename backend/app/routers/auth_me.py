# backend/app/routers/auth_me.py

from fastapi import APIRouter, Depends
from ..auth_dep import require_user


router = APIRouter(prefix="/auth", tags=["auth"])

@router.get("/me")
def me(user = Depends(require_user)):
    return user