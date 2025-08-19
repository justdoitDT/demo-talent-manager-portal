# app/routers/subs.py

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import text
from sqlalchemy.orm import Session, joinedload
from sqlalchemy.exc import IntegrityError
from sqlalchemy.dialects.postgresql import insert as pg_insert

from typing import List, Optional, Literal, Tuple, Dict
from ..auth_dep import require_team_or_higher, require_writer, require_admin
from ..database import get_db
from .. import models, schemas


router = APIRouter(prefix="/subs", tags=["subs"])


# helpers
def _list_subs(
    db: Session,
    *,
    limit: int = 50,
    offset: int = 0,
    since_days: int | None = None,
    clients: Optional[List[str]] = None,
    executives: Optional[List[str]] = None,
    project_id: Optional[str] = None,         # exact match
    project_title: Optional[str] = None,      # ILIKE substring
    media_type: Optional[str] = None,
    intent: Optional[str] = None,
    company: Optional[str] = None,
    result: Optional[str] = None,
    feedback_filter: Optional[str] = None     # '', '0', 'positive', 'not_positive'
) -> Tuple[int, List[dict]]:
    """
    Query *sub_list_view* and return (total_count, rows).
    Either `project_id` **or** `project_title` may be supplied.
    Each row is returned as a plain dict via SQLAlchemy `.mappings()`.
    """
    # ------------------------------------------------------------------
    # 0) WHERE-clause builder
    # ------------------------------------------------------------------
    where: list[str] = []
    params: dict[str, object] = {}

    # rolling window only if caller supplied a value
    if since_days is not None:
        where.append("updated_at >= now() - (:since * interval '1 day')")
        params["since"] = since_days

    def add(clause: str, **kv: object) -> None:
        where.append(clause)
        params.update(kv)

    # ------------------------------------------------------------------
    # 1) Filters supplied by caller
    # ------------------------------------------------------------------
    if clients:
        # ILIKE ANY expects patterns; wrap each term in %...%
        patterns = [f"%{c}%" for c in clients]
        add("clients ILIKE ANY(:clients)", clients=patterns)

    if executives:
        patterns = [f"%{e}%" for e in executives]
        add("executives ILIKE ANY(:executives)", executives=patterns)

    if project_id:
        add("project_id = :project_id", project_id=project_id)
    elif project_title:
        add("project_title ILIKE :project_title", project_title=f"%{project_title}%")

    if media_type:
        add("media_type = :media_type", media_type=media_type)

    if intent:
        add("intent_primary = :intent", intent=intent)

    if company:
        add("recipient_company ILIKE :company", company=f"%{company}%")

    if result:
        add("result = :result", result=result)

    # --- feedback filter ------------------------------------------------
    #   '' | None       → no extra clause (Any)
    #   '0'             → feedback_count = 0
    #   'positive'      → has_positive = TRUE
    #   'not_positive'  → feedback_count > 0 AND has_positive = FALSE
    if feedback_filter == "0":
        add("feedback_count = 0")
    elif feedback_filter == "positive":
        add("has_positive = true")
    elif feedback_filter == "not_positive":
        add("feedback_count > 0 AND has_positive = false")

    # ------------------------------------------------------------------
    # 2) Compose SQL
    # ------------------------------------------------------------------
    where_sql = " AND ".join(where)
    base_sql = f"FROM sub_list_view WHERE {where_sql}"

    # ------------------------------------------------------------------
    # 3) Execute COUNT and page query
    # ------------------------------------------------------------------
    total: int = db.execute(
        text(f"SELECT COUNT(*) {base_sql}"),
        params,
    ).scalar_one()

    raw_rows = (
        db.execute(
            text(
                f"""
                SELECT *
                {base_sql}
                ORDER BY updated_at DESC
                LIMIT :limit OFFSET :offset
                """
            ),
            {**params, "limit": limit, "offset": offset},
        )
        .mappings()
        .all()
    )

    # Ensure `created_at` exists for response validation.
    rows: List[dict] = []
    for m in raw_rows:
        d = dict(m)
        # If sub_list_view doesn't expose created_at, fall back to updated_at
        if "created_at" not in d or d["created_at"] is None:
            d["created_at"] = d.get("updated_at")
        rows.append(d)

    return total, rows


