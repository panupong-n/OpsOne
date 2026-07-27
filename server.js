// OpsOne Platform — Unified Server
// Serves React SPA static files + TENCYBER OAuth proxy (avoids CORS)

import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import https from 'https';
import fs from 'fs';
import pkg from 'pg';
import multer from 'multer';
import sharp from 'sharp';
import nodemailer from 'nodemailer';
import { randomUUID, createHmac, timingSafeEqual, randomBytes, createHash } from 'crypto';
const { Pool } = pkg;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();

// Trust Cloudflare / reverse-proxy headers — only trust local proxy, not arbitrary X-Forwarded-For
app.set('trust proxy', '127.0.0.1');

const PORT = process.env.PORT || 3000;
const HTTPS_PORT = process.env.HTTPS_PORT || 443;
const TENCYBER = 'https://dashboard.tenfw.com';

// ── PostgreSQL Pool ───────────────────────────────────────────────────────────
const pool = new Pool({
    host: process.env.DB_HOST || 'localhost',
    port: Number(process.env.DB_PORT) || 5432,
    database: process.env.DB_NAME || 'opsone_db',
    user: process.env.DB_USER || 'opsone',
    password: process.env.DB_PASS,
});
if (!process.env.DB_PASS) {
    console.warn('⚠️  DB_PASS env var not set — using no password (development only)');
}

pool.connect()
    .then(async c => {
        try {
            await c.query('ALTER TABLE task_visits ADD COLUMN IF NOT EXISTS product TEXT');
            await c.query('ALTER TABLE attendance_log ADD COLUMN IF NOT EXISTS location TEXT');
            await c.query('ALTER TABLE attendance_log ADD COLUMN IF NOT EXISTS product TEXT');
            await c.query('ALTER TABLE attendance_log ADD COLUMN IF NOT EXISTS customer TEXT');
            await c.query("ALTER TABLE platform_users ADD COLUMN IF NOT EXISTS user_group TEXT DEFAULT 'engineer'");
            await c.query('ALTER TABLE platform_users ADD COLUMN IF NOT EXISTS visible BOOLEAN DEFAULT true');

            // Ensure attendance_log status allows 'leave'
            await c.query(`DO $$ BEGIN
                IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'attendance_log_status_check') THEN
                    ALTER TABLE attendance_log DROP CONSTRAINT attendance_log_status_check;
                END IF;
                ALTER TABLE attendance_log ADD CONSTRAINT attendance_log_status_check CHECK (status IN ('office','travel','leave'));
            EXCEPTION WHEN OTHERS THEN NULL;
            END $$`);

            // ── Tasks schema migration: task_role ─────────────────────────────
            await c.query("ALTER TABLE tasks ADD COLUMN IF NOT EXISTS task_role TEXT DEFAULT 'head'");

            // ── PM Module tables ──────────────────────────────────────────────
            await c.query(`CREATE TABLE IF NOT EXISTS pm_projects (
                id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                name        TEXT NOT NULL,
                description TEXT,
                color       TEXT DEFAULT '#6366F1',
                status      TEXT DEFAULT 'active',
                start_date  DATE,
                end_date    DATE,
                created_by  TEXT,
                created_at  TIMESTAMPTZ DEFAULT NOW(),
                updated_at  TIMESTAMPTZ DEFAULT NOW()
            )`);

            await c.query(`CREATE TABLE IF NOT EXISTS pm_milestones (
                id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                project_id  UUID NOT NULL REFERENCES pm_projects(id) ON DELETE CASCADE,
                name        TEXT NOT NULL,
                due_date    DATE,
                color       TEXT DEFAULT '#F59E0B',
                sort_order  INT DEFAULT 0,
                created_at  TIMESTAMPTZ DEFAULT NOW()
            )`);

            await c.query(`CREATE TABLE IF NOT EXISTS pm_sprints (
                id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                project_id  UUID NOT NULL REFERENCES pm_projects(id) ON DELETE CASCADE,
                name        TEXT NOT NULL,
                start_date  DATE,
                end_date    DATE,
                status      TEXT DEFAULT 'planned',
                created_at  TIMESTAMPTZ DEFAULT NOW()
            )`);

            await c.query(`CREATE TABLE IF NOT EXISTS pm_tickets (
                id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                project_id    UUID NOT NULL REFERENCES pm_projects(id) ON DELETE CASCADE,
                parent_id     UUID REFERENCES pm_tickets(id) ON DELETE SET NULL,
                milestone_id  UUID REFERENCES pm_milestones(id) ON DELETE SET NULL,
                sprint_id     UUID REFERENCES pm_sprints(id) ON DELETE SET NULL,
                title         TEXT NOT NULL,
                description   TEXT,
                type          TEXT DEFAULT 'task',
                status        TEXT DEFAULT 'open',
                priority      TEXT DEFAULT 'medium',
                assignee_id   TEXT,
                plan_start    DATE,
                plan_end      DATE,
                progress      INT DEFAULT 0,
                sort_order    INT DEFAULT 0,
                created_by    TEXT,
                created_at    TIMESTAMPTZ DEFAULT NOW(),
                updated_at    TIMESTAMPTZ DEFAULT NOW()
            )`);

            await c.query(`CREATE TABLE IF NOT EXISTS pm_dependencies (
                id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                predecessor_id  UUID NOT NULL REFERENCES pm_tickets(id) ON DELETE CASCADE,
                successor_id    UUID NOT NULL REFERENCES pm_tickets(id) ON DELETE CASCADE,
                dep_type        TEXT DEFAULT 'finish_to_start',
                lag_days        INT DEFAULT 0,
                UNIQUE(predecessor_id, successor_id)
            )`);

            // ── PM schema migrations (add missing Leantime fields) ────────────
            await c.query('ALTER TABLE pm_tickets ADD COLUMN IF NOT EXISTS storypoints FLOAT');
            await c.query('ALTER TABLE pm_tickets ADD COLUMN IF NOT EXISTS plan_hours FLOAT');
            await c.query('ALTER TABLE pm_tickets ADD COLUMN IF NOT EXISTS hour_remaining FLOAT');
            await c.query('ALTER TABLE pm_tickets ADD COLUMN IF NOT EXISTS tags TEXT');
            await c.query('ALTER TABLE pm_tickets ADD COLUMN IF NOT EXISTS acceptance_criteria TEXT');
            await c.query('ALTER TABLE pm_tickets ADD COLUMN IF NOT EXISTS kanban_sort_index INT DEFAULT 0');
            await c.query('ALTER TABLE pm_tickets ADD COLUMN IF NOT EXISTS date_to_finish DATE');
            await c.query('ALTER TABLE pm_tickets ADD COLUMN IF NOT EXISTS all_device INT DEFAULT 0');
            await c.query(`
                CREATE TABLE IF NOT EXISTS pm_quantity_logs (
                    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                    ticket_id UUID NOT NULL REFERENCES pm_tickets(id) ON DELETE CASCADE,
                    log_date DATE NOT NULL,
                    quantity INT NOT NULL DEFAULT 0,
                    created_at TIMESTAMPTZ DEFAULT NOW(),
                    UNIQUE(ticket_id, log_date)
                )
            `);

            // ── PM schema migration: updated_by ─────────────────────────────
            await c.query('ALTER TABLE pm_projects ADD COLUMN IF NOT EXISTS updated_by TEXT');

            // ── PM indexes & constraints ──────────────────────────────────────
            await c.query('CREATE INDEX IF NOT EXISTS idx_pm_tickets_parent_id ON pm_tickets(parent_id)');
            await c.query('CREATE INDEX IF NOT EXISTS idx_pm_tickets_project_id ON pm_tickets(project_id)');
            await c.query('CREATE INDEX IF NOT EXISTS idx_pm_quantity_logs_ticket_id ON pm_quantity_logs(ticket_id)');
            await c.query(`DO $$ BEGIN
                ALTER TABLE pm_tickets ADD CONSTRAINT chk_all_device_non_negative CHECK (all_device >= 0);
            EXCEPTION WHEN duplicate_object THEN NULL;
            END $$`);

            // ── Blocker Categorization ────────────────────────────────────────
            await c.query('ALTER TABLE pm_tickets ADD COLUMN IF NOT EXISTS blocker_category TEXT');
            await c.query('ALTER TABLE pm_tickets ADD COLUMN IF NOT EXISTS blocker_note TEXT');

            // ── Notifications table ───────────────────────────────────────────
            await c.query(`CREATE TABLE IF NOT EXISTS pm_notifications (
                id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                user_id     TEXT NOT NULL,
                type        TEXT NOT NULL,
                title       TEXT NOT NULL,
                body        TEXT,
                link        TEXT,
                is_read     BOOLEAN DEFAULT FALSE,
                created_at  TIMESTAMPTZ DEFAULT NOW()
            )`);
            await c.query('CREATE INDEX IF NOT EXISTS idx_pm_notifications_user ON pm_notifications(user_id, is_read, created_at DESC)');

            // ── Audit Trail table ─────────────────────────────────────────────
            await c.query(`CREATE TABLE IF NOT EXISTS pm_audit_logs (
                id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                ticket_id   UUID REFERENCES pm_tickets(id) ON DELETE CASCADE,
                project_id  UUID REFERENCES pm_projects(id) ON DELETE CASCADE,
                user_id     TEXT,
                user_name   TEXT,
                action      TEXT NOT NULL,
                field_name  TEXT,
                old_value   TEXT,
                new_value   TEXT,
                created_at  TIMESTAMPTZ DEFAULT NOW()
            )`);
            await c.query('CREATE INDEX IF NOT EXISTS idx_pm_audit_logs_ticket ON pm_audit_logs(ticket_id, created_at DESC)');
            await c.query('CREATE INDEX IF NOT EXISTS idx_pm_audit_logs_project ON pm_audit_logs(project_id, created_at DESC)');

            // ── HR Raw Intake table ───────────────────────────────────────────
            await c.query(`CREATE TABLE IF NOT EXISTS hr_raw_intake (
                id          BIGSERIAL PRIMARY KEY,
                source      TEXT DEFAULT 'hr_system',
                payload     JSONB NOT NULL,
                status      TEXT DEFAULT 'pending',
                note        TEXT,
                processed_at TIMESTAMPTZ,
                created_at  TIMESTAMPTZ DEFAULT NOW()
            )`);
            await c.query('CREATE INDEX IF NOT EXISTS idx_hr_raw_intake_status ON hr_raw_intake(status, created_at DESC)');

            // ── Maintenance (การบำรุงรักษา) tables ────────────────────────────
            // Per-asset maintenance settings: start date for the schedule + hide flag.
            await c.query(`CREATE TABLE IF NOT EXISTS ma_asset_settings (
                asset_id   UUID PRIMARY KEY REFERENCES assets(id) ON DELETE CASCADE,
                start_date DATE NOT NULL,
                hidden     BOOLEAN NOT NULL DEFAULT FALSE,
                created_at TIMESTAMPTZ DEFAULT NOW(),
                updated_at TIMESTAMPTZ DEFAULT NOW()
            )`);
            // Recorded maintenance checks (one row per checklist item per round).
            await c.query(`CREATE TABLE IF NOT EXISTS ma_checks (
                id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                asset_id   UUID NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
                plan       VARCHAR(20) NOT NULL,
                item_seq   INT NOT NULL,
                round_no   INT NOT NULL,
                due_date   DATE NOT NULL,
                condition  VARCHAR(20) NOT NULL,
                remark     TEXT DEFAULT '',
                checked_by VARCHAR(120),
                checked_at TIMESTAMPTZ DEFAULT NOW(),
                UNIQUE (asset_id, plan, item_seq, round_no)
            )`);
            await c.query('CREATE INDEX IF NOT EXISTS idx_ma_checks_asset ON ma_checks(asset_id)');
            await c.query('CREATE INDEX IF NOT EXISTS idx_ma_checks_due ON ma_checks(due_date)');
            // Resolution tracking: the original check result is immutable; a separate
            // resolution records that an issue/broken machine was later fixed.
            await c.query(`ALTER TABLE ma_checks
                ADD COLUMN IF NOT EXISTS resolution_condition VARCHAR(20),
                ADD COLUMN IF NOT EXISTS resolution_remark    TEXT,
                ADD COLUMN IF NOT EXISTS resolved_by          VARCHAR(120),
                ADD COLUMN IF NOT EXISTS resolved_at          TIMESTAMPTZ`);

            // ── API keys for the read-only Inventory API ──────────────────────
            // Only a SHA-256 hash of each key is stored; the plaintext is shown
            // once at creation and is unrecoverable afterwards.
            await c.query(`CREATE TABLE IF NOT EXISTS api_keys (
                id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                name         VARCHAR(120) NOT NULL,
                key_prefix   VARCHAR(24)  NOT NULL,
                key_hash     TEXT         NOT NULL UNIQUE,
                created_by   VARCHAR(160),
                created_at   TIMESTAMPTZ DEFAULT NOW(),
                last_used_at TIMESTAMPTZ,
                revoked_at   TIMESTAMPTZ
            )`);
            await c.query('CREATE INDEX IF NOT EXISTS idx_api_keys_hash ON api_keys(key_hash)');

            // ── Thai public holidays (synced daily from thailandformats.com) ──
            // Multi-day holidays (e.g. Songkran) are expanded to one row per day.
            await c.query(`CREATE TABLE IF NOT EXISTS thai_holidays (
                date      DATE PRIMARY KEY,
                year      INT  NOT NULL,
                name_th   TEXT NOT NULL,
                name_en   TEXT,
                type      VARCHAR(30),
                slug      TEXT,
                synced_at TIMESTAMPTZ DEFAULT NOW()
            )`);
            await c.query('CREATE INDEX IF NOT EXISTS idx_thai_holidays_year ON thai_holidays(year)');

            // ── User groups ──────────────────────────────────────────────────
            // Free-form teams. Kept in their own table so a group can exist with
            // zero members (platform_users.user_group stores the name).
            await c.query(`CREATE TABLE IF NOT EXISTS user_groups (
                id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                name       VARCHAR(80) NOT NULL UNIQUE,
                color      VARCHAR(20),
                created_at TIMESTAMPTZ DEFAULT NOW()
            )`);
            // Backfill from whatever groups are already assigned to users.
            await c.query(`INSERT INTO user_groups(name)
                SELECT DISTINCT TRIM(user_group) FROM platform_users
                WHERE user_group IS NOT NULL AND TRIM(user_group) <> ''
                ON CONFLICT (name) DO NOTHING`);

            // ── Training / Exam system ────────────────────────────────────────
            // Question bank. `choices` is JSONB: [{ text, correct }]. `type` is
            // 'SINGLE' (one correct) or 'MULTI' (one or more correct).
            await c.query(`CREATE TABLE IF NOT EXISTS training_questions (
                id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                text       TEXT NOT NULL,
                type       VARCHAR(10) NOT NULL DEFAULT 'SINGLE',
                points     INT NOT NULL DEFAULT 1,
                choices    JSONB NOT NULL DEFAULT '[]'::jsonb,
                category   VARCHAR(120),
                source     VARCHAR(120),
                active     BOOLEAN NOT NULL DEFAULT TRUE,
                created_at TIMESTAMPTZ DEFAULT NOW(),
                updated_at TIMESTAMPTZ DEFAULT NOW()
            )`);
            await c.query('CREATE INDEX IF NOT EXISTS idx_training_q_category ON training_questions(category)');

            // Exam sets + their config. A pool is defined by `category` (NULL = whole
            // bank); each sitting draws `question_count` random questions from it.
            await c.query(`CREATE TABLE IF NOT EXISTS training_exams (
                id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                title             VARCHAR(200) NOT NULL,
                description       TEXT DEFAULT '',
                category          VARCHAR(120),
                shuffle_questions BOOLEAN NOT NULL DEFAULT TRUE,
                shuffle_choices   BOOLEAN NOT NULL DEFAULT TRUE,
                question_count    INT NOT NULL DEFAULT 0,
                pass_percent      INT NOT NULL DEFAULT 70,
                duration_minutes  INT NOT NULL DEFAULT 60,
                max_violations    INT NOT NULL DEFAULT 3,
                status            VARCHAR(12) NOT NULL DEFAULT 'DRAFT',
                created_by        VARCHAR(160),
                created_at        TIMESTAMPTZ DEFAULT NOW(),
                updated_at        TIMESTAMPTZ DEFAULT NOW()
            )`);

            // One row per recipient: invite + sitting + result. `questions_snapshot`
            // freezes the drawn/shuffled questions at start so refresh is stable and
            // grading is deterministic.
            await c.query(`CREATE TABLE IF NOT EXISTS training_codes (
                id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                exam_id            UUID NOT NULL REFERENCES training_exams(id) ON DELETE CASCADE,
                code               VARCHAR(16) NOT NULL UNIQUE,
                candidate_name     VARCHAR(160),
                candidate_email    VARCHAR(200),
                sender_email       VARCHAR(200),
                status             VARCHAR(12) NOT NULL DEFAULT 'PENDING',
                sent_at            TIMESTAMPTZ,
                questions_snapshot JSONB,
                answers            JSONB,
                started_at         TIMESTAMPTZ,
                submitted_at       TIMESTAMPTZ,
                deadline_at        TIMESTAMPTZ,
                violations         INT NOT NULL DEFAULT 0,
                violation_log      JSONB NOT NULL DEFAULT '[]'::jsonb,
                score              NUMERIC,
                max_score          NUMERIC,
                percent            NUMERIC,
                passed             BOOLEAN,
                submit_reason      VARCHAR(12),
                created_at         TIMESTAMPTZ DEFAULT NOW()
            )`);
            await c.query('CREATE INDEX IF NOT EXISTS idx_training_codes_exam ON training_codes(exam_id)');
            await c.query('CREATE INDEX IF NOT EXISTS idx_training_codes_code ON training_codes(code)');

            // Add NB028 (missing vs TEN-FM-TOP-018 Asset inventory) if absent.
            await c.query(`INSERT INTO assets(group_name,type_name,asset_id,description,serial_number,brand_model,
                responsibility,holder,owner,building,floor,department,sub_section,status,updated_date)
                SELECT 'Hardware','Notebook','NB028','Notebook','PW0MNC5N','Lenovo',
                  'Sales & Marketing Department','Yothin Phumjiw','Technical & Operation Division',
                  'อาคารเอเชีย','ชั้น 9','Technical & Operation Division','ฝ่ายสารสนเทศ','Active','10/3/2569'
                WHERE NOT EXISTS (SELECT 1 FROM assets WHERE asset_id='NB028')`);
        } finally { c.release(); }
        console.log('✅ PostgreSQL connected');
    })
    .catch(e => console.error('⚠️  PostgreSQL connect error:', e.message));

// ── Middleware ────────────────────────────────────────────────────────────────
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(express.json({ limit: '10mb' }));

// ── Secure preview links (opaque HMAC-signed tokens) ───────────────────────────
// Shared preview URLs encode an unforgeable, tamper-proof token instead of raw
// ids/dates, so links cannot be altered to enumerate other records.
const PREVIEW_SECRET = process.env.PREVIEW_SECRET || process.env.DB_PASS || 'opsone-dev-preview-secret-change-me';
if (!process.env.PREVIEW_SECRET) {
    console.warn('⚠️  PREVIEW_SECRET not set — using fallback. Set it in production for secure preview links.');
}
const PREVIEW_TTL_MS = 1000 * 60 * 60 * 24 * 365; // 1 year
function signPreview(payload) {
    const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const sig = createHmac('sha256', PREVIEW_SECRET).update(body).digest('base64url');
    return `${body}.${sig}`;
}
function verifyPreview(token) {
    if (!token || typeof token !== 'string' || !token.includes('.')) return null;
    const [body, sig] = token.split('.');
    const expected = createHmac('sha256', PREVIEW_SECRET).update(body).digest('base64url');
    if (!sig || sig.length !== expected.length) return null;
    let diff = 0;
    for (let i = 0; i < sig.length; i++) diff |= sig.charCodeAt(i) ^ expected.charCodeAt(i);
    if (diff !== 0) return null;
    try {
        const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
        if (payload.exp && Date.now() > payload.exp) return null;
        return payload;
    } catch { return null; }
}

// ── File Upload (multer) ──────────────────────────────────────────────────────
const logoStorage = multer.diskStorage({
    destination: path.join(__dirname, 'public', 'uploads'),
    filename: (_req, file, cb) => {
        const ext = path.extname(file.originalname).toLowerCase();
        cb(null, `logo_${Date.now()}${ext}`);
    },
});
const uploadLogo = multer({
    storage: logoStorage,
    limits: { fileSize: 5 * 1024 * 1024 },
    fileFilter: (_req, file, cb) => cb(null, /^image\//.test(file.mimetype)),
});

app.post('/api/upload/logo', uploadLogo.single('logo'), (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'no file uploaded' });
    res.json({ url: `/uploads/${req.file.filename}` });
});

// ── Editor image upload ───────────────────────────────────────────────────────
const editorImgStorage = multer.diskStorage({
    destination: path.join(__dirname, 'public', 'uploads', 'editor'),
    filename: (_req, file, cb) => {
        const ext = path.extname(file.originalname).toLowerCase();
        cb(null, `img_${Date.now()}_${Math.random().toString(36).slice(2, 8)}${ext}`);
    },
});
const uploadEditorImg = multer({
    storage: editorImgStorage,
    limits: { fileSize: 10 * 1024 * 1024 },
    fileFilter: (_req, file, cb) => cb(null, /^image\//.test(file.mimetype)),
});

app.post('/api/upload/editor-image', uploadEditorImg.single('image'), (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'no file uploaded' });
    res.json({ url: `/uploads/editor/${req.file.filename}` });
});

// CORS for OAuth proxy routes only
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);
app.use('/api/proxy', (req, res, next) => {
    const origin = req.headers.origin || '';
    const allow = ALLOWED_ORIGINS.length === 0 || ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
    res.setHeader('Access-Control-Allow-Origin', allow || '*');
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    if (req.method === 'OPTIONS') return res.status(204).end();
    next();
});

// ── TENCYBER OAuth Proxy ──────────────────────────────────────────────────────
// /api/proxy/oauth/token → https://dashboard.tenfw.com/api/oauth/token
app.post('/api/proxy/oauth/token', async (req, res) => {
    try {
        const body = new URLSearchParams(req.body).toString();
        console.log(`[proxy] POST /api/oauth/token  client_id=${req.body?.client_id || 'n/a'}`);

        const upstream = await fetch(`${TENCYBER}/api/oauth/token`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body,
        });

        const data = await upstream.json();
        console.log(`[proxy] token response: ${upstream.status}`, JSON.stringify(data).slice(0, 120));
        res.status(upstream.status).json(data);
    } catch (err) {
        console.error('[proxy] token error:', err);
        res.status(502).json({ error: 'proxy_error', error_description: String(err) });
    }
});

// /api/proxy/oauth/userinfo → https://dashboard.tenfw.com/api/oauth/userinfo
app.get('/api/proxy/oauth/userinfo', async (req, res) => {
    try {
        console.log('[proxy] GET /api/oauth/userinfo');
        const upstream = await fetch(`${TENCYBER}/api/oauth/userinfo`, {
            headers: { Authorization: req.headers.authorization ?? '' },
        });

        const data = await upstream.json();
        console.log(`[proxy] userinfo response: ${upstream.status}`);
        res.status(upstream.status).json(data);
    } catch (err) {
        console.error('[proxy] userinfo error:', err);
        res.status(502).json({ error: 'proxy_error', error_description: String(err) });
    }
});

// /api/proxy/oauth/revoke → https://dashboard.tenfw.com/api/oauth/revoke (RFC 7009)
app.post('/api/proxy/oauth/revoke', async (req, res) => {
    try {
        const body = new URLSearchParams(req.body).toString();
        console.log('[proxy] POST /api/oauth/revoke');
        const upstream = await fetch(`${TENCYBER}/api/oauth/revoke`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body,
        });
        const text = await upstream.text();
        console.log(`[proxy] revoke response: ${upstream.status}`);
        res.status(upstream.status).send(text);
    } catch (err) {
        console.error('[proxy] revoke error:', err);
        res.status(502).json({ error: 'proxy_error', error_description: String(err) });
    }
});


// ── Platform Users API ────────────────────────────────────────────────────────
// Called by frontend after successful login to register/update user
app.post('/api/users/register', async (req, res) => {
    const { sub, email, name, given_name, family_name, role, tenant_id } = req.body;
    if (!sub) return res.status(400).json({ error: 'sub required' });
    try {
        const { rows } = await pool.query(
            `INSERT INTO platform_users(sub,email,name,given_name,family_name,role,tenant_id,last_seen)
             VALUES($1,$2,$3,$4,$5,$6,$7,NOW())
             ON CONFLICT(sub) DO UPDATE SET
               email=$2, name=$3, given_name=$4, family_name=$5, role=$6, tenant_id=$7, last_seen=NOW()
             RETURNING *`,
            [sub, email, name, given_name, family_name, role, tenant_id],
        );
        res.status(200).json(rows[0]);
    } catch (e) { res.status(500).json({ error: String(e) }); }
});

app.get('/api/users', async (req, res) => {
    try {
        const { rows } = await pool.query(
            'SELECT sub,email,name,given_name,family_name,role,tenant_id,last_seen,user_group,visible FROM platform_users ORDER BY name ASC',
        );
        res.json(rows);
    } catch (e) { res.status(500).json({ error: String(e) }); }
});

app.patch('/api/users/:sub', async (req, res) => {
    // Changing anyone's group/visibility is a SUPER_ADMIN-only action.
    if (!(await requireSuperAdmin(req, res))) return;
    const { sub } = req.params;
    const { user_group, visible } = req.body;
    const sets = [];
    const params = [];
    if (user_group !== undefined) { params.push(user_group); sets.push(`user_group=$${params.length}`); }
    if (visible !== undefined) { params.push(visible); sets.push(`visible=$${params.length}`); }
    if (sets.length === 0) return res.status(400).json({ error: 'nothing to update' });
    params.push(sub);
    try {
        const { rows } = await pool.query(
            `UPDATE platform_users SET ${sets.join(',')} WHERE sub=$${params.length} RETURNING *`,
            params,
        );
        res.json(rows[0] || {});
    } catch (e) { res.status(500).json({ error: String(e) }); }
});

// ── User Groups API ───────────────────────────────────────────────────────────
// Free-form teams. Reading is open (the UI shows group chips everywhere);
// creating/renaming/deleting is SUPER_ADMIN only.
app.get('/api/user-groups', async (_req, res) => {
    try {
        const { rows } = await pool.query(`
            SELECT g.id, g.name, g.color,
                   (SELECT COUNT(*)::int FROM platform_users u WHERE TRIM(u.user_group) = g.name) AS member_count
            FROM user_groups g ORDER BY g.name`);
        res.json(rows);
    } catch (e) { res.status(500).json({ error: String(e) }); }
});

app.post('/api/user-groups', async (req, res) => {
    if (!(await requireSuperAdmin(req, res))) return;
    const name = String(req.body?.name ?? '').trim();
    const color = req.body?.color ? String(req.body.color).trim() : null;
    if (!name) return res.status(400).json({ error: 'กรุณาระบุชื่อกลุ่ม' });
    if (name.length > 80) return res.status(400).json({ error: 'ชื่อกลุ่มยาวเกินไป' });
    try {
        const { rows } = await pool.query(
            `INSERT INTO user_groups(name, color) VALUES($1,$2)
             ON CONFLICT (name) DO UPDATE SET color = COALESCE(EXCLUDED.color, user_groups.color)
             RETURNING *`, [name, color]);
        res.json(rows[0]);
    } catch (e) { res.status(500).json({ error: String(e) }); }
});

app.patch('/api/user-groups/:id', async (req, res) => {
    if (!(await requireSuperAdmin(req, res))) return;
    const name = String(req.body?.name ?? '').trim();
    if (!name) return res.status(400).json({ error: 'กรุณาระบุชื่อกลุ่ม' });
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const prev = await client.query('SELECT name FROM user_groups WHERE id=$1', [req.params.id]);
        if (!prev.rows[0]) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'ไม่พบกลุ่ม' }); }
        const { rows } = await client.query(
            'UPDATE user_groups SET name=$1, color=COALESCE($2,color) WHERE id=$3 RETURNING *',
            [name, req.body?.color ?? null, req.params.id]);
        // Keep members pointing at the renamed group.
        await client.query('UPDATE platform_users SET user_group=$1 WHERE TRIM(user_group)=$2', [name, prev.rows[0].name]);
        await client.query('COMMIT');
        res.json(rows[0]);
    } catch (e) {
        await client.query('ROLLBACK');
        res.status(500).json({ error: String(e) });
    } finally { client.release(); }
});

app.delete('/api/user-groups/:id', async (req, res) => {
    if (!(await requireSuperAdmin(req, res))) return;
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const prev = await client.query('SELECT name FROM user_groups WHERE id=$1', [req.params.id]);
        if (!prev.rows[0]) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'ไม่พบกลุ่ม' }); }
        // Members of a deleted group become ungrouped rather than orphaned.
        await client.query(`UPDATE platform_users SET user_group='' WHERE TRIM(user_group)=$1`, [prev.rows[0].name]);
        await client.query('DELETE FROM user_groups WHERE id=$1', [req.params.id]);
        await client.query('COMMIT');
        res.json({ success: true });
    } catch (e) {
        await client.query('ROLLBACK');
        res.status(500).json({ error: String(e) });
    } finally { client.release(); }
});

