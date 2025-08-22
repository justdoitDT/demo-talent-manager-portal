# backend/app/ai/recommend_client_for_project_need/router.py

from datetime import datetime, timezone
from typing import List
from io import BytesIO


from fastapi import APIRouter, Body, Depends, HTTPException, Query, Response
from fastapi.responses import StreamingResponse

from pydantic import BaseModel
from sqlalchemy import text, select
from sqlalchemy.orm import Session

from reportlab.lib.pagesizes import LETTER
from reportlab.lib.units import inch
from reportlab.lib import colors
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle,
    ListFlowable, ListItem, PageBreak)
from xml.sax.saxutils import escape as _xml_escape

from ... import models
from ...auth_dep import require_admin, require_team_or_higher, require_writer
from ...database import get_db

# Single-need (forward) recs
from .pipeline import run_pipeline
from .cache import get_latest_result

# Creative (reverse) recs
from .reverse_pipeline import run_reverse_pipeline
from .reverse_filters import (
    canonical_media_list,
    canonical_qual_list,
    MEDIA_ORDER,
    QUAL_ORDER,
)

# Embeddings rebuild helpers
from app.ai.recommend_client_for_project_need.nightly import rebuild_client_embeddings
from .project_context import rebuild_need_embeddings

# Creative reverse-results cache access
from .creative_need_cache import get_latest as get_cnr_latest


router = APIRouter(prefix="/ai/recommendations", tags=["AI Recs"])


def _normalize_ranked(rows):
    out = []
    for r in (rows or []):
        # prefer existing alias; else map from qualifications-ish keys
        nq = r.get("need_qual") or r.get("qualifications") or r.get("need_qualifications")
        if nq is not None:
            r = {**r, "need_qual": nq}
        out.append(r)
    return out


# =============================================================================
# Forward (single-need) endpoints
# =============================================================================

@router.post("/needs/{need_id}/rank", dependencies=[Depends(require_writer)])
def rank_need(need_id: str, db: Session = Depends(get_db)):
    """Run the forward ranking pipeline for a single need and return the result payload."""
    return run_pipeline(db, need_id)


@router.get("/needs/{need_id}/latest", dependencies=[Depends(require_team_or_higher)])
def latest_need(need_id: str, db: Session = Depends(get_db)):
    """Return the most recently cached result for a need (404 if none)."""
    res = get_latest_result(db, need_id)
    if not res:
        raise HTTPException(status_code=404, detail="No cached result.")
    return res


# =============================================================================
# Backfill / batch
# =============================================================================

class BackfillRequest(BaseModel):
    tracking_statuses: List[str] = ["Active", "Priority Tracking", "Tracking"]
    limit: int = 50
    dry_run: bool = False
    reprocess_existing: bool = False


def _count_remaining(db: Session, ts: List[str], reprocess_existing: bool) -> int:
    """Count eligible needs remaining (raw SQL, enum->text)."""
    if reprocess_existing:
        sql = """
          SELECT COUNT(*)
          FROM project_needs n
          JOIN projects p ON p.id = n.project_id
          WHERE n.status = 'Active'
            AND p.tracking_status::text = ANY(:ts)
        """
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
    return int(db.execute(text(sql), {"ts": ts}).scalar() or 0)


@router.post("/backfill/needs", dependencies=[Depends(require_admin)])
def backfill_needs(payload: BackfillRequest = Body(default=None),
                   db: Session = Depends(get_db)):
    """Process a batch of needs and return progress counts."""
    payload = payload or BackfillRequest()
    ts = payload.tracking_statuses

    remaining_before = _count_remaining(db, ts, payload.reprocess_existing)
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
        text(select_sql), {"ts": ts, "limit": payload.limit}
    ).scalars().all()

    if payload.dry_run:
        return {
            "summary": {
                "processed": len(need_ids),
                "generated": 0,
                "skipped": 0,
                "remaining_before": remaining_before,
                "remaining_after": remaining_before,
                "tracking_statuses": ts,
                "limit": payload.limit,
                "reprocess_existing": payload.reprocess_existing,
            },
            "needs": need_ids,
            "errors": [],
        }

    generated = 0
    errors: List[dict] = []
    for nid in need_ids:
        try:
            run_pipeline(db, nid)
            generated += 1
        except Exception as e:  # noqa: BLE001
            errors.append({"need_id": nid, "error": str(e)})

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


# =============================================================================
# Embeddings management
# =============================================================================

