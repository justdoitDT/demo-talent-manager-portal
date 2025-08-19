# backend/app/routers/ai.py

from fastapi import APIRouter, UploadFile, File, HTTPException, Depends
from pydantic import BaseModel
from openai import OpenAI
import os, io
from typing import Optional
import PyPDF2, mammoth, textract  # make sure installed
from ..auth_dep import require_team_or_higher, require_writer, require_admin


router = APIRouter(prefix="/ai", tags=["ai"])

OPENAI_KEY = os.getenv("OPENAI_API_KEY")
if not OPENAI_KEY:
    raise RuntimeError("Set OPENAI_API_KEY in your env")
client = OpenAI(api_key=OPENAI_KEY)


# ---------- helpers ----------
def _extract_text(f: UploadFile) -> str:
    """
    Return raw text from PDF, DOC, DOCX.
    Reads the UploadFile's underlying file object; resets cursor when done.
    """
    # UploadFile.file is a SpooledTemporaryFile; read bytes
    raw = f.file.read()
    f.file.seek(0)  # reset so callers can re-read if needed

    if f.content_type == "application/pdf" or f.filename.lower().endswith(".pdf"):
        reader = PyPDF2.PdfReader(io.BytesIO(raw))
        return "\n".join(page.extract_text() or "" for page in reader.pages)

    if f.content_type in (
        "application/msword",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ) or f.filename.lower().endswith((".doc", ".docx")):
        if f.filename.lower().endswith(".docx"):
            # mammoth needs a bytes buffer
            return mammoth.extract_raw_text(io.BytesIO(raw)).value
        # legacy .doc — use textract
        return textract.process(io.BytesIO(raw), extension="doc").decode(errors="ignore")

    raise HTTPException(415, f"Unsupported file type: {f.content_type}")


def _chat(prompt: str, *, model: str = "gpt-4o-mini", temperature: float = 0.4) -> str:
    resp = client.chat.completions.create(
        model=model,
        messages=[
            {
                "role": "system",
                "content": "You are an assistant that creates concise metadata for film & TV writing samples.",
            },
            {"role": "user", "content": prompt},
        ],
        temperature=temperature,
    )
    return resp.choices[0].message.content.strip()


# ---------- response model ----------
class SummaryResp(BaseModel):
    summary: str


# ---------- main endpoint ----------
@router.post("/summarize_writing_sample", response_model=SummaryResp, dependencies=[Depends(require_writer)])
async def summarize_writing_sample(
    file: UploadFile = File(...),
    target_words: Optional[int] = 400,   # allow override if you like
):
    """
    Extract text from the uploaded file and ask the model for a ~250–500 word summary
    (default target_words ~400). Returns JSON { summary }.
    """
    text = _extract_text(file)
    # safety trim tokens: keep first ~16k chars
    sample = text[:-1]

    prompt = (
        "Summarize this writing sample (screenplay/script). "
        "Aim for roughly 250-500 words. "
        "Include: logline, style, tone, genres, and any "
        "other features one might use to identify similar projects.\n\n"
        f"{sample}\n\n"
        "Return ONLY the summary paragraph(s)."
    )

    summary = _chat(prompt)
    return SummaryResp(summary=summary)
