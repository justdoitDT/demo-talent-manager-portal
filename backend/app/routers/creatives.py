# backend/app/routers/creatives.py

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import and_, cast, Integer, func, select, desc
from sqlalchemy.orm import Session, joinedload, aliased, with_loader_criteria
from sqlalchemy.exc import IntegrityError
from sqlalchemy.sql import text
from pydantic import BaseModel
from datetime import datetime
from typing import List, Optional, Literal
import uuid, re
from ..auth_dep import require_team_or_higher, require_writer, require_admin
from ..database import get_db
from .. import models, schemas


router = APIRouter(prefix="/creatives", tags=["Creatives"])


# helpers

def resolve_user_name(db: Session, user_id: str | None) -> str | None:
    """
    Translate a TM_ / CR_ ID into the person’s name.
    Returns None for null / unknown / unsupported prefixes.
    """
    if not user_id:
        return None

    prefix = user_id[:2]
    if prefix == "CR":
        return (
            db.query(models.Creative.name)
              .filter(models.Creative.id == user_id)
              .scalar()
        )
    if prefix == "TM":
        return (
            db.query(models.Manager.name)           # table name is `team`
              .filter(models.Manager.id == user_id)
              .scalar()
        )
    return None

def list_writing_samples_for_creative(db: Session, creative_id: str
) -> list[schemas.WritingSampleListRow]:
    WS    = models.WritingSample
    WSC   = models.writing_sample_to_creative
    WSP   = models.writing_sample_to_project
    P     = models.Project
    WSSUB = models.sub_to_writing_sample

    subq = (
        db.query(
            WSSUB.c.writing_sample_id,
            func.count(WSSUB.c.sub_id).label("sub_count")
        )
        .group_by(WSSUB.c.writing_sample_id)
        .subquery()
    )

    q = (
        db.query(
            WS,                          # ← full model
            P.title.label("project_title"),
            func.coalesce(subq.c.sub_count, 0).label("sub_count"),
            WS.file_description,
        )
        .join(
            WSC,
            and_(
                WSC.c.writing_sample_id == WS.id,
                WSC.c.creative_id == creative_id,
                WSC.c.status == "active",
            ),
        )
        .outerjoin(
            WSP,
            and_(
                WSP.c.writing_sample_id == WS.id,
                WSP.c.status == "active",
            ),
        )
        .outerjoin(P, P.id == WSP.c.project_id)
        .outerjoin(subq, subq.c.writing_sample_id == WS.id)
        .order_by(P.title, WS.filename)
    )

    rows = []
    for ws, project_title, sub_count, file_desc in q.all():
        rows.append(
            schemas.WritingSampleListRow(
                id=ws.id,
                filename=ws.filename,
                file_type=ws.file_type,
                size_bytes=ws.size_bytes,
                uploaded_at=ws.uploaded_at,
                file_description = file_desc,
                project_title=project_title,
                sub_count=sub_count,
                uploaded_by=ws.uploaded_by,
                uploaded_by_name=resolve_user_name(db, ws.uploaded_by),
            )
        )
    return rows



SLUG_RE = re.compile(
    r"https?://(?:www\.)?imdb\.com/name/(?P<slug>nm\d+)(?:/|$)",
    flags=re.IGNORECASE
)

def extract_imdb_slug(url: str) -> str | None:
    """
    Given a full IMDb person URL or bare slug, return 'nm1234567', or None.
    """
    text = url.strip()
    # if they just passed 'nm1234567' alone, accept that too:
    if re.fullmatch(r"nm\d+", text):
        return text
    m = SLUG_RE.search(text)
    return m.group("slug") if m else None

