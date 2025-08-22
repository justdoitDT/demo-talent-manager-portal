# backend/app/routers/imdb_scrape.py

import html
import json
import re
import time
from collections import Counter
from typing import Iterator, Callable, Optional, Any, Dict
import traceback

import requests
from bs4 import BeautifulSoup
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import text, bindparam
from sqlalchemy.orm import Session
from starlette.responses import StreamingResponse

from .. import models
from ..auth_dep import require_writer
from ..database import get_db

# This file exposes a Server-Sent Events stream that scrapes all credits
# from a Creative's IMDb page and ingests them as Projects + roles,
# while reporting granular progress (with ETA) back to the client.

router = APIRouter(prefix="/creatives", tags=["Creatives • IMDb"])

HDR_HTTP = {"User-Agent": "Mozilla/5.0", "Accept-Language": "en-US,en;q=0.7"}
TITLE_RX = re.compile(r"<title>(.*?)</title>", re.I | re.S)
YEAR_RX = re.compile(r"\d{4}")

# ────────────────────────── SSE helpers ──────────────────────────
def _sse(event: str, obj: dict) -> bytes:
    """Format a single Server-Sent Event frame."""
    return (
        f"event: {event}\n"
        f"data: {json.dumps(obj, separators=(',', ':'))}\n\n"
    ).encode("utf-8")


# ───────────────────── Title metadata (one tt) ───────────────────
def _title_meta(tt_url: str) -> dict:
    """Return {title, media_type, year, description, tags[]} for one IMDb title URL."""
    txt = requests.get(tt_url, headers=HDR_HTTP, timeout=20).text

    # Parse <title> for [Title (Year • media)]
    m = TITLE_RX.search(txt)
    raw = html.unescape(m.group(1)).split(" - IMDb", 1)[0].strip() if m else ""
    title, stuff = (raw.rsplit("(", 1) + [""])[:2]
    title = title.strip()
    stuff = stuff[:-1].strip() if stuff.endswith(")") else stuff

    ym = YEAR_RX.search(stuff)
    year = ym.group(0) if ym else None
    lbl = (stuff[: ym.start()] if ym else stuff).strip().lower()

    media_type = (
        "TV Mini Series" if lbl.startswith("tv mini") else
        "TV Series" if lbl.startswith("tv series") else
        "TV Episode" if lbl.startswith("tv episode") else
        "TV Special" if lbl.startswith("tv special") else
        "TV Short" if lbl.startswith("tv short") else
        "TV Movie" if lbl.startswith("tv movie") else
        "Music Video" if lbl.startswith("music video") else
        "Video Game" if lbl.startswith("video game") else
        "Podcast Series" if lbl.startswith("podcast series") else
        "Podcast Episode" if lbl.startswith("podcast episode") else
        "Video" if lbl == "video" else
        "Short" if lbl.startswith("short") else
        "Feature"
    )

    # Fallbacks (for unreleased titles etc.)
    soup = BeautifulSoup(txt, "html.parser")
    if not year:
        for li in soup.select('ul[data-testid="hero-title-block__metadata"] li'):
            t = li.get_text(strip=True)
            if YEAR_RX.fullmatch(t):
                year = t
                break

    desc_tag = soup.find("meta", {"name": "description"})
    desc = html.unescape(desc_tag["content"].strip()) if desc_tag else ""

    tags = [
        html.unescape(a.get_text(strip=True))
        for a in soup.select(".ipc-chip-list__scroller a.ipc-chip")
        if a.get_text(strip=True)
    ]

    return {
        "title": title,
        "media_type": media_type,
        "year": year,
        "description": desc,
        "tags": tags,
    }


# ───────────────────── Filmography gatherers ─────────────────────
_ROLE_CANON = {
    "camera_and_electrical_department": "camera_department",
    "actress": "actor",
}
def _normalize_role(raw: str) -> str:
    slug = raw.strip().lower().replace(" ", "_")
    return _ROLE_CANON.get(slug, slug)


