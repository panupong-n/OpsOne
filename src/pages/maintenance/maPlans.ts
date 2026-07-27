// ─── Maintenance (การบำรุงรักษา) plan templates & helpers ──────────────────────
// Checklist items transcribed directly from MA.xlsx. Three plans grouped by the
// asset's hardware type. Frequencies: 1 = รายเดือน, 3 = ราย 3 เดือน, 6 = ราย 6 เดือน.

import type { LucideIcon } from 'lucide-react';
import { CheckCircle2, AlertTriangle, XCircle, MinusCircle, Laptop, Printer, Monitor } from 'lucide-react';

export type PlanKey = 'notebook_pc' | 'printer' | 'monitor';
export type Condition = 'normal' | 'issue' | 'broken' | 'skipped';

export interface MaItem {
    seq: number;
    title: string;
    detail: string;
    freqMonths: number;
    responsible: string;
    note: string;
}

export interface MaPlan {
    key: PlanKey;
    label: string;        // full Thai label — no abbreviation
    types: string[];      // asset type_name values this plan applies to
    icon: LucideIcon;
    color: string;
    bg: string;
    items: MaItem[];
}

const SUPPORT = 'Support Engineer';

export const MA_PLANS: Record<PlanKey, MaPlan> = {
    notebook_pc: {
        key: 'notebook_pc',
        label: 'เครื่องโน้ตบุ๊ก & พีซี (Notebook & PC)',
        types: ['Notebook', 'PC'],
        icon: Laptop,
        color: '#2563EB',
        bg: '#EEF2FF',
        items: [
            { seq: 1, title: 'การอัพเดตซอฟต์แวร์', detail: 'อัพเดตระบบปฏิบัติการ (OS), โปรแกรมป้องกันไวรัส, และซอฟต์แวร์อื่นๆ', freqMonths: 6, responsible: SUPPORT, note: 'ตรวจสอบการตั้งค่าอัตโนมัติสำหรับอัพเดต' },
            { seq: 2, title: 'การตรวจสอบและติดตั้ง Patch', detail: 'ติดตั้ง Patch การรักษาความปลอดภัยจากผู้ผลิต OS และซอฟต์แวร์อื่นๆ', freqMonths: 6, responsible: SUPPORT, note: 'รวมถึง Patch ความปลอดภัยที่สำคัญ' },
            { seq: 3, title: 'การสำรองข้อมูล (Backup)', detail: 'ตรวจสอบการทำงานของระบบ Backup และทดสอบการกู้คืนข้อมูล (Restore)', freqMonths: 6, responsible: SUPPORT, note: 'ตรวจสอบข้อมูลที่สำรองว่าเป็นไปตามนโยบาย' },
            { seq: 4, title: 'การตรวจสอบประสิทธิภาพเครื่อง', detail: 'ตรวจสอบ CPU, RAM, Disk Usage, ระบบเครือข่ายและพื้นที่ว่างในฮาร์ดดิสก์', freqMonths: 6, responsible: SUPPORT, note: 'ตรวจสอบและกำหนดมาตรฐานการใช้งาน' },
            { seq: 5, title: 'การรักษาความปลอดภัยของข้อมูล', detail: 'ตรวจสอบไฟล์ที่มีการเข้ารหัสและสถานะการใช้งานของโปรแกรมป้องกันไวรัส', freqMonths: 6, responsible: SUPPORT, note: 'ตรวจสอบการตั้งค่าความปลอดภัย' },
            { seq: 6, title: 'การตรวจสอบอุปกรณ์เสริม (Peripherals)', detail: 'ตรวจสอบสถานะการเชื่อมต่อกับอุปกรณ์เสริม เช่น Mouse, Keyboard, USB', freqMonths: 6, responsible: SUPPORT, note: 'ทดสอบการเชื่อมต่อให้พร้อมใช้งาน' },
            { seq: 7, title: 'การทำความสะอาดเครื่อง', detail: 'ทำความสะอาดเครื่องทั้งภายนอกและภายใน (กรณีที่ต้องถอดเครื่อง)', freqMonths: 6, responsible: SUPPORT, note: 'ดูแลเครื่องในด้านการระบายความร้อน' },
            { seq: 8, title: 'การตรวจสอบการเข้าถึงและการใช้งาน', detail: 'ตรวจสอบกิจกรรมการเข้าถึงข้อมูลและระบบ (Audit Logs)', freqMonths: 6, responsible: SUPPORT, note: 'ตรวจสอบการเข้าใช้งานเครื่องตามนโยบาย' },
        ],
    },
    printer: {
        key: 'printer',
        label: 'เครื่องพิมพ์ (Printer)',
        types: ['Printer'],
        icon: Printer,
        color: '#F97316',
        bg: '#FFF7ED',
        items: [
            { seq: 1, title: 'การตรวจสอบคุณภาพการพิมพ์', detail: 'ตรวจสอบคุณภาพการพิมพ์ (สี, ความคมชัด) และการทำงานของเครื่องพิมพ์', freqMonths: 1, responsible: SUPPORT, note: 'ทดสอบการพิมพ์โดยใช้เอกสารทดสอบ' },
            { seq: 2, title: 'การตรวจสอบหมึกและกระดาษ', detail: 'ตรวจสอบหมึก, กระดาษ, และอุปกรณ์เสริมเพื่อให้พร้อมใช้งาน', freqMonths: 1, responsible: SUPPORT, note: 'เติมหมึกและเปลี่ยนกระดาษตามต้องการ' },
            { seq: 3, title: 'การทำความสะอาดเครื่องพิมพ์', detail: 'ทำความสะอาดเครื่องพิมพ์และหัวพิมพ์เพื่อป้องกันการอุดตัน', freqMonths: 3, responsible: SUPPORT, note: 'ใช้เครื่องมือที่เหมาะสมในการทำความสะอาด' },
            { seq: 4, title: 'การตรวจสอบการเชื่อมต่อและการใช้งาน', detail: 'ตรวจสอบการเชื่อมต่อของเครื่องพิมพ์กับระบบ (Network, Wi-Fi, USB)', freqMonths: 3, responsible: SUPPORT, note: 'ตรวจสอบว่าเครื่องพิมพ์เชื่อมต่อกับเครือข่ายได้ถูกต้อง' },
            { seq: 5, title: 'การอัพเดต Firmware', detail: 'อัพเดต Firmware ของเครื่องพิมพ์เพื่อการทำงานที่มีประสิทธิภาพ', freqMonths: 6, responsible: SUPPORT, note: 'ติดตั้งอัพเดตจากผู้ผลิตเครื่องพิมพ์' },
            { seq: 6, title: 'การตรวจสอบ Log ของเครื่องพิมพ์', detail: 'ตรวจสอบการใช้งานเครื่องพิมพ์ (เช่น จำนวนการพิมพ์, การบำรุงรักษา)', freqMonths: 6, responsible: SUPPORT, note: 'ตรวจสอบ Log การพิมพ์และการซ่อมบำรุง' },
        ],
    },
    monitor: {
        key: 'monitor',
        label: 'จอภาพ (Monitor)',
        types: ['Monitor'],
        icon: Monitor,
        color: '#0EA5E9',
        bg: '#F0F9FF',
        items: [
            { seq: 1, title: 'การทำความสะอาดเครื่อง', detail: 'ทำความสะอาดเครื่องทั้งภายนอกและภายใน (กรณีที่ต้องถอดเครื่อง)', freqMonths: 6, responsible: SUPPORT, note: 'ดูแลเครื่องในด้านการระบายความร้อน' },
        ],
    },
};

