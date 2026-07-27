// ─── Seed CompTIA Security+ 701 question bank ──────────────────────────────────
// Loads comptia-security+701.json into training_questions under the category
// "CompTIA Security+ 701". Idempotent: skips if that category already has rows.
//
//   node migrations/seed_training_comptia.cjs
//
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

const pool = new Pool({
    host: process.env.DB_HOST || 'localhost',
    port: Number(process.env.DB_PORT) || 5432,
    database: process.env.DB_NAME || 'opsone_db',
    user: process.env.DB_USER || 'opsone',
    password: process.env.DB_PASS,
});

const CATEGORY = 'CompTIA Security+ 701';
const SOURCE = 'comptia-security+701.json';

function normalise(q) {
    const text = String(q.question ?? q.text ?? '').trim();
    const rawChoices = Array.isArray(q.choices) ? q.choices : [];
    const choices = rawChoices
        .map(c => ({ text: String(c.answer ?? c.text ?? '').trim(), correct: !!c.correct }))
        .filter(c => c.text);
    const correctCount = choices.filter(c => c.correct).length;
    let type = q.type;
    if (type === 'MULTIPLE_CHOICE') type = 'SINGLE';
    else if (type === 'CHECKBOX') type = 'MULTI';
    if (type !== 'SINGLE' && type !== 'MULTI') type = correctCount > 1 ? 'MULTI' : 'SINGLE';
    const points = Math.max(1, parseInt(q.points, 10) || 1);
    return { text, type, points, choices };
}

async function ensureTable(c) {
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
}

(async () => {
    const c = await pool.connect();
    try {
        await ensureTable(c);
        const existing = await c.query(
            `SELECT COUNT(*)::int AS n FROM training_questions WHERE category=$1`, [CATEGORY]);
        if (existing.rows[0].n > 0) {
            console.log(`⏭  Category "${CATEGORY}" already has ${existing.rows[0].n} questions — skipping.`);
            return;
        }
        const file = path.join(__dirname, 'comptia-security+701.json');
        const list = JSON.parse(fs.readFileSync(file, 'utf8'));
        console.log(`Loaded ${list.length} questions from ${file}`);

        await c.query('BEGIN');
        let inserted = 0, skipped = 0;
        for (const raw of list) {
            const q = normalise(raw);
            if (!q.text || q.choices.length < 2 || !q.choices.some(x => x.correct)) { skipped++; continue; }
            await c.query(
                `INSERT INTO training_questions(text, type, points, choices, category, source)
                 VALUES($1,$2,$3,$4::jsonb,$5,$6)`,
                [q.text, q.type, q.points, JSON.stringify(q.choices), CATEGORY, SOURCE]);
            inserted++;
        }
        await c.query('COMMIT');
        console.log(`✅ Inserted ${inserted} questions (skipped ${skipped}).`);
    } catch (e) {
        await c.query('ROLLBACK').catch(() => {});
        console.error('❌ Seed failed:', e.message);
        process.exitCode = 1;
    } finally {
        c.release();
        await pool.end();
    }
})();