@router.post("", status_code=201, response_model=schemas.CreativeRead, dependencies=[Depends(require_writer)])
def create_creative(
    payload: schemas.CreativeCreate,
    db: Session = Depends(get_db),
):
    """
    Insert a brand‑new creative.
    - Normalize incoming imdb_id down to the slug.
    - Reject if slug is malformed.
    - Reject with 409 if that slug already exists.
    """
    imdb_slug: str | None = None

    # ── normalize + validate IMDb slug ───────────────────────────────
    if payload.imdb_id:
        imdb_slug = extract_imdb_slug(payload.imdb_id)
        if not imdb_slug:
            raise HTTPException(
                status_code=400,
                detail="`imdb_id` must be a valid IMDb name URL (e.g. https://www.imdb.com/name/nm1234567/) or slug (`nm1234567`)."
            )

        # ── duplicate check ───────────────────────────────────
        existing = (
            db.query(models.Creative)
              .filter(models.Creative.imdb_id == imdb_slug)
              .first()
        )
        if existing:
            raise HTTPException(
                status_code=409,
                detail=f"A creative with IMDb ID {imdb_slug} already exists."
            )

    # ── create and persist ────────────────────────────────────────────
    new_creative = models.Creative(
        **payload.model_dump(exclude={"imdb_id"}),
        imdb_id=imdb_slug,
    )
    db.add(new_creative)
    db.commit()
    db.refresh(new_creative)
    return new_creative


@router.get(
    "",
    response_model=List[schemas.CreativeRead],
    dependencies=[Depends(require_team_or_higher)],
)
def list_creatives(
    client_status:       Optional[str]  = Query(None,  alias="client_status"),
    manager_id:          Optional[str]  = Query(None,  alias="manager_id"),
    unmanaged_by:        Optional[str]  = Query(None,  description="Exclude creatives already managed by this ID"),
    availability:        Optional[str]  = Query(None),
    tv_acceptable:       Optional[bool] = Query(None),
    is_writer:           Optional[bool] = Query(None),
    is_director:         Optional[bool] = Query(None),
    writer_level_bucket: Optional[str]  = Query(None),
    search:              Optional[str]  = Query(None,  alias="q", description="Case-insensitive name search"),
    db:                  Session        = Depends(get_db),
):
    """
    Returns creatives with *only Active* managers included on the `managers` relation.
    Any manager-based filters (`manager_id`, `unmanaged_by`) also consider only Active managers.
    """
    C = models.Creative
    M = models.Manager

    query = (
        db.query(C)
          .options(
              joinedload(C.managers),
              with_loader_criteria(M, M.status == "Active", include_aliases=True),
          )
    )

    # simple column filters
    if client_status:
        query = query.filter(C.client_status == client_status)
    if availability:
        query = query.filter(C.availability == availability)
    if tv_acceptable is not None:
        query = query.filter(C.tv_acceptable == tv_acceptable)
    if is_writer is not None:
        query = query.filter(C.is_writer == is_writer)
    if is_director is not None:
        query = query.filter(C.is_director == is_director)

    # manager / unmanaged filters (Active managers only)
    if manager_id:
        query = query.filter(
            C.managers.any(and_(M.id == manager_id, M.status == "Active"))
        )
    if unmanaged_by:
        query = query.filter(
            ~C.managers.any(and_(M.id == unmanaged_by, M.status == "Active"))
        )

    # writer-level buckets
    if writer_level_bucket:
        buckets = {
            "low":       (0, 4),
            "low_mid":   (0, 6),
            "mid":       (4, 6),
            "mid_upper": (4, 9),
            "upper":     (6, 9),
        }
        low, high = buckets.get(writer_level_bucket, (0, 9))
        query = query.filter(C.writer_level.between(low, high))

    # name search
    if search:
        query = query.filter(C.name.ilike(f"%{search}%"))

    return query.order_by(C.name).all()


@router.get("/{creative_id}", response_model=schemas.CreativeRead, dependencies=[Depends(require_team_or_higher)])
def get_creative(creative_id: str, db: Session = Depends(get_db)):
    """
    Returns a single creative with *only Active* managers in `managers`.
    """
    C = models.Creative
    M = models.Manager

    creative = (
        db.query(C)
          .options(
              joinedload(C.managers),
              with_loader_criteria(M, M.status == "Active", include_aliases=True),
          )
          .get(creative_id)
    )
    if not creative:
        raise HTTPException(404, "Creative not found")
    return creative

@router.patch("/{creative_id}", response_model=schemas.CreativeRead, dependencies=[Depends(require_writer)])
def update_creative(
    creative_id: str,
    payload: schemas.CreativeUpdate,
    db: Session = Depends(get_db)
):
    creative = db.query(models.Creative).get(creative_id)
    if not creative:
        raise HTTPException(404, "Creative not found")
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(creative, field, value)
    db.commit()
    db.refresh(creative)
    return creative


