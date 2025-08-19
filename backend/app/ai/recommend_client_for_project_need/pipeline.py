# backend/app/ai/recommend_client_for_project_need/pipeline.py

import os
from sqlalchemy import text
from .quals import parse_qualifications
from .candidates import get_filtered_candidates
from .project_context import ensure_need_embedding
from .knn import knn_candidates
from .feedback import feedback_rollup
from .rank import rank_with_flags
from .cache import upsert_result
from .profiles import build_project_profile, build_client_profile, name_feedback_events
from .llm import generate_justification

Q_NEED = text("SELECT project_id, qualifications FROM project_needs WHERE id = :need_id")
Q_EMB  = text("SELECT embedding FROM need_embeddings WHERE need_id = :need_id")

def run_pipeline(db, need_id: str):
    row = db.execute(Q_NEED, {"need_id": need_id}).first()
    if not row:
        result = {"need_id": need_id, "ranked": [], "honorable_mentions": []}
        upsert_result(db, need_id, {}, result); return result

    project_id, qstr = row
    quals = parse_qualifications(qstr)

    cands = get_filtered_candidates(db, need_id, quals)
    if not cands:
        result = {"need_id": need_id, "ranked": [], "honorable_mentions": []}
        upsert_result(db, need_id, {}, result); return result

    ensure_need_embedding(db, need_id, project_id)
    filtered_ids = [c["creative_id"] for c in cands]
    knn = knn_candidates(db, need_id, filtered_ids)
    fb_map = feedback_rollup(db, project_id, [r["creative_id"] for r in knn])
    avail_map = {c["creative_id"]: c["availability"] for c in cands}

    top10, honorable = rank_with_flags(knn, avail_map, fb_map)

    # --- Justifications ---
    proj = build_project_profile(db, project_id)

    def enrich(entry):
        cid = entry["creative_id"]
        client = build_client_profile(db, cid)
        events = fb_map.get(cid, {}).get("events", [])
        events_named = name_feedback_events(db, events)
        try:
            entry["justification"] = generate_justification(proj, client, events_named)
        except Exception as e:
            entry["justification"] = f"(generator error: {e})"
        return entry

    top10 = [enrich(e) for e in top10]
    honorable = [enrich(e) for e in honorable]

    result = {
        "need_id": need_id,
        "model": os.getenv("EMBED_MODEL", "local-stub@1536"),
        "filters": {"quals": quals},
        "ranked": top10,
        "honorable_mentions": honorable
    }
    upsert_result(db, need_id, {}, result)
    return result
