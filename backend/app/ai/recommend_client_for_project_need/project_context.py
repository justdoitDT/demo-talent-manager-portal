# backend/app/ai/recommend_client_for_project_need/project_context.py

from sqlalchemy import text
from .embeddings import embed_texts
import hashlib

Q_CTX = text("""
SELECT media_type, description, genre_text, notes_text
FROM v_project_context WHERE project_id = :pid
""")
UPSERT = text("""
INSERT INTO need_embeddings(need_id, embedding, context_hash)
VALUES (:need_id, :emb, :h)
ON CONFLICT (need_id) DO UPDATE SET
  embedding = EXCLUDED.embedding,
  context_hash = EXCLUDED.context_hash,
  created_at = now()
""")

def build_text(db, project_id: str) -> str:
    row = db.execute(Q_CTX, {"pid": project_id}).first()
    if not row: return ""
    media, desc, genre, notes = row
    return f"MEDIA_TYPE: {media}\nDESCRIPTION: {desc}\nGENRES: {genre}\nNOTES: {notes}"

def ensure_need_embedding(db, need_id: str, project_id: str):
    text_blob = build_text(db, project_id)
    h = hashlib.sha256(text_blob.encode("utf-8")).hexdigest()
    vec = embed_texts([text_blob])[0].tolist()
    db.execute(UPSERT, {"need_id": need_id, "emb": vec, "h": h})
    db.commit()
