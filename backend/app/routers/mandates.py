# backend/app/routers/mandates.py

from fastapi import APIRouter, Depends, Query, HTTPException, Path, status
from sqlalchemy import select
from sqlalchemy.orm import Session
from typing import Dict, List, Set
from ..auth_dep import require_team_or_higher, require_writer, require_admin

from ..database import get_db
from .. import models, schemas

router = APIRouter(prefix="/mandates", tags=["Mandates"])


@router.get("", response_model=schemas.PagedMandates, dependencies=[Depends(require_team_or_higher)])
def list_mandates(
    company_id: str | None = Query(None),
    company_type: str | None = Query(None),
    status: str | None = Query("active"),
    q: str | None = Query(None),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
):
    qy = db.query(models.Mandate)
    if company_id:
        qy = qy.filter(models.Mandate.company_id == company_id)
    if company_type:
        qy = qy.filter(models.Mandate.company_type == company_type)
    if status and status != "all":
        qy = qy.filter(models.Mandate.status == status)
    if q:
        qy = qy.filter(models.Mandate.name.ilike(f"%{q}%"))

    total = qy.count()
    rows = (qy.order_by(models.Mandate.updated_at.desc())
              .limit(limit).offset(offset).all())
    return {"total": total, "items": rows}


@router.get("/{mandate_id}", response_model=schemas.MandateDetail, dependencies=[Depends(require_team_or_higher)])
def get_mandate(
    mandate_id: str = Path(...),
    db: Session = Depends(get_db),
):
    row = db.get(models.Mandate, mandate_id)
    if not row:
        raise HTTPException(404, "Mandate not found")
    return row


@router.patch("/{mandate_id}", response_model=schemas.MandateDetail, dependencies=[Depends(require_writer)])
def patch_mandate(
    mandate_id: str,
    payload: schemas.MandateUpdate,   # ← use the all-optional schema
    db: Session = Depends(get_db),
):
    row = db.get(models.Mandate, mandate_id)
    if not row:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Mandate not found")

    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(row, field, value)

    db.commit()
    db.refresh(row)
    return row