export const PLAN_ORDER: PlanKey[] = ['notebook_pc', 'printer', 'monitor'];

/** Resolve the plan a given asset type belongs to. */
export function planForType(typeName: string): PlanKey | null {
    if (typeName === 'Notebook' || typeName === 'PC') return 'notebook_pc';
    if (typeName === 'Printer') return 'printer';
    if (typeName === 'Monitor') return 'monitor';
    return null;
}

export function freqLabel(months: number): string {
    if (months === 1) return 'รายเดือน';
    if (months === 3) return 'ราย 3 เดือน';
    if (months === 6) return 'ราย 6 เดือน';
    return `ราย ${months} เดือน`;
}

export const CONDITION_META: Record<Condition, { label: string; color: string; bg: string; text: string; icon: LucideIcon }> = {
    normal:  { label: 'ปกติ (ผ่าน)',          color: '#10B981', bg: '#ECFDF5', text: '#065F46', icon: CheckCircle2 },
    issue:   { label: 'มีปัญหา (ซ่อมได้)',     color: '#F59E0B', bg: '#FFFBEB', text: '#92400E', icon: AlertTriangle },
    broken:  { label: 'เครื่องเสีย / ส่งซ่อม', color: '#EF4444', bg: '#FEF2F2', text: '#991B1B', icon: XCircle },
    skipped: { label: 'ข้ามรอบ / ไม่ได้ตรวจ',  color: '#94A3B8', bg: '#F1F5F9', text: '#475569', icon: MinusCircle },
};

export const CONDITIONS: Condition[] = ['normal', 'issue', 'broken', 'skipped'];

// ─── Date / round helpers ──────────────────────────────────────────────────────

/** Add n months, clamping to end-of-month when the source day overflows. */
export function addMonths(d: Date, n: number): Date {
    const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    const day = x.getDate();
    x.setMonth(x.getMonth() + n);
    if (x.getDate() < day) x.setDate(0); // overflowed into next month → clamp back
    return x;
}

/** Parse an ISO date (YYYY-MM-DD or full timestamp) to a local Date at midnight. */
export function parseDate(iso: string): Date {
    const s = iso.length > 10 ? iso.slice(0, 10) : iso;
    const [y, m, d] = s.split('-').map(Number);
    return new Date(y, (m || 1) - 1, d || 1);
}