def _mk_recipient_mini(db: Session, r: models.SubRecipient) -> schemas.RecipientMini:
    # ── 1. look up the person’s name by type ──────────────────────────
    if r.recipient_type == "executive":
        person_name = db.query(models.Executive.name) \
                        .filter(models.Executive.id == r.recipient_id) \
                        .scalar()
    elif r.recipient_type == "external_rep":
        person_name = db.query(models.ExternalTalentRep.name) \
                        .filter(models.ExternalTalentRep.id == r.recipient_id) \
                        .scalar()
    elif r.recipient_type == "creative":                         # ← NEW branch
        person_name = db.query(models.Creative.name) \
                        .filter(models.Creative.id == r.recipient_id) \
                        .scalar()
    else:                                                        # safety fallback
        person_name = None
    # ── 2. resolve company (exec only) ──
    company_name: str | None = None
    if r.recipient_company:
        prefix = r.recipient_company[:2]          # 'NW‘ | 'ST' | 'PC'
        table = {
            "NW": models.TVNetwork,
            "ST": models.Studio,
            "PC": models.ProductionCompany,
        }.get(prefix)
        if table:
            company_name = db.query(table.name)\
                             .filter(table.id == r.recipient_company)\
                             .scalar()
    return schemas.RecipientMini(
        id            = r.recipient_id,
        type          = r.recipient_type,         # 'executive' | 'external_rep' | 'creative'
        name          = person_name or r.recipient_id,
        company_id    = r.recipient_company,      # stays for reference
        company_name  = company_name,             # ← add this
    )

def _mk_project_need_mini(pn: models.ProjectNeed | None) -> schemas.ProjectNeedMini | None:
    if not pn:
        return None
    return schemas.ProjectNeedMini.model_validate(pn)

def _mk_mandate_mini(m: models.Mandate) -> schemas.MandateMini:
    return schemas.MandateMini.model_validate(m)

def _get_sub(db: Session, sub_id: str) -> schemas.SubDetail | None:
    s: models.Sub | None = (
        db.query(models.Sub)
          .options(
              joinedload(models.Sub.project),
              joinedload(models.Sub.project_need),
              joinedload(models.Sub.clients),
              joinedload(models.Sub.originators),
              joinedload(models.Sub.recipients),
              joinedload(models.Sub.writing_samples),
              joinedload(models.Sub.feedback),
              joinedload(models.Sub.mandates),
          )
          .filter(models.Sub.id == sub_id)
          .first()
    )
    if not s:
        return None
    return schemas.SubDetail(
        id             = s.id,
        project        = s.project,
        intent_primary = s.intent_primary,
        project_need   = _mk_project_need_mini(s.project_need),
        result         = s.result,
        created_at     = s.created_at,
        updated_at     = s.updated_at,
        created_by = (schemas.ManagerMini.model_validate({
                "id":   s.creator.id,
                "name": s.creator.name,
            }) if s.creator else None),
        clients        = [schemas.CreativeMini.model_validate(c) for c in s.clients],
        originators    = [schemas.ManagerMini.model_validate(m) for m in s.originators],
        recipients     = [_mk_recipient_mini(db, r)             for r in s.recipients],
        writing_samples= [schemas.WritingSampleBase.model_validate(ws) for ws in s.writing_samples],
        feedback       = [schemas.SubFeedbackMini.model_validate(f)    for f in s.feedback],
        mandates       = [_mk_mandate_mini(m) for m in s.mandates],
    )


# ────────────────────────────────────────────────────────────────
#  Pydantic helpers for create / join‑table endpoints
# ────────────────────────────────────────────────────────────────
class _RecipientIn(schemas.BaseModel):
    recipient_type: Literal["executive", "external_rep", "creative"]
    recipient_id:   str
    recipient_company: Optional[str] = None

class SubCreate(schemas.BaseModel):
    # core columns
    project_id:        str
    intent_primary:    Optional[str] = None
    project_need_id:   Optional[str] = None
    result:            Optional[str] = None
    created_by:        str = "TM_00011"    # replace with session user when ready

    # join‑table payloads (all optional)
    client_ids:         List[str]          = []
    originator_ids:     List[str]          = []   # team IDs
    recipient_rows:     List[_RecipientIn] = []
    mandate_ids:        List[str]          = []
    writing_sample_ids: List[str]          = []

class JoinIds(schemas.BaseModel):
    ids: List[str]

