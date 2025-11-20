# backend/app/ai/rag_chat/rag_chat_core.py

import os
import re
import json
import requests
from typing import List, Dict, Any, Optional, Callable
from openai import OpenAI

# ─────────────────────────────────────────
# OpenAI client + config
# ─────────────────────────────────────────
# Uses OPENAI_API_KEY from your env
client = OpenAI(api_key=os.environ.get("OPENAI_API_KEY"))

# Base URL for calling your own backend tools
BACKEND_BASE_URL = os.getenv("REACT_APP_API_URL", "http://127.0.0.1:8000")

# Optional: JWT the backend will accept for /llm/run_sql (manager/admin token)
LLM_SERVICE_JWT = os.getenv("LLM_SERVICE_JWT")

MODEL_ID = os.environ.get("RAG_CHAT_MODEL", "gpt-5-mini")


# ─────────────────────────────────────────
# Tools exposed to the LLM
# ─────────────────────────────────────────

TOOLS = [
    {
        "type": "function",
        "function": {
            "name": "list_tables",
            "description": "List all public tables that the analytics assistant can query.",
            "parameters": {
                "type": "object",
                "properties": {},
                "additionalProperties": False,
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_schema",
            "description": "Get the schema (columns and types) for a given table in the public schema.",
            "parameters": {
                "type": "object",
                "properties": {
                    "table_name": {"type": "string"},
                },
                "required": ["table_name"],
                "additionalProperties": False,
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "run_sql",
            "description": (
                "Execute a read-only SELECT query on the Postgres database "
                "and return up to max_rows rows."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "sql": {"type": "string"},
                    "max_rows": {"type": "integer", "default": 200},
                },
                "required": ["sql"],
                "additionalProperties": False,
            },
        },
    },
]


# ─────────────────────────────────────────
# Schema guide + system prompt
# ─────────────────────────────────────────

SCHEMA_GUIDE = """
High-level database map for the RDE manager portal (Postgres, schema `public`).

Use this as your mental model when planning joins and filters. Only tables and views
that exist in this database are described here.


============================================================
Core people: creatives, execs, reps, internal team
============================================================

• creatives
  - One row per creative (writer/director client, prospect, or non-client).
  - Key columns:
      id              (PK, text)
      name            (text, required)
      client_status   (text; e.g. "client", "prospective client",
                            "ex-client", "non-client")
      pronouns        (text)
      birthday        (date; typically month/day; year may be 9999 if obscured)
      birth_year      (smallint; actual birth year when known)
      location        (text)
      phone           (text)
      email           (email UDT)
      address         (text)
      headshot_url    (text)
      writing_samples (text[]; IDs of writing_samples)
      media_files     (text[]; generic file references)
      notes           (text; internal notes)
      created_at      (timestamptz)
      imdb_id         (varchar; e.g. "nm1234567")
      is_director     (boolean)
      has_directed_feature (boolean)
      is_writer       (boolean)
      writer_level    (numeric; 0–10 scale; used for “low/mid/upper” bands)
      tv_acceptable   (boolean; True if open to TV)
      availability    (enum UDT; typically "available"/"unavailable"/etc.)
      availability_last_changed (timestamptz)
      industry_notes  (text; deeper internal notes)
      unavailable_until (date; when they’re next free)
      supabase_uid    (uuid; link to auth user)
  - “Active clients” for analytics usually means:
      client_status IN ('client', 'prospective client').

• creative_duos / creative_duo_members
  - creative_duos: one row per duo that tends to work together.
      id (text), name (text)
  - creative_duo_members: join table linking creatives into duos.
      duo_id      → creative_duos.id
      creative_id → creatives.id

• executives
  - Execs at studios, production companies, TV networks, etc.
  - Key columns:
      id      (text, PK)
      name    (text)
      email   (text)
      phone   (text)
  - Relationships:
      executives_to_tv_networks
      executives_to_studios
      executives_to_production_companies
      project_to_executives
      sub_feedback.source_type='executive'
      sub_recipients.recipient_type='executive'

• executives_to_tv_networks / executives_to_studios / executives_to_production_companies
  - Many-to-many links between executives and buyer companies.
  - Columns:
      executive_id          → executives.id
      network_id / studio_id / production_company_id
                             → tv_networks / studios / production_companies
      status                (text; e.g. "Active" or "Archived")
      last_modified         (timestamptz)
      title                 (text; job title)
  - For “current position” style queries, filter status='Active'.

• external_agencies
  - External orgs like law firms, agencies, management, publicity.
  - Columns:
      id   (text, PK)
      name (text)

• external_talent_reps
  - Agents, managers, lawyers, publicists at those agencies.
  - Columns:
      id        (text, PK)
      name      (text)
      agency_id → external_agencies.id
      email     (text)
      phone     (text)
      created_at, updated_at (timestamptz)

• external_talent_rep_to_creative
  - Join table mapping creatives to their external reps.
  - Columns:
      rep_id      → external_talent_reps.id
      creative_id → creatives.id

• team
  - Internal managers, assistants, legal, etc.
  - Columns:
      id          (text, PK)
      name        (text)
      role        (text; e.g. "manager", "assistant", "legal")
      email       (email UDT)
      phone       (text)
      created_at  (timestamptz)
      supabase_uid(uuid)
      status      (enum UDT; typically "Active" or "Archived")
      is_admin    (boolean)
  - “Active team members” usually means status='Active'.

• client_team_assignments
  - Which team members manage which creatives.
  - Columns:
      creative_id → creatives.id
      team_id     → team.id

• social_accounts
  - Social media footprint for creatives.
  - Columns:
      creative_id    → creatives.id
      platform       (enum UDT; e.g. "instagram", "twitter", etc.)
      account_id     (varchar; handle / ID)
      follower_count (int; optional)


============================================================
Companies / buyers
============================================================

• tv_networks
  - TV networks (buyers).
  - Columns: id (text), name (text).

• studios
  - Studios (buyers).
  - Columns: id (text), name (text).

• production_companies
  - Production companies (buyers).
  - Columns: id (text), name (text).

• executives_to_tv_networks / executives_to_studios / executives_to_production_companies
  - (See above; they connect executives to these companies.)

• project_to_tv_networks / project_to_studios / project_to_production_companies
  - Attach projects to buyer entities.
  - Columns:
      project_id    → projects.id
      network_id    → tv_networks.id
      studio_id     → studios.id
      production_company_id → production_companies.id
      status        (text; e.g. "Active"/"Archived")
      last_modified (timestamptz)
  - For “current home / buyer” style questions, filter status='Active'.


============================================================
Projects & project types
============================================================

• projects
  - One row per project (feature, series, etc.).
  - Columns:
      id                 (text, PK)
      imdb_id            (varchar, optional)
      title              (text, required)
      media_type         (varchar; e.g. "Feature", "TV Series")
      year               (varchar; release or production year)
      description        (text; logline / summary)
      created_at         (timestamptz)
      status             (enum UDT; e.g. "Idea / Concept", "In Development",
                                   "Pitch-Ready", "Sold", "Archived")
      updated_at         (timestamptz)
      tracking_status    (enum UDT; e.g. "Hot List", "Active",
                                   "Priority Tracking", "Tracking",
                                   "Development", "Engaged",
                                   "Deep Tracking", "Archived",
                                   "Internal / Not Tracking")
      engagement         (text; misc engagement notes)
      updates            (text; misc updates)
      creatives_attached_note (text)
  - Heuristics:
      • “Archived projects” often have status='Archived'
        OR tracking_status='Archived'.
      • tracking_status='Internal / Not Tracking' is for internal-only projects.

• creative_project_roles
  - Link creatives to projects (credits / involvement).
  - Columns:
      creative_id → creatives.id
      project_id  → projects.id
      role        (varchar; e.g. "Writer", "Director", etc.)

• project_types
  - Master list of project “types” (how the project functions in the pipeline).
  - Columns:
      id   (text)
      type (text)
  - Common types:
      "Staffing", "OWA", "ODA", "Episodic Directing", "Re-write",
      "1st in", "Pitch".

• project_to_project_type
  - Join table between projects and project_types.
  - Columns:
      project_id  → projects.id
      type_id     → project_types.id
      status      (text; "Active"/"Archived")
      last_modified (timestamptz)
  - For current type(s), filter status='Active'.

• project_to_tv_networks / project_to_studios / project_to_production_companies / project_to_executives
  - Attach projects to buyers and execs.
  - Columns:
      project_id  → projects.id
      network_id  → tv_networks.id
      studio_id   → studios.id
      production_company_id → production_companies.id
      executive_id → executives.id
      status      (text; usually "Active"/"Archived")
      last_modified (timestamptz)

• project_genre_tags / genre_tags
  - project_genre_tags links projects to genre_tags.
      project_id → projects.id
      tag_id     → genre_tags.id
  - genre_tags defines canonical genres.
      id        (text, PK)
      name      (varchar; e.g. "Drama", "Sci-Fi")

• project_needs
  - “Needs” = job openings / staffing needs on a project.
  - Columns:
      id            (text, PK)
      project_id    → projects.id
      qualifications(enum UDT; values include:
                     "Director (Any)", "Director (Has Directed Feature)",
                     "Writer (Any)", "Writer (Upper)", "Writer (Mid - Upper)",
                     "Writer (Mid)", "Writer (Low - Mid)", "Writer (Low)",
                     "OWA", "ODA")
      description   (text)
      status        (text; "Active"/"Archived")
  - Interpretation of writer-level qualifications (using creatives.writer_level):
      • Writer (Low)        → approx 0–4
      • Writer (Low - Mid)  → approx 0–6
      • Writer (Mid)        → approx 4–6
      • Writer (Mid - Upper)→ approx 4–10
      • Writer (Upper)      → approx 6–10
    Director qualifiers use is_director / has_directed_feature.

• project_survey_responses
  - How involved/interested a creative is in their credits.
  - Columns:
      survey_id          → surveys.id
      project_id         → projects.id
      involvement_rating (smallint; 1–4)
      interest_rating    (smallint; 1–4)
      created_at, updated_at (timestamptz)
  - Useful for weighting credits by importance for a creative.


============================================================
Mandates & “what buyers want”
============================================================

• mandates
  - Descriptions of what buyers are currently looking for.
  - Columns:
      id           (text, PK)
      company_type (enum UDT; type of company; e.g. "ST", "TV", "PC")
      company_id   (text; FK to company table based on company_type)
      name         (text; short label/title)
      description  (text; main description of what they want)
      status       (enum UDT; typically "active" or "archived")
      created_at, updated_at (timestamptz)
  - “Active mandates” usually means status='active' (case-insensitive).

• mandate_genre_tags
  - Join table between mandates and genre_tags.
  - Columns:
      mandate_id → mandates.id
      tag_id     → genre_tags.id


============================================================
Submissions (“subs”) & feedback
============================================================

• subs
  - One row per submission sent to external parties.
  - Columns:
      id             (text, PK)
      intent_primary (enum UDT; e.g. "staffing", "sell_project",
                            "recruit_talent", "general_intro", "other")
      result         (enum UDT; e.g. "no_response", "pass", "success")
      created_by     → team.id
      created_at, updated_at (timestamptz)
      project_id     → projects.id
      project_need_id→ project_needs.id (nullable)
  - Interpretations:
      • intent_primary="staffing"       → trying to get a client hired.
      • intent_primary="sell_project"   → trying to sell client’s project.
      • intent_primary="recruit_talent" → bring others onto a client’s project.
      • intent_primary="general_intro"  → non-specific intro.
      • result="success"                → the sub worked.

• sub_to_client
  - Which creatives were submitted on a sub.
  - Columns:
      sub_id      → subs.id
      creative_id → creatives.id

• sub_to_mandate
  - Which mandate the sub is trying to satisfy.
  - Columns:
      sub_id     → subs.id
      mandate_id → mandates.id

• sub_to_team
  - Which internal team member “owns” the sub.
  - Columns:
      sub_id  → subs.id
      team_id → team.id

• sub_to_writing_sample
  - Which writing samples were attached.
  - Columns:
      sub_id            → subs.id
      writing_sample_id → writing_samples.id

• sub_recipients
  - Who received the submission.
  - Columns:
      sub_id           → subs.id
      recipient_type   (enum UDT; "executive", "external_rep", "creative")
      recipient_id     (text; ID in the corresponding table)
      recipient_company(text; denormalized company name)

• sub_feedback
  - Feedback on a sub from execs/creatives/reps.
  - Columns:
      id               (text, PK)
      sub_id           → subs.id
      source_type      (enum UDT; "executive", "external_rep", "creative")
      source_id        (text; ID in respective table)
      sentiment        (enum UDT; e.g. "positive", "not positive")
      feedback_text    (text)
      actionable_next  (text)
      created_by_team_id → team.id
      created_at       (timestamptz)
  - If a creative has positive feedback from an exec, that exec/company is effectively a “fan” of the creative.

• sub_list_view (view)
  - Convenience view for analytics on subs; prefer this over manually joining many tables.
  - Columns include:
      sub_id, created_at, updated_at
      intent_primary, media_type, result
      client_ids        (text[]; creative IDs)
      clients           (text; concatenated names)
      clients_list      (json; richer client info)
      recipients        (json; recipients info)
      executives        (text; joined exec names)
      recipient_company (text)
      feedback_count    (bigint)
      has_positive      (boolean)
      project_id        (text)
      project_title     (text)
  - Use sub_list_view for “show me all subs / responses / wins” type questions.


============================================================
Writing samples & content
============================================================

• writing_samples
  - Uploaded writing files.
  - Columns:
      id              (text, PK)
      storage_bucket  (text)
      storage_path    (text)
      filename        (text)
      file_description(text)
      synopsis        (text)
      file_type       (text; extension or kind)
      size_bytes      (bigint)
      uploaded_by     (text; usually team.id or similar)
      uploaded_at     (timestamptz)

• writing_sample_to_creative
  - Join table between writing_samples and creatives.
  - Columns:
      writing_sample_id → writing_samples.id
      creative_id       → creatives.id
      status            (text; e.g. "Active"/"Archived")

• writing_sample_to_project
  - Join table between writing_samples and projects.
  - Columns:
      writing_sample_id → writing_samples.id
      project_id        → projects.id
      status            (text; "Active"/"Archived")


============================================================
Surveys (for personality & context)
============================================================

• surveys
  - One survey per creative (current design).
  - Columns:
      id         (int, PK)
      creative_id→ creatives.id
      created_at, updated_at (timestamptz)

• survey_questions
  - Master list of questions.
  - Columns:
      id           (int, PK)
      key          (text; e.g. "proud_unnoticed", "unconventional_passion",
                          "surprising_trait", "random_skills",
                          "random_obsession", "interesting_fact",
                          "wish", "other_feedback")
      prompt       (text; full question text)
      is_repeatable(boolean)

• survey_responses
  - Individual answers to survey questions.
  - Columns:
      id            (int, PK)
      survey_id     → surveys.id
      question_key  → survey_questions.key
      response_order(int; ordering of multiple responses per key)
      response      (text)
      created_at, updated_at (timestamptz)
      is_active     (boolean)
  - These responses are used as raw text for embeddings in creative_embeddings.

• survey_collaborator_prefs
  - Collaborator preference responses (may be lightly used).
  - Columns:
      survey_id      → surveys.id
      pref_type      (enum UDT)
      position       (int)
      collaborator_id→ creatives.id
      created_at, updated_at (timestamptz)


============================================================
Embeddings & recommendation outputs
============================================================

• creative_embeddings
  - Embedding representation of creatives.
  - Columns:
      creative_id  → creatives.id
      embed        (vector UDT; main embedding)
      profile_text (text; source text used to build the embedding)
      updated_at   (timestamp without time zone)
  - Used for matching creatives to needs/mandates/projects.

• client_embeddings
  - Alternative/legacy embedding representation for creatives.
  - Columns:
      creative_id    → creatives.id
      embedding      (vector UDT)
      source_version (text; which pipeline/version produced it)
      updated_at     (timestamptz)
  - Prefer creative_embeddings unless a specific pipeline expects client_embeddings.

• need_embeddings
  - Embeddings for project_needs (job openings).
  - Columns:
      need_id      → project_needs.id
      embedding    (vector UDT)
      context_hash (text; cache key for text context)
      created_at   (timestamptz)

• creative_need_recommendations
  - Cached results: best needs for each creative.
  - Columns:
      id           (bigint, PK)
      creative_id  → creatives.id
      params_json  (jsonb; parameters used)
      run_started_at (timestamptz)
      results_json (jsonb; recommended needs and metadata)

• need_recommendations
  - Cached results: best creatives for each need.
  - Columns:
      id           (bigint, PK)
      need_id      → project_needs.id
      run_started_at (timestamptz)
      params_json  (jsonb)
      results_json (jsonb; recommended creatives, scores, etc.)


============================================================
Notes
============================================================

• notes
  - Free-form notes attached to various entities via note_links.
  - Columns:
      id             (int, PK)
      note           (text)
      created_at     (timestamp without time zone)
      created_by_id  (text)
      created_by_type(text)
      updated_at     (timestamp without time zone)
      updated_by_id  (text)
      updated_by_type(text)
      status         (text; e.g. "active"/"archived")
      visibility     (text; e.g. "managers")
  - Used for internal commentary, context, etc.

• note_links
  - Links notes to specific entities.
  - Columns:
      note_id       → notes.id
      noteable_id   (text; ID of the linked entity, e.g. projects.id)
      noteable_type (text; e.g. "project", "creative", "mandate")


============================================================
RAG chat tables (internal system)
============================================================

These power the AI/RAG chat experience and are mostly irrelevant to content analytics,
but the LLM will see them in the schema:

• rag_chat_conversations
  - One row per chat conversation per team member.
  - Columns:
      id              (bigint, PK)
      team_id         → team.id
      title           (text; optional conversation title)
      created_at      (timestamptz)
      updated_at      (timestamptz)
      last_activity_at(timestamptz)
      archived        (boolean)

• rag_chat_messages
  - Individual chat messages.
  - Columns:
      id             (bigint, PK)
      conversation_id→ rag_chat_conversations.id
      role           (text; "user" or "assistant")
      content        (text; full message)
      meta           (jsonb; optional extra data)
      created_at     (timestamptz)

• rag_chat_runs
  - One row per “run” of the RAG pipeline for a given user message.
  - Columns:
      id              (int, PK)
      conversation_id → rag_chat_conversations.id
      user_message_id → rag_chat_messages.id
      status          (varchar; e.g. "running", "completed", "failed")
      error_message   (text)
      created_at, updated_at (timestamptz)

• rag_chat_run_updates
  - Streaming / incremental status updates for a run.
  - Columns:
      id         (bigint, PK)
      run_id     → rag_chat_runs.id
      seq        (int; order within the run)
      kind       (varchar; e.g. "status", "sql", "retrieval")
      content    (jsonb; structured payload)
      created_at (timestamptz)
  - Used to surface mid-thought updates like “Analyzing question…”, “Running SQL…”.

In most SQL for business questions, you should ignore rag_chat_* tables.


============================================================
Precomputed context views
============================================================

• v_project_context (view)
  - Text context for projects.
  - Columns:
      project_id  → projects.id
      media_type  (varchar)
      description (text)
      genre_text  (text; concatenated genre tags)
      notes_text  (text; combined notes)
  - Useful when you want a single text blob describing a project.

• v_project_staffing_recipient_ids (view)
  - Connects projects with recipient_ids relevant to staffing.
  - Columns:
      project_id
      recipient_id
  - Can be combined with v_recipient_names to get recipient names.

• v_recipient_names (view)
  - Maps recipient_id + recipient_type to a human-readable name.
  - Columns:
      recipient_id
      recipient_type
      recipient_name


============================================================
General join recipes (useful patterns)
============================================================

1) From creative to their projects (credits):
   creatives c
     JOIN creative_project_roles cpr ON cpr.creative_id = c.id
     JOIN projects              p   ON p.id = cpr.project_id

2) From project to buyers (networks, studios, production companies):
   projects p
     LEFT JOIN project_to_tv_networks      ptn
              ON ptn.project_id = p.id AND ptn.status='Active'
     LEFT JOIN tv_networks                 tv
              ON tv.id = ptn.network_id
     LEFT JOIN project_to_studios          pts
              ON pts.project_id = p.id AND pts.status='Active'
     LEFT JOIN studios                     s
              ON s.id = pts.studio_id
     LEFT JOIN project_to_production_companies ptpc
              ON ptpc.project_id = p.id AND ptpc.status='Active'
     LEFT JOIN production_companies        pc
              ON pc.id = ptpc.production_company_id

3) From project to genres:
   projects p
     JOIN project_genre_tags pgt ON pgt.project_id = p.id
     JOIN genre_tags         g   ON g.id = pgt.tag_id

4) From project to needs and subs:
   projects p
     LEFT JOIN project_needs pn  ON pn.project_id = p.id AND pn.status='Active'
     LEFT JOIN subs         s    ON s.project_need_id = pn.id
     LEFT JOIN sub_to_client stc ON stc.sub_id = s.id
     LEFT JOIN creatives     c   ON c.id = stc.creative_id

5) From mandates to genres and subs:
   mandates m
     LEFT JOIN mandate_genre_tags mgt ON mgt.mandate_id = m.id
     LEFT JOIN genre_tags         g   ON g.id = mgt.tag_id
     LEFT JOIN sub_to_mandate     stm ON stm.mandate_id = m.id
     LEFT JOIN subs               s   ON s.id = stm.sub_id

6) To list subs, results, recipients, and feedback in one go:
   Prefer using sub_list_view instead of many joins.

7) To find “fans” of a creative:
   sub_feedback sf
     JOIN subs            s   ON s.id = sf.sub_id
     JOIN sub_to_client   stc ON stc.sub_id = s.id
     JOIN creatives       c   ON c.id = stc.creative_id
   Where:
     sf.sentiment   = 'positive'
     sf.source_type = 'executive'
   Then join sf.source_id to executives.id and through executives_to_* to companies.

8) To filter things as active vs archived (heuristics):
   - creatives:    client_status IN ('client', 'prospective client') for “active clients”.
   - team:         status='Active' for current staff.
   - mandates:     status='active' for current buying needs.
   - project_needs / project_to_* / executives_to_*: status='Active' for current relationships.
   - projects:     avoid status='Archived' and tracking_status='Archived'
                   unless you specifically want archived items.
                   tracking_status='Internal / Not Tracking' is “internal-only”.

Use these patterns when planning SQL for analytics questions. Prefer simple,
explicit joins using the foreign-key relationships described above.
"""


SYSTEM_PROMPT = f"""
You are an analytics assistant for the RDE manager portal.

You have read-only access to the production Postgres database via three tools:
- list_tables  → see which tables exist
- get_schema   → inspect columns/types for one table
- run_sql      → execute a read-only SELECT and see real rows

Your job is to:
1. Interpret the user's question.
2. Use the tools as needed (list_tables/get_schema for schema, run_sql for data).
3. ACTUALLY RUN the necessary SQL via run_sql.
4. Answer the question using the RESULTS of run_sql, not hypothetical queries.

Important behavior rules:
- Do NOT ask the user if they want you to run a query. You already have permission.
- Do NOT mention that you are "using tools", "running SQL", or "querying the database" unless the user explicitly asks.
- Do NOT show the SQL you ran unless the user explicitly asks to see the query.
- By default, never include internal IDs like "PR_06020", "EX_00011", "SB_00006" in your answers.
  - Instead, refer to things by their human names: project titles, executive names, company names, etc.
- Avoid raw timestamp strings like "2025-07-22T22:07:51.300435Z".
  - If dates matter, format them as a human-friendly date like "Jul 22, 2025" and omit the time unless the user explicitly requests time-of-day.
- Translate enum values into natural language. For example:
  - intent_primary="sell_project" → "the goal of the submission was to sell the project".
  - intent_primary="staffing"     → "the goal was to staff a role on the project".
  - result="success"              → "the submission was a success".
  - result="pass"                 → "they passed".
  - result="no_response"          → "there has been no response yet".
- Prefer concise, manager-facing summaries over raw data dumps; only list row-by-row details if the user explicitly wants that level of detail.

Formatting rules for answers:
- Use **Markdown** to structure your reply.
- Start with a short **Summary** section when appropriate.
- Use headings like `### Top-priority targets`, `### Secondary targets`, `### Suggested materials`.
- Use bullet lists and nested bullets to organize details.
- Use **bold** labels for names and key facts (companies, executives, projects, dates, outcomes).
- Keep paragraphs short and scannable.

Database overview:
{SCHEMA_GUIDE}
"""


def generate_conversation_title(history: List[Dict[str, str]]) -> Optional[str]:
    """
    Given the full chat history, return a short, human-friendly title.

    Returns:
        - a non-empty string on success
        - None if the title could not be generated (do NOT fall back)
    """
    # Use only the first few turns for titling
    preview = history[:4]

    text_parts: List[str] = []
    for msg in preview:
        role = msg.get("role", "user")
        content = msg.get("content", "")
        text_parts.append(f"{role}: {content}")
    text_blob = "\n".join(text_parts)

    system_prompt = (
        "You are naming chat conversations for a talent-management analytics tool.\n"
        "Given the following conversation snippet, respond with ONLY a short, clear title.\n"
        "Use 3–8 words, no quotes, no emojis, no extra commentary.\n"
    )

    try:
        resp = client.chat.completions.create(
            model=MODEL_ID,
            messages=[
                {"role": "system", "content": system_prompt},
                {
                    "role": "user",
                    "content": f"{text_blob}\n\nTitle:",
                },
            ],
        )
        raw = resp.choices[0].message.content or ""
        title = raw.strip()
    except Exception as e:
        print(f"[rag_chat_core] title model failed: {e!r}")
        return None

    # Strip surrounding quotes if the model added them
    if (title.startswith('"') and title.endswith('"')) or (
        title.startswith("'") and title.endswith("'")
    ):
        title = title[1:-1].strip()

    if not title:
        return None

    if len(title) > 80:
        title = title[:77] + "..."

    return title


def build_messages(user_question: str) -> List[Dict[str, str]]:
    return [
        {
            "role": "system",
            "content": SYSTEM_PROMPT,
        },
        {
            "role": "user",
            "content": user_question,
        },
    ]


# ─────────────────────────────────────────
# Tool plumbing – calls your /llm endpoints
# ─────────────────────────────────────────

def _tool_list_tables() -> list[str]:
    url = f"{BACKEND_BASE_URL}/llm/list_tables"
    resp = requests.get(url, timeout=15)
    resp.raise_for_status()
    # Expect: ["projects", "creatives", ...]
    return resp.json()


def _tool_get_schema(table_name: str):
    url = f"{BACKEND_BASE_URL}/llm/schema/{table_name}"
    resp = requests.get(url, timeout=30)
    resp.raise_for_status()
    # Expect: [{"name": "...", "type": "...", "nullable": true/false}, ...]
    return resp.json()


def _tool_run_sql(sql: str, max_rows: int = 200, on_update: Callable[[str, dict | None], None] | None = None) -> Dict[str, Any]:
    """
    Call the backend /llm/run_sql tool.

    - On success: returns {"ok": True, "sql": ..., "rows": [...]}
    - On failure: {"ok": False, ...}

    If on_update is provided, we log status updates into the DB via the router callback.
    """
    # Fire a “status” update each time we are about to run SQL
    if on_update:
        on_update("status", {"text": "Running SQL on Postgres…"})

    url = f"{BACKEND_BASE_URL}/llm/run_sql"

    headers: Dict[str, str] = {}
    if LLM_SERVICE_JWT:
        headers["Authorization"] = f"Bearer {LLM_SERVICE_JWT}"

    payload = {"sql": sql, "max_rows": max_rows}

    print("\n[tool_run_sql] >>> calling /llm/run_sql with:")
    print(sql)
    print(f"[tool_run_sql] max_rows={max_rows}")

    try:
        resp = requests.post(
            url,
            json=payload,
            headers=headers,
            timeout=30,
        )
    except Exception as e:
        print(f"[tool_run_sql] !!! request error: {e!r}")
        if on_update:
            on_update("status", {"text": f"SQL request failed: {e}"})
        return {
            "ok": False,
            "sql": sql,
            "status_code": None,
            "detail": f"Request to /llm/run_sql failed: {e}",
        }

    try:
        data = resp.json()
    except ValueError:
        data = resp.text

    if resp.status_code != 200:
        print(f"[tool_run_sql] !!! /llm/run_sql returned {resp.status_code}: {data}")
        if on_update:
            on_update("status", {"text": "SQL returned an error from the database."})
        return {
            "ok": False,
            "sql": sql,
            "status_code": resp.status_code,
            "detail": data,
        }

    if isinstance(data, list):
        row_count = len(data)
    else:
        row_count = 1

    print(f"[tool_run_sql] <<< got {row_count} row(s) from /llm/run_sql")

    if on_update:
        on_update("status", {"text": f"SQL completed ({row_count} row(s))"})

    return {
        "ok": True,
        "sql": sql,
        "rows": data,
    }


def _guess_tables_from_sql(sql: str) -> list[str]:
    """
    Very simple heuristic to extract table names from a SELECT:

      SELECT ... FROM projects p
      JOIN creatives c ON ...

    -> ["projects", "creatives"]

    It's not a full SQL parser, just good enough for status messages.
    """
    pattern = r"\b(?:from|join)\s+([a-zA-Z0-9_.\"]+)"
    matches = re.findall(pattern, sql, flags=re.IGNORECASE)

    cleaned: list[str] = []
    seen: set[str] = set()

    for m in matches:
        # Strip quotes and trailing commas
        name = m.strip().strip('",')

        # If schema-qualified, drop the schema (public.projects → projects)
        if "." in name:
            name = name.split(".")[-1]

        if name not in seen:
            seen.add(name)
            cleaned.append(name)

    return cleaned


def _extract_where_clause(sql: str) -> str:
    """
    Extract and normalize the WHERE clause from a SELECT.

    Returns a single-line string (no 'WHERE' prefix), or "" if none.
    """
    low = sql.lower()
    m = re.search(r"\bwhere\b", low)
    if not m:
        return ""

    start = m.end()
    tail = sql[start:]

    # Stop at GROUP BY / ORDER BY / LIMIT / OFFSET if present
    end_match = re.search(
        r"\b(group\s+by|order\s+by|limit|offset)\b",
        tail,
        flags=re.IGNORECASE,
    )
    if end_match:
        tail = tail[: end_match.start()]

    # Collapse whitespace
    return " ".join(tail.split())


def _extract_string_literals(where_clause: str) -> list[str]:
    """
    Pull out single-quoted string literals from the WHERE clause.

    Example:
      WHERE genre_tags.name IN ('Fantasy', 'Sword and Sorcery')
    -> ['Fantasy', 'Sword and Sorcery']
    """
    if not where_clause:
        return []

    literals = re.findall(r"'([^']+)'", where_clause)
    boring = {"true", "false", "public"}
    out: list[str] = []
    seen: set[str] = set()
    for lit in literals:
        key = lit.strip()
        if not key:
            continue
        if key.lower() in boring:
            continue
        if len(key) > 120:
            continue
        if key in seen:
            continue
        seen.add(key)
        out.append(key)
    return out


def _group_tables_for_human(tables: list[str]) -> list[str]:
    """
    Map raw table names to higher-level concepts for nicer status text.

    Example:
      ['projects', 'project_genre_tags', 'genre_tags', 'creatives']
    -> ['projects', 'creatives', 'genres']
    """
    groups: list[str] = []
    seen_groups: set[str] = set()

    def add_group(label: str):
        if label not in seen_groups:
            seen_groups.add(label)
            groups.append(label)

    for t in tables:
        if t in {
            "creatives",
            "creative_project_roles",
            "creative_embeddings",
            "writing_sample_to_creative",
        }:
            add_group("creatives")
        elif t in {
            "projects",
            "project_to_tv_networks",
            "project_to_studios",
            "project_to_production_companies",
            "project_genre_tags",
            "project_needs",
            "project_embeddings",
            "v_project_context",
        }:
            add_group("projects")
        elif t in {"genre_tags", "mandate_genre_tags", "project_genre_tags"}:
            add_group("genres")
        elif t in {"subs", "sub_list_view", "sub_feedback", "sub_to_client", "sub_to_mandate"}:
            add_group("submissions")
        elif t in {
            "mandates",
            "mandate_embeddings",
            "mandates_for_project_recommendations",
            "projects_for_mandate_recommendations",
        }:
            add_group("mandates")
        elif t in {
            "executives",
            "executives_to_tv_networks",
            "executives_to_studios",
            "executives_to_production_companies",
        }:
            add_group("executives")
        elif t in {"tv_networks", "studios", "production_companies"}:
            add_group("companies")
        elif t in {"team", "client_team_assignments"}:
            add_group("team")
        else:
            # fallback: show the raw table name as a group
            add_group(t)

    return groups



def _execute_tool_call(
    tool_call,
    on_update: Optional[Callable[[str, Dict[str, Any]], None]] = None,
):
    """
    Run the appropriate Python function for a single tool_call and return
    a tool message dict that can be appended to the messages list.

    If on_update is provided, we emit human-friendly status updates
    (especially around run_sql).
    """
    name = tool_call.function.name
    args = json.loads(tool_call.function.arguments or "{}")

    if name == "list_tables":
        if on_update:
            on_update("status", {"text": "Listing available tables in Postgres…"})
        result = _tool_list_tables()

    elif name == "get_schema":
        table_name = args["table_name"]
        if on_update:
            on_update(
                "status",
                {
                    "text": f"Inspecting schema for table `{table_name}`…",
                    "table": table_name,
                },
            )
        result = _tool_get_schema(table_name)

    elif name == "run_sql":
        sql: str = args["sql"]
        sql_preview = sql.strip().split("\n", 1)[0]

        tables = _guess_tables_from_sql(sql)
        groups = _group_tables_for_human(tables)
        where_clause = _extract_where_clause(sql)
        literals = _extract_string_literals(where_clause)

        if on_update:
            # Build a nice human sentence
            if groups:
                # e.g. "creatives, genres, projects" → "creatives, genres, and projects"
                if len(groups) == 1:
                    group_text = groups[0]
                elif len(groups) == 2:
                    group_text = " and ".join(groups)
                else:
                    group_text = ", ".join(groups[:-1]) + f", and {groups[-1]}"

                text = f"Cross-referencing {group_text} in Postgres…"
            elif tables:
                short_tables = tables[:4]
                base = ", ".join(short_tables)
                if len(tables) > 4:
                    base += ", …"
                text = f"Running SQL on tables {base}…"
            else:
                text = "Running SQL on Postgres…"

            # Add a little flavor from filters
            if literals:
                # e.g. "specifically 'Fantasy', 'Sword and Sorcery'"
                sample_vals = literals[:4]
                lit_text = ", ".join(f"'{v}'" for v in sample_vals)
                text += f" (matching values like {lit_text})"
            elif where_clause:
                snippet = where_clause
                if len(snippet) > 200:
                    snippet = snippet[:197] + "…"
                text += f" (filters: {snippet})"

            on_update(
                "status",
                {
                    "text": text,
                    "tables": tables,
                    "groups": groups,
                    "where": where_clause,
                    "sql_preview": sql_preview[:200],
                },
            )

        result = _tool_run_sql(
            sql=sql,
            max_rows=args.get("max_rows", 200),
        )

    else:
        result = {"error": f"Unknown tool {name}"}

    return {
        "role": "tool",
        "tool_call_id": tool_call.id,
        "name": name,
        "content": json.dumps(result),
    }




# ─────────────────────────────────────────
# Single-question helper (analytics Q&A)
# ─────────────────────────────────────────

def first_llm_call(user_question: str):
    """
    Single-call helper that lets you inspect the *initial* tool_calls
    the model wants to make.
    """
    messages = build_messages(user_question)
    resp = client.chat.completions.create(
        model=MODEL_ID,
        messages=messages,
        tools=TOOLS,
        tool_choice="auto",
    )
    return resp


def answer_analytics_question(
    user_question: str,
    on_update: Optional[Callable[[str, Dict[str, Any]], None]] = None,
):
    """
    High-level helper:

      1) Call the model with tools enabled.
      2) If it returns tool_calls, execute them and append their results.
      3) Repeat 1–2 until the model returns a normal assistant message
         with no tool_calls — that is the final answer.

    If on_update is provided, tool calls (especially run_sql) will emit
    status updates via that callback.

    Returns: final ChatCompletionMessage (assistant role).
    """
    messages: list[dict] = [
        {"role": "system", "content": SYSTEM_PROMPT},
        {"role": "user", "content": user_question},
    ]

    if on_update:
        on_update("status", {"text": "Analyzing question…"})

    while True:
        resp = client.chat.completions.create(
            model=MODEL_ID,
            messages=messages,
            tools=TOOLS,
            tool_choice="auto",
        )
        msg = resp.choices[0].message

        # Track the assistant msg in our message list (including tool_calls)
        messages.append(
            {
                "role": msg.role,
                "content": msg.content,
                "tool_calls": msg.tool_calls,
            }
        )

        # If the model wants to call tools, execute them, then loop again
        if msg.tool_calls:
            for tc in msg.tool_calls:
                tool_msg = _execute_tool_call(tc, on_update=on_update)
                messages.append(tool_msg)
            continue

        # No tool calls → this is the final, human-readable answer
        return msg



# ─────────────────────────────────────────
# Chat-style helper (full conversation history)
# ─────────────────────────────────────────

def call_llm_with_history(
    history: List[Dict[str, str]],
    on_update: Optional[Callable[[str, Dict[str, Any]], None]] = None,
) -> str:
    """
    history: list of {"role": "user" | "assistant", "content": "..."}
    Returns: final assistant text content.

    If on_update is provided, status updates from tool calls
    (especially run_sql) are emitted through that callback.
    """
    messages: List[Dict[str, Any]] = [{"role": "system", "content": SYSTEM_PROMPT}]
    messages.extend(history)

    # Optional: let the router send "Analyzing question…" before calling us.
    # We don't add any "Summarizing…" messages here.

    while True:
        resp = client.chat.completions.create(
            model=MODEL_ID,
            messages=messages,
            tools=TOOLS,
            tool_choice="auto",
        )
        msg = resp.choices[0].message

        # Append an assistant message (including the tool_calls) into the history
        messages.append(
            {
                "role": msg.role,
                "content": msg.content,
                "tool_calls": msg.tool_calls,
            }
        )

        # If the model wants to call tools, execute them, then loop again
        if msg.tool_calls:
            for tc in msg.tool_calls:
                tool_msg = _execute_tool_call(tc, on_update=on_update)
                messages.append(tool_msg)
            continue

        # No tool calls → final answer
        return msg.content or ""




