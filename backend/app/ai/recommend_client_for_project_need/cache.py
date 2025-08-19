# backend/app/ai/recommend_client_for_project_need/cache.py

from sqlalchemy import text, bindparam
from sqlalchemy.dialects.postgresql import JSONB

UPSERT = (
    text("""
    INSERT INTO need_recommendations (need_id, params_json, results_json)
    VALUES (:need_id, :params, :results)
    ON CONFLICT (need_id, params_json) DO UPDATE SET
      results_json = EXCLUDED.results_json,
      run_started_at = now()
    """)
    .bindparams(
        bindparam("params", type_=JSONB),
        bindparam("results", type_=JSONB),
    )
)

GET_LATEST = text("""
SELECT results_json
FROM need_recommendations
WHERE need_id = :need_id
ORDER BY run_started_at DESC
LIMIT 1
""")

def upsert_result(db, need_id: str, params: dict, results: dict):
    db.execute(UPSERT, {"need_id": need_id, "params": params, "results": results})
    db.commit()

def get_latest_result(db, need_id: str):
    row = db.execute(GET_LATEST, {"need_id": need_id}).first()
    return row[0] if row else None
