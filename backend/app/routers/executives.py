# backend/app/routers/executives.py

from fastapi import APIRouter, Depends, HTTPException, Query, Path, Body
from sqlalchemy import select, literal, union_all, func, update, and_, delete
from sqlalchemy.orm import Session, joinedload
from sqlalchemy.dialects.postgresql import insert as pg_insert
from typing import Optional
from ..auth_dep import require_team_or_higher, require_writer, require_admin

from app.database import get_db
from app import models, schemas


router = APIRouter(prefix="/executives", tags=["executives"])


# ── Get list of executives at a given TV Network or Studio or Production Company ────────
@router.get("/company/{company_id}", response_model=list[schemas.Executive], dependencies=[Depends(require_team_or_higher)])
def execs_by_company(
    company_id: str = Path(...,
        description="ID that starts with NW_, ST_ or PC_"),
    db: Session = Depends(get_db),
):
    tables = {
        "NW_": (models.executives_to_tv_networks,
                models.executives_to_tv_networks.c.network_id),
        "ST_": (models.executives_to_studios,
                models.executives_to_studios.c.studio_id),
        "PC_": (models.executives_to_production_companies,
                models.executives_to_production_companies.c.production_company_id),
    }

    for prefix, (Link, fk_col) in tables.items():
        if company_id.startswith(prefix):
            break
    else:
        raise HTTPException(400, "Unknown company prefix")

    return (db.query(models.Executive)
              .join(Link, Link.c.executive_id == models.Executive.id)
              .filter(fk_col == company_id)
              .filter(Link.c.status == "Active")
              .order_by(models.Executive.name)
              .all())




# ── Create ───────────────────────────────────────────────────────────────────
@router.post("", response_model=schemas.Executive, status_code=201, dependencies=[Depends(require_writer)])
def create_exec(ex: schemas.ExecutiveCreate, db: Session = Depends(get_db)):
    """Insert a brand‑new executive and link to ONE company."""
    company_models = {
        'network': models.TVNetwork,
        'studio':  models.Studio,
        'prodco':  models.ProductionCompany,
    }
    Model = company_models[ex.company_type]         # Literal guarantees key
    if not db.get(Model, ex.company_id):
        raise HTTPException(400, "Invalid company_id")

    exec_row = models.Executive(
        name  = ex.name,
        email = ex.email,
        phone = ex.phone,
    )
    db.add(exec_row)
    db.flush()                      # → exec_row.id is available

    link_tables = {
        'network': models.executives_to_tv_networks,
        'studio':  models.executives_to_studios,
        'prodco':  models.executives_to_production_companies,
    }
    Link        = link_tables[ex.company_type]
    fk_name     = [c.name for c in Link.c if c.name.endswith('_id') and c.name != 'executive_id'][0]

    db.execute(Link.insert().values(
        executive_id = exec_row.id,
        **{fk_name: ex.company_id},
        status = "Active",
    ))
    db.commit()
    db.refresh(exec_row)
    return exec_row

# ── Read (list) ──────────────────────────────────────────────────────────────
@router.get("", response_model=list[schemas.Executive], dependencies=[Depends(require_team_or_higher)])
def list_execs(limit: int = 50, offset: int = 0, db: Session = Depends(get_db)):
    return (db.query(models.Executive)
              .order_by(models.Executive.name)
              .offset(offset).limit(limit).all())


