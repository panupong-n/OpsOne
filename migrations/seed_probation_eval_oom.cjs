// ─── Seed probation evaluation survey ──────────────────────────────────────────
// Adds the "แบบประเมินผลการทดลองงาน" form (per แบบประเมินผลการทดลองงาน.pdf) as an
// iso_surveys record, scoped to the evaluatee นางสาว บุศรินทร์ วันเมือง (น้องอุ๋ม /
// Boosarin Wanmuang). 25 scored items grouped into 5 weighted sections + 3 free-text
// summary fields.
//
// Scale note: the source document uses a 1–4 rubric, but per product decision this
// form reuses the platform's native RATING type (1–5). The original 1–4 behavioural
// rubric, section weights and pass thresholds are preserved verbatim in the survey
// description for the evaluator's reference.
//
// Idempotent: re-running deletes any prior survey with the same title first, then
// recreates it (questions cascade-delete with the survey).
//
//   node migrations/seed_probation_eval_oom.cjs
//
const { Pool } = require('pg');

const pool = new Pool({
    host: process.env.DB_HOST || 'localhost',
    port: Number(process.env.DB_PORT) || 5432,
    database: process.env.DB_NAME || 'opsone_db',
    user: process.env.DB_USER || 'opsone',
    password: process.env.DB_PASS,
});

// Evaluatee — น้องอุ๋ม
const EVALUATEE_EMAIL = 'boosarin.w@tenforward.co.th';

const SURVEY_TITLE = 'แบบประเมินผลการทดลองงาน — นางสาว บุศรินทร์ วันเมือง (น้องอุ๋ม)';

const SURVEY_DESCRIPTION = [
    'แบบประเมินผลการทดลองงานของ นางสาว บุศรินทร์ วันเมือง (น้องอุ๋ม)',
    '',
    "เกณฑ์การให้คะแนน (วัดจาก 'ระดับการทำงานได้ด้วยตนเอง' ของระดับ Junior):",
    '1 = ต่ำกว่ามาตรฐานมาก — ทำไม่ได้ / ทำผิดบ่อย แม้มีคนสอนและกำกับ ต้องปรับปรุงเร่งด่วน',
    '2 = ต่ำกว่าที่คาดหวัง — พอทำได้แต่ต้องมีคนคอยกำกับ/แก้ให้เกือบตลอด ยังไว้ใจให้ทำเองไม่ได้',
    '3 = ได้ตามมาตรฐานของ Junior — ทำงานที่ได้รับมอบหมายได้ถูกต้องด้วยตนเอง ปรึกษาเมื่อจำเป็น',
    '4 = เกินความคาดหวัง — ทำได้ดี รวดเร็ว แม่นยำ ช่วยเหลือผู้อื่น/เสนอแนวทางปรับปรุงได้',
    '',
    'น้ำหนักหมวด: หมวดที่ 1 (40%) | หมวดที่ 2 (20%) | หมวดที่ 3 (20%) | หมวดที่ 4 (10%) | หมวดที่ 5 (10%)',
    'เกณฑ์ตัดสิน: เฉลี่ยถ่วงน้ำหนัก ≥ 3.00 = ผ่าน | 2.50–2.99 = ผ่านแบบมีเงื่อนไข/ขยายเวลา | < 2.50 = ไม่ผ่าน',
].join('\n');

// Section label prefix mirrors the existing IT-satisfaction template convention.
const S1 = '[หมวดที่ 1 ทักษะเทคนิคด้านความมั่นคงปลอดภัย (Core Technical) — น้ำหนัก 40%]';
const S2 = '[หมวดที่ 2 คุณภาพงานและความละเอียดรอบคอบ — น้ำหนัก 20%]';
const S3 = '[หมวดที่ 3 ความรับผิดชอบและการเรียนรู้ — น้ำหนัก 20%]';
const S4 = '[หมวดที่ 4 วินัยและจรรยาบรรณด้านความปลอดภัย — น้ำหนัก 10%]';
const S5 = '[หมวดที่ 5 การสื่อสารและการทำงานร่วมกับทีม — น้ำหนัก 10%]';
const SUM = '[สรุปผลการประเมิน]';