def _credits_inline(name_url: str) -> list[tuple[str, str, str]]:
    """Credits visible on the initial Name page (fast)."""
    html0 = requests.get(name_url, headers=HDR_HTTP, timeout=20).text
    soup = BeautifulSoup(html0, "html.parser")
    out: list[tuple[str, str, str]] = []
    seen: set[tuple[str, str]] = set()

    for sec in soup.find_all("div", class_=re.compile(r"filmo-section-")):
        h3 = sec.select_one("h3")
        if not h3:
            continue
        heading = _normalize_role(h3.get_text(strip=True))
        body = sec.find_next_sibling("div") or sec
        for a in body.select('a[href*="/title/tt"]'):
            m = re.search(r"(tt\d+)", a.get("href", ""))
            if not m:
                continue
            tid = m.group(1)
            key = (tid, heading)
            if key in seen:
                continue
            seen.add(key)
            out.append((tid, f"https://www.imdb.com/title/{tid}/", heading))
    return out


# Persisted-query hashes (trim to common roles; extend if desired)
# ── Department → slab-key mapping (IMDB Name page “credits” field names)
DEPARTMENTS: list[tuple[str, str]] = [
    # ACTORS / STUNTS
    ("ACTOR",                       "acting_credits"),
    ("ACTRESS",                     "acting_credits"),
    ("STUNTS",                      "stunt_performer_credits"),
    # CREATIVES
    ("DIRECTOR",                    "director_credits"),
    ("WRITER",                      "writer_credits"),
    ("PRODUCER",                    "producer_credits"),
    ("CINEMATOGRAPHER",             "cinematographer_credits"),
    ("EDITOR",                      "editor_credits"),
    ("COMPOSER",                    "composer_credits"),
    # DEPARTMENTS (A–Z)
    ("ADDITIONAL_CREW",             "additional_crew_credits"),
    ("ANIMATION_DEPARTMENT",        "animation_department_credits"),
    ("ART_DEPARTMENT",              "art_department_credits"),
    ("ART_DIRECTOR",                "art_director_credits"),
    ("CAMERA_DEPARTMENT",           "camera_department_credits"),
    ("CASTING_DEPARTMENT",          "casting_department_credits"),
    ("CASTING_DIRECTOR",            "casting_director_credits"),
    ("COSTUME_DEPARTMENT",          "costume_department_credits"),
    ("COSTUME_DESIGNER",            "costume_designer_credits"),
    ("EDITORIAL_DEPARTMENT",        "editorial_department_credits"),
    ("LOCATION_MANAGEMENT",         "location_management_credits"),
    ("MAKEUP_DEPARTMENT",           "makeup_department_credits"),
    ("MUSIC_DEPARTMENT",            "music_department_credits"),
    ("PRODUCTION_DESIGNER",         "production_designer_credits"),
    ("SCRIPT_AND_CONTINUITY_DEPARTMENT", "script_and_continuity_department_credits"),
    ("SECOND_UNIT_OR_ASSISTANT_DIRECTOR", "second_unit_or_assistant_director_credits"),
    ("SOUND_DEPARTMENT",            "sound_department_credits"),
    ("SOUNDTRACK",                  "soundtrack_credits"),
    ("SPECIAL_EFFECTS",             "special_effects_credits"),
    ("TRANSPORTATION",              "transportation_credits"),
    ("VISUAL_EFFECTS",              "visual_effects_credits"),
    # “SELF / ARCHIVE / THANKS”
    ("SELF",                        "self_credits"),
    ("ARCHIVE_FOOTAGE",             "archive_footage_credits"),
    ("THANKS",                      "thanks_credits"),
]

