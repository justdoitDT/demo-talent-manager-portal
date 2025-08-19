# backend/app/ai/recommend_client_for_project_need/backfill.py

from fastapi import APIRouter, Depends, Body, BackgroundTasks
from sqlalchemy import select, Table, MetaData
from sqlalchemy.orm import Session
from ...database import get_db, SessionLocal
from ... import models
from .pipeline import run_pipeline
from ...auth_dep import require_admin  # or require_writer if you prefer


router = APIRouter(prefix="/ai/recommendations", tags=["AI Recs (automation)"])

def _fetch_eligible_need_ids(
    db: Session,
    statuses: list[str],
    limit: int
) -> list[str]:
    """
    Needs whose parent projects have tracking_status in `statuses`
    and DO NOT yet have a row in need_recommendations.
    """
    meta = MetaData()
    # reflect the existing cache table used by your `get_latest_result`
    need_recs = Table("need_recommendations", meta, autoload_with=db.bind)

    q = (
        select(models.ProjectNeed.id)
        .join(models.Project, models.Project.id == models.ProjectNeed.project_id)
        .join(need_recs, need_recs.c.need_id == models.ProjectNeed.id, isouter=True)
        .where(models.Project.tracking_status.in_(statuses))
        .where(need_recs.c.need_id.is_(None))
        .limit(limit)
    )
    return [r[0] for r in db.execute(q).all()]

def _run_backfill_task(need_ids: list[str]) -> None:
    """Executes outside the request lifecycle (background task)."""
    with SessionLocal() as db:
        for nid in need_ids:
            try:
                # Your pipeline should compute + persist (same as POST /needs/{id}/rank)
                run_pipeline(db, nid)
                db.commit()
            except Exception:
                db.rollback()
                # TODO: log the error (left minimal on purpose)

@router.get("/needs/backfill/preview", dependencies=[Depends(require_admin)])
def preview_backfill(
    statuses: list[str] = ["Active", "Priority Tracking", "Tracking"],
    limit: int = 500,
    db: Session = Depends(get_db),
):
    ids = _fetch_eligible_need_ids(db, statuses, limit)
    return {"count": len(ids), "need_ids": ids, "statuses": statuses, "limit": limit}

@router.post("/needs/backfill", status_code=202, dependencies=[Depends(require_admin)])
def start_backfill(
    background: BackgroundTasks,
    statuses: list[str] = Body(default=["Active", "Priority Tracking", "Tracking"]),
    limit: int = Body(default=500, ge=1, le=5000),
    db: Session = Depends(get_db),
):
    ids = _fetch_eligible_need_ids(db, statuses, limit)
    if ids:
        background.add_task(_run_backfill_task, ids)
    return {"enqueued": len(ids), "need_ids": ids, "statuses": statuses, "limit": limit}
