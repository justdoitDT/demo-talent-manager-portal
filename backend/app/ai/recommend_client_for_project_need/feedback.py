# backend/app/ai/recommend_client_for_project_need/feedback.py

from sqlalchemy import text

SQL = text("""
WITH staffing AS (
  SELECT recipient_id FROM v_project_staffing_recipient_ids WHERE project_id = :pid
),
subs_to_staffing AS (
  SELECT stc.creative_id, sr.recipient_id, stc.sub_id
  FROM sub_to_client stc
  JOIN sub_recipients sr ON sr.sub_id = stc.sub_id
  JOIN staffing s ON s.recipient_id = sr.recipient_id
),
joined AS (
  SELECT sts.creative_id, sts.sub_id, sts.recipient_id,
         sf.sentiment, sf.feedback_text, sf.created_at
  FROM subs_to_staffing sts
  LEFT JOIN sub_feedback sf
    ON sf.sub_id = sts.sub_id AND sf.source_id = sts.recipient_id
),
agg AS (
  SELECT creative_id,
         BOOL_OR(sentiment = 'positive')      AS any_positive,
         BOOL_OR(sentiment = 'not positive')  AS any_non_positive,
         COUNT(*)                              AS subs_to_staffing_count,
         COUNT(*) FILTER (WHERE sentiment IS NOT NULL) AS feedback_count,
         JSONB_AGG(
           JSONB_BUILD_OBJECT(
             'recipient_id', recipient_id,
             'sentiment', sentiment,
             'feedback_text', feedback_text,
             'created_at', created_at,
             'sub_id', sub_id
           )
           ORDER BY created_at DESC NULLS LAST
         ) FILTER (WHERE feedback_text IS NOT NULL OR sentiment IS NOT NULL) AS events
  FROM joined
  GROUP BY creative_id
)
SELECT c.id,
       COALESCE(a.any_positive, FALSE),
       COALESCE(a.any_non_positive, FALSE),
       COALESCE(a.subs_to_staffing_count,0) > 0 AS has_subs_to_staffing,
       COALESCE(a.subs_to_staffing_count,0) > 0 AND COALESCE(a.feedback_count,0) = 0 AS has_subs_no_feedback,
       COALESCE(a.events, '[]'::jsonb)
FROM creatives c
LEFT JOIN agg a ON a.creative_id = c.id
WHERE c.id = ANY(:ids)
""")

def feedback_rollup(db, project_id: str, creative_ids: list[str]):
    rows = db.execute(SQL, {"pid": project_id, "ids": creative_ids}).fetchall()
    out = {}
    for r in rows:
        cid, pos, nonpos, subs, nofb, events = r
        out[cid] = {
          "any_positive": pos,
          "any_non_positive": nonpos,
          "has_subs_to_staffing": subs,
          "has_subs_no_feedback": nofb,
          "events": events or []
        }
    return out