# ── Persisted-query hashes (per IMDb job enum)
PQ_HASHES: dict[str, str] = {
    # core creative roles
    "ACTOR":                        "4faf04583fbf1fbc7a025e5dffc7abc3486e9a04571898a27a5a1ef59c2965f3",
    "ACTRESS":                      "0cf092f3616dbc56105327bf09ec9f486d5fc243a1d66eb3bf791fda117c5079",
    "STUNTS":                       "081b8a8560c212a1061ca79111206fa2b21249115e1a723c90beb6f73f65b729",
    "DIRECTOR":                     "f01a9a65c7afc1b50f49764610257d436cf6359e48c08de26c078da0d438d0e9",
    "WRITER":                       "9c2aaa61b79d348988d90e7420366ff13de8508e54ba7b8cf10f959f64f049d2",
    "PRODUCER":                     "2f142f86bfbb49a239bd4df6c2f40f3ed1438fecc8da45235e66d9062d321535",
    "CINEMATOGRAPHER":              "8084ae470f286098144b94d3af168714f0b9cb7ace5c755953d62e8fa5545645",
    "CAMERA_DEPARTMENT":            "48cebb062913c1a0b7289ba106fba75c511e92066def6c1ddff234661475eadf",
    "EDITOR":                       "e4dafb110ff76be6e768e44bf27283457fb32806389c574ab6bab8ec944c2b48",
    "COMPOSER":                     "d72f4212d8c18a93b53933e1b1e347212277793c8247dc1d6c018d1165e35176",
    "MUSIC_DEPARTMENT":             "dc306e6db8876d8c1b7531d2e3c07f6abf6b119b59456bd00f4857abdcf80735",
    "SOUND_DEPARTMENT":             "d70f6dcca07e11be86bbce7ed8a6f2ac63a189fa77102dc438777648a79aecc6",
    # design / visual
    "ART_DEPARTMENT":               "66267dc0ddf6800290f38832e72a96852124e03e82711ab62b54b85300b561b0",
    "ART_DIRECTOR":                 "4b1bd227e0581f04cf9170e265403c5570bc3166131d57d9c5c804d1ac81d2c4",
    "PRODUCTION_DESIGNER":          "0b0cbb9d21fbfac26b5cad551502da49a022e4f190d1964600af444d162ed2c7",
    "COSTUME_DEPARTMENT":           "c806256a3a739706571ba818dba4bee76288def3247314bc62feafefd4546f44",
    "COSTUME_DESIGNER":             "3e5ce1fb0fe9d8888fa28cbbea91e03d7e2152c9022708dc2f850ed7ed22d279",
    "MAKEUP_DEPARTMENT":            "eeecaa7009d55735f6640e642ca721ad7c522ca4b18458a61c2537297f340bfb",
    "VISUAL_EFFECTS":               "95570382b0333378f5cd5f7bf8059a8adec84acfd92f67d99be33bed31d59cf7",
    "SPECIAL_EFFECTS":              "2bc759c9518cf9f6147893b344b6bae6962199ae4fc637b0d3e4d919d3ec7677",
    # production / crew
    "CASTING_DEPARTMENT":           "0bb9a692b577c9d7deba08843cb2f1425fc834cf96c46846d67a8c3cc0b64c9e",
    "CASTING_DIRECTOR":             "8d8c9ad8ca3b517053606d6d613b5c687ad862bab04f851e0f1eab5d1675df29",
    "EDITORIAL_DEPARTMENT":         "fb6161fa243952e7e266f32597741bcbded1a1a7d4f8d637e2ff367e6c9ecdad",
    "ANIMATION_DEPARTMENT":         "71dd918d646d80c46b289c390e9c6ad08544cd660e305024661cb8f13906fee2",
    "LOCATION_MANAGEMENT":          "8a3d886db606c99fe165168c562e3cd3376f2acaaa9df466834564c30a17cde7",
    "TRANSPORTATION":               "1386197d6f8d41dce93ff49b9aff901f40ff891dbe7afe80c2c5e35d813fb62f",
    "SECOND_UNIT_OR_ASSISTANT_DIRECTOR": "8c1414a4c4011b00688eff2d58233f7e8cdd6af267f9b14aca7bd1dd0afd7910",
    "SCRIPT_AND_CONTINUITY_DEPARTMENT":  "fb6161fa243952e7e266f32597741bcbded1a1a7d4f8d637e2ff367e6c9ecdad",
    "ADDITIONAL_CREW":              "7577169faf789f9b1d8796f1f423442f464776b0e09798dc7601564023341d5f",
    # misc
    "SOUNDTRACK":                   "892aec0ca1be132b53b752a17162975840ae43d08716b9ebae2bc12084cd9c7f",
    "SELF":                         "aed65282de7b822ba5a0ac64ba53f21bdae6a49eb78373015ed00239cd1cd2e4",
    "ARCHIVE_FOOTAGE":              "e0e70305e207cc0f264e3fc7fe0599ca67c9ee6eca597fa215033db592492af1",
    "THANKS":                       "ff98ee622e0a4d20ea17c09532011a097d5c354af789b6cc8860f8cc073fc050",
}
_GQL = "https://caching.graphql.imdb.com/"
_HDR_GQL = {
    "Accept": "application/graphql+json, application/json",
    "Content-Type": "application/json",
}


