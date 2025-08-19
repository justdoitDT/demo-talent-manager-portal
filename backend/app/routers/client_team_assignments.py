# backend/app/routers/client_team_assignments.py

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from sqlalchemy.exc import IntegrityError
from ..database import get_db
from .. import models
from ..auth_dep import require_team_or_higher, require_writer, require_admin


router = APIRouter(prefix="/client-team-assignments", tags=["ClientTeamAssignments"])

@router.delete("", status_code=204, dependencies=[Depends(require_writer)])
def delete_assignment(
    team_id: str = Query(...),
    creative_id: str = Query(...),
    db: Session = Depends(get_db),
):
    rows = (
        db.query(models.client_team_assignments)
          .filter_by(team_id=team_id, creative_id=creative_id)
          .delete()
    )
    if rows == 0:
        raise HTTPException(404, "assignment not found")
    db.commit()


@router.post("", status_code=201, dependencies=[Depends(require_writer)])
def create_assignment(
    team_id: str    = Query(..., description="team_id"),
    creative_id: str= Query(..., description="creative_id"),
    db: Session     = Depends(get_db),
):
    stmt = models.client_team_assignments.insert().values(
      team_id=team_id,
      creative_id=creative_id
    )
    try:
        db.execute(stmt)
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=400, detail="Assignment already exists or invalid IDs")
    return {"team_id": team_id, "creative_id": creative_id}