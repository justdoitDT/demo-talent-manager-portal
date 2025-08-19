# backend/app/routers/genre_tags.py
from fastapi import APIRouter, Depends, Query, HTTPException, status
from sqlalchemy.orm import Session
from typing import List
import uuid
from ..auth_dep import require_team_or_higher, require_writer, require_admin

from ..database import get_db
from .. import models, schemas


router = APIRouter(prefix="/genre_tags", tags=["Genre Tags"])


# ---------- helpers -------------------------------------------------
def _new_id() -> str:
    """Generate an ID like  GT_01234  ."""
    return f"GT_{uuid.uuid4().hex[:5]}".upper()


# ---------- GET  /genre_tags  ---------------------------------------
@router.get("", response_model=List[schemas.GenreTagMini], dependencies=[Depends(require_team_or_higher)])
def list_tags(
    q: str | None = Query(
        None, description="Substring match on tag name, case-insensitive"
    ),
    db: Session = Depends(get_db),
):
    query = db.query(models.GenreTag)
    if q:
        query = query.filter(models.GenreTag.name.ilike(f"%{q}%"))
    # limit keeps the dropdown snappy
    return query.order_by(models.GenreTag.name).all()


# ---------- POST  /genre_tags  --------------------------------------
class GenreTagCreate(schemas.BaseModel):
    name: str

@router.post(
    "", response_model=schemas.GenreTagMini, status_code=status.HTTP_201_CREATED, dependencies=[Depends(require_writer)]
)
def create_tag(payload: GenreTagCreate, db: Session = Depends(get_db)):
    # idempotent – if the tag already exists just return it
    existing = db.query(models.GenreTag).filter_by(name=payload.name).first()
    if existing:
        return existing

    tag = models.GenreTag(id=_new_id(), name=payload.name.strip())
    db.add(tag)
    db.commit()
    db.refresh(tag)
    return tag