def _gql_call(payload: dict) -> dict:
    # Try POST; if no "data", retry with GET exactly like IMDb does
    r = requests.post(_GQL, json=payload, headers=_HDR_GQL, timeout=20)
    r.raise_for_status()
    resp = r.json()
    if "data" not in resp or not resp["data"].get("name"):
        params = {
            "operationName": payload["operationName"],
            "variables": json.dumps(payload["variables"], separators=(",", ":")),
            "extensions": json.dumps(payload["extensions"], separators=(",", ":")),
        }
        r = requests.get(_GQL, params=params, headers=_HDR_GQL, timeout=20)
        r.raise_for_status()
        resp = r.json()
    return resp


def _credits_hidden(nm_id: str) -> list[tuple[str, str, str]]:
    """Credits behind the 'See all' paginated GraphQL slabs (ALL roles)."""
    out: list[tuple[str, str, str]] = []

    def page_once(job: str, slab_key: str, after: str | None):
        base_vars = {
            "id": nm_id,
            "includeUserRating": False,
            "locale": "en-US",
            **({"after": after} if after else {}),
        }

        def call(with_dept: bool):
            vars_ = dict(base_vars)
            if with_dept:
                vars_["department"] = job
            return _gql_call({
                "operationName": "NameMainFilmographyPaginatedCredits",
                "variables": vars_,
                "extensions": {
                    "persistedQuery": {"version": 1, "sha256Hash": PQ_HASHES[job]},
                },
            })

        # Try with department, then without (some PQs don’t expect it)
        resp = call(with_dept=True)
        if "data" not in resp or not (resp.get("data") or {}).get("name"):
            resp = call(with_dept=False)
        if "data" not in resp or not (resp.get("data") or {}).get("name"):
            return [], None

        data = resp["data"]["name"]
        slab = data.get(slab_key) or {}
        edges = slab.get("edges") or []
        info  = slab.get("pageInfo") or {}
        next_ = info.get("endCursor") if info.get("hasNextPage") else None
        return edges, next_

    for job, slab_key in DEPARTMENTS:
        cursor = None
        while True:
            try:
                edges, cursor = page_once(job, slab_key, cursor)
            except Exception:
                break
            for e in edges:
                tid  = e["node"]["title"]["id"]
                role = _normalize_role(job)
                out.append((tid, f"https://www.imdb.com/title/{tid}/", role))
            if not cursor:
                break

    return out



def _scrape_filmography(name_url: str) -> list[tuple[str, str, str]]:
    """Merge inline + hidden, dedupe (tt_id, role), drop 'Thanks' when redundant."""
    nm = re.search(r"(nm\d+)", name_url).group(1)

    seen: set[tuple[str, str]] = set()
    credits: list[tuple[str, str, str]] = []

    for tup in _credits_inline(name_url):
        key = (tup[0], tup[2])
        if key not in seen:
            seen.add(key)
            credits.append(tup)

    for tup in _credits_hidden(nm):
        key = (tup[0], tup[2])
        if key not in seen:
            seen.add(key)
            credits.append(tup)

    # Drop Thanks if there’s another role on the same title
    by_tt: dict[str, list[tuple[str, str, str]]] = {}
    for t, u, r in credits:
        by_tt.setdefault(t, []).append((t, u, r))

    pruned: list[tuple[str, str, str]] = []
    for lst in by_tt.values():
        roles = {r for *_, r in lst}
        if len(roles) > 1 and "Thanks" in roles:
            lst = [tup for tup in lst if tup[2] != "Thanks"]
        pruned.extend(lst)
    return pruned


