# backend/app/routers/writing_samples.py

from fastapi import APIRouter, Depends, HTTPException, status, Body, UploadFile, File, Form
from fastapi.responses import StreamingResponse
from sqlalchemy import and_, text
from sqlalchemy.orm import Session, joinedload
from sqlalchemy.exc import IntegrityError
from pathlib import Path
from typing import List, Optional
from app import schemas, models
from app.database import get_db
from supabase import create_client
import mimetypes, os, datetime, json, uuid
from ..auth_dep import require_team_or_higher, require_writer, require_admin



# ▶ This router is ONLY for single–writing‑sample endpoints
router = APIRouter(prefix="/writing_samples", tags=["Writing Samples"])

sb = create_client(os.environ["SUPABASE_URL"], os.environ["SUPABASE_SERVICE_ROLE_KEY"])
WRITING_SAMPLES_BUCKET = os.getenv("WRITING_SAMPLES_BUCKET", "writing-samples")



# helpers
def _safe_filename(name: str) -> str:
    return name.replace("/", "_").replace("\\", "_")

def _build_storage_path(primary_creative: str, primary_project: str, filename: str) -> str:
    # Add a short random prefix to avoid collisions:
    rand = uuid.uuid4().hex  # 32 hex chars
    rand = str(rand)[-5:]
    return f"{primary_creative}/{primary_project}/{_safe_filename(filename)}_{rand}"

def _resolve_user_name(db: Session, user_id: str | None) -> str | None:
    """
    Translate a TM_ / CR_ ID into the person’s name.
    Returns None for null / unknown / unsupported prefixes.
    """
    if not user_id:
        return None

    prefix = user_id[:2]
    if prefix == "CR":
        return (
            db.query(models.Creative.name)
              .filter(models.Creative.id == user_id)
              .scalar()
        )
    if prefix == "TM":
        return (
            db.query(models.Manager.name)           # table name is `team`
              .filter(models.Manager.id == user_id)
              .scalar()
        )
    return None

def _get_writing_sample(db: Session, sample_id: str) -> Optional[models.WritingSample]:
    return (
        db.query(models.WritingSample)
          .filter(models.WritingSample.id == sample_id)
          .first()
    )

def _get_writing_sample_detail(db: Session, sample_id: str) -> models.WritingSample | None:
    return (
        db.query(models.WritingSample)
          .options(
              joinedload(models.WritingSample.projects),   # relationship via writing_sample_to_project
              joinedload(models.WritingSample.creatives),  # relationship via writing_sample_to_creative
          )
          .filter(models.WritingSample.id == sample_id)
          .first()
    )




# routers

@router.get("/{sample_id}", response_model=schemas.WritingSampleDetail, dependencies=[Depends(require_team_or_higher)])
def get_writing_sample(sample_id: str, db: Session = Depends(get_db)):
    ws = _get_writing_sample_detail(db, sample_id)
    if not ws:
        raise HTTPException(404, "Writing sample not found")

    uploaded_name = _resolve_user_name(db, ws.uploaded_by)
    return {**ws.__dict__, "uploaded_by_name": uploaded_name}



@router.patch(
    "/{sample_id}",
    response_model=schemas.WritingSampleDetail,  # or Base if you prefer
    status_code=200,
    dependencies=[Depends(require_writer)]
)
def update_writing_sample(
    sample_id: str,
    payload: schemas.WritingSampleUpdate = Body(...),
    db: Session = Depends(get_db),
):
    ws = _get_writing_sample(db, sample_id)
    if not ws:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Writing sample not found")

    # Apply only the fields sent
    update_data = payload.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        setattr(ws, field, value)

    db.commit()
    ws = _get_writing_sample_detail(db, sample_id)
    uploaded_name = _resolve_user_name(db, ws.uploaded_by) if ws else None
    return {**ws.__dict__, "uploaded_by_name": uploaded_name}




