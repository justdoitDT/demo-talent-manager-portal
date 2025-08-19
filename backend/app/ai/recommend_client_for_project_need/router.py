# backend/app/ai/recommend_client_for_project_need/router.py

from fastapi import APIRouter, Depends, HTTPException, Body
from pydantic import BaseModel
from sqlalchemy.orm import Session
from sqlalchemy import text
from ...database import get_db
from .pipeline import run_pipeline
from .cache import get_latest_result
from app.ai.recommend_client_for_project_need.nightly import rebuild_client_embeddings
from ...auth_dep import require_team_or_higher, require_writer, require_admin

router = APIRouter(prefix="/ai/recommendations", tags=["AI Recs"])

# ───────────────────────────── Single-need endpoints ─────────────────────────────

@router.post("/needs/{need_id}/rank", dependencies=[Depends(require_writer)])
def rank_need(need_id: str, db: Session = Depends(get_db)):
    """Run the ranking pipeline for a single need and return the result payload."""
    return run_pipeline(db, need_id)

@router.get("/needs/{need_id}/latest", dependencies=[Depends(require_team_or_higher)])
def latest_need(need_id: str, db: Session = Depends(get_db)):
    """Return the most recently cached result for a need (404 if none)."""
    res = get_latest_result(db, need_id)
    if not res:
        raise HTTPException(404, "No cached result.")
    return res

@router.post("/embeddings/clients/rebuild", dependencies=[Depends(require_writer)])
def rebuild_clients(db: Session = Depends(get_db)):
    """Rebuild client (creative) embeddings."""
    rebuild_client_embeddings(db)
    return {"status": "ok"}


# ───────────────────────────── Backfill (batch) endpoint ─────────────────────────────

class BackfillRequest(BaseModel):
    tracking_statuses: list[str] = ["Active", "Priority Tracking", "Tracking"]
    limit: int = 50                      # how many needs to process this call
    dry_run: bool = False                # if True, don’t generate—just report
    reprocess_existing: bool = False     # if True, process even if rec exists


def _count_remaining(db: Session, ts: list[str], reprocess_existing: bool) -> int:
    """
    Count how many eligible needs remain, using raw SQL so we don't require a
    mapped model for `need_recommendations`. Cast enum -> text for comparison.
    """
    if reprocess_existing:
        sql = """
          SELECT COUNT(*)
          FROM project_needs n
          JOIN projects p ON p.id = n.project_id
          WHERE n.status = 'Active'
            AND p.tracking_status::text = ANY(:ts)
        """
        params = {"ts": ts}
    else:
        sql = """
          SELECT COUNT(*)
          FROM project_needs n
          JOIN projects p ON p.id = n.project_id
          LEFT JOIN need_recommendations r ON r.need_id = n.id
          WHERE n.status = 'Active'
            AND p.tracking_status::text = ANY(:ts)
            AND r.need_id IS NULL
        """
        params = {"ts": ts}

    return int(db.execute(text(sql), params).scalar() or 0)


@router.post("/backfill/needs", dependencies=[Depends(require_admin)])
def backfill_needs(
    payload: BackfillRequest = Body(default=None),
    db: Session = Depends(get_db),
):
    """
    Process a batch of eligible needs and return progress counts so the client
    can display “processed / remaining” updates.
    """
    if payload is None:
        payload = BackfillRequest()

    ts = payload.tracking_statuses

    # Remaining before this batch
    remaining_before = _count_remaining(db, ts, payload.reprocess_existing)

    # Nothing to do
    if remaining_before == 0:
        return {
            "summary": {
                "processed": 0,
                "generated": 0,
                "skipped": 0,
                "remaining_before": 0,
                "remaining_after": 0,
                "tracking_statuses": ts,
                "limit": payload.limit,
                "reprocess_existing": payload.reprocess_existing,
            },
            "needs": [],
            "errors": [],
        }

    # Batch select (raw SQL; enum -> text cast)
    if payload.reprocess_existing:
        select_sql = """
          SELECT n.id
          FROM project_needs n
          JOIN projects p ON p.id = n.project_id
          WHERE n.status = 'Active'
            AND p.tracking_status::text = ANY(:ts)
          ORDER BY n.id
          LIMIT :limit
        """
    else:
        select_sql = """
          SELECT n.id
          FROM project_needs n
          JOIN projects p ON p.id = n.project_id
          LEFT JOIN need_recommendations r ON r.need_id = n.id
          WHERE n.status = 'Active'
            AND p.tracking_status::text = ANY(:ts)
            AND r.need_id IS NULL
          ORDER BY n.id
          LIMIT :limit
        """
    need_ids = db.execute(
        text(select_sql),
        {"ts": ts, "limit": payload.limit},
    ).scalars().all()

    if payload.dry_run:
        return {
            "summary": {
                "processed": len(need_ids),
                "generated": 0,
                "skipped": 0,
                "remaining_before": remaining_before,
                "remaining_after": remaining_before,  # unchanged in dry-run
                "tracking_statuses": ts,
                "limit": payload.limit,
                "reprocess_existing": payload.reprocess_existing,
            },
            "needs": need_ids,
            "errors": [],
        }

    generated = 0
    errors: list[dict] = []

    for nid in need_ids:
        try:
            run_pipeline(db, nid)
            generated += 1
        except Exception as e:
            # Record error and continue
            errors.append({"need_id": nid, "error": str(e)})

    # Remaining after this batch
    if payload.reprocess_existing:
        remaining_after = max(0, remaining_before - generated)
    else:
        remaining_after = _count_remaining(db, ts, payload.reprocess_existing)

    return {
        "summary": {
            "processed": len(need_ids),
            "generated": generated,
            "skipped": len(need_ids) - generated,
            "remaining_before": remaining_before,
            "remaining_after": remaining_after,
            "tracking_statuses": ts,
            "limit": payload.limit,
            "reprocess_existing": payload.reprocess_existing,
        },
        "needs": need_ids,
        "errors": errors,
    }
