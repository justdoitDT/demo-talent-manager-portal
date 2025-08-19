# backend/app/routers/projects.py

from fastapi import APIRouter, Depends, Query, HTTPException, status
from sqlalchemy import select, insert, text, exists, literal_column, func, case, literal, cast, String
from sqlalchemy.orm import Session, joinedload, load_only
from sqlalchemy.dialects.postgresql import insert as pg_insert
from typing import List, Optional, Tuple, Dict
from ..auth_dep import require_team_or_higher, require_writer, require_admin
from collections import defaultdict

from ..database import get_db
from .. import models, schemas

router = APIRouter(prefix="/projects", tags=["Projects"])



# helpers

def _company_model_for(company_id: str):
    if company_id.startswith("NW_"): return models.TVNetwork
    if company_id.startswith("ST_"): return models.Studio
    if company_id.startswith("PC_"): return models.ProductionCompany
    return None

def _project_company_link_for(company_id: str):
    """
    Return (LinkTable, fk_col, fk_name) for a given company id.
    """
    if company_id.startswith("NW_"):
        t = models.project_to_tv_networks
        return t, t.c.network_id, "network_id"
    if company_id.startswith("ST_"):
        t = models.project_to_studios
        return t, t.c.studio_id, "studio_id"
    if company_id.startswith("PC_"):
        t = models.project_to_production_companies
        return t, t.c.production_company_id, "production_company_id"
    return None, None, None

def _get_notes_for(db: Session, noteable_type: str, noteable_id: str):
    return (
        db.query(models.Note)
          .join(models.NoteLink, models.Note.id == models.NoteLink.note_id)
          .filter(
            models.NoteLink.noteable_type == noteable_type,
            models.NoteLink.noteable_id   == noteable_id
          )
          .all()
    )

def _create_note_for(db: Session, note_text: str, noteable_type: str, noteable_id: str):
    note = models.Note(
        note             = note_text,
        created_by_id    = "TM_00011",
        created_by_type  = "manager",
        updated_by_id    = "TM_00011",
        updated_by_type  = "manager",
        status           = "active",
        visibility       = "managers"
    )
    db.add(note)
    db.flush()  # populates note.id
    link = models.NoteLink(
      note_id=note.id,
      noteable_type=noteable_type,
      noteable_id=noteable_id
    )
    db.add(link)
    db.commit()
    db.refresh(note)
    return note

