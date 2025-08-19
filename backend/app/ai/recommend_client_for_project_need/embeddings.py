# backend/app/ai/recommend_client_for_project_need/embeddings.py

import os, time, math
from typing import List
import numpy as np
from openai import OpenAI
from openai import RateLimitError, APIError, APITimeoutError

# Config
EMBED_MODEL = os.getenv("OPENAI_EMBED_MODEL", "text-embedding-3-small")
# If you kept VECTOR(1536), leave 1536. If you ALTERed to 3072, set 3072.
EMBED_DIM = int(os.getenv("EMBED_DIM", "1536"))

_client = OpenAI()

def _normalize(v: List[float]) -> np.ndarray:
    arr = np.array(v, dtype=np.float32)
    n = np.linalg.norm(arr)
    if n == 0 or math.isfinite(n) is False:
        return arr
    return arr / n

def embed_texts(texts: List[str], batch_size: int = 96, normalize: bool = True) -> List[np.ndarray]:
    """Return list of numpy arrays; safe, batched, retried."""
    out: List[np.ndarray] = []
    i = 0
    while i < len(texts):
        chunk = texts[i : i + batch_size]
        # retry with simple exponential backoff
        for attempt in range(5):
            try:
                resp = _client.embeddings.create(model=EMBED_MODEL, input=chunk)
                for d in resp.data:
                    vec = d.embedding
                    arr = _normalize(vec) if normalize else np.array(vec, dtype=np.float32)
                    out.append(arr)
                break
            except (RateLimitError, APITimeoutError, APIError) as e:
                sleep = min(2 ** attempt, 8)
                time.sleep(sleep)
                if attempt == 4:
                    # final fallback: deterministic non-zero embedding per text (prevents NaNs downstream)
                    for idx, t in enumerate(chunk):
                        # hash-based fallback vector, unit-ish length
                        # keep size = EMBED_DIM
                        import hashlib
                        h = hashlib.sha256((t or "").encode("utf-8")).digest()
                        raw = (h * ((EMBED_DIM // len(h)) + 1))[:EMBED_DIM]
                        arr = np.frombuffer(raw, dtype=np.uint8).astype(np.float32)
                        arr = arr - arr.mean()
                        n = np.linalg.norm(arr)
                        arr = arr / n if n > 0 else arr
                        out.append(arr)
        i += batch_size
    return out