# ────────────────────────────────────────────────────────────────
# CREATE Writing Sample  (upload file + metadata + link tables)
# ────────────────────────────────────────────────────────────────
@router.post(
    "",
    response_model=schemas.WritingSampleDetail,
    status_code=status.HTTP_201_CREATED,
    # ⬅️ remove dependencies=[Depends(require_writer)] here to avoid double work
)
async def create_writing_sample(
    file: UploadFile = File(...),
    file_description: str = Form(...),
    synopsis: str = Form(...),
    creativeIds: str = Form(...),
    projectIds: str = Form(...),
    db: Session = Depends(get_db),
    user = Depends(require_writer),              # ⬅️ enforce & capture the user
):
    # 0) who is uploading?
    uploader_id: str | None = user.get("team_id") or user.get("creative_id")
    if not uploader_id:
        # With require_writer this should basically always be a TM_… id.
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Cannot determine uploader")

    # 1) parse JSON arrays
    try:
        creative_ids: List[str] = json.loads(creativeIds)
        if not isinstance(creative_ids, list): raise ValueError
    except:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Invalid creativeIds JSON.")
    try:
        project_ids: List[str] = json.loads(projectIds)
        if not isinstance(project_ids, list): raise ValueError
    except:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Invalid projectIds JSON.")

    if not creative_ids:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "At least one creative is required.")
    if not project_ids:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "At least one project is required.")

    # 2) read file bytes
    contents = await file.read()
    if not contents:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Empty file upload.")

    # 3) determine content type
    content_type = (
        file.content_type
        or mimetypes.guess_type(file.filename)[0]
        or "application/octet-stream"
    )

    # 4) build storage path & upload
    primary_creative = creative_ids[0]
    primary_project  = project_ids[0]
    storage_path = _build_storage_path(primary_creative, primary_project, file.filename)

    try:
        sb.storage.from_(WRITING_SAMPLES_BUCKET).upload(
            storage_path,
            contents,
            {"content-type": content_type, "upsert": False},
        )
    except Exception as exc:
        if "duplicate" in str(exc).lower() or "exists" in str(exc).lower():
            storage_path = _build_storage_path(primary_creative, primary_project, file.filename)
            sb.storage.from_(WRITING_SAMPLES_BUCKET).upload(
                storage_path,
                contents,
                {"content-type": content_type, "upsert": False},
            )
        else:
            raise

    # ── PHASE 1: raw INSERT + RETURNING ────────────────────────────
    insert_sql = text("""
        INSERT INTO writing_samples
            (storage_bucket, storage_path, filename,
             file_description, synopsis,
             file_type, size_bytes, uploaded_by)
        VALUES
            (:bucket, :path, :filename,
             :desc, :synopsis,
             :type, :size, :uploaded_by)
        RETURNING id, uploaded_at
    """)
    params = {
        "bucket": WRITING_SAMPLES_BUCKET,
        "path": storage_path,
        "filename": file.filename,
        "desc": file_description,
        "synopsis": synopsis,
        "type": content_type,
        "size": len(contents),
        "uploaded_by": uploader_id,          # ⬅️ store the actual current user’s ID
    }
    result = db.execute(insert_sql, params)
    row = result.first()
    if not row:
        raise HTTPException(status.HTTP_500_INTERNAL_SERVER_ERROR, "Could not create writing_sample")
    ws_id, uploaded_at = row.id, row.uploaded_at
    db.commit()

    # ── PHASE 2: insert into join tables ──────────────────────────
    for cid in creative_ids:
        db.execute(
            models.writing_sample_to_creative.insert().values(
                writing_sample_id = ws_id,
                creative_id       = cid,
                status            = "active",
            )
        )
    for pid in project_ids:
        db.execute(
            models.writing_sample_to_project.insert().values(
                writing_sample_id = ws_id,
                project_id        = pid,
                status            = "active",
            )
        )
    db.commit()

    # ── Return enriched detail or minimal fallback ────────────────
    ws_detail = _get_writing_sample_detail(db, ws_id)
    if ws_detail:
        uploaded_name = _resolve_user_name(db, ws_detail.uploaded_by)
        return {**ws_detail.__dict__, "uploaded_by_name": uploaded_name}

    # minimal fallback
    fallback = {
        "id": ws_id,
        "storage_bucket": WRITING_SAMPLES_BUCKET,
        "storage_path": storage_path,
        "filename": file.filename,
        "file_description": file_description,
        "synopsis": synopsis,
        "file_type": content_type,
        "size_bytes": len(contents),
        "uploaded_by": uploader_id,          # ⬅️ reflect the real uploader here too
        "uploaded_at": uploaded_at,
        "uploaded_by_name": _resolve_user_name(db, uploader_id),
        "projects": [],
        "creatives": [],
    }
    return fallback