@router.get("/embeddings/clients/{creative_id}/status", dependencies=[Depends(require_team_or_higher)])
def embedding_status(creative_id: str, db: Session = Depends(get_db)):
    row = db.execute(
        text("SELECT updated_at FROM creative_embeddings WHERE creative_id = :cid"),
        {"cid": creative_id},
    ).first()
    if not row:
        return {"exists": False, "updated_at": None}

    dt = row[0]
    if getattr(dt, "tzinfo", None) is None:
        dt = dt.replace(tzinfo=timezone.utc)
    else:
        dt = dt.astimezone(timezone.utc)

    return {"exists": True, "updated_at": dt.isoformat()}


@router.post("/embeddings/clients/rebuild", dependencies=[Depends(require_writer)])
def rebuild_clients(db: Session = Depends(get_db)):
    """Rebuild embeddings for all eligible creatives."""
    rebuild_client_embeddings(db)
    return {"status": "ok"}


@router.post("/embeddings/clients/{creative_id}/rebuild", dependencies=[Depends(require_writer)])
def rebuild_client_one(creative_id: str, db: Session = Depends(get_db)):
    """Rebuild embedding for one creative."""
    rebuild_client_embeddings(db, creative_ids=[creative_id])
    return {"status": "ok"}


@router.post("/embeddings/needs/rebuild", dependencies=[Depends(require_writer)])
def rebuild_needs(only_missing: bool = True,
                  limit: int | None = None,
                  db: Session = Depends(get_db)):
    n = rebuild_need_embeddings(db, only_missing=only_missing, limit=limit)
    return {"rebuilt": n, "only_missing": only_missing, "limit": limit}


# =============================================================================
# Reverse (single-creative) endpoints
# =============================================================================

# ---- Latest (for a specific filter-set) ----
@router.get("/creatives/{creative_id}/needs/latest", dependencies=[Depends(require_team_or_higher)])
def creative_needs_latest(
    creative_id: str,
    media: List[str] = Query(default=list(MEDIA_ORDER)),
    quals: List[str] = Query(default=list(QUAL_ORDER)),
    include_archived: bool = Query(default=True),
    db: Session = Depends(get_db),
):
    """Return latest cached reverse result for this creative + filters (404 if none)."""
    media_canon = canonical_media_list(media)
    quals_canon = canonical_qual_list(quals)

    res, ts = get_cnr_latest(db, creative_id, {
        "media_type_filter": media_canon,
        "qualifications_filter": quals_canon,
        "include_archived": include_archived,
    })
    if not res:
        raise HTTPException(status_code=404, detail="No cached result.")

    def _normalize_ranked(rows: list[dict] | None) -> list[dict]:
        out = []
        for r in rows or []:
            need_id = r.get("need_id") or r.get("best_need_id") or r.get("id")
            need_ql = (
                r.get("need_qual")
                or r.get("best_need_qualification")
                or r.get("qualifications")
            )
            out.append({
                "need_id":       need_id,
                "project_id":    r.get("project_id"),
                "project_title": r.get("project_title"),
                "media_type":    r.get("media_type"),
                "need_qual":     need_ql,
                "sim":           float(r.get("sim") or 0.0),
                **({"justification": r.get("justification")} if r.get("justification") is not None else {}),
            })
        return out

    out = res.copy()
    out["ranked"]  = _normalize_ranked(out.get("ranked"))
    out["filters"] = {
        "media_type_filter": media_canon, 
        "qualifications_filter": quals_canon,
        "include_archived": include_archived,
    }
    return {"run_started_at": ts, **out}



# ---- Lookup cached result by filter combo (faster path for the modal) ----
class LookupRequest(BaseModel):
    media_type_filter: List[str]
    qualifications_filter: List[str]
    include_archived: bool = True


def _json_rows(db: Session, creative_id: str):
    # Grab a handful of recent rows for this creative; match in Python.
    Q = text("""
        SELECT id, params_json, results_json as results, run_started_at
        FROM creative_need_recommendations
        WHERE creative_id = :cid
        ORDER BY COALESCE(run_started_at, created_at) DESC
        LIMIT 100
    """)
    return db.execute(Q, {"cid": creative_id}).mappings().all()


def _same_list(a, b) -> bool:
    return isinstance(a, list) and isinstance(b, list) and a == b