// ── Projects API ─────────────────────────────────────────────────────────────
app.get('/api/projects', async (req, res) => {
    try {
        const { rows } = await pool.query(
            'SELECT * FROM projects ORDER BY created_at DESC'
        );
        res.json(rows);
    } catch (e) { res.status(500).json({ error: String(e) }); }
});

app.post('/api/projects', async (req, res) => {
    const { name, description, color, logo_url, created_by } = req.body;
    if (!name?.trim()) return res.status(400).json({ error: 'name is required' });
    if (name.length > 200) return res.status(400).json({ error: 'name too long (max 200)' });
    if (color && !/^#[0-9A-Fa-f]{3,6}$/.test(color)) return res.status(400).json({ error: 'invalid color format' });
    try {
        const { rows } = await pool.query(
            'INSERT INTO projects(name,description,color,logo_url,created_by) VALUES($1,$2,$3,$4,$5) RETURNING *',
            [name.trim(), description, color, logo_url, created_by],
        );
        res.status(201).json(rows[0]);
    } catch (e) { console.error('[POST /api/projects]', e); res.status(500).json({ error: 'Internal server error' }); }
});

app.put('/api/projects/:id', async (req, res) => {
    const { name, description, color, logo_url, year, status, start_date, end_date } = req.body;
    if (color && !/^#[0-9A-Fa-f]{3,6}$/.test(color)) return res.status(400).json({ error: 'invalid color format' });
    if (status && !['active', 'closed', 'archived'].includes(status)) return res.status(400).json({ error: 'invalid status' });
    try {
        const { rows } = await pool.query(
            `UPDATE projects SET name=$1, description=$2, color=$3, logo_url=$4,
               year=COALESCE($5, year), status=COALESCE($6, status),
               start_date=COALESCE($7, start_date), end_date=COALESCE($8, end_date),
               closed_at = CASE WHEN $6='closed' THEN COALESCE(closed_at, NOW())
                                WHEN $6='active' THEN NULL ELSE closed_at END,
               updated_at=NOW()
             WHERE id=$9 RETURNING *`,
            [name, description, color, logo_url, year ?? null, status ?? null, start_date ?? null, end_date ?? null, req.params.id],
        );
        rows[0] ? res.json(rows[0]) : res.status(404).json({ error: 'not found' });
    } catch (e) { console.error('[PUT /api/projects/:id]', e); res.status(500).json({ error: 'Internal server error' }); }
});

// Toggle a project's lifecycle status (open / close)
app.patch('/api/projects/:id/status', async (req, res) => {
    const { status } = req.body;
    if (!['active', 'closed', 'archived'].includes(status)) return res.status(400).json({ error: 'invalid status' });
    try {
        const { rows } = await pool.query(
            `UPDATE projects SET status=$1,
               closed_at = CASE WHEN $1='closed' THEN COALESCE(closed_at, NOW())
                                WHEN $1='active' THEN NULL ELSE closed_at END,
               updated_at=NOW()
             WHERE id=$2 RETURNING *`,
            [status, req.params.id],
        );
        rows[0] ? res.json(rows[0]) : res.status(404).json({ error: 'not found' });
    } catch (e) { console.error('[PATCH /api/projects/:id/status]', e); res.status(500).json({ error: 'Internal server error' }); }
});

app.delete('/api/projects/:id', async (req, res) => {
    try {
        await pool.query('DELETE FROM projects WHERE id=$1', [req.params.id]);
        res.status(204).end();
    } catch (e) { res.status(500).json({ error: String(e) }); }
});

// ── Tasks API ─────────────────────────────────────────────────────────────────
app.get('/api/tasks', async (req, res) => {
    const { project_id, assignee_id, status } = req.query;
    let q = `SELECT t.*, p.name AS project_name, p.color AS project_color, p.logo_url AS project_logo_url,
             u.name AS assignee_name, u.email AS assignee_email
             FROM tasks t
             LEFT JOIN projects p ON p.id=t.project_id
             LEFT JOIN platform_users u ON u.sub=t.assignee_id
             WHERE 1=1`;
    const params = [];
    if (project_id) { params.push(project_id); q += ` AND t.project_id=$${params.length}`; }
    if (assignee_id) { params.push(assignee_id); q += ` AND t.assignee_id=$${params.length}`; }
    if (status) { params.push(status); q += ` AND t.status=$${params.length}`; }
    q += ' ORDER BY t.created_at DESC';
    try {
        const { rows } = await pool.query(q, params);
        res.json(rows);
    } catch (e) { res.status(500).json({ error: String(e) }); }
});

app.post('/api/tasks', async (req, res) => {
    const { project_id, title, description, assignee_id, status, site, created_by, task_role } = req.body;
    if (!project_id) return res.status(400).json({ error: 'project_id is required' });
    if (!assignee_id) return res.status(400).json({ error: 'assignee_id is required' });
    if (title && title.length > 500) return res.status(400).json({ error: 'title too long (max 500)' });
    try {
        const { rows } = await pool.query(
            'INSERT INTO tasks(project_id,title,description,assignee_id,status,site,created_by,task_role) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *',
            [project_id, title, description, assignee_id, status || 'in_progress', site, created_by, task_role || 'head'],
        );
        res.status(201).json(rows[0]);
    } catch (e) { console.error('[POST /api/tasks]', e); res.status(500).json({ error: 'Internal server error' }); }
});

app.put('/api/tasks/:id', async (req, res) => {
    const { title, description, assignee_id, status, site, project_id, task_role } = req.body;
    try {
        const { rows } = await pool.query(
            `UPDATE tasks SET title=$1,description=$2,assignee_id=$3,status=$4,site=$5,project_id=$6,task_role=COALESCE($7,task_role),updated_at=NOW() WHERE id=$8 RETURNING *`,
            [title, description, assignee_id, status, site, project_id, task_role, req.params.id],
        );
        rows[0] ? res.json(rows[0]) : res.status(404).json({ error: 'not found' });
    } catch (e) { res.status(500).json({ error: String(e) }); }
});

// ── Public task view (no auth required) ──────────────────────────────────────
// Returns a task + all team members (head/sub) for the same customer+product
app.get('/api/tasks/overview', async (req, res) => {
    try {
        const { rows: users } = await pool.query(
            `SELECT sub, name, email, user_group FROM platform_users WHERE visible IS NOT FALSE ORDER BY name ASC`
        );
        const { rows: projects } = await pool.query(
            `SELECT id, name, color, logo_url, year, status, start_date, end_date FROM projects ORDER BY name ASC`
        );
        const { rows: assignments } = await pool.query(
            `SELECT t.id, t.project_id, t.assignee_id, t.task_role, t.title, t.site, t.status, t.description
             FROM tasks t ORDER BY t.project_id, t.task_role`
        );
        res.json({ users, projects, assignments });
    } catch (e) { res.status(500).json({ error: String(e) }); }
});

// Shared fetch: task + full team (head + sub) for same customer+product
async function getTaskPublic(id) {
    const { rows: [task] } = await pool.query(`
        SELECT t.*, p.name AS project_name, p.color AS project_color, p.logo_url AS project_logo_url,
               COALESCE(u.name, '(ลบออกจากระบบแล้ว)') AS assignee_name, u.email AS assignee_email
        FROM tasks t
        LEFT JOIN projects p ON p.id = t.project_id
        LEFT JOIN platform_users u ON u.sub = t.assignee_id
        WHERE t.id = $1
    `, [id]);
    if (!task) return null;
    const { rows: teamTasks } = await pool.query(`
        SELECT t.id, t.task_role, t.assignee_id,
               COALESCE(u.name, '(ลบออกจากระบบแล้ว)') AS assignee_name, u.email AS assignee_email
        FROM tasks t
        LEFT JOIN platform_users u ON u.sub = t.assignee_id
        WHERE t.project_id = $1 AND t.title = $2
        ORDER BY t.task_role, u.name
    `, [task.project_id, task.title]);
    return { task, teamTasks };
}

// Legacy raw-id endpoint (kept for backward compatibility)
app.get('/api/tasks/public/:id', async (req, res) => {
    try {
        const data = await getTaskPublic(req.params.id);
        if (!data) return res.status(404).json({ error: 'not found' });
        res.json(data);
    } catch (e) { res.status(500).json({ error: String(e) }); }
});

// Secure token endpoint — id is embedded in a signed, tamper-proof token
app.get('/api/preview/task/:token', async (req, res) => {
    const payload = verifyPreview(req.params.token);
    if (!payload || payload.k !== 'task') return res.status(403).json({ error: 'invalid or expired link' });
    try {
        const data = await getTaskPublic(payload.id);
        if (!data) return res.status(404).json({ error: 'not found' });
        res.json(data);
    } catch (e) { res.status(500).json({ error: String(e) }); }
});

// Mint an opaque preview link for a resource (called by authenticated app pages)
app.post('/api/preview/link', (req, res) => {
    const { kind, id } = req.body || {};
    if (kind === 'task') {
        if (!id) return res.status(400).json({ error: 'id required' });
        const token = signPreview({ k: 'task', id, exp: Date.now() + PREVIEW_TTL_MS });
        return res.json({ token, url: `/v/t/${token}` });
    }
    if (kind === 'daily') {
        const token = signPreview({ k: 'daily', exp: Date.now() + PREVIEW_TTL_MS });
        return res.json({ token, url: `/v/d/${token}` });
    }
    res.status(400).json({ error: 'invalid kind' });
});

app.delete('/api/tasks/:id', async (req, res) => {
    try {
        // Cascade: delete related task_visits first, then clean up attendance
        const { rows: visits } = await pool.query(
            'SELECT DISTINCT employee_id, visit_date FROM task_visits WHERE task_id=$1', [req.params.id]
        );
        await pool.query('DELETE FROM task_visits WHERE task_id=$1', [req.params.id]);
        // For each employee+date, if no more visits remain, remove travel attendance
        for (const v of visits) {
            const { rows: [{ count }] } = await pool.query(
                'SELECT COUNT(*)::int AS count FROM task_visits WHERE employee_id=$1 AND visit_date=$2',
                [v.employee_id, v.visit_date]
            );
            if (count === 0) {
                await pool.query(
                    'DELETE FROM attendance_log WHERE employee_id=$1 AND date=$2 AND status=$3',
                    [v.employee_id, v.visit_date, 'travel']
                );
            }
        }
        await pool.query('DELETE FROM tasks WHERE id=$1', [req.params.id]);
        res.status(204).end();
    } catch (e) { res.status(500).json({ error: String(e) }); }
});

// ── Task Visits API ───────────────────────────────────────────────────────────
// GET  /api/task-visits?year=&month=   → month report data
// GET  /api/task-visits?task_id=       → visits for specific task
// POST /api/task-visits                → assign visit
// DELETE /api/task-visits/:id          → remove visit
// GET  /api/task-visits/export/csv?year=&month=  → CSV download

app.get('/api/task-visits/export/csv', async (req, res) => {
    const { year, month } = req.query;
    if (!year || !month) return res.status(400).json({ error: 'year and month required' });
    try {
        const { rows } = await pool.query(`
            SELECT
                tv.visit_date,
                u.name AS employee_name,
                u.email AS employee_email,
                t.title AS customer,
                p.name AS product,
                t.site,
                tv.notes,
                t.status AS task_status
            FROM task_visits tv
            JOIN tasks t ON t.id = tv.task_id
            LEFT JOIN projects p ON p.id = t.project_id
            LEFT JOIN platform_users u ON u.sub = tv.employee_id
            WHERE EXTRACT(YEAR FROM tv.visit_date) = $1
              AND EXTRACT(MONTH FROM tv.visit_date) = $2
            ORDER BY tv.visit_date, u.name
        `, [year, month]);

        const TH_MONTHS = ['', 'ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
        const monthLabel = TH_MONTHS[Number(month)] || month;
        const filename = `visit-report-${year}-${String(month).padStart(2, '0')}.csv`;

        const header = 'วันที่,พนักงาน,Email,ลูกค้า,Product,สถานที่,หมายเหตุ,สถานะงาน\n';
        const csvRows = rows.map(r => [
            r.visit_date ? new Date(r.visit_date).toLocaleDateString('th-TH') : '',
            r.employee_name || '',
            r.employee_email || '',
            r.customer || '',
            r.product || '',
            r.site || '',
            r.notes || '',
            r.task_status || '',
        ].map(v => `"${String(v).replace(/"/g, '""')}"`).join(','));

        const csv = '\uFEFF' + header + csvRows.join('\n');
        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        res.send(csv);
    } catch (e) { res.status(500).json({ error: String(e) }); }
});

app.get('/api/task-visits', async (req, res) => {
    const { year, month, task_id, employee_id } = req.query;
    let q = `
        SELECT
            tv.*,
            COALESCE(t.title, '(บันทึกทั่วไป)') AS customer,
            t.status AS task_status,
            t.site AS task_site,
            p.name AS product,
            p.color AS project_color,
            p.logo_url,
            u.name AS employee_name,
            u.email AS employee_email
        FROM task_visits tv
        LEFT JOIN tasks t ON t.id = tv.task_id
        LEFT JOIN projects p ON p.id = t.project_id
        LEFT JOIN platform_users u ON u.sub = tv.employee_id
        WHERE 1=1`;
    // Replace p.name with COALESCE so notes-only visits can also carry a product label
    q = q.replace('p.name AS product', 'COALESCE(p.name, tv.product) AS product');
    const params = [];
    if (year) { params.push(year); q += ` AND EXTRACT(YEAR FROM tv.visit_date)=$${params.length}`; }
    if (month) { params.push(month); q += ` AND EXTRACT(MONTH FROM tv.visit_date)=$${params.length}`; }
    if (task_id) { params.push(task_id); q += ` AND tv.task_id=$${params.length}`; }
    if (employee_id) { params.push(employee_id); q += ` AND tv.employee_id=$${params.length}`; }
    q += ' ORDER BY tv.visit_date, u.name';
    try {
        const { rows } = await pool.query(q, params);
        res.json(rows);
    } catch (e) { res.status(500).json({ error: String(e) }); }
});

app.post('/api/task-visits', async (req, res) => {
    const { task_id, employee_id, visit_date, site, notes, product } = req.body;
    if (!employee_id || !visit_date) return res.status(400).json({ error: 'employee_id, visit_date required' });
    try {
        let row = null;
        if (task_id) {
            // Full visit linked to a task
            const { rows } = await pool.query(
                `INSERT INTO task_visits(task_id,employee_id,visit_date,site,notes)
                 VALUES($1,$2,$3,$4,$5)
                 ON CONFLICT(task_id,employee_id,visit_date) DO UPDATE SET site=EXCLUDED.site, notes=EXCLUDED.notes
                 RETURNING *`,
                [task_id, employee_id, visit_date, site || null, notes || null],
            );
            row = rows[0];
        } else {
            // Notes-only visit (no specific task) — also saves product label for display
            const { rows } = await pool.query(
                `INSERT INTO task_visits(task_id,employee_id,visit_date,notes,product)
                 VALUES(NULL,$1,$2,$3,$4)
                 ON CONFLICT(employee_id,visit_date) WHERE task_id IS NULL
                 DO UPDATE SET notes=EXCLUDED.notes, product=EXCLUDED.product
                 RETURNING *`,
                [employee_id, visit_date, notes || null, product || null],
            );
            row = rows[0];
        }
        // Sync attendance as travel
        await pool.query(
            `INSERT INTO attendance_log(employee_id,date,status)
             VALUES($1,$2,'travel')
             ON CONFLICT(employee_id,date) DO UPDATE SET status='travel'`,
            [employee_id, visit_date],
        );
        res.status(201).json(row ?? {});
    } catch (e) { res.status(500).json({ error: String(e) }); }
});

app.delete('/api/task-visits/:id', async (req, res) => {
    try {
        // Get the visit info before deleting so we can clean up attendance
        const { rows: [visit] } = await pool.query(
            'SELECT employee_id, visit_date FROM task_visits WHERE id=$1', [req.params.id]
        );
        await pool.query('DELETE FROM task_visits WHERE id=$1', [req.params.id]);

        // If no more task_visits remain for this employee+date, revert attendance to office
        if (visit) {
            const { rows: [{ count }] } = await pool.query(
                'SELECT COUNT(*)::int AS count FROM task_visits WHERE employee_id=$1 AND visit_date=$2',
                [visit.employee_id, visit.visit_date]
            );
            if (count === 0) {
                // Remove the auto-created "travel" attendance record
                await pool.query(
                    'DELETE FROM attendance_log WHERE employee_id=$1 AND date=$2 AND status=$3',
                    [visit.employee_id, visit.visit_date, 'travel']
                );
            }
        }
        res.status(204).end();
    } catch (e) { res.status(500).json({ error: String(e) }); }
});

// ── Attendance API ─────────────────────────────────────────────────────────────
app.get('/api/attendance', async (req, res) => {
    const { date, employee_id, year, month } = req.query;
    let q = 'SELECT * FROM attendance_log WHERE 1=1';
    const params = [];
    if (date) { params.push(date); q += ` AND date=$${params.length}`; }
    if (employee_id) { params.push(employee_id); q += ` AND employee_id=$${params.length}`; }
    if (year && month) {
        params.push(Number(year));
        q += ` AND EXTRACT(YEAR FROM date)=$${params.length}`;
        params.push(Number(month));
        q += ` AND EXTRACT(MONTH FROM date)=$${params.length}`;
    }
    q += ' ORDER BY date DESC, check_in ASC';
    try {
        const { rows } = await pool.query(q, params);
        res.json(rows);
    } catch (e) { res.status(500).json({ error: String(e) }); }
});

app.post('/api/attendance', async (req, res) => {
    const { employee_id, date, status, location, check_in, check_out, note, product, customer } = req.body;
    try {
        const { rows } = await pool.query(
            `INSERT INTO attendance_log(employee_id,date,status,location,check_in,check_out,note,product,customer)
             VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)
             ON CONFLICT(employee_id,date) DO UPDATE SET status=$3,location=$4,check_in=$5,check_out=$6,note=$7,product=$8,customer=$9
             RETURNING *`,
            [employee_id, date, status, location, check_in || null, check_out || null, note, product || null, customer || null],
        );
        res.status(201).json(rows[0]);
    } catch (e) { res.status(500).json({ error: String(e) }); }
});

app.delete('/api/attendance', async (req, res) => {
    const { employee_id, date } = req.query;
    if (!employee_id || !date) return res.status(400).json({ error: 'employee_id and date required' });
    try {
        await pool.query('DELETE FROM attendance_log WHERE employee_id=$1 AND date=$2', [employee_id, date]);
        res.status(204).end();
    } catch (e) { res.status(500).json({ error: String(e) }); }
});

// ── Reports API ───────────────────────────────────────────────────────────────
// GET /api/reports/visits?from=YYYY-MM-DD&to=YYYY-MM-DD   → JSON preview
// GET /api/reports/visits/csv?from=&to=                   → CSV download
// GET /api/reports/attendance?from=&to=                   → JSON preview
// GET /api/reports/attendance/csv?from=&to=               → CSV download

app.get('/api/reports/visits', async (req, res) => {
    const { from, to } = req.query;
    if (!from || !to) return res.status(400).json({ error: 'from and to required' });
    try {
        const { rows } = await pool.query(`
            SELECT
                tv.visit_date,
                u.name AS employee_name,
                u.email AS employee_email,
                COALESCE(t.title, '(บันทึกทั่วไป)') AS customer,
                COALESCE(p.name, tv.product) AS product,
                COALESCE(tv.site, t.site) AS site,
                tv.notes,
                t.status AS task_status
            FROM task_visits tv
            LEFT JOIN tasks t ON t.id = tv.task_id
            LEFT JOIN projects p ON p.id = t.project_id
            LEFT JOIN platform_users u ON u.sub = tv.employee_id
            WHERE tv.visit_date BETWEEN $1 AND $2
            ORDER BY tv.visit_date, u.name
        `, [from, to]);
        res.json(rows);
    } catch (e) { res.status(500).json({ error: String(e) }); }
});

app.get('/api/reports/visits/csv', async (req, res) => {
    const { from, to } = req.query;
    if (!from || !to) return res.status(400).json({ error: 'from and to required' });
    try {
        const { rows } = await pool.query(`
            SELECT
                tv.visit_date,
                u.name AS employee_name,
                u.email AS employee_email,
                COALESCE(t.title, '(บันทึกทั่วไป)') AS customer,
                COALESCE(p.name, tv.product) AS product,
                COALESCE(tv.site, t.site) AS site,
                tv.notes,
                t.status AS task_status
            FROM task_visits tv
            LEFT JOIN tasks t ON t.id = tv.task_id
            LEFT JOIN projects p ON p.id = t.project_id
            LEFT JOIN platform_users u ON u.sub = tv.employee_id
            WHERE tv.visit_date BETWEEN $1 AND $2
            ORDER BY tv.visit_date, u.name
        `, [from, to]);
        const filename = `visits-${from}-to-${to}.csv`;
        const header = 'วันที่,พนักงาน,Email,ลูกค้า,Product,สถานที่,หมายเหตุ,สถานะงาน\n';
        const csvRows = rows.map(r => [
            r.visit_date ? new Date(r.visit_date).toLocaleDateString('th-TH') : '',
            r.employee_name || '', r.employee_email || '', r.customer || '',
            r.product || '', r.site || '', r.notes || '', r.task_status || '',
        ].map(v => `"${String(v).replace(/"/g, '""')}"`).join(','));
        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        res.send('\uFEFF' + header + csvRows.join('\n'));
    } catch (e) { res.status(500).json({ error: String(e) }); }
});

app.get('/api/reports/attendance', async (req, res) => {
    const { from, to } = req.query;
    if (!from || !to) return res.status(400).json({ error: 'from and to required' });
    try {
        const { rows } = await pool.query(`
            SELECT
                al.date,
                u.name AS employee_name,
                u.email AS employee_email,
                al.status,
                al.note,
                al.product,
                al.customer,
                al.location
            FROM attendance_log al
            LEFT JOIN platform_users u ON u.sub = al.employee_id
            WHERE al.date BETWEEN $1 AND $2
            ORDER BY al.date, u.name
        `, [from, to]);
        res.json(rows);
    } catch (e) { res.status(500).json({ error: String(e) }); }
});

app.get('/api/reports/attendance/csv', async (req, res) => {
    const { from, to } = req.query;
    if (!from || !to) return res.status(400).json({ error: 'from and to required' });
    try {
        const { rows } = await pool.query(`
            SELECT
                al.date,
                u.name AS employee_name,
                u.email AS employee_email,
                al.status,
                al.note,
                al.product,
                al.customer,
                al.location
            FROM attendance_log al
            LEFT JOIN platform_users u ON u.sub = al.employee_id
            WHERE al.date BETWEEN $1 AND $2
            ORDER BY al.date, u.name
        `, [from, to]);
        const STATUS_TH = { office: 'เข้าออฟฟิศ', travel: 'ออกพื้นที่', leave: 'ลางาน' };
        const filename = `attendance-${from}-to-${to}.csv`;
        const header = 'วันที่,พนักงาน,Email,สถานะ,Product,ลูกค้า,หมายเหตุ,สถานที่\n';
        const csvRows = rows.map(r => [
            r.date ? new Date(r.date).toLocaleDateString('th-TH') : '',
            r.employee_name || '', r.employee_email || '',
            STATUS_TH[r.status] || r.status || '',
            r.product || '', r.customer || '', r.note || '', r.location || '',
        ].map(v => `"${String(v).replace(/"/g, '""')}"`).join(','));
        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        res.send('\uFEFF' + header + csvRows.join('\n'));
    } catch (e) { res.status(500).json({ error: String(e) }); }
});

// ── HR Leave Integration API ──────────────────────────────────────────────────
// POST   /api/hr/leave  → receive leave record from HR system (match by name)
// DELETE /api/hr/leave  → cancel leave record from HR system

app.post('/api/hr/leave', async (req, res) => {
    const { name, department, date, leaveType, reason } = req.body;
    const trimName = (name || '').trim();
    const trimDate = (date || '').trim();
    if (!trimName || !trimDate) {
        return res.status(400).json({ error: 'name and date are required' });
    }
    try {
        // Look up employee by name (case-insensitive, trimmed)
        let userQuery = 'SELECT sub FROM platform_users WHERE LOWER(TRIM(name)) = LOWER($1) AND visible IS NOT FALSE';
        const userParams = [trimName];
        if (department) {
            userQuery += ' AND LOWER(TRIM(user_group)) = LOWER($2)';
            userParams.push((department || '').trim());
        }
        userQuery += ' LIMIT 1';
        const { rows: userRows } = await pool.query(userQuery, userParams);
        if (userRows.length === 0) {
            return res.status(404).json({ error: `ไม่พบพนักงาน: ${trimName}` });
        }
        const employee_id = userRows[0].sub;
        const note = [leaveType, reason].filter(Boolean).join(' — ') || null;
        const { rows } = await pool.query(
            `INSERT INTO attendance_log(employee_id, date, status, note)
             VALUES($1, $2, 'leave', $3)
             ON CONFLICT(employee_id, date) DO UPDATE SET status='leave', note=$3
             RETURNING *`,
            [employee_id, trimDate, note],
        );
        res.status(201).json({ ok: true, record: rows[0] });
    } catch (e) { res.status(500).json({ error: String(e) }); }
});

app.delete('/api/hr/leave', async (req, res) => {
    const { name, department, date } = req.body;
    const trimName = (name || '').trim();
    const trimDate = (date || '').trim();
    if (!trimName || !trimDate) {
        return res.status(400).json({ error: 'name and date are required' });
    }
    try {
        let userQuery = 'SELECT sub FROM platform_users WHERE LOWER(TRIM(name)) = LOWER($1) AND visible IS NOT FALSE';
        const userParams = [trimName];
        if (department) {
            userQuery += ' AND LOWER(TRIM(user_group)) = LOWER($2)';
            userParams.push((department || '').trim());
        }
        userQuery += ' LIMIT 1';
        const { rows: userRows } = await pool.query(userQuery, userParams);
        if (userRows.length === 0) {
            return res.status(404).json({ error: `ไม่พบพนักงาน: ${trimName}` });
        }
        const employee_id = userRows[0].sub;
        const result = await pool.query(
            `DELETE FROM attendance_log WHERE employee_id=$1 AND date=$2 AND status='leave'`,
            [employee_id, trimDate],
        );
        if (result.rowCount === 0) {
            return res.status(404).json({ error: 'ไม่พบบันทึกลาในวันที่ระบุ' });
        }
        res.status(200).json({ ok: true });
    } catch (e) { res.status(500).json({ error: String(e) }); }
});

// ── HR Raw Intake API ─────────────────────────────────────────────────────────
// POST   /api/hr/intake          → receive ANY raw payload from HR system
// GET    /api/hr/intake          → list all raw records (admin, ?status=pending)
// PATCH  /api/hr/intake/:id      → mark as processed / add note
// DELETE /api/hr/intake/:id      → delete a raw record

app.post('/api/hr/intake', async (req, res) => {
    const source = req.query.source || req.body?.source || 'hr_system';
    // Accept any JSON body as-is
    const payload = req.body;
    if (!payload || Object.keys(payload).length === 0) {
        return res.status(400).json({ error: 'payload is empty' });
    }
    try {
        const { rows } = await pool.query(
            `INSERT INTO hr_raw_intake(source, payload) VALUES($1, $2) RETURNING id, created_at`,
            [String(source).trim(), JSON.stringify(payload)],
        );
        res.status(201).json({ ok: true, id: rows[0].id, received_at: rows[0].created_at });
    } catch (e) { res.status(500).json({ error: String(e) }); }
});

app.get('/api/hr/intake', async (req, res) => {
    const { status, limit = 100, offset = 0 } = req.query;
    try {
        let q = 'SELECT * FROM hr_raw_intake WHERE 1=1';
        const params = [];
        if (status) { params.push(status); q += ` AND status=$${params.length}`; }
        params.push(Number(limit));
        params.push(Number(offset));
        q += ` ORDER BY created_at DESC LIMIT $${params.length - 1} OFFSET $${params.length}`;
        const { rows } = await pool.query(q, params);
        const { rows: countRows } = await pool.query(
            status
                ? 'SELECT COUNT(*) FROM hr_raw_intake WHERE status=$1'
                : 'SELECT COUNT(*) FROM hr_raw_intake',
            status ? [status] : [],
        );
        res.json({ total: Number(countRows[0].count), rows });
    } catch (e) { res.status(500).json({ error: String(e) }); }
});

app.patch('/api/hr/intake/:id', async (req, res) => {
    const { id } = req.params;
    const { status, note } = req.body;
    try {
        const { rows } = await pool.query(
            `UPDATE hr_raw_intake
             SET status=$2, note=$3,
                 processed_at = CASE WHEN $2='processed' THEN NOW() ELSE processed_at END
             WHERE id=$1 RETURNING *`,
            [Number(id), status || 'pending', note || null],
        );
        if (rows.length === 0) return res.status(404).json({ error: 'not found' });
        res.json({ ok: true, record: rows[0] });
    } catch (e) { res.status(500).json({ error: String(e) }); }
});

app.delete('/api/hr/intake/:id', async (req, res) => {
    const { id } = req.params;
    try {
        const result = await pool.query('DELETE FROM hr_raw_intake WHERE id=$1', [Number(id)]);
        if (result.rowCount === 0) return res.status(404).json({ error: 'not found' });
        res.status(200).json({ ok: true });
    } catch (e) { res.status(500).json({ error: String(e) }); }
});

// Daily preview — all users + their attendance for a given date
async function getDailyAttendance(date) {
        const [usersRes, attRes, visitsRes] = await Promise.all([
            pool.query('SELECT sub, email, name, given_name, family_name, role, user_group FROM platform_users WHERE visible IS NOT FALSE ORDER BY name ASC'),
            pool.query('SELECT * FROM attendance_log WHERE date=$1', [date]),
            pool.query(`
                SELECT tv.employee_id,
                       json_agg(json_build_object(
                           'customer',       t.title,
                           'product',        COALESCE(p.name, tv.product),
                           'logo_url',       COALESCE(p.logo_url, p2.logo_url),
                           'color',          COALESCE(p.color, p2.color),
                           'notes',          tv.notes,
                           'site',           COALESCE(tv.site, t.site)
                       ) ORDER BY tv.created_at) AS task_visits
                FROM task_visits tv
                LEFT JOIN tasks    t  ON t.id  = tv.task_id
                LEFT JOIN projects p  ON p.id  = t.project_id
                LEFT JOIN projects p2 ON p2.name = tv.product AND tv.task_id IS NULL
                WHERE tv.visit_date = $1
                GROUP BY tv.employee_id
            `, [date]),
        ]);
        const attMap = {};
        const visMap = {};
        for (const r of attRes.rows) attMap[r.employee_id] = r;
        for (const r of visitsRes.rows) visMap[r.employee_id] = r.task_visits;

        return usersRes.rows.map(u => ({
            id: u.sub,
            name: u.name || `${u.given_name} ${u.family_name}`,
            email: u.email,
            role: u.role,
            user_group: (u.user_group || '').trim(),
            attendance: attMap[u.sub] || null,
            task_visits: visMap[u.sub] || [],
        }));
}

// Legacy raw-date endpoint (kept for backward compatibility)
app.get('/api/attendance/daily', async (req, res) => {
    const { date } = req.query;
    if (!date) return res.status(400).json({ error: 'date required' });
    try {
        res.json(await getDailyAttendance(date));
    } catch (e) { res.status(500).json({ error: String(e) }); }
});

// Secure token endpoint — token grants daily-board access; date stays selectable
app.get('/api/preview/daily/:token', async (req, res) => {
    const payload = verifyPreview(req.params.token);
    if (!payload || payload.k !== 'daily') return res.status(403).json({ error: 'invalid or expired link' });
    const { date } = req.query;
    if (!date) return res.status(400).json({ error: 'date required' });
    try {
        res.json(await getDailyAttendance(date));
    } catch (e) { res.status(500).json({ error: String(e) }); }
});

// ── Assets API ────────────────────────────────────────────────────────────────
app.get('/api/assets', async (req, res) => {
    const { group_name, type_name, status, search, holder } = req.query;
    let q = 'SELECT * FROM assets WHERE 1=1';
    const params = [];
    if (group_name) { params.push(group_name); q += ` AND group_name=$${params.length}`; }
    if (type_name) { params.push(type_name); q += ` AND type_name=$${params.length}`; }
    if (status) { params.push(status); q += ` AND status=$${params.length}`; }
    if (holder) { params.push(holder); q += ` AND holder=$${params.length}`; }
    if (search) {
        params.push(`%${search}%`);
        const i = params.length;
        q += ` AND (asset_id ILIKE $${i} OR description ILIKE $${i} OR serial_number ILIKE $${i} OR brand_model ILIKE $${i} OR holder ILIKE $${i} OR department ILIKE $${i})`;
    }
    q += ' ORDER BY group_name, type_name, asset_id ASC';
    try {
        const { rows } = await pool.query(q, params);
        res.json(rows);
    } catch (e) { res.status(500).json({ error: String(e) }); }
});

app.get('/api/assets/holders', async (_req, res) => {
    try {
        const { rows } = await pool.query(`
            SELECT
                holder,
                COUNT(*) AS total,
                COUNT(*) FILTER (WHERE status='Active') AS active,
                COUNT(*) FILTER (WHERE status='In Active') AS inactive,
                json_agg(DISTINCT group_name) FILTER (WHERE group_name IS NOT NULL) AS top_groups,
                MAX(employee_id) FILTER (WHERE employee_id IS NOT NULL AND employee_id != '') AS employee_id
            FROM assets
            WHERE holder IS NOT NULL AND holder != '' AND holder != '-'
            GROUP BY holder
            ORDER BY total DESC, holder ASC
        `);
        res.json(rows);
    } catch (e) { res.status(500).json({ error: String(e) }); }
});

app.get('/api/assets/stats', async (_req, res) => {
    try {
        const { rows } = await pool.query(`
            SELECT
                COUNT(*) AS total,
                COUNT(*) FILTER (WHERE status='Active') AS active,
                COUNT(*) FILTER (WHERE status='In Active') AS inactive,
                json_agg(DISTINCT group_name) AS groups,
                json_agg(DISTINCT type_name) AS types,
                json_agg(DISTINCT department) FILTER (WHERE department != '') AS departments
            FROM assets
        `);
        res.json(rows[0]);
    } catch (e) { res.status(500).json({ error: String(e) }); }
});

app.get('/api/assets/fields', async (_req, res) => {
    try {
        const { rows } = await pool.query(`
            SELECT
                array_agg(DISTINCT description ORDER BY description) FILTER (WHERE description IS NOT NULL AND description != '') AS descriptions,
                array_agg(DISTINCT brand_model ORDER BY brand_model) FILTER (WHERE brand_model IS NOT NULL AND brand_model != '') AS brand_models,
                array_agg(DISTINCT responsibility ORDER BY responsibility) FILTER (WHERE responsibility IS NOT NULL AND responsibility != '') AS responsibilities,
                array_agg(DISTINCT holder ORDER BY holder) FILTER (WHERE holder IS NOT NULL AND holder != '' AND holder != '-') AS holders,
                array_agg(DISTINCT building ORDER BY building) FILTER (WHERE building IS NOT NULL AND building != '') AS buildings,
                array_agg(DISTINCT floor ORDER BY floor) FILTER (WHERE floor IS NOT NULL AND floor != '') AS floors,
                array_agg(DISTINCT department ORDER BY department) FILTER (WHERE department IS NOT NULL AND department != '') AS departments,
                array_agg(DISTINCT owner ORDER BY owner) FILTER (WHERE owner IS NOT NULL AND owner != '') AS owners,
                array_agg(DISTINCT employee_id ORDER BY employee_id) FILTER (WHERE employee_id IS NOT NULL AND employee_id != '') AS employee_ids
            FROM assets
        `);
        res.json(rows[0]);
    } catch (e) { res.status(500).json({ error: String(e) }); }
});

app.post('/api/assets', async (req, res) => {
    const { group_name, type_name, asset_id, description, serial_number, brand_model, responsibility, holder, employee_id, owner, building, floor, department, sub_section, status, notes } = req.body;
    // Thai Buddhist date string for updated_date
    const now = new Date();
    const thaiDate = `${now.getDate()}/${now.getMonth() + 1}/${now.getFullYear() + 543}`;
    try {
        const { rows } = await pool.query(
            `INSERT INTO assets(group_name,type_name,asset_id,description,serial_number,brand_model,responsibility,holder,employee_id,owner,building,floor,department,sub_section,status,notes,updated_date)
             VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17) RETURNING *`,
            [group_name, type_name, asset_id, description, serial_number, brand_model, responsibility, holder, employee_id || null, owner, building, floor, department, sub_section, status || 'Active', notes || '', thaiDate],
        );
        res.status(201).json(rows[0]);
    } catch (e) { res.status(500).json({ error: String(e) }); }
});

app.put('/api/assets/:id', async (req, res) => {
    const { group_name, type_name, asset_id, description, serial_number, brand_model, responsibility, holder, employee_id, owner, building, floor, department, sub_section, status, notes } = req.body;
    const now = new Date();
    const thaiDate = `${now.getDate()}/${now.getMonth() + 1}/${now.getFullYear() + 543}`;
    try {
        const { rows } = await pool.query(
            `UPDATE assets SET group_name=$1,type_name=$2,asset_id=$3,description=$4,serial_number=$5,brand_model=$6,
             responsibility=$7,holder=$8,employee_id=$9,owner=$10,building=$11,floor=$12,department=$13,sub_section=$14,
             status=$15,notes=$16,updated_date=$17,updated_at=NOW()
             WHERE id=$18 RETURNING *`,
            [group_name, type_name, asset_id, description, serial_number, brand_model, responsibility, holder, employee_id || null, owner, building, floor, department, sub_section, status, notes ?? '', thaiDate, req.params.id],
        );
        rows[0] ? res.json(rows[0]) : res.status(404).json({ error: 'not found' });
    } catch (e) { res.status(500).json({ error: String(e) }); }
});

app.delete('/api/assets/:id', async (req, res) => {
    try {
        await pool.query('DELETE FROM assets WHERE id=$1', [req.params.id]);
        res.status(204).end();
    } catch (e) { res.status(500).json({ error: String(e) }); }
});

// Asset transfer history
app.get('/api/assets/:id/transfers', async (req, res) => {
    try {
        const { rows } = await pool.query(
            'SELECT * FROM asset_transfers WHERE asset_id=$1 ORDER BY transferred_at DESC',
            [req.params.id],
        );
        res.json(rows);
    } catch (e) { res.status(500).json({ error: String(e) }); }
});

// Execute transfer: update holder + log history
app.post('/api/assets/:id/transfer', async (req, res) => {
    const { to_holder, reason, created_by } = req.body;
    if (!to_holder) return res.status(400).json({ error: 'to_holder required' });
    try {
        const assetRes = await pool.query('SELECT holder FROM assets WHERE id=$1', [req.params.id]);
        if (!assetRes.rows[0]) return res.status(404).json({ error: 'asset not found' });
        const from_holder = assetRes.rows[0].holder;

        await pool.query('UPDATE assets SET holder=$1, updated_at=NOW() WHERE id=$2', [to_holder, req.params.id]);

        const { rows } = await pool.query(
            'INSERT INTO asset_transfers(asset_id,from_holder,to_holder,reason,created_by) VALUES($1,$2,$3,$4,$5) RETURNING *',
            [req.params.id, from_holder, to_holder, reason || null, created_by || null],
        );
        res.status(201).json(rows[0]);
    } catch (e) { res.status(500).json({ error: String(e) }); }
});

// ── Maintenance (การบำรุงรักษา) API ─────────────────────────────────────────────
const MA_TYPES = ['Notebook', 'PC', 'Printer', 'Monitor'];

// List maintenance-eligible assets joined with their MA settings + check summary.
app.get('/api/ma/assets', async (req, res) => {
    const { plan, search, include_hidden } = req.query;
    const params = [MA_TYPES];
    let q = `
        SELECT a.*, s.start_date, COALESCE(s.hidden, false) AS hidden,
               (SELECT COUNT(*)::int FROM ma_checks c WHERE c.asset_id = a.id) AS check_count,
               (SELECT MAX(c.checked_at) FROM ma_checks c WHERE c.asset_id = a.id) AS last_checked_at,
               (SELECT COUNT(*)::int FROM ma_checks c WHERE c.asset_id = a.id AND c.condition = 'broken' AND c.resolution_condition IS NULL) AS broken_count
        FROM assets a
        LEFT JOIN ma_asset_settings s ON s.asset_id = a.id
        WHERE a.type_name = ANY($1)`;
    if (plan === 'notebook_pc') q += ` AND a.type_name IN ('Notebook','PC')`;
    else if (plan === 'printer') q += ` AND a.type_name = 'Printer'`;
    else if (plan === 'monitor') q += ` AND a.type_name = 'Monitor'`;
    if (include_hidden !== 'true') q += ` AND COALESCE(s.hidden, false) = false`;
    if (search) {
        params.push(`%${search}%`);
        q += ` AND (a.asset_id ILIKE $${params.length} OR a.description ILIKE $${params.length} OR a.serial_number ILIKE $${params.length} OR a.brand_model ILIKE $${params.length} OR a.holder ILIKE $${params.length})`;
    }
    q += ` ORDER BY a.type_name, a.asset_id ASC`;
    try {
        const { rows } = await pool.query(q, params);
        res.json(rows);
    } catch (e) { res.status(500).json({ error: String(e) }); }
});

// Upsert per-asset MA settings (start_date / hidden).
app.post('/api/ma/settings/:assetId', async (req, res) => {
    const { start_date, hidden } = req.body;
    try {
        const { rows } = await pool.query(
            `INSERT INTO ma_asset_settings(asset_id, start_date, hidden, updated_at)
             VALUES ($1, $2, COALESCE($3, false), NOW())
             ON CONFLICT (asset_id) DO UPDATE SET
                start_date = COALESCE(EXCLUDED.start_date, ma_asset_settings.start_date),
                hidden     = COALESCE($3, ma_asset_settings.hidden),
                updated_at = NOW()
             RETURNING *`,
            [req.params.assetId, start_date || null, typeof hidden === 'boolean' ? hidden : null],
        );
        res.json(rows[0]);
    } catch (e) { res.status(500).json({ error: String(e) }); }
});

// List checks (optionally for one asset / within a date range).
app.get('/api/ma/checks', async (req, res) => {
    const { asset_id, from, to } = req.query;
    const params = [];
    let q = 'SELECT * FROM ma_checks WHERE 1=1';
    if (asset_id) { params.push(asset_id); q += ` AND asset_id = $${params.length}`; }
    if (from)     { params.push(from);     q += ` AND due_date >= $${params.length}`; }
    if (to)       { params.push(to);       q += ` AND due_date <= $${params.length}`; }
    q += ' ORDER BY due_date DESC, item_seq ASC';
    try {
        const { rows } = await pool.query(q, params);
        res.json(rows);
    } catch (e) { res.status(500).json({ error: String(e) }); }
});

// Record a single maintenance check for one item/round.
// Once recorded the original result is immutable — re-recording the same
// item/round is rejected (use the resolve endpoint to log a later fix).
app.post('/api/ma/checks', async (req, res) => {
    const { asset_id, plan, item_seq, round_no, due_date, condition, remark, checked_by } = req.body;
    if (!asset_id || !plan || item_seq == null || round_no == null || !due_date || !condition) {
        return res.status(400).json({ error: 'asset_id, plan, item_seq, round_no, due_date, condition required' });
    }
    if (!['normal', 'issue', 'broken', 'skipped'].includes(condition)) {
        return res.status(400).json({ error: 'invalid condition' });
    }
    try {
        const { rows } = await pool.query(
            `INSERT INTO ma_checks(asset_id, plan, item_seq, round_no, due_date, condition, remark, checked_by, checked_at)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NOW())
             ON CONFLICT (asset_id, plan, item_seq, round_no) DO NOTHING
             RETURNING *`,
            [asset_id, plan, item_seq, round_no, due_date, condition, remark || '', checked_by || null],
        );
        if (!rows[0]) {
            return res.status(409).json({ error: 'บันทึกผลการตรวจรอบนี้ไว้แล้ว ไม่สามารถแก้ไขได้ — ใช้การอัปเดตการแก้ไขแทน' });
        }
        res.status(201).json(rows[0]);
    } catch (e) { res.status(500).json({ error: String(e) }); }
});

// Log a resolution (fix) for a previously recorded check. The original result
// stays untouched; only the resolution fields are updated.
app.post('/api/ma/checks/:id/resolve', async (req, res) => {
    const { resolution_condition, resolution_remark, resolved_by } = req.body;
    if (!resolution_condition || !['normal', 'issue', 'broken', 'skipped'].includes(resolution_condition)) {
        return res.status(400).json({ error: 'invalid resolution_condition' });
    }
    try {
        const { rows } = await pool.query(
            `UPDATE ma_checks SET
                resolution_condition = $2, resolution_remark = $3,
                resolved_by = $4, resolved_at = NOW()
             WHERE id = $1
             RETURNING *`,
            [req.params.id, resolution_condition, resolution_remark || '', resolved_by || null],
        );
        if (!rows[0]) return res.status(404).json({ error: 'check not found' });
        res.json(rows[0]);
    } catch (e) { res.status(500).json({ error: String(e) }); }
});

// Delete a recorded check (admin cleanup only — not exposed in the UI).
app.delete('/api/ma/checks/:id', async (req, res) => {
    try {
        await pool.query('DELETE FROM ma_checks WHERE id = $1', [req.params.id]);
        res.status(204).end();
    } catch (e) { res.status(500).json({ error: String(e) }); }
});

// Report: checks within a date range joined with asset details (for export).
app.get('/api/ma/report', async (req, res) => {
    const { from, to, plan } = req.query;
    const params = [];
    let q = `
        SELECT c.*, a.asset_id AS asset_code, a.type_name, a.group_name, a.description,
               a.serial_number, a.brand_model, a.holder, a.department
        FROM ma_checks c
        JOIN assets a ON a.id = c.asset_id
        WHERE 1=1`;
    if (from) { params.push(from); q += ` AND c.due_date >= $${params.length}`; }
    if (to)   { params.push(to);   q += ` AND c.due_date <= $${params.length}`; }
    if (plan === 'notebook_pc') q += ` AND c.plan = 'notebook_pc'`;
    else if (plan === 'printer') q += ` AND c.plan = 'printer'`;
    else if (plan === 'monitor') q += ` AND c.plan = 'monitor'`;
    q += ` ORDER BY a.type_name, a.asset_id, c.due_date, c.item_seq`;
    try {
        const { rows } = await pool.query(q, params);
        res.json(rows);
    } catch (e) { res.status(500).json({ error: String(e) }); }
});

// ── PM Projects CRUD ──────────────────────────────────────────────────────────
app.get('/api/pm/projects', async (_req, res) => {
    try {
        const { rows } = await pool.query(`
            SELECT p.*, 
                   c.name AS created_by_name, c.email AS created_by_email,
                   u.name AS updated_by_name, u.email AS updated_by_email,
                   (SELECT COUNT(*) FROM pm_tickets WHERE project_id=p.id) AS ticket_count
            FROM pm_projects p
            LEFT JOIN platform_users c ON c.sub = p.created_by
            LEFT JOIN platform_users u ON u.sub = p.updated_by
            ORDER BY p.updated_at DESC
        `);
        res.json(rows);
    } catch (e) { res.status(500).json({ error: String(e) }); }
});

app.post('/api/pm/projects', async (req, res) => {
    const { name, description, color, start_date, end_date, created_by } = req.body;
    if (!name) return res.status(400).json({ error: 'name required' });
    try {
        const { rows } = await pool.query(
            'INSERT INTO pm_projects(name,description,color,start_date,end_date,created_by,updated_by) VALUES($1,$2,$3,$4,$5,$6,$6) RETURNING *',
            [name, description || null, color || '#6366F1', start_date || null, end_date || null, created_by || null],
        );
        res.status(201).json(rows[0]);
    } catch (e) { res.status(500).json({ error: String(e) }); }
});

app.put('/api/pm/projects/:id', async (req, res) => {
    const { name, description, color, status, start_date, end_date, updated_by } = req.body;
    try {
        const { rows } = await pool.query(
            'UPDATE pm_projects SET name=COALESCE($1,name),description=COALESCE($2,description),color=COALESCE($3,color),status=COALESCE($4,status),start_date=COALESCE($5,start_date),end_date=COALESCE($6,end_date),updated_by=COALESCE($7,updated_by),updated_at=NOW() WHERE id=$8 RETURNING *',
            [name, description, color, status, start_date, end_date, updated_by || null, req.params.id],
        );
        if (!rows[0]) return res.status(404).json({ error: 'not found' });
        res.json(rows[0]);
    } catch (e) { res.status(500).json({ error: String(e) }); }
});

app.delete('/api/pm/projects/:id', async (req, res) => {
    try {
        await pool.query('DELETE FROM pm_projects WHERE id=$1', [req.params.id]);
        res.status(204).end();
    } catch (e) { res.status(500).json({ error: String(e) }); }
});

// ── PM Milestones ─────────────────────────────────────────────────────────────
app.get('/api/pm/projects/:pid/milestones', async (req, res) => {
    try {
        const { rows } = await pool.query('SELECT * FROM pm_milestones WHERE project_id=$1 ORDER BY sort_order,due_date', [req.params.pid]);
        res.json(rows);
    } catch (e) { res.status(500).json({ error: String(e) }); }
});

app.post('/api/pm/projects/:pid/milestones', async (req, res) => {
    const { name, due_date, color } = req.body;
    try {
        const { rows } = await pool.query(
            'INSERT INTO pm_milestones(project_id,name,due_date,color) VALUES($1,$2,$3,$4) RETURNING *',
            [req.params.pid, name, due_date || null, color || '#F59E0B'],
        );
        res.status(201).json(rows[0]);
    } catch (e) { res.status(500).json({ error: String(e) }); }
});

app.put('/api/pm/milestones/:id', async (req, res) => {
    const { name, due_date, color } = req.body;
    try {
        const { rows } = await pool.query(
            'UPDATE pm_milestones SET name=COALESCE($1,name),due_date=COALESCE($2,due_date),color=COALESCE($3,color) WHERE id=$4 RETURNING *',
            [name, due_date, color, req.params.id],
        );
        if (!rows[0]) return res.status(404).json({ error: 'not found' });
        res.json(rows[0]);
    } catch (e) { res.status(500).json({ error: String(e) }); }
});

app.delete('/api/pm/milestones/:id', async (req, res) => {
    try {
        await pool.query('DELETE FROM pm_milestones WHERE id=$1', [req.params.id]);
        res.status(204).end();
    } catch (e) { res.status(500).json({ error: String(e) }); }
});

// ── PM Sprints ────────────────────────────────────────────────────────────────
app.get('/api/pm/projects/:pid/sprints', async (req, res) => {
    try {
        const { rows } = await pool.query('SELECT * FROM pm_sprints WHERE project_id=$1 ORDER BY start_date', [req.params.pid]);
        res.json(rows);
    } catch (e) { res.status(500).json({ error: String(e) }); }
});

app.post('/api/pm/projects/:pid/sprints', async (req, res) => {
    const { name, start_date, end_date } = req.body;
    try {
        const { rows } = await pool.query(
            'INSERT INTO pm_sprints(project_id,name,start_date,end_date) VALUES($1,$2,$3,$4) RETURNING *',
            [req.params.pid, name, start_date || null, end_date || null],
        );
        res.status(201).json(rows[0]);
    } catch (e) { res.status(500).json({ error: String(e) }); }
});

app.put('/api/pm/sprints/:id', async (req, res) => {
    const { name, start_date, end_date, status } = req.body;
    try {
        const { rows } = await pool.query(
            'UPDATE pm_sprints SET name=COALESCE($1,name),start_date=COALESCE($2,start_date),end_date=COALESCE($3,end_date),status=COALESCE($4,status) WHERE id=$5 RETURNING *',
            [name, start_date, end_date, status, req.params.id],
        );
        res.json(rows[0]);
    } catch (e) { res.status(500).json({ error: String(e) }); }
});

app.delete('/api/pm/sprints/:id', async (req, res) => {
    try {
        await pool.query('DELETE FROM pm_sprints WHERE id=$1', [req.params.id]);
        res.status(204).end();
    } catch (e) { res.status(500).json({ error: String(e) }); }
});

// ── PM Tickets CRUD ───────────────────────────────────────────────────────────
app.get('/api/pm/projects/:pid/tickets', async (req, res) => {
    try {
        const { rows } = await pool.query(`
            SELECT t.*, u.name AS assignee_name, u.email AS assignee_email,
                   m.name AS milestone_name, s.name AS sprint_name,
                   COALESCE(q.total_accumulated, 0) AS total_accumulated,
                   CASE WHEN COALESCE(t.all_device, 0) > 0
                        THEN GREATEST(0, t.all_device - COALESCE(q.total_accumulated, 0))
                        ELSE 0 END AS remaining_device,
                   CASE WHEN COALESCE(t.all_device, 0) > 0
                        THEN ROUND((COALESCE(q.total_accumulated, 0)::numeric / t.all_device) * 100)
                        ELSE t.progress END AS calculated_progress
            FROM pm_tickets t
            LEFT JOIN platform_users u ON u.sub=t.assignee_id
            LEFT JOIN pm_milestones m ON m.id=t.milestone_id
            LEFT JOIN pm_sprints s ON s.id=t.sprint_id
            LEFT JOIN (
                SELECT ticket_id, SUM(quantity) AS total_accumulated
                FROM pm_quantity_logs GROUP BY ticket_id
            ) q ON q.ticket_id = t.id
            WHERE t.project_id=$1
            ORDER BY t.sort_order, t.created_at
        `, [req.params.pid]);
        res.json(rows);
    } catch (e) { res.status(500).json({ error: String(e) }); }
});

app.post('/api/pm/tickets', async (req, res) => {
    const { project_id, parent_id, milestone_id, sprint_id, title, description, type, status, priority, assignee_id, plan_start, plan_end, progress, sort_order, created_by, storypoints, plan_hours, hour_remaining, tags, acceptance_criteria, kanban_sort_index, date_to_finish, all_device } = req.body;
    if (!project_id || !title) return res.status(400).json({ error: 'project_id and title required' });
    try {
        const { rows } = await pool.query(
            `INSERT INTO pm_tickets(project_id,parent_id,milestone_id,sprint_id,title,description,type,status,priority,assignee_id,plan_start,plan_end,progress,sort_order,created_by,storypoints,plan_hours,hour_remaining,tags,acceptance_criteria,kanban_sort_index,date_to_finish,all_device)
             VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23) RETURNING *`,
            [project_id, parent_id || null, milestone_id || null, sprint_id || null, title, description || null,
                type || 'product', status || 'start', priority || 'medium', assignee_id || null,
                plan_start || null, plan_end || null, progress || 0, sort_order || 0, created_by || null,
                storypoints ?? null, plan_hours ?? null, hour_remaining ?? null, tags || null, acceptance_criteria || null,
                kanban_sort_index || 0, date_to_finish || null, all_device || 0],
        );
        res.status(201).json(rows[0]);
    } catch (e) { res.status(500).json({ error: String(e) }); }
});

app.put('/api/pm/tickets/:id', async (req, res) => {
    const { parent_id, milestone_id, sprint_id, title, description, type, status,
        priority, assignee_id, plan_start, plan_end, progress, sort_order,
        storypoints, plan_hours, hour_remaining, tags, acceptance_criteria, kanban_sort_index, date_to_finish, all_device,
        blocker_category, blocker_note, updated_by, updated_by_name } = req.body;
    const toNull = v => (v === '' || v == null) ? null : v;
    // Validate plan_start <= plan_end
    const ps = toNull(plan_start), pe = toNull(plan_end);
    if (ps && pe && ps > pe) return res.status(400).json({ error: 'plan_start must not be after plan_end' });
    try {
        // Fetch old ticket for audit trail + notification
        const { rows: oldRows } = await pool.query('SELECT * FROM pm_tickets WHERE id=$1', [req.params.id]);
        const oldTicket = oldRows[0];
        if (!oldTicket) return res.status(404).json({ error: 'not found' });

        const { rows } = await pool.query(
            `UPDATE pm_tickets SET
                parent_id=COALESCE($1,parent_id), milestone_id=$2, sprint_id=$3,
                title=COALESCE($4,title), description=COALESCE($5,description),
                type=COALESCE($6,type), status=COALESCE($7,status),
                priority=COALESCE($8,priority), assignee_id=$9,
                plan_start=$10, plan_end=$11,
                progress=COALESCE($12,progress), sort_order=COALESCE($13,sort_order),
                storypoints=$14, plan_hours=$15, hour_remaining=$16,
                tags=$17, acceptance_criteria=$18, kanban_sort_index=COALESCE($19,kanban_sort_index),
                date_to_finish=$20, all_device=COALESCE($21,all_device),
                blocker_category=$22, blocker_note=$23,
                updated_at=NOW()
             WHERE id=$24 RETURNING *`,
            [toNull(parent_id), toNull(milestone_id), toNull(sprint_id), title, toNull(description),
                type, status, priority, toNull(assignee_id),
            toNull(plan_start), toNull(plan_end), progress, sort_order,
            toNull(storypoints), toNull(plan_hours), toNull(hour_remaining),
            toNull(tags), toNull(acceptance_criteria), kanban_sort_index,
            toNull(date_to_finish), all_device ?? null, toNull(blocker_category), toNull(blocker_note), req.params.id],
        );

        // ── Audit Trail: log important field changes ──────────────────
        const auditFields = ['all_device', 'plan_end', 'plan_start', 'status', 'assignee_id', 'priority', 'blocker_category'];
        for (const f of auditFields) {
            const oldVal = oldTicket[f] != null ? String(oldTicket[f]) : null;
            const newVal = rows[0][f] != null ? String(rows[0][f]) : null;
            if (oldVal !== newVal) {
                pool.query(
                    `INSERT INTO pm_audit_logs(ticket_id, project_id, user_id, user_name, action, field_name, old_value, new_value)
                     VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,
                    [req.params.id, oldTicket.project_id, updated_by || null, updated_by_name || null, 'update', f, oldVal, newVal]
                ).catch(() => { });
            }
        }

        // ── Notification: when assignee changes, notify new assignee ──
        if (toNull(assignee_id) && toNull(assignee_id) !== oldTicket.assignee_id) {
            pool.query(
                `INSERT INTO pm_notifications(user_id, type, title, body, link)
                 VALUES($1, 'assign', $2, $3, $4)`,
                [assignee_id, `📌 คุณได้รับงานใหม่: ${title || oldTicket.title}`,
                    `โดย ${updated_by_name || 'System'}`, `/pm/${oldTicket.project_id}`]
            ).catch(() => { });
        }

        res.json(rows[0]);
    } catch (e) { res.status(500).json({ error: String(e) }); }
});

app.patch('/api/pm/tickets/:id', async (req, res) => {
    // Partial update — only update provided fields
    const fields = [];
    const vals = [];
    let idx = 1;
    for (const [k, v] of Object.entries(req.body)) {
        if (['title', 'description', 'type', 'status', 'priority', 'assignee_id', 'plan_start', 'plan_end',
            'progress', 'sort_order', 'parent_id', 'milestone_id', 'sprint_id',
            'storypoints', 'plan_hours', 'hour_remaining', 'tags', 'acceptance_criteria', 'kanban_sort_index', 'date_to_finish', 'all_device',
            'blocker_category', 'blocker_note'].includes(k)) {
            fields.push(`${k}=$${idx++}`);
            vals.push(v === undefined ? null : v);
        }
    }
    if (fields.length === 0) return res.status(400).json({ error: 'no fields to update' });
    fields.push(`updated_at=NOW()`);
    vals.push(req.params.id);
    try {
        const { rows } = await pool.query(
            `UPDATE pm_tickets SET ${fields.join(',')} WHERE id=$${idx} RETURNING *`, vals
        );
        if (!rows[0]) return res.status(404).json({ error: 'not found' });
        res.json(rows[0]);
    } catch (e) { res.status(500).json({ error: String(e) }); }
});

app.delete('/api/pm/tickets/:id', async (req, res) => {
    try {
        await pool.query('DELETE FROM pm_tickets WHERE id=$1', [req.params.id]);
        res.status(204).end();
    } catch (e) { res.status(500).json({ error: String(e) }); }
});

// ── PM Dependencies ───────────────────────────────────────────────────────────
app.get('/api/pm/projects/:pid/dependencies', async (req, res) => {
    try {
        const { rows } = await pool.query(`
            SELECT d.* FROM pm_dependencies d
            JOIN pm_tickets t ON t.id=d.predecessor_id
            WHERE t.project_id=$1
        `, [req.params.pid]);
        res.json(rows);
    } catch (e) { res.status(500).json({ error: String(e) }); }
});

app.post('/api/pm/dependencies', async (req, res) => {
    const { predecessor_id, successor_id, dep_type, lag_days } = req.body;
    try {
        const { rows } = await pool.query(
            'INSERT INTO pm_dependencies(predecessor_id,successor_id,dep_type,lag_days) VALUES($1,$2,$3,$4) ON CONFLICT(predecessor_id,successor_id) DO UPDATE SET dep_type=$3,lag_days=$4 RETURNING *',
            [predecessor_id, successor_id, dep_type || 'finish_to_start', lag_days || 0],
        );
        res.status(201).json(rows[0]);
    } catch (e) { res.status(500).json({ error: String(e) }); }
});

app.delete('/api/pm/dependencies/:id', async (req, res) => {
    try {
        await pool.query('DELETE FROM pm_dependencies WHERE id=$1', [req.params.id]);
        res.status(204).end();
    } catch (e) { res.status(500).json({ error: String(e) }); }
});

// Ripple: when a ticket date changes, recursively auto-shift all successors in chain
app.post('/api/pm/tickets/:id/ripple', async (req, res) => {
    try {
        const visited = new Set();
        const updated = [];

        async function ripple(ticketId) {
            if (visited.has(ticketId)) return; // prevent circular
            visited.add(ticketId);

            const { rows: [ticket] } = await pool.query('SELECT * FROM pm_tickets WHERE id=$1', [ticketId]);
            if (!ticket || !ticket.plan_end) return;

            const { rows: deps } = await pool.query(
                'SELECT * FROM pm_dependencies WHERE predecessor_id=$1', [ticketId]
            );

            for (const dep of deps) {
                const baseDate = new Date(ticket.plan_end);
                baseDate.setDate(baseDate.getDate() + 1 + (dep.lag_days || 0));
                const newStart = baseDate.toISOString().slice(0, 10);

                const { rows: [successor] } = await pool.query('SELECT * FROM pm_tickets WHERE id=$1', [dep.successor_id]);
                if (!successor) continue;

                let newEnd = null;
                if (successor.plan_start && successor.plan_end) {
                    const duration = Math.round((new Date(successor.plan_end) - new Date(successor.plan_start)) / 86400000);
                    const end = new Date(newStart);
                    end.setDate(end.getDate() + duration);
                    newEnd = end.toISOString().slice(0, 10);
                }

                const { rows: [upd] } = await pool.query(
                    'UPDATE pm_tickets SET plan_start=$1, plan_end=COALESCE($2,plan_end), updated_at=NOW() WHERE id=$3 RETURNING *',
                    [newStart, newEnd, dep.successor_id]
                );
                updated.push(upd);

                // Recursively ripple to successor's own successors
                await ripple(dep.successor_id);
            }

            // Also cascade to children (parent→child)
            const { rows: children } = await pool.query(
                'SELECT * FROM pm_tickets WHERE parent_id=$1 AND plan_start IS NOT NULL', [ticketId]
            );
            for (const child of children) {
                if (visited.has(child.id)) continue;
                const oldParentStart = ticket.plan_start ? new Date(ticket.plan_start) : null;
                if (!oldParentStart) continue;
                const childStart = new Date(child.plan_start);
                const offset = Math.round((childStart - oldParentStart) / 86400000);
                const newChildStart = new Date(ticket.plan_start);
                newChildStart.setDate(newChildStart.getDate() + offset);
                const ncs = newChildStart.toISOString().slice(0, 10);

                let nce = null;
                if (child.plan_end) {
                    const dur = Math.round((new Date(child.plan_end) - new Date(child.plan_start)) / 86400000);
                    const ce = new Date(ncs);
                    ce.setDate(ce.getDate() + dur);
                    nce = ce.toISOString().slice(0, 10);
                }

                const { rows: [upd] } = await pool.query(
                    'UPDATE pm_tickets SET plan_start=$1, plan_end=COALESCE($2,plan_end), updated_at=NOW() WHERE id=$3 RETURNING *',
                    [ncs, nce, child.id]
                );
                updated.push(upd);
                await ripple(child.id);
            }
        }

        await ripple(req.params.id);
        res.json({ rippled: updated });
    } catch (e) { res.status(500).json({ error: String(e) }); }
});

// ── PM Quantity Logs ──────────────────────────────────────────────────────────
app.get('/api/pm/projects/:pid/quantity-logs', async (req, res) => {
    try {
        const { rows } = await pool.query(`
            SELECT ql.* FROM pm_quantity_logs ql
            JOIN pm_tickets t ON t.id = ql.ticket_id
            WHERE t.project_id = $1
            ORDER BY ql.log_date, ql.created_at
        `, [req.params.pid]);
        res.json(rows);
    } catch (e) { res.status(500).json({ error: String(e) }); }
});

app.get('/api/pm/tickets/:tid/quantity-logs', async (req, res) => {
    try {
        const { rows } = await pool.query(
            'SELECT * FROM pm_quantity_logs WHERE ticket_id=$1 ORDER BY log_date',
            [req.params.tid]
        );
        res.json(rows);
    } catch (e) { res.status(500).json({ error: String(e) }); }
});

app.post('/api/pm/tickets/:tid/quantity-logs', async (req, res) => {
    const { log_date, quantity } = req.body;
    if (!log_date || quantity == null) return res.status(400).json({ error: 'log_date and quantity required' });
    const qty = Number(quantity);
    try {
        // If quantity is 0, delete the log entry instead of saving
        if (qty <= 0) {
            await pool.query('DELETE FROM pm_quantity_logs WHERE ticket_id=$1 AND log_date=$2', [req.params.tid, log_date]);
            return res.status(204).end();
        }
        // Validate: log_date should be within ticket plan_start..plan_end (if set)
        const { rows: ticketRows } = await pool.query('SELECT plan_start, plan_end FROM pm_tickets WHERE id=$1', [req.params.tid]);
        if (ticketRows.length > 0) {
            const t = ticketRows[0];
            if (t.plan_start && log_date < t.plan_start.toISOString().slice(0, 10))
                return res.status(400).json({ error: 'log_date is before plan_start' });
            if (t.plan_end && log_date > t.plan_end.toISOString().slice(0, 10))
                return res.status(400).json({ error: 'log_date is after plan_end' });
        }
        const { rows } = await pool.query(`
            INSERT INTO pm_quantity_logs(ticket_id, log_date, quantity)
            VALUES($1, $2, $3)
            ON CONFLICT(ticket_id, log_date) DO UPDATE SET quantity=$3
            RETURNING *
        `, [req.params.tid, log_date, qty]);

        // ── Auto-Status Transition: check if total_accumulated >= all_device ──
        const { rows: sumRows } = await pool.query(
            'SELECT SUM(quantity) AS total_acc FROM pm_quantity_logs WHERE ticket_id=$1', [req.params.tid]
        );
        const { rows: tktRows } = await pool.query('SELECT all_device, status, title, project_id FROM pm_tickets WHERE id=$1', [req.params.tid]);
        if (tktRows[0] && tktRows[0].all_device > 0 && sumRows[0]) {
            const totalAcc = Number(sumRows[0].total_acc || 0);
            if (totalAcc >= tktRows[0].all_device && tktRows[0].status !== 'total') {
                // Auto-mark as needs-completion (client will see flag)
                await pool.query('UPDATE pm_tickets SET status=$1, progress=100, updated_at=NOW() WHERE id=$2', ['total', req.params.tid]);
            }
        }

        res.status(201).json(rows[0]);
    } catch (e) { res.status(500).json({ error: String(e) }); }
});

app.delete('/api/pm/quantity-logs/:id', async (req, res) => {
    try {
        await pool.query('DELETE FROM pm_quantity_logs WHERE id=$1', [req.params.id]);
        res.status(204).end();
    } catch (e) { res.status(500).json({ error: String(e) }); }
});

// PATCH /api/pm/tickets/:id/quantity — UPSERT a daily quantity log
app.patch('/api/pm/tickets/:id/quantity', async (req, res) => {
    const { log_date, quantity } = req.body;
    if (!log_date || quantity == null) return res.status(400).json({ error: 'log_date and quantity required' });
    try {
        const { rows } = await pool.query(`
            INSERT INTO pm_quantity_logs(ticket_id, log_date, quantity)
            VALUES($1, $2, $3)
            ON CONFLICT(ticket_id, log_date) DO UPDATE SET quantity=$3
            RETURNING *
        `, [req.params.id, log_date, quantity]);
        res.status(200).json(rows[0]);
    } catch (e) { res.status(500).json({ error: String(e) }); }
});

// ── Dashboard Stats API ───────────────────────────────────────────────────────
app.get('/api/dashboard/stats', async (_req, res) => {
    try {
        const [assets, tasks, users, attendance] = await Promise.all([
            pool.query("SELECT COUNT(*) AS total, COUNT(*) FILTER (WHERE status='Active') AS active FROM assets"),
            pool.query("SELECT COUNT(*) AS total, COUNT(*) FILTER (WHERE status='in_progress') AS in_progress, COUNT(*) FILTER (WHERE status='completed') AS completed FROM tasks"),
            pool.query("SELECT COUNT(*) AS total FROM platform_users WHERE visible IS NOT FALSE"),
            pool.query(`
                SELECT
                    (SELECT COUNT(*) FROM platform_users WHERE visible IS NOT FALSE) AS total,
                    (SELECT COUNT(*) FROM platform_users WHERE visible IS NOT FALSE)
                      - COALESCE((SELECT COUNT(*) FROM attendance_log al JOIN platform_users pu ON pu.sub=al.employee_id WHERE al.date=CURRENT_DATE AND al.status='travel' AND pu.visible IS NOT FALSE),0) AS office,
                    COALESCE((SELECT COUNT(*) FROM attendance_log al JOIN platform_users pu ON pu.sub=al.employee_id WHERE al.date=CURRENT_DATE AND al.status='travel' AND pu.visible IS NOT FALSE),0) AS travel
            `),
        ]);
        res.json({
            assets: assets.rows[0],
            tasks: tasks.rows[0],
            users: users.rows[0],
            attendance: attendance.rows[0],
        });
    } catch (e) { res.status(500).json({ error: String(e) }); }
});

// Employee-Product-Customer matrix for dashboard
app.get('/api/dashboard/employee-matrix', async (_req, res) => {
    try {
        const { rows } = await pool.query(`
            SELECT
                t.id,
                t.title,
                t.status,
                p.name AS product,
                t.title AS customer,
                t.site,
                p.logo_url,
                t.assignee_id,
                COALESCE(u.name, '(ลบออกจากระบบแล้ว)') AS assignee_name,
                u.email AS assignee_email,
                p.name AS project_name,
                p.color AS project_color
            FROM tasks t
            LEFT JOIN platform_users u ON u.sub = t.assignee_id
            LEFT JOIN projects p ON p.id = t.project_id
            WHERE t.assignee_id IS NOT NULL
            ORDER BY p.name NULLS LAST, t.title NULLS LAST, COALESCE(u.name, t.assignee_id)
        `);
        res.json(rows);
    } catch (e) { res.status(500).json({ error: String(e) }); }
});

// ── Uploaded files (logos etc.) ───────────────────────────────────────────────
app.use('/uploads', express.static(path.join(__dirname, 'public', 'uploads'), { maxAge: '7d' }));

// ── Zammad Proxy ─────────────────────────────────────────────────────────────
const ZAMMAD_URL = process.env.ZAMMAD_URL || 'https://ticket.tenfw.com';
if (!process.env.ZAMMAD_TOKEN) {
    console.error('❌  ZAMMAD_TOKEN not set — Zammad API will fail');
    process.exit(1);
}
const ZAMMAD_AUTH = `Token token=${process.env.ZAMMAD_TOKEN}`;

// Cache the Zammad API agent's own user ID so we can use it as fallback customer_id
let _zammadAgentId = null;
async function getZammadAgentId() {
    if (_zammadAgentId) return _zammadAgentId;
    try {
        const me = await zammadFetch('/api/v1/users/me');
        _zammadAgentId = me.id;
        return _zammadAgentId;
    } catch {
        return null;
    }
}

async function zammadFetch(zPath, opts = {}) {
    const r = await fetch(`${ZAMMAD_URL}${zPath}`, {
        ...opts,
        headers: {
            'Authorization': ZAMMAD_AUTH,
            'Content-Type': 'application/json',
            ...(opts.headers || {}),
        },
    });
    if (!r.ok) throw new Error(`Zammad ${r.status}: ${await r.text()}`);
    return r.json();
}

app.get('/api/zammad/tickets', async (req, res) => {
    try {
        const { page = 1, per_page = 100, query = '*', sort_by = 'updated_at', order_by = 'desc' } = req.query;
        const data = await zammadFetch(
            `/api/v1/tickets/search?query=${encodeURIComponent(query)}&sort_by=${sort_by}&order_by=${order_by}&per_page=${per_page}&page=${page}&expand=true`
        );
        res.json(data);
    } catch (e) { res.status(500).json({ error: String(e) }); }
});

app.get('/api/zammad/tickets/:id', async (req, res) => {
    try {
        const data = await zammadFetch(`/api/v1/tickets/${req.params.id}?expand=true`);
        res.json(data);
    } catch (e) { res.status(500).json({ error: String(e) }); }
});

app.get('/api/zammad/ticket_states', async (req, res) => {
    try {
        const data = await zammadFetch('/api/v1/ticket_states');
        res.json(data);
    } catch (e) { res.status(500).json({ error: String(e) }); }
});

app.get('/api/zammad/ticket_priorities', async (req, res) => {
    try {
        const data = await zammadFetch('/api/v1/ticket_priorities');
        res.json(data);
    } catch (e) { res.status(500).json({ error: String(e) }); }
});

app.get('/api/zammad/groups', async (req, res) => {
    try {
        const data = await zammadFetch('/api/v1/groups');
        res.json(data);
    } catch (e) { res.status(500).json({ error: String(e) }); }
});

app.get('/api/zammad/tickets/:id/articles', async (req, res) => {
    try {
        const ticketId = req.params.id;
        const articles = await zammadFetch(`/api/v1/ticket_articles/by_ticket/${ticketId}`);
        const list = Array.isArray(articles) ? articles : [];

        for (const article of list) {
            if (article.content_type === 'text/html' && article.body) {

                // Zammad already replaces cid: with its own internal URLs like:
                //   /api/v1/ticket_attachment/:ticket/:article/:attach?view=inline
                // We replace those with our proxy so the browser can load them.
                article.body = article.body.replace(
                    /src\s*=\s*["']\/api\/v1\/ticket_attachment\/(\d+)\/(\d+)\/(\d+)[^"']*["']/gi,
                    (_, tid, aid, attid) =>
                        `src="/api/zammad/attachment/${tid}/${aid}/${attid}"`
                );

                // Fallback: also handle any remaining raw cid: references
                if (article.body.toLowerCase().includes('cid:') && Array.isArray(article.attachments)) {
                    article.body = article.body.replace(
                        /src\s*=\s*["']cid:([^"'>\s]+)["']/gi,
                        (_, cid) => {
                            const needle = cid.toLowerCase().trim();
                            const att = article.attachments.find(a => {
                                const c = (a.preferences?.['Content-ID'] || '').replace(/[<>]/g, '').toLowerCase().trim();
                                return c === needle || c.split('@')[0] === needle ||
                                    (a.filename || '').toLowerCase() === needle ||
                                    (a.filename || '').toLowerCase() === needle.split('@')[0];
                            });
                            return att ? `src="/api/zammad/attachment/${ticketId}/${article.id}/${att.id}"` : 'src=""';
                        }
                    );
                }
            }
        }

        res.json(list);
    } catch (e) { res.status(500).json({ error: String(e) }); }
});

// Proxy attachment binary (streams it back with correct Content-Type)
app.get('/api/zammad/attachment/:ticket_id/:article_id/:attach_id', async (req, res) => {
    try {
        const { ticket_id, article_id, attach_id } = req.params;
        const r = await fetch(
            `${ZAMMAD_URL}/api/v1/ticket_attachment/${ticket_id}/${article_id}/${attach_id}`,
            { headers: { 'Authorization': ZAMMAD_AUTH } }
        );
        if (!r.ok) return res.status(r.status).end();
        res.set('Content-Type', r.headers.get('content-type') || 'application/octet-stream');
        res.set('Cache-Control', 'public, max-age=3600');
        const buf = await r.arrayBuffer();
        res.send(Buffer.from(buf));
    } catch (e) { res.status(500).json({ error: String(e) }); }
});

// ── Zammad: Update ticket (status, priority, group, owner, title) ─────────────
app.put('/api/zammad/tickets/:id', async (req, res) => {
    try {
        const allowed = ['state_id', 'state', 'priority_id', 'group_id', 'owner_id', 'title'];
        const body = {};
        for (const k of allowed) { if (req.body[k] !== undefined) body[k] = req.body[k]; }
        if (Object.keys(body).length === 0) return res.status(400).json({ error: 'No valid fields' });
        const data = await zammadFetch(`/api/v1/tickets/${req.params.id}?expand=true`, {
            method: 'PUT',
            body: JSON.stringify(body),
        });
        res.json(data);
    } catch (e) { res.status(500).json({ error: String(e) }); }
});

// ── Zammad: Delete ticket ──────────────────────────────────────────────────────
app.delete('/api/zammad/tickets/:id', async (req, res) => {
    try {
        const r = await fetch(`${ZAMMAD_URL}/api/v1/tickets/${req.params.id}`, {
            method: 'DELETE',
            headers: { 'Authorization': ZAMMAD_AUTH },
        });
        if (!r.ok) {
            const text = await r.text();
            return res.status(r.status).json({ error: text || 'Delete failed' });
        }
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: String(e) }); }
});

// Convert CSS-aligned images to table-based layout for email client compatibility
// Uses both align attribute (Outlook) AND inline style (Gmail) for maximum compatibility
function emailSafeImageAlign(html) {
    if (!html) return html;
    // Match <div style="text-align:ALIGN..."><img ... /></div> patterns from the RichEditor
    return html.replace(
        /<div\s+style="text-align:\s*(left|center|right)[^"]*">\s*(<img\s[^>]*>)\s*<\/div>/gi,
        (_match, align, imgTag) => {
            // Strip display:block and margin styles from img (table cell handles alignment)
            const cleanImg = imgTag.replace(/\s*(?:display\s*:\s*block|margin-left\s*:\s*[^;]+|margin-right\s*:\s*[^;]+)\s*;?/gi, '')
                .replace(/style="\s*;*/g, 'style="')   // clean leading semicolons
                .replace(/;\s*"/g, '"');                 // clean trailing semicolons
            // align attr = Outlook/Apple Mail, style text-align = Gmail
            return `<table width="100%" border="0" cellspacing="0" cellpadding="0" style="width:100%;"><tr><td align="${align}" style="text-align:${align};">${cleanImg}</td></tr></table>`;
        }
    );
}

// Convert local /uploads/editor/ image paths to compressed base64 data URIs for Zammad compatibility
// Zammad's HTML sanitizer strips external <img src="https://..."> but keeps data: URIs
// We use sharp to compress images (max 800px wide, JPEG quality 75) to stay under Zammad's 1MB nginx limit
async function inlineLocalImages(html) {
    if (!html) return html;
    const uploadsDir = path.join(__dirname, 'public');
    const imgRegex = /src=["'](\/uploads\/editor\/[^"']+)["']/g;
    const matches = [...html.matchAll(imgRegex)];
    if (matches.length === 0) return html;

    let result = html;
    for (const m of matches) {
        const relPath = m[1];
        try {
            const filePath = path.resolve(uploadsDir, relPath.replace(/^\//, ''));
            const safeRoot = path.resolve(uploadsDir) + path.sep;
            if (!filePath.startsWith(safeRoot)) continue;
            const buf = await fs.promises.readFile(filePath);
            // Compress with sharp: max 800px wide, JPEG quality 75
            const compressed = await sharp(buf)
                .resize({ width: 800, withoutEnlargement: true })
                .jpeg({ quality: 75 })
                .toBuffer();
            result = result.replace(`src="${relPath}"`, `src="data:image/jpeg;base64,${compressed.toString('base64')}"`);
            result = result.replace(`src='${relPath}'`, `src="data:image/jpeg;base64,${compressed.toString('base64')}"`);
        } catch {
            result = result.replace(`src="${relPath}"`, `src="https://opsone.tenfw.com${relPath}"`);
            result = result.replace(`src='${relPath}'`, `src="https://opsone.tenfw.com${relPath}"`);
        }
    }
    return result;
}

// ── Zammad: Create ticket ─────────────────────────────────────────────────────
app.post('/api/zammad/tickets', async (req, res) => {
    try {
        const { title, group_id, priority_id, customer_id, customer_email, send_email, body, content_type, tags, owner_id } = req.body;
        if (!title || !group_id || !body) return res.status(400).json({ error: 'title, group_id, body required' });

        let resolvedCustomerId = customer_id ? Number(customer_id) : undefined;

        // If send_email, resolve customer by email (search or create)
        if (send_email && customer_email) {
            const searchResult = await zammadFetch(`/api/v1/users/search?query=${encodeURIComponent(customer_email)}&limit=1`);
            const found = Array.isArray(searchResult) && searchResult.find(u => u.email === customer_email);
            if (found) {
                resolvedCustomerId = found.id;
            } else {
                // Create customer user in Zammad
                const parts = customer_email.split('@')[0].split(/[._-]/);
                const newUser = await zammadFetch('/api/v1/users', {
                    method: 'POST',
                    body: JSON.stringify({
                        firstname: parts[0] || 'Customer',
                        lastname: parts[1] || '',
                        email: customer_email,
                        role_ids: [3],
                    }),
                });
                resolvedCustomerId = newUser.id;
            }
        }

        // Zammad always requires customer_id — fall back to the API agent's own user ID
        if (!resolvedCustomerId) {
            resolvedCustomerId = await getZammadAgentId();
        }

        const isEmail = !!(send_email && customer_email);
        let processedBody = await inlineLocalImages(body);
        processedBody = emailSafeImageAlign(processedBody);
        const payload = {
            title,
            group_id: Number(group_id),
            priority_id: priority_id ? Number(priority_id) : 2,
            ...(resolvedCustomerId && { customer_id: resolvedCustomerId }),
            ...(owner_id && { owner_id: Number(owner_id) }),
            article: {
                subject: title,
                body: processedBody,
                content_type: content_type || 'text/html',
                type: isEmail ? 'email' : 'note',
                internal: !isEmail,
                ...(isEmail && { to: customer_email }),
            },
        };
        if (tags) payload.tags = tags;
        const data = await zammadFetch('/api/v1/tickets?expand=true', {
            method: 'POST',
            body: JSON.stringify(payload),
        });
        res.json(data);
    } catch (e) { res.status(500).json({ error: String(e) }); }
});

// ── Zammad: Add internal note ─────────────────────────────────────────────────
app.post('/api/zammad/tickets/:id/articles', async (req, res) => {
    try {
        const { body, content_type, subject } = req.body;
        if (!body) return res.status(400).json({ error: 'body required' });
        const data = await zammadFetch('/api/v1/ticket_articles', {
            method: 'POST',
            body: JSON.stringify({
                ticket_id: Number(req.params.id),
                subject: subject || '',
                body,
                content_type: content_type || 'text/html',
                type: 'note',
                internal: true,
            }),
        });
        res.json(data);
    } catch (e) { res.status(500).json({ error: String(e) }); }
});

// ── Zammad: Tags ──────────────────────────────────────────────────────────────
app.get('/api/zammad/tickets/:id/tags', async (req, res) => {
    try {
        const data = await zammadFetch(`/api/v1/tags?object=Ticket&o_id=${req.params.id}`);
        res.json(data);
    } catch (e) { res.status(500).json({ error: String(e) }); }
});
app.post('/api/zammad/tickets/:id/tags', async (req, res) => {
    try {
        const { item } = req.body;
        if (!item) return res.status(400).json({ error: 'item required' });
        const data = await zammadFetch('/api/v1/tags/add', {
            method: 'POST',
            body: JSON.stringify({ object: 'Ticket', o_id: Number(req.params.id), item }),
        });
        res.json(data);
    } catch (e) { res.status(500).json({ error: String(e) }); }
});
app.delete('/api/zammad/tickets/:id/tags', async (req, res) => {
    try {
        const { item } = req.body;
        if (!item) return res.status(400).json({ error: 'item required' });
        const data = await zammadFetch('/api/v1/tags/remove', {
            method: 'DELETE',
            body: JSON.stringify({ object: 'Ticket', o_id: Number(req.params.id), item }),
        });
        res.json(data);
    } catch (e) { res.status(500).json({ error: String(e) }); }
});

// ── Zammad: Time accounting ───────────────────────────────────────────────────
app.get('/api/zammad/tickets/:id/time', async (req, res) => {
    try {
        const data = await zammadFetch(`/api/v1/time_accountings?ticket_id=${req.params.id}`);
        res.json(Array.isArray(data) ? data : []);
    } catch (e) { res.status(500).json({ error: String(e) }); }
});
app.post('/api/zammad/tickets/:id/time', async (req, res) => {
    try {
        const { time_unit, type_id } = req.body;
        if (!time_unit) return res.status(400).json({ error: 'time_unit required' });
        const data = await zammadFetch('/api/v1/time_accountings', {
            method: 'POST',
            body: JSON.stringify({ ticket_id: Number(req.params.id), time_unit: Number(time_unit), type_id: type_id || undefined }),
        });
        res.json(data);
    } catch (e) { res.status(500).json({ error: String(e) }); }
});

// ── Zammad: Users search (for owner/customer picker) ──────────────────────────
app.get('/api/zammad/users', async (req, res) => {
    try {
        const { query = '*', limit = 50 } = req.query;
        const data = await zammadFetch(`/api/v1/users/search?query=${encodeURIComponent(query)}&limit=${limit}&expand=true`);
        res.json(Array.isArray(data) ? data : []);
    } catch (e) { res.status(500).json({ error: String(e) }); }
});

// ── Zammad: Signatures ────────────────────────────────────────────────────────
app.get('/api/zammad/signatures', async (_req, res) => {
    try {
        const data = await zammadFetch('/api/v1/signatures');
        res.json(Array.isArray(data) ? data : []);
    } catch (e) { res.status(500).json({ error: String(e) }); }
});

// ── Notifications API ─────────────────────────────────────────────────────────
app.get('/api/notifications/:userId', async (req, res) => {
    try {
        const { rows } = await pool.query(
            'SELECT * FROM pm_notifications WHERE user_id=$1 ORDER BY created_at DESC LIMIT 50',
            [req.params.userId]
        );
        res.json(rows);
    } catch (e) { res.status(500).json({ error: String(e) }); }
});

app.get('/api/notifications/:userId/unread-count', async (req, res) => {
    try {
        const { rows } = await pool.query(
            'SELECT COUNT(*)::int AS count FROM pm_notifications WHERE user_id=$1 AND is_read=FALSE',
            [req.params.userId]
        );
        res.json({ count: rows[0].count });
    } catch (e) { res.status(500).json({ error: String(e) }); }
});

app.patch('/api/notifications/:id/read', async (req, res) => {
    try {
        await pool.query('UPDATE pm_notifications SET is_read=TRUE WHERE id=$1', [req.params.id]);
        res.status(204).end();
    } catch (e) { res.status(500).json({ error: String(e) }); }
});

app.patch('/api/notifications/:userId/read-all', async (req, res) => {
    try {
        await pool.query('UPDATE pm_notifications SET is_read=TRUE WHERE user_id=$1', [req.params.userId]);
        res.status(204).end();
    } catch (e) { res.status(500).json({ error: String(e) }); }
});

// ── Audit Trail API ───────────────────────────────────────────────────────────
app.get('/api/pm/tickets/:tid/audit-logs', async (req, res) => {
    try {
        const { rows } = await pool.query(
            'SELECT * FROM pm_audit_logs WHERE ticket_id=$1 ORDER BY created_at DESC LIMIT 100',
            [req.params.tid]
        );
        res.json(rows);
    } catch (e) { res.status(500).json({ error: String(e) }); }
});

app.get('/api/pm/projects/:pid/audit-logs', async (req, res) => {
    try {
        const { rows } = await pool.query(
            'SELECT a.*, t.title AS ticket_title FROM pm_audit_logs a LEFT JOIN pm_tickets t ON t.id=a.ticket_id WHERE a.project_id=$1 ORDER BY a.created_at DESC LIMIT 200',
            [req.params.pid]
        );
        res.json(rows);
    } catch (e) { res.status(500).json({ error: String(e) }); }
});

// ════════════════════════════════════════════════════════════════════════════
// ISO Survey Platform — Integrated Routes
// All routes under /api/survey/*
// Auth: TENCYBER SSO Bearer token validation
// DB:   opsone_db — iso_surveys, iso_questions, iso_survey_assignments, iso_responses, etc.
// ════════════════════════════════════════════════════════════════════════════

// ── Survey Email Transporter (Multi-Sender Support) ──────────────────────────
// Parse SMTP accounts: primary from env vars + additional from SURVEY_SMTP_ACCOUNTS JSON
const surveySmtpAccounts = (() => {
    const primary = {
        email: process.env.SURVEY_SMTP_USER || 'anirut@tenforward.co.th',
        pass: process.env.SURVEY_SMTP_PASS || '',
        label: process.env.SURVEY_SMTP_LABEL || 'Anirut (Default)',
    };
    const accounts = [primary];
    try {
        const extra = process.env.SURVEY_SMTP_ACCOUNTS;
        if (extra) {
            const parsed = JSON.parse(extra);
            if (Array.isArray(parsed)) {
                for (const a of parsed) {
                    if (a.email && a.pass) accounts.push({ email: a.email, pass: a.pass, label: a.label || a.email });
                }
            }
        }
    } catch (e) {
        console.warn('[survey email] Failed to parse SURVEY_SMTP_ACCOUNTS:', e.message);
    }
    return accounts;
})();

// Transport cache — one nodemailer transport per sender email
const surveyTransportCache = new Map();
function getSurveyTransporter(senderEmail) {
    const account = senderEmail
        ? surveySmtpAccounts.find(a => a.email === senderEmail)
        : surveySmtpAccounts[0];
    if (!account) return null;
    if (surveyTransportCache.has(account.email)) return { transporter: surveyTransportCache.get(account.email), account };
    const transporter = nodemailer.createTransport({
        host: process.env.SURVEY_SMTP_HOST || 'smtp.office365.com',
        port: parseInt(process.env.SURVEY_SMTP_PORT || '587'),
        secure: false,
        requireTLS: true,
        auth: { user: account.email, pass: account.pass },
        tls: { ciphers: 'SSLv3', rejectUnauthorized: false },
    });
    surveyTransportCache.set(account.email, transporter);
    return { transporter, account };
}

// Backward compat: default transporter
const surveyEmailTransporter = getSurveyTransporter()?.transporter;

// Verify primary SMTP on startup (non-blocking)
if (surveyEmailTransporter) {
    surveyEmailTransporter.verify().then(() => {
        console.log('[survey email] SMTP ready:', process.env.SURVEY_SMTP_HOST, '| accounts:', surveySmtpAccounts.map(a => a.email).join(', '));
    }).catch((e) => {
        console.warn('[survey email] SMTP verify failed (emails may not send):', e.message);
    });
}

// ── Survey Auth Helpers ───────────────────────────────────────────────────────
async function getSurveyUser(req) {
    const authHeader = req.headers.authorization || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
    if (!token) return null;
    try {
        const r = await fetch(`${TENCYBER}/api/oauth/userinfo`, {
            headers: { Authorization: `Bearer ${token}` },
        });
        if (!r.ok) return null;
        const info = await r.json();
        if (!info?.sub) return null;
        const { rows } = await pool.query(
            'SELECT sub, name, given_name, family_name, email, role, user_group FROM platform_users WHERE sub=$1',
            [info.sub],
        );
        if (!rows[0]) return null;
        // ⚠️ AUTHORITATIVE ROLE: always take the role from the live TENCYBER
        // userinfo response, never from our cached platform_users copy — that
        // cache is only refreshed at login and WILL be stale after a re-tier
        // (a demoted user would otherwise keep their old admin rights here).
        // Fail-closed: if TENCYBER sends no role, the user gets no admin.
        const liveRole = typeof info.role === 'string' ? info.role : null;
        // Keep the cache in sync so the users list reflects reality.
        if (liveRole && liveRole !== rows[0].role) {
            pool.query('UPDATE platform_users SET role=$1 WHERE sub=$2', [liveRole, info.sub]).catch(() => {});
        }
        return { ...rows[0], role: liveRole };
    } catch { return null; }
}

async function surveyRequireAuth(req, res) {
    const user = await getSurveyUser(req);
    if (!user) { res.status(401).json({ error: 'Unauthorized' }); return null; }
    return user;
}

// Canonical TENCYBER roles only. SUPER_ADMIN and STAFF have full access; INTERN
// (and anything unrecognised) is denied. Legacy names ('admin', SUPERVISOR,
// TENANT_ADMIN) are intentionally NOT accepted — see src/lib/permissions.ts.
// Fail-closed: an unknown role never gains admin.
const ADMIN_ROLES = ['SUPER_ADMIN', 'STAFF'];

async function surveyRequireAdmin(req, res) {
    const user = await getSurveyUser(req);
    if (!user) { res.status(401).json({ error: 'Unauthorized' }); return null; }
    if (!ADMIN_ROLES.includes(user.role)) { res.status(403).json({ error: 'Forbidden — admin only' }); return null; }
    return user;
}

// System settings (user groups, visibility) are SUPER_ADMIN only — stricter than
// ADMIN_ROLES: STAFF has full operational access but may not reconfigure the
// platform or change other people's group/visibility.
async function requireSuperAdmin(req, res) {
    const user = await getSurveyUser(req);
    if (!user) { res.status(401).json({ error: 'Unauthorized' }); return null; }
    if (user.role !== 'SUPER_ADMIN') { res.status(403).json({ error: 'Forbidden — super admin only' }); return null; }
    return user;
}

function surveyAuditLog(userId, action, entity, entityId, metadata, req, createdAt) {
    const ip = req?.ip || null;
    const ts = (createdAt instanceof Date && !isNaN(createdAt)) ? createdAt : new Date();
    pool.query(
        `INSERT INTO iso_audit_logs(user_id, action, entity, entity_id, metadata, ip_address, created_at)
         VALUES($1,$2,$3,$4,$5,$6,$7)`,
        [userId || null, action, entity || '', entityId || null, metadata ? JSON.stringify(metadata) : null, ip, ts],
    ).catch(() => { });
}

function buildSurveyEmailHtml(name, surveyTitle, surveyUrl, expiresAt, isReminder) {
    const formattedDate = new Date(expiresAt).toLocaleDateString('th-TH', {
        year: 'numeric', month: 'long', day: 'numeric',
    });
    return `<!DOCTYPE html><html lang="th"><head><meta charset="UTF-8"><title>แบบประเมิน</title></head>
<body style="margin:0;padding:0;background:#F0F4FF;font-family:'Sarabun',Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#F0F4FF;padding:32px 16px;">
<tr><td align="center">
<table width="560" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(37,99,235,.1);max-width:560px;">
<tr><td style="background:linear-gradient(135deg,#1D4ED8,#2563EB,#3B82F6);padding:28px 36px 24px;">
<p style="margin:0 0 16px;"><img src="https://tenforward.co.th/wp-content/uploads/2024/09/TEN_logo.webp" alt="TEN Forward" width="110" style="filter:brightness(0) invert(1);opacity:.95;display:block;"/></p>
<p style="margin:0;color:#1F2937;font-size:18px;font-weight:700;">${isReminder ? '[เตือนความจำ] ' : ''}แบบประเมิน</p>
<p style="margin:4px 0 0;color:#1F2937;font-size:13px;">Technical Operation Division &mdash; TEN Forward Co., Ltd.</p>
</td></tr>
<tr><td style="padding:32px 36px;">
${isReminder ? '<p style="background:#EFF6FF;border:1px solid #BFDBFE;border-radius:8px;padding:10px 16px;font-size:13px;color:#1D4ED8;">⚠ นี่คือการเตือนความจำ — ท่านยังไม่ได้ทำแบบประเมินที่ได้รับมอบหมาย</p>' : ''}
<p style="margin:0 0 20px;font-size:14px;color:#4B5563;line-height:1.6;">ท่านได้รับมอบหมายให้ทำแบบประเมินตามรายการด้านล่างนี้ กรุณาคลิกปุ่มเพื่อเริ่มทำแบบประเมิน</p>
<table cellpadding="0" cellspacing="0" width="100%" style="margin-bottom:28px;"><tr><td style="background:#EFF6FF;border-left:4px solid #2563EB;border-radius:0 8px 8px 0;padding:14px 18px;">
<p style="margin:0;font-size:12px;color:#6B7280;text-transform:uppercase;">แบบประเมิน</p>
<p style="margin:4px 0 0;font-size:15px;font-weight:700;color:#1E40AF;">${surveyTitle}</p>
</td></tr></table>
<table cellpadding="0" cellspacing="0" style="margin-bottom:24px;"><tr><td style="background:#2563EB;border-radius:10px;">
<a href="${surveyUrl}" style="display:inline-block;color:#fff;text-decoration:none;font-size:15px;font-weight:700;padding:14px 32px;">✓ ทำแบบประเมิน</a>
</td></tr></table>
<table cellpadding="0" cellspacing="0" width="100%"><tr><td style="background:#FEF2F2;border-radius:8px;padding:10px 16px;">
<p style="margin:0;font-size:12px;color:#DC2626;">⏰ ลิงก์นี้จะหมดอายุในวันที่ <strong>${formattedDate}</strong></p>
</td></tr></table>
</td></tr>
<tr><td style="background:#F8FAFF;padding:18px 36px;border-top:1px solid #DBEAFE;">
<p style="margin:0;font-size:12px;color:#9CA3AF;line-height:1.5;">อีเมลนี้ส่งโดยอัตโนมัติจากระบบ Operations One Platform</p>
<p style="margin:6px 0 0;font-size:11px;color:#9CA3AF;">กรุณาอย่าตอบกลับอีเมลนี้ หากมีข้อสงสัยกรุณาติดต่อทีม Technical Operation Division</p>
</td></tr>
</table></td></tr></table></body></html>`;
}

async function sendSurveyEmail(to, name, surveyTitle, token, expiresAt, assignmentId, isReminder, senderEmail) {
    const baseUrl = process.env.SURVEY_FRONTEND_URL || 'https://opsone.tenfw.com';
    const surveyUrl = `${baseUrl}/survey/fill/${token}`;
    const subject = isReminder
        ? `[เตือนความจำ] ${surveyTitle}`
        : `${surveyTitle}`;
    // Resolve transporter for selected sender (falls back to default)
    const resolved = getSurveyTransporter(senderEmail);
    if (!resolved) throw new Error(`SMTP account not found for: ${senderEmail || 'default'}`);
    const { transporter, account } = resolved;
    try {
        await transporter.sendMail({
            from: `"IT Survey System" <${account.email}>`,
            to,
            subject,
            html: buildSurveyEmailHtml(name, surveyTitle, surveyUrl, expiresAt, isReminder),
        });
        await pool.query(
            `INSERT INTO iso_email_logs("to", subject, status, assignment_id, sent_at, created_at)
             VALUES($1,$2,'SENT',$3,NOW(),NOW())`,
            [to, subject, assignmentId || null],
        );
    } catch (e) {
        console.error('[survey email] send failed:', e.message);
        await pool.query(
            `INSERT INTO iso_email_logs("to", subject, status, assignment_id, error_message, created_at)
             VALUES($1,$2,'FAILED',$3,$4,NOW())`,
            [to, subject, assignmentId || null, String(e.message)],
        );
        throw e;
    }
}

// ── Survey Dashboard ──────────────────────────────────────────────────────────
app.get('/api/survey/dashboard/stats', async (req, res) => {
    const user = await surveyRequireAdmin(req, res);
    if (!user) return;
    try {
        const [usersR, surveysR, assignmentsR, completedMonthR, satisfactionR, perSurveyStatusR] = await Promise.all([
            pool.query(`SELECT COUNT(*) FROM iso_survey_employees WHERE is_active=TRUE`),
            pool.query(`SELECT COUNT(*) FROM iso_surveys WHERE status='PUBLISHED'`),
            pool.query(`SELECT status, COUNT(*) AS cnt FROM iso_survey_assignments GROUP BY status`),
            pool.query(`SELECT COUNT(*) FROM iso_survey_assignments WHERE status='COMPLETED' AND completed_at >= date_trunc('month', NOW())`),
            pool.query(`SELECT a.survey_id, a.id AS assignment_id, a.user_id, r.question_id, r.answer FROM iso_responses r JOIN iso_questions q ON q.id = r.question_id JOIN iso_survey_assignments a ON a.id = r.assignment_id WHERE q.type = 'RATING' AND a.status = 'COMPLETED'`),
            pool.query(`SELECT survey_id, status, COUNT(*)::int AS cnt FROM iso_survey_assignments GROUP BY survey_id, status`),
        ]);
        const statusMap = {};
        for (const row of assignmentsR.rows) statusMap[row.status] = parseInt(row.cnt);
        const totalAssigned = Object.values(statusMap).reduce((s, v) => s + v, 0);
        const completed = statusMap['COMPLETED'] || 0;

        // Calculate per-user satisfaction score (0-100) then average across all users
        // For each user in each survey: score = (sum of ratings / (count * 5)) * 100
        const userScores = {};  // key: `${survey_id}::${user_id}` → { sum, count }
        for (const row of satisfactionR.rows) {
            let v = row.answer;
            if (typeof v === 'string') { try { v = JSON.parse(v); } catch { /* ignore */ } }
            v = typeof v === 'number' ? v : parseFloat(v);
            if (!isNaN(v)) {
                const key = `${row.survey_id}::${row.user_id}`;
                if (!userScores[key]) userScores[key] = { surveyId: String(row.survey_id), sum: 0, count: 0 };
                userScores[key].sum += v;
                userScores[key].count += 1;
            }
        }
        // Average per-user scores across all surveys for overall satisfaction
        let totalScore = 0; let totalUsers100 = 0;
        const surveyScoreMap = {};  // surveyId → { totalScore, userCount }
        for (const key in userScores) {
            const { surveyId, sum, count: cnt } = userScores[key];
            const userScore100 = cnt > 0 ? (sum / (cnt * 5)) * 100 : 0;
            totalScore += userScore100; totalUsers100 += 1;
            if (!surveyScoreMap[surveyId]) surveyScoreMap[surveyId] = { totalScore: 0, userCount: 0 };
            surveyScoreMap[surveyId].totalScore += userScore100;
            surveyScoreMap[surveyId].userCount += 1;
        }
        const satisfactionPercent = totalUsers100 > 0 ? Math.round(totalScore / totalUsers100) : 0;
        const satisfactionBySurvey = {};
        for (const sid in surveyScoreMap) {
            satisfactionBySurvey[sid] = Math.round(surveyScoreMap[sid].totalScore / surveyScoreMap[sid].userCount);
        }

        // Build per-survey completion breakdown
        const completionBySurvey = {};
        for (const row of perSurveyStatusR.rows) {
            const sid = String(row.survey_id);
            if (!completionBySurvey[sid]) completionBySurvey[sid] = { completed: 0, pending: 0, opened: 0, expired: 0 };
            const cnt = parseInt(row.cnt) || 0;
            if (row.status === 'COMPLETED') completionBySurvey[sid].completed = cnt;
            else if (row.status === 'PENDING' || row.status === 'SENT') completionBySurvey[sid].pending += cnt;
            else if (row.status === 'OPENED') completionBySurvey[sid].opened = cnt;
            else if (row.status === 'EXPIRED') completionBySurvey[sid].expired = cnt;
        }

        res.json({
            totalUsers: parseInt(usersR.rows[0].count),
            totalSurveys: parseInt(surveysR.rows[0].count),
            totalAssigned,
            completed,
            pending: (statusMap['PENDING'] || 0) + (statusMap['SENT'] || 0),
            opened: statusMap['OPENED'] || 0,
            expired: statusMap['EXPIRED'] || 0,
            completionRate: totalAssigned > 0 ? Math.round((completed / totalAssigned) * 100) : 0,
            completedThisMonth: parseInt(completedMonthR.rows[0].count),
            satisfactionPercent,
            satisfactionBySurvey,
            completionBySurvey,
        });
    } catch (e) { console.error(e); res.status(500).json({ error: 'Server error' }); }
});

app.get('/api/survey/dashboard/survey-completion', async (req, res) => {
    const user = await surveyRequireAdmin(req, res);
    if (!user) return;
    try {
        const { rows: surveys } = await pool.query(
            `SELECT s.id, s.title, s.created_at,
                COUNT(a.id)::int AS total,
                COUNT(a.id) FILTER (WHERE a.status='COMPLETED')::int AS completed
             FROM iso_surveys s
             LEFT JOIN iso_survey_assignments a ON a.survey_id = s.id
             WHERE s.status='PUBLISHED'
             GROUP BY s.id, s.title, s.created_at
             ORDER BY s.created_at DESC`,
        );
        // Calculate satisfaction score per survey (per-user average, 0-100 scale)
        const { rows: ratingsR } = await pool.query(
            `SELECT a.survey_id, a.user_id, r.answer
             FROM iso_responses r
             JOIN iso_questions q ON q.id = r.question_id
             JOIN iso_survey_assignments a ON a.id = r.assignment_id
             WHERE q.type = 'RATING' AND a.status = 'COMPLETED'`
        );
        const surveyUserScores = {};
        for (const row of ratingsR) {
            let v = row.answer;
            if (typeof v === 'string') { try { v = JSON.parse(v); } catch { /* ignore */ } }
            v = typeof v === 'number' ? v : parseFloat(v);
            if (!isNaN(v)) {
                const key = `${row.survey_id}::${row.user_id}`;
                if (!surveyUserScores[key]) surveyUserScores[key] = { surveyId: String(row.survey_id), sum: 0, count: 0 };
                surveyUserScores[key].sum += v;
                surveyUserScores[key].count += 1;
            }
        }
        const surveySatisfaction = {};
        for (const key in surveyUserScores) {
            const { surveyId, sum, count: cnt } = surveyUserScores[key];
            const userScore = cnt > 0 ? (sum / (cnt * 5)) * 100 : 0;
            if (!surveySatisfaction[surveyId]) surveySatisfaction[surveyId] = { total: 0, n: 0 };
            surveySatisfaction[surveyId].total += userScore;
            surveySatisfaction[surveyId].n += 1;
        }

        res.json(surveys.map(s => ({
            ...s,
            createdAt: s.created_at,
            rate: s.total > 0 ? Math.round((s.completed / s.total) * 100) : 0,
            satisfactionScore: surveySatisfaction[s.id] ? Math.round(surveySatisfaction[s.id].total / surveySatisfaction[s.id].n) : 0,
        })));
    } catch (e) { console.error(e); res.status(500).json({ error: 'Server error' }); }
});

app.get('/api/survey/dashboard/recent-activity', async (req, res) => {
    const user = await surveyRequireAdmin(req, res);
    if (!user) return;
    try {
        const { rows } = await pool.query(
            `SELECT l.*, p.given_name AS "firstName", p.family_name AS "lastName"
             FROM iso_audit_logs l
             LEFT JOIN platform_users p ON p.sub = l.user_id
             ORDER BY l.created_at DESC LIMIT 50`,
        );
        res.json(rows.map(r => ({
            ...r,
            createdAt: r.created_at,
            user: r.firstName ? { firstName: r.firstName, lastName: r.lastName } : null,
        })));
    } catch (e) { res.status(500).json({ error: 'Server error' }); }
});

// ── Surveys CRUD ──────────────────────────────────────────────────────────────
// NOTE: specific routes BEFORE /:id wildcards

app.get('/api/survey/surveys/token/:token', async (req, res) => {
    try {
        const { rows } = await pool.query(
            `SELECT a.*, s.title AS survey_title, s.description AS survey_desc,
                e.first_name AS "firstName", e.last_name AS "lastName", e.employee_code AS "employeeId", e.department AS "department"
             FROM iso_survey_assignments a
             JOIN iso_surveys s ON s.id = a.survey_id
             JOIN iso_survey_employees e ON e.id::text = a.user_id
             WHERE a.token = $1::uuid`,
            [req.params.token],
        );
        if (!rows[0]) return res.status(404).json({ error: 'not found' });
        const a = rows[0];
        if (new Date(a.token_expires_at) < new Date()) {
            await pool.query(`UPDATE iso_survey_assignments SET status='EXPIRED' WHERE id=$1`, [a.id]);
            return res.status(410).json({ error: 'token expired' });
        }
        if (a.status === 'COMPLETED') return res.status(409).json({ error: 'already completed' });
        if (a.status !== 'OPENED') {
            await pool.query(
                `UPDATE iso_survey_assignments SET status='OPENED', opened_at=NOW() WHERE id=$1`,
                [a.id],
            );
        }
        const { rows: questions } = await pool.query(
            `SELECT * FROM iso_questions WHERE survey_id=$1 ORDER BY "order" ASC`,
            [a.survey_id],
        );
        res.json({
            survey: { id: a.survey_id, title: a.survey_title, description: a.survey_desc, questions },
            user: { firstName: a.firstName, lastName: a.lastName, employeeId: a.employeeId, department: a.department || '' },
            assignmentId: a.id,
            expiresAt: a.token_expires_at,
        });
    } catch (e) { console.error(e); res.status(500).json({ error: 'Server error' }); }
});

app.post('/api/survey/surveys/responses', async (req, res) => {
    try {
        const { token, answers } = req.body;
        if (!token || !Array.isArray(answers)) return res.status(400).json({ error: 'invalid data' });
        const { rows } = await pool.query(
            `SELECT * FROM iso_survey_assignments WHERE token=$1::uuid`,
            [token],
        );
        if (!rows[0]) return res.status(404).json({ error: 'not found' });
        const a = rows[0];
        if (new Date(a.token_expires_at) < new Date()) return res.status(410).json({ error: 'token expired' });
        if (a.status === 'COMPLETED') return res.status(409).json({ error: 'already completed' });
        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            for (const ans of answers) {
                await client.query(
                    `INSERT INTO iso_responses(assignment_id, question_id, answer, created_at)
                     VALUES($1,$2,$3,NOW())
                     ON CONFLICT(assignment_id, question_id) DO UPDATE SET answer=$3`,
                    [a.id, ans.questionId, JSON.stringify(ans.answer)],
                );
            }
            await client.query(
                `UPDATE iso_survey_assignments SET status='COMPLETED', completed_at=NOW() WHERE id=$1`,
                [a.id],
            );
            await client.query(
                `INSERT INTO iso_audit_logs(user_id, action, entity, entity_id, created_at)
                 VALUES($1,'SURVEY_SUBMIT','SurveyAssignment',$2,NOW())`,
                [a.user_id, a.id],
            );
            await client.query('COMMIT');
        } catch (e) { await client.query('ROLLBACK'); throw e; }
        finally { client.release(); }
        res.json({ message: 'submitted' });
    } catch (e) { console.error(e); res.status(500).json({ error: 'Server error' }); }
});

app.get('/api/survey/surveys/assignments/all', async (req, res) => {
    const user = await surveyRequireAdmin(req, res);
    if (!user) return;
    try {
        const { status, surveyId, search } = req.query;
        const params = [];
        let where = '1=1';
        if (status) { params.push(status); where += ` AND a.status=$${params.length}`; }
        if (surveyId) { params.push(surveyId); where += ` AND a.survey_id=$${params.length}::uuid`; }
        if (search) {
            params.push(`%${search}%`);
            where += ` AND (e.first_name ILIKE $${params.length} OR e.last_name ILIKE $${params.length} OR e.email ILIKE $${params.length})`;
        }
        const { rows } = await pool.query(
            `SELECT a.*, s.title AS survey_title, s.created_at AS survey_created_at,
                e.first_name AS user_first, e.last_name AS user_last,
                e.email AS user_email, e.department AS user_department,
                e.employee_code AS user_employee_code
             FROM iso_survey_assignments a
             JOIN iso_survey_employees e ON e.id::text = a.user_id
             JOIN iso_surveys s ON s.id = a.survey_id
             WHERE ${where}
             ORDER BY a.assigned_at DESC`,
            params,
        );
        const EXPIRY_DAYS = parseInt(process.env.SURVEY_TOKEN_EXPIRY_DAYS || '7');
        res.json(rows.map(r => {
            const tokenExp = r.token_expires_at ? new Date(r.token_expires_at) : null;
            const assignedAt = r.assigned_at ? new Date(r.assigned_at) : null;
            const gapDays = (tokenExp && assignedAt) ? (tokenExp - assignedAt) / 86400000 : 0;
            const displayExpiresAt = (gapDays > EXPIRY_DAYS * 2 && assignedAt)
                ? new Date(assignedAt.getTime() + EXPIRY_DAYS * 86400000)
                : tokenExp;
            return {
                id: r.id, surveyId: r.survey_id, token: r.token,
                tokenExpiresAt: r.token_expires_at,
                displayExpiresAt: displayExpiresAt?.toISOString() ?? r.token_expires_at,
                status: r.status,
                assignedAt: r.assigned_at, sentAt: r.sent_at, openedAt: r.opened_at, completedAt: r.completed_at,
                user: { firstName: r.user_first, lastName: r.user_last, email: r.user_email, employeeId: r.user_employee_code, department: r.user_department },
                survey: { title: r.survey_title, createdAt: r.survey_created_at },
            };
        }));
    } catch (e) { console.error(e); res.status(500).json({ error: 'Server error' }); }
});

app.post('/api/survey/surveys/assignments/:id/cancel', async (req, res) => {
    const user = await surveyRequireAdmin(req, res);
    if (!user) return;
    try {
        const { rows } = await pool.query(`SELECT * FROM iso_survey_assignments WHERE id=$1`, [req.params.id]);
        if (!rows[0]) return res.status(404).json({ error: 'not found' });
        if (rows[0].status === 'COMPLETED') return res.status(400).json({ error: 'already completed' });
        await pool.query(`UPDATE iso_survey_assignments SET status='EXPIRED', token_expires_at=NOW() WHERE id=$1`, [req.params.id]);
        surveyAuditLog(user.sub, 'SURVEY_CANCEL', 'SurveyAssignment', req.params.id, null, req);
        res.json({ message: 'cancelled' });
    } catch (e) { res.status(500).json({ error: 'Server error' }); }
});

app.post('/api/survey/surveys/assignments/bulk-delete', async (req, res) => {
    const user = await surveyRequireAdmin(req, res);
    if (!user) return;
    try {
        const { ids } = req.body;
        if (!Array.isArray(ids) || ids.length === 0) return res.status(400).json({ error: 'ids required' });
        await pool.query(`DELETE FROM iso_survey_assignments WHERE id = ANY($1::uuid[])`, [ids]);
        res.json({ success: true, count: ids.length });
    } catch (e) { console.error(e); res.status(500).json({ error: 'Server error' }); }
});

app.get('/api/survey/surveys', async (req, res) => {
    const user = await surveyRequireAuth(req, res);
    if (!user) return;
    try {
        const { rows } = await pool.query(
            `SELECT s.*,
                p.given_name AS creator_first, p.family_name AS creator_last,
                (SELECT COUNT(*) FROM iso_questions q WHERE q.survey_id=s.id)::int AS question_count,
                (SELECT COUNT(*) FROM iso_survey_assignments a WHERE a.survey_id=s.id)::int AS assignment_count
             FROM iso_surveys s
             LEFT JOIN platform_users p ON p.sub = s.created_by_id
             ORDER BY s.created_at DESC`,
        );
        res.json(rows.map(r => ({
            id: r.id, title: r.title, description: r.description,
            version: r.version, status: r.status,
            createdById: r.created_by_id, createdAt: r.created_at, updatedAt: r.updated_at,
            createdBy: r.creator_first ? { firstName: r.creator_first, lastName: r.creator_last } : null,
            _count: { questions: r.question_count, assignments: r.assignment_count },
        })));
    } catch (e) { res.status(500).json({ error: 'Server error' }); }
});

app.post('/api/survey/surveys', async (req, res) => {
    const user = await surveyRequireAdmin(req, res);
    if (!user) return;
    try {
        const { title, description, questions } = req.body;
        if (!title?.trim()) return res.status(400).json({ error: 'title is required' });
        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            const { rows } = await client.query(
                `INSERT INTO iso_surveys(title, description, created_by_id, created_at, updated_at)
                 VALUES($1,$2,$3,NOW(),NOW()) RETURNING *`,
                [title.trim(), description || null, user.sub],
            );
            const survey = rows[0];
            if (Array.isArray(questions) && questions.length > 0) {
                for (const q of questions) {
                    await client.query(
                        `INSERT INTO iso_questions(survey_id, text, type, options, "order", required, created_at)
                         VALUES($1,$2,$3,$4,$5,$6,NOW())`,
                        [survey.id, q.text, q.type, q.options ? JSON.stringify(q.options) : null, q.order ?? 0, q.required ?? true],
                    );
                }
            }
            await client.query('COMMIT');
            surveyAuditLog(user.sub, 'SURVEY_CREATE', 'Survey', survey.id, { title }, req);
            res.status(201).json(survey);
        } catch (e) { await client.query('ROLLBACK'); throw e; }
        finally { client.release(); }
    } catch (e) { console.error(e); res.status(500).json({ error: 'Server error' }); }
});

app.post('/api/survey/surveys/:id/duplicate', async (req, res) => {
    const user = await surveyRequireAdmin(req, res);
    if (!user) return;
    try {
        const { title, createdAt } = req.body || {};
        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            const { rows: surveyRows } = await client.query(`SELECT * FROM iso_surveys WHERE id=$1`, [req.params.id]);
            if (!surveyRows[0]) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'not found' }); }
            
            const orig = surveyRows[0];
            const newTitle = title || `${orig.title} (Copy)`;
            const createdDate = createdAt ? new Date(createdAt) : new Date();
            
            const { rows } = await client.query(
                `INSERT INTO iso_surveys(title, description, created_by_id, created_at, updated_at)
                 VALUES($1,$2,$3,$4,NOW()) RETURNING *`,
                [newTitle, orig.description || null, user.sub, createdDate],
            );
            const newSurvey = rows[0];
            
            const { rows: questions } = await client.query(
                `SELECT * FROM iso_questions WHERE survey_id=$1 ORDER BY "order" ASC`,
                [req.params.id],
            );
            
            if (questions.length > 0) {
                for (const q of questions) {
                    await client.query(
                        `INSERT INTO iso_questions(survey_id, text, type, options, "order", required, created_at)
                         VALUES($1,$2,$3,$4,$5,$6,NOW())`,
                        [newSurvey.id, q.text, q.type, q.options ? JSON.stringify(q.options) : null, q.order ?? 0, q.required ?? true],
                    );
                }
            }
            
            await client.query('COMMIT');
            surveyAuditLog(user.sub, 'SURVEY_CREATE', 'Survey', newSurvey.id, { title: newTitle, originalId: orig.id }, req);
            res.status(201).json(newSurvey);
        } catch (e) { await client.query('ROLLBACK'); throw e; }
        finally { client.release(); }
    } catch (e) { console.error(e); res.status(500).json({ error: 'Server error' }); }
});


app.get('/api/survey/surveys/:id', async (req, res) => {
    const user = await surveyRequireAuth(req, res);
    if (!user) return;
    try {
        const { rows } = await pool.query(`SELECT * FROM iso_surveys WHERE id=$1`, [req.params.id]);
        if (!rows[0]) return res.status(404).json({ error: 'not found' });
        const { rows: questions } = await pool.query(
            `SELECT * FROM iso_questions WHERE survey_id=$1 ORDER BY "order" ASC`,
            [req.params.id],
        );
        res.json({ ...rows[0], questions });
    } catch (e) { res.status(500).json({ error: 'Server error' }); }
});

app.put('/api/survey/surveys/:id', async (req, res) => {
    const user = await surveyRequireAdmin(req, res);
    if (!user) return;
    try {
        const { title, description, questions, createdAt } = req.body;
        if (!title?.trim()) return res.status(400).json({ error: 'title is required' });
        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            let queryStr = `UPDATE iso_surveys SET title=$1, description=$2, updated_at=NOW() WHERE id=$3 RETURNING *`;
            let queryParams = [title.trim(), description || null, req.params.id];
            
            if (createdAt) {
                queryStr = `UPDATE iso_surveys SET title=$1, description=$2, created_at=$3, updated_at=NOW() WHERE id=$4 RETURNING *`;
                queryParams = [title.trim(), description || null, new Date(createdAt), req.params.id];
            }
            
            const { rows } = await client.query(queryStr, queryParams);
            if (!rows[0]) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'not found' }); }
            if (Array.isArray(questions)) {
                await client.query(`DELETE FROM iso_questions WHERE survey_id=$1`, [req.params.id]);
                for (const q of questions) {
                    await client.query(
                        `INSERT INTO iso_questions(survey_id, text, type, options, "order", required, created_at)
                         VALUES($1,$2,$3,$4,$5,$6,NOW())`,
                        [req.params.id, q.text, q.type, q.options ? JSON.stringify(q.options) : null, q.order ?? 0, q.required ?? true],
                    );
                }
            }
            await client.query('COMMIT');
            res.json(rows[0]);
        } catch (e) { await client.query('ROLLBACK'); throw e; }
        finally { client.release(); }
    } catch (e) { console.error(e); res.status(500).json({ error: 'Server error' }); }
});

app.delete('/api/survey/surveys/:id', async (req, res) => {
    const user = await surveyRequireAdmin(req, res);
    if (!user) return;
    try {
        const result = await pool.query(`DELETE FROM iso_surveys WHERE id=$1`, [req.params.id]);
        if (result.rowCount === 0) return res.status(404).json({ error: 'not found' });
        surveyAuditLog(user.sub, 'SURVEY_DELETE', 'Survey', req.params.id, null, req);
        res.json({ message: 'deleted' });
    } catch (e) { res.status(500).json({ error: 'Server error' }); }
});

app.patch('/api/survey/surveys/:id/status', async (req, res) => {
    const user = await surveyRequireAdmin(req, res);
    if (!user) return;
    try {
        const { status } = req.body;
        if (!['DRAFT', 'PUBLISHED', 'ARCHIVED'].includes(status)) return res.status(400).json({ error: 'invalid status' });
        const { rows } = await pool.query(
            `UPDATE iso_surveys SET status=$1, updated_at=NOW() WHERE id=$2 RETURNING *`,
            [status, req.params.id],
        );
        if (!rows[0]) return res.status(404).json({ error: 'not found' });
        if (status === 'PUBLISHED') surveyAuditLog(user.sub, 'SURVEY_PUBLISH', 'Survey', req.params.id, null, req);
        res.json(rows[0]);
    } catch (e) { res.status(500).json({ error: 'Server error' }); }
});

// Also support /api/survey/surveys/:id/publish  (SurveysPage uses this)
app.post('/api/survey/surveys/:id/publish', async (req, res) => {
    const user = await surveyRequireAdmin(req, res);
    if (!user) return;
    try {
        const { rows } = await pool.query(
            `UPDATE iso_surveys SET status='PUBLISHED', updated_at=NOW() WHERE id=$1 RETURNING *`,
            [req.params.id],
        );
        if (!rows[0]) return res.status(404).json({ error: 'not found' });
        surveyAuditLog(user.sub, 'SURVEY_PUBLISH', 'Survey', req.params.id, null, req);
        res.json(rows[0]);
    } catch (e) { res.status(500).json({ error: 'Server error' }); }
});

app.post('/api/survey/surveys/:id/assign', async (req, res) => {
    const user = await surveyRequireAdmin(req, res);
    if (!user) return;
    try {
        const { userIds, customDate, senderEmail } = req.body;
        if (!Array.isArray(userIds) || userIds.length === 0) return res.status(400).json({ error: 'userIds required' });
        // Validate senderEmail if provided
        if (senderEmail && !surveySmtpAccounts.find(a => a.email === senderEmail)) {
            return res.status(400).json({ error: `ไม่พบบัญชีส่ง Email: ${senderEmail}` });
        }
        const { rows: surveyRows } = await pool.query(`SELECT * FROM iso_surveys WHERE id=$1`, [req.params.id]);
        if (!surveyRows[0]) return res.status(404).json({ error: 'survey not found' });
        const survey = surveyRows[0];
        const expiryDays = parseInt(process.env.SURVEY_TOKEN_EXPIRY_DAYS || '7');
        
        let overrideDate = null;
        if (customDate && (user.name?.includes('Panupong Nijjaboon') || user.email?.toLowerCase().includes('panupong'))) {
            overrideDate = new Date(customDate);
        }

        // Real expiry = always from NOW so the link actually works
        const realExpiresAt = new Date(Date.now() + expiryDays * 86400000);
        // Display expiry = the fake historical date (for email display only)
        const displayExpiresAt = overrideDate ? new Date(overrideDate.getTime() + expiryDays * 86400000) : realExpiresAt;

        let sent = 0, skipped = 0;
        for (const userId of userIds) {
            const { rows: userRows } = await pool.query(
                `SELECT id::text AS sub, first_name AS given_name, last_name AS family_name, email FROM iso_survey_employees WHERE id=$1::uuid AND is_active=TRUE`, [userId],
            );
            if (!userRows[0]) { skipped++; continue; }
            const u = userRows[0];
            const { rows: existing } = await pool.query(
                `SELECT id FROM iso_survey_assignments WHERE survey_id=$1 AND user_id=$2 AND status NOT IN ('COMPLETED','EXPIRED')`,
                [survey.id, userId],
            );
            if (existing[0]) { skipped++; continue; }
            const token = randomUUID();
            
            // DB always stores REAL future expiry so the token link works
            let queryStr, queryParams;
            if (overrideDate) {
                queryStr = `INSERT INTO iso_survey_assignments(survey_id, user_id, token, token_expires_at, status, assigned_at) VALUES($1,$2,$3::uuid,$4,'PENDING',$5) RETURNING id`;
                queryParams = [survey.id, userId, token, realExpiresAt, overrideDate];
            } else {
                queryStr = `INSERT INTO iso_survey_assignments(survey_id, user_id, token, token_expires_at, status, assigned_at) VALUES($1,$2,$3::uuid,$4,'PENDING',NOW()) RETURNING id`;
                queryParams = [survey.id, userId, token, realExpiresAt];
            }

            const { rows: asgn } = await pool.query(queryStr, queryParams);
            if (u.email?.includes('@')) {
                try {
                    // Email shows the DISPLAY date (historical) not the real one
                    await sendSurveyEmail(u.email, `${u.given_name || u.name} ${u.family_name || ''}`.trim(), survey.title, token, displayExpiresAt, asgn[0].id, false, senderEmail);
                    if (overrideDate) {
                        await pool.query(`UPDATE iso_survey_assignments SET status='SENT', sent_at=$2 WHERE id=$1`, [asgn[0].id, overrideDate]);
                    } else {
                        await pool.query(`UPDATE iso_survey_assignments SET status='SENT', sent_at=NOW() WHERE id=$1`, [asgn[0].id]);
                    }
                } catch { /* email failure logged in sendSurveyEmail */ }
            }
            sent++;
        }
        surveyAuditLog(user.sub, 'SURVEY_ASSIGN', 'Survey', survey.id, { sent, skipped }, req, overrideDate);
        res.json({ message: `มอบหมายสำเร็จ ${sent} รายการ (ข้าม ${skipped} รายการ)`, sent, skipped });
    } catch (e) { console.error(e); res.status(500).json({ error: 'Server error' }); }
});

app.get('/api/survey/surveys/:id/report', async (req, res) => {
    const user = await surveyRequireAdmin(req, res);
    if (!user) return;
    try {
        const { rows: surveyRows } = await pool.query(`SELECT * FROM iso_surveys WHERE id=$1`, [req.params.id]);
        if (!surveyRows[0]) return res.status(404).json({ error: 'not found' });
        const survey = surveyRows[0];
        const { rows: questions } = await pool.query(
            `SELECT * FROM iso_questions WHERE survey_id=$1 ORDER BY "order" ASC`, [survey.id],
        );
        const { rows: summary } = await pool.query(
            `SELECT COUNT(*)::int AS total_assigned,
                COUNT(*) FILTER (WHERE status='COMPLETED')::int AS total_completed
             FROM iso_survey_assignments WHERE survey_id=$1`, [survey.id],
        );
        const { rows: responses } = await pool.query(
            `SELECT r.question_id, r.answer, a.user_id,
                e.department
             FROM iso_responses r
             JOIN iso_survey_assignments a ON a.id = r.assignment_id
             JOIN iso_survey_employees e ON e.id::text = a.user_id
             WHERE a.survey_id=$1 AND a.status='COMPLETED'`, [survey.id],
        );
        const questionStats = questions.map(q => {
            const qResponses = responses.filter(r => r.question_id === q.id);
            let avg = null, distribution = {}, textAnswers = [];
            if (q.type === 'RATING') {
                const nums = qResponses.map(r => {
                    let v = r.answer;
                    if (typeof v === 'string') {
                        try { v = JSON.parse(v); } catch { /* ignore */ }
                    }
                    return typeof v === 'number' ? v : parseFloat(v);
                }).filter(v => !isNaN(v));
                avg = nums.length > 0 ? Math.round((nums.reduce((s, v) => s + v, 0) / nums.length) * 100) / 100 : null;
                for (let i = 1; i <= 5; i++) distribution[String(i)] = nums.filter(v => v === i).length;
            } else if (q.type === 'TEXT') {
                textAnswers = qResponses.map(r => {
                    let v = r.answer;
                    if (typeof v === 'string') {
                        try { v = JSON.parse(v); } catch { /* ignore */ }
                    }
                    return typeof v === 'string' ? v : String(v);
                }).filter(v => v.trim());
            } else {
                for (const r of qResponses) {
                    let v = r.answer;
                    if (typeof v === 'string') {
                        try { v = JSON.parse(v); } catch { /* ignore */ }
                    }
                    const choices = Array.isArray(v) ? v : [v];
                    for (const c of choices) {
                        const parts = typeof c === 'string' ? c.split(':::') : [String(c)];
                        const base = parts[0];
                        const detail = parts[1];
                        distribution[base] = (distribution[base] || 0) + 1;
                        if (detail && detail.trim()) {
                            if (!textAnswers) textAnswers = [];
                            textAnswers.push(`${base} - ${detail.trim()}`);
                        }
                    }
                }
            }
            return { id: q.id, text: q.text, type: q.type, order: q.order, avg, count: qResponses.length, distribution, textAnswers };
        });
        // Parse [Section] prefix from question text to group into named sections
        const sectionPattern = /^\[([^\]]+)\]\s*/;
        const sectionMap = {};
        const sectionOrder = [];
        for (const qs of questionStats) {
            const match = qs.text.match(sectionPattern);
            const sectionName = match ? match[1] : 'แบบประเมิน';
            if (!sectionMap[sectionName]) { sectionMap[sectionName] = []; sectionOrder.push(sectionName); }
            sectionMap[sectionName].push({ ...qs, text: qs.text.replace(sectionPattern, '') });
        }
        const sections = sectionOrder.map(s => ({ name: s, questions: sectionMap[s] }));
        const deptMap = {};
        for (const r of responses) {
            const dept = r.department || 'ไม่ระบุ';
            if (!deptMap[dept]) deptMap[dept] = { users: new Set(), questionTotals: {}, questionCounts: {} };
            deptMap[dept].users.add(r.user_id);
            const q = questions.find(q => q.id === r.question_id);
            if (q?.type === 'RATING') {
                const v = typeof r.answer === 'object' ? r.answer : JSON.parse(r.answer);
                const num = typeof v === 'number' ? v : parseFloat(v);
                if (!isNaN(num)) {
                    deptMap[dept].questionTotals[r.question_id] = (deptMap[dept].questionTotals[r.question_id] || 0) + num;
                    deptMap[dept].questionCounts[r.question_id] = (deptMap[dept].questionCounts[r.question_id] || 0) + 1;
                }
            }
        }
        const deptBreakdown = Object.entries(deptMap).map(([dept, d]) => {
            const qAvgs = Object.keys(d.questionTotals).map(qId => ({
                questionId: qId,
                avg: Math.round((d.questionTotals[qId] / d.questionCounts[qId]) * 100) / 100,
                count: d.questionCounts[qId],
            }));
            const overallAvg = qAvgs.length > 0 ? Math.round((qAvgs.reduce((s, q) => s + q.avg, 0) / qAvgs.length) * 100) / 100 : 0;
            return { department: dept, count: d.users.size, overallAvg, questionAvgs: qAvgs };
        });
        // Calculate per-user satisfaction score (0-100) for this survey
        const userRatings = {};
        for (const r of responses) {
            const q = questions.find(q => q.id === r.question_id);
            if (q?.type === 'RATING') {
                let v = r.answer;
                if (typeof v === 'string') { try { v = JSON.parse(v); } catch { /* ignore */ } }
                const num = typeof v === 'number' ? v : parseFloat(v);
                if (!isNaN(num)) {
                    if (!userRatings[r.user_id]) userRatings[r.user_id] = { sum: 0, count: 0 };
                    userRatings[r.user_id].sum += num;
                    userRatings[r.user_id].count += 1;
                }
            }
        }
        let satTotal = 0; let satUsers = 0;
        for (const uid in userRatings) {
            const { sum: uSum, count: uCnt } = userRatings[uid];
            satTotal += uCnt > 0 ? (uSum / (uCnt * 5)) * 100 : 0;
            satUsers += 1;
        }
        let satisfactionScore = satUsers > 0 ? Math.round(satTotal / satUsers) : 0;
        let overallAvg = questionStats.filter(q => q.avg !== null).reduce((s, q, _, a) => s + q.avg / a.length, 0);

        // Weighted scoring: when section labels carry "น้ำหนัก X%" (e.g. probation
        // evaluation forms), compute a weight-respecting total out of 100 instead of
        // the equal-weight average above. Each section contributes its declared weight;
        // the section score is its mean RATING (1-5) normalised to 100. Falls back to
        // the simple average for surveys whose sections carry no weights.
        const weightPattern = /น้ำหนัก\s*([\d.]+)\s*%/;
        const weightedSections = sections.map(s => {
            const ratingQs = s.questions.filter(q => q.type === 'RATING' && q.avg !== null);
            const avg = ratingQs.length > 0 ? ratingQs.reduce((a, q) => a + q.avg, 0) / ratingQs.length : null;
            const wm = s.name.match(weightPattern);
            return { avg, weight: wm ? parseFloat(wm[1]) : null };
        }).filter(s => s.avg !== null && s.weight !== null);
        const totalWeight = weightedSections.reduce((a, s) => a + s.weight, 0);
        let scoreMethod = 'simple';
        if (weightedSections.length > 0 && totalWeight > 0) {
            const weightedAvg5 = weightedSections.reduce((a, s) => a + s.avg * (s.weight / totalWeight), 0);
            satisfactionScore = Math.round((weightedAvg5 / 5) * 100);
            overallAvg = Math.round(weightedAvg5 * 100) / 100;
            scoreMethod = 'weighted';
        }

        res.json({
            survey: { id: survey.id, title: survey.title, description: survey.description, createdAt: survey.created_at },
            summary: {
                totalAssigned: summary[0].total_assigned,
                totalCompleted: summary[0].total_completed,
                completionRate: summary[0].total_assigned > 0 ? Math.round((summary[0].total_completed / summary[0].total_assigned) * 100) : 0,
                overallAvg,
                satisfactionScore,
                scoreMethod,
            },
            sections,
            deptBreakdown,
            generatedAt: new Date().toISOString(),
        });
    } catch (e) { console.error(e); res.status(500).json({ error: 'Server error' }); }
});

// ── Survey Employees (separate from platform SSO users) ───────────────────────
app.get('/api/survey/users', async (req, res) => {
    const user = await surveyRequireAuth(req, res);
    if (!user) return;
    try {
        const { search, company, department } = req.query;
        let q = `SELECT id, first_name AS "firstName", last_name AS "lastName",
            email, department, employee_code AS "employeeId",
            company, is_active AS "isActive", 'respondent' AS role,
            created_at AS "createdAt"
         FROM iso_survey_employees`;
        const params = [];
        const conditions = [];
        if (search) { params.push(`%${search}%`); conditions.push(`(first_name ILIKE $${params.length} OR last_name ILIKE $${params.length} OR email ILIKE $${params.length} OR department ILIKE $${params.length} OR employee_code ILIKE $${params.length})`); }
        if (company) { params.push(company); conditions.push(`company=$${params.length}`); }
        if (department) { params.push(department); conditions.push(`department=$${params.length}`); }
        if (conditions.length > 0) q += ` WHERE ` + conditions.join(' AND ');
        q += ` ORDER BY first_name, last_name ASC`;
        const { rows } = await pool.query(q, params);
        res.json(rows);
    } catch (e) { console.error(e); res.status(500).json({ error: 'Server error' }); }
});

// GET one employee
app.get('/api/survey/users/:id', async (req, res) => {
    const user = await surveyRequireAuth(req, res);
    if (!user) return;
    try {
        const { rows } = await pool.query(
            `SELECT id, first_name AS "firstName", last_name AS "lastName",
                email, department, employee_code AS "employeeId",
                company, is_active AS "isActive", created_at AS "createdAt"
             FROM iso_survey_employees WHERE id=$1::uuid`, [req.params.id],
        );
        if (!rows[0]) return res.status(404).json({ error: 'not found' });
        res.json(rows[0]);
    } catch (e) { res.status(500).json({ error: 'Server error' }); }
});

// POST /api/survey/users — add a survey respondent employee (admin only)
app.post('/api/survey/users', async (req, res) => {
    const actor = await surveyRequireAdmin(req, res);
    if (!actor) return;
    try {
        const { firstName, lastName, email, department, employeeId, company } = req.body;
        if (!firstName || !lastName || !email) return res.status(400).json({ error: 'firstName, lastName, email are required' });
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: 'Invalid email format' });
        const existing = await pool.query(`SELECT id FROM iso_survey_employees WHERE email=$1`, [email.toLowerCase()]);
        if (existing.rows.length > 0) return res.status(409).json({ error: 'อีเมลนี้มีอยู่ในระบบแล้ว' });
        const { rows } = await pool.query(
            `INSERT INTO iso_survey_employees(first_name, last_name, email, department, employee_code, company, created_by)
             VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
            [firstName.trim(), lastName.trim(), email.toLowerCase(), department || '', employeeId || '', company || '', actor.sub],
        );
        const newId = rows[0].id;
        surveyAuditLog(actor.sub, 'USER_CREATED', 'iso_survey_employees', newId, { email, name: `${firstName} ${lastName}` }, req);
        res.status(201).json({ id: newId, firstName, lastName, email: email.toLowerCase(), department, employeeId, company: company || '', isActive: true, role: 'respondent' });
    } catch (e) { console.error(e); res.status(500).json({ error: 'Server error' }); }
});

// PUT /api/survey/users/:id — update a survey employee (admin only)
app.put('/api/survey/users/:id', async (req, res) => {
    const actor = await surveyRequireAdmin(req, res);
    if (!actor) return;
    try {
        const { id } = req.params;
        const { firstName, lastName, department, employeeId, company, isActive } = req.body;
        const updates = [];
        const params = [];
        if (firstName !== undefined) { params.push(firstName.trim()); updates.push(`first_name=$${params.length}`); }
        if (lastName !== undefined) { params.push(lastName.trim()); updates.push(`last_name=$${params.length}`); }
        if (department !== undefined) { params.push(department); updates.push(`department=$${params.length}`); }
        if (employeeId !== undefined) { params.push(employeeId); updates.push(`employee_code=$${params.length}`); }
        if (company !== undefined) { params.push(company); updates.push(`company=$${params.length}`); }
        if (isActive !== undefined) { params.push(!!isActive); updates.push(`is_active=$${params.length}`); }
        if (updates.length === 0) return res.status(400).json({ error: 'Nothing to update' });
        params.push(new Date()); updates.push(`updated_at=$${params.length}`);
        params.push(id);
        await pool.query(`UPDATE iso_survey_employees SET ${updates.join(',')} WHERE id=$${params.length}::uuid`, params);
        res.json({ success: true });
    } catch (e) { console.error(e); res.status(500).json({ error: 'Server error' }); }
});

// DELETE /api/survey/users/:id — deactivate (soft delete) employee (admin only)
app.delete('/api/survey/users/:id', async (req, res) => {
    const actor = await surveyRequireAdmin(req, res);
    if (!actor) return;
    try {
        await pool.query(`UPDATE iso_survey_employees SET is_active=FALSE, updated_at=NOW() WHERE id=$1::uuid`, [req.params.id]);
        surveyAuditLog(actor.sub, 'USER_DEACTIVATED', 'iso_survey_employees', req.params.id, null, req);
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: 'Server error' }); }
});

// GET distinct companies
app.get('/api/survey/companies', async (req, res) => {
    const user = await surveyRequireAuth(req, res);
    if (!user) return;
    try {
        const { rows } = await pool.query(
            `SELECT DISTINCT company FROM iso_survey_employees WHERE is_active=TRUE AND company IS NOT NULL AND company<>'' ORDER BY company ASC`,
        );
        res.json(rows.map((r) => r.company));
    } catch (e) { res.status(500).json({ error: 'Server error' }); }
});

// GET distinct departments
app.get('/api/survey/departments', async (req, res) => {
    const user = await surveyRequireAuth(req, res);
    if (!user) return;
    try {
        const { company } = req.query;
        const params = [];
        let where = `is_active=TRUE AND department IS NOT NULL AND department<>''`;
        if (company) { params.push(company); where += ` AND company=$1`; }
        const { rows } = await pool.query(
            `SELECT DISTINCT department FROM iso_survey_employees WHERE ${where} ORDER BY department ASC`, params,
        );
        res.json(rows.map((r) => r.department));
    } catch (e) { res.status(500).json({ error: 'Server error' }); }
});

// ── Audit Logs ────────────────────────────────────────────────────────────────
app.get('/api/survey/audit', async (req, res) => {
    const user = await surveyRequireAdmin(req, res);
    if (!user) return;
    try {
        const { page = '1', limit = '50', action, userId } = req.query;
        const offset = (parseInt(String(page)) - 1) * parseInt(String(limit));
        const params = [];
        let where = '1=1';
        if (action) { params.push(`%${action}%`); where += ` AND l.action ILIKE $${params.length}`; }
        if (userId) { params.push(userId); where += ` AND l.user_id=$${params.length}`; }
        params.push(parseInt(String(limit)));
        params.push(offset);
        const { rows: logs } = await pool.query(
            `SELECT l.*, p.given_name AS "firstName", p.family_name AS "lastName"
             FROM iso_audit_logs l
             LEFT JOIN platform_users p ON p.sub = l.user_id
             WHERE ${where}
             ORDER BY l.created_at DESC
             LIMIT $${params.length - 1} OFFSET $${params.length}`,
            params,
        );
        const countParams = params.slice(0, params.length - 2);
        const { rows: countRows } = await pool.query(
            `SELECT COUNT(*) FROM iso_audit_logs l WHERE ${where}`, countParams,
        );
        res.json({
            logs: logs.map(r => ({ ...r, createdAt: r.created_at, user: r.firstName ? { firstName: r.firstName, lastName: r.lastName } : null })),
            total: parseInt(countRows[0].count),
            page: parseInt(String(page)),
            limit: parseInt(String(limit)),
        });
    } catch (e) { console.error(e); res.status(500).json({ error: 'Server error' }); }
});

// ── Email Routes ──────────────────────────────────────────────────────────────
// ── Email Senders list ────────────────────────────────────────────────────────
app.get('/api/survey/email/senders', async (req, res) => {
    const user = await surveyRequireAdmin(req, res);
    if (!user) return;
    res.json(surveySmtpAccounts.map(a => ({ email: a.email, label: a.label })));
});

app.post('/api/survey/email/send-reminder', async (req, res) => {
    const user = await surveyRequireAdmin(req, res);
    if (!user) return;
    try {
        const { assignmentIds, senderEmail } = req.body;
        if (!Array.isArray(assignmentIds)) return res.status(400).json({ error: 'assignmentIds required' });
        // Validate senderEmail if provided
        if (senderEmail && !surveySmtpAccounts.find(a => a.email === senderEmail)) {
            return res.status(400).json({ error: `ไม่พบบัญชีส่ง Email: ${senderEmail}` });
        }
        let sent = 0, failed = 0;
        const expiryDays = parseInt(process.env.SURVEY_TOKEN_EXPIRY_DAYS || '7');
        for (const id of assignmentIds) {
            const { rows } = await pool.query(
                `SELECT a.*, s.title AS survey_title,
                    e.first_name, e.last_name, e.email AS user_email
                 FROM iso_survey_assignments a
                 JOIN iso_surveys s ON s.id=a.survey_id
                 JOIN iso_survey_employees e ON e.id::text=a.user_id
                 WHERE a.id=$1`, [id],
            );
            if (!rows[0] || rows[0].status === 'COMPLETED' || rows[0].status === 'EXPIRED') continue;
            const a = rows[0];
            if (!a.user_email?.includes('@')) continue;
            const newExpiry = new Date(Date.now() + expiryDays * 86400000);
            try {
                await sendSurveyEmail(a.user_email, `${a.first_name} ${a.last_name}`.trim(), a.survey_title, a.token, newExpiry, a.id, true, senderEmail);
                await pool.query(`UPDATE iso_survey_assignments SET token_expires_at=$1, status='SENT', sent_at=NOW() WHERE id=$2`, [newExpiry, a.id]);
                sent++;
            } catch { failed++; }
        }
        res.json({ sent, failed, message: `ส่ง Reminder สำเร็จ ${sent} รายการ` });
    } catch (e) { console.error(e); res.status(500).json({ error: 'Server error' }); }
});

app.get('/api/survey/email/logs', async (req, res) => {
    const user = await surveyRequireAdmin(req, res);
    if (!user) return;
    try {
        const { page = '1', limit = '50' } = req.query;
        const offset = (parseInt(String(page)) - 1) * parseInt(String(limit));
        const [{ rows: logs }, { rows: countRows }] = await Promise.all([
            pool.query(`SELECT * FROM iso_email_logs ORDER BY created_at DESC LIMIT $1 OFFSET $2`, [parseInt(String(limit)), offset]),
            pool.query(`SELECT COUNT(*) FROM iso_email_logs`),
        ]);
        res.json({ logs, total: parseInt(countRows[0].count) });
    } catch (e) { res.status(500).json({ error: 'Server error' }); }
});

// ── Public Read-Only Inventory API (v1) ──────────────────────────────────────
// Read-only access to the Asset Inventory for external integrations, so callers
// never need database credentials. GET only — nothing here mutates data.
//
// Auth:  x-api-key: <key>   (or  Authorization: Bearer <key>)
//        Key comes from the INVENTORY_API_KEY env var. If unset the API is
//        disabled (503) rather than served open.
// Docs:  GET /api/v1/inventory            → endpoint index
//        GET /api/v1/inventory/assets     → list (filters + pagination)
//        GET /api/v1/inventory/assets/:id → single asset by asset_id or uuid
//        GET /api/v1/inventory/summary    → counts by group / type / status

// Optional static key from env (legacy / bootstrap). Keys generated in Settings
// live in the api_keys table and are the preferred mechanism.
const INVENTORY_API_KEY = process.env.INVENTORY_API_KEY || '';

const API_KEY_PREFIX = 'opsone_';
const sha256 = (v) => createHash('sha256').update(String(v)).digest('hex');

/** Generate a new key: `opsone_<64 hex>` — 256 bits of entropy. */
function generateApiKey() {
    const secret = randomBytes(32).toString('hex');
    const key = `${API_KEY_PREFIX}${secret}`;
    return { key, hash: sha256(key), prefix: key.slice(0, 14) };
}

/** Constant-time compare for the legacy env key. */
function envKeyMatches(provided) {
    if (!INVENTORY_API_KEY) return false;
    const a = Buffer.from(String(provided));
    const b = Buffer.from(INVENTORY_API_KEY);
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
}

// Fixed-window rate limit (in-memory, no extra deps).
const invRateWindow = new Map();
function inventoryRateLimit(req, res, next) {
    const WINDOW_MS = 60_000;
    const MAX = 120;
    const now = Date.now();
    // Prune expired buckets so the map can't grow unbounded.
    if (invRateWindow.size > 5000) {
        for (const [k, v] of invRateWindow) if (now > v.resetAt) invRateWindow.delete(k);
    }
    const key = req.ip || 'unknown';
    let bucket = invRateWindow.get(key);
    if (!bucket || now > bucket.resetAt) {
        bucket = { count: 0, resetAt: now + WINDOW_MS };
        invRateWindow.set(key, bucket);
    }
    bucket.count++;
    res.setHeader('X-RateLimit-Limit', String(MAX));
    res.setHeader('X-RateLimit-Remaining', String(Math.max(0, MAX - bucket.count)));
    res.setHeader('X-RateLimit-Reset', String(Math.ceil(bucket.resetAt / 1000)));
    if (bucket.count > MAX) {
        return res.status(429).json({ success: false, error: 'Rate limit exceeded — try again shortly' });
    }
    next();
}

async function requireInventoryKey(req, res, next) {
    const auth = req.get('authorization') || '';
    const provided = req.get('x-api-key') || (auth.startsWith('Bearer ') ? auth.slice(7) : '');
    if (!provided) {
        return res.status(401).json({ success: false, error: 'Missing API key' });
    }
    // Keys generated in Settings (hashed lookup — plaintext is never stored).
    try {
        const { rows } = await pool.query(
            'SELECT id, name FROM api_keys WHERE key_hash = $1 AND revoked_at IS NULL LIMIT 1',
            [sha256(provided)],
        );
        if (rows[0]) {
            req.apiKey = rows[0];
            pool.query('UPDATE api_keys SET last_used_at = NOW() WHERE id = $1', [rows[0].id]).catch(() => {});
            return next();
        }
    } catch (e) {
        console.error('api key lookup', e);
        return res.status(500).json({ success: false, error: 'Internal error' });
    }
    // Fallback: legacy static env key.
    if (envKeyMatches(provided)) { req.apiKey = { id: null, name: 'env' }; return next(); }
    return res.status(401).json({ success: false, error: 'Invalid or revoked API key' });
}

// ── API key management (admin only, via app SSO — NOT via API key) ───────────
app.get('/api/settings/api-keys', async (req, res) => {
    const user = await surveyRequireAdmin(req, res);
    if (!user) return;
    try {
        const { rows } = await pool.query(
            `SELECT id, name, key_prefix, created_by, created_at, last_used_at, revoked_at
             FROM api_keys ORDER BY revoked_at NULLS FIRST, created_at DESC`,
        );
        res.json({ success: true, data: rows });
    } catch (e) {
        console.error('list api keys', e);
        res.status(500).json({ success: false, error: 'Internal error' });
    }
});

// Creates a key and returns the plaintext ONCE — it cannot be retrieved again.
app.post('/api/settings/api-keys', async (req, res) => {
    const user = await surveyRequireAdmin(req, res);
    if (!user) return;
    const name = String(req.body?.name || '').trim();
    if (!name || name.length > 120) {
        return res.status(400).json({ success: false, error: 'name is required (1–120 characters)' });
    }
    try {
        const { key, hash, prefix } = generateApiKey();
        const { rows } = await pool.query(
            `INSERT INTO api_keys(name, key_prefix, key_hash, created_by)
             VALUES ($1,$2,$3,$4)
             RETURNING id, name, key_prefix, created_by, created_at, last_used_at, revoked_at`,
            [name, prefix, hash, user.email || user.name || null],
        );
        res.status(201).json({ success: true, data: { ...rows[0], key } });
    } catch (e) {
        console.error('create api key', e);
        res.status(500).json({ success: false, error: 'Internal error' });
    }
});

// Revoke (soft-delete so the audit trail survives).
app.delete('/api/settings/api-keys/:id', async (req, res) => {
    const user = await surveyRequireAdmin(req, res);
    if (!user) return;
    try {
        const { rows } = await pool.query(
            'UPDATE api_keys SET revoked_at = NOW() WHERE id = $1 AND revoked_at IS NULL RETURNING id',
            [req.params.id],
        );
        if (!rows[0]) return res.status(404).json({ success: false, error: 'Key not found or already revoked' });
        res.json({ success: true, data: { id: rows[0].id, revoked: true } });
    } catch (e) {
        console.error('revoke api key', e);
        res.status(500).json({ success: false, error: 'Internal error' });
    }
});

// Read-only guard: reject any write verb on this namespace outright.
app.use('/api/v1/inventory', (req, res, next) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
        return res.status(405).set('Allow', 'GET, HEAD').json({ success: false, error: 'This API is read-only' });
    }
    next();
});
app.use('/api/v1/inventory', inventoryRateLimit, requireInventoryKey);

// Explicit column whitelist = a stable public contract (no SELECT *).
//
// employee_id: assets.employee_id is only filled in for a handful of rows, so fall
// back to the employee master (iso_survey_employees) matched on the holder's full
// name. A scalar subquery is used rather than a JOIN so that unqualified filters in
// the WHERE clause stay unambiguous (both tables have department/id/created_at) and
// duplicate names can never multiply rows.
const INVENTORY_FIELDS = `id, asset_id, group_name, type_name, description, serial_number,
    brand_model, responsibility, holder,
    COALESCE(NULLIF(assets.employee_id, ''), (
        SELECT e.employee_code FROM iso_survey_employees e
        WHERE LOWER(TRIM(e.first_name || ' ' || e.last_name)) = LOWER(TRIM(assets.holder))
        ORDER BY e.is_active DESC NULLS LAST, e.employee_code
        LIMIT 1
    )) AS employee_id,
    owner, building, floor, department,
    sub_section, status, notes, updated_date, created_at, updated_at`;

/**
 * Attach related records to a page of assets so callers get the COMPLETE record
 * (transfer history + maintenance schedule and every check). Batched by asset id
 * — one query per relation, never N+1.
 *   ?include=transfers,maintenance   or   ?include=all
 */
async function attachInventoryRelations(assetRows, includeParam) {
    const want = String(includeParam || '').toLowerCase().split(',').map(s => s.trim()).filter(Boolean);
    const all = want.includes('all');
    const wantTransfers = all || want.includes('transfers');
    const wantMaintenance = all || want.includes('maintenance');
    if ((!wantTransfers && !wantMaintenance) || !assetRows.length) return assetRows;

    const ids = assetRows.map(a => a.id);
    const byId = new Map(assetRows.map(a => [a.id, a]));

    if (wantTransfers) {
        assetRows.forEach(a => { a.transfers = []; });
        const { rows } = await pool.query(
            `SELECT id, asset_id, from_holder, to_holder, reason, transferred_at, created_by
             FROM asset_transfers WHERE asset_id = ANY($1) ORDER BY transferred_at DESC`,
            [ids],
        );
        for (const t of rows) {
            const a = byId.get(t.asset_id);
            if (a) a.transfers.push({ id: t.id, from_holder: t.from_holder, to_holder: t.to_holder, reason: t.reason, transferred_at: t.transferred_at, created_by: t.created_by });
        }
    }

    if (wantMaintenance) {
        assetRows.forEach(a => { a.maintenance = { schedule: null, checks: [] }; });
        const [settings, checks] = await Promise.all([
            pool.query('SELECT asset_id, start_date, hidden, created_at, updated_at FROM ma_asset_settings WHERE asset_id = ANY($1)', [ids]),
            pool.query(
                `SELECT id, asset_id, plan, item_seq, round_no, due_date, condition, remark,
                        checked_by, checked_at, resolution_condition, resolution_remark, resolved_by, resolved_at
                 FROM ma_checks WHERE asset_id = ANY($1) ORDER BY due_date ASC, item_seq ASC, round_no ASC`,
                [ids],
            ),
        ]);
        for (const s of settings.rows) {
            const a = byId.get(s.asset_id);
            if (a) a.maintenance.schedule = { start_date: s.start_date, hidden: s.hidden, created_at: s.created_at, updated_at: s.updated_at };
        }
        for (const c of checks.rows) {
            const a = byId.get(c.asset_id);
            if (!a) continue;
            const { asset_id: _omit, ...rest } = c;
            a.maintenance.checks.push(rest);
        }
    }
    return assetRows;
}

app.get('/api/v1/inventory', (_req, res) => {
    res.json({
        success: true,
        data: {
            version: 'v1',
            access: 'read-only',
            endpoints: [
                { method: 'GET', path: '/api/v1/inventory/assets', description: 'List assets', query: ['group_name', 'type_name', 'status', 'holder', 'department', 'search', 'limit (max 1000)', 'offset', 'include=transfers,maintenance | all'] },
                { method: 'GET', path: '/api/v1/inventory/assets/:id', description: 'Single asset by asset_id (e.g. NB001) or uuid — returns the full record (transfers + maintenance) by default' },
                { method: 'GET', path: '/api/v1/inventory/summary', description: 'Counts by group / type / status' },
            ],
        },
    });
});

app.get('/api/v1/inventory/assets', async (req, res) => {
    const { group_name, type_name, status, holder, department, search } = req.query;
    // Clamp pagination so a caller can't request an unbounded result set.
    const limit = Math.min(Math.max(parseInt(String(req.query.limit ?? '100'), 10) || 100, 1), 1000);
    const offset = Math.max(parseInt(String(req.query.offset ?? '0'), 10) || 0, 0);

    const params = [];
    let where = ' WHERE 1=1';
    if (group_name) { params.push(group_name); where += ` AND group_name = $${params.length}`; }
    if (type_name)  { params.push(type_name);  where += ` AND type_name = $${params.length}`; }
    if (status)     { params.push(status);     where += ` AND status = $${params.length}`; }
    if (holder)     { params.push(holder);     where += ` AND holder = $${params.length}`; }
    if (department) { params.push(department); where += ` AND department = $${params.length}`; }
    if (search) {
        params.push(`%${search}%`);
        const i = params.length;
        where += ` AND (asset_id ILIKE $${i} OR description ILIKE $${i} OR serial_number ILIKE $${i}
                        OR brand_model ILIKE $${i} OR holder ILIKE $${i} OR department ILIKE $${i})`;
    }
    try {
        const countQ = pool.query(`SELECT COUNT(*)::int AS total FROM assets${where}`, params);
        const dataQ = pool.query(
            `SELECT ${INVENTORY_FIELDS} FROM assets${where}
             ORDER BY group_name, type_name, asset_id ASC
             LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
            [...params, limit, offset],
        );
        const [{ rows: countRows }, { rows }] = await Promise.all([countQ, dataQ]);
        await attachInventoryRelations(rows, req.query.include);
        res.json({ success: true, data: rows, meta: { total: countRows[0].total, limit, offset, count: rows.length } });
    } catch (e) {
        console.error('inventory assets', e);
        res.status(500).json({ success: false, error: 'Internal error' });
    }
});

app.get('/api/v1/inventory/summary', async (_req, res) => {
    try {
        const [total, byGroup, byType, byStatus] = await Promise.all([
            pool.query('SELECT COUNT(*)::int AS total FROM assets'),
            pool.query('SELECT group_name, COUNT(*)::int AS count FROM assets GROUP BY group_name ORDER BY count DESC'),
            pool.query('SELECT type_name, COUNT(*)::int AS count FROM assets GROUP BY type_name ORDER BY count DESC'),
            pool.query('SELECT status, COUNT(*)::int AS count FROM assets GROUP BY status ORDER BY count DESC'),
        ]);
        res.json({
            success: true,
            data: {
                total: total.rows[0].total,
                by_group: byGroup.rows,
                by_type: byType.rows,
                by_status: byStatus.rows,
            },
        });
    } catch (e) {
        console.error('inventory summary', e);
        res.status(500).json({ success: false, error: 'Internal error' });
    }
});

app.get('/api/v1/inventory/assets/:id', async (req, res) => {
    const { id } = req.params;
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
    try {
        const { rows } = await pool.query(
            `SELECT ${INVENTORY_FIELDS} FROM assets WHERE ${isUuid ? 'id = $1' : 'asset_id = $1'} LIMIT 1`,
            [id],
        );
        if (!rows[0]) return res.status(404).json({ success: false, error: 'Asset not found' });
        // A single asset always returns the complete record unless narrowed.
        await attachInventoryRelations(rows, req.query.include ?? 'all');
        res.json({ success: true, data: rows[0] });
    } catch (e) {
        console.error('inventory asset', e);
        res.status(500).json({ success: false, error: 'Internal error' });
    }
});

// ════════════════════════════════════════════════════════════════════════════
// TRAINING / EXAM SYSTEM
// ════════════════════════════════════════════════════════════════════════════

// Generate a human-friendly, unambiguous exam code (no 0/O/1/I/L).
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
function genExamCode(len = 8) {
    const bytes = randomBytes(len);
    let out = '';
    for (let i = 0; i < len; i++) out += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
    return out;
}

// Fisher–Yates shuffle returning a new array (never mutates input).
function shuffled(arr) {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
}

// Normalise a stored question row into a snapshot question (choices reshuffled
// per exam config). Correct flags are RETAINED here (server-side answer key).
function buildSnapshotQuestion(row, shuffleChoices) {
    const choices = Array.isArray(row.choices) ? row.choices : [];
    const ordered = shuffleChoices ? shuffled(choices) : choices;
    return {
        id: row.id,
        text: row.text,
        type: row.type,
        points: Number(row.points) || 1,
        choices: ordered.map(c => ({ text: c.text, correct: !!c.correct })),
    };
}

// Strip correct flags before sending a snapshot to the candidate.
function stripAnswerKey(snapshot) {
    return {
        questions: (snapshot.questions || []).map(q => ({
            id: q.id, text: q.text, type: q.type, points: q.points,
            choices: q.choices.map(c => ({ text: c.text })),
        })),
    };
}

// Grade answers against a snapshot. answers = { [questionId]: number[] } where
// numbers are selected choice indices in the presented order.
function gradeSnapshot(snapshot, answers) {
    const a = answers && typeof answers === 'object' ? answers : {};
    let score = 0, maxScore = 0;
    for (const q of snapshot.questions || []) {
        const pts = Number(q.points) || 1;
        maxScore += pts;
        const correctIdx = q.choices.map((c, i) => (c.correct ? i : -1)).filter(i => i >= 0);
        const selected = Array.isArray(a[q.id]) ? a[q.id].map(Number).filter(n => Number.isInteger(n)) : [];
        const selSet = new Set(selected);
        const isExact = correctIdx.length === selSet.size && correctIdx.every(i => selSet.has(i));
        if (isExact && correctIdx.length > 0) score += pts;
    }
    const percent = maxScore > 0 ? Math.round((score / maxScore) * 10000) / 100 : 0;
    return { score, maxScore, percent };
}

function buildExamEmailHtml(name, examTitle, code, examUrl, durationMinutes) {
    // Bulletproof for light/dark email clients: every colored surface uses a
    // solid `bgcolor` attribute (not just CSS) so text never ends up light-on-white
    // when gradients/CSS backgrounds are stripped, and color-scheme is pinned to
    // light to stop clients auto-inverting the palette.
    return `<!DOCTYPE html><html lang="th"><head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light only">
<meta name="supported-color-schemes" content="light">
<title>แบบทดสอบ</title></head>
<body style="margin:0;padding:0;background-color:#F0F4FF;font-family:'Sarabun',Arial,sans-serif;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" bgcolor="#F0F4FF" style="background-color:#F0F4FF;">
<tr><td align="center" style="padding:32px 16px;">
<table role="presentation" width="560" cellpadding="0" cellspacing="0" bgcolor="#FFFFFF" style="background-color:#FFFFFF;border-radius:16px;overflow:hidden;max-width:560px;border:1px solid #E5E7EB;">
<tr><td bgcolor="#1D4ED8" align="left" style="background-color:#1D4ED8;background-image:linear-gradient(135deg,#1D4ED8,#3B82F6);padding:28px 36px;">
<p style="margin:0;color:#FFFFFF;font-size:20px;font-weight:800;">แบบทดสอบออนไลน์</p>
<p style="margin:6px 0 0;color:#DBEAFE;font-size:14px;">${examTitle}</p>
</td></tr>
<tr><td bgcolor="#FFFFFF" style="background-color:#FFFFFF;padding:32px 36px;">
<p style="margin:0 0 12px;color:#111827;font-size:15px;">เรียน ${name || 'ผู้เข้าสอบ'},</p>
<p style="margin:0 0 20px;color:#374151;font-size:14px;line-height:1.7;">คุณได้รับเชิญให้ทำแบบทดสอบ <b style="color:#111827;">${examTitle}</b> (เวลาในการทำ ${durationMinutes} นาที) กรุณาใช้รหัสด้านล่างเพื่อเข้าสู่ระบบทดสอบ</p>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 20px;"><tr><td align="center" bgcolor="#EFF6FF" style="background-color:#EFF6FF;border:2px dashed #93C5FD;border-radius:12px;padding:18px;">
<p style="margin:0 0 4px;color:#2563EB;font-size:11px;font-weight:700;letter-spacing:2px;">รหัสเข้าสอบ (EXAM CODE)</p>
<p style="margin:0;color:#1D4ED8;font-size:32px;font-weight:800;letter-spacing:6px;font-family:'Courier New',monospace;">${code}</p>
</td></tr></table>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">
<a href="${examUrl}" style="display:inline-block;background-color:#2563EB;color:#FFFFFF;text-decoration:none;font-weight:700;font-size:15px;padding:13px 40px;border-radius:10px;">เริ่มทำแบบทดสอบ</a>
</td></tr></table>
<p style="margin:22px 0 0;color:#6B7280;font-size:12px;line-height:1.6;">⚠️ การทำแบบทดสอบจะทำในโหมดเต็มจอ ห้ามสลับหน้าจอหรือออกจากหน้าต่าง หากละเมิดเกินจำนวนที่กำหนด ระบบจะส่งคำตอบทันที</p>
</td></tr></table>
</td></tr></table></body></html>`;
}

async function sendExamEmail(to, name, examTitle, code, durationMinutes, senderEmail) {
    const baseUrl = process.env.SURVEY_FRONTEND_URL || 'https://opsone.tenfw.com';
    const examUrl = `${baseUrl}/exam?code=${encodeURIComponent(code)}`;
    const resolved = getSurveyTransporter(senderEmail);
    if (!resolved) throw new Error(`SMTP account not found for: ${senderEmail || 'default'}`);
    const { transporter, account } = resolved;
    await transporter.sendMail({
        from: `"Training System" <${account.email}>`,
        to,
        subject: `แบบทดสอบ: ${examTitle} — รหัสเข้าสอบ ${code}`,
        html: buildExamEmailHtml(name, examTitle, code, examUrl, durationMinutes),
    });
}

// ── Admin: Question bank ──────────────────────────────────────────────────────
app.get('/api/training/questions', async (req, res) => {
    const user = await surveyRequireAdmin(req, res); if (!user) return;
    try {
        const { category } = req.query;
        const params = [];
        let where = '';
        if (category) { params.push(category); where = `WHERE category = $1`; }
        const { rows } = await pool.query(
            `SELECT id, text, type, points, choices, category, source, active, created_at
             FROM training_questions ${where} ORDER BY created_at ASC`, params);
        res.json({ success: true, data: rows });
    } catch (e) { console.error('training questions', e); res.status(500).json({ error: 'Internal error' }); }
});

app.get('/api/training/categories', async (req, res) => {
    const user = await surveyRequireAdmin(req, res); if (!user) return;
    try {
        const { rows } = await pool.query(
            `SELECT COALESCE(category,'') AS category, COUNT(*)::int AS count
             FROM training_questions WHERE active GROUP BY category ORDER BY category`);
        res.json({ success: true, data: rows });
    } catch (e) { console.error('training categories', e); res.status(500).json({ error: 'Internal error' }); }
});

// Strip a leading source question-number prefix like "4. |  " or "170. | " that
// some import files embed in the text. We renumber questions ourselves, so the
// baked-in number is noise (would render as e.g. "1. 4. | ...").
function stripQuestionNumber(text) {
    return String(text).replace(/^\s*\d+\s*\.\s*\|\s*/, '').trim();
}

function normaliseQuestionInput(q) {
    // Accepts both the native shape { text, type, points, choices:[{text,correct}] }
    // and the import shape { question, type:'MULTIPLE_CHOICE'|'CHECKBOX', choices:[{answer,correct}], points }.
    const text = stripQuestionNumber(String(q.text ?? q.question ?? '').trim());
    const rawChoices = Array.isArray(q.choices) ? q.choices : [];
    const choices = rawChoices.map(c => ({
        text: String(c.text ?? c.answer ?? '').trim(),
        correct: !!c.correct,
    })).filter(c => c.text);
    const correctCount = choices.filter(c => c.correct).length;
    let type = q.type;
    if (type === 'MULTIPLE_CHOICE') type = 'SINGLE';
    else if (type === 'CHECKBOX') type = 'MULTI';
    if (type !== 'SINGLE' && type !== 'MULTI') type = correctCount > 1 ? 'MULTI' : 'SINGLE';
    const points = Math.max(1, parseInt(q.points, 10) || 1);
    return { text, type, points, choices };
}

app.post('/api/training/questions', async (req, res) => {
    const user = await surveyRequireAdmin(req, res); if (!user) return;
    try {
        const { text, type, points, choices } = normaliseQuestionInput(req.body || {});
        const category = req.body?.category ? String(req.body.category).trim() : null;
        if (!text) return res.status(400).json({ error: 'กรุณากรอกโจทย์' });
        if (choices.length < 2) return res.status(400).json({ error: 'ต้องมีตัวเลือกอย่างน้อย 2 ข้อ' });
        if (!choices.some(c => c.correct)) return res.status(400).json({ error: 'ต้องระบุคำตอบที่ถูกอย่างน้อย 1 ข้อ' });
        const { rows } = await pool.query(
            `INSERT INTO training_questions(text, type, points, choices, category, source)
             VALUES($1,$2,$3,$4::jsonb,$5,$6) RETURNING *`,
            [text, type, points, JSON.stringify(choices), category, req.body?.source || null]);
        res.json({ success: true, data: rows[0] });
    } catch (e) { console.error('create training question', e); res.status(500).json({ error: 'Internal error' }); }
});

app.put('/api/training/questions/:id', async (req, res) => {
    const user = await surveyRequireAdmin(req, res); if (!user) return;
    try {
        const { text, type, points, choices } = normaliseQuestionInput(req.body || {});
        const category = req.body?.category ? String(req.body.category).trim() : null;
        if (!text) return res.status(400).json({ error: 'กรุณากรอกโจทย์' });
        if (choices.length < 2) return res.status(400).json({ error: 'ต้องมีตัวเลือกอย่างน้อย 2 ข้อ' });
        if (!choices.some(c => c.correct)) return res.status(400).json({ error: 'ต้องระบุคำตอบที่ถูกอย่างน้อย 1 ข้อ' });
        const { rows } = await pool.query(
            `UPDATE training_questions SET text=$1, type=$2, points=$3, choices=$4::jsonb, category=$5, updated_at=NOW()
             WHERE id=$6 RETURNING *`,
            [text, type, points, JSON.stringify(choices), category, req.params.id]);
        if (!rows[0]) return res.status(404).json({ error: 'ไม่พบคำถาม' });
        res.json({ success: true, data: rows[0] });
    } catch (e) { console.error('update training question', e); res.status(500).json({ error: 'Internal error' }); }
});

app.delete('/api/training/questions/:id', async (req, res) => {
    const user = await surveyRequireAdmin(req, res); if (!user) return;
    try {
        await pool.query(`DELETE FROM training_questions WHERE id=$1`, [req.params.id]);
        res.json({ success: true });
    } catch (e) { console.error('delete training question', e); res.status(500).json({ error: 'Internal error' }); }
});

app.post('/api/training/questions/import', async (req, res) => {
    const user = await surveyRequireAdmin(req, res); if (!user) return;
    try {
        const list = Array.isArray(req.body?.questions) ? req.body.questions : [];
        const category = req.body?.category ? String(req.body.category).trim() : null;
        const source = req.body?.source ? String(req.body.source).trim() : null;
        if (!list.length) return res.status(400).json({ error: 'ไม่มีคำถามให้นำเข้า' });
        const client = await pool.connect();
        let inserted = 0;
        try {
            await client.query('BEGIN');
            for (const raw of list) {
                const q = normaliseQuestionInput(raw);
                if (!q.text || q.choices.length < 2 || !q.choices.some(c => c.correct)) continue;
                await client.query(
                    `INSERT INTO training_questions(text, type, points, choices, category, source)
                     VALUES($1,$2,$3,$4::jsonb,$5,$6)`,
                    [q.text, q.type, q.points, JSON.stringify(q.choices), category, source]);
                inserted++;
            }
            await client.query('COMMIT');
        } catch (e) { await client.query('ROLLBACK'); throw e; }
        finally { client.release(); }
        res.json({ success: true, data: { inserted } });
    } catch (e) { console.error('import training questions', e); res.status(500).json({ error: 'Internal error' }); }
});

// ── Admin: Exams ──────────────────────────────────────────────────────────────
app.get('/api/training/exams', async (req, res) => {
    const user = await surveyRequireAdmin(req, res); if (!user) return;
    try {
        const { rows } = await pool.query(`
            SELECT e.*,
              (SELECT COUNT(*)::int FROM training_questions q
                 WHERE q.active AND (e.category IS NULL OR q.category = e.category)) AS pool_size,
              (SELECT COUNT(*)::int FROM training_codes c WHERE c.exam_id = e.id) AS invited,
              (SELECT COUNT(*)::int FROM training_codes c WHERE c.exam_id = e.id AND c.status='SUBMITTED') AS submitted
            FROM training_exams e ORDER BY e.created_at DESC`);
        res.json({ success: true, data: rows });
    } catch (e) { console.error('training exams', e); res.status(500).json({ error: 'Internal error' }); }
});

app.get('/api/training/exams/:id', async (req, res) => {
    const user = await surveyRequireAdmin(req, res); if (!user) return;
    try {
        const { rows } = await pool.query(`
            SELECT e.*,
              (SELECT COUNT(*)::int FROM training_questions q
                 WHERE q.active AND (e.category IS NULL OR q.category = e.category)) AS pool_size
            FROM training_exams e WHERE e.id=$1`, [req.params.id]);
        if (!rows[0]) return res.status(404).json({ error: 'ไม่พบแบบทดสอบ' });
        res.json({ success: true, data: rows[0] });
    } catch (e) { console.error('get training exam', e); res.status(500).json({ error: 'Internal error' }); }
});

function normaliseExamInput(b) {
    return {
        title: String(b?.title ?? '').trim(),
        description: String(b?.description ?? '').trim(),
        category: b?.category ? String(b.category).trim() : null,
        shuffle_questions: b?.shuffle_questions !== false,
        shuffle_choices: b?.shuffle_choices !== false,
        question_count: Math.max(1, parseInt(b?.question_count, 10) || 1),
        pass_percent: Math.min(100, Math.max(0, parseInt(b?.pass_percent, 10) || 70)),
        duration_minutes: Math.max(1, parseInt(b?.duration_minutes, 10) || 60),
        max_violations: Math.max(0, parseInt(b?.max_violations, 10) || 3),
        status: b?.status === 'PUBLISHED' ? 'PUBLISHED' : 'DRAFT',
    };
}

app.post('/api/training/exams', async (req, res) => {
    const user = await surveyRequireAdmin(req, res); if (!user) return;
    try {
        const e = normaliseExamInput(req.body || {});
        if (!e.title) return res.status(400).json({ error: 'กรุณากรอกชื่อแบบทดสอบ' });
        const { rows } = await pool.query(
            `INSERT INTO training_exams(title, description, category, shuffle_questions, shuffle_choices,
                question_count, pass_percent, duration_minutes, max_violations, status, created_by)
             VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
            [e.title, e.description, e.category, e.shuffle_questions, e.shuffle_choices,
             e.question_count, e.pass_percent, e.duration_minutes, e.max_violations, e.status,
             user.email || user.name || null]);
        res.json({ success: true, data: rows[0] });
    } catch (e) { console.error('create training exam', e); res.status(500).json({ error: 'Internal error' }); }
});

app.put('/api/training/exams/:id', async (req, res) => {
    const user = await surveyRequireAdmin(req, res); if (!user) return;
    try {
        const e = normaliseExamInput(req.body || {});
        if (!e.title) return res.status(400).json({ error: 'กรุณากรอกชื่อแบบทดสอบ' });
        const { rows } = await pool.query(
            `UPDATE training_exams SET title=$1, description=$2, category=$3, shuffle_questions=$4,
                shuffle_choices=$5, question_count=$6, pass_percent=$7, duration_minutes=$8,
                max_violations=$9, status=$10, updated_at=NOW() WHERE id=$11 RETURNING *`,
            [e.title, e.description, e.category, e.shuffle_questions, e.shuffle_choices,
             e.question_count, e.pass_percent, e.duration_minutes, e.max_violations, e.status, req.params.id]);
        if (!rows[0]) return res.status(404).json({ error: 'ไม่พบแบบทดสอบ' });
        res.json({ success: true, data: rows[0] });
    } catch (e) { console.error('update training exam', e); res.status(500).json({ error: 'Internal error' }); }
});

app.delete('/api/training/exams/:id', async (req, res) => {
    const user = await surveyRequireAdmin(req, res); if (!user) return;
    try {
        await pool.query(`DELETE FROM training_exams WHERE id=$1`, [req.params.id]);
        res.json({ success: true });
    } catch (e) { console.error('delete training exam', e); res.status(500).json({ error: 'Internal error' }); }
});

// ── Admin: Senders (reuse survey SMTP accounts) ───────────────────────────────
app.get('/api/training/senders', async (req, res) => {
    const user = await surveyRequireAdmin(req, res); if (!user) return;
    res.json({ success: true, data: surveySmtpAccounts.map(a => ({ email: a.email, label: a.label })) });
});

// ── Admin: Employee directory (source for the recipient picker) ───────────────
app.get('/api/training/employees', async (req, res) => {
    const user = await surveyRequireAdmin(req, res); if (!user) return;
    try {
        const { rows } = await pool.query(
            `SELECT id, TRIM(first_name || ' ' || last_name) AS name, email,
                    COALESCE(NULLIF(department,''),'อื่นๆ') AS department,
                    employee_code AS "employeeId"
             FROM iso_survey_employees
             WHERE is_active AND email IS NOT NULL AND email <> ''
             ORDER BY department, first_name, last_name`);
        res.json({ success: true, data: rows });
    } catch (e) { console.error('training employees', e); res.status(500).json({ error: 'Internal error' }); }
});

// ── Admin: Invite candidates (generate codes + send email) ────────────────────
app.post('/api/training/exams/:id/invite', async (req, res) => {
    const user = await surveyRequireAdmin(req, res); if (!user) return;
    try {
        const { recipients, senderEmail } = req.body || {};
        if (!Array.isArray(recipients) || recipients.length === 0)
            return res.status(400).json({ error: 'กรุณาระบุผู้รับอย่างน้อย 1 คน' });
        if (senderEmail && !surveySmtpAccounts.find(a => a.email === senderEmail))
            return res.status(400).json({ error: `ไม่พบบัญชีส่ง Email: ${senderEmail}` });

        const exR = await pool.query(`SELECT * FROM training_exams WHERE id=$1`, [req.params.id]);
        const exam = exR.rows[0];
        if (!exam) return res.status(404).json({ error: 'ไม่พบแบบทดสอบ' });

        const poolR = await pool.query(
            `SELECT COUNT(*)::int AS n FROM training_questions
             WHERE active AND ($1::text IS NULL OR category = $1)`, [exam.category]);
        if (poolR.rows[0].n < 1)
            return res.status(400).json({ error: 'คลังคำถามของหมวดนี้ว่างเปล่า — เพิ่มคำถามก่อนส่ง' });

        // De-duplicate recipients within this request by email.
        const seen = new Set();
        const uniqueRecipients = [];
        for (const r of recipients) {
            const email = String(r.email || '').trim().toLowerCase();
            if (!email || seen.has(email)) continue;
            seen.add(email);
            uniqueRecipients.push({ email: String(r.email).trim(), name: String(r.name || '').trim() });
        }

        const results = [];
        for (const r of uniqueRecipients) {
            const { email, name } = r;
            try {
                // Re-inviting the same person is normal, not an error: reuse an
                // existing not-yet-submitted code (resend the same code); only skip
                // if they have already completed this exam (one attempt per code).
                const existingR = await pool.query(
                    `SELECT * FROM training_codes WHERE exam_id=$1 AND LOWER(candidate_email)=LOWER($2)
                     ORDER BY created_at DESC LIMIT 1`, [exam.id, email]);
                const existing = existingR.rows[0];

                if (existing && existing.status === 'SUBMITTED') {
                    results.push({ email, ok: false, skipped: true, error: 'ทำข้อสอบไปแล้ว (ไม่ส่งซ้ำ)' });
                    continue;
                }

                let code, codeRow;
                if (existing) {
                    // Resend the existing code; refresh name/sender.
                    code = existing.code;
                    const upd = await pool.query(
                        `UPDATE training_codes SET candidate_name=$1, sender_email=$2 WHERE id=$3 RETURNING *`,
                        [name, senderEmail || null, existing.id]);
                    codeRow = upd.rows[0];
                } else {
                    // Generate a unique code (retry on collision).
                    for (let attempt = 0; attempt < 6 && !codeRow; attempt++) {
                        const candidate = genExamCode();
                        try {
                            const ins = await pool.query(
                                `INSERT INTO training_codes(exam_id, code, candidate_name, candidate_email, sender_email, status)
                                 VALUES($1,$2,$3,$4,$5,'PENDING') RETURNING *`,
                                [exam.id, candidate, name, email, senderEmail || null]);
                            code = candidate; codeRow = ins.rows[0];
                        } catch (err) { if (err.code !== '23505') throw err; }
                    }
                    if (!codeRow) { results.push({ email, ok: false, error: 'สร้างรหัสไม่สำเร็จ' }); continue; }
                }

                await sendExamEmail(email, name, exam.title, code, exam.duration_minutes, senderEmail);
                await pool.query(`UPDATE training_codes SET status='SENT', sent_at=NOW() WHERE id=$1`, [codeRow.id]);
                results.push({ email, ok: true, code, resent: !!existing });
            } catch (err) {
                console.error('[exam invite] failed for', email, '-', err.message);
                results.push({ email, ok: false, error: `ส่งอีเมลไม่สำเร็จ: ${err.message}` });
            }
        }
        res.json({ success: true, data: { sent: results.filter(r => r.ok).length, results } });
    } catch (e) { console.error('invite training', e); res.status(500).json({ error: 'Internal error' }); }
});

// ── Admin: Results ────────────────────────────────────────────────────────────
app.get('/api/training/exams/:id/results', async (req, res) => {
    const user = await surveyRequireAdmin(req, res); if (!user) return;
    try {
        const { rows } = await pool.query(
            `SELECT id, code, candidate_name, candidate_email, status, sent_at, started_at, submitted_at,
                    violations, score, max_score, percent, passed, submit_reason
             FROM training_codes WHERE exam_id=$1 ORDER BY created_at DESC`, [req.params.id]);
        res.json({ success: true, data: rows });
    } catch (e) { console.error('training results', e); res.status(500).json({ error: 'Internal error' }); }
});

app.get('/api/training/codes/:id', async (req, res) => {
    const user = await surveyRequireAdmin(req, res); if (!user) return;
    try {
        const { rows } = await pool.query(`SELECT * FROM training_codes WHERE id=$1`, [req.params.id]);
        if (!rows[0]) return res.status(404).json({ error: 'ไม่พบข้อมูล' });
        res.json({ success: true, data: rows[0] });
    } catch (e) { console.error('training code detail', e); res.status(500).json({ error: 'Internal error' }); }
});

app.delete('/api/training/codes/:id', async (req, res) => {
    const user = await surveyRequireAdmin(req, res); if (!user) return;
    try {
        await pool.query(`DELETE FROM training_codes WHERE id=$1`, [req.params.id]);
        res.json({ success: true });
    } catch (e) { console.error('delete training code', e); res.status(500).json({ error: 'Internal error' }); }
});

// ════════════════════════════════════════════════════════════════════════════
// PUBLIC EXAM API (code-gated, NO SSO). Correct answers never leave the server
// until after submission; grading, deadline and violation counts are authoritative.
// ════════════════════════════════════════════════════════════════════════════

// Simple in-memory rate limit for code-start attempts (brute-force guard).
const examStartHits = new Map();
function examRateLimited(ip) {
    const now = Date.now();
    const windowMs = 60_000, max = 20;
    const rec = examStartHits.get(ip) || { count: 0, reset: now + windowMs };
    if (now > rec.reset) { rec.count = 0; rec.reset = now + windowMs; }
    rec.count++; examStartHits.set(ip, rec);
    return rec.count > max;
}

async function finalizeSubmit(codeRow, answers, reason) {
    const snapshot = codeRow.questions_snapshot || { questions: [] };
    const { score, maxScore, percent } = gradeSnapshot(snapshot, answers);
    const exR = await pool.query(`SELECT pass_percent FROM training_exams WHERE id=$1`, [codeRow.exam_id]);
    const passPercent = exR.rows[0]?.pass_percent ?? 70;
    const passed = percent >= passPercent;
    await pool.query(
        `UPDATE training_codes SET status='SUBMITTED', answers=$1::jsonb, submitted_at=NOW(),
            score=$2, max_score=$3, percent=$4, passed=$5, submit_reason=$6 WHERE id=$7`,
        [JSON.stringify(answers || {}), score, maxScore, percent, passed, reason, codeRow.id]);
    return { score, maxScore, percent, passed, passPercent };
}

// Preview an exam by code WITHOUT starting it (no snapshot, no timer). Powers
// the lobby screen where the candidate reviews details before pressing start.
app.post('/api/exam/info', async (req, res) => {
    try {
        if (examRateLimited(req.ip)) return res.status(429).json({ error: 'พยายามมากเกินไป กรุณารอสักครู่' });
        const code = String(req.body?.code || '').trim().toUpperCase();
        if (!code) return res.status(400).json({ error: 'กรุณากรอกรหัสเข้าสอบ' });
        const cR = await pool.query(`SELECT * FROM training_codes WHERE code=$1`, [code]);
        const row = cR.rows[0];
        if (!row) return res.status(404).json({ error: 'รหัสเข้าสอบไม่ถูกต้อง' });
        const exR = await pool.query(`SELECT * FROM training_exams WHERE id=$1`, [row.exam_id]);
        const exam = exR.rows[0];
        if (!exam) return res.status(404).json({ error: 'ไม่พบแบบทดสอบ' });

        // Already submitted → surface the result so revisiting shows the score.
        if (row.status === 'SUBMITTED') {
            return res.json({ success: true, status: 'SUBMITTED', candidateName: row.candidate_name, result: {
                score: Number(row.score), maxScore: Number(row.max_score), percent: Number(row.percent),
                passed: row.passed, passPercent: exam.pass_percent, violations: row.violations, reason: row.submit_reason,
            }});
        }

        // Effective question count = min(configured, available in pool).
        const poolR = await pool.query(
            `SELECT COUNT(*)::int AS n FROM training_questions
             WHERE active AND ($1::text IS NULL OR category = $1)`, [exam.category]);
        const questionCount = Math.max(0, Math.min(exam.question_count, poolR.rows[0].n));

        res.json({ success: true, status: row.status, candidateName: row.candidate_name, exam: {
            title: exam.title, description: exam.description || '', category: exam.category,
            questionCount, poolSize: poolR.rows[0].n, durationMinutes: exam.duration_minutes,
            maxViolations: exam.max_violations, passPercent: exam.pass_percent,
        }});
    } catch (e) { console.error('exam info', e); res.status(500).json({ error: 'Internal error' }); }
});

// Start (or resume) an exam sitting.
app.post('/api/exam/start', async (req, res) => {
    try {
        if (examRateLimited(req.ip)) return res.status(429).json({ error: 'พยายามมากเกินไป กรุณารอสักครู่' });
        const code = String(req.body?.code || '').trim().toUpperCase();
        if (!code) return res.status(400).json({ error: 'กรุณากรอกรหัสเข้าสอบ' });
        const cR = await pool.query(`SELECT * FROM training_codes WHERE code=$1`, [code]);
        const row = cR.rows[0];
        if (!row) return res.status(404).json({ error: 'รหัสเข้าสอบไม่ถูกต้อง' });

        const exR = await pool.query(`SELECT * FROM training_exams WHERE id=$1`, [row.exam_id]);
        const exam = exR.rows[0];
        if (!exam) return res.status(404).json({ error: 'ไม่พบแบบทดสอบ' });

        // Already submitted → one attempt only.
        if (row.status === 'SUBMITTED') {
            return res.json({ success: true, status: 'SUBMITTED', result: {
                score: Number(row.score), maxScore: Number(row.max_score), percent: Number(row.percent),
                passed: row.passed, passPercent: exam.pass_percent, violations: row.violations,
                reason: row.submit_reason,
            }});
        }

        // Resume in-progress sitting.
        if (row.status === 'STARTED' && row.questions_snapshot) {
            const deadline = new Date(row.deadline_at).getTime();
            if (Date.now() > deadline) {
                const result = await finalizeSubmit(row, row.answers || {}, 'TIMEOUT');
                return res.json({ success: true, status: 'SUBMITTED', result: { ...result, violations: row.violations, reason: 'TIMEOUT' } });
            }
            return res.json({ success: true, status: 'STARTED', exam: {
                title: exam.title, durationMinutes: exam.duration_minutes, maxViolations: exam.max_violations,
                passPercent: exam.pass_percent,
            }, snapshot: stripAnswerKey(row.questions_snapshot), savedAnswers: row.answers || {},
               violations: row.violations, deadlineAt: row.deadline_at, candidateName: row.candidate_name });
        }

        // Fresh start: draw + shuffle, freeze snapshot.
        const qR = await pool.query(
            `SELECT id, text, type, points, choices FROM training_questions
             WHERE active AND ($1::text IS NULL OR category = $1)`, [exam.category]);
        if (qR.rows.length < 1) return res.status(400).json({ error: 'แบบทดสอบนี้ยังไม่มีคำถาม' });

        const drawCount = Math.min(exam.question_count, qR.rows.length);
        // Randomly draw the subset. When drawing fewer than the pool, always
        // sample randomly so the subset varies; only preserve bank order when
        // taking the whole pool with shuffle disabled.
        const source = (exam.shuffle_questions || drawCount < qR.rows.length) ? shuffled(qR.rows) : qR.rows;
        const picked = source.slice(0, drawCount);
        const snapshot = { questions: picked.map(r => buildSnapshotQuestion(r, exam.shuffle_choices)) };

        const deadlineAt = new Date(Date.now() + exam.duration_minutes * 60_000);
        await pool.query(
            `UPDATE training_codes SET status='STARTED', started_at=NOW(), deadline_at=$1,
                questions_snapshot=$2::jsonb, answers='{}'::jsonb WHERE id=$3`,
            [deadlineAt.toISOString(), JSON.stringify(snapshot), row.id]);

        res.json({ success: true, status: 'STARTED', exam: {
            title: exam.title, durationMinutes: exam.duration_minutes, maxViolations: exam.max_violations,
            passPercent: exam.pass_percent,
        }, snapshot: stripAnswerKey(snapshot), savedAnswers: {}, violations: 0,
           deadlineAt: deadlineAt.toISOString(), candidateName: row.candidate_name });
    } catch (e) { console.error('exam start', e); res.status(500).json({ error: 'Internal error' }); }
});

// Autosave answers (best-effort resilience).
app.post('/api/exam/answer', async (req, res) => {
    try {
        const code = String(req.body?.code || '').trim().toUpperCase();
        const answers = req.body?.answers;
        if (!code || typeof answers !== 'object') return res.status(400).json({ error: 'ข้อมูลไม่ถูกต้อง' });
        const r = await pool.query(
            `UPDATE training_codes SET answers=$1::jsonb WHERE code=$2 AND status='STARTED'`,
            [JSON.stringify(answers), code]);
        res.json({ success: true, saved: r.rowCount > 0 });
    } catch (e) { console.error('exam answer', e); res.status(500).json({ error: 'Internal error' }); }
});

// Record a proctoring violation (server-authoritative count).
app.post('/api/exam/violation', async (req, res) => {
    try {
        const code = String(req.body?.code || '').trim().toUpperCase();
        const kind = String(req.body?.kind || 'blur').slice(0, 40);
        if (!code) return res.status(400).json({ error: 'ข้อมูลไม่ถูกต้อง' });
        const cR = await pool.query(`SELECT c.*, e.max_violations FROM training_codes c
            JOIN training_exams e ON e.id=c.exam_id WHERE c.code=$1`, [code]);
        const row = cR.rows[0];
        if (!row || row.status !== 'STARTED') return res.json({ success: true, violations: row?.violations ?? 0, limitReached: false });
        const log = Array.isArray(row.violation_log) ? row.violation_log : [];
        log.push({ at: new Date().toISOString(), kind });
        const violations = row.violations + 1;
        await pool.query(`UPDATE training_codes SET violations=$1, violation_log=$2::jsonb WHERE id=$3`,
            [violations, JSON.stringify(log), row.id]);
        res.json({ success: true, violations, max: row.max_violations, limitReached: violations >= row.max_violations });
    } catch (e) { console.error('exam violation', e); res.status(500).json({ error: 'Internal error' }); }
});

// Submit (manual, timeout, or violations-exhausted). Server grades.
app.post('/api/exam/submit', async (req, res) => {
    try {
        const code = String(req.body?.code || '').trim().toUpperCase();
        const answers = (req.body?.answers && typeof req.body.answers === 'object') ? req.body.answers : {};
        let reason = String(req.body?.reason || 'MANUAL').toUpperCase();
        if (!['MANUAL', 'TIMEOUT', 'VIOLATIONS'].includes(reason)) reason = 'MANUAL';
        if (!code) return res.status(400).json({ error: 'ข้อมูลไม่ถูกต้อง' });
        const cR = await pool.query(`SELECT * FROM training_codes WHERE code=$1`, [code]);
        const row = cR.rows[0];
        if (!row) return res.status(404).json({ error: 'รหัสเข้าสอบไม่ถูกต้อง' });
        if (row.status === 'SUBMITTED') {
            const exR = await pool.query(`SELECT pass_percent FROM training_exams WHERE id=$1`, [row.exam_id]);
            return res.json({ success: true, alreadySubmitted: true, result: {
                score: Number(row.score), maxScore: Number(row.max_score), percent: Number(row.percent),
                passed: row.passed, passPercent: exR.rows[0]?.pass_percent ?? 70, violations: row.violations,
                reason: row.submit_reason,
            }});
        }
        if (row.status !== 'STARTED' || !row.questions_snapshot)
            return res.status(400).json({ error: 'ยังไม่ได้เริ่มทำแบบทดสอบ' });
        const result = await finalizeSubmit(row, answers, reason);
        res.json({ success: true, result: { ...result, violations: row.violations, reason } });
    } catch (e) { console.error('exam submit', e); res.status(500).json({ error: 'Internal error' }); }
});

// ════════════════════════════════════════════════════════════════════════════
// THAI PUBLIC HOLIDAYS — synced daily from thailandformats.com
// The upstream API is the source of truth (it knows lunar dates and cabinet-
// declared substitution days, which a hand-maintained list always gets wrong).
// ════════════════════════════════════════════════════════════════════════════
const HOLIDAY_API = 'https://thailandformats.com/api/v1/holidays';

// Upstream titles are English; map the stable slugs to the Thai names we display.
const HOLIDAY_TH_BY_SLUG = {
    'new-years-day': 'วันขึ้นปีใหม่',
    'new-years-eve': 'วันสิ้นปี',
    'special-public-holiday': 'วันหยุดพิเศษ',
    'makha-bucha-day': 'วันมาฆบูชา',
    'chakri-memorial-day': 'วันจักรี',
    'songkran-festival': 'วันสงกรานต์',
    'national-labour-day': 'วันแรงงานแห่งชาติ',
    'coronation-day': 'วันฉัตรมงคล',
    'visakha-bucha-day': 'วันวิสาขบูชา',
    'asanha-bucha-day': 'วันอาสาฬหบูชา',
    'buddhist-lent-day': 'วันเข้าพรรษา',
    'constitution-day': 'วันรัฐธรรมนูญ',
    'chulalongkorn-memorial-day': 'วันปิยมหาราช',
    'hm-queen-suthidas-birthday': 'วันเฉลิมพระชนมพรรษา ราชินี',
    'hm-king-maha-vajiralongkorns-birthday': 'วันเฉลิมพระชนมพรรษา ร.10',
    'hm-queen-sirikit-the-queen-mothers-birthday-mothers-day': 'วันแม่แห่งชาติ',
    'hm-king-bhumibol-adulyadej-the-great-memorial-day': 'วันคล้ายวันสวรรคต ร.9',
    'hm-king-bhumibol-adulyadejs-birthday-national-day-fathers-day': 'วันพ่อแห่งชาติ',
    'hm-king-bhumibol-adulyadej-the-greats-birthday-national-day-fathers-day': 'วันพ่อแห่งชาติ',
};

function thaiHolidayName(slug, fallbackTitle) {
    if (!slug) return fallbackTitle || 'วันหยุด';
    if (HOLIDAY_TH_BY_SLUG[slug]) return HOLIDAY_TH_BY_SLUG[slug];
    // "substitution-for-x" → "ชดเชย<ชื่อไทยของ x>"
    if (slug.startsWith('substitution-for-')) {
        const base = slug.slice('substitution-for-'.length);
        if (HOLIDAY_TH_BY_SLUG[base]) return `ชดเชย${HOLIDAY_TH_BY_SLUG[base]}`;
        // Upstream sometimes truncates the base slug — match on prefix.
        const key = Object.keys(HOLIDAY_TH_BY_SLUG).find(k => k.startsWith(base) || base.startsWith(k));
        if (key) return `ชดเชย${HOLIDAY_TH_BY_SLUG[key]}`;
        return 'วันหยุดชดเชย';
    }
    return fallbackTitle || 'วันหยุด';
}

/** Expand [start_date .. end_date] into individual ISO dates. */
function expandHolidayDates(startISO, endISO) {
    const out = [];
    const start = new Date(`${startISO}T00:00:00Z`);
    const end = new Date(`${endISO || startISO}T00:00:00Z`);
    if (isNaN(start) || isNaN(end) || end < start) return startISO ? [startISO] : [];
    for (let d = start; d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
        out.push(d.toISOString().slice(0, 10));
        if (out.length > 40) break;   // guard against a malformed range
    }
    return out;
}

/** Sync one year. Returns the number of days stored, or null when unavailable. */
async function syncHolidayYear(year) {
    let payload;
    try {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 15000);
        const r = await fetch(`${HOLIDAY_API}/${year}`, { signal: ctrl.signal });
        clearTimeout(timer);
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        payload = await r.json();
    } catch (e) {
        console.warn(`[holidays] ${year}: fetch failed — ${e.message} (keeping existing data)`);
        return null;
    }

    const list = Array.isArray(payload?.holidays) ? payload.holidays : [];
    // A year with no data upstream must never wipe what we already have.
    if (list.length === 0) return null;

    const rows = [];
    for (const h of list) {
        for (const date of expandHolidayDates(h.start_date, h.end_date)) {
            rows.push({
                date,
                year,
                name_th: thaiHolidayName(h.slug, h.title),
                name_en: h.title ?? null,
                type: h.type ?? null,
                slug: h.slug ?? null,
            });
        }
    }
    if (rows.length === 0) return null;

    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        // Replace the year wholesale so removed/moved dates disappear.
        await client.query('DELETE FROM thai_holidays WHERE year=$1', [year]);
        for (const r of rows) {
            await client.query(
                `INSERT INTO thai_holidays(date, year, name_th, name_en, type, slug, synced_at)
                 VALUES($1,$2,$3,$4,$5,$6,NOW())
                 ON CONFLICT (date) DO UPDATE SET
                   year=EXCLUDED.year, name_th=EXCLUDED.name_th, name_en=EXCLUDED.name_en,
                   type=EXCLUDED.type, slug=EXCLUDED.slug, synced_at=NOW()`,
                [r.date, r.year, r.name_th, r.name_en, r.type, r.slug],
            );
        }
        await client.query('COMMIT');
        return rows.length;
    } catch (e) {
        await client.query('ROLLBACK');
        console.error(`[holidays] ${year}: DB write failed —`, e.message);
        return null;
    } finally {
        client.release();
    }
}