# GET duo mates for a creative
@router.get("/{creative_id}/duos", response_model=list[schemas.DuoMember], dependencies=[Depends(require_team_or_higher)])
def get_duo_mates(creative_id: str, db: Session = Depends(get_db)):
    """
    Return all members of any duo(s) that include this creative.
    Includes the creative themself; caller may filter out.
    """
    # Find duo IDs that include this creative
    subq = (
        db.query(models.creative_duo_members.c.duo_id)
        .filter(models.creative_duo_members.c.creative_id == creative_id)
        .subquery()
    )

    q = (
        db.query(
            models.creative_duo_members.c.duo_id,
            models.creative_duo_members.c.creative_id,
            models.Creative.name.label("creative_name"),
        )
        .join(models.Creative, models.Creative.id == models.creative_duo_members.c.creative_id)
        .filter(models.creative_duo_members.c.duo_id.in_(subq))
    )

    rows = q.all()
    return [
        schemas.DuoMember(
            duo_id=r.duo_id,
            creative_id=r.creative_id,
            creative_name=r.creative_name,
        )
        for r in rows
    ]




# Additional endpoints for assigning/removing managers:
@router.post("/{creative_id}/managers/{manager_id}", status_code=204, dependencies=[Depends(require_writer)])
def assign_manager(creative_id: str, manager_id: str, db: Session = Depends(get_db)):
    creative = db.get(models.Creative, creative_id)
    manager = db.get(models.Manager, manager_id)
    creative.managers.append(manager)
    db.commit()

@router.delete("/{creative_id}/managers/{manager_id}", status_code=204, dependencies=[Depends(require_writer)])
def unassign_manager(creative_id: str, manager_id: str, db: Session = Depends(get_db)):
    creative = db.get(models.Creative, creative_id)
    manager = db.get(models.Manager, manager_id)
    creative.managers.remove(manager)
    db.commit()


@router.get("/{creative_id}/survey", response_model=List[schemas.SurveyRow], dependencies=[Depends(require_team_or_higher)])
def get_survey(creative_id: str, db: Session = Depends(get_db)):
    # 1) find the (latest) survey for this creative
    survey = (
        db.query(models.Survey)
          .filter(models.Survey.creative_id == creative_id)
          .order_by(models.Survey.created_at.desc())
          .first()
    )
    if not survey:
        return []  # no survey record

    # 2) left-join every question to its response (if any)
    rows = (
        db.query(
            models.SurveyQuestion.prompt.label("question"),
            models.SurveyResponse.response.label("answer")
        )
        .outerjoin(
            models.SurveyResponse,
            and_(
                models.SurveyResponse.survey_id     == survey.id,
                models.SurveyResponse.question_key  == models.SurveyQuestion.key
            )
        )
        .order_by(models.SurveyQuestion.id)   # <— use `id` (exists) instead of `position`
        .all()
    )
    return rows


@router.patch("/{creative_id}/survey", status_code=204, dependencies=[Depends(require_writer)])
def upsert_survey(
    creative_id: str,
    payload: List[schemas.SurveyRow],
    db: Session = Depends(get_db),
):
    # Ensure list payload (the schema should already enforce this, but be defensive)
    if not isinstance(payload, list):
        raise HTTPException(status_code=422, detail="Body must be a list of {question, answer} rows.")

    # 1) Find or create the latest Survey row for this creative
    survey = (
        db.query(models.Survey)
          .filter(models.Survey.creative_id == creative_id)
          .order_by(models.Survey.created_at.desc())
          .first()
    )
    if survey is None:
        survey = models.Survey(
            creative_id=creative_id,
            created_at=datetime.utcnow(),
            updated_at=datetime.utcnow(),
        )
        db.add(survey)
        db.flush()  # populate survey.id (int4) without committing yet

    # 2) Upsert each response, keyed by SurveyQuestion.prompt -> SurveyQuestion.key
    for row in payload:
        q_key = (
            db.query(models.SurveyQuestion.key)
              .filter(models.SurveyQuestion.prompt == row.question)
              .scalar()
        )
        if not q_key:
            raise HTTPException(status_code=400, detail=f"Unknown question: {row.question}")

        existing = (
            db.query(models.SurveyResponse)
              .filter(
                  models.SurveyResponse.survey_id == survey.id,
                  models.SurveyResponse.question_key == q_key,
              )
              .one_or_none()
        )

        if existing:
            existing.response = row.answer
        else:
            db.add(models.SurveyResponse(
                survey_id=survey.id,      # int FK
                question_key=q_key,
                response=row.answer,
            ))

    # 3) Touch updated_at and commit atomically
    survey.updated_at = datetime.utcnow()
    db.commit()





