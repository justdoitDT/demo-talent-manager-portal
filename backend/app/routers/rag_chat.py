# backend/app/routers/rag_chat.py

import os
from datetime import datetime
from typing import List, Dict, Any, Optional, Literal, AsyncIterator

import re
import json
import asyncpg
from fastapi import APIRouter, Depends, HTTPException, Response
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.orm import Session

from ..database import get_db

# Re-use your existing RAG chat plumbing
from ..ai.rag_chat import rag_chat_core as rag_core





# # debug
# from urllib.parse import urlparse
# import logging
# LLM_DB_DSN = os.getenv("LLM_DB_DSN")
# logger = logging.getLogger(__name__)

# @asynccontextmanager
# async def get_llm_conn():
#     from app.config import LLM_DB_DSN  # or wherever it comes from

#     if not LLM_DB_DSN:
#         raise RuntimeError("LLM_DB_DSN is not set inside app")

#     parsed = urlparse(LLM_DB_DSN)
#     # Be careful not to log the password
#     logger.info(
#         "LLM_DB_DSN user=%s host=%s db=%s",
#         parsed.username,
#         parsed.hostname,
#         parsed.path.lstrip("/"),
#     )

#     try:
#         conn = await asyncpg.connect(LLM_DB_DSN)
#     except Exception as e:
#         logger.exception("Failed to connect to LLM DB")
#         raise

#     try:
#         yield conn
#     finally:
#         await conn.close()





# Single router that handles BOTH llm-tools and rag-chat
router = APIRouter(tags=["llm-tools", "rag-chat"])

# ─────────────────────────────────────────
# Demo-mode: single hard-coded team_id
# ─────────────────────────────────────────

DEMO_TEAM_ID = os.getenv("DEMO_TEAM_ID", "DEMO_TEAM")


# ─────────────────────────────────────────
# asyncpg dependency for llm_reader
# ─────────────────────────────────────────

LLM_DB_DSN = os.getenv("LLM_DB_DSN")

if not LLM_DB_DSN:
    raise RuntimeError("LLM_DB_DSN environment variable is not set")


async def get_llm_conn() -> AsyncIterator[asyncpg.Connection]:
    """
    FastAPI dependency: yields a read-only connection as llm_reader.
    Automatically closes after the request.
    """
    conn = await asyncpg.connect(LLM_DB_DSN)
    try:
        yield conn
    finally:
        await conn.close()


# ─────────────────────────────────────────
# LLM tools endpoints (used by rag_chat_core)
# ─────────────────────────────────────────

@router.get("/llm/list_tables")
async def list_tables(
    conn: asyncpg.Connection = Depends(get_llm_conn),
) -> List[str]:
    """
    Return the list of tables the llm_reader can see in the public schema.
    """
    rows = await conn.fetch(
        """
        SELECT table_name
        FROM information_schema.tables
        WHERE table_schema = 'public'
          AND table_type = 'BASE TABLE'
        ORDER BY table_name;
        """
    )
    return [r["table_name"] for r in rows]


@router.get("/llm/schema/{table_name}")
async def get_schema(
    table_name: str,
    conn: asyncpg.Connection = Depends(get_llm_conn),
) -> List[Dict[str, Any]]:
    """
    Return column name, data type, and nullability for a given table in public schema.
    """
    rows = await conn.fetch(
        """
        SELECT
          column_name,
          data_type,
          is_nullable
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = $1
        ORDER BY ordinal_position;
        """,
        table_name,
    )
    if not rows:
        raise HTTPException(status_code=404, detail=f"Table '{table_name}' not found")
    return [
        {
            "name": r["column_name"],
            "type": r["data_type"],
            "nullable": (r["is_nullable"] == "YES"),
        }
        for r in rows
    ]


class RunSQLRequest(BaseModel):
    sql: str
    max_rows: int = 200


