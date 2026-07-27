// ─── Maintenance PDF report builder ────────────────────────────────────────────
// Generates a print-ready A4 PORTRAIT checklist matrix and opens it in a new window
// for "Save as PDF". Layout: machines down the left, maintenance topics as vertical
// headers across the top (ordered by item, then by round), tick (✓) cells per round.
// Column widths are fitted to the portrait page width so wide plans don't overflow.
// Using the browser print pipeline keeps Thai typography crisp without embedding fonts.

import {
    MA_PLANS, PLAN_ORDER, CONDITION_META, planForType, freqLabel,
    formatThai, roundDueDate,
    type PlanKey, type Condition,
} from './maPlans';

export interface MaReportAsset {
    asset_id: string;
    type_name: string;
    brand_model: string;
    description: string;
    serial_number: string;
    holder: string;
    department: string;
    start_date: string | null;
    hidden: boolean;
    check_count: number;
    last_checked_at: string | null;
    broken_count: number;
}

export interface MaReportRow {
    asset_code: string;
    type_name: string;
    brand_model: string;
    serial_number: string;
    holder: string;
    department: string;
    plan: PlanKey;
    item_seq: number;
    round_no: number;
    due_date: string;
    condition: Condition;
    remark: string;
    checked_by: string | null;
    checked_at: string;
    resolution_condition: Condition | null;
    resolution_remark: string | null;
    resolved_by: string | null;
    resolved_at: string | null;
}

const esc = (v: unknown): string =>
    String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Short Thai date "17 มี.ค. 68" (2-digit BE year) for tight round sub-headers. */
const shortThaiDate = (d: Date): string => {
    const m = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
    return `${d.getDate()} ${m[d.getMonth()]} ${String((d.getFullYear() + 543) % 100).padStart(2, '0')}`;
};

const truncate = (s: string, n: number): string => (s.length > n ? s.slice(0, n - 1) + '…' : s);

// Per-plan matrix sizing. Each topic gets its own slanted bordered frame anchored
// at the group's bottom-left, so the full title lives INSIDE its own box (never
// crossing grid lines) and adjacent frames stay parallel (never colliding).
// `boxW` = diagonal length of the frame (wraps long titles); `angle` keeps the
// footprint inside the page; `headH` is tall enough to contain the frame.
const MATRIX_LAYOUT: Record<PlanKey, { colW: number; mcW: number; boxW: number; angle: number; headH: number; font: number }> = {
    notebook_pc: { colW: 30, mcW: 172, boxW: 152, angle: 47, headH: 152, font: 8.5 },
    printer: { colW: 17, mcW: 138, boxW: 96, angle: 60, headH: 140, font: 7.5 },
    monitor: { colW: 34, mcW: 200, boxW: 152, angle: 47, headH: 152, font: 8.5 },
};

/** Mark glyph + colour for a checklist cell, keyed by the effective condition. */
const CELL_MARK: Record<Condition, { ch: string; color: string }> = {
    normal: { ch: '✓', color: '#059669' },
    issue: { ch: '!', color: '#D97706' },
    broken: { ch: '✕', color: '#DC2626' },
    skipped: { ch: '–', color: '#94A3B8' },
};

interface BuildOpts {
    assets: MaReportAsset[];
    rows: MaReportRow[];
    startYear: number;
    endYear: number;
}

