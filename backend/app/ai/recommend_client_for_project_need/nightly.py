# backend/app/ai/recommend_client_for_project_need/nightly.py

# call from a protected endpoint or a Render cron job
from sqlalchemy import text
from .embeddings import embed_texts, EMBED_DIM
import numpy as np

Q_CLIENTS = text("SELECT id FROM creatives WHERE client_status = 'client'")
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
UPSERT = text("""
INSERT INTO client_embeddings(creative_id, embedding, source_version)
VALUES (:cid, :emb, :ver)
ON CONFLICT (creative_id) DO UPDATE SET
  embedding = EXCLUDED.embedding,
  source_version = EXCLUDED.source_version,
  updated_at = now()
""")

def _w(inv, it):
    # defaults if missing
    inv = inv if inv is not None else 2.5
    it  = it  if it  is not None else 2.5
    # new weighting rule: involvement * interest^2
    return float(inv) * (float(it) ** 2)

def rebuild_client_embeddings(db, version="local-stub@1536"):
    client_ids = [r[0] for r in db.execute(Q_CLIENTS).fetchall()]
    for cid in client_ids:
        credits = db.execute(Q_CREDITS, {"cid": cid}).fetchall()
        lines, wts = [], []
        for pid, title, media, tags in credits:
            r = db.execute(Q_RATING, {"cid": cid, "pid": pid}).first()
            inv, it = (r or (None, None))
            lines.append(f"{title} :: {media} :: tags=[{tags}]")
            wts.append(_w(inv, it))

        interests = [r[0] for r in db.execute(Q_INTERESTS, {"cid": cid}).fetchall()]
        parts, pweights = [], []
        if lines:
            ev = embed_texts(lines)
            wsum = max(sum(wts), 1e-9)
            cred_vec = sum((w*v for w, v in zip(wts, ev))) / wsum
            parts.append(cred_vec); pweights.append(0.8)
        if interests:
            e2 = embed_texts(["\n".join(interests)])[0]
            parts.append(e2); pweights.append(0.2)

        if parts:
            vec = sum((w*np.array(v) for w, v in zip(pweights, parts)))
            n = np.linalg.norm(vec); vec = (vec / n).tolist() if n > 0 else vec.tolist()
        else:
            vec = [0.0]*EMBED_DIM

        db.execute(UPSERT, {"cid": cid, "emb": vec, "ver": version})
    db.commit()
