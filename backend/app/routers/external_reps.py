# backend/app/routers/external_reps.py

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session, joinedload
from app.database import get_db
from app import models, schemas
from ..auth_dep import require_team_or_higher, require_writer, require_admin


router = APIRouter(prefix="/external_reps", tags=["external reps"])

# ── Create ────────────────────────────────────────────────────────────
@router.post("", status_code=201, response_model=schemas.ExternalRep, dependencies=[Depends(require_writer)])
def create_rep(payload: schemas.ExternalRepCreate, db: Session = Depends(get_db)):
    row = models.ExternalTalentRep(**payload.model_dump())
    db.add(row)
    db.commit()
    db.refresh(row)
    return row

# ── List ──────────────────────────────────────────────────────────────
@router.get("", response_model=list[schemas.ExternalRep], dependencies=[Depends(require_team_or_higher)])
def list_reps(limit: int = 50, offset: int = 0, db: Session = Depends(get_db)):
    return (
        db.query(models.ExternalTalentRep)
          .options(joinedload(models.ExternalTalentRep.agency))   # bring agency name
          .order_by(models.ExternalTalentRep.name)
          .offset(offset)
          .limit(limit)
          .all()
    )

# ── Single ────────────────────────────────────────────────────────────
@router.get("/{rep_id}", response_model=schemas.ExternalRep, dependencies=[Depends(require_team_or_higher)])
def get_rep(rep_id: str, db: Session = Depends(get_db)):
    row = (
        db.query(models.ExternalTalentRep)
          .options(joinedload(models.ExternalTalentRep.agency))
          .get(rep_id)
    )
    if not row:
        raise HTTPException(404, "Rep not found")
    return row