@router.get("/flat", response_model=schemas.PagedExecutives, dependencies=[Depends(require_team_or_higher)])
def list_executives_flat(
    q: str | None = Query(None, description="Search name/company"),
    company_type: str | None = Query(None, pattern="^(tv_network|studio|production_company)$"),
    company_id: str | None = Query(None),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
):
    # --- Build a UNION of active company links with names ---
    nw = (
        select(
            models.executives_to_tv_networks.c.executive_id.label("executive_id"),
            models.executives_to_tv_networks.c.network_id.label("company_id"),
            literal("tv_network").label("company_type"),
            models.TVNetwork.name.label("company_name"),
        )
        .select_from(
            models.executives_to_tv_networks.join(
                models.TVNetwork,
                models.executives_to_tv_networks.c.network_id == models.TVNetwork.id,
            )
        )
        .where(models.executives_to_tv_networks.c.status == "Active")
    )
    st = (
        select(
            models.executives_to_studios.c.executive_id.label("executive_id"),
            models.executives_to_studios.c.studio_id.label("company_id"),
            literal("studio").label("company_type"),
            models.Studio.name.label("company_name"),
        )
        .select_from(
            models.executives_to_studios.join(
                models.Studio,
                models.executives_to_studios.c.studio_id == models.Studio.id,
            )
        )
        .where(models.executives_to_studios.c.status == "Active")
    )
    pc = (
        select(
            models.executives_to_production_companies.c.executive_id.label("executive_id"),
            models.executives_to_production_companies.c.production_company_id.label("company_id"),
            literal("production_company").label("company_type"),
            models.ProductionCompany.name.label("company_name"),
        )
        .select_from(
            models.executives_to_production_companies.join(
                models.ProductionCompany,
                models.executives_to_production_companies.c.production_company_id == models.ProductionCompany.id,
            )
        )
        .where(models.executives_to_production_companies.c.status == "Active")
    )

    active_union = union_all(nw, st, pc).subquery("active_company")

    # --- Base query: ALL executives LEFT JOIN active_company ---
    base = (
        select(
            models.Executive.id.label("executive_id"),
            models.Executive.name.label("executive_name"),
            active_union.c.company_id,
            active_union.c.company_type,
            active_union.c.company_name,
        )
        # key change ↓↓↓
        .select_from(models.Executive)
        .join(active_union, models.Executive.id == active_union.c.executive_id, isouter=True)
    )

    # --- Filters ---
    if company_type:
        base = base.where(active_union.c.company_type == company_type)
    if company_id:
        base = base.where(active_union.c.company_id == company_id)
    if q:
        like = f"%{q}%"
        base = base.where(
            (models.Executive.name.ilike(like)) |
            (active_union.c.company_name.ilike(like))
        )

    # --- Total ---
    count_q = select(func.count()).select_from(base.subquery())
    total = db.execute(count_q).scalar() or 0

    # --- Page + order ---
    # If you're on Postgres, .nulls_last() is fine; on SQLite, drop it.
    page_q = (
        base
        .order_by(
            models.Executive.name.asc(),
            active_union.c.company_name.asc()  # remove .nulls_last() if SQLite
        )
        .limit(limit)
        .offset(offset)
    )

    rows = db.execute(page_q).all()

    items = [
        schemas.ExecutiveListRow(
            executive_id   = r.executive_id,
            executive_name = r.executive_name,
            company_id     = r.company_id,
            company_name   = r.company_name,
            company_type   = r.company_type,
        )
        for r in rows
    ]
    return {"total": total, "items": items}




# get list of companies that exec is linked to
@router.get("/agg", response_model=schemas.PagedExecutivesAgg, dependencies=[Depends(require_team_or_higher)])
def list_executives_agg(
    q: str | None = Query(None),
    company_type: str | None = Query(None, pattern="^(tv_network|studio|production_company)$"),
    company_id: str | None = Query(None),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
):
    # active links (same as your /flat parts)
    nw = (select(
            models.executives_to_tv_networks.c.executive_id,
            models.executives_to_tv_networks.c.network_id.label("company_id"),
            literal("tv_network").label("company_type"),
            models.TVNetwork.name.label("company_name"),
         )
         .select_from(models.executives_to_tv_networks.join(
             models.TVNetwork, models.executives_to_tv_networks.c.network_id == models.TVNetwork.id))
         .where(models.executives_to_tv_networks.c.status == "Active"))

    st = (select(
            models.executives_to_studios.c.executive_id,
            models.executives_to_studios.c.studio_id.label("company_id"),
            literal("studio").label("company_type"),
            models.Studio.name.label("company_name"),
         )
         .select_from(models.executives_to_studios.join(
             models.Studio, models.executives_to_studios.c.studio_id == models.Studio.id))
         .where(models.executives_to_studios.c.status == "Active"))

    pc = (select(
            models.executives_to_production_companies.c.executive_id,
            models.executives_to_production_companies.c.production_company_id.label("company_id"),
            literal("production_company").label("company_type"),
            models.ProductionCompany.name.label("company_name"),
         )
         .select_from(models.executives_to_production_companies.join(
             models.ProductionCompany, models.executives_to_production_companies.c.production_company_id == models.ProductionCompany.id))
         .where(models.executives_to_production_companies.c.status == "Active"))

    active_union = union_all(nw, st, pc).subquery("active_company")

    # base LEFT JOIN so execs with no companies still show up (unless filtered by type/id)
    base = (select(
                models.Executive.id.label("executive_id"),
                models.Executive.name.label("executive_name"),
                active_union.c.company_id,
                active_union.c.company_type,
                active_union.c.company_name,
            )
            .select_from(models.Executive)
            .join(active_union, models.Executive.id == active_union.c.executive_id, isouter=True))

    if company_type:
        base = base.where(active_union.c.company_type == company_type)
    if company_id:
        base = base.where(active_union.c.company_id == company_id)
    if q:
        like = f"%{q}%"
        base = base.where(
            (models.Executive.name.ilike(like)) |
            (active_union.c.company_name.ilike(like))
        )

    b = base.subquery("b")

    agg = (select(
                b.c.executive_id,
                b.c.executive_name,
                func.array_remove(func.array_agg(func.distinct(b.c.company_id)),   None).label("company_ids"),
                func.array_remove(func.array_agg(func.distinct(b.c.company_name)), None).label("company_names"),
                func.array_remove(func.array_agg(func.distinct(b.c.company_type)), None).label("company_types"),
           )
           .group_by(b.c.executive_id, b.c.executive_name))

    total = db.execute(select(func.count(func.distinct(b.c.executive_id)))).scalar() or 0

    rows = db.execute(
        agg.order_by(b.c.executive_name.asc()).limit(limit).offset(offset)
    ).all()

    items = [
        schemas.ExecutiveAggListRow(
            executive_id=r.executive_id,
            executive_name=r.executive_name,
            company_ids=r.company_ids or [],
            company_names=r.company_names or [],
            company_types=r.company_types or [],
        )
        for r in rows
    ]
    return {"total": total, "items": items}