# GET projects for a creative (lean ProjectMini list)
@router.get("/{creative_id}/projects", response_model=list[schemas.ProjectMini], dependencies=[Depends(require_team_or_higher)])
def get_projects_for_creative(creative_id: str, db: Session = Depends(get_db)):
    q = (
        db.query(
            models.Project.id,
            models.Project.title,
            models.Project.year,
            models.Project.media_type,
            models.Project.status,
        )
        .join(models.creative_project_roles, models.creative_project_roles.c.project_id == models.Project.id)
        .filter(models.creative_project_roles.c.creative_id == creative_id)
    )
    rows = q.all()
    return [
        schemas.ProjectMini(
            id=r.id,
            title=r.title,
            year=r.year,
            media_type=r.media_type,
            status=r.status,
        )
        for r in rows
    ]


# GET projects for a creative (with roles included)
@router.get("/{creative_id}/projects_roles",
            response_model=list[schemas.ProjectRoleRow], dependencies=[Depends(require_team_or_higher)])
def get_projects_roles_for_creative(
    creative_id: str,
    db: Session = Depends(get_db),
):
    PSR = models.ProjectSurveyResponse
    S   = models.Survey
    P   = models.Project
    R   = models.creative_project_roles

    # ── sub-query: newest response (via Survey.updated_at) per project ──
    psr_subq = (
        db.query(
            PSR.project_id.label("pid"),
            PSR.involvement_rating,
            PSR.interest_rating,
            func.row_number()
                .over(partition_by=PSR.project_id,
                      order_by=S.updated_at.desc())      # ← HERE
                .label("rn")
        )
        .join(S, S.id == PSR.survey_id)
        .filter(S.creative_id == creative_id)
    ).subquery()
    latest_psr = aliased(psr_subq)

    # ── main query ─────────────────────────────────────────────────────
    q = (
        db.query(
            R.c.project_id,
            P.title.label("project_title"),
            R.c.role,
            P.year,
            P.media_type,
            P.status,
            latest_psr.c.involvement_rating,
            latest_psr.c.interest_rating,
        )
        .join(P, P.id == R.c.project_id)
        .outerjoin(
            latest_psr,
            and_(latest_psr.c.pid == P.id, latest_psr.c.rn == 1)
        )
        .filter(R.c.creative_id == creative_id)
    )

    rows = q.all()
    return [
        schemas.ProjectRoleRow(
            project_id         = r.project_id,
            project_title      = r.project_title,
            role               = r.role,
            year               = r.year,
            media_type         = r.media_type,
            status             = r.status,
            involvement_rating = r.involvement_rating,
            interest_rating    = r.interest_rating,
        )
        for r in rows
    ]

# ------------------------------------------------------------------
# (A) PERSONAL PROJECTS – role = 'Creative Developer'
# ------------------------------------------------------------------
@router.get(
    "/{creative_id}/personal-projects",
    response_model=list[schemas.ProjectMini],
    dependencies=[Depends(require_team_or_higher)]
)
def list_creator_projects(creative_id: str, db: Session = Depends(get_db)):
    q = (
        db.query(models.Project)
          .join(
              models.creative_project_roles,
              and_(
                  models.creative_project_roles.c.project_id  == models.Project.id,
                  models.creative_project_roles.c.creative_id == creative_id,
                  models.creative_project_roles.c.role        == "Creative Developer",
              )
          )
          .order_by(models.Project.year.desc(), models.Project.title)
    )
    return q.all()