@router.post("/creatives/{creative_id}/needs/lookup", dependencies=[Depends(require_team_or_higher)])
def creative_needs_lookup(creative_id: str, body: LookupRequest, db: Session = Depends(get_db)):
    """Return cached reverse result if an identical filter-set exists; 404 otherwise."""
    media_canon = canonical_media_list(body.media_type_filter or [])
    qual_canon  = canonical_qual_list(body.qualifications_filter or [])
    include_canon = bool(body.include_archived)

    def _normalize_ranked(rows: list[dict] | None) -> list[dict]:
        out = []
        for r in rows or []:
            need_id = r.get("need_id") or r.get("best_need_id") or r.get("id")
            need_ql = (
                r.get("need_qual")
                or r.get("best_need_qualification")
                or r.get("qualifications")
            )
            out.append({
                "need_id":       need_id,
                "project_id":    r.get("project_id"),
                "project_title": r.get("project_title"),
                "media_type":    r.get("media_type"),
                "need_qual":     need_ql,
                "sim":           float(r.get("sim") or 0.0),
                **({"justification": r.get("justification")} if r.get("justification") is not None else {}),
            })
        return out

    rows = _json_rows(db, creative_id)
    for r in rows:
        params  = (r.get("params_json") or {})
        results = (r.get("results") or {})
        filters = params if "media_type_filter" in params else (results.get("filters") or {})

        mt_row = canonical_media_list(filters.get("media_type_filter") or [])
        qf_row = canonical_qual_list(filters.get("qualifications_filter") or [])
        inc_row = bool(filters.get("include_archived")) if "include_archived" in filters else True

        if mt_row == media_canon and qf_row == qual_canon:
            out = results.copy()
            out["ranked"]  = _normalize_ranked(out.get("ranked"))
            out["filters"] = {
                "media_type_filter": mt_row, 
                "qualifications_filter": qf_row,
                "include_archived": inc_row,
            }
            out.setdefault("run_started_at", r.get("run_started_at"))
            return out

    raise HTTPException(status_code=404, detail="No cached recommendations for this filter set")


# ---- Rank now (optionally refresh creative embedding first) ----
class RankRequest(BaseModel):
    # media flags
    mt_feature: bool
    mt_tv: bool
    mt_play: bool
    mt_other: bool
    # qual flags
    q_owa: bool
    q_oda: bool
    q_staff: bool
    q_dir: bool
    # optional expansions (unused server-side but harmless)
    writer_qual_list: List[str] = []
    director_qual_list: List[str] = []
    # options
    limit: int = 30
    refresh_embedding: bool = False
    include_archived: bool = True


def _has_any_credit(db: Session, creative_id: str) -> bool:
    stmt = (
        select(models.creative_project_roles.c.project_id)
        .where(models.creative_project_roles.c.creative_id == creative_id)
        .limit(1)
    )
    return db.execute(stmt).first() is not None


@router.post("/creatives/{creative_id}/needs/rank", dependencies=[Depends(require_writer)])
def creative_needs_rank(
    creative_id: str,
    body: RankRequest,
    db: Session = Depends(get_db),
):
    """
    Reverse recs for a creative.
    Gate on *credits* only; (re)build embeddings outside the pipeline.
    """
    # Require at least one credit row (any role)
    if not _has_any_credit(db, creative_id):
        imdb_id = (
            db.query(models.Creative.imdb_id)
              .filter(models.Creative.id == creative_id)
              .scalar()
        )
        raise HTTPException(
            status_code=400,
            detail={
                "code": "NO_CREDITS",
                "message": "Creative has no credits. Scrape IMDb first.",
                "imdb_id": imdb_id,
            },
        )

    # Build filters
    media_list: List[str] = []
    if body.mt_feature: media_list.append("Feature")
    if body.mt_tv:      media_list.append("TV Series")
    if body.mt_play:    media_list.append("Play")
    if body.mt_other:   media_list.append("Other")

    quals_list: List[str] = []
    if body.q_owa:   quals_list.append("OWA")
    if body.q_oda:   quals_list.append("ODA")
    if body.q_staff: quals_list.append("Staff Writer")
    if body.q_dir:   quals_list.append("Director")

    # Optional pre-refresh of client embeddings
    if getattr(body, "refresh_embedding", False):
        try:
            rebuild_client_embeddings(db, creative_ids=[creative_id])
        except Exception as e:  # non-fatal
            print(f"[warn] pre-refresh embeddings failed for {creative_id}: {e}")

    # Run pipeline (no refresh_embedding kw)
    res = run_reverse_pipeline(
        db=db,
        creative_id=creative_id,
        media_filter=media_list,
        quals_filter=quals_list,
        limit_projects=body.limit,
        include_archived=bool(body.include_archived),
    )

    # If pipeline complains about missing embedding, rebuild once and retry
    if res.get("error") == "No client embedding. Update AI Profile first." and not getattr(body, "refresh_embedding", False):
        try:
            rebuild_client_embeddings(db, creative_ids=[creative_id])
            res = run_reverse_pipeline(
                db=db,
                creative_id=creative_id,
                media_filter=media_list,
                quals_filter=quals_list,
                limit_projects=body.limit,
                include_archived=bool(body.include_archived),
            )
        except Exception as e:
            print(f"[warn] retry after embedding rebuild failed for {creative_id}: {e}")

    # Ensure a timestamp for the UI
    res.setdefault("run_started_at", datetime.now(timezone.utc).isoformat())
    res["ranked"] = _normalize_ranked(res.get("ranked"))
    db.commit()
    return res








