# backend/app/routers/notes.py
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from ..database import get_db
from .. import models, schemas
from ..auth_dep import require_team_or_higher, require_writer, require_admin


router = APIRouter(prefix="/notes", tags=["Notes"])

@router.patch("/{note_id}", response_model=schemas.NoteRead, dependencies=[Depends(require_writer)])
def update_note(
    note_id: int,
    payload: schemas.NoteCreate | dict,          # accepts {"note": "...", "status": "..."}
    db: Session = Depends(get_db),
):
    note: models.Note | None = db.get(models.Note, note_id)
    if not note:
        raise HTTPException(404, "Note not found")

    data = payload.model_dump(exclude_unset=True) if isinstance(payload, schemas.NoteCreate) else payload
    for k, v in data.items():
        setattr(note, k, v)

    db.commit()
    db.refresh(note)
    return note