@router.post("/llm/run_sql")
async def run_sql(
    body: RunSQLRequest,
    conn: asyncpg.Connection = Depends(get_llm_conn),
) -> List[Dict[str, Any]]:
    """
    Execute a read-only SELECT query (on public.*) and return up to max_rows rows.

    This is the main tool the LLM will use to actually read data.

    For debugging / prompt-tuning:
    - Logs the final SQL it runs (after adding LIMIT).
    - On failure, includes the SQL in the error payload so the caller
      can see *exactly* what was attempted.
    """
    raw_sql = body.sql.strip().rstrip(";")

    # Strip off leading `-- ...` comment lines when deciding if this is a SELECT
    lines = raw_sql.splitlines()
    while lines and lines[0].lstrip().startswith("--"):
        lines.pop(0)
    sql_no_comments = "\n".join(lines).lstrip()

    lower_no_comments = sql_no_comments.lower()

    # Very simple safety checks; llm_reader is read-only, but lets keep queries sane.
    if not lower_no_comments.startswith("select"):
        detail = {
            "error": "Only SELECT queries are allowed",
            "sql": raw_sql,
        }
        print("[llm.run_sql] REJECT non-SELECT:", detail)
        raise HTTPException(status_code=400, detail=detail)

    forbidden_keywords = ["insert ", "update ", "delete ", "drop ", "alter ", "truncate "]
    lower_full = raw_sql.lower()
    if any(k in lower_full for k in forbidden_keywords):
        detail = {
            "error": "Only read-only SELECT queries are allowed",
            "sql": raw_sql,
        }
        print("[llm.run_sql] REJECT forbidden keyword:", detail)
        raise HTTPException(status_code=400, detail=detail)

    # Detect an existing LIMIT anywhere after comments (case-insensitive).
    # This fixes the "LIMIT 5 LIMIT 200" bug.
    has_limit = bool(re.search(r"\blimit\b", lower_no_comments))

    # Auto-add LIMIT only if the query doesn't already have one
    final_sql = raw_sql
    if not has_limit:
        final_sql = f"{raw_sql} LIMIT {body.max_rows}"

    # Log the final SQL the LLM actually caused to be executed
    print("\n[llm.run_sql] >>> executing SQL:")
    print(final_sql)

    try:
        rows = await conn.fetch(final_sql)
    except Exception as e:
        # Surface the SQL and the DB error to the caller
        detail = {
            "error": f"SQL error: {e}",
            "sql": final_sql,
        }
        print("[llm.run_sql] !!! ERROR:", detail)
        raise HTTPException(status_code=400, detail=detail)

    print(f"[llm.run_sql] <<< returned {len(rows)} row(s)")
    return [dict(r) for r in rows]


# ─────────────────────────────────────────
# RAG chat models
# ─────────────────────────────────────────

class ChatConversation(BaseModel):
    id: int
    team_id: str
    title: Optional[str]
    created_at: datetime
    updated_at: datetime
    last_activity_at: datetime
    archived: bool


class ChatMessage(BaseModel):
    id: int
    conversation_id: int
    role: Literal["user", "assistant"]
    content: str
    created_at: datetime
    meta: Optional[dict] = None


class ConversationWithMessages(BaseModel):
    conversation: ChatConversation
    messages: List[ChatMessage]


class CreateConversationRequest(BaseModel):
    title: Optional[str] = None


class UpdateConversationRequest(BaseModel):
    title: Optional[str] = None
    archived: Optional[bool] = None


class SendMessageRequest(BaseModel):
    content: str


class SendMessageResponse(BaseModel):
    conversation: ChatConversation
    messages: List[ChatMessage]


# ─────────────────────────────────────────
# RAG chat helpers
# ─────────────────────────────────────────

def _row_to_conversation(row) -> ChatConversation:
    return ChatConversation(
        id=row["id"],
        team_id=row["team_id"],
        title=row["title"],
        created_at=row["created_at"],
        updated_at=row["updated_at"],
        last_activity_at=row["last_activity_at"],
        archived=row["archived"],
    )


def _row_to_message(row) -> ChatMessage:
    return ChatMessage(
        id=row["id"],
        conversation_id=row["conversation_id"],
        role=row["role"],
        content=row["content"],
        created_at=row["created_at"],
        meta=row["meta"],
    )


