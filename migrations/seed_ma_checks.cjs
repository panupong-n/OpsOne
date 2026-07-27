// ─── Seed maintenance checks ───────────────────────────────────────────────────
// Marks every DUE round of every scheduled asset as "ปกติ (ผ่าน)" (normal),
// inspector = "Purich Matchamek". The check date matches each round's due date
// (exact day/month/year); the time is synthesised within working hours.
//
// Round maths mirror src/pages/maintenance/maPlans.ts exactly so the resulting
// check_count equals totalDueRounds and the on-screen badge reads "ตรวจครบตามกำหนด".
//
//   node migrations/seed_ma_checks.cjs
//
const { Pool } = require('pg');

const pool = new Pool({
    host: process.env.DB_HOST || 'localhost',
    port: Number(process.env.DB_PORT) || 5432,
    database: process.env.DB_NAME || 'opsone_db',
    user: process.env.DB_USER || 'opsone',
    password: process.env.DB_PASS,
});

const INSPECTOR = 'Purich Matchamek';

// Plan → checklist item frequencies (months). Must match MA_PLANS in maPlans.ts.
const PLAN_FREQS = {
    notebook_pc: [6, 6, 6, 6, 6, 6, 6, 6], // 8 items, ราย 6 เดือน
    printer:     [1, 1, 3, 3, 6, 6],       // monthly, ราย 3 เดือน, ราย 6 เดือน
    monitor:     [6],                       // 1 item, ราย 6 เดือน
};

function planForType(typeName) {
    if (typeName === 'Notebook' || typeName === 'PC') return 'notebook_pc';
    if (typeName === 'Printer') return 'printer';
    if (typeName === 'Monitor') return 'monitor';
    return null;
}

function addMonths(d, n) {
    const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    const day = x.getDate();
    x.setMonth(x.getMonth() + n);
    if (x.getDate() < day) x.setDate(0);
    return x;
}

function currentRound(start, freqMonths, today) {
    const t = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    if (t < start) return 0;
    let months = (t.getFullYear() - start.getFullYear()) * 12 + (t.getMonth() - start.getMonth());
    if (t.getDate() < start.getDate()) months -= 1;
    return Math.floor(months / freqMonths) + 1;
}

const pad = (n) => String(n).padStart(2, '0');
const toISO = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

// Deterministic but varied working-hours time (09:00–16:45) for a given round.
function workingTime(seed) {
    let h = 0;
    for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
    const minuteOfDay = 9 * 60 + (h % (7 * 60 + 45)); // 09:00 .. 16:45
    const sec = h % 60;
    return `${pad(Math.floor(minuteOfDay / 60))}:${pad(minuteOfDay % 60)}:${pad(sec)}`;
}

async function run() {
    const today = new Date();
    const client = await pool.connect();
    let inserted = 0, updated = 0, assetsTouched = 0, rounds = 0;
    try {
        const { rows: assets } = await client.query(`
            SELECT a.id, a.asset_id, a.type_name, s.start_date
            FROM ma_asset_settings s
            JOIN assets a ON a.id = s.asset_id
            ORDER BY a.asset_id`);

        for (const a of assets) {
            const plan = planForType(a.type_name);
            if (!plan) continue;
            const freqs = PLAN_FREQS[plan];
            const start = new Date(a.start_date.getFullYear(), a.start_date.getMonth(), a.start_date.getDate());
            let touched = false;

            for (let idx = 0; idx < freqs.length; idx++) {
                const itemSeq = idx + 1;
                const freq = freqs[idx];
                const cur = currentRound(start, freq, today);
                for (let n = 1; n <= cur; n++) {
                    const due = addMonths(start, (n - 1) * freq);
                    const dueISO = toISO(due);
                    const time = workingTime(`${a.asset_id}-${itemSeq}-${n}`);
                    const checkedAt = `${dueISO} ${time}+07`;
                    rounds++;
                    const { rowCount, rows } = await client.query(
                        `INSERT INTO ma_checks(asset_id, plan, item_seq, round_no, due_date, condition, remark, checked_by, checked_at)
                         VALUES ($1,$2,$3,$4,$5,'normal','',$6,$7)
                         ON CONFLICT (asset_id, plan, item_seq, round_no) DO UPDATE SET
                            condition  = 'normal',
                            checked_by = EXCLUDED.checked_by,
                            checked_at = EXCLUDED.checked_at
                         RETURNING (xmax = 0) AS is_insert`,
                        [a.id, plan, itemSeq, n, dueISO, INSPECTOR, checkedAt],
                    );
                    if (rowCount) { rows[0].is_insert ? inserted++ : updated++; touched = true; }
                }
            }
            if (touched) assetsTouched++;
        }
        console.log(`✅ Seeded maintenance checks`);
        console.log(`   assets touched : ${assetsTouched}`);
        console.log(`   rounds due     : ${rounds}`);
        console.log(`   inserted       : ${inserted}`);
        console.log(`   updated        : ${updated}`);
        console.log(`   inspector      : ${INSPECTOR}`);
    } finally {
        client.release();
        await pool.end();
    }
}

run().catch((e) => { console.error('seed failed:', e); process.exit(1); });