/** Sync the current year plus the next two, so future dates are covered. */
async function syncThaiHolidays() {
    const thisYear = new Date().getFullYear();
    const years = [thisYear, thisYear + 1, thisYear + 2];
    const results = [];
    for (const y of years) {
        const n = await syncHolidayYear(y);
        if (n !== null) results.push(`${y}:${n}`);
    }
    console.log(`[holidays] sync complete — ${results.length ? results.join(', ') : 'no data updated'}`);
}

// Sync shortly after boot, then once every 24h.
setTimeout(() => { syncThaiHolidays().catch(e => console.error('[holidays]', e.message)); }, 5000);
setInterval(() => { syncThaiHolidays().catch(e => console.error('[holidays]', e.message)); }, 24 * 60 * 60 * 1000);

// Public: the whole holiday map the frontend caches ({ "YYYY-MM-DD": "ชื่อไทย" }).
app.get('/api/holidays', async (req, res) => {
    try {
        const { from, to } = req.query;
        const params = [];
        let where = '';
        if (from) { params.push(from); where += ` AND date >= $${params.length}`; }
        if (to) { params.push(to); where += ` AND date <= $${params.length}`; }
        const { rows } = await pool.query(
            `SELECT to_char(date,'YYYY-MM-DD') AS date, name_th, name_en, type
             FROM thai_holidays WHERE 1=1 ${where} ORDER BY date`, params);
        const map = {};
        for (const r of rows) map[r.date] = r.name_th;
        res.json({ success: true, count: rows.length, data: map, holidays: rows });
    } catch (e) {
        console.error('holidays', e);
        res.status(500).json({ success: false, error: 'Internal error' });
    }
});

