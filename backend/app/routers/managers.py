# backend/app/routers/managers.py

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session, joinedload
from typing import List
from ..auth_dep import require_team_or_higher, require_writer, require_admin

from ..database import get_db
from .. import models, schemas


router = APIRouter(prefix="/managers", tags=["Managers"])

@router.get("", response_model=List[schemas.ManagerRead], dependencies=[Depends(require_team_or_higher)])
def list_managers(
    role: str = Query(..., description="Filter by role, e.g. 'manager'"),
    db: Session = Depends(get_db),
):
    return (
        db.query(models.Manager)
          .options(joinedload(models.Manager.clients))
          .filter(models.Manager.role == role)
          .filter(models.Manager.status == "Active")   # ✨ only Active
          .order_by(models.Manager.name)
          .all()
    )

@router.get("/{manager_id}", response_model=schemas.ManagerRead, dependencies=[Depends(require_team_or_higher)])
def get_manager(manager_id: str, db: Session = Depends(get_db)):
    mgr = (
        db.query(models.Manager)
          .options(joinedload(models.Manager.clients))
          .get(manager_id)
    )
    if not mgr:
        raise HTTPException(404, "Manager not found")
    return mgr

@router.get("/me", response_model=schemas.ManagerRead, dependencies=[Depends(require_team_or_higher)])
def read_own_profile(db: Session = Depends(get_db)):
    mgr = (
        db.query(models.Manager)
          .options(joinedload(models.Manager.clients))
          .first()
    )
    if not mgr:
        raise HTTPException(404, "Manager not found")
    return mgr
