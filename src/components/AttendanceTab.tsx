import { useState, useEffect, useMemo } from 'react';
import { isHoliday, isWeekend, useHolidays } from '../lib/holidays';
import { motion } from 'framer-motion';
import { openPreview } from '../lib/preview';
import {
    Building2, Car, ChevronLeft, ChevronRight,
    Eye, RefreshCw, MapPin,
} from 'lucide-react';

// ─── Types ────────────────────────────────────────────────────────────────────
type AttStatus = 'office' | 'travel' | 'leave';

interface PlatformUser {
    sub: string;
    email: string;
    name: string;
    given_name?: string;
    family_name?: string;
    role: string;
    visible?: boolean;
    user_group?: string;
}

interface AttRecord {
    id: string;
    employee_id: string;
    date: string;
    status: string;
    location: string | null;
    check_in: string | null;
    product: string | null;
    customer: string | null;
}

interface SiteInfo {
    product: string | null;
    customer: string | null;
}

interface EmpData {
    id: string;
    name: string;
    email: string;
    schedule: Record<string, AttStatus>;
    siteDetails: Record<string, SiteInfo>;
    location?: string;
    checkIn?: string;
}

// ─── Thai Public Holidays ────────────────────────────────────────────────────

const TH_MONTHS = ['มกราคม','กุมภาพันธ์','มีนาคม','เมษายน','พฤษภาคม','มิถุนายน','กรกฎาคม','สิงหาคม','กันยายน','ตุลาคม','พฤศจิกายน','ธันวาคม'];
const TH_DAYS_S = ['อา','จ','อ','พ','พฤ','ศ','ส'];
const AVATAR_COLORS = ['#2563EB','#0EA5E9','#3B82F6','#1D4ED8','#0891B2','#6366F1'];

const TODAY_D = new Date();
const fmtDate = (d: Date) => d.toISOString().slice(0, 10);
const todayStr = fmtDate(TODAY_D);

const isHol = isHoliday;
const isWknd = isWeekend;
const isRest = (d: string): boolean => isWknd(d) || !!isHol(d);

function initials(name: string): string {
    const p = name.trim().split(/\s+/);
    return p.length >= 2 ? (p[0][0] + p[1][0]).toUpperCase() : name.slice(0, 2).toUpperCase();
}
function aColor(id: string): string {
    let h = 0;
    for (let i = 0; i < id.length; i++) h = id.charCodeAt(i) + ((h << 5) - h);
    return AVATAR_COLORS[Math.abs(h) % AVATAR_COLORS.length];
}

const STATUS_META: Record<AttStatus, { label: string; color: string; bg: string; Icon: typeof Building2 | null }> = {
    office: { label: 'เข้าออฟฟิศ', color: '#16A34A', bg: '#F0FDF4', Icon: Building2 },
    travel: { label: 'ออกพื้นที่',  color: '#B45309', bg: '#FEF3C7', Icon: Car },
    leave:  { label: 'ลางาน',      color: '#6B7280', bg: '#F3F4F6', Icon: null },
};

// ─── Main Component ───────────────────────────────────────────────────────────
export interface AttendanceTabProps {
    viewDate: Date;
    setViewDate: (d: Date) => void;
    users: PlatformUser[];
    isAdmin: boolean;
    onRefresh: () => void;
}