// type: RATING | TEXT ; order assigned sequentially below.
const QUESTIONS = [
    // หมวดที่ 1 — Core Technical (40%)
    { t: `${S1} การ Config อุปกรณ์/ระบบความปลอดภัย (Firewall, IDS/IPS, Endpoint, Access Control) ตาม requirement ได้ถูกต้อง`, type: 'RATING' },
    { t: `${S1} การ Implement / ติดตั้ง security control หรือ rule ตามที่ได้รับมอบหมาย และทดสอบว่าใช้งานได้จริง`, type: 'RATING' },
    { t: `${S1} การวิเคราะห์ Log และ Event — อ่าน log เป็น หา anomaly และเชื่อมโยง (correlate) เหตุการณ์ได้`, type: 'RATING' },
    { t: `${S1} การ Monitor และ Triage Alert — คัดกรอง alert จริง/false positive และจัดลำดับความรุนแรงได้`, type: 'RATING' },
    { t: `${S1} การตรวจจับและตอบสนองเหตุการณ์เบื้องต้น (Incident Detection & Initial Response) ตาม playbook`, type: 'RATING' },
    { t: `${S1} ความเข้าใจพื้นฐาน Network / OS / Security Concept ที่จำเป็นต่อการทำงานจริง`, type: 'RATING' },
    { t: `${S1} การใช้เครื่องมือด้านความปลอดภัย (SIEM, Vulnerability Scanner, Packet/Log Analyzer ฯลฯ) ได้คล่อง`, type: 'RATING' },
    { t: `${S1} การทำ Vulnerability Assessment / Hardening / ตรวจสอบ patch เบื้องต้นตามมาตรฐาน`, type: 'RATING' },
    // หมวดที่ 2 — คุณภาพงานและความละเอียดรอบคอบ (20%)
    { t: `${S2} ความถูกต้องของงาน — config/รายงาน/การตั้งค่า ไม่มีข้อผิดพลาดที่ก่อให้เกิดความเสี่ยงด้านความปลอดภัย`, type: 'RATING' },
    { t: `${S2} ความละเอียดรอบคอบ — ตรวจทานงานก่อนส่ง ไม่มองข้ามรายละเอียดสำคัญ`, type: 'RATING' },
    { t: `${S2} การจัดทำเอกสาร / Runbook / รายงานผลการวิเคราะห์ ครบถ้วน ชัดเจน ผู้อื่นนำไปใช้ต่อได้`, type: 'RATING' },
    { t: `${S2} การปฏิบัติงานตามขั้นตอน (SOP / Playbook / Baseline) อย่างสม่ำเสมอ`, type: 'RATING' },
    // หมวดที่ 3 — ความรับผิดชอบและการเรียนรู้ (20%)
    { t: `${S3} ความตั้งใจและมีสมาธิจดจ่อกับงานในเวลางาน ไม่ทำกิจกรรมส่วนตัวจนกระทบงานที่รับผิดชอบ`, type: 'RATING' },
    { t: `${S3} ส่งมอบงานที่ได้รับมอบหมายตรงเวลาและครบถ้วนตามที่ตกลง`, type: 'RATING' },
    { t: `${S3} ความกระตือรือร้นในการเรียนรู้เทคโนโลยีภัยคุกคาม และเครื่องมือใหม่ ๆ ด้วยตนเอง`, type: 'RATING' },
    { t: `${S3} การพัฒนาและปรับปรุงตนเองจาก feedback ที่ได้รับ ไม่ทำผิดซ้ำเรื่องเดิม`, type: 'RATING' },
    { t: `${S3} การบริหารจัดการงานหลายอย่างตามลำดับความสำคัญได้เหมาะสม`, type: 'RATING' },
    // หมวดที่ 4 — วินัยและจรรยาบรรณด้านความปลอดภัย (10%)
    { t: `${S4} ความซื่อสัตย์และการรักษาความลับของข้อมูล (Confidentiality & Integrity)`, type: 'RATING' },
    { t: `${S4} การปฏิบัติตามนโยบายความปลอดภัยและกฎระเบียบขององค์กร`, type: 'RATING' },
    { t: `${S4} การใช้สิทธิ์การเข้าถึง (Access) อย่างเหมาะสม ตามขอบเขตหน้าที่ ไม่ใช้เกินความจำเป็น`, type: 'RATING' },
    { t: `${S4} ความตรงต่อเวลาเข้างานและการแจ้งลาตามระเบียบ`, type: 'RATING' },
    // หมวดที่ 5 — การสื่อสารและการทำงานร่วมกับทีม (10%)
    { t: `${S5} การรายงาน / Escalate เหตุการณ์ผิดปกติได้ทันท่วงทีและชัดเจน ถูกช่องทาง`, type: 'RATING' },
    { t: `${S5} การสื่อสารผลการวิเคราะห์/สถานะงานให้ทีมและผู้เกี่ยวข้องเข้าใจตรงกัน`, type: 'RATING' },
    { t: `${S5} การทำงานร่วมกับทีม รับฟังคำแนะนำ และขอความช่วยเหลือเมื่อติดปัญหา`, type: 'RATING' },
    { t: `${S5} ทัศนคติเชิงบวกต่องานและการมุ่งแก้ปัญหา`, type: 'RATING' },
    // สรุปผลการประเมิน — free text
    { t: `${SUM} จุดเด่น / สิ่งที่ทำได้ดี`, type: 'TEXT', required: false },
    { t: `${SUM} จุดที่ต้องพัฒนา (ระบุพฤติกรรม/งานที่เป็นปัญหาอย่างเป็นรูปธรรม)`, type: 'TEXT', required: false },
    { t: `${SUM} แผนพัฒนา / สิ่งที่คาดหวังในรอบถัดไป (เป้าหมายที่วัดผลได้ + กำหนดเวลา)`, type: 'TEXT', required: false },
];

