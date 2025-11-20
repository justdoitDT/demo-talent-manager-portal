# backend/app/routers/managers.py

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session, joinedload
from typing import List
# from ..auth_dep import require_team_or_higher, require_writer, require_admin

from ..database import get_db
from .. import models, schemas


router = APIRouter(prefix="/managers", tags=["Managers"])

@router.get("", response_model=List[schemas.ManagerRead])
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

@router.get("/{manager_id}", response_model=schemas.ManagerRead)
def get_manager(manager_id: str, db: Session = Depends(get_db)):
    mgr = (
        db.query(models.Manager)
          .options(joinedload(models.Manager.clients))
          .get(manager_id)
    )
    if not mgr:
        raise HTTPException(404, "Manager not found")
    return mgr

@router.get("/me", response_model=schemas.ManagerRead)
def read_own_profile(db: Session = Depends(get_db)):
    mgr = (
        db.query(models.Manager)
          .options(joinedload(models.Manager.clients))
          .first()
    )
    if not mgr:
        raise HTTPException(404, "Manager not found")
    return mgr

@router.patch("/{manager_id}", response_model=schemas.ManagerRead)
def update_manager(manager_id: str, payload: schemas.ManagerUpdate, db: Session = Depends(get_db)):
    # Prefer Session.get on SQLAlchemy 1.4+/2.0
    mgr = db.get(models.Manager, manager_id)
    if not mgr:
        raise HTTPException(status_code=404, detail="Manager not found")

    # only update provided fields
    if payload.email is not None:
        mgr.email = payload.email
    if payload.phone is not None:
        mgr.phone = payload.phone

    db.add(mgr)
    db.commit()
    db.refresh(mgr)
    return mgr