# ──────────────────────────────────────────────────────────────────────────────
# PDF: Project Recommendations report
# ──────────────────────────────────────────────────────────────────────────────

class RecRow(BaseModel):
    project_id: str
    need_id: str | None = None
    justification: str | None = None
    sim: float | None = None
    need_qual: str | None = None

class ProjectRecsReportRequest(BaseModel):
    creative_id: str
    project_ids: list[str]          # in the exact order as the UI table
    include_archived: bool = False  # if false, filter out tracking_status = "Archived"
    recs: list[RecRow] = []

def _fetch_creative_name(db: Session, creative_id: str) -> str:
    row = db.execute(text("SELECT name FROM creatives WHERE id = :cid"), {"cid": creative_id}).first()
    return row[0] if row else creative_id


def _fetch_project_bundle(db: Session, project_id: str) -> dict:
    """Collect all data needed for one project section (matches dynamic page fields)."""
    core = db.execute(
        text("""
        SELECT
            p.id,
            p.title,
            p.media_type::text        AS media_type,
            p.tracking_status::text   AS tracking_status,
            p.description,
            p.updates,
            p.engagement,
            p.creatives_attached_note
        FROM projects p
        WHERE p.id = :pid
        """),
        {"pid": project_id},
    ).mappings().first()

    if not core:
        return {"id": project_id, "missing": True}

    # Needs (all attached)
    needs_struct = db.execute(
        text("""
        SELECT id, qualifications, description, status::text AS status
        FROM project_needs
        WHERE project_id = :pid
        ORDER BY id
        """),
        {"pid": project_id},
    ).mappings().all()
    needs = [
        {
            "qualifications": n["qualifications"],
            "description": n["description"],
            "status": n["status"],
        }
        for n in needs_struct
    ]

    # Genres
    genres_struct = db.execute(
        text("""
        SELECT g.id, g.name
        FROM genre_tags g
        JOIN project_genre_tags j ON j.tag_id = g.id
        WHERE j.project_id = :pid
        ORDER BY g.name
        """),
        {"pid": project_id},
    ).mappings().all()
    genres = [g["name"] for g in genres_struct]

    # Companies (Active links only)
    tv_networks_struct = db.execute(
        text("""
        SELECT n.id, n.name
        FROM tv_networks n
        JOIN project_to_tv_networks j ON j.network_id = n.id
        WHERE j.project_id = :pid AND j.status = 'Active'
        ORDER BY n.name
        """),
        {"pid": project_id},
    ).mappings().all()
    studios_struct = db.execute(
        text("""
        SELECT s.id, s.name
        FROM studios s
        JOIN project_to_studios j ON j.studio_id = s.id
        WHERE j.project_id = :pid AND j.status = 'Active'
        ORDER BY s.name
        """),
        {"pid": project_id},
    ).mappings().all()
    prodcos_struct = db.execute(
        text("""
        SELECT c.id, c.name
        FROM production_companies c
        JOIN project_to_production_companies j ON j.production_company_id = c.id
        WHERE j.project_id = :pid AND j.status = 'Active'
        ORDER BY c.name
        """),
        {"pid": project_id},
    ).mappings().all()

    tv_networks = [n["name"] for n in tv_networks_struct]
    studios    = [s["name"] for s in studios_struct]
    prodcos    = [p["name"] for p in prodcos_struct]

    # Executives (Active links only)
    executives_struct = db.execute(
        text("""
        SELECT e.id, e.name
        FROM executives e
        JOIN project_to_executives j ON j.executive_id = e.id
        WHERE j.project_id = :pid AND j.status = 'Active'
        ORDER BY e.name
        """),
        {"pid": project_id},
    ).mappings().all()
    executives = [e["name"] for e in executives_struct]

    # Notes linked to the project
    notes = db.execute(
        text("""
        SELECT n.note, n.created_at
        FROM notes n
        JOIN note_links l ON l.note_id = n.id
        WHERE l.noteable_id = :pid
          AND lower(l.noteable_type) = 'project'
        ORDER BY n.created_at DESC
        """),
        {"pid": project_id},
    ).mappings().all()

    return {
        **dict(core),
        # plain-name arrays (used for simple display)
        "tv_networks": tv_networks,
        "studios": studios,
        "prodcos": prodcos,
        "executives": executives,
        "genres": genres,
        "needs": needs,
        # structured arrays (clickable on dynamic page; harmless for PDF)
        "tv_networks_struct": tv_networks_struct,
        "studios_struct": studios_struct,
        "prodcos_struct": prodcos_struct,
        "executives_struct": executives_struct,
        "genres_struct": genres_struct,
        "needs_struct": needs_struct,
        # notes
        "notes": notes,
    }