# ── Read (single) ────────────────────────────────────────────────────────────
@router.get("/{exec_id}", response_model=schemas.Executive, dependencies=[Depends(require_team_or_higher)])
def get_exec(exec_id: str, db: Session = Depends(get_db)):
    row = (
        db.query(models.Executive)
          .options(
              joinedload(models.Executive.tv_networks),
              joinedload(models.Executive.studios),
              joinedload(models.Executive.production_companies),
          )
          .get(exec_id)
    )
    if not row:
        raise HTTPException(404, "Executive not found")
    return row


# ── Update (single) ────────────────────────────────────────────────────────────
@router.patch("/{exec_id}", response_model=schemas.Executive, dependencies=[Depends(require_writer)])
def patch_exec(exec_id: str, patch: schemas.ExecutivePatch, db: Session = Depends(get_db)):
    row = db.query(models.Executive).filter(models.Executive.id == exec_id).first()
    if not row:
        raise HTTPException(404, "Executive not found")

    data = patch.model_dump(exclude_unset=True)
    for k, v in data.items():
        setattr(row, k, v)

    db.commit()
    db.refresh(row)
    # include related companies if you like; response model is schemas.Executive
    return row



# GET companies for a given executive
@router.get("/{exec_id}/companies", response_model=schemas.ExecCompaniesResponse, dependencies=[Depends(require_team_or_higher)])
def get_exec_companies(exec_id: str, db: Session = Depends(get_db)):
    # Build three selects with a common shape
    nw = (
        select(
            models.executives_to_tv_networks.c.network_id.label("company_id"),
            models.TVNetwork.name.label("company_name"),
            literal("tv_network").label("company_type"),
            models.executives_to_tv_networks.c.status.label("status"),
            models.executives_to_tv_networks.c.last_modified.label("last_modified"),
            models.executives_to_tv_networks.c.title.label("title"),
        )
        .select_from(
            models.executives_to_tv_networks.join(
                models.TVNetwork,
                models.executives_to_tv_networks.c.network_id == models.TVNetwork.id,
            )
        )
        .where(models.executives_to_tv_networks.c.executive_id == exec_id)
    )

    st = (
        select(
            models.executives_to_studios.c.studio_id.label("company_id"),
            models.Studio.name.label("company_name"),
            literal("studio").label("company_type"),
            models.executives_to_studios.c.status.label("status"),
            models.executives_to_studios.c.last_modified.label("last_modified"),
            models.executives_to_studios.c.title.label("title"),
        )
        .select_from(
            models.executives_to_studios.join(
                models.Studio,
                models.executives_to_studios.c.studio_id == models.Studio.id,
            )
        )
        .where(models.executives_to_studios.c.executive_id == exec_id)
    )

    pc = (
        select(
            models.executives_to_production_companies.c.production_company_id.label("company_id"),
            models.ProductionCompany.name.label("company_name"),
            literal("production_company").label("company_type"),
            models.executives_to_production_companies.c.status.label("status"),
            models.executives_to_production_companies.c.last_modified.label("last_modified"),
            models.executives_to_production_companies.c.title.label("title"),
        )
        .select_from(
            models.executives_to_production_companies.join(
                models.ProductionCompany,
                models.executives_to_production_companies.c.production_company_id == models.ProductionCompany.id,
            )
        )
        .where(models.executives_to_production_companies.c.executive_id == exec_id)
    )

    rows = db.execute(union_all(nw, st, pc)).all()

    def to_link(r) -> schemas.ExecCompanyLink:
        return schemas.ExecCompanyLink(
            company_id=r.company_id,
            company_name=r.company_name,
            company_type=r.company_type,
            status=r.status,
            last_modified=r.last_modified,
            title=getattr(r, "title", None),
        )

    current = [to_link(r) for r in rows if r.status == "Active"]
    past    = [to_link(r) for r in rows if r.status == "Archived"]

    return {"current": current, "past": past}



