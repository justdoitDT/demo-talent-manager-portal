# backend/app/ai/recommend_client_for_project_need/rebuild_all_creative_embeddings.py

from sqlalchemy import text
from app.database import SessionLocal
from app.ai.recommend_client_for_project_need.nightly import rebuild_client_embeddings

def main():
    db = SessionLocal()
    try:
        # ALL creatives (not just clients)
        ids = db.execute(text("SELECT id FROM creatives ORDER BY id")).scalars().all()
        print(f"Rebuilding embeddings for {len(ids)} creatives…")
        rebuild_client_embeddings(db, creative_ids=ids)
        print("Done.")
    finally:
        db.close()

if __name__ == "__main__":
    main()