def _get_demo_conversation_or_404(db: Session, conversation_id: int) -> ChatConversation:
    """
    Load a conversation for the demo team or 404 if it doesn't exist.
    No auth; everything is scoped to DEMO_TEAM_ID.
    """
    res = db.execute(
        text(
            """
            SELECT id, team_id, title, created_at, updated_at, last_activity_at, archived
            FROM rag_chat_conversations
            WHERE id = :cid
              AND team_id = :team_id
            """
        ),
        {"cid": conversation_id, "team_id": DEMO_TEAM_ID},
    )
    row = res.mappings().first()
    if row is None:
        raise HTTPException(status_code=404, detail="Conversation not found")
    return _row_to_conversation(row)


def _append_run_update(
    db: Session,
    run_id: int,
    seq: int,
    kind: str,
    content: dict | None = None,
) -> None:
    """
    Insert a row into rag_chat_run_updates.

    NOTE: seq must be an INT, kind must be a STRING, and content must be JSON-serializable.
    """
    payload = json.dumps(content or {})

    db.execute(
        text(
            """
            INSERT INTO rag_chat_run_updates (run_id, seq, kind, content)
            VALUES (:run_id, :seq, :kind, CAST(:content AS JSONB))
            """
        ),
        {
            "run_id": run_id,
            "seq": seq,
            "kind": kind,
            "content": payload,
        },
    )
    db.commit()


# ─────────────────────────────────────────
# RAG chat routes (demo: no auth, single team)
# ─────────────────────────────────────────

@router.get("/rag-chat/conversations", response_model=List[ChatConversation])
def list_conversations(
    include_archived: bool = False,
    limit: int = 50,
    db: Session = Depends(get_db),
):
    """
    List conversations for the demo team.
    Sorted by most recent activity.
    """
    limit = max(1, min(limit, 200))

    res = db.execute(
        text(
            """
            SELECT id, team_id, title, created_at, updated_at, last_activity_at, archived
            FROM rag_chat_conversations
            WHERE team_id = :team_id
              AND (:include_archived OR archived = FALSE)
            ORDER BY last_activity_at DESC
            LIMIT :limit
            """
        ),
        {
            "team_id": DEMO_TEAM_ID,
            "include_archived": include_archived,
            "limit": limit,
        },
    )

    return [_row_to_conversation(r) for r in res.mappings().all()]


@router.post("/rag-chat/conversations", response_model=ChatConversation)
def create_conversation(
    body: CreateConversationRequest,
    db: Session = Depends(get_db),
):
    """
    Create an empty conversation for the demo team.
    (The first user message is sent via POST /rag-chat/conversations/{id}/messages.)
    """
    res = db.execute(
        text(
            """
            INSERT INTO rag_chat_conversations (team_id, title)
            VALUES (:team_id, :title)
            RETURNING id, team_id, title, created_at, updated_at, last_activity_at, archived
            """
        ),
        {"team_id": DEMO_TEAM_ID, "title": body.title},
    )
    row = res.mappings().one()
    db.commit()
    return _row_to_conversation(row)


@router.get(
    "/rag-chat/conversations/{conversation_id}",
    response_model=ConversationWithMessages,
)
def get_conversation(
    conversation_id: int,
    db: Session = Depends(get_db),
):
    """
    Get a single conversation plus all messages for the demo team.
    """
    convo = _get_demo_conversation_or_404(db, conversation_id)

    res = db.execute(
        text(
            """
            SELECT id, conversation_id, role, content, meta, created_at
            FROM rag_chat_messages
            WHERE conversation_id = :cid
            ORDER BY created_at ASC, id ASC
            """
        ),
        {"cid": conversation_id},
    )
    messages = [_row_to_message(r) for r in res.mappings().all()]

    return ConversationWithMessages(conversation=convo, messages=messages)


