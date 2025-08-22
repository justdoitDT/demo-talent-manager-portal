# backend/app/ai/recommend_client_for_project_need/reverse_pipeline.py

from sqlalchemy import text
from sqlalchemy.orm import Session
from .reverse_filters import (
    canonical_media_list, canonical_qual_list,
    writer_quals_for_level, director_quals,
    MEDIA_ORDER, QUAL_ORDER,      # ensure these are imported if you use them
)
from .profiles import build_project_profile, build_client_profile
from .llm import generate_justification
from .creative_need_cache import upsert_results

Q_CREATIVE_CORE = text("""
SELECT c.id, c.name, c.writer_level, c.has_directed_feature
FROM creatives c
WHERE c.id = :cid
""")

Q_CLIENT_EMB_EXISTS = text("""
SELECT 1
FROM creative_embeddings
WHERE creative_id = :cid
LIMIT 1
""")

# Best-need-per-project (DISTINCT ON) ordered by similarity desc
Q_RANK = text("""
WITH base AS (
  SELECT
    n.id             AS need_id,
    p.id             AS project_id,
    p.title          AS project_title,
    p.media_type     AS media_type,
    n.qualifications AS need_qual,
    1 - (ne.embedding <=> ce.embed) AS sim
  FROM project_needs n
  JOIN projects p             ON p.id = n.project_id
  JOIN need_embeddings ne     ON ne.need_id = n.id
  JOIN creative_embeddings ce ON ce.creative_id = :cid
  WHERE n.status = 'Active'
    AND (:include_archived OR p.tracking_status <> 'Archived')   -- ← NEW
    AND (
      (:mt_feature AND p.media_type = 'Feature') OR
      (:mt_tv      AND p.media_type = 'TV Series') OR
      (:mt_play    AND p.media_type = 'Play') OR
      (:mt_other   AND p.media_type NOT IN ('Feature','TV Series','Play'))
    )
    AND (
      (:q_owa   AND n.qualifications::text = 'OWA')
      OR (:q_oda   AND n.qualifications::text = 'ODA')
      OR (:q_staff AND n.qualifications::text = ANY(CAST(:writer_qual_list   AS text[])))
      OR (:q_dir   AND n.qualifications::text = ANY(CAST(:director_qual_list AS text[])))
    )
)
SELECT DISTINCT ON (project_id)
  need_id, project_id, project_title, media_type, need_qual, sim
FROM base
ORDER BY project_id, sim DESC
""")

def _booleans_for_media(media_list: list[str]) -> dict:
    s = set(media_list or [])
    return {
        "mt_feature": "Feature"   in s,
        "mt_tv":      "TV Series" in s,
        "mt_play":    "Play"      in s,
        "mt_other":   "Other"     in s,
    }

def run_reverse_pipeline(
    db: Session,
    creative_id: str,
    media_filter: list[str],
    quals_filter: list[str],
    limit_projects: int = 30,
    include_archived: bool = True,
) -> dict:
    # 0) ensure creative & embedding exist
    c = db.execute(Q_CREATIVE_CORE, {"cid": creative_id}).first()
    if not c:
        return {"creative_id": creative_id, "ranked": [], "filters": {}, "error": "Creative not found"}
    cid, name, writer_level, has_feature = c

    emb_exists = db.execute(Q_CLIENT_EMB_EXISTS, {"cid": creative_id}).first()
    if not emb_exists:
        return {"creative_id": creative_id, "ranked": [], "filters": {}, "error": "No client embedding. Update AI Profile first."}

    # 1) canonicalize filters (order matters for cache key)
    media_canon = canonical_media_list(media_filter or MEDIA_ORDER)
    quals_canon = canonical_qual_list(quals_filter or QUAL_ORDER)

    # 2) expand quals buckets -> concrete strings
    writer_allowed   = writer_quals_for_level(writer_level)
    director_allowed = director_quals(bool(has_feature))
    q_flags   = {k: (k in quals_canon) for k in ("OWA","Staff Writer","ODA","Director")}
    m_flags   = _booleans_for_media(media_canon)

    # 3) query best-need-per-project
    params = {
        "cid": creative_id,
        **m_flags,
        "q_owa":   q_flags["OWA"],
        "q_oda":   q_flags["ODA"],
        "q_staff": q_flags["Staff Writer"],
        "q_dir":   q_flags["Director"],
        "writer_qual_list":   writer_allowed,
        "director_qual_list": director_allowed,
        "include_archived": include_archived,
    }
    rows = db.execute(Q_RANK, params).fetchall()

    # 4) sort desc, take top N, shape rows for UI
    scored = [
        {
            "need_id":       r.need_id if hasattr(r, "need_id") else r[0],
            "project_id":    r.project_id if hasattr(r, "project_id") else r[1],
            "project_title": r.project_title if hasattr(r, "project_title") else r[2],
            "media_type":    r.media_type if hasattr(r, "media_type") else r[3],
            "need_qual":     r.need_qual if hasattr(r, "need_qual") else r[4],
            "sim":           float((r.sim if hasattr(r, "sim") else r[5]) or 0.0),
        }
        for r in rows
    ]
    scored.sort(key=lambda x: x["sim"], reverse=True)
    top = scored[:limit_projects]

    # 5) justifications
    client_profile = build_client_profile(db, creative_id)
    def enrich(entry):
        proj = build_project_profile(db, entry["project_id"])
        try:
            entry["justification"] = generate_justification(proj, client_profile, [])
        except Exception as e:
            entry["justification"] = f"(generator error: {e})"
        return entry

    ranked = [enrich(e) for e in top]

    # 6) package & cache
    result = {
        "creative_id": creative_id,
        "filters": {
            "media_type_filter":        media_canon,
            "qualifications_filter":    quals_canon,
            "include_archived": include_archived,
        },
        "ranked":           ranked,
        "considered_count": len(scored),
        "model":            "vector-cosine",
    }
    upsert_results(
        db,
        creative_id,
        params={
            "media_type_filter": media_canon, 
            "qualifications_filter": quals_canon,
            "include_archived": include_archived,
        },
        results=result,
    )
    return result