# ─────────────────────── DB helpers (raw SQL) ───────────────────────
def _to_int_or_none(v):
    try:
        if v is None:
            return None
        s = str(v).strip()
        return int(s) if s.isdigit() else None
    except Exception:
        return None


def _upsert_project(db: Session, tt_id: str, meta: dict) -> tuple[str, bool]:
    """
    Insert/refresh a Project using plain SQL. Returns (project_id, was_insert).
    Uses the Postgres (xmax=0) trick to detect inserts.
    """
    params = {
        "imdb_id": tt_id,
        "title": meta.get("title"),
        "media_type": meta.get("media_type"),
        "year": _to_int_or_none(meta.get("year")),
        "description": meta.get("description"),
    }

    sql = text("""
        INSERT INTO projects (
            imdb_id, title, media_type, year, description, status, tracking_status
        )
        VALUES (
            :imdb_id, :title, :media_type, :year, :description, 'Archived', 'Archived'
        )
        ON CONFLICT (imdb_id) DO UPDATE
        SET title       = EXCLUDED.title,
            media_type  = EXCLUDED.media_type,
            year        = EXCLUDED.year,
            description = COALESCE(EXCLUDED.description, projects.description)
        RETURNING id, (xmax = 0) AS is_new
    """)

    row = db.execute(sql, params).one()
    return row[0], bool(row[1])


def _link_role(db: Session, creative_id: str, project_id: str, role_slug: str) -> None:
    """
    Idempotently link (creative, project, role). No rollbacks on dupes.
    """
    role_disp = role_slug.replace("_", " ").title()
    sql = text("""
        INSERT INTO creative_project_roles (creative_id, project_id, role)
        VALUES (:cid, :pid, :role)
        ON CONFLICT (creative_id, project_id, role) DO NOTHING
    """)
    db.execute(sql, {"cid": creative_id, "pid": project_id, "role": role_disp})


def _upsert_tags_and_link(db: Session, project_id: str, tag_names: list[str]) -> None:
    """
    Ensure genre_tags exist and link them to the project (idempotent), using plain SQL.
    """
    if not tag_names:
        return

    # 1) Upsert tags by name
    ins_tags = text("""
        INSERT INTO genre_tags(name) VALUES (:name)
        ON CONFLICT (name) DO NOTHING
    """)
    db.execute(ins_tags, [{"name": n} for n in tag_names])

    # 2) Fetch tag IDs with expanding IN
    sel = text("SELECT id, name FROM genre_tags WHERE name IN :names") \
        .bindparams(bindparam("names", expanding=True))
    rows = db.execute(sel, {"names": tag_names}).fetchall()
    tag_ids = [r[0] for r in rows]
    if not tag_ids:
        return

    # 3) Link join rows (ON CONFLICT DO NOTHING)
    ins_link = text("""
        INSERT INTO project_genre_tags (project_id, tag_id)
        VALUES (:pid, :tid)
        ON CONFLICT (project_id, tag_id) DO NOTHING
    """)
    db.execute(ins_link, [{"pid": project_id, "tid": tid} for tid in tag_ids])