@router.post(
    "/{creative_id}/personal-projects/{project_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    dependencies=[Depends(require_writer)]
)
def add_personal_project(
    creative_id: str,
    project_id : str,
    db: Session = Depends(get_db),
):
    try:
        db.execute(
            models.creative_project_roles.insert().values(
                creative_id = creative_id,
                project_id  = project_id,
                role        = "Creative Developer",          # ← canonical personal-project role
            )
        )
        db.commit()
    except IntegrityError:
        # row already exists ⇒ OK (idempotent)
        db.rollback()


@router.delete(
    "/{creative_id}/personal-projects/{project_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    dependencies=[Depends(require_writer)]
)
def remove_personal_project(
    creative_id: str,
    project_id : str,
    db: Session = Depends(get_db),
):
    db.execute(
        models.creative_project_roles.delete().where(
            and_(
                models.creative_project_roles.c.creative_id == creative_id,
                models.creative_project_roles.c.project_id  == project_id,
                models.creative_project_roles.c.role        == "Creative Developer",
            )
        )
    )
    db.commit()


# ------------------------------------------------------------------
# (B) ALL *PAST* PROJECTS – any role, filter out future releases
# ------------------------------------------------------------------
@router.get(
    "/{creative_id}/projects",
    response_model=list[schemas.ProjectWithRole],
    dependencies=[Depends(require_team_or_higher)]
)
def list_past_projects(creative_id: str, db: Session = Depends(get_db)):

    # find the latest survey for this creative
    latest_survey = (
        db.query(models.Survey.id)
          .filter(models.Survey.creative_id == creative_id)
          .order_by(models.Survey.updated_at.desc())
          .limit(1)
          .scalar_subquery()
    )

    q = (
        db.query(
            models.Project.id,
            models.Project.title,
            models.Project.year,
            models.Project.media_type,
            models.Project.status,
            models.creative_project_roles.c.role.label("role"),
            models.ProjectSurveyResponse.involvement_rating,
            models.ProjectSurveyResponse.interest_rating,
        )
        .join(
            models.creative_project_roles,
            models.creative_project_roles.c.project_id == models.Project.id,
        )
        .outerjoin(
            models.ProjectSurveyResponse,
            and_(
                models.ProjectSurveyResponse.project_id == models.Project.id,
                models.ProjectSurveyResponse.survey_id  == latest_survey,
            ),
        )
        .filter(models.creative_project_roles.c.creative_id == creative_id)
        .filter(models.Project.status.in_(["Archived", "Sold"]))
        .order_by(
            cast(models.Project.year, Integer).desc(),
            models.Project.title
        )
    )
    return q.all()


class RolePayload(schemas.BaseModel):
    role: str                # e.g. "Writer", "Director", "Producer", …


@router.post(
    "/{creative_id}/projects/{project_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    dependencies=[Depends(require_writer)]
)
def assign_project_role(
    creative_id: str,
    project_id : str,
    payload: RolePayload,
    db: Session = Depends(get_db),
):
    try:
        db.execute(
            models.creative_project_roles.insert().values(
                creative_id = creative_id,
                project_id  = project_id,
                role        = payload.role,
            )
        )
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Role already exists for this creative & project.",
        )


@router.delete(
    "/{creative_id}/projects/{project_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    dependencies=[Depends(require_writer)]
)
def remove_project_role(
    creative_id: str,
    project_id : str,
    role: str | None = None,          # optional query-param;
                                       # if omitted we drop *all* roles for that pair
    db: Session = Depends(get_db),
):
    cond = and_(
        models.creative_project_roles.c.creative_id == creative_id,
        models.creative_project_roles.c.project_id  == project_id,
    )
    if role:
        cond = and_(cond, models.creative_project_roles.c.role == role)

    rows = db.execute(models.creative_project_roles.delete().where(cond)).rowcount
    db.commit()

    if rows == 0:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="No matching role found to delete.",
        )



# ────────────────────────────────────────────────────────────────
# WRITING SAMPLES – list for a single creative
# ────────────────────────────────────────────────────────────────
@router.get(
    "/{creative_id}/samples",
    response_model=list[schemas.WritingSampleListRow],
    dependencies=[Depends(require_team_or_higher)]
)
def list_creative_samples(creative_id: str, db: Session = Depends(get_db)):
    return list_writing_samples_for_creative(db, creative_id)



