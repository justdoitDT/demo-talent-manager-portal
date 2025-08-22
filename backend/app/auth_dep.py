# backend/app/auth_dep.py


# Works with BOTH HS-signed and RS-signed Supabase JWTs.
# -----
# ▸ If your project is still HS256     → set env SUPABASE_JWT_SECRET
# ▸ If you later flip to JWK/RSA (RS) → no change needed; RS path is used.

import os
from fastapi import Depends, Header, HTTPException
from jose import jwt
from jwt import PyJWKClient
from sqlalchemy import text
from typing import Optional

from .database import get_db



# Demo switch
DEMO_MODE = os.getenv("DEMO_MODE", "false").lower() == "true"


# Make these lazy/optional so demo mode doesn’t require them.
SUPABASE_URL = os.getenv("SUPABASE_URL", "")
if SUPABASE_URL:
    JWKS_URL    = f"{SUPABASE_URL}/auth/v1/.well-known/jwks.json"
    _jwk_client = PyJWKClient(JWKS_URL)
else:
    JWKS_URL    = None
    _jwk_client = None



SUPABASE_JWT_SECRET = os.getenv("SUPABASE_JWT_SECRET")

def _decode_supabase_jwt(token: str) -> dict:
    hdr = jwt.get_unverified_header(token)
    alg = hdr.get("alg")

    # ── Legacy HS256 projects ─────────────────────────
    if alg == "HS256":
        if not SUPABASE_JWT_SECRET:
            raise HTTPException(500, "SUPABASE_JWT_SECRET not set")
        return jwt.decode(
            token,
            SUPABASE_JWT_SECRET,
            algorithms=["HS256"],
            options={"verify_aud": False},
        )

    # ── New signing-key projects (RS256 / ES256) ──────
    signing_key = _jwk_client.get_signing_key_from_jwt(token)
    return jwt.decode(
        token,
        signing_key.key,
        algorithms=[alg],
        options={"verify_aud": False},
    )


# ────────────────────────────────────────────
# Role classification
# ────────────────────────────────────────────
def _classify_roles(db, email: str) -> dict:
    """
    Decide which high-level roles the user has **for the manager backend**.

    • If the email is present in `team` AND status='Active':
        - admin   → {'admin','manager','team'}
        - manager → {'manager','team'}
        - team    → {'team'}
    • Else, if the email is NOT in team but IS in creatives:
        → {'creative'}
    """
    # team row (still needs status)
    team = db.execute(
        text("""
            SELECT id, status, supabase_uid, is_admin, role
            FROM team
            WHERE lower(email) = :e
            LIMIT 1
        """),
        {"e": email},
    ).first()

    # creative row (no status column any more)
    creative = db.execute(
        text("""
            SELECT id, supabase_uid
            FROM creatives
            WHERE lower(email) = :e
            LIMIT 1
        """),
        {"e": email},
    ).first()

    roles: set[str] = set()

    # ----- team logic -----
    if team and team.status == "Active":
        if bool(team.is_admin):
            roles.update({"admin", "manager", "team"})
        else:
            role_txt = (team.role or "").strip().lower()
            if role_txt in {"manager", "assistant"}:
                roles.update({"manager", "team"})
            else:
                roles.add("team")
    # ----- creative fallback -----
    elif creative and not team:
        roles.add("creative")

    return {
        "roles": roles,
        "team_row": team,
        "creative_row": creative,
    }


# ────────────────────────────────────────────
# Main dependency & fine-grained guards
# ────────────────────────────────────────────
def require_user(authorization: Optional[str] = Header(None)):
    """
    DEMO MODE: return a fake 'manager/admin' user and skip all checks.
    """
    if DEMO_MODE:
        return {
            "email": "demo@local",
            "user_id": "demo-user",
            "roles": ["admin", "manager", "team"],
            "team_id": None,
            "creative_id": None,
            "is_admin": True,
        }


# --------- convenience guards ----------
def require_team_or_higher(user = Depends(require_user)):
    if not any(r in user["roles"] for r in ("team", "manager", "admin")):
        raise HTTPException(403, "Team or higher required")
    return user


def require_writer(user = Depends(require_user)):
    if not any(r in user["roles"] for r in ("manager", "admin")):
        raise HTTPException(403, "Write access requires manager or admin")
    return user


def require_manager(user = Depends(require_user)):
    if "manager" not in user["roles"] and "admin" not in user["roles"]:
        raise HTTPException(403, "Managers only")
    return user


def require_admin(user = Depends(require_user)):
    if "admin" not in user["roles"]:
        raise HTTPException(403, "Admins only")
    return user