# Add companies linked to a given executive
@router.post("/{exec_id}/companies", status_code=204, dependencies=[Depends(require_writer)])
def add_or_activate_exec_company(
    exec_id: str,
    body: dict,     # { "company_id": "ST_00001", "title": "EVP, Drama" }
    db: Session = Depends(get_db),
):
    company_id = body.get("company_id")
    title = body.get("title")  # optional
    if not company_id or not isinstance(company_id, str):
        raise HTTPException(400, "company_id is required")

    if company_id.startswith("NW_"):
        Link, fk = models.executives_to_tv_networks, models.executives_to_tv_networks.c.network_id
    elif company_id.startswith("ST_"):
        Link, fk = models.executives_to_studios, models.executives_to_studios.c.studio_id
    elif company_id.startswith("PC_"):
        Link, fk = models.executives_to_production_companies, models.executives_to_production_companies.c.production_company_id
    else:
        raise HTTPException(400, "Unsupported company id prefix")

    # try update first (set Active, optionally update title)
    upd_vals = {"status": "Active"}
    if title is not None:
        upd_vals["title"] = title

    upd = (
        update(Link)
        .where(and_(Link.c.executive_id == exec_id, fk == company_id))
        .values(**upd_vals)
    )
    res = db.execute(upd)
    if res.rowcount == 0:
        # insert / upsert
        try:
            db.execute(
                pg_insert(Link)
                .values(executive_id=exec_id, **{fk.name: company_id}, status="Active", title=title)
                .on_conflict_do_nothing()
            )
        except Exception:
            db.rollback()
            raise
    db.commit()


# Edit status (Active/Archived) of companies linked to a given executive
@router.patch("/{exec_id}/companies/{company_id}", status_code=204, dependencies=[Depends(require_writer)])
def update_exec_company_link(
    exec_id: str,
    company_id: str,
    body: dict | None = Body(None),   # { "status": "Active"|"Archived", "title": "SVP" }
    db: Session = Depends(get_db),
):
    if company_id.startswith("NW_"):
        Link, fk = models.executives_to_tv_networks, models.executives_to_tv_networks.c.network_id
    elif company_id.startswith("ST_"):
        Link, fk = models.executives_to_studios, models.executives_to_studios.c.studio_id
    elif company_id.startswith("PC_"):
        Link, fk = models.executives_to_production_companies, models.executives_to_production_companies.c.production_company_id
    else:
        raise HTTPException(400, "Unsupported company id prefix")

    values: dict = {}
    if body and isinstance(body, dict):
        if "status" in body:
            if body["status"] not in ("Active", "Archived"):
                raise HTTPException(400, "status must be 'Active' or 'Archived'")
            values["status"] = body["status"]
        if "title" in body:
            values["title"] = body["title"]
    else:
        # Back-compat: no body means "archive"
        values["status"] = "Archived"

    if not values:
        return  # nothing to change

    res = db.execute(
        update(Link)
        .where(and_(Link.c.executive_id == exec_id, fk == company_id))
        .values(**values)
    )
    if res.rowcount == 0:
        raise HTTPException(404, "Link row not found")
    db.commit()



# Delete link between an executive and a company
@router.delete("/{exec_id}/companies/{company_id}", status_code=204, dependencies=[Depends(require_writer)])
def delete_exec_company(exec_id: str, company_id: str, db: Session = Depends(get_db)):
    if company_id.startswith("NW_"):
        Link = models.executives_to_tv_networks
        fk   = Link.c.network_id
    elif company_id.startswith("ST_"):
        Link = models.executives_to_studios
        fk   = Link.c.studio_id
    elif company_id.startswith("PC_"):
        Link = models.executives_to_production_companies
        fk   = Link.c.production_company_id
    else:
        raise HTTPException(400, "Unsupported company id prefix")

    res = db.execute(
        delete(Link).where(and_(Link.c.executive_id == exec_id, fk == company_id))
    )
    if res.rowcount == 0:
        raise HTTPException(404, "Link row not found")
    db.commit()




