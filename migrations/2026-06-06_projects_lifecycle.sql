-- Operational projects: add fiscal year + lifecycle (for workload-by-person-by-year)
ALTER TABLE projects ADD COLUMN IF NOT EXISTS year       smallint;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS status     text DEFAULT 'active';   -- active | closed | archived
ALTER TABLE projects ADD COLUMN IF NOT EXISTS start_date date;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS end_date   date;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS closed_at  timestamptz;

-- Backfill year from the earliest task in each project
UPDATE projects p SET year = sub.y
FROM (SELECT project_id, EXTRACT(YEAR FROM MIN(created_at))::smallint y
      FROM tasks GROUP BY project_id) sub
WHERE p.id = sub.project_id AND p.year IS NULL;

-- Remaining (project with no tasks): fall back to its own creation year
UPDATE projects SET year = EXTRACT(YEAR FROM created_at)::smallint WHERE year IS NULL;