# ────────────────────────────────────────────────────────────────
# LINK / UNLINK CREATIVES
# ────────────────────────────────────────────────────────────────
@router.post("/{sample_id}/creatives/{creative_id}", status_code=204, dependencies=[Depends(require_writer)])
def link_creative_to_sample(sample_id: str, creative_id: str, db: Session = Depends(get_db)):
    # make sure IDs exist (optional but nice)
    if not db.get(models.WritingSample, sample_id) or not db.get(models.Creative, creative_id):
        raise HTTPException(status.HTTP_404_NOT_FOUND)

    try:
        db.execute(
            models.writing_sample_to_creative.insert().values(
                writing_sample_id = sample_id,
                creative_id       = creative_id,
                status            = "active",
            )
        )
        db.commit()
    except IntegrityError:
        db.rollback()      # row already exists → idempotent 204
    return

@router.delete("/{sample_id}/creatives/{creative_id}", status_code=204, dependencies=[Depends(require_writer)])
def unlink_creative_from_sample(sample_id: str, creative_id: str, db: Session = Depends(get_db)):
    rows = db.execute(
        models.writing_sample_to_creative.delete().where(
            and_(
                models.writing_sample_to_creative.c.writing_sample_id == sample_id,
                models.writing_sample_to_creative.c.creative_id       == creative_id,
            )
        )
    ).rowcount
    db.commit()
    if rows == 0:
        raise HTTPException(status.HTTP_404_NOT_FOUND)
    return

# ────────────────────────────────────────────────────────────────
# LINK / UNLINK PROJECTS
# ────────────────────────────────────────────────────────────────
@router.post("/{sample_id}/projects/{project_id}", status_code=204, dependencies=[Depends(require_writer)])
def link_project_to_sample(sample_id: str, project_id: str, db: Session = Depends(get_db)):
    if not db.get(models.WritingSample, sample_id) or not db.get(models.Project, project_id):
        raise HTTPException(status.HTTP_404_NOT_FOUND)

    try:
        db.execute(
            models.writing_sample_to_project.insert().values(
                writing_sample_id = sample_id,
                project_id        = project_id,
                status            = "active",
            )
        )
        db.commit()
    except IntegrityError:
        db.rollback()
    return

@router.delete("/{sample_id}/projects/{project_id}", status_code=204, dependencies=[Depends(require_writer)])
def unlink_project_from_sample(sample_id: str, project_id: str, db: Session = Depends(get_db)):
    rows = db.execute(
        models.writing_sample_to_project.delete().where(
            and_(
                models.writing_sample_to_project.c.writing_sample_id == sample_id,
                models.writing_sample_to_project.c.project_id        == project_id,
            )
        )
    ).rowcount
    db.commit()
    if rows == 0:
        raise HTTPException(status.HTTP_404_NOT_FOUND)
    return



# ────────────────────────────────────────────────────────────────
# Download Writing Sample
# ────────────────────────────────────────────────────────────────
@router.get("/{sample_id}/download", dependencies=[Depends(require_team_or_higher)])
def get_download_url(sample_id: str, db: Session = Depends(get_db)):
    ws = _get_writing_sample(db, sample_id)
    if not ws:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Writing sample not found")

    # either PUBLIC url …
    # url = sb.storage.from_(ws.storage_bucket).get_public_url(ws.storage_path)

    # …or a short‑lived signed URL (recommended)
    expires_in = int(datetime.timedelta(hours=1).total_seconds())
    url = sb.storage.from_(ws.storage_bucket).create_signed_url(
        ws.storage_path, expires_in
    )["signedURL"]

    return {"url": url}