# Get all feedback supplied by a given executive
@router.get("/{exec_id}/subs_feedback", response_model=schemas.PagedExecSubFeedback, dependencies=[Depends(require_team_or_higher)])
def list_exec_subs_feedback(
    exec_id: str,
    limit: int = 100,
    offset: int = 0,
    db: Session = Depends(get_db),
):
    # subs where this exec is a recipient
    base = (
        select(
            models.Sub.id.label("sub_id"),
            models.Sub.created_at.label("sub_created_at"),
            models.Sub.intent_primary.label("intent_primary"),
            models.Sub.result.label("result"),
            models.Project.id.label("project_id"),
            models.Project.title.label("project_title"),
            models.Project.media_type.label("media_type"),
            # feedback columns (LEFT JOIN, may be NULL)
            models.SubFeedback.id.label("feedback_id"),
            models.SubFeedback.sentiment.label("feedback_sentiment"),
            models.SubFeedback.feedback_text.label("feedback_text"),
            models.SubFeedback.created_at.label("feedback_created_at"),
        )
        .select_from(models.Sub)
        .join(models.SubRecipient, and_(
            models.SubRecipient.sub_id == models.Sub.id,
            models.SubRecipient.recipient_type == "executive",
            models.SubRecipient.recipient_id == exec_id,
        ))
        .join(models.Project, models.Project.id == models.Sub.project_id, isouter=True)
        .join(
            models.SubFeedback,
            and_(
                models.SubFeedback.sub_id == models.Sub.id,
                models.SubFeedback.source_type == "executive",
                models.SubFeedback.source_id == exec_id,
            ),
            isouter=True,
        )
        .order_by(models.Sub.created_at.desc(), models.Sub.id.desc())
        .limit(limit)
        .offset(offset)
    )

    rows = db.execute(base).all()

    # Collect sub_ids
    sub_ids = list({r.sub_id for r in rows})
    if not sub_ids:
        # still compute total (count base)
        total = db.execute(select(func.count()).select_from(base.subquery())).scalar() or 0
        return {"total": total, "items": []}

    # Fetch clients for these subs in one shot
    clients_q = (
        select(
            models.sub_to_client.c.sub_id,
            models.Creative.id,
            models.Creative.name,
        )
        .select_from(models.sub_to_client.join(models.Creative, models.Creative.id == models.sub_to_client.c.creative_id))
        .where(models.sub_to_client.c.sub_id.in_(sub_ids))
    )
    client_rows = db.execute(clients_q).all()
    clients_map: dict[str, list[schemas.CreativeMini]] = {}
    for r in client_rows:
        clients_map.setdefault(r.sub_id, []).append(schemas.CreativeMini(id=r.id, name=r.name))

    # total
    count_q = select(func.count()).select_from(
        select(models.Sub.id)
        .select_from(models.Sub)
        .join(models.SubRecipient, and_(
            models.SubRecipient.sub_id == models.Sub.id,
            models.SubRecipient.recipient_type == "executive",
            models.SubRecipient.recipient_id == exec_id,
        ))
        .subquery()
    )
    total = db.execute(count_q).scalar() or 0

    # Build items
    items: list[schemas.ExecSubFeedbackRow] = []
    # If a sub appears with multiple feedback rows, we’ll push multiple items;
    # If no feedback row returned (all feedback_* NULL), include one “no feedback” row.
    # To ensure the “no feedback” row exists when needed, track seen per sub.
    seen_feedback_for_sub: dict[str, bool] = {}

    for r in rows:
        has_fb = r.feedback_id is not None
        seen_feedback_for_sub[r.sub_id] = seen_feedback_for_sub.get(r.sub_id, False) or has_fb

        items.append(
            schemas.ExecSubFeedbackRow(
                sub_id=r.sub_id,
                sub_created_at=r.sub_created_at,
                intent_primary=r.intent_primary,
                result=r.result,
                project_id=r.project_id,
                project_title=r.project_title,
                media_type=r.media_type,
                feedback_id=r.feedback_id,
                feedback_sentiment=r.feedback_sentiment,
                feedback_text=r.feedback_text,
                feedback_created_at=r.feedback_created_at,
                clients=clients_map.get(r.sub_id, []),
            )
        )

    # De-duplicate “no feedback” duplication: when a sub had no feedback rows at all,
    # the select still produced one row with feedback_* NULL, which we already appended.
    # So nothing else to do.

    return {"total": total, "items": items}