# ────────────────────────────────────────────────────────────────
# Subs – list for a single creative
# ────────────────────────────────────────────────────────────────
@router.get("/{creative_id}/subs", response_model=schemas.PagedSubs, dependencies=[Depends(require_team_or_higher)])
def list_creative_subs(
    creative_id: str,
    limit: int  = 50,
    offset: int = 0,
    since_days: int = 180,
    db: Session = Depends(get_db),
):
    """
    Subs linked to *this* creative via sub_to_client.creative_id.
    Uses sub_list_view for the row shape, and enriches with:
      - s.created_at (true subs timestamp)
      - recipients[] (typed, with company_id/company_name)
      - latest feedback mini (id/sentiment/text/created_at)
    """

    params = {"cid": creative_id, "since": since_days, "limit": limit, "offset": offset}

    # 1) COUNT — CTE must come first
    count_sql = text("""
      WITH recips AS (
        SELECT
          r.sub_id,
          json_agg(
            json_build_object(
              'id',          r.recipient_id,
              'type',        r.recipient_type,
              'name',
                CASE
                  WHEN r.recipient_type = 'executive'     THEN e.name
                  WHEN r.recipient_type = 'external_rep'  THEN xr.name
                  WHEN r.recipient_type = 'creative'      THEN c.name
                  ELSE NULL
                END,
              'company_id',   rc.id,
              'company_name', rc.name
            )
            ORDER BY r.recipient_type, r.recipient_id
          ) AS recipients
        FROM sub_recipients r
        LEFT JOIN executives            e  ON r.recipient_type = 'executive'    AND e.id  = r.recipient_id
        LEFT JOIN external_talent_reps  xr ON r.recipient_type = 'external_rep' AND xr.id = r.recipient_id
        LEFT JOIN creatives             c  ON r.recipient_type = 'creative'     AND c.id  = r.recipient_id
        LEFT JOIN LATERAL (
          SELECT id, name FROM tv_networks          WHERE id = r.recipient_company
          UNION ALL
          SELECT id, name FROM studios              WHERE id = r.recipient_company
          UNION ALL
          SELECT id, name FROM production_companies WHERE id = r.recipient_company
          UNION ALL
          SELECT id, name FROM external_agencies    WHERE id = r.recipient_company
        ) rc ON true
        GROUP BY r.sub_id
      )
      SELECT COUNT(*)
      FROM sub_list_view v
      JOIN sub_to_client sc ON sc.sub_id = v.sub_id
      JOIN subs s           ON s.id      = v.sub_id
      LEFT JOIN recips rj   ON rj.sub_id = v.sub_id
      WHERE sc.creative_id = :cid
        AND v.updated_at >= now() - (:since * interval '1 day')
    """)
    total = db.execute(count_sql, params).scalar_one()

    # 2) ITEMS — same CTE, plus latest-feedback LATERAL
    items_sql = text("""
      WITH recips AS (
        SELECT
          r.sub_id,
          json_agg(
            json_build_object(
              'id',          r.recipient_id,
              'type',        r.recipient_type,
              'name',
                CASE
                  WHEN r.recipient_type = 'executive'     THEN e.name
                  WHEN r.recipient_type = 'external_rep'  THEN xr.name
                  WHEN r.recipient_type = 'creative'      THEN c.name
                  ELSE NULL
                END,
              'company_id',   rc.id,
              'company_name', rc.name
            )
            ORDER BY r.recipient_type, r.recipient_id
          ) AS recipients
        FROM sub_recipients r
        LEFT JOIN executives            e  ON r.recipient_type = 'executive'    AND e.id  = r.recipient_id
        LEFT JOIN external_talent_reps  xr ON r.recipient_type = 'external_rep' AND xr.id = r.recipient_id
        LEFT JOIN creatives             c  ON r.recipient_type = 'creative'     AND c.id  = r.recipient_id
        LEFT JOIN LATERAL (
          SELECT id, name FROM tv_networks          WHERE id = r.recipient_company
          UNION ALL
          SELECT id, name FROM studios              WHERE id = r.recipient_company
          UNION ALL
          SELECT id, name FROM production_companies WHERE id = r.recipient_company
          UNION ALL
          SELECT id, name FROM external_agencies    WHERE id = r.recipient_company
        ) rc ON true
        GROUP BY r.sub_id
      )
      SELECT
        s.created_at AS created_at,        -- ensure FE gets the true Sub timestamp
        v.*,
        COALESCE(rj.recipients, '[]'::json)           AS recipients,
        fb.id                                         AS feedback_id,
        CASE
          WHEN fb.sentiment IS NULL     THEN NULL
          WHEN fb.sentiment = 'positive' THEN 'positive'
          ELSE 'not positive'
        END                                           AS feedback_sentiment,
        fb.feedback_text                              AS feedback_text,
        fb.created_at                                 AS feedback_created_at
      FROM sub_list_view v
      JOIN sub_to_client sc ON sc.sub_id = v.sub_id
      JOIN subs s           ON s.id      = v.sub_id
      LEFT JOIN recips rj   ON rj.sub_id = v.sub_id
      LEFT JOIN LATERAL (
        SELECT sf.id, sf.sentiment, sf.feedback_text, sf.created_at
        FROM sub_feedback sf
        WHERE sf.sub_id = v.sub_id
        ORDER BY sf.created_at DESC
        LIMIT 1
      ) fb ON true
      WHERE sc.creative_id = :cid
        AND v.updated_at >= now() - (:since * interval '1 day')
      ORDER BY v.updated_at DESC
      LIMIT :limit OFFSET :offset
    """)
    rows = db.execute(items_sql, params).mappings().all()

    # Optional 404 when creative doesn’t exist (keep your existing behavior if you like)
    if not rows and total == 0:
        exists = db.execute(text("SELECT 1 FROM creatives WHERE id = :cid"), {"cid": creative_id}).first()
        if not exists:
            raise HTTPException(404, "Creative not found")

    return {"total": total, "items": rows}





