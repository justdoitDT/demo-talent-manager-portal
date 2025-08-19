# backend/app/ai/recommend_client_for_project_need/profiles.py

from sqlalchemy import text


# Project profile (once per need)

Q_PROJECT = text("""
SELECT p.id, p.title, p.media_type, p.description
FROM projects p WHERE p.id = :pid
""")

Q_PGENRES = text("""
SELECT gt.name
FROM project_genre_tags pgt JOIN genre_tags gt ON gt.id = pgt.tag_id
WHERE pgt.project_id = :pid
ORDER BY gt.name
""")

Q_PNOTES = text("""
SELECT n.note
FROM note_links nl JOIN notes n ON n.id = nl.note_id
WHERE nl.noteable_id = :pid
ORDER BY n.created_at DESC NULLS LAST
""")

Q_PSTAFFING = text("""
SELECT r.recipient_id, rn.recipient_name, rn.recipient_type
FROM v_project_staffing_recipient_ids r
LEFT JOIN v_recipient_names rn ON rn.recipient_id = r.recipient_id::text
WHERE r.project_id = :pid
""")

def build_project_profile(db, project_id: str) -> dict:
    base = db.execute(Q_PROJECT, {"pid": project_id}).first()
    genres = [r[0] for r in db.execute(Q_PGENRES, {"pid": project_id}).fetchall()]
    notes  = [r[0] for r in db.execute(Q_PNOTES,  {"pid": project_id}).fetchall()]
    staffing = [
        {"recipient_id": r[0], "name": r[1], "type": r[2]}
        for r in db.execute(Q_PSTAFFING, {"pid": project_id}).fetchall()
    ]
    if not base:
        return {"project_id": project_id, "title": None, "media_type": None, "description": "", "genres": genres, "notes": notes, "staffing": staffing}
    pid, title, media_type, desc = base
    return {
        "project_id": pid,
        "title": title,
        "media_type": media_type,
        "description": desc or "",
        "genres": genres,
        "notes": notes,
        "staffing": staffing
    }




# Client profile (per candidate)

Q_CREATIVE = text("""
SELECT id, name, is_writer, writer_level, is_director, has_directed_feature, tv_acceptable, availability
FROM creatives WHERE id = :cid
""")

Q_CREDITS = text("""
SELECT p.id, p.title, p.media_type,
       COALESCE(string_agg(DISTINCT gt.name, ', '), '') AS tags
FROM creative_project_roles cpr
JOIN projects p ON p.id = cpr.project_id
LEFT JOIN project_genre_tags pgt ON pgt.project_id = p.id
LEFT JOIN genre_tags gt ON gt.id = pgt.tag_id
WHERE cpr.creative_id = :cid AND p.status = 'Archived'
GROUP BY p.id, p.title, p.media_type
""")

Q_RATING = text("""
SELECT psr.involvement_rating, psr.interest_rating
FROM project_survey_responses psr
JOIN surveys s ON s.id = psr.survey_id
WHERE s.creative_id = :cid AND psr.project_id = :pid
ORDER BY s.updated_at DESC
LIMIT 1
""")

Q_INTERESTS = text("""
SELECT sr.response
FROM surveys s
JOIN survey_responses sr ON sr.survey_id = s.id
WHERE s.creative_id = :cid
""")

def _w(inv, it):
    inv = inv if inv is not None else 2.5
    it  = it  if it  is not None else 2.5
    return float(inv) * (float(it) ** 2)

def build_client_profile(db, creative_id: str, max_credits_for_llm: int = 25) -> dict:
    c = db.execute(Q_CREATIVE, {"cid": creative_id}).first()
    if not c:
        return {"creative_id": creative_id}
    cid, name, is_writer, writer_level, is_director, has_feature, tv_ok, availability = c

    credits = []
    for pid, title, media, tags in db.execute(Q_CREDITS, {"cid": creative_id}).fetchall():
        r = db.execute(Q_RATING, {"cid": creative_id, "pid": pid}).first()
        inv, it = (r or (None, None))
        credits.append({
            "project_id": pid,
            "title": title,
            "media_type": media,
            "tags": [t.strip() for t in tags.split(",")] if tags else [],
            "involvement_rating": inv,
            "interest_rating": it,
            "weight": _w(inv, it),
        })

    credits.sort(key=lambda x: x["weight"], reverse=True)
    # Cap to keep token usage sane (adjust as you like)
    credits_llm = credits[:max_credits_for_llm]

    interests = [r[0] for r in db.execute(Q_INTERESTS, {"cid": creative_id}).fetchall()]

    return {
        "creative_id": cid,
        "name": name,
        "roles": {
            "is_writer": is_writer, "writer_level": writer_level,
            "is_director": is_director, "has_directed_feature": has_feature,
            "tv_acceptable": tv_ok
        },
        "availability": availability,
        "credits": credits,
        "credits_for_llm": credits_llm,
        "interests_and_goals": interests
    }




# Attach named feedback events

Q_NAMES = text("SELECT recipient_id, recipient_name FROM v_recipient_names WHERE recipient_id = ANY(:ids)")
def name_feedback_events(db, events: list[dict]) -> list[dict]:
    ids = list({e["recipient_id"] for e in events if e.get("recipient_id")})
    name_map = {}
    if ids:
        for rid, rname in db.execute(Q_NAMES, {"ids": ids}).fetchall():
            name_map[str(rid)] = rname
    out = []
    for e in events:
        rid = str(e.get("recipient_id"))
        out.append({**e, "recipient_name": name_map.get(rid)})
    return out
