# backend/app/scripts/backfill_imdb_all_creatives.py
import argparse, sys, time, traceback
from typing import Iterable, Tuple

from sqlalchemy.orm import Session
from app import models

# Use your app's Session factory. If you don't export SessionLocal,
# fall back to using the get_db() generator.
try:
    from app.database import SessionLocal  # preferred
except Exception:
    from app.database import get_db
    def SessionLocal():
        gen = get_db()
        db = next(gen)
        # caller must db.close(); gen.close() not strictly needed
        return db

# TODO: CHANGE THIS LINE to point at your existing one-creative sync function.
# Expected signature: sync_creative_credits(db: Session, creative_id: str, imdb_id: str) -> None
from app.routers.imdb_scrape import sync_creative_credits

def iter_creatives(db: Session, only_with_imdb: bool, only_missing_links: bool) -> Iterable[Tuple[str, str]]:
    """
    Yields (creative_id, imdb_id). Set filters via flags.
    - only_with_imdb: require imdb_id IS NOT NULL
    - only_missing_links: skip creatives that already have any rows in creative_project_roles
    """
    q = db.query(models.Creative.id, models.Creative.imdb_id)
    if only_with_imdb:
        q = q.filter(models.Creative.imdb_id.isnot(None))

    if only_missing_links:
        subq = db.query(models.creative_project_roles.c.creative_id).distinct()
        q = q.filter(~models.Creative.id.in_(subq))

    return q.order_by(models.Creative.id).all()

def main():
    ap = argparse.ArgumentParser(description="One-time IMDb backfill for ALL creatives.")
    ap.add_argument("--only-with-imdb", action="store_true",
                    help="Process only creatives where creatives.imdb_id IS NOT NULL.")
    ap.add_argument("--only-missing-links", action="store_true",
                    help="Skip creatives that already have any project links (creative_project_roles).")
    ap.add_argument("--sleep", type=float, default=0.4,
                    help="Seconds to sleep between creatives (be nice to IMDb).")
    ap.add_argument("--stop-on-error", action="store_true",
                    help="Abort on first error (default: continue).")
    ap.add_argument("--limit", type=int, default=None,
                    help="Limit number of creatives to process (for smoke tests).")
    args = ap.parse_args()

    db = SessionLocal()
    try:
        rows = iter_creatives(db, only_with_imdb=args.only_with_imdb, only_missing_links=args.only_missing_links)
        if args.limit:
            rows = rows[:args.limit]
        total = len(rows)
        print(f"Backfilling IMDb for {total} creatives...", file=sys.stderr)

        for i, (creative_id, imdb_id) in enumerate(rows, 1):
            try:
                if not imdb_id:
                    # Optionally: look up by name here if you support it; otherwise skip cleanly.
                    print(f"[{i}/{total}] {creative_id}: no imdb_id; skipping", file=sys.stderr)
                    continue

                print(f"[{i}/{total}] {creative_id} ({imdb_id}) ...", file=sys.stderr)
                sync_creative_credits(db, creative_id, imdb_id)
                db.commit()
            except KeyboardInterrupt:
                print("\nInterrupted by user.", file=sys.stderr)
                raise
            except Exception as e:
                db.rollback()
                print(f"[{i}/{total}] ERROR {creative_id} ({imdb_id}): {e}", file=sys.stderr)
                traceback.print_exc()
                if args.stop_on_error:
                    raise
            finally:
                time.sleep(args.sleep)
        print("Done.", file=sys.stderr)
    finally:
        db.close()

if __name__ == "__main__":
    main()