@router.post(
    "/rag-chat/conversations/{conversation_id}/messages",
    response_model=SendMessageResponse,
)
def send_message(
    conversation_id: int,
    body: SendMessageRequest,
    db: Session = Depends(get_db),
):
    """
    Add a user message to a conversation, call the LLM with full history,
    store the assistant reply, and return both new messages.

    For this version we also:
      - create a rag_chat_runs row for this turn
      - stream status updates into rag_chat_run_updates via a callback
        (e.g. "Analyzing question…", "Running SQL on Postgres…")
    """
    # Ensure this convo exists for the demo team
    convo = _get_demo_conversation_or_404(db, conversation_id)

    # 1) Insert user message
    user_row_res = db.execute(
        text(
            """
            INSERT INTO rag_chat_messages (conversation_id, role, content, meta)
            VALUES (:cid, 'user', :content, NULL)
            RETURNING id, conversation_id, role, content, meta, created_at
            """
        ),
        {
            "cid": conversation_id,
            "content": body.content,
        },
    )
    user_msg_row = user_row_res.mappings().one()
    user_msg = _row_to_message(user_msg_row)

    # 2) Create a run row for this user message
    run_row_res = db.execute(
        text(
            """
            INSERT INTO rag_chat_runs (conversation_id, user_message_id, status)
            VALUES (:cid, :mid, 'running')
            RETURNING id
            """
        ),
        {
            "cid": conversation_id,
            "mid": user_msg.id,
        },
    )
    run_id = run_row_res.mappings().one()["id"]

    # 3) Closure to append run updates with a monotonically increasing seq
    seq_counter = {"value": 0}

    def append_run_update(kind: str, content: dict | None = None) -> None:
        """
        kind: 'status', 'assistant_final', 'error', etc.
        content: JSON payload, e.g. {"text": "Running SQL on Postgres…"}
        """
        seq_counter["value"] += 1
        _append_run_update(
            db=db,
            run_id=run_id,
            seq=seq_counter["value"],
            kind=kind,
            content=content or {},
        )

    # Initial status for this run
    append_run_update("status", {"text": "Analyzing question…"})

    # 4) Load full history (including this new user message)
    res_hist = db.execute(
        text(
            """
            SELECT role, content
            FROM rag_chat_messages
            WHERE conversation_id = :cid
            ORDER BY created_at ASC, id ASC
            """
        ),
        {"cid": conversation_id},
    )
    history = [
        {"role": row["role"], "content": row["content"]}
        for row in res_hist.mappings().all()
    ]

    # 5) Call LLM with history (delegates to rag_chat_core) and stream updates
    try:
        assistant_text = rag_core.call_llm_with_history(
            history,
            on_update=append_run_update,
        )
    except Exception as e:
        # Mark run as failed and record an error update, then re-raise
        append_run_update("error", {"text": "Assistant failed.", "detail": str(e)})
        db.execute(
            text(
                """
                UPDATE rag_chat_runs
                SET status = 'failed',
                    error_message = :err,
                    updated_at = now()
                WHERE id = :run_id
                """
            ),
            {"err": str(e), "run_id": run_id},
        )
        db.commit()
        raise

    # Optional: final status update with a preview of the answer
    append_run_update(
        "assistant_final",
        {"text": (assistant_text[:4000] if assistant_text else "")},
    )

    # Mark run as completed
    db.execute(
        text(
            """
            UPDATE rag_chat_runs
            SET status = 'completed',
                error_message = NULL,
                updated_at = now()
            WHERE id = :run_id
            """
        ),
        {"run_id": run_id},
    )

    # 6) Insert assistant message
    asst_row_res = db.execute(
        text(
            """
            INSERT INTO rag_chat_messages (conversation_id, role, content, meta)
            VALUES (:cid, 'assistant', :content, NULL)
            RETURNING id, conversation_id, role, content, meta, created_at
            """
        ),
        {
            "cid": conversation_id,
            "content": assistant_text,
        },
    )
    asst_msg_row = asst_row_res.mappings().one()
    asst_msg = _row_to_message(asst_msg_row)

    # 7) Generate AI title IF the conversation doesn't already have one
    new_title: Optional[str] = None
    if not (convo.title and convo.title.strip()):
        new_title = rag_core.generate_conversation_title(history)
        # If generation failed or returned empty, leave title as NULL in DB
        if new_title is not None:
            new_title = new_title.strip() or None

    # 8) Update conversation timestamps and (if needed) title
    db.execute(
        text(
            """
            UPDATE rag_chat_conversations
            SET
              updated_at       = now(),
              last_activity_at = now(),
              title            = COALESCE(title, :title)
            WHERE id = :cid
            """
        ),
        {"cid": conversation_id, "title": new_title},
    )

    # Final commit for messages + convo + run status
    db.commit()

    # Refresh convo row (to get updated_at/last_activity_at/title)
    refreshed = _get_demo_conversation_or_404(db, conversation_id)

    return SendMessageResponse(
        conversation=refreshed,
        messages=[user_msg, asst_msg],
    )