# add new mandate
@router.post(
    "",
    response_model=schemas.MandateDetail,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(require_writer)],
)
def create_mandate(payload: schemas.MandateCreate, db: Session = Depends(get_db)):
    row = models.Mandate(
        name=payload.name,
        description=payload.description,
        company_id=payload.company_id,
        company_type=payload.company_type,
        status="active",  # always active
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return row



# GET all subs linked to a mandate
@router.get("/{mandate_id}/subs", response_model=list[schemas.SubForMandate], dependencies=[Depends(require_team_or_higher)])
def list_subs_for_mandate(
    mandate_id: str = Path(..., description="MD_… id"),
    db: Session = Depends(get_db),
):
    # 0) Ensure mandate exists
    if not db.get(models.Mandate, mandate_id):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Mandate not found")

    # 1) Sub IDs via join table (snake_case Table -> use .c.<col>)
    sub_ids: list[str] = db.execute(
        select(models.sub_to_mandate.c.sub_id)
        .where(models.sub_to_mandate.c.mandate_id == mandate_id)
    ).scalars().all()
    if not sub_ids:
        return []

    # 2) Base subs (IMPORTANT: .unique() before .scalars() due to joined-eager rels)
    subs: list[models.Sub] = db.execute(
        select(models.Sub).where(models.Sub.id.in_(sub_ids))
    ).unique().scalars().all()

    # 3) Projects (id -> title)
    project_ids: Set[str] = {s.project_id for s in subs if getattr(s, "project_id", None)}
    proj_title: Dict[str, str] = {}
    if project_ids:
        for pr in db.execute(
            select(models.Project).where(models.Project.id.in_(project_ids))
        ).scalars().all():
            proj_title[pr.id] = pr.title

    # 4) Clients via sub_to_client → creatives (batched)
    clients_map: Dict[str, list[schemas.CreativeMini]] = {sid: [] for sid in sub_ids}
    for sub_id, creative in db.execute(
        select(models.sub_to_client.c.sub_id, models.Creative)
        .join(models.Creative, models.Creative.id == models.sub_to_client.c.creative_id)
        .where(models.sub_to_client.c.sub_id.in_(sub_ids))
    ).all():
        clients_map.setdefault(sub_id, []).append(
            schemas.CreativeMini.model_validate(creative)
        )

    # 5) Recipients via SubRecipient ORM (NOT a Table)
    rec_rows = db.execute(
        select(models.SubRecipient.sub_id, models.SubRecipient.recipient_id)
        .where(models.SubRecipient.sub_id.in_(sub_ids))
    ).all()

    exec_ids: Set[str] = set()
    xr_ids:   Set[str] = set()
    cr_ids:   Set[str] = set()
    for _, rid in rec_rows:
        if   rid.startswith("EX_"): exec_ids.add(rid)
        elif rid.startswith("XR_"): xr_ids.add(rid)
        elif rid.startswith("CR_"): cr_ids.add(rid)

    # lookup names for recipients
    exec_name: Dict[str, str] = {}
    if exec_ids:
        for ex in db.execute(
            select(models.Executive).where(models.Executive.id.in_(exec_ids))
        ).scalars().all():
            exec_name[ex.id] = ex.name

    xr_name: Dict[str, str] = {}
    if xr_ids:
        for xr in db.execute(
            select(models.ExternalTalentRep).where(models.ExternalTalentRep.id.in_(xr_ids))
        ).scalars().all():
            xr_name[xr.id] = xr.name

    cr_name: Dict[str, str] = {}
    if cr_ids:
        for cr in db.execute(
            select(models.Creative).where(models.Creative.id.in_(cr_ids))
        ).scalars().all():
            cr_name[cr.id] = cr.name

    recipients_map: Dict[str, list[schemas.RecipientMini]] = {sid: [] for sid in sub_ids}
    for sub_id, rid in rec_rows:
        if rid.startswith("EX_"):
            recipients_map[sub_id].append(
                schemas.RecipientMini(
                    id=rid, type="executive", name=exec_name.get(rid, "Executive"),
                    company_id=None, company_name=None
                )
            )
        elif rid.startswith("XR_"):
            recipients_map[sub_id].append(
                schemas.RecipientMini(
                    id=rid, type="external_rep", name=xr_name.get(rid, "External Rep"),
                    company_id=None, company_name=None
                )
            )
        elif rid.startswith("CR_"):
            recipients_map[sub_id].append(
                schemas.RecipientMini(
                    id=rid, type="creative", name=cr_name.get(rid, "Creative"),
                    company_id=None, company_name=None
                )
            )

    # 6) Feedback summary from SubFeedback model
    positive_subs: Set[str] = set()
    any_feedback_subs: Set[str] = set()
    for sid, sentiment in db.execute(
        select(models.SubFeedback.sub_id, models.SubFeedback.sentiment)
        .where(models.SubFeedback.sub_id.in_(sub_ids))
    ).all():
        if sentiment and str(sentiment).lower() == "positive":
            positive_subs.add(sid)
        any_feedback_subs.add(sid)

    def summarize_feedback(sub_id: str) -> str:
        if sub_id in positive_subs:
            return "positive"
        if sub_id in any_feedback_subs:
            return "not_positive"
        return "none"

    # 7) Build response
    out: list[schemas.SubForMandate] = []
    for s in subs:
        pid = getattr(s, "project_id", None)
        out.append(
            schemas.SubForMandate(
                id=s.id,
                project_id=pid,
                project_title=proj_title.get(pid) if pid else None,
                clients=clients_map.get(s.id, []),
                recipients=recipients_map.get(s.id, []),
                feedback=summarize_feedback(s.id),
                created_at=s.created_at,
                updated_at=s.updated_at,
            )
        )

    # newest first
    out.sort(key=lambda r: r.updated_at or r.created_at, reverse=True)
    return out