def _pdf_header_footer(canvas, doc, title: str):
    canvas.saveState()
    w, h = LETTER
    canvas.setFont("Helvetica", 9)
    canvas.setFillColorRGB(0.03, 0.41, 0.22)  # deep green accent
    canvas.drawString(inch * 0.7, h - 0.6 * inch, title)
    canvas.setFillColorRGB(0, 0, 0)
    canvas.drawRightString(w - inch * 0.7, 0.5 * inch, f"Page {doc.page}")
    canvas.restoreState()


def _build_project_story(p: dict, styles: dict, rec: dict | None = None) -> list:
    """
    Render one project section in the same order/labels as the dynamic report page.
    """
    out: list = []
    _ = lambda name, txt: Paragraph(txt, styles[name])

    title = p.get("title") or p.get("id") or "—"
    media = p.get("media_type") or "—"
    tracking = p.get("tracking_status") or "—"

    # Top rule + title + subheader (media • tracking)
    out.append(_hr())
    out.append(Spacer(1, 4))
    out.append(_("RDE_ProjectTitle", _escape(title)))
    out.append(_("RDE_SubheadMuted", f"{_escape(media)} &nbsp;&bull;&nbsp; Tracking: {_escape(tracking)}"))
    out.append(_hr())
    out.append(Spacer(1, 6))

    # Companies: Networks / Studios / Production Companies (single line with slashes)
    segments = []
    nets = [n.get("name") for n in p.get("tv_networks_struct") or []]
    stus = [s.get("name") for s in p.get("studios_struct") or []]
    prods = [c.get("name") for c in p.get("prodcos_struct") or []]

    if nets:
        segments.append(f"<b>Networks:</b> {', '.join(map(_escape, nets))}")
    if stus:
        segments.append(f"<b>Studios:</b> {', '.join(map(_escape, stus))}")
    if prods:
        segments.append(f"<b>Production Companies:</b> {', '.join(map(_escape, prods))}")

    if segments:
        out.append(_("RDE_Body", " &nbsp;/&nbsp; ".join(segments)))
        out.append(Spacer(1, 3))

    # Executives (single line)
    execs = [e.get("name") for e in (p.get("executives_struct") or [])]
    if execs:
        out.append(_("RDE_Body", f"<b>Executives:</b> {', '.join(map(_escape, execs))}"))
        out.append(Spacer(1, 3))

    # Genres (single line)
    genres = p.get("genres") or []
    if genres:
        out.append(_("RDE_Body", f"<b>Genres:</b> {', '.join(map(_escape, genres))}"))
        out.append(Spacer(1, 6))

    # Description (block)
    if p.get("description"):
        out.append(_("RDE_Label", "Description"))
        out.append(_("RDE_Body", _escape_preserve_newlines(p["description"])))
        out.append(Spacer(1, 6))

    # Project Needs (list)
    out.append(_("RDE_Label", "Project Needs"))
    needs = p.get("needs") or []
    if needs:
        items = []
        for n in needs:
            qual = n.get("qualifications") or "—"
            status = n.get("status") or "—"
            desc = n.get("description") or None

            first_line = f"<b>{_escape(qual)}</b> <font color='#666666'>(Status: {_escape(status)})</font>"
            blocks = [Paragraph(first_line, styles["RDE_Body"])]
            if desc:
                blocks.append(Paragraph(_escape_preserve_newlines(desc), styles["RDE_Body"]))
            items.append(ListItem(blocks, leftIndent=6))
        out.append(ListFlowable(items, bulletType="bullet", start="•", leftIndent=12))
    else:
        out.append(_("RDE_Italic", "No needs listed."))
    out.append(Spacer(1, 6))

    # Creatives Attached (new block between Needs and Updates)
    if p.get("creatives_attached_note"):
        out.append(_("RDE_Label", "Creatives Attached"))
        out.append(_("RDE_Body", _escape_preserve_newlines(p["creatives_attached_note"])))
        out.append(Spacer(1, 6))

    # Updates / Engagement (two independent blocks)
    if p.get("updates") or p.get("engagement"):
        if p.get("updates"):
            out.append(_("RDE_Label", "Updates"))
            out.append(_("RDE_Body", _escape_preserve_newlines(p["updates"])))
            out.append(Spacer(1, 4))
        if p.get("engagement"):
            out.append(_("RDE_Label", "Engagement"))
            out.append(_("RDE_Body", _escape_preserve_newlines(p["engagement"])))
        out.append(Spacer(1, 6))

    # Notes (list; date — text)
    out.append(_("RDE_Label", "Notes"))
    notes = p.get("notes") or []
    if notes:
        items = []
        for n in notes:
            dt_raw = n.get("created_at")
            if isinstance(dt_raw, datetime):
                dt = dt_raw.date().isoformat()
            else:
                dt = (str(dt_raw)[:10] if dt_raw else "—")
            txt = n.get("note") or ""
            line = f"<font color='#666666'>{_escape(dt)}</font> — {_escape_preserve_newlines(txt)}"
            items.append(ListItem(Paragraph(line, styles["RDE_Body"]), leftIndent=6))
        out.append(ListFlowable(items, leftIndent=12))
    else:
        out.append(_("RDE_Italic", "No notes linked."))

    # AI Recommendation (Why)
    if rec:
        out.append(Spacer(1, 6))
        out.append(_("RDE_Label", "AI Recommendation"))
        meta_bits = []
        need_qual = rec.get("need_qual")
        sim = rec.get("sim")
        if need_qual:
            meta_bits.append(f"<b>Need:</b> {_escape(need_qual)}")
        if isinstance(sim, (int, float)):
            meta_bits.append(f"<b>Fit:</b> {sim:.3f}")
        if meta_bits:
            out.append(_("RDE_SmallMuted", "  ".join(meta_bits)))

        just = rec.get("justification")
        if just:
            out.append(_("RDE_Body", _escape_preserve_newlines(just)))
        else:
            out.append(_("RDE_Italic", "(no AI justification text)"))
        out.append(Spacer(1, 18))

    return out

