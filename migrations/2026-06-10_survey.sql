-- ISO Survey Platform Migration
-- Run: psql -U opsone -h localhost -d opsone_db -f survey_migration.sql

-- Survey users extension table (links to platform_users via sub/id)
CREATE TABLE IF NOT EXISTS iso_survey_user_profiles (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  platform_id   TEXT NOT NULL REFERENCES platform_users(sub) ON DELETE CASCADE,
  employee_id   TEXT NOT NULL DEFAULT '',
  phone         TEXT,
  role          TEXT NOT NULL DEFAULT 'USER' CHECK (role IN ('ADMIN','USER','VIEWER')),
  is_active     BOOLEAN NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(platform_id)
);

-- Surveys
CREATE TABLE IF NOT EXISTS iso_surveys (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title         TEXT NOT NULL,
  description   TEXT,
  version       INT NOT NULL DEFAULT 1,
  status        TEXT NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','PUBLISHED','ARCHIVED')),
  created_by_id TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Questions
CREATE TABLE IF NOT EXISTS iso_questions (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  survey_id  UUID NOT NULL REFERENCES iso_surveys(id) ON DELETE CASCADE,
  text       TEXT NOT NULL,
  type       TEXT NOT NULL CHECK (type IN ('RATING','TEXT','SINGLE_CHOICE','MULTI_CHOICE')),
  options    JSONB,
  "order"    INT NOT NULL DEFAULT 0,
  required   BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Survey assignments
CREATE TABLE IF NOT EXISTS iso_survey_assignments (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  survey_id        UUID NOT NULL REFERENCES iso_surveys(id) ON DELETE CASCADE,
  user_id          TEXT NOT NULL,
  token            UUID NOT NULL DEFAULT gen_random_uuid() UNIQUE,
  token_expires_at TIMESTAMPTZ NOT NULL,
  status           TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','SENT','OPENED','COMPLETED','EXPIRED')),
  assigned_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  sent_at          TIMESTAMPTZ,
  opened_at        TIMESTAMPTZ,
  completed_at     TIMESTAMPTZ
);

-- Responses
CREATE TABLE IF NOT EXISTS iso_responses (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  assignment_id UUID NOT NULL REFERENCES iso_survey_assignments(id) ON DELETE CASCADE,
  question_id   UUID NOT NULL REFERENCES iso_questions(id) ON DELETE CASCADE,
  answer        JSONB NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(assignment_id, question_id)
);

-- Email logs
CREATE TABLE IF NOT EXISTS iso_email_logs (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "to"          TEXT NOT NULL,
  subject       TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'QUEUED' CHECK (status IN ('QUEUED','SENT','FAILED')),
  assignment_id UUID REFERENCES iso_survey_assignments(id) ON DELETE SET NULL,
  error_message TEXT,
  sent_at       TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Audit logs
CREATE TABLE IF NOT EXISTS iso_audit_logs (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     TEXT,
  action      TEXT NOT NULL,
  entity      TEXT NOT NULL DEFAULT '',
  entity_id   TEXT,
  metadata    JSONB,
  ip_address  TEXT,
  user_agent  TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_iso_questions_survey_id ON iso_questions(survey_id);
CREATE INDEX IF NOT EXISTS idx_iso_assignments_survey_id ON iso_survey_assignments(survey_id);
CREATE INDEX IF NOT EXISTS idx_iso_assignments_user_id ON iso_survey_assignments(user_id);
CREATE INDEX IF NOT EXISTS idx_iso_assignments_token ON iso_survey_assignments(token);
CREATE INDEX IF NOT EXISTS idx_iso_responses_assignment_id ON iso_responses(assignment_id);
CREATE INDEX IF NOT EXISTS idx_iso_audit_logs_created_at ON iso_audit_logs(created_at DESC);

SELECT 'ISO Survey Platform migration completed successfully!' AS result;
