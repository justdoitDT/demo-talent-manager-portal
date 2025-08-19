# backend/app/routers/companies.py

from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, Path, Query
from pydantic import BaseModel
from sqlalchemy import select, literal_column, func
from sqlalchemy.orm import Session
from sqlalchemy.exc import IntegrityError
from collections import defaultdict
from ..database import get_db
from .. import models, schemas
from ..auth_dep import require_team_or_higher, require_writer, require_admin


router = APIRouter(prefix="/companies", tags=["Companies"])



# GET all executives at a given company
@router.get(
    "/{company_id}/links",
    response_model=list[schemas.ExecutiveAtCompanyRow],
    dependencies=[Depends(require_team_or_higher)]
)
def list_exec_links_for_company(
    company_id: str = Path(..., description="ID that starts with NW_, ST_ or PC_"),
    status: str | None = Query(None, pattern="^(Active|Archived)$"),
    db: Session = Depends(get_db),
):
    if company_id.startswith("NW_"):
        Link, fk = models.executives_to_tv_networks, models.executives_to_tv_networks.c.network_id
    elif company_id.startswith("ST_"):
        Link, fk = models.executives_to_studios, models.executives_to_studios.c.studio_id
    elif company_id.startswith("PC_"):
        Link, fk = models.executives_to_production_companies, models.executives_to_production_companies.c.production_company_id
    else:
        raise HTTPException(400, "Unknown company prefix")

    stmt = (
        select(
            models.Executive.id.label("executive_id"),
            models.Executive.name.label("executive_name"),
            models.Executive.email,
            models.Executive.phone,
            Link.c.status,
            Link.c.title,
            Link.c.last_modified,
        )
        # ✅ Select-level join (don’t call .join on the ORM class)
        .select_from(models.Executive)
        .join(Link, Link.c.executive_id == models.Executive.id)
        .where(fk == company_id)
        .order_by(models.Executive.name.asc(), Link.c.status.desc(), Link.c.last_modified.desc())
    )
    if status:
        stmt = stmt.where(Link.c.status == status)

    rows = db.execute(stmt).all()
    return [
        schemas.ExecutiveAtCompanyRow(
            executive_id   = r.executive_id,
            executive_name = r.executive_name,
            email          = r.email,
            phone          = r.phone,
            status         = r.status,
            title          = r.title,
            last_modified  = r.last_modified,
        )
        for r in rows
    ]




# GET all projects for a given company
@router.get(
    "/{company_id}/projects",
    response_model=list[schemas.CompanyProjectRow],
    dependencies=[Depends(require_team_or_higher)],
    summary="Projects linked to a company (network / studio / prodco) + sub counts"
)
def list_projects_for_company(
    company_id: str = Path(..., description="NW_, ST_, or PC_"),
    db: Session = Depends(get_db),
):
    # Pick the link table for this company type
    if company_id.startswith("NW_"):
        Link, fk = models.project_to_tv_networks, models.project_to_tv_networks.c.network_id
    elif company_id.startswith("ST_"):
        Link, fk = models.project_to_studios, models.project_to_studios.c.studio_id
    elif company_id.startswith("PC_"):
        Link, fk = models.project_to_production_companies, models.project_to_production_companies.c.production_company_id
    else:
        raise HTTPException(400, "Unsupported company id prefix")

    P   = models.Project
    S   = models.Sub
    PT  = models.ProjectType
    P2T = models.project_to_project_type

    # one row per project with sub_count
    base_rows = (
        db.query(
            P.id,
            P.title,
            P.year,
            P.tracking_status,
            P.engagement,
            func.count(S.id).label("sub_count"),
        )
        .join(Link, Link.c.project_id == P.id)
        .filter(fk == company_id)
        .filter(Link.c.status == "Active")
        .outerjoin(S, S.project_id == P.id)
        .group_by(P.id, P.title, P.year, P.tracking_status, P.engagement)
        .order_by(P.title.asc())
        .all()
    )

    ids = [r.id for r in base_rows]
    by_pid_types: dict[str, list[str]] = defaultdict(list)
    if ids:
        type_rows = (
            db.query(P2T.c.project_id, PT.type)
              .join(PT, PT.id == P2T.c.type_id)
              .filter(P2T.c.project_id.in_(ids), P2T.c.status == "Active")
              .all()
        )
        for pid, t in type_rows:
            by_pid_types[pid].append(t)

    return [
        schemas.CompanyProjectRow(
            id=r.id,
            title=r.title,
            year=r.year,
            tracking_status=r.tracking_status,
            engagement=r.engagement,
            project_types=sorted(by_pid_types.get(r.id, [])),
            sub_count=int(r.sub_count or 0),
        )
        for r in base_rows
    ]





# ─────────────────────────── READ (list) ────────────────────────────
@router.get("/tv_networks", response_model=List[schemas.TVNetwork], dependencies=[Depends(require_team_or_higher)])
def list_tv_networks(
    q: Optional[str] = Query(None, description="Optional case‑insensitive name filter"),
    db: Session = Depends(get_db),
):
    stmt = db.query(models.TVNetwork)
    if q:
        stmt = stmt.filter(models.TVNetwork.name.ilike(f"%{q}%"))
    return stmt.order_by(models.TVNetwork.name).all()