# tiny helpers
def _escape(s: str) -> str:
    return _xml_escape(s or "")

def _escape_preserve_newlines(s: str) -> str:
    # reportlab accepts <br/> for line breaks
    return _xml_escape(s or "").replace("\n", "<br/>")

def _hr(width=0.5):
    # a thin horizontal rule
    from reportlab.graphics.shapes import Drawing, Line
    d = Drawing(0, 6)
    line = Line(0, 3, 460, 3)  # ~ 6.4 inches
    line.strokeColor = colors.lightgrey
    line.strokeWidth = width
    d.add(line)
    return d


def _build_styles():
    ss = getSampleStyleSheet()
    styles = {}

    # Page title (“Project Recommendations for …”)
    styles["RDE_Title"] = ParagraphStyle(
        "RDE_Title",
        parent=ss["Heading1"],
        fontSize=18,
        leading=22,
        textColor=colors.HexColor("#046A38"),
        spaceAfter=4,
    )

    # Project title (per-section)
    styles["RDE_ProjectTitle"] = ParagraphStyle(
        "RDE_ProjectTitle",
        parent=ss["Heading2"],
        fontSize=18,
        leading=20,
        spaceAfter=2,
        textColor=colors.black,
    )

    # Subheader line (e.g., “Feature • Tracking: Active”)
    styles["RDE_SubheadMuted"] = ParagraphStyle(
        "RDE_SubheadMuted",
        parent=ss["Normal"],
        fontSize=12,
        leading=14,
        textColor=colors.grey,
        spaceAfter=4,
    )

    # Section labels (“Description”, “Project Needs”, “Creatives Attached”, …)
    styles["RDE_Label"] = ParagraphStyle(
        "RDE_Label",
        parent=ss["Normal"],
        fontSize=12,
        leading=14,
        spaceBefore=2,
        spaceAfter=2,
        textColor=colors.black,
    )

    # Body copy (used for companies/executives/genres/paragraphs)
    styles["RDE_Body"] = ParagraphStyle(
        "RDE_Body",
        parent=ss["Normal"],
        fontSize=11,
        leading=14,
        textColor=colors.black,
    )

    # Muted small meta line (e.g., “Need: …   Fit: 0.842”)
    styles["RDE_SmallMuted"] = ParagraphStyle(
        "RDE_SmallMuted",
        parent=ss["Normal"],
        fontSize=10,
        leading=12,
        textColor=colors.grey,
    )

    # Italic body for “No needs listed.” / “No notes linked.”
    styles["RDE_Italic"] = ParagraphStyle(
        "RDE_Italic",
        parent=ss["Normal"],
        fontName="Helvetica-Oblique",
        fontSize=11,
        leading=14,
        textColor=colors.black,
    )

    return styles


