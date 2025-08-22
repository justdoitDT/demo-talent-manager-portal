# backend/app/ai/recommend_client_for_project_need/rebuild_all_need_embeddings.py
from ...database import SessionLocal
from .project_context import rebuild_need_embeddings

if __name__ == "__main__":
    import argparse
    p = argparse.ArgumentParser()
    p.add_argument("--all", action="store_true", help="rebuild ALL active needs (not just missing)")
    p.add_argument("--limit", type=int, default=None)
    args = p.parse_args()

    with SessionLocal() as db:
        n = rebuild_need_embeddings(db, only_missing=not args.all, limit=args.limit)
        print(f"rebuilt need embeddings: {n}")
