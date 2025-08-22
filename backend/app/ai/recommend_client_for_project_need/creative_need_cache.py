# backend/app/ai/recommend_client_for_project_need/creative_need_cache.py

from sqlalchemy import text, bindparam
from sqlalchemy.dialects.postgresql import JSONB

# If you want strict “latest”, keep ORDER BY + LIMIT even if you also upsert.
GET_ONE = text("""
SELECT results_json, run_started_at
FROM creative_need_recommendations
WHERE creative_id = :cid
  AND params_json = :params
ORDER BY run_started_at DESC
LIMIT 1
""").bindparams(
    bindparam("params", type_=JSONB)
)

UPSERT = text("""
INSERT INTO creative_need_recommendations (creative_id, params_json, results_json)
VALUES (:cid, :params, :results)
ON CONFLICT (creative_id, params_json) DO UPDATE
SET results_json = EXCLUDED.results_json,
    run_started_at = now()
RETURNING results_json, run_started_at
""").bindparams(
    bindparam("params", type_=JSONB),
    bindparam("results", type_=JSONB),
)

def get_latest(db, creative_id: str, params: dict):
    row = db.execute(GET_ONE, {"cid": creative_id, "params": params}).first()
    if not row:
        return None, None
    return row[0], row[1]

def upsert_results(db, creative_id: str, params: dict, results: dict):
    row = db.execute(UPSERT, {"cid": creative_id, "params": params, "results": results}).first()
    return row[0], row[1]