@router.post(
    "/creatives/{creative_id}/needs/report.pdf",
    dependencies=[Depends(require_team_or_higher)]
)
def export_project_recs_pdf(
    creative_id: str,
    payload: ProjectRecsReportRequest,
    db: Session = Depends(get_db),
):
    """
    Export a styled PDF: Project Recommendations for <creative>.
    - Sections follow the exact project_ids order provided by the client.
    - If include_archived is False, projects with tracking_status='Archived' are skipped.
    - Visual order/labels match the dynamic report page exactly (no link styling).
    """
    cid = creative_id or payload.creative_id
    cname = _fetch_creative_name(db, cid)

    styles = _build_styles()  # see “2) Styles” additions below
    buffer = BytesIO()
    doc = SimpleDocTemplate(
        buffer,
        pagesize=LETTER,
        topMargin=0.7 * inch,
        bottomMargin=0.7 * inch,
        leftMargin=0.7 * inch,
        rightMargin=0.7 * inch,
        title=f"Project Recommendations for {cname}",
    )

    story: list = []
    story.append(Paragraph(f"Project Recommendations for {cname}", styles["RDE_Title"]))
    story.append(Spacer(1, 6))
    story.append(_hr())          # your existing horizontal rule helper
    story.append(Spacer(1, 10))

    # Map AI recs by project_id for the “AI Recommendation” section
    rec_by_pid = {
        r.project_id: (r.model_dump() if hasattr(r, "model_dump") else dict(r))
        for r in (payload.recs or [])
    }

    first = True
    for pid in payload.project_ids:
        p = _fetch_project_bundle(db, pid)  # see “3) bundle” update below
        if p.get("missing"):
            p = {
                "id": pid,
                "title": pid,
                "media_type": None,
                "tracking_status": None,
                "description": None,
                "updates": None,
                "engagement": None,
                "creatives_attached_note": None,
                "needs": [],
                "genres": [],
                "tv_networks": [],
                "studios": [],
                "prodcos": [],
                "executives": [],
                "notes": [],
            }

        if not payload.include_archived and (p.get("tracking_status") or "").lower() == "archived":
            continue

        if not first:
            story.append(Spacer(1, 14))
        first = False

        story.extend(_build_project_story(p, styles, rec=rec_by_pid.get(pid)))

    # Build PDF
    header_title = f"Project Recommendations • {cname}"
    doc.build(
        story,
        onFirstPage=lambda c, d: _pdf_header_footer(c, d, header_title),
        onLaterPages=lambda c, d: _pdf_header_footer(c, d, header_title),
    )

    buffer.seek(0)
    filename = f"Project_Recs_{cname.replace(' ', '_')}.pdf"
    return StreamingResponse(
        buffer,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )




class ReportPayload(BaseModel):
    creative_id: str
    project_ids: List[str]
    include_archived: bool = False
    recs: List[dict] = []