export default function AttendanceTab({ viewDate, setViewDate, users }: AttendanceTabProps) {
    useHolidays();   // re-render when the daily holiday sync lands
    const [attRecords, setAttRecords] = useState<AttRecord[]>([]);
    const [loading,    setLoading]    = useState(false);
    const [selDate,    setSelDate]    = useState(todayStr);

    const year       = viewDate.getFullYear();
    const month      = viewDate.getMonth();
    const daysInMo   = new Date(year, month + 1, 0).getDate();
    const firstDay   = new Date(year, month, 1).getDay();

    const loadAtt = () => {
        setLoading(true);
        fetch(`/api/attendance?year=${year}&month=${month + 1}`)
            .then(r => r.json())
            .then(data => setAttRecords(Array.isArray(data) ? data : []))
            .catch(() => {})
            .finally(() => setLoading(false));
    };

    useEffect(() => { loadAtt(); }, [year, month]); // eslint-disable-line react-hooks/exhaustive-deps

    const employees = useMemo((): EmpData[] => {
        const visible = users.filter(u => u.visible !== false);
        const schMap:  Record<string, Record<string, AttStatus>> = {};
        const siteMap: Record<string, Record<string, SiteInfo>>  = {};
        const locMap:  Record<string, string> = {};
        const ciMap:   Record<string, string> = {};

        for (const r of attRecords) {
            schMap[r.employee_id]  ??= {};
            siteMap[r.employee_id] ??= {};
            const ds = r.date.slice(0, 10);
            schMap[r.employee_id][ds]  = r.status as AttStatus;
            siteMap[r.employee_id][ds] = { product: r.product, customer: r.customer };
            if (r.location) locMap[r.employee_id] = r.location;
            if (r.check_in) ciMap[r.employee_id]  = r.check_in.slice(0, 5);
        }

        // Auto-fill weekdays as 'office' when no record
        for (const u of visible) {
            schMap[u.sub] ??= {};
            for (let day = 1; day <= daysInMo; day++) {
                const ds = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
                if (!schMap[u.sub][ds] && !isRest(ds)) schMap[u.sub][ds] = 'office';
            }
        }

        return visible.map(u => ({
            id:         u.sub,
            name:       u.name || `${u.given_name ?? ''} ${u.family_name ?? ''}`.trim(),
            email:      u.email,
            schedule:   schMap[u.sub]  ?? {},
            siteDetails: siteMap[u.sub] ?? {},
            location:   locMap[u.sub],
            checkIn:    ciMap[u.sub],
        }));
    }, [users, attRecords, year, month, daysInMo]);

    const officeCount = employees.filter(e => e.schedule[selDate] === 'office').length;
    const travelCount = employees.filter(e => e.schedule[selDate] === 'travel').length;
    const leaveCount  = employees.filter(e => e.schedule[selDate] === 'leave').length;

    // 5-day week centred on today
    const weekDays = [-2, -1, 0, 1, 2].map(n => {
        const d = new Date(TODAY_D);
        d.setDate(d.getDate() + n);
        return fmtDate(d);
    });

    const selHoliday = isHol(selDate);
    const selWeekend = isWknd(selDate);
    const selIsRest  = !!(selHoliday || selWeekend);

    return (
        <div className="space-y-5">

            {/* ── Stats ── */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {([
                    { label: 'เข้าออฟฟิศ', count: officeCount,      color: '#16A34A', bg: '#F0FDF4', Icon: Building2 },
                    { label: 'ออกพื้นที่',  count: travelCount,      color: '#B45309', bg: '#FEF3C7', Icon: Car },
                    { label: 'ลางาน',       count: leaveCount,        color: '#6B7280', bg: '#F3F4F6', Icon: null },
                    { label: 'พนักงาน',     count: employees.length,  color: 'var(--color-primary)', bg: 'var(--color-primary)', Icon: null },
                ] as const).map(s => (
                    <div key={s.label} className="card p-4 flex items-center gap-3">
                        {s.Icon ? (
                            <div className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0" style={{ background: s.bg }}>
                                <s.Icon className="w-4 h-4" style={{ color: s.color }} />
                            </div>
                        ) : (
                            <div className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0" style={{ background: s.bg + '22' }}>
                                <span className="text-base font-black" style={{ color: s.color }}>{s.count}</span>
                            </div>
                        )}
                        <div>
                            {s.Icon && <p className="text-xl font-black" style={{ color: s.color }}>{s.count}</p>}
                            <p className="text-[11px] font-semibold" style={{ color: 'var(--color-text-secondary)' }}>{s.label}</p>
                        </div>
                    </div>
                ))}
            </div>

            {/* ── Calendar + Employee list ── */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-5 items-stretch">

                {/* Mini calendar */}
                <div className="card p-5">
                    <div className="flex items-center justify-between mb-4">
                        <button onClick={() => setViewDate(new Date(year, month - 1, 1))} className="btn-icon">
                            <ChevronLeft className="w-4 h-4" />
                        </button>
                        <h3 className="text-sm font-bold" style={{ color: 'var(--color-text-primary)' }}>
                            {TH_MONTHS[month]} {year + 543}
                        </h3>
                        <button onClick={() => setViewDate(new Date(year, month + 1, 1))} className="btn-icon">
                            <ChevronRight className="w-4 h-4" />
                        </button>
                    </div>

                    {/* Day-of-week headers */}
                    <div className="grid grid-cols-7 mb-1">
                        {TH_DAYS_S.map((d, i) => (
                            <div key={d} className="text-center text-[10px] font-bold py-1"
                                style={{ color: i === 0 || i === 6 ? '#EF4444' : 'var(--color-text-tertiary)' }}>
                                {d}
                            </div>
                        ))}
                    </div>

                    {/* Days grid */}
                    <div className="grid grid-cols-7 gap-0.5">
                        {Array.from({ length: firstDay }).map((_, i) => <div key={`e${i}`} />)}
                            {Array.from({ length: daysInMo }).map((_, i) => {
                            const day = i + 1;
                            const ds  = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
                            const isToday = ds === todayStr;
                            const isSel   = ds === selDate;
                            const rest    = isRest(ds);
                            const empCount   = employees.length;
                            const travCount  = employees.filter(e => e.schedule[ds] === 'travel').length;
                            const leaveCount = employees.filter(e => e.schedule[ds] === 'leave').length;
                            const offCount   = empCount - travCount - leaveCount;
                            const hasActivity = !rest && empCount > 0;
                            return (
                                <button key={day} onClick={() => setSelDate(ds)}
                                    className="aspect-square flex flex-col items-center justify-center rounded-xl text-[11px] font-semibold relative transition-all"
                                    style={{
                                        background: isSel ? 'var(--color-primary)' : isToday ? 'rgba(37, 99, 235,0.1)' : 'transparent',
                                        color: isSel ? '#fff' : rest ? '#EF4444' : 'var(--color-text-primary)',
                                        fontWeight: isToday && !isSel ? 800 : undefined,
                                    }}
                                >
                                    {day}
                                    {hasActivity && (travCount > 0 || leaveCount > 0) && (
                                        <div className="absolute bottom-0.5 left-1/2 -translate-x-1/2 flex gap-0.5">
                                            {offCount > 0 && (
                                                <span className="w-1 h-1 rounded-full" style={{ background: isSel ? 'rgba(255,255,255,0.7)' : '#16A34A' }} />
                                            )}
                                            {travCount > 0 && (
                                                <span className="w-1 h-1 rounded-full" style={{ background: isSel ? 'rgba(255,255,255,0.7)' : '#B45309' }} />
                                            )}
                                            {leaveCount > 0 && (
                                                <span className="w-1 h-1 rounded-full" style={{ background: isSel ? 'rgba(255,255,255,0.5)' : '#9CA3AF' }} />
                                            )}
                                        </div>
                                    )}
                                </button>
                            );
                        })}
                    </div>

                    {/* Preview + legend */}
                    <button
                        onClick={() => openPreview('daily', { fallback: `/attendance/daily?date=${selDate}` })}
                        className="btn w-full mt-4 justify-center gap-2 text-[12px]"
                        style={{ borderColor: 'var(--color-border)' }}
                    >
                        <Eye className="w-3.5 h-3.5" />ดู Preview
                    </button>
                    <div className="flex gap-3 mt-3 flex-wrap">
                        {[
                            { color: '#16A34A', label: 'เข้าออฟฟิศ' },
                            { color: '#B45309', label: 'ออกพื้นที่' },
                            { color: '#9CA3AF', label: 'ลางาน' },
                        ].map(l => (
                            <span key={l.label} className="flex items-center gap-1 text-[10px]" style={{ color: 'var(--color-text-tertiary)' }}>
                                <span className="w-2 h-2 rounded-full inline-block" style={{ background: l.color }} />
                                {l.label}
                            </span>
                        ))}
                    </div>
                </div>

                {/* Employee list for selected date */}
                <div className="lg:col-span-2 card p-5 flex flex-col overflow-hidden">
                    <div className="flex items-center justify-between mb-4 flex-shrink-0">
                        <div>
                            <h3 className="text-sm font-bold" style={{ color: 'var(--color-text-primary)' }}>
                                {new Date(selDate + 'T12:00:00').toLocaleDateString('th-TH', {
                                    weekday: 'long', day: 'numeric', month: 'long',
                                })}
                            </h3>
                            {selIsRest && (
                                <p className="text-[11px] mt-0.5 font-semibold" style={{ color: '#EF4444' }}>
                                    {selHoliday ?? (selWeekend ? 'วันหยุดสุดสัปดาห์' : '')}
                                </p>
                            )}
                        </div>
                        <div className="flex items-center gap-2">
                            <span className="text-[11px] px-2 py-1 rounded-full font-semibold"
                                style={{ background: 'var(--color-surface-2)', color: 'var(--color-text-tertiary)' }}>
                                {employees.length} คน
                            </span>
                            <button onClick={loadAtt} className="btn-icon" title="รีเฟรช">
                                <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
                            </button>
                        </div>
                    </div>

                    {loading ? (
                        <div className="flex items-center justify-center py-12 gap-2">
                            <RefreshCw className="w-4 h-4 animate-spin" style={{ color: 'var(--color-text-tertiary)' }} />
                            <span className="text-sm" style={{ color: 'var(--color-text-tertiary)' }}>กำลังโหลด...</span>
                        </div>
                    ) : (
                        <div className="flex-1 min-h-0 overflow-y-auto space-y-2 pr-1">
                            {employees.map((emp, idx) => {
                                const status = emp.schedule[selDate];
                                const site   = emp.siteDetails[selDate];
                                const sm     = status ? STATUS_META[status] : null;
                                return (
                                    <motion.div key={emp.id}
                                        initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }}
                                        transition={{ delay: idx * 0.025 }}
                                        className="flex items-start gap-3 p-3 rounded-xl"
                                        style={{ background: 'var(--color-surface-2)', border: '1px solid var(--color-border)' }}
                                    >
                                        <div className="w-8 h-8 rounded-full flex items-center justify-center text-[10px] font-bold text-white flex-shrink-0"
                                            style={{ background: aColor(emp.id) }}>
                                            {initials(emp.name)}
                                        </div>
                                        <div className="flex-1 min-w-0">
                                            <p className="text-[13px] font-semibold truncate" style={{ color: 'var(--color-text-primary)' }}>{emp.name}</p>
                                            <p className="text-[10px] truncate" style={{ color: 'var(--color-text-tertiary)' }}>{emp.email}</p>
                                            {status === 'travel' && site && (
                                                <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5">
                                                    {site.product  && <p className="text-[10px] font-medium" style={{ color: '#2563EB' }}>{site.product}</p>}
                                                    {site.customer && <p className="text-[10px]" style={{ color: '#B45309' }}>{site.customer}</p>}
                                                </div>
                                            )}
                                            {emp.location && selDate === todayStr && (
                                                <p className="text-[10px] flex items-center gap-1 mt-0.5" style={{ color: 'var(--color-text-tertiary)' }}>
                                                    <MapPin className="w-2.5 h-2.5" />{emp.location}
                                                </p>
                                            )}
                                        </div>
                        <div className="flex items-center gap-1.5 flex-shrink-0">
                                            {sm ? (
                                                <span className="text-[10px] font-semibold px-2 py-1 rounded-lg"
                                                    style={{ background: sm.bg, color: sm.color }}>
                                                    {sm.label}
                                                </span>
                                            ) : (
                                                <span className="text-[10px] font-semibold px-2 py-1 rounded-lg"
                                                    style={{ background: 'var(--color-surface)', color: 'var(--color-text-tertiary)', border: '1px solid var(--color-border)' }}>
                                                    —
                                                </span>
                                            )}
                                        </div>
                                    </motion.div>
                                );
                            })}
                        </div>
                    )}
                </div>
            </div>

            {/* ── Weekly overview table ── */}
            <div className="card p-5 overflow-x-auto">
                <h3 className="text-[12px] font-bold mb-4 uppercase tracking-wide" style={{ color: 'var(--color-text-tertiary)' }}>
                    ภาพรวมสัปดาห์นี้
                </h3>
                <table className="w-full min-w-[480px]">
                    <thead>
                        <tr>
                            <th className="text-left text-[11px] font-bold pb-3 pr-4" style={{ color: 'var(--color-text-tertiary)', width: '36%' }}>พนักงาน</th>
                            {weekDays.map(ds => {
                                const d       = new Date(ds + 'T12:00');
                                const isToday = ds === todayStr;
                                const rest    = isRest(ds);
                                return (
                                    <th key={ds} className="text-center text-[11px] pb-3 px-2"
                                        style={{ color: isToday ? 'var(--color-primary)' : rest ? '#EF4444' : 'var(--color-text-tertiary)', fontWeight: isToday ? 800 : 600 }}>
                                        {d.toLocaleDateString('th-TH', { weekday: 'short' })}<br />
                                        <span className="text-[10px]">{d.getDate()}/{d.getMonth() + 1}</span>
                                    </th>
                                );
                            })}
                        </tr>
                    </thead>
                    <tbody>
                        {employees.map(emp => (
                            <tr key={emp.id} className="border-t" style={{ borderColor: 'var(--color-border)' }}>
                                <td className="py-2.5 pr-4">
                                    <div className="flex items-center gap-2">
                                        <div className="w-6 h-6 rounded-full flex items-center justify-center text-[8px] font-bold text-white flex-shrink-0"
                                            style={{ background: aColor(emp.id) }}>
                                            {initials(emp.name).slice(0, 1)}
                                        </div>
                                        <span className="text-[12px] font-semibold truncate" style={{ color: 'var(--color-text-primary)', maxWidth: 140 }}>{emp.name}</span>
                                    </div>
                                </td>
                                {weekDays.map(ds => {
                                    const status = emp.schedule[ds];
                                    const sm     = status ? STATUS_META[status] : null;
                                    const rest   = isRest(ds);
                                    return (
                                        <td key={ds} className="text-center py-2.5 px-2">
                                            <div className="flex justify-center">
                                                {sm ? (
                                                    <div className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ background: sm.bg }}>
                                                        {sm.Icon
                                                            ? <sm.Icon className="w-3.5 h-3.5" style={{ color: sm.color }} />
                                                            : <span className="text-[8px] font-bold" style={{ color: sm.color }}>ลา</span>}
                                                    </div>
                                                ) : rest ? (
                                                    <div className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ background: '#FEF2F2' }}>
                                                        <span className="text-[8px]" style={{ color: '#EF4444' }}>หยุด</span>
                                                    </div>
                                                ) : (
                                                    <div className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ background: 'var(--color-surface-2)' }}>
                                                        <span className="text-[9px]" style={{ color: 'var(--color-text-tertiary)' }}>—</span>
                                                    </div>
                                                )}
                                            </div>
                                        </td>
                                    );
                                })}
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    );
}