// ─── One plan's checklist matrix ────────────────────────────────────────────────
function buildMatrix(plan: PlanKey, assets: MaReportAsset[], rows: MaReportRow[], today: Date, startYear: number, endYear: number): string {
    const meta = MA_PLANS[plan];
    const L = MATRIX_LAYOUT[plan];
    const planAssets = assets.filter(a => planForType(a.type_name) === plan);
    if (!planAssets.length) return '';

    const refStart = planAssets.find(a => a.start_date)?.start_date;

    const itemRounds = meta.items.map(item => {
        const roundList: number[] = [];
        if (refStart) {
            for (let r = 1; r <= 200; r++) {
                const due = roundDueDate(refStart, item.freqMonths, r);
                const dueYear = due.getFullYear();
                if (dueYear > endYear) break;
                if (dueYear >= startYear) roundList.push(r);
            }
        }
        return { item, roundList };
    });
    const totalCols = itemRounds.reduce((s, ir) => s + ir.roundList.length, 0);
    if (totalCols === 0) {
        return `<h3 class="plan-head" style="color:${meta.color}">${esc(meta.label)}</h3>
                <p class="empty">ยังไม่ถึงรอบการบำรุงรักษาสำหรับทรัพย์สินกลุ่มนี้</p>`;
    }

    // Fit the matrix to A4 *portrait* printable width (≈190mm − slack ≈ 690px).
    // Shrink the round columns first, then the machine column, so even wide plans
    // (printer, many rounds) stay on the page instead of overflowing/clipping.
    const PRINTABLE_W = 690;
    let mcW = L.mcW;
    let colW = L.colW;
    if (mcW + totalCols * colW > PRINTABLE_W) {
        colW = Math.floor((PRINTABLE_W - mcW) / totalCols);
        if (colW < 14) { mcW = 120; colW = Math.max(10, Math.floor((PRINTABLE_W - mcW) / totalCols)); }
    }
    const tableW = mcW + totalCols * colW;

    // Lookup recorded checks: asset_code|seq|round → row.
    const checkMap = new Map<string, MaReportRow>();
    for (const r of rows) {
        if (r.plan === plan) checkMap.set(`${r.asset_code}|${r.item_seq}|${r.round_no}`, r);
    }

    // colgroup (widths fitted to the page)
    const cols = `<colgroup><col style="width:${mcW}px">${itemRounds.flatMap(ir =>
        Array.from({ length: ir.roundList.length }, () => `<col style="width:${colW}px">`)).join('')}</colgroup>`;

    // Header row 1: Each topic rotated -90deg and centered in its bounding frame
    // to prevent overlap and dynamically wrap long text.
    const topicCells = itemRounds.filter(ir => ir.roundList.length > 0).map(ir =>
        `<th class="diag" colspan="${ir.roundList.length}"><div class="tbox-container"><span class="tbox" style="font-size:${L.font}pt;">${ir.item.seq}. ${esc(ir.item.title)}</span></div></th>`
    ).join('');

    // Header row 2: round number + due date per column.
    const roundCells = itemRounds.filter(ir => ir.roundList.length > 0).map(ir =>
        ir.roundList.map(roundNo => {
            const due = roundDueDate(refStart!, ir.item.freqMonths, roundNo);
            return `<th class="rnd" title="ครบกำหนด ${esc(formatThai(due))}"><div class="rn">${roundNo}</div><div class="rd">${esc(shortThaiDate(due))}</div></th>`;
        }).join('')
    ).join('');

    // Body: one row per machine.
    const body = planAssets.map(a => {
        const name = truncate(a.brand_model || a.description || a.type_name, 24);
        const cells = itemRounds.filter(ir => ir.roundList.length > 0).map(ir => {
            return ir.roundList.map(roundNo => {
                const rec = checkMap.get(`${a.asset_id}|${ir.item.seq}|${roundNo}`);
                if (rec) {
                    const eff = (rec.resolution_condition ?? rec.condition) as Condition;
                    const m = CELL_MARK[eff];
                    const fixed = rec.resolution_condition ? ' ◦' : '';
                    const tip = `${esc(ir.item.title)} · ครั้งที่ ${roundNo}\n${esc(CONDITION_META[eff].label)} — ${esc(rec.checked_by || '—')}`;
                    return `<td class="cell" style="color:${m.color}" title="${tip}">${m.ch}${fixed}</td>`;
                }
                const due = a.start_date ? roundDueDate(a.start_date, ir.item.freqMonths, roundNo) : null;
                const isDue = due && due <= today;
                return `<td class="cell ${isDue ? 'miss' : 'na'}" title="${isDue ? 'ถึงกำหนดแล้ว (ยังไม่บันทึกผล)' : 'ยังไม่ถึงรอบ'}">${isDue ? '·' : ''}</td>`;
            }).join('');
        }).join('');
        return `<tr>
            <td class="machine"><span class="mono">${esc(a.asset_id)}</span> <span class="mname">${esc(name)}</span>${a.holder ? `<span class="mhold">${esc(a.holder)}</span>` : ''}</td>
            ${cells}
        </tr>`;
    }).join('');

    // Legend mapping item seq → full title + frequency.
    const legend = meta.items.map(it =>
        `<li><b>${it.seq}.</b> ${esc(it.title)} <span class="muted">(${esc(freqLabel(it.freqMonths))})</span></li>`
    ).join('');

    return `
        <div class="matrix-wrap">
            <h3 class="plan-head" style="color:${meta.color}">${esc(meta.label)} <span class="muted">— ${planAssets.length} เครื่อง × ${totalCols} รอบตรวจ</span></h3>
            <table class="matrix" style="width:${tableW}px">
                ${cols}
                <thead style="display: table-header-group;">
                    <tr class="topics"><th class="corner" rowspan="2">เครื่อง / รุ่น</th>${topicCells}</tr>
                    <tr class="rounds">${roundCells}</tr>
                </thead>
                <tbody>${body}</tbody>
            </table>
            <ul class="legend" style="list-style: none; padding: 0; margin-left: 0;">${legend}</ul>
        </div>`;
}