@router.post(
    "/creatives/{creative_id}/needs/report.json",
    dependencies=[Depends(require_team_or_higher)]
)
def export_project_recs_json(
    creative_id: str,
    body: ReportPayload,
    db: Session = Depends(get_db)
):
    # --- load creative (id+name)
    c_row = db.execute(
        text("SELECT id, name FROM creatives WHERE id = :cid"),
        {"cid": creative_id},
    ).mappings().first()
    if not c_row:
        raise HTTPException(status_code=404, detail="Creative not found")

    # map recs by project for “AI Recommendation” section
    rec_map = { (r or {}).get("project_id"): r for r in (body.recs or []) }

    # core projects; honor include_archived
    core_rows = db.execute(text("""
    SELECT
        p.id,
        p.title,
        p.media_type::text       AS media_type,
        p.tracking_status::text  AS tracking_status,
        p.description,
        p.updates,
        p.engagement,
        p.creatives_attached_note           -- ← NEW
    FROM projects p
    WHERE p.id = ANY(:pids)
        AND (:inc_arch OR p.tracking_status::text != 'Archived')
    ORDER BY array_position(:pids, p.id)
    """), {"pids": body.project_ids, "inc_arch": body.include_archived}).mappings().all()

    def bundle_struct(pid: str):
        # Needs (struct)
        needs = db.execute(text("""
          SELECT id, qualifications, description, status::text AS status
          FROM project_needs
          WHERE project_id = :pid
          ORDER BY id
        """), {"pid": pid}).mappings().all()

        # Genres
        genres = db.execute(text("""
          SELECT g.id, g.name
          FROM genre_tags g
          JOIN project_genre_tags j ON j.tag_id = g.id
          WHERE j.project_id = :pid
          ORDER BY g.name
        """), {"pid": pid}).mappings().all()

        # Executives (Active)
        execs = db.execute(text("""
          SELECT e.id, e.name
          FROM executives e
          JOIN project_to_executives j ON j.executive_id = e.id
          WHERE j.project_id = :pid AND j.status = 'Active'
          ORDER BY e.name
        """), {"pid": pid}).mappings().all()

        # Networks / Studios / ProdCos (Active)
        networks = db.execute(text("""
          SELECT n.id, n.name
          FROM tv_networks n
          JOIN project_to_tv_networks j ON j.network_id = n.id
          WHERE j.project_id = :pid AND j.status = 'Active'
          ORDER BY n.name
        """), {"pid": pid}).mappings().all()

        studios = db.execute(text("""
          SELECT s.id, s.name
          FROM studios s
          JOIN project_to_studios j ON j.studio_id = s.id
          WHERE j.project_id = :pid AND j.status = 'Active'
          ORDER BY s.name
        """), {"pid": pid}).mappings().all()

        prodcos = db.execute(text("""
          SELECT c.id, c.name
          FROM production_companies c
          JOIN project_to_production_companies j ON j.production_company_id = c.id
          WHERE j.project_id = :pid AND j.status = 'Active'
          ORDER BY c.name
        """), {"pid": pid}).mappings().all()

        # Notes (same shape as PDF uses)
        notes = db.execute(text("""
          SELECT n.note, n.created_at
          FROM notes n
          JOIN note_links l ON l.note_id = n.id
          WHERE l.noteable_id = :pid
            AND lower(l.noteable_type) = 'project'
          ORDER BY n.created_at DESC
        """), {"pid": pid}).mappings().all()

        return {
            # names (for plain display)
            "tv_networks": [n["name"] for n in networks],
            "studios": [s["name"] for s in studios],
            "prodcos": [p["name"] for p in prodcos],
            "executives": [e["name"] for e in execs],
            "genres": [g["name"] for g in genres],
            "needs": [dict(n) for n in needs],  # same fields, without id

            # structured (clickable)
            "tv_networks_struct": [dict(n) for n in networks],
            "studios_struct": [dict(s) for s in studios],
            "prodcos_struct": [dict(p) for p in prodcos],
            "executives_struct": [dict(e) for e in execs],
            "genres_struct": [dict(g) for g in genres],
            "needs_struct": [dict(n) for n in needs],

            "notes": [dict(n) for n in notes],
        }

    out_projects = []
    for r in core_rows:
        pid = r["id"]
        base = dict(r)
        extras = bundle_struct(pid)
        ai_rec = rec_map.get(pid) or None
        out_projects.append({**base, **extras, "ai_rec": ai_rec})

    return {
        "creative": {"id": c_row["id"], "name": c_row["name"]},
        "include_archived": bool(body.include_archived),
        "projects": out_projects,
    }