// Admin: force an immediate re-sync.
app.post('/api/holidays/sync', async (req, res) => {
    if (!(await surveyRequireAdmin(req, res))) return;
    try {
        await syncThaiHolidays();
        const { rows } = await pool.query('SELECT COUNT(*)::int AS n FROM thai_holidays');
        res.json({ success: true, total: rows[0].n });
    } catch (e) {
        res.status(500).json({ success: false, error: String(e.message) });
    }
});

// ── React SPA static files ────────────────────────────────────────────────────
const distPath = path.join(__dirname, 'dist');
app.use(express.static(distPath, {
    setHeaders(res, filePath) {
        // Hashed assets can be cached aggressively
        if (/\/assets\//.test(filePath)) {
            res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        } else {
            // index.html and other files should not be cached
            res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
        }
    },
}));

// SPA fallback — all unknown routes serve index.html (React Router handles them)
app.get('/{*path}', (req, res) => {
    res.sendFile(path.join(distPath, 'index.html'));
});

// ── HTTP redirect server (port 80 → 443) ─────────────────────────────────────
const httpApp = express();
httpApp.use((req, res) => {
    res.redirect(301, `https://${req.headers.host}${req.url}`);
});

// ── Start servers ─────────────────────────────────────────────────────────────

// HTTPS on 443 — optional (requires SSL cert readable by process)
try {
    const sslOptions = {
        key: fs.readFileSync('/etc/nginx/ssl/opsone.key'),
        cert: fs.readFileSync('/etc/nginx/ssl/opsone.crt'),
    };
    https.createServer(sslOptions, app).listen(HTTPS_PORT, () => {
        console.log(`✅ OpsOne HTTPS server running on port ${HTTPS_PORT}`);
    });
} catch (e) {
    console.warn(`⚠️  HTTPS server skipped (SSL cert not readable): ${e.message}`);
}

// Plain HTTP on 3000 — for reverse proxy (Nginx Proxy Manager / Cloudflare Tunnel)
// X-Forwarded headers are trusted (app.set trust proxy) so protocol/IP are correct
app.listen(PORT, () => {
    console.log(`✅ OpsOne HTTP server running on port ${PORT} (reverse-proxy mode)`);
});

// HTTP on 80 — redirect to HTTPS for direct browser access (requires root)
try {
    httpApp.listen(80, () => {
        console.log(`✅ HTTP redirect server running on port 80 → HTTPS`);
    }).on('error', (e) => {
        console.warn(`⚠️  HTTP redirect server skipped (port 80 not available): ${e.message}`);
    });
} catch (e) {
    console.warn(`⚠️  HTTP redirect server skipped: ${e.message}`);
}
