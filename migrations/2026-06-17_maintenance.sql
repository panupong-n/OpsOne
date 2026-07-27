-- Maintenance (การบำรุงรักษา) module
-- Adds per-asset maintenance schedule settings + recorded checks, and backfills
-- the NB028 notebook that was present in TEN-FM-TOP-018 Asset inventory.xlsx but
-- missing from the assets table.

-- Per-asset maintenance settings: schedule start date + hide flag for the Maintenance page.
CREATE TABLE IF NOT EXISTS ma_asset_settings (
    asset_id   UUID PRIMARY KEY REFERENCES assets(id) ON DELETE CASCADE,
    start_date DATE NOT NULL,
    hidden     BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Recorded maintenance checks: one row per checklist item (item_seq) per round (round_no).
-- Rounds not yet checked are computed on the client from start_date + frequency.
CREATE TABLE IF NOT EXISTS ma_checks (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    asset_id   UUID NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
    plan       VARCHAR(20) NOT NULL,   -- notebook_pc | printer | monitor
    item_seq   INT NOT NULL,           -- checklist item number from MA.xlsx
    round_no   INT NOT NULL,           -- occurrence index (ครั้งที่ 1,2,3,...)
    due_date   DATE NOT NULL,          -- scheduled date = start_date + (round_no-1) * frequency
    condition  VARCHAR(20) NOT NULL,   -- normal | issue | broken | skipped
    remark     TEXT DEFAULT '',
    checked_by VARCHAR(120),
    checked_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (asset_id, plan, item_seq, round_no)
);
CREATE INDEX IF NOT EXISTS idx_ma_checks_asset ON ma_checks(asset_id);
CREATE INDEX IF NOT EXISTS idx_ma_checks_due ON ma_checks(due_date);

-- Resolution tracking: the original check result is immutable. A later fix is
-- recorded in these columns (set via POST /api/ma/checks/:id/resolve).
ALTER TABLE ma_checks
    ADD COLUMN IF NOT EXISTS resolution_condition VARCHAR(20),  -- state after the fix
    ADD COLUMN IF NOT EXISTS resolution_remark    TEXT,
    ADD COLUMN IF NOT EXISTS resolved_by          VARCHAR(120),
    ADD COLUMN IF NOT EXISTS resolved_at          TIMESTAMPTZ;

-- Backfill NB028 (missing vs the master inventory file) if not already present.
INSERT INTO assets(group_name,type_name,asset_id,description,serial_number,brand_model,
    responsibility,holder,owner,building,floor,department,sub_section,status,updated_date)
SELECT 'Hardware','Notebook','NB028','Notebook','PW0MNC5N','Lenovo',
    'Sales & Marketing Department','Yothin Phumjiw','Technical & Operation Division',
    'อาคารเอเชีย','ชั้น 9','Technical & Operation Division','ฝ่ายสารสนเทศ','Active','10/3/2569'
WHERE NOT EXISTS (SELECT 1 FROM assets WHERE asset_id='NB028');