# ────────────────────────────────────────────────────────────────
#  LIST / DETAIL / UPDATE / DELETE
# ────────────────────────────────────────────────────────────────
@router.get("", response_model=schemas.PagedSubs, dependencies=[Depends(require_team_or_higher)])
def list_subs(
    limit: int  = 50,
    offset: int = 0,
    since_days: int | None = None,

    # query‑string filters
    client:     Optional[list[str]] = None,
    executives: Optional[list[str]] = None,
    project:    Optional[str]       = None,   # ← project *title* search
    project_id: Optional[str]       = None,   # ← exact project_id (optional)
    media_type: Optional[str]       = None,
    intent:     Optional[str]       = None,
    company:    Optional[str]       = None,
    result:     Optional[str]       = None,
    feedback:   Optional[str]       = None,   # '0' | '1+'
    db: Session = Depends(get_db),
):
    """
    Generic /subs listing endpoint.
    - `project_id` filters exact, `project` does a title ILIKE.
    - All args are optional.
    """
    total, rows = _list_subs(
        db,
        limit=limit,
        offset=offset,
        since_days=since_days,
        clients=client,
        executives=executives,
        project_id=project_id,
        project_title=project,
        media_type=media_type,
        intent=intent,
        company=company,
        result=result,
        feedback_filter=feedback,
    )
    return {"total": total, "items": rows}


@router.get("/{sub_id}", response_model=schemas.SubDetail, dependencies=[Depends(require_team_or_higher)])
def get_sub(sub_id: str, db: Session = Depends(get_db)):
    sub = _get_sub(db, sub_id)
    if not sub:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Sub not found")
    return sub


@router.patch("/{sub_id}", response_model=schemas.SubDetail, dependencies=[Depends(require_writer)])
def patch_sub(sub_id: str, patch: schemas.SubUpdate, db: Session = Depends(get_db)):
    s = db.query(models.Sub).filter(models.Sub.id == sub_id).first()
    if not s:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Sub not found")

    # for fld in ("result", "intent_primary", "project_need_id"):
    #     val = getattr(patch, fld)
    #     if val is not None:
    #         setattr(s, fld, val)

    for fld, val in patch.model_dump(exclude_unset=True).items():
        setattr(s, fld, val)

    db.commit()
    db.refresh(s)
    return _get_sub(db, sub_id)


@router.delete("/{sub_id}", status_code=204, dependencies=[Depends(require_writer)])
def delete_sub(sub_id: str, db: Session = Depends(get_db)):
    deleted = db.query(models.Sub).filter(models.Sub.id == sub_id).delete()
    if not deleted:
        raise HTTPException(404, "Sub not found")
    db.commit()

# ────────────────────────────────────────────────────────────────
#  CREATE  (core + optional join rows)
# ────────────────────────────────────────────────────────────────
@router.post("", response_model=schemas.SubDetail, status_code=201, dependencies=[Depends(require_writer)])
def create_sub(body: schemas.SubCreate, db: Session = Depends(get_db)):
    """
    1) insert into `subs`
    2) de‑duplicate each list
    3) bulk‑insert every join table with SQLAlchemy Core
    """
    # ------------------------------------------------------------------ 1
    sub_row = models.Sub(
        project_id      = body.project_id,
        intent_primary  = body.intent_primary,
        project_need_id = body.project_need_id,
        result          = body.result or "no_response",
        # created_by      = body.created_by,
        created_by      = "TM_00011",
    )
    db.add(sub_row)
    db.flush()                    # sub_row.id populated
    sid = sub_row.id

    # ------------------------------------------------------------------ 2
    body.client_ids         = list(dict.fromkeys(body.client_ids))
    body.originator_ids     = list(dict.fromkeys(body.originator_ids))
    body.writing_sample_ids = list(dict.fromkeys(body.writing_sample_ids))
    body.mandate_ids        = list(dict.fromkeys(body.mandate_ids))

    uniq_recips: list[schemas._RecipientIn] = []
    seen_r = set()
    for r in body.recipient_rows:
        key = (r.recipient_type, r.recipient_id)
        if key not in seen_r:
            seen_r.add(key)
            uniq_recips.append(r)
    body.recipient_rows = uniq_recips

    # ------------------------------------------------------------------ 3
    if body.client_ids:
        db.execute(
            models.sub_to_client.insert().values(
                [{"sub_id": sid, "creative_id": cid} for cid in body.client_ids]
            )
        )

    if body.originator_ids:
        db.execute(
            models.sub_to_team.insert().values(
                [{"sub_id": sid, "team_id": tid} for tid in body.originator_ids]
            )
        )

    if body.recipient_rows:
        db.execute(
            models.SubRecipient.__table__.insert().values(
                [
                    {
                        "sub_id":            sid,
                        "recipient_type":    r.recipient_type,
                        "recipient_id":      r.recipient_id,
                        "recipient_company": None,
                    }
                    for r in body.recipient_rows
                ]
            )
        )

    if body.mandate_ids:
        db.execute(
            pg_insert(models.sub_to_mandate)
            .values([{"sub_id": sid, "mandate_id": mid} for mid in body.mandate_ids])
            .on_conflict_do_nothing()
        )

    if body.writing_sample_ids:
        db.execute(
            models.sub_to_writing_sample.insert().values(
                [
                    {"sub_id": sid, "writing_sample_id": ws}
                    for ws in body.writing_sample_ids
                ]
            )
        )

    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(400, f"Integrity error: {exc.orig}") from exc

    return _get_sub(db, sid)