export function toISODate(d: Date): string {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

const TH_MONTHS = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];

/** Format a date as Thai Buddhist short date, e.g. "17 มิ.ย. 2569". */
export function formatThai(d: Date): string {
    return `${d.getDate()} ${TH_MONTHS[d.getMonth()]} ${d.getFullYear() + 543}`;
}

/** Fixed Thai public holidays (DD-MM). Add more as needed. */
const FIXED_HOLIDAYS = [
    '01-01', // New Year
    '13-04', '14-04', '15-04', // Songkran
    '01-05', // Labor Day
    '04-05', // Coronation Day
    '03-06', // Queen Suthida's Birthday
    '28-07', // King Rama X's Birthday
    '12-08', // Mother's Day
    '13-10', // King Rama IX Memorial Day
    '23-10', // Chulalongkorn Day
    '05-12', // Father's Day
    '10-12', // Constitution Day
    '31-12', // New Year's Eve
];

/** Adjusts a date backward to the nearest working day (skips Sat, Sun, and fixed holidays). */
export function adjustToWorkingDay(d: Date): Date {
    const res = new Date(d);
    while (true) {
        const dayOfWeek = res.getDay();
        const ddmm = String(res.getDate()).padStart(2, '0') + '-' + String(res.getMonth() + 1).padStart(2, '0');
        
        const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
        const isHoliday = FIXED_HOLIDAYS.includes(ddmm);
        
        if (isWeekend || isHoliday) {
            res.setDate(res.getDate() - 1);
        } else {
            break;
        }
    }
    return res;
}

/** Due date of round N (1-indexed) for a schedule starting at startISO. */
export function roundDueDate(startISO: string, freqMonths: number, roundNo: number): Date {
    const d = addMonths(parseDate(startISO), (roundNo - 1) * freqMonths);
    return adjustToWorkingDay(d);
}

/**
 * The round number that is currently due (1-indexed) given the schedule start.
 * 0 means the schedule has not started yet (start date in the future).
 */
export function currentRound(startISO: string, freqMonths: number, today = new Date()): number {
    const start = parseDate(startISO);
    const t = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    if (t < start) return 0;
    let months = (t.getFullYear() - start.getFullYear()) * 12 + (t.getMonth() - start.getMonth());
    if (t.getDate() < start.getDate()) months -= 1;
    return Math.floor(months / freqMonths) + 1;
}

/**
 * Total number of rounds that are currently due (due_date <= today) across all
 * checklist items of a plan — i.e. how many checks should exist for an asset to
 * be fully caught up. Returns 0 when the schedule has not started yet.
 */
export function totalDueRounds(plan: PlanKey, startISO: string, today = new Date()): number {
    return MA_PLANS[plan].items.reduce(
        (sum, it) => sum + Math.max(0, currentRound(startISO, it.freqMonths, today)), 0,
    );
}

export type RoundStatus = 'done' | 'due' | 'overdue' | 'upcoming';

export interface RoundInfo {
    roundNo: number;
    dueDate: Date;
    status: RoundStatus;
}

/**
 * Build the round timeline for one checklist item: every elapsed round plus the
 * next upcoming one. `doneRounds` is the set of round numbers already recorded.
 */
export function buildRounds(startISO: string, freqMonths: number, doneRounds: Set<number>, today = new Date()): RoundInfo[] {
    const cur = currentRound(startISO, freqMonths, today);
    const lastRound = Math.max(cur + 1, 1); // always show at least round 1 (upcoming)
    const rounds: RoundInfo[] = [];
    for (let n = 1; n <= lastRound; n++) {
        const dueDate = roundDueDate(startISO, freqMonths, n);
        let status: RoundStatus;
        if (doneRounds.has(n)) status = 'done';
        else if (n === cur) status = 'due';
        else if (n < cur) status = 'overdue';
        else status = 'upcoming';
        rounds.push({ roundNo: n, dueDate, status });
    }
    return rounds;
}

/** Group rounds into Buddhist-Era year folders, sorted ascending by year. */
export function groupRoundsByYear(rounds: RoundInfo[]): { year: number; rounds: RoundInfo[] }[] {
    const map = new Map<number, RoundInfo[]>();
    for (const r of rounds) {
        const y = r.dueDate.getFullYear() + 543;
        if (!map.has(y)) map.set(y, []);
        map.get(y)!.push(r);
    }
    return [...map.entries()].sort((a, b) => a[0] - b[0]).map(([year, rs]) => ({ year, rounds: rs }));
}

/** Format an ISO timestamp as a Thai Buddhist-Era date-time for tooltips. */
export function formatThaiDateTime(iso: string | null | undefined): string {
    if (!iso) return '—';
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '—';
    const time = d.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' });
    return `${formatThai(d)} ${time} น.`;
}
