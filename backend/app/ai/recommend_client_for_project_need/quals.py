# backend/app/ai/recommend_client_for_project_need/quals.py

def parse_qualifications(q: str) -> dict:
    q = (q or "").strip()
    is_writer   = q.startswith("Writer")
    is_director = q.startswith("Director")
    require_feature = q.endswith("(Has Directed Feature)")
    band = None
    if is_writer:
        if q.endswith("(Upper)"): band = "upper"
        elif q.endswith("(Mid - Upper)"): band = "mid_upper"
        elif q.endswith("(Mid)"): band = "mid"
        elif q.endswith("(Low - Mid)"): band = "lower_mid"
        elif q.endswith("(Low)"): band = "lower"
    return dict(is_writer=is_writer, is_director=is_director,
                require_feature=require_feature, writer_band=band)