# ────────────────────────────────────────────────────────────────
#  CLIENTS  (sub_to_client)
# ────────────────────────────────────────────────────────────────
@router.post("/{sub_id}/clients", status_code=204, dependencies=[Depends(require_writer)])
def add_clients(sub_id: str, body: JoinIds, db: Session = Depends(get_db)):
    db.execute(
        pg_insert(models.sub_to_client)
        .values([{"sub_id": sub_id, "creative_id": cid} for cid in body.ids])
        .on_conflict_do_nothing()
    )
    db.commit()

@router.delete("/{sub_id}/clients/{creative_id}", status_code=204, dependencies=[Depends(require_writer)])
def remove_client(sub_id: str, creative_id: str, db: Session = Depends(get_db)):
    db.execute(
        models.sub_to_client.delete().where(
            models.sub_to_client.c.sub_id == sub_id,
            models.sub_to_client.c.creative_id == creative_id,
        )
    )
    db.commit()

# ------------------------------------------------------------------
#  TEAM  (sub_to_team)
# ------------------------------------------------------------------
@router.post("/{sub_id}/teams", status_code=204, dependencies=[Depends(require_writer)])
def add_teams(sub_id: str, body: JoinIds, db: Session = Depends(get_db)):
    db.execute(
        pg_insert(models.sub_to_team)
        .values([{"sub_id": sub_id, "team_id": tid} for tid in body.ids])
        .on_conflict_do_nothing()
    )
    db.commit()

@router.delete("/{sub_id}/teams/{team_id}", status_code=204, dependencies=[Depends(require_writer)])
def remove_team(sub_id: str, team_id: str, db: Session = Depends(get_db)):
    db.execute(
        models.sub_to_team.delete().where(
            models.sub_to_team.c.sub_id == sub_id,
            models.sub_to_team.c.team_id == team_id,
        )
    )
    db.commit()

# ────────────────────────────────────────────────────────────────
#  WRITING SAMPLES  (sub_to_writing_sample)
# ────────────────────────────────────────────────────────────────
@router.post("/{sub_id}/writing_samples", status_code=204, dependencies=[Depends(require_writer)])
def add_writing_samples(sub_id: str, body: JoinIds, db: Session = Depends(get_db)):
    db.execute(
        pg_insert(models.sub_to_writing_sample)
        .values([{"sub_id": sub_id, "writing_sample_id": ws} for ws in body.ids])
        .on_conflict_do_nothing()
    )
    db.commit()

@router.delete("/{sub_id}/writing_samples/{ws_id}", status_code=204, dependencies=[Depends(require_writer)])
def remove_writing_sample(sub_id: str, ws_id: str, db: Session = Depends(get_db)):
    db.execute(
        models.sub_to_writing_sample.delete().where(
            models.sub_to_writing_sample.c.sub_id == sub_id,
            models.sub_to_writing_sample.c.writing_sample_id == ws_id,
        )
    )
    db.commit()

# ────────────────────────────────────────────────────────────────
#  MANDATES  (sub_to_mandate)
# ────────────────────────────────────────────────────────────────
@router.post("/{sub_id}/mandates", status_code=204, dependencies=[Depends(require_writer)])
def add_mandates(sub_id: str, body: JoinIds, db: Session = Depends(get_db)):
    db.execute(
        pg_insert(models.sub_to_mandate)
        .values([{"sub_id": sub_id, "mandate_id": mid} for mid in body.ids])
        .on_conflict_do_nothing()
    )
    db.commit()

@router.delete("/{sub_id}/mandates/{mandate_id}", status_code=204, dependencies=[Depends(require_writer)])
def remove_mandate(sub_id: str, mandate_id: str, db: Session = Depends(get_db)):
    db.execute(
        models.sub_to_mandate.delete().where(
            models.sub_to_mandate.c.sub_id == sub_id,
            models.sub_to_mandate.c.mandate_id == mandate_id,
        )
    )
    db.commit()

# ────────────────────────────────────────────────────────────────
#  RECIPIENTS  (sub_recipients)
# ────────────────────────────────────────────────────────────────
class RecipientAddBody(_RecipientIn): pass

