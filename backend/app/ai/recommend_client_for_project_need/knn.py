# backend/app/ai/recommend_client_for_project_need/knn.py

from sqlalchemy import text

SQL = text("""
SELECT ce.creative_id,
       COALESCE(1 - (ce.embed <=> ne.embedding), 0.0) AS sim
FROM creative_embeddings ce
JOIN need_embeddings ne ON ne.need_id = :need_id
WHERE ce.creative_id = ANY(:ids)
ORDER BY ce.embed <=> ne.embedding
LIMIT 200
""")

def knn_candidates(db, need_id, filtered_ids):
    rows = db.execute(SQL, {"need_id": need_id, "ids": filtered_ids}).fetchall()
    return [{"creative_id": r[0], "sim": float(r[1] or 0.0)} for r in rows]
