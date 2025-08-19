-- backend/app/ai/recommend_client_for_project_need/bootstrap.sql


--  DB: views + tables + indexes





--  1) Project context & staffing sources

-- v_project_context: description + genres + notes (for project embedding text)
CREATE OR REPLACE VIEW v_project_context AS
SELECT
  p.id AS project_id,
  p.media_type,
  p.description,
  COALESCE(string_agg(DISTINCT gt.name, ' '), '') AS genre_text,
  COALESCE(string_agg(DISTINCT n.note, ' '), '')  AS notes_text
FROM projects p
LEFT JOIN project_genre_tags pgt ON pgt.project_id = p.id
LEFT JOIN genre_tags gt          ON gt.id = pgt.tag_id
LEFT JOIN note_links nl          ON nl.noteable_id = p.id
LEFT JOIN notes n                ON n.id = nl.note_id
GROUP BY p.id, p.media_type, p.description;

-- v_project_staffing_recipient_ids: one unified list of recipient_ids
-- (must match the IDs used in sub_recipients.recipient_id)
CREATE OR REPLACE VIEW v_project_staffing_recipient_ids AS
SELECT p.id AS project_id, ptn.tv_network_id       AS recipient_id FROM projects p JOIN project_to_tv_networks        ptn ON ptn.project_id = p.id
UNION ALL
SELECT p.id,             ps.studio_id              FROM projects p JOIN project_to_studios              ps  ON ps.project_id  = p.id
UNION ALL
SELECT p.id,             ppc.production_company_id FROM projects p JOIN project_to_production_companies ppc ON ppc.project_id = p.id
UNION ALL
SELECT p.id,             pe.executive_id           FROM projects p JOIN project_to_executives           pe  ON pe.project_id  = p.id;





-- 2) Embedding & caching tables
-- Pick a starting dimension; 1536 is a safe default you can keep (we’ll make the provider swappable).

-- pgvector installed: CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS client_embeddings (
  creative_id    TEXT PRIMARY KEY REFERENCES creatives(id) ON DELETE CASCADE,
  embedding      VECTOR(1536),
  source_version TEXT NOT NULL,
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS need_embeddings (
  need_id        TEXT PRIMARY KEY REFERENCES needs(id) ON DELETE CASCADE,
  embedding      VECTOR(1536),
  context_hash   TEXT NOT NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS need_recommendations (
  id             BIGSERIAL PRIMARY KEY,
  need_id        TEXT NOT NULL REFERENCES needs(id) ON DELETE CASCADE,
  run_started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  params_json    JSONB NOT NULL,
  results_json   JSONB NOT NULL,
  UNIQUE (need_id, params_json)
);

-- KNN index
CREATE INDEX IF NOT EXISTS idx_client_embeddings_ivf
ON client_embeddings USING ivfflat (embedding vector_cosine_ops) WITH (lists = 200);





-- 3) Helpful indexes

-- Filters
CREATE INDEX IF NOT EXISTS idx_creatives_filter
  ON creatives(client_status, tv_acceptable, is_director, has_directed_feature, is_writer, writer_level, availability);

-- Credits & surveys
CREATE INDEX IF NOT EXISTS idx_cpr_creative ON creative_project_roles(creative_id, project_id);
CREATE INDEX IF NOT EXISTS idx_projects_status ON projects(status);
CREATE INDEX IF NOT EXISTS idx_psr_project_survey ON project_survey_responses(project_id, survey_id);
CREATE INDEX IF NOT EXISTS idx_surveys_creative_updated ON surveys(creative_id, updated_at DESC);

-- Feedback path
CREATE INDEX IF NOT EXISTS idx_sub_to_client ON sub_to_client(sub_id, creative_id);
CREATE INDEX IF NOT EXISTS idx_sub_recipients ON sub_recipients(sub_id, recipient_id);
CREATE INDEX IF NOT EXISTS idx_sub_feedback ON sub_feedback(sub_id, source_id, sentiment);
