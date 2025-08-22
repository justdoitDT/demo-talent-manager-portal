# backend/app/ai/recommend_client_for_project_need/reverse_filters.py

from typing import Iterable

MEDIA_ORDER = ["Feature", "TV Series", "Play", "Other"]
QUAL_ORDER  = ["OWA", "Staff Writer", "ODA", "Director"]

def canonical_media_list(chosen: Iterable[str]) -> list[str]:
    s = set(chosen or [])
    return [m for m in MEDIA_ORDER if m in s]

def canonical_qual_list(chosen: Iterable[str]) -> list[str]:
    s = set(chosen or [])
    return [q for q in QUAL_ORDER if q in s]

def writer_quals_for_level(level) -> list[str]:
    # returns the acceptable qualification strings for a “Staff Writer” checkbox
    # given the creative's writer_level (may be None)
    if level is None:
        return ["Writer (Any)", "Writer (Lower)"]
    try:
        lvl = float(level)
    except Exception:
        return ["Writer (Any)", "Writer (Lower)"]
    if lvl > 6:
        return ["Writer (Any)", "Writer (Upper)", "Writer (Mid - Upper)"]
    if lvl == 6:
        return ["Writer (Any)", "Writer (Upper)", "Writer (Mid - Upper)", "Writer (Mid)"]
    if lvl in (5.5, 5.0, 4.5):
        return ["Writer (Any)", "Writer (Mid - Upper)", "Writer (Mid)", "Writer (Lower - Mid)"]
    if lvl == 4:
        return ["Writer (Any)", "Writer (Lower)", "Writer (Lower - Mid)", "Writer (Mid)"]
    if lvl < 4:
        return ["Writer (Any)", "Writer (Lower)", "Writer (Lower - Mid)"]
    # fallback
    return ["Writer (Any)"]

def director_quals(has_feature: bool | None) -> list[str]:
    return (["Director (Any)", "Director (Has Directed Feature)"]
            if has_feature else ["Director (Any)"])