# ────────────────────────────────────────────────────────────────
# Quick existence check for given IMDb URL in 'creatives'
# ────────────────────────────────────────────────────────────────
@router.get("/exists_imdb/{slug}", dependencies=[Depends(require_team_or_higher)])
def creative_exists_by_imdb(
    slug: str,
    db: Session = Depends(get_db),
):
    """
    Quick existence check for Add‑Person modal.
    """
    row = (
        db.query(models.Creative.id, models.Creative.name)
          .filter(models.Creative.imdb_id == slug)
          .first()
    )
    return {"exists": bool(row), "name": row.name if row else None}




# Update involvement/interest ratings
class RatingPatch(BaseModel):
    field: Literal["involvement", "interest"]   # which column
    value: int | None                           # 4-1 or null (clears)

@router.patch(
    "/{creative_id}/project-ratings/{project_id}",
    status_code=204,
    dependencies=[Depends(require_writer)]
)
def update_project_rating(
    creative_id: str,
    project_id: str,
    payload: RatingPatch,
    db: Session = Depends(get_db),
):
    """
    Upsert the *latest* ProjectSurveyResponse row for this
    (creative × project) pair, touching only the requested field.
    """
    # 1) locate the most-recent survey for this creative
    latest_survey_id = (
        db.query(models.Survey.id)
          .filter(models.Survey.creative_id == creative_id)
          .order_by(models.Survey.updated_at.desc())
          .limit(1)
          .scalar()
    )
    if latest_survey_id is None:
        raise HTTPException(404, "No survey found for this creative")

    # 2) find or create the PSR row
    psr = (
        db.query(models.ProjectSurveyResponse)
          .filter_by(survey_id=latest_survey_id, project_id=project_id)
          .one_or_none()
    )
    if psr is None:
        psr = models.ProjectSurveyResponse(
            survey_id=latest_survey_id,
            project_id=project_id,
        )
        db.add(psr)

    # 3) update the requested column
    if payload.field == "involvement":
        psr.involvement_rating = payload.value
    else:  # "interest"
        psr.interest_rating = payload.value

    db.commit()