@router.patch(
    "/rag-chat/conversations/{conversation_id}",
    response_model=ChatConversation,
)
def update_conversation(
    conversation_id: int,
    body: UpdateConversationRequest,
    db: Session = Depends(get_db),
):
    """
    Update conversation metadata (currently: title and archived flag)
    for the demo team.
    """
    # Ensure it exists for the demo team
    _ = _get_demo_conversation_or_404(db, conversation_id)

    updates = []
    params: Dict[str, Any] = {"cid": conversation_id}

    if body.title is not None:
        updates.append("title = :title")
        params["title"] = body.title

    if body.archived is not None:
        updates.append("archived = :archived")
        params["archived"] = body.archived

    if not updates:
        # Nothing to change
        return _get_demo_conversation_or_404(db, conversation_id)

    # Any metadata change bumps updated_at,
    # but DOES NOT change last_activity_at.
    updates.append("updated_at = now()")

    set_clause = ", ".join(updates)
    db.execute(
        text(f"UPDATE rag_chat_conversations SET {set_clause} WHERE id = :cid"),
        params,
    )
    db.commit()

    return _get_demo_conversation_or_404(db, conversation_id)


@router.delete("/rag-chat/conversations/{conversation_id}", status_code=204)
def delete_conversation(
    conversation_id: int,
    db: Session = Depends(get_db),
):
    """
    Permanently delete a conversation and all its messages for the demo team.
    """
    # Ensure it exists for the demo team
    _ = _get_demo_conversation_or_404(db, conversation_id)

    # Delete messages first due to FK constraints
    db.execute(
        text(
            "DELETE FROM rag_chat_messages WHERE conversation_id = :cid"
        ),
        {"cid": conversation_id},
    )
    db.execute(
        text(
            "DELETE FROM rag_chat_conversations WHERE id = :cid"
        ),
        {"cid": conversation_id},
    )
    db.commit()

    return Response(status_code=204)


class RunUpdate(BaseModel):
    id: int
    run_id: int
    seq: int
    kind: str
    content: dict
    created_at: datetime


class RunUpdatesResponse(BaseModel):
    run_id: Optional[int]
    status: Optional[str]
    updates: List[RunUpdate]


@router.get(
    "/rag-chat/conversations/{conversation_id}/run_updates",
    response_model=RunUpdatesResponse,
)
def get_run_updates(
    conversation_id: int,
    since_seq: Optional[int] = None,
    db: Session = Depends(get_db),
):
    """
    Return updates for the *latest* run on this conversation (demo team only).

    Frontend can poll this every ~5 seconds.
    """
    # Ensure the conversation exists for the demo team
    _ = _get_demo_conversation_or_404(db, conversation_id)

    # Find the latest run for this conversation
    run_row = db.execute(
        text(
            """
            SELECT id, status
            FROM rag_chat_runs
            WHERE conversation_id = :cid
            ORDER BY id DESC
            LIMIT 1
            """
        ),
        {"cid": conversation_id},
    ).mappings().first()

    if not run_row:
        return RunUpdatesResponse(run_id=None, status=None, updates=[])

    run_id = run_row["id"]
    status = run_row["status"]

    params: Dict[str, Any] = {"run_id": run_id}
    where = "run_id = :run_id"
    if since_seq is not None:
        where += " AND seq > :since_seq"
        params["since_seq"] = since_seq

    rows = db.execute(
        text(
            f"""
            SELECT id, run_id, seq, kind, content, created_at
            FROM rag_chat_run_updates
            WHERE {where}
            ORDER BY seq ASC
            """
        ),
        params,
    ).mappings().all()

    updates = [
        RunUpdate(
            id=r["id"],
            run_id=r["run_id"],
            seq=r["seq"],
            kind=r["kind"],
            content=r["content"] or {},
            created_at=r["created_at"],
        )
        for r in rows
    ]

    return RunUpdatesResponse(
        run_id=run_id,
        status=status,
        updates=updates,
    )