@router.get("/studios", response_model=List[schemas.Studio], dependencies=[Depends(require_team_or_higher)])
def list_studios(
    q: Optional[str] = Query(None, description="Optional case‑insensitive name filter"),
    db: Session = Depends(get_db),
):
    stmt = db.query(models.Studio)
    if q:
        stmt = stmt.filter(models.Studio.name.ilike(f"%{q}%"))
    return stmt.order_by(models.Studio.name).all()

@router.get("/production_companies", response_model=List[schemas.ProductionCompany], dependencies=[Depends(require_team_or_higher)])
def list_prodcos(
    q: Optional[str] = Query(None, description="Optional case‑insensitive name filter"),
    db: Session = Depends(get_db),
):
    stmt = db.query(models.ProductionCompany)
    if q:
        stmt = stmt.filter(models.ProductionCompany.name.ilike(f"%{q}%"))
    return stmt.order_by(models.ProductionCompany.name).all()

@router.get("/external_agencies", response_model=List[schemas.ExternalAgency], dependencies=[Depends(require_team_or_higher)])
def list_agencies(
    q: Optional[str] = Query(None, description="Optional case‑insensitive name filter"),
    db: Session = Depends(get_db),
):
    stmt = db.query(models.ExternalAgency)
    if q:
        stmt = stmt.filter(models.ExternalAgency.name.ilike(f"%{q}%"))
    return stmt.order_by(models.ExternalAgency.name).all()



# ─────────────────────────── CREATE ────────────────────────────────
@router.post("/tv_networks", status_code=201, response_model=schemas.TVNetwork, dependencies=[Depends(require_writer)])
def create_tv_network(
    payload: schemas.TVNetworkCreate,
    db: Session = Depends(get_db),
):
    row = models.TVNetwork(**payload.model_dump())
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


@router.post("/studios", status_code=201, response_model=schemas.Studio, dependencies=[Depends(require_writer)])
def create_studio(
    payload: schemas.StudioCreate,
    db: Session = Depends(get_db),
):
    row = models.Studio(**payload.model_dump())
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


@router.post("/production_companies", status_code=201, response_model=schemas.ProductionCompany, dependencies=[Depends(require_writer)])
def create_prodco(
    payload: schemas.ProductionCompanyCreate,
    db: Session = Depends(get_db),
):
    row = models.ProductionCompany(**payload.model_dump())
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


@router.post("/external_agencies", status_code=201, response_model=schemas.ExternalAgency, dependencies=[Depends(require_writer)])
def create_external_agency(
    payload: schemas.ExternalAgencyCreate,
    db: Session = Depends(get_db),
):
    row = models.ExternalAgency(**payload.model_dump())
    db.add(row)
    db.commit()
    db.refresh(row)
    return row





# ─────────────────────────── READ (single) ──────────────────────────

@router.get(
    "/{company_id}",
    response_model=schemas.CompanyMini,
    summary="Fetch a single company (network / studio / prodco / agency) by id",
    dependencies=[Depends(require_team_or_higher)]
)
def get_company(
    company_id: str = Path(..., description="NW_, ST_, PC_ or AG_ prefix"),
    db: Session = Depends(get_db),
):
    table_map = {
        "NW_": models.TVNetwork,
        "ST_": models.Studio,
        "PC_": models.ProductionCompany,
        "AG_": models.ExternalAgency,          # if you ever need agencies here
    }
    for prefix, Model in table_map.items():
        if company_id.startswith(prefix):
            row = db.get(Model, company_id)
            if not row:
                raise HTTPException(404, "Company not found")
            return {"id": row.id, "name": row.name}

    # unknown prefix
    raise HTTPException(400, "Unsupported company id prefix")







# ─────────────────────────── UPDATE / DELETE (single) ──────────────────────────
class CompanyUpdate(BaseModel):
  name: str

def _resolve_company_model(company_id: str):
  if company_id.startswith("NW_"): return models.TVNetwork
  if company_id.startswith("ST_"): return models.Studio
  if company_id.startswith("PC_"): return models.ProductionCompany
  if company_id.startswith("AG_"): return models.ExternalAgency
  return None

@router.patch(
    "/{company_id}",
    response_model=schemas.CompanyMini,
    dependencies=[Depends(require_writer)]
)
def update_company(company_id: str, payload: CompanyUpdate, db: Session = Depends(get_db)):
    Model = _resolve_company_model(company_id)
    if not Model:
        raise HTTPException(400, "Unsupported company id prefix")
    row = db.get(Model, company_id)
    if not row:
        raise HTTPException(404, "Company not found")
    row.name = payload.name
    db.commit()
    db.refresh(row)
    return {"id": row.id, "name": row.name}

@router.delete(
    "/{company_id}",
    status_code=204,
    dependencies=[Depends(require_admin)]
)
def delete_company(company_id: str, db: Session = Depends(get_db)):
    Model = _resolve_company_model(company_id)
    if not Model:
        raise HTTPException(400, "Unsupported company id prefix")
    row = db.get(Model, company_id)
    if not row:
        return  # idempotent
    try:
        db.delete(row)
        db.commit()
    except IntegrityError as e:
        db.rollback()
        # Likely FK references from projects/executives/etc.
        raise HTTPException(status_code=409, detail="Cannot delete: other records still reference this company.")