async function main() {
    const client = await pool.connect();
    try {
        // Resolve evaluator (created_by_id) — prefer a SUPER_ADMIN, fall back to any user.
        const adminRes = await client.query(
            `SELECT sub, name FROM platform_users
             WHERE role = 'SUPER_ADMIN' ORDER BY created_at NULLS LAST LIMIT 1`,
        );
        const fallback = adminRes.rows[0] || (await client.query(`SELECT sub, name FROM platform_users LIMIT 1`)).rows[0];
        if (!fallback) throw new Error('No platform_users found to attribute the survey to.');
        const createdById = fallback.sub;

        // Confirm the evaluatee exists (informational).
        const evaluatee = await client.query(
            `SELECT sub, name FROM platform_users WHERE email = $1`, [EVALUATEE_EMAIL],
        );
        if (!evaluatee.rows[0]) {
            console.warn(`⚠️  Evaluatee ${EVALUATEE_EMAIL} not found in platform_users (continuing anyway).`);
        }

        await client.query('BEGIN');

        // Idempotency: remove any prior survey with the same title (questions cascade).
        const del = await client.query(`DELETE FROM iso_surveys WHERE title = $1 RETURNING id`, [SURVEY_TITLE]);
        if (del.rowCount > 0) console.log(`↺ Removed ${del.rowCount} existing survey(s) with same title.`);

        const { rows } = await client.query(
            `INSERT INTO iso_surveys(title, description, version, status, created_by_id, created_at, updated_at)
             VALUES($1, $2, 1, 'DRAFT', $3, NOW(), NOW()) RETURNING id`,
            [SURVEY_TITLE, SURVEY_DESCRIPTION, createdById],
        );
        const surveyId = rows[0].id;

        let order = 1;
        for (const q of QUESTIONS) {
            await client.query(
                `INSERT INTO iso_questions(survey_id, text, type, options, "order", required, created_at)
                 VALUES($1, $2, $3, NULL, $4, $5, NOW())`,
                [surveyId, q.t, q.type, order, q.required !== false],
            );
            order += 1;
        }

        await client.query('COMMIT');
        console.log('✅ Seeded probation evaluation survey');
        console.log(`   survey_id   : ${surveyId}`);
        console.log(`   title       : ${SURVEY_TITLE}`);
        console.log(`   evaluatee   : ${evaluatee.rows[0]?.name || EVALUATEE_EMAIL}`);
        console.log(`   created_by  : ${fallback.name} (${createdById})`);
        console.log(`   questions   : ${QUESTIONS.length} (${QUESTIONS.filter(q => q.type === 'RATING').length} RATING + ${QUESTIONS.filter(q => q.type === 'TEXT').length} TEXT)`);
        console.log('   status      : DRAFT — publish & assign via the แบบประเมิน UI when ready.');
    } catch (e) {
        await client.query('ROLLBACK').catch(() => {});
        throw e;
    } finally {
        client.release();
        await pool.end();
    }
}

main().catch((e) => { console.error('❌ Seed failed:', e.message); process.exit(1); });
