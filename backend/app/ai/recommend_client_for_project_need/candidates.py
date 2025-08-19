# backend/app/ai/recommend_client_for_project_need/candidates.py

from sqlalchemy import text

SQL = text("""
SELECT c.id, c.availability
FROM creatives c
JOIN project_needs n ON n.id = :need_id
JOIN projects p ON p.id = n.project_id
WHERE c.client_status = 'client'
  AND (p.media_type != 'TV Series' OR c.tv_acceptable IS TRUE)
  AND (NOT :is_director OR c.is_director IS TRUE)
  AND (NOT :require_feature OR c.has_directed_feature IS TRUE)
  AND (NOT :is_writer OR c.is_writer IS TRUE)
  AND (
    NOT :is_writer OR (
      (:writer_band = 'upper'      AND c.writer_level >= 6) OR
      (:writer_band = 'mid_upper'  AND c.writer_level >= 3) OR
      (:writer_band = 'mid'        AND c.writer_level BETWEEN 3 AND 6) OR
      (:writer_band = 'lower_mid'  AND c.writer_level <= 6) OR
      (:writer_band = 'lower'      AND c.writer_level <= 4)
    )
  )
""")

def get_filtered_candidates(db, need_id: str, quals: dict):
    rows = db.execute(SQL, {"need_id": need_id, **quals}).fetchall()
    return [{"creative_id": r[0], "availability": r[1]} for r in rows]
