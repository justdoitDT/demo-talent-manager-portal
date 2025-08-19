# backend/app/main.py

import os
from fastapi import FastAPI, Depends, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from .database import get_db
from .auth_dep import (
    require_team_or_higher,
    _decode_supabase_jwt,
    _classify_roles,
)
from .routers import (
    auth_me,
    managers,
    creatives,
    client_team_assignments,
    projects,
    notes,
    enums,
    genre_tags,
    writing_samples,
    ai,
    subs,
    executives,
    external_reps,
    companies,
    mandates,
    imdb_scrape
)
from .ai.recommend_client_for_project_need.router import (
    router as recommend_client_for_project_need_router,
)


app = FastAPI(title="Manager Portal API")

# ---- CORS configuration ----
_frontend = os.getenv("FRONTEND_URL")
_origins = [u for u in {_frontend, "http://localhost:3000"} if u]
app.add_middleware(
    CORSMiddleware,
    allow_origins=_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Paths that any user may POST to without manager/admin guard
PUBLIC_WRITE_PATHS = {
    "/auth/invite",
    "/auth/request-invite",
}


@app.middleware("http")
async def writer_guard(request: Request, call_next):
    """
    Permit mutating requests (POST/PUT/PATCH/DELETE) only for users whose
    Supabase roles include “manager” or “admin”.

    • Skips the PUBLIC_WRITE_PATHS whitelist.
    • Validates the Bearer token via `_decode_supabase_jwt`.
    • Classifies roles via `_classify_roles`.
    """
    # Only guard mutating methods
    if request.method in {"POST", "PUT", "PATCH", "DELETE"}:
        # Allow public write endpoints
        if request.url.path not in PUBLIC_WRITE_PATHS:
            # Extract and validate Bearer token
            auth_header = request.headers.get("authorization", "")
            if not auth_header.startswith("Bearer "):
                return JSONResponse(
                    content={"detail": "Missing or invalid Authorization header"},
                    status_code=401,
                )

            token = auth_header.split(" ", 1)[1]
            try:
                claims = _decode_supabase_jwt(token)
                email = (claims.get("email") or "").lower()
                if not email:
                    raise ValueError("email claim missing")
            except Exception:
                return JSONResponse(
                    content={"detail": "Invalid token"},
                    status_code=401,
                )

            # Classify roles
            db = next(get_db())
            try:
                roles = _classify_roles(db, email)["roles"]
            finally:
                db.close()

            # Require manager or admin
            if not {"manager", "admin"}.intersection(roles):
                return JSONResponse(
                    content={"detail": "Write access requires manager or admin"},
                    status_code=403,
                )

    # If we reach here, the request is allowed
    return await call_next(request)


# ---- Routers ----

# Public auth routes
app.include_router(auth_me.router)

# Protected routes: require at least "team" membership
team_or_higher = [Depends(require_team_or_higher)]

app.include_router(managers.router,                dependencies=team_or_higher)
app.include_router(creatives.router,               dependencies=team_or_higher)
app.include_router(client_team_assignments.router, dependencies=team_or_higher)
app.include_router(projects.router,                dependencies=team_or_higher)
app.include_router(notes.router,                   dependencies=team_or_higher)
app.include_router(enums.router,                   dependencies=team_or_higher)
app.include_router(genre_tags.router,              dependencies=team_or_higher)
app.include_router(writing_samples.router,         dependencies=team_or_higher)
app.include_router(ai.router,                      dependencies=team_or_higher)
app.include_router(subs.router,                    dependencies=team_or_higher)
app.include_router(executives.router,              dependencies=team_or_higher)
app.include_router(external_reps.router,           dependencies=team_or_higher)
app.include_router(companies.router,               dependencies=team_or_higher)
app.include_router(mandates.router,                dependencies=team_or_higher)
app.include_router(
    recommend_client_for_project_need_router,
    dependencies=team_or_higher,
)
app.include_router(imdb_scrape.router)

@app.get("/health")
def health():
    return {"ok": True}
