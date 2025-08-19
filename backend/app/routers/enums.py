# backend/app/routers/enums.py

from fastapi import APIRouter, Depends
from sqlalchemy import text
from sqlalchemy.orm import Session
from ..database import get_db
from typing import List
from ..auth_dep import require_team_or_higher, require_writer, require_admin


router = APIRouter(prefix="/meta/enums", tags=["Meta Enums"])

@router.get("/project_tracking_status", response_model=List[str], dependencies=[Depends(require_team_or_higher)])
def get_tracking_status(db: Session = Depends(get_db)):
    rows = db.execute(
        text("SELECT enumlabel FROM pg_enum WHERE enumtypid = 'project_tracking_status_enum'::regtype")
    ).scalars().all()
    return rows

@router.get("/project_status", response_model=List[str], dependencies=[Depends(require_team_or_higher)])
def get_project_status(db: Session = Depends(get_db)):
    rows = db.execute(
        text("SELECT enumlabel FROM pg_enum WHERE enumtypid = 'project_status_enum'::regtype")
    ).scalars().all()
    return rows