@router.post("/{sub_id}/recipients", status_code=204, dependencies=[Depends(require_writer)])
def add_recipient(sub_id: str, body: RecipientAddBody, db: Session = Depends(get_db)):
    db.execute(
        pg_insert(models.SubRecipient.__table__)
        .values(
            sub_id=sub_id,
            recipient_type=body.recipient_type,
            recipient_id=body.recipient_id,
            recipient_company=None,
        )
        .on_conflict_do_nothing()
    )
    db.commit()

@router.delete("/{sub_id}/recipients/{recipient_type}/{recipient_id}", status_code=204, dependencies=[Depends(require_writer)])
def remove_recipient(
    sub_id: str,
    recipient_type: Literal["executive", "external_rep", "creative"],
    recipient_id: str,
    db: Session = Depends(get_db),
):
    db.query(models.SubRecipient).filter_by(
        sub_id=sub_id,
        recipient_type=recipient_type,
        recipient_id=recipient_id,
    ).delete()
    db.commit()

# ────────────────────────────────────────────────────────────────
#  FEEDBACK  (sub_feedback)
# ────────────────────────────────────────────────────────────────
@router.post(
    "/{sub_id}/feedback",
    response_model=schemas.SubFeedbackMini,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(require_writer)]
)
def create_feedback(
    sub_id: str,
    fb: schemas.SubFeedbackUpdate,
    db: Session = Depends(get_db),
):
    if sub_id != fb.sub_id:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "sub_id mismatch")

    # ---------- Phase 1 – raw INSERT + RETURNING id,created_at -----
    stmt = text(
        """
        INSERT INTO sub_feedback
            (sub_id, source_type, source_id,
             sentiment, feedback_text, actionable_next,
             created_by_team_id)
        VALUES
            (:sub_id, :source_type, :source_id,
             :sentiment, :feedback_text, :actionable_next,
             :team_id)
        RETURNING id, created_at
        """
    )
    values = dict(
        sub_id=sub_id,
        source_type=fb.source_type,
        source_id=fb.source_id,
        sentiment=fb.sentiment,
        feedback_text=fb.feedback_text,
        actionable_next=fb.actionable_next,
        team_id="TM_00011",           # TODO: replace w/ auth user’s team
    )

    try:
        row = db.execute(stmt, values).first()
    except IntegrityError as e:
        raise HTTPException(400, f"Integrity error: {e.orig}") from e

    if not row:
        raise HTTPException(500, "Failed to create feedback row")

    fb_id, created_at = row.id, row.created_at
    db.commit()

    # --------- Phase 2 – build the response object ----------------
    return schemas.SubFeedbackMini(
        id=fb_id,
        sentiment=fb.sentiment,
        feedback_text=fb.feedback_text,
        actionable_next=fb.actionable_next,
        created_at=created_at,
        source_type=fb.source_type,
        source_id=fb.source_id,
    )


@router.patch(
    "/feedback/{fb_id}",
    response_model=schemas.SubFeedbackMini,
    status_code=200,
    dependencies=[Depends(require_writer)]
)
def patch_feedback(
    fb_id: str,
    patch: schemas.SubFeedbackPatch,
    db: Session = Depends(get_db),
):
    stmt = text(
        """
        UPDATE sub_feedback
        SET
          sentiment       = COALESCE(:sentiment, sentiment),
          feedback_text   = COALESCE(:feedback_text, feedback_text),
          actionable_next = COALESCE(:actionable_next, actionable_next)
        WHERE id = :fb_id
        RETURNING id, sub_id, source_type, source_id,
                  sentiment, feedback_text, actionable_next, created_at
        """
    )

    row = db.execute(
        stmt,
        {
            "fb_id": fb_id,
            "sentiment": patch.sentiment,
            "feedback_text": patch.feedback_text,
            "actionable_next": patch.actionable_next,
        },
    ).first()

    if not row:
        raise HTTPException(404, "Feedback row not found")

    db.commit()
    return schemas.SubFeedbackMini.model_validate(row._mapping)


@router.delete("/feedback/{fb_id}", status_code=status.HTTP_204_NO_CONTENT, dependencies=[Depends(require_writer)])
def delete_feedback(fb_id: str, db: Session = Depends(get_db)):
    deleted = (
        db.execute(text("DELETE FROM sub_feedback WHERE id = :id"), {"id": fb_id})
        .rowcount
    )
    if not deleted:
        raise HTTPException(404, "row not found")
    db.commit()