export function buildMaReportHtml({ assets, rows, startYear, endYear }: BuildOpts): string {
    const ts = new Date();
    const today = new Date(ts.getFullYear(), ts.getMonth(), ts.getDate());
    const genStamp = `${formatThai(ts)} ${ts.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' })} น.`;

    // Summary stats.
    const condCount: Record<Condition, number> = { normal: 0, issue: 0, broken: 0, skipped: 0 };
    let resolvedCount = 0;
    for (const r of rows) {
        const eff = (r.resolution_condition ?? r.condition) as Condition;
        condCount[eff] = (condCount[eff] ?? 0) + 1;
        if (r.resolution_condition) resolvedCount++;
    }
    const unresolvedBroken = rows.filter(r => r.condition === 'broken' && !r.resolution_condition).length;

    const summaryCards = [
        { label: 'ทรัพย์สินในระบบ', value: assets.length, sub: 'เครื่อง' },
        { label: 'รอบที่ตรวจแล้ว', value: rows.length, sub: 'รายการ' },
        { label: 'ผ่าน (ปกติ)', value: condCount.normal, sub: 'รอบ' },
        { label: 'เครื่องเสีย (ค้างแก้ไข)', value: unresolvedBroken, sub: 'รายการ' },
    ].map(c => `<div class="card"><div class="card-value">${c.value}</div><div class="card-label">${esc(c.label)}</div><div class="card-sub">${esc(c.sub)}</div></div>`).join('');

    // Matrices — one per plan that has assets.
    const planKeys = PLAN_ORDER.filter(p => assets.some(a => planForType(a.type_name) === p));
    const matrices = planKeys.map((p, i) => {
        const matrixHtml = buildMatrix(p, assets, rows, today, startYear, endYear);
        if (!matrixHtml) return '';
        // Add page break before all matrices except the first one
        if (i > 0) {
            return `<div style="page-break-before: always;">${matrixHtml}</div>`;
        }
        return matrixHtml;
    }).join('');

    return `<!DOCTYPE html>
<html lang="th">
<head>
<meta charset="utf-8">
<title>รายงานการบำรุงรักษาทรัพย์สิน IT (Checklist)</title>
<style>
    @import url('https://fonts.googleapis.com/css2?family=Sarabun:wght@400;500;600;700&display=swap');
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: 'Sarabun', 'TH Sarabun New', 'Tahoma', sans-serif; color: #000; background: #fff; font-size: 10pt; line-height: 1.45; }
    .report { padding: 16px 18px; }
    .content { }
    /* Header */
    header { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 3px solid #2563EB; padding-bottom: 12px; margin-bottom: 16px; }
    .doc-no { font-size: 8.5pt; color: #2563EB; font-weight: 600; letter-spacing: .5px; }
    h1 { font-size: 18pt; font-weight: 700; color: #1E3A8A; margin-top: 2px; }
    .subtitle { font-size: 9.5pt; color: #475569; font-weight: 500; }
    .meta { font-size: 9pt; color: #334155; margin-top: 6px; }
    .meta b { color: #1E3A8A; }
    .logo { height: 52px; width: auto; }
    /* Sections */
    section { margin-bottom: 16px; }
    h2 { font-size: 12pt; font-weight: 700; color: #1E3A8A; border-left: 4px solid #2563EB; padding-left: 10px; margin-bottom: 10px; }
    h3.plan-head { font-size: 11pt; font-weight: 700; margin: 16px 0 4px; page-break-after: avoid; }
    .muted { color: #64748B; font-weight: 400; font-size: 8.5pt; }
    /* Summary cards */
    .cards { display: flex; gap: 10px; margin-bottom: 6px; }
    .card { flex: 1; border: 1px solid #BFDBFE; background: #EFF6FF; border-radius: 10px; padding: 10px 14px; text-align: center; }
    .card-value { font-size: 19pt; font-weight: 700; color: #1D4ED8; line-height: 1; }
    .card-label { font-size: 9pt; color: #1E3A8A; font-weight: 600; margin-top: 4px; }
    .card-sub { font-size: 7.5pt; color: #64748B; }
    /* Checklist matrix — wrapper stays full-width (NOT fit-content: a shrink-to-fit
       wrapper stops Chromium repeating <thead> across pages); the table centres itself
       via margin:auto using its explicit (page-fitted) width. */
    .matrix-wrap { width: 100%; margin: 6px auto 20px; text-align: center; }
    table.matrix { border-collapse: collapse; table-layout: fixed; margin: 0 auto 4px; page-break-inside: auto; }
    table.matrix tr { page-break-inside: avoid; page-break-after: auto; }
    .matrix th, .matrix td { border: 1.5px solid #94A3B8; }
    .matrix th.corner { vertical-align: bottom; text-align: left; padding: 4px 6px; background: #DBEAFE; color: #1E3A8A; font-weight: 700; font-size: 9pt; }
    .matrix th.diag { 
        padding: 4px; 
        border: 1px solid #CBD5E1; 
        background: #F8FAFC; 
        vertical-align: middle; 
        text-align: center; 
        height: 180px; 
    }
    .matrix th.diag .tbox-container {
        display: flex;
        justify-content: center;
        align-items: center;
        height: 100%;
    }
    .matrix th.diag .tbox { 
        writing-mode: vertical-rl;
        transform: rotate(180deg);
        box-sizing: border-box;
        white-space: normal; overflow-wrap: anywhere; word-break: break-word; line-height: 1.25; font-weight: 700; color: #1E293B; text-align: left;
        max-height: 170px;
    }
    .matrix th.rnd { background: #EFF6FF; padding: 1px 0; vertical-align: middle; }
    .matrix th.rnd .rn { font-size: 8pt; font-weight: 700; color: #1E3A8A; }
    .matrix th.rnd .rd { font-size: 5.6pt; color: #64748B; line-height: 1; }
    .matrix td.machine { text-align: left; padding: 2px 6px; white-space: nowrap; overflow: hidden; }
    .matrix td.machine .mono { font-family: 'Courier New', monospace; font-weight: 700; color: #1D4ED8; font-size: 8.5pt; }
    .matrix td.machine .mname { font-size: 8pt; color: #334155; }
    .matrix td.machine .mhold { font-size: 7pt; color: #94A3B8; display: block; }
    .matrix td.cell { text-align: center; font-size: 9.5pt; font-weight: 700; height: 20px; }
    .matrix tbody tr:nth-child(even) td.cell { background: #F8FAFC; }
    .matrix td.cell.miss { color: #CBD5E1; }
    .matrix td.cell.na { background: repeating-linear-gradient(45deg, #fff, #fff 3px, #F1F5F9 3px, #F1F5F9 6px); }
    /* Legend */
    .legend { columns: 2; column-gap: 24px; font-size: 8pt; color: #475569; margin: 6px 0 0; padding-left: 16px; width: 100%; text-align: left; }
    .legend li { break-inside: avoid; margin-bottom: 1px; }
    .empty { color: #64748B; font-style: italic; padding: 10px; border: 1px dashed #CBD5E1; border-radius: 8px; }
    /* Legend chips for marks */
    .marks { display: flex; gap: 16px; font-size: 8.5pt; color: #475569; margin: 4px 0 0; }
    .marks span b { font-size: 10pt; }
    /* Sign-off — pinned to the bottom of the page */
    .signoff { display: flex; justify-content: space-around; gap: 24px; margin-top: 24px; padding-top: 12px; border-top: 1.5px solid #BFDBFE; page-break-inside: avoid; }
    .sign { flex: 1; text-align: center; }
    .sign .line { border-top: 1px dotted #475569; margin: 40px 16px 6px; }
    .sign .role { font-size: 9pt; color: #1E3A8A; font-weight: 600; }
    .sign .date { font-size: 8pt; color: #64748B; margin-top: 2px; }
    footer { margin-top: 10px; border-top: 1px solid #CBD5E1; padding-top: 8px; font-size: 8pt; color: #64748B; display: flex; justify-content: space-between; page-break-inside: avoid; }
    @page { size: A4 portrait; margin: 10mm; }
    @media print {
        body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
        .report { padding: 0; }
        table { page-break-inside: auto; }
        tr { page-break-inside: avoid; }
        thead { display: table-header-group; }
        h2, h3 { page-break-after: avoid; }
        .signoff { page-break-inside: avoid; }
    }
</style>
</head>
<body>
<div class="report">
    <div class="content">
    <header>
        <div>
            <div class="doc-no">TEN FORWARD · IT ASSET MAINTENANCE</div>
            <h1>รายงานการบำรุงรักษาทรัพย์สิน IT</h1>
            <div class="subtitle">Preventive Maintenance Checklist</div>
            <div class="meta">
                ช่วงข้อมูลปี: <b>${startYear === endYear ? String(startYear + 543) : `${startYear + 543} - ${endYear + 543}`}</b><br>
                วันที่พิมพ์รายงาน: <b>${esc(genStamp)}</b>
            </div>
        </div>
        <img class="logo" src="/TENIX-LOGO.png" alt="OpsOne">
    </header>

    <section>
        <h2>สรุปภาพรวม (Summary)</h2>
        <div class="cards">${summaryCards}</div>
        <div class="marks">
            <span><b style="color:#059669">✓</b> ผ่าน (ปกติ)</span>
            <span><b style="color:#D97706">!</b> มีปัญหา (ซ่อมได้)</span>
            <span><b style="color:#DC2626">✕</b> เครื่องเสีย / ส่งซ่อม</span>
            <span><b style="color:#94A3B8">–</b> ข้ามรอบ</span>
            <span><b style="color:#059669">◦</b> แก้ไขแล้ว</span>
            <span><b style="color:#CBD5E1">·</b> ถึงกำหนด ยังไม่บันทึก</span>
        </div>
    </section>

    <section>
        <h2>ตารางตรวจเช็คตามรอบ (Maintenance Checklist Matrix)</h2>
        ${matrices || '<p class="empty">ไม่มีข้อมูลทรัพย์สินในระบบบำรุงรักษา</p>'}
    </section>
    </div>

    <section class="signoff">
        <div class="sign"><div class="line"></div><div class="role">ผู้จัดทำ / Prepared by</div><div class="date">วันที่ ............../............../..............</div></div>
        <div class="sign"><div class="line"></div><div class="role">ผู้ตรวจสอบ / Reviewed by</div><div class="date">วันที่ ............../............../..............</div></div>
        <div class="sign"><div class="line"></div><div class="role">ผู้อนุมัติ / Approved by</div><div class="date">วันที่ ............../............../..............</div></div>
    </section>

    <footer>
        <span>เอกสารนี้จัดทำโดยระบบ OpsOne — การบำรุงรักษา (Maintenance)</span>
        <span>เอกสารลับ — สำหรับใช้ภายในองค์กรเท่านั้น (Confidential)</span>
    </footer>
</div>
<script>window.onload = function () { setTimeout(function () { window.focus(); window.print(); }, 350); };</script>
</body>
</html>`;
}

/** Open the report in a new window and trigger the print/save-as-PDF dialog. */
export function openMaReportPdf(opts: BuildOpts): boolean {
    const html = buildMaReportHtml(opts);
    const win = window.open('', '_blank');
    if (!win) return false;
    win.document.write(html);
    win.document.close();
    return true;
}
