# backend/app/ai/recommend_client_for_project_need/rank.py

def rank_with_flags(knn_rows, availability_map, feedback_map):
    rows = []
    for r in knn_rows:
        cid = r["creative_id"]
        fb  = feedback_map.get(cid, {})
        rows.append({
          "creative_id": cid,
          "score": r["sim"],        # similarity only
          "sim": r["sim"],
          "availability": availability_map.get(cid),  # "available"|"unavailable"|None
          "feedback_summary": {
            "any_positive": fb.get("any_positive", False),
            "any_non_positive": fb.get("any_non_positive", False),
            "has_subs_to_staffing": fb.get("has_subs_to_staffing", False),
            "has_subs_no_feedback": fb.get("has_subs_no_feedback", False),
            "events": fb.get("events", []),
          }
        })
    rows.sort(key=lambda x: x["score"], reverse=True)
    top10 = rows[:10]
    honorable = [r for r in rows[10:] if r["feedback_summary"]["any_positive"]][:5]
    return top10, honorable