def sync_creative_credits(
    db: Session,
    creative_id: str,
    imdb_id: str,
    *,
    sleep: float = 0.3,
    progress: Optional[Callable[[dict], None]] = None,  # ← FIXED
) -> Dict[str, Any]:
    """
    Scrape all credits for one creative (by nm id) and persist:
      - projects (insert/update)
      - creative_project_roles (idempotent)
      - genre tags (idempotent)
    Returns a summary dict. Raises on fatal errors. Commits per title.
    """
    name_url = f"https://www.imdb.com/name/{imdb_id}/"

    if progress: progress({"type": "init", "nm_id": imdb_id})

    credits = _scrape_filmography(name_url)
    credits = list({(t, r): (t, u, r) for t, u, r in credits}.values())  # dedupe (tt, role)
    role_counts = Counter(r for _, _, r in credits)
    total = len(credits)
    if progress: progress({"type": "plan", "total": total, "role_counts": dict(role_counts)})

    ok = err = 0
    start = time.monotonic()

    for i, (tt, url, role) in enumerate(credits, start=1):
        status = "OK"
        title_for_log = tt
        try:
            meta = _title_meta(url)
            title_for_log = meta.get("title") or tt

            pid, is_new = _upsert_project(db, tt, meta)
            _link_role(db, creative_id, pid, role)
            if is_new and meta.get("tags"):
                _upsert_tags_and_link(db, pid, meta["tags"])

            db.commit()
            ok += 1
            status = "NEW" if is_new else "OK"
        except Exception as e:
            db.rollback()
            err += 1
            status = "ERR"
            if progress:
                progress({
                    "type": "log",
                    "message": f"⚠ {tt} ({role}) — {type(e).__name__}: {e}",
                })

        if progress:
            elapsed_ms = int((time.monotonic() - start) * 1000)
            progress({
                "type": "progress",
                "i": i, "total": total, "ok": ok, "err": err,
                "elapsed_ms": elapsed_ms, "title": title_for_log, "role": role, "status": status,
            })

        time.sleep(sleep)

    summary = {
        "type": "done",
        "total": total,
        "ok": ok,
        "err": err,
        "elapsed_ms": int((time.monotonic() - start) * 1000),
        "role_counts": dict(role_counts),
    }
    if progress: progress(summary)
    return summary



# ───────────────────────────── Endpoint ─────────────────────────────
@router.get("/{creative_id}/scrape_imdb/stream", dependencies=[Depends(require_writer)])
def scrape_imdb_stream(creative_id: str):
    def gen() -> Iterator[bytes]:
        db = next(get_db())
        try:
            C = models.Creative
            creative = db.query(C).get(creative_id)
            if not creative:
                yield _sse("error", {"type": "error", "message": "Creative not found"}); return
            if not creative.imdb_id:
                yield _sse("error", {"type": "error", "message": "Creative has no IMDb ID on file"}); return

            # tell the client who we're working on
            yield _sse("init", {"type": "init", "creativeName": creative.name, "nm_id": creative.imdb_id})

            # bridge progress events → SSE frames
            def on_progress(ev: dict):
                etype = ev.get("type") or "message"
                yield_bytes = _sse(etype, ev)
                # Python generator trick to push bytes out of inner callback:
                nonlocal _last_chunk
                _last_chunk = yield_bytes

            # run the sync, emitting SSE
            _last_chunk = None
            def pump(ev):
                nonlocal _last_chunk
                for _ in (): pass  # no-op to keep closure happy
                on_progress(ev)
                if _last_chunk:   # send chunk
                    chunk = _last_chunk; _last_chunk = None
                    return chunk

            # call the helper and stream its events
            def proxy(ev):
                b = pump(ev)
                if b: 
                    return b

            # drive the helper, manually yielding bytes
            def run_and_stream():
                out = None
                def cb(ev):
                    b = pump(ev)
                    if b: chunks.append(b)

                chunks = []
                out = sync_creative_credits(db, creative.id, creative.imdb_id, progress=cb)
                return chunks, out

            chunks, _ = run_and_stream()
            for c in chunks:
                yield c

        finally:
            try: db.close()
            except: pass

    return StreamingResponse(gen(), media_type="text/event-stream", headers={
        "Cache-Control": "no-cache", "X-Accel-Buffering": "no", "Connection": "keep-alive",
    })