def _list_subs(
    db: Session,
    *,
    limit: int = 25,
    offset: int = 0,
    since_days: int = 180,
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
    Either ``project_id`` **or** ``project_title`` may be supplied.
    Each row is returned as a plain dict via SQLAlchemy ``.mappings()``.
    """
    # ------------------------------------------------------------------
    # 0.  WHERE‑clause builder
    # ------------------------------------------------------------------
    where: List[str] = [
        "v.updated_at >= now() - (:since * interval '1 day')"   # rolling window
    ]
    params: Dict[str, object] = {"since": since_days}
    def add(clause: str, **kv: object) -> None:
        where.append(clause)
        params.update(kv)
    # ------------------------------------------------------------------
    # 1.  Filters supplied by caller
    # ------------------------------------------------------------------
    if clients:
        add("v.clients ILIKE ANY(:clients)", clients=clients)
    if executives:
        add("v.executives ILIKE ANY(:executives)", executives=executives)
    if project_id:
        add("v.project_id = :project_id", project_id=project_id)
    elif project_title:
        add("v.project_title ILIKE :project_title",
            project_title=f"%{project_title}%")
    if media_type:
        add("v.media_type = :media_type", media_type=media_type)
    if intent:
        add("v.intent_primary = :intent", intent=intent)
    if company:
        add("v.recipient_company ILIKE :company", company=f"%{company}%")
    if result:
        add("v.result = :result", result=result)
    # --- feedback -----------------------------------------------
    #
    #   feedback_filter value         condition added
    #   ---------------------------   -----------------------------
    #   ''  | None        → no extra clause   ( “Any” )
    #   '0'               → feedback_count = 0
    #   'positive'        → has_positive  = TRUE
    #   'not_positive'    → feedback_count > 0 AND has_positive = FALSE
    #
    if feedback_filter == "0":                       # None Received
        add("v.feedback_count = 0")
    elif feedback_filter == "positive":
        add("v.has_positive = true")
    elif feedback_filter == "not_positive":
        add("v.feedback_count > 0 AND has_positive = false")
    # else: leave un‑filtered
    # ------------------------------------------------------------------
    # 2.  Compose SQL
    # ------------------------------------------------------------------
    where_sql = " AND ".join(where)    
    base_sql  = (
        "FROM sub_list_view v "
        "JOIN subs s ON s.id = v.sub_id "
        f"WHERE {where_sql}"
    )
    # ------------------------------------------------------------------
    # 3.  Execute COUNT and page query
    # ------------------------------------------------------------------
    total: int = db.execute(text(f"SELECT COUNT(*) {base_sql}"), params).scalar_one()
    rows: List[dict] = (
        db.execute(
            text(
                f"""
                SELECT v.*, s.created_at
                {base_sql}
                ORDER BY v.updated_at DESC
                LIMIT :limit OFFSET :offset
                """
            ),
            {**params, "limit": limit, "offset": offset},
        )
        .mappings()
        .all()
    )
    return total, rows



# list of projects

class PagedProjects(schemas.BaseModel):               # you can import BaseModel or Pydantic directly
    total: int
    items: List[schemas.ProjectRead]


# ────────────────────────────────────────────────────────────────────
#  GET /projects  (paged list + filters, incl. ptype=…)
# ────────────────────────────────────────────────────────────────────
@router.get(
    "",
    response_model=schemas.PagedProjects,
    dependencies=[Depends(require_team_or_higher)],
)
def list_projects(
    year:            Optional[int]  = Query(None),
    media_type:      Optional[str]  = Query(None),
    status:          Optional[str]  = Query(None),
    tracking_status: Optional[str]  = Query(None),
    ptype:           Optional[str]  = Query(None),
    q:               Optional[str]  = Query(None),
    studio:          Optional[str]  = Query(None),   # filter by Studio name (Active links only)
    network:         Optional[str]  = Query(None),   # filter by Network name (Active links only)
    limit:           int            = Query(25, ge=1, le=500),
    offset:          int            = Query(0,  ge=0),
    db: Session = Depends(get_db),
):
    P   = models.Project
    PT  = models.ProjectType
    P2T = models.project_to_project_type

    # ---------------- base (filters only on projects table) ----------------
    base = (
        db.query(P)
          .options(load_only(
              P.id, P.title, P.year, P.media_type, P.status,
              P.tracking_status, P.engagement
          ))
    )
    if year is not None:
        base = base.filter(P.year == str(year))
    if media_type:
        base = base.filter(P.media_type == media_type)
    if status:
        base = base.filter(P.status == status)
    if tracking_status:
        base = base.filter(P.tracking_status == tracking_status)
    if q:
        base = base.filter(P.title.ilike(f"%{q}%"))

    # project-type filter via EXISTS
    if ptype:
        wanted = ["OWA", "ODA"] if ptype == "OWA/ODA" else [ptype]
        subq = (
            select(literal_column("1"))
            .select_from(P2T)
            .join(PT, PT.id == P2T.c.type_id)
            .where(P2T.c.project_id == P.id)
            .where(P2T.c.status == "Active")
            .where(PT.type.in_(wanted))
        )
        base = base.filter(exists(subq))

    # Studio name filter via EXISTS (Active links only)
    if studio:
        PS, S = models.project_to_studios, models.Studio
        subq_studio = (
            select(literal_column("1"))
            .select_from(PS)
            .join(S, S.id == PS.c.studio_id)
            .where(PS.c.project_id == P.id)
            .where(getattr(PS.c, "status", literal("Active")) == "Active")
            .where(S.name.ilike(f"%{studio}%"))
        )
        base = base.filter(exists(subq_studio))

    # Network name filter via EXISTS (Active links only)
    if network:
        PN, N = models.project_to_tv_networks, models.TVNetwork
        subq_net = (
            select(literal_column("1"))
            .select_from(PN)
            .join(N, N.id == PN.c.network_id)
            .where(PN.c.project_id == P.id)
            .where(getattr(PN.c, "status", literal("Active")) == "Active")
            .where(N.name.ilike(f"%{network}%"))
        )
        base = base.filter(exists(subq_net))

    # total before joins
    filtered_ids = base.with_entities(P.id).subquery()
    total = db.query(func.count()).select_from(filtered_ids).scalar()

    # -------------------------- ordering rules -----------------------------
    tv_order = [
        "Active", "Engaged", "Hot List", "Priority Tracking",
        "Tracking", "Deep Tracking", "Development", "Archived", "Completed",
    ]
    feat_order = [
        "Hot List", "Priority", "Priority Tracking", "Tracking",
        "Active", "Deep Tracking", "Engaged", "Completed", "Archived",
    ]
    order_vals = tv_order if media_type == "TV Series" else (
        feat_order if media_type == "Feature" else None
    )

    # simple CASE – compare as TEXT to avoid enum casting issues
    if order_vals:
        mapping = {v: i for i, v in enumerate(order_vals)}
        rank_expr = case(mapping, value=cast(P.tracking_status, String), else_=literal(999))
    else:
        rank_expr = literal(999)

    # --------- cheap sort key (MIN company name) instead of full string_agg ---
    PN, N  = models.project_to_tv_networks, models.TVNetwork
    PS, S  = models.project_to_studios,     models.Studio

    net_sort = None
    stu_sort = None
    if media_type == "TV Series":
        net_sort = (
            db.query(
                PN.c.project_id.label("pid"),
                func.min(N.name).label("net_sort"),
            )
            .join(N, N.id == PN.c.network_id)
            .filter(PN.c.project_id.in_(select(filtered_ids.c.id)))
            .filter(getattr(PN.c, "status", literal("Active")) == "Active")   # only Active
            .group_by(PN.c.project_id)
            .subquery()
        )
    elif media_type == "Feature":
        stu_sort = (
            db.query(
                PS.c.project_id.label("pid"),
                func.min(S.name).label("stu_sort"),
            )
            .join(S, S.id == PS.c.studio_id)
            .filter(PS.c.project_id.in_(select(filtered_ids.c.id)))
            .filter(getattr(PS.c, "status", literal("Active")) == "Active")   # only Active
            .group_by(PS.c.project_id)
            .subquery()
        )

    # ----------------------------- page query (ordered) ----------------------
    if media_type == "TV Series":
        q_rows = (
            base
            .outerjoin(net_sort, net_sort.c.pid == P.id)
            .with_entities(P, net_sort.c.net_sort)
            .order_by(rank_expr, func.coalesce(net_sort.c.net_sort, ""), P.title.asc())
            .limit(limit).offset(offset)
        )
    elif media_type == "Feature":
        q_rows = (
            base
            .outerjoin(stu_sort, stu_sort.c.pid == P.id)
            .with_entities(P, stu_sort.c.stu_sort)
            .order_by(rank_expr, func.coalesce(stu_sort.c.stu_sort, ""), P.title.asc())
            .limit(limit).offset(offset)
        )
    else:
        q_rows = (
            base
            .with_entities(P, literal(None))
            .order_by(P.title.asc())
            .limit(limit).offset(offset)
        )

    # Materialize ordered page
    tuples = q_rows.all()
    items: list[models.Project] = [t[0] for t in tuples]
    page_ids = [p.id for p in items]

    # --------- now build display string_agg ONLY for the 25 page rows ----------
    if items and media_type == "TV Series":
        agg_rows = (
            db.query(
                PN.c.project_id,
                func.string_agg(func.distinct(N.name), literal(", ")).label("network")
            )
            .join(N, N.id == PN.c.network_id)
            .filter(PN.c.project_id.in_(page_ids))
            .filter(getattr(PN.c, "status", literal("Active")) == "Active")   # only Active
            .group_by(PN.c.project_id)
            .all()
        )
        by_pid = {pid: net for pid, net in agg_rows}
        for p in items:
            setattr(p, "network", by_pid.get(p.id))
            setattr(p, "studio", None)
    elif items and media_type == "Feature":
        agg_rows = (
            db.query(
                PS.c.project_id,
                func.string_agg(func.distinct(S.name), literal(", ")).label("studio")
            )
            .join(S, S.id == PS.c.studio_id)
            .filter(PS.c.project_id.in_(page_ids))
            .filter(getattr(PS.c, "status", literal("Active")) == "Active")   # only Active
            .group_by(PS.c.project_id)
            .all()
        )
        by_pid = {pid: stu for pid, stu in agg_rows}
        for p in items:
            setattr(p, "studio", by_pid.get(p.id))
            setattr(p, "network", None)
    else:
        for p in items:
            setattr(p, "network", None)
            setattr(p, "studio",  None)

    # one-shot fetch of active project-types for the page
    if items:
        type_rows = (
            db.query(P2T.c.project_id, PT.type)
              .join(PT, PT.id == P2T.c.type_id)
              .filter(P2T.c.project_id.in_(page_ids),
                      P2T.c.status == "Active")
              .all()
        )
        by_pid_types: dict[str, list[str]] = defaultdict(list)
        for pid, t in type_rows:
            by_pid_types[pid].append(t)
        for p in items:
            setattr(p, "project_types", sorted(by_pid_types.get(p.id, [])))

    return {"total": total, "items": items}






# individual project
@router.get("/{project_id}", response_model=schemas.ProjectRead, dependencies=[Depends(require_team_or_higher)])
def get_project(project_id: str, db: Session = Depends(get_db)):
    project = (
        db.query(models.Project)
          .options(joinedload(models.Project.genres))   # ← THIS LINE
          .get(project_id)
    )
    if not project:
        raise HTTPException(404, "Project not found")
    return project



@router.post(
    "",
    response_model=schemas.ProjectRead,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(require_writer)]
)
def create_project(payload: schemas.ProjectCreate, db: Session = Depends(get_db)):
    """
    Transactionally create a Project **and** every requested association.

    • Ensures project‑type strings exist in `project_types` (inserting if needed)
    • Stores the resulting type *ids* in `project_to_project_type`
    • Links genre tags, companies, executives, creatives, needs, etc.
    """
    try:
        # ───────────────── 1.  main row ────────────────────────────────
        pr = models.Project(
            title           = payload.title,
            imdb_id         = payload.imdb_id,
            media_type      = payload.media_type,
            year            = str(payload.year) if payload.year else None,
            description     = payload.description,
            status          = payload.status,
            tracking_status = payload.tracking_status,
        )
        db.add(pr)
        db.flush()                     # pr.id is now available

        # helper -----------------------------------------------------------------
        def bulk(table, rows: list[dict]):
            """Run one `INSERT … VALUES …` if rows is not empty."""
            if rows:
                db.execute(insert(table), rows)

        # ───────────────── 2.  simple join‑tables ───────────────────────────────
        bulk(models.project_genre_tags,
             [{"project_id": pr.id, "tag_id": tid} for tid in payload.genre_tag_ids])

        bulk(models.project_to_tv_networks,
             [{"project_id": pr.id, "network_id": nid} for nid in payload.network_ids])

        bulk(models.project_to_studios,
             [{"project_id": pr.id, "studio_id": sid} for sid in payload.studio_ids])

        bulk(models.project_to_production_companies,
             [{"project_id": pr.id, "production_company_id": pid}
              for pid in payload.prodco_ids])

        bulk(models.project_to_executives,
             [{"project_id": pr.id, "executive_id": eid}
              for eid in payload.executive_ids])

        # ───────────────── 3.  project types  ───────────────────────────────────
        if payload.project_types:
            # fetch any that already exist
            existing = (
                db.query(models.ProjectType)
                  .filter(models.ProjectType.type.in_(payload.project_types))
                  .all()
            )
            type_map = {row.type: row.id for row in existing}

            # insert the missing ones
            missing = [t for t in payload.project_types if t not in type_map]
            if missing:
                db.add_all([models.ProjectType(type=t) for t in missing])
                db.flush()   # IDs now populated
                rows = (
                    db.query(models.ProjectType)
                      .filter(models.ProjectType.type.in_(missing))
                      .all()
                )
                type_map.update({row.type: row.id for row in rows})

            # link project ↔ type
            bulk(
                models.project_to_project_type,
                [{"project_id": pr.id, "type_id": type_map[t]}
                 for t in payload.project_types],
            )

        # ───────────────── 4.  creatives (personal projects) ────────────────────
        if payload.is_personal and payload.creative_ids:
            bulk(
                models.creative_project_roles,
                [{
                    "project_id": pr.id,
                    "creative_id": cid,
                    "role": "Creative Developer",
                } for cid in payload.creative_ids],
            )

        # ───────────────── 5.  needs (quals / description) ──────────────────────
        for nd in payload.needs:
            db.add(
                models.ProjectNeed(
                    project_id     = pr.id,
                    qualifications = nd.need,
                    description    = nd.description,
                )
            )

        # ───────────────── 6.  done ────────────────────────────────────────────
        db.commit()
        db.refresh(pr)
        return pr

    except Exception as exc:
        db.rollback()
        # bubble up as 500 so the frontend shows “Failed to save project”
        raise HTTPException(status_code=500, detail=str(exc))



@router.patch("/{project_id}", response_model=schemas.ProjectRead, dependencies=[Depends(require_writer)])
def update_project(
    project_id: str,
    payload: schemas.ProjectUpdate,
    db: Session = Depends(get_db)
):
    p = (
        db.query(models.Project)
          .options(joinedload(models.Project.genres))
          .filter(models.Project.id == project_id)
          .first()
    )
    if not p:
        raise HTTPException(404, "Project not found")

    for k, v in payload.model_dump(exclude_unset=True).items():
        setattr(p, k, v)

    db.commit()
    db.refresh(p)
    return p




@router.get("/{project_id}/notes", response_model=List[schemas.NoteRead], dependencies=[Depends(require_team_or_higher)])
def read_project_notes(
    project_id: str,
    db: Session = Depends(get_db),
):
    return _get_notes_for(
      db,
      noteable_type="project",
      noteable_id=project_id,
    )

@router.post("/{project_id}/notes", response_model=schemas.NoteRead, dependencies=[Depends(require_writer)])
def add_project_note(
    project_id: str,
    payload: schemas.NoteCreate,     # <-- accept a Pydantic model instead of raw dict
    db: Session = Depends(get_db),
):
    return _create_note_for(
      db,
      note_text     = payload.note,
      noteable_type = "project",
      noteable_id   = project_id,
    )


@router.post("/{project_id}/genres/{tag_id}", dependencies=[Depends(require_writer)])
def add_genre_to_project(project_id: str, tag_id: str, db: Session = Depends(get_db)):
    p   = db.get(models.Project, project_id)
    tag = db.get(models.GenreTag, tag_id)
    if not p or not tag:
        raise HTTPException(404)
    p.genres.append(tag)
    db.commit()
    return {"ok": True}

@router.delete("/{project_id}/genres/{tag_id}", dependencies=[Depends(require_writer)])
def remove_genre_from_project(project_id: str, tag_id: str, db: Session = Depends(get_db)):
    p   = db.get(models.Project, project_id)
    tag = db.get(models.GenreTag, tag_id)
    if not p or not tag:
        raise HTTPException(404)
    p.genres.remove(tag)
    db.commit()
    return {"ok": True}



# ───────────────── Project Types (OWA / ODA / etc.) ─────────────────
@router.post("/{project_id}/types/{type_name}", status_code=204,
             dependencies=[Depends(require_writer)])
def add_project_type(project_id: str, type_name: str, db: Session = Depends(get_db)):
    """
    Upsert a row in project_to_project_type.
      • If it already exists → set status = 'Active' and bump last_modified
      • Else                 → insert a new row
    """
    # 1. look up (or create) the project_type row ---------------------------------
    pt = (
        db.query(models.ProjectType)
          .filter(models.ProjectType.type == type_name)
          .first()
    )
    if not pt:
        raise HTTPException(400, f"Unknown project-type “{type_name}”")

    # 2. upsert into the link table ------------------------------------------------
    stmt = (
        pg_insert(models.project_to_project_type)
        .values(project_id=project_id, type_id=pt.id, status="Active")
        .on_conflict_do_update(
            index_elements=["project_id", "type_id"],
            set_={"status": "Active", "last_modified": text("now()")}
        )
    )
    db.execute(stmt)
    db.commit()
    return {"ok": True}


@router.delete("/{project_id}/types/{ptype}", status_code=204,
               dependencies=[Depends(require_writer)])
def remove_project_type(project_id: str, ptype: str, db: Session = Depends(get_db)):
    tid = db.scalar(
        select(models.ProjectType.id)
        .where(models.ProjectType.type == ptype)
    )
    if not tid:
        return                                   # idempotent
    db.execute(
        models.project_to_project_type.delete()
        .where(models.project_to_project_type.c.project_id == project_id)
        .where(models.project_to_project_type.c.type_id    == tid)
    )
    db.commit()




# GET creatives for a project (with role)
@router.get("/{project_id}/creatives", response_model=list[schemas.CreativeProjectRole], dependencies=[Depends(require_team_or_higher)])
def get_creatives_for_project(project_id: str, db: Session = Depends(get_db)):
    q = (
        db.query(
            models.creative_project_roles.c.creative_id,
            models.Creative.name.label("creative_name"),
            models.creative_project_roles.c.project_id,
            models.creative_project_roles.c.role,
            models.Project.title.label("project_title"),
        )
        .join(models.Creative, models.Creative.id == models.creative_project_roles.c.creative_id)
        .join(models.Project, models.Project.id == models.creative_project_roles.c.project_id)
        .filter(models.creative_project_roles.c.project_id == project_id)
    )
    rows = q.all()
    return [
        schemas.CreativeProjectRole(
            creative_id=r.creative_id,
            creative_name=r.creative_name,
            project_id=r.project_id,
            project_title=r.project_title,
            role=r.role,
        )
        for r in rows
    ]



# GET subs for a project
@router.get("/{project_id}/subs", response_model=schemas.PagedSubs, dependencies=[Depends(require_team_or_higher)])
def list_project_subs(
    project_id: str,
    limit: int = 25,
    offset: int = 0,
    since_days: int = 180,
    result: str | None = None,
    db: Session = Depends(get_db),
):
    """
    Subs whose `sub_list_view.project_id == project_id`.
    """
    total, rows = _list_subs(
        db,
        limit=limit,
        offset=offset,
        since_days=since_days,
        project_id=project_id,      # ← exact‑match filter
        result=result,
    )
    return {"total": total, "items": rows}



# GET needs for a project
@router.get("/{project_id}/needs", response_model=list[schemas.ProjectNeed], dependencies=[Depends(require_team_or_higher)])
def list_needs_for_project(project_id: str, db: Session = Depends(get_db)):
    return (
        db.query(models.ProjectNeed)
          .filter(models.ProjectNeed.project_id == project_id)
          .filter(models.ProjectNeed.status == "Active")
          .order_by(models.ProjectNeed.description)
          .all()
    )

# ADD need to a project
@router.post(
    "/{project_id}/needs",
    response_model=schemas.ProjectNeed,
    status_code=201,
    dependencies=[Depends(require_writer)]
)
def create_project_need(
    project_id: str,
    payload: schemas.ProjectNeedCreateNested,
    db: Session = Depends(get_db),
):
    if not db.get(models.Project, project_id):
        raise HTTPException(404, "Project not found")
    need_row = models.ProjectNeed(
        project_id     = project_id,
        qualifications = payload.qualifications,
        description    = payload.description,
    )
    db.add(need_row)
    db.flush()
    if payload.project_types:
        db.execute(
            insert(models.project_to_project_type),
            [{"project_id": project_id, "type_id": t} for t in payload.project_types],
        )
    db.commit()
    db.refresh(need_row)
    return need_row

# Delete need (set to "Archived")
@router.patch("/project_need/{need_id}", response_model=schemas.ProjectNeed, dependencies=[Depends(require_writer)])
def update_project_need(
    need_id: str,
    payload: schemas.ProjectNeedUpdate,
    db: Session = Depends(get_db),
):
    row = db.get(models.ProjectNeed, need_id)
    if not row:
        raise HTTPException(404, "Need not found")
    row.status = payload.status
    db.commit()
    db.refresh(row)
    return row


# GET executives for a project
@router.get("/{project_id}/executives", response_model=list[schemas.Executive], dependencies=[Depends(require_team_or_higher)])
def list_project_execs(project_id: str, db: Session = Depends(get_db)):
    q = (
        db.query(models.Executive)
          .options(                              # ✨ add this block
              joinedload(models.Executive.tv_networks),
              joinedload(models.Executive.studios),
              joinedload(models.Executive.production_companies),
          )
          .join(models.project_to_executives,
                models.project_to_executives.c.executive_id == models.Executive.id)
          .filter(models.project_to_executives.c.project_id == project_id)
          .order_by(models.Executive.name)
    )
    return q.all()

# ─────────────────────────── ADD an executive to a project ─────────────────────
@router.post(
    "/{project_id}/executives/{executive_id}",
    status_code=204,
    dependencies=[Depends(require_writer)],
    summary="Attach an executive to this project (idempotent)"
)
def add_executive_to_project(project_id: str, executive_id: str, db: Session = Depends(get_db)):
    if db.get(models.Project, project_id) is None:
        raise HTTPException(404, "Project not found")
    if db.get(models.Executive, executive_id) is None:
        raise HTTPException(404, "Executive not found")

    # Upsert (on Postgres). Assumes UNIQUE(project_id, executive_id)
    stmt = (
        pg_insert(models.project_to_executives)
        .values(project_id=project_id, executive_id=executive_id)
        .on_conflict_do_nothing(index_elements=["project_id", "executive_id"])
    )
    db.execute(stmt)
    db.commit()

# ────────────────────────── REMOVE an executive from project ───────────────────
@router.delete(
    "/{project_id}/executives/{executive_id}",
    status_code=204,
    dependencies=[Depends(require_writer)],
    summary="Detach an executive from this project"
)
def remove_executive_from_project(project_id: str, executive_id: str, db: Session = Depends(get_db)):
    if db.get(models.Project, project_id) is None:
        raise HTTPException(404, "Project not found")
    if db.get(models.Executive, executive_id) is None:
        # idempotent-like behavior: treat as removed
        return

    db.execute(
        models.project_to_executives.delete()
        .where(models.project_to_executives.c.project_id == project_id)
        .where(models.project_to_executives.c.executive_id == executive_id)
    )
    db.commit()


# GET companies for a project
class ProjectCompanies(schemas.BaseModel):
    networks: list[schemas.TVNetwork]
    studios:  list[schemas.Studio]
    prodcos:  list[schemas.ProductionCompany]

@router.get("/{project_id}/companies", response_model=ProjectCompanies, dependencies=[Depends(require_team_or_higher)])
def project_companies(project_id: str, db: Session = Depends(get_db)):
    nets = (
        db.query(models.TVNetwork)
          .join(models.project_to_tv_networks,
                models.project_to_tv_networks.c.network_id == models.TVNetwork.id)
          .filter(models.project_to_tv_networks.c.project_id == project_id)
          .filter(getattr(models.project_to_tv_networks.c, "status", literal("Active")) == "Active")
          .all()
    )
    studs = (
        db.query(models.Studio)
          .join(models.project_to_studios,
                models.project_to_studios.c.studio_id == models.Studio.id)
          .filter(models.project_to_studios.c.project_id == project_id)
          .filter(getattr(models.project_to_studios.c, "status", literal("Active")) == "Active")
          .all()
    )
    pcs = (
        db.query(models.ProductionCompany)
          .join(models.project_to_production_companies,
                models.project_to_production_companies.c.production_company_id == models.ProductionCompany.id)
          .filter(models.project_to_production_companies.c.project_id == project_id)
          .filter(getattr(models.project_to_production_companies.c, "status", literal("Active")) == "Active")
          .all()
    )
    return {"networks": nets, "studios": studs, "prodcos": pcs}

# ─────────────────────────── ADD a company to a project ─────────────────────────
@router.post(
    "/{project_id}/companies/{company_id}",
    status_code=204,
    dependencies=[Depends(require_writer)],
    summary="Attach a TV network / studio / prodco to this project (idempotent)"
)
def add_company_to_project(project_id: str, company_id: str, db: Session = Depends(get_db)):
    # ensure both ends exist
    if db.get(models.Project, project_id) is None:
        raise HTTPException(404, "Project not found")

    CompanyModel = _company_model_for(company_id)
    if CompanyModel is None or db.get(CompanyModel, company_id) is None:
        raise HTTPException(404, "Company not found or unsupported prefix")

    Link, fk_col, fk_name = _project_company_link_for(company_id)
    if Link is None or fk_col is None or fk_name is None:
        raise HTTPException(400, "Unsupported company id prefix")

    vals = {"project_id": project_id, fk_name: company_id}
    if "status" in Link.c:
        vals["status"] = "Active"

    stmt = (
        pg_insert(Link)
        .values(**vals)
        .on_conflict_do_update(
            index_elements=["project_id", fk_name],
            set_={
                **({"status": "Active"} if "status" in Link.c else {}),
                **({"last_modified": text("now()")} if "last_modified" in Link.c else {}),
            }
        )
    )
    db.execute(stmt)
    db.commit()

# ────────────────────────── REMOVE a company from project ──────────────────────
@router.delete(
    "/{project_id}/companies/{company_id}",
    status_code=204,
    dependencies=[Depends(require_writer)],
    summary="Detach a TV network / studio / prodco from this project"
)
def remove_company_from_project(project_id: str, company_id: str, db: Session = Depends(get_db)):
    if db.get(models.Project, project_id) is None:
        raise HTTPException(404, "Project not found")

    Link, fk_col, fk_name = _project_company_link_for(company_id)
    if Link is None or fk_col is None or fk_name is None:
        raise HTTPException(400, "Unsupported company id prefix")

    if "status" in Link.c:
        db.execute(
            Link.update()
                .where(Link.c.project_id == project_id)
                .where(fk_col == company_id)
                .values(
                    status="Archived",
                    **({"last_modified": text("now()")} if "last_modified" in Link.c else {})
                )
        )
    else:
        db.execute(
            Link.delete()
                .where(Link.c.project_id == project_id)
                .where(fk_col == company_id)
        )
    db.commit()
