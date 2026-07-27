import { useState, useEffect, useCallback, useRef } from 'react';
import { useSearchParams, useParams } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
    Building2, Car, Users, RefreshCw, MapPin,
    Package, UserCheck, FileText, Coffee,
    Moon, Sun,
} from 'lucide-react';
import { useTheme } from '../context/ThemeContext';
import ThaiDatePicker, { formatThaiDate } from '../components/ThaiDatePicker';
import { groupByTeam } from '../lib/teams';

// ─── Types ────────────────────────────────────────────────────────────────────
interface TaskVisitEntry {
    customer: string;
    product:  string | null;
    logo_url: string | null;
    color:    string | null;
    notes:    string | null;
    site:     string | null;
}
interface AttendanceEntry {
    id: string;
    name: string;
    email: string;
    role: string;
    user_group?: string;
    attendance: {
        status: string;
        location: string | null;
        product: string | null;
        customer: string | null;
        check_in: string | null;
        check_out: string | null;
        note: string | null;
    } | null;
    task_visits: TaskVisitEntry[];
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
const AVATAR_COLORS = ['#2563EB','#0EA5E9','#3B82F6','#1D4ED8','#0891B2','#6366F1'];

function getThaiDate(): string {
    return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' });
}

function getInitials(name: string): string {
    const parts = name.trim().split(/\s+/);
    if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
    return name.slice(0, 2).toUpperCase();
}

function avatarColor(id: string): string {
    let hash = 0;
    for (let i = 0; i < id.length; i++) hash = id.charCodeAt(i) + ((hash << 5) - hash);
    return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}

// ─── Small Name Chip (for office list) ────────────────────────────────────────
function NameChip({ emp, idx }: { emp: AttendanceEntry; idx: number }) {
    const bg = avatarColor(emp.id);
    const att = emp.attendance;
    return (
        <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: idx * 0.03 }}
            className="flex items-center gap-2.5 px-3 py-2 rounded-xl"
            style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}
        >
            <div
                className="w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-bold text-white flex-shrink-0"
                style={{ background: bg }}
            >
                {getInitials(emp.name)}
            </div>
            <div className="min-w-0">
                <p className="text-[12px] font-semibold truncate" style={{ color: 'var(--color-text-primary)' }}>
                    {emp.name}
                </p>
                {att?.check_in && (
                    <p className="text-[10px]" style={{ color: 'var(--color-text-tertiary)' }}>
                        {att.check_in.slice(0, 5)}
                        {att.check_out ? ` – ${att.check_out.slice(0, 5)}` : ''}
                    </p>
                )}
            </div>
        </motion.div>
    );
}

// ─── Travel Card (shows visit details) ────────────────────────────────────────
function TravelCard({ emp, idx, extraVisits }: { emp: AttendanceEntry; idx: number; extraVisits?: TaskVisitEntry[] }) {
    const bg = avatarColor(emp.id);
    const att = emp.attendance;
    return (
        <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: idx * 0.04 }}
            className="flex items-start gap-3 p-3.5 rounded-xl"
            style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}
        >
            <div
                className="w-9 h-9 rounded-full flex items-center justify-center text-xs font-bold text-white flex-shrink-0 mt-0.5"
                style={{ background: bg }}
            >
                {getInitials(emp.name)}
            </div>
            <div className="flex-1 min-w-0">
                <p className="text-[13px] font-bold truncate" style={{ color: 'var(--color-text-primary)' }}>
                    {emp.name}
                </p>
                {/* Attendance-level details */}
                {att && (
                    <div className="mt-1 space-y-0.5">
                        {att.location && (
                            <p className="text-[11px] flex items-center gap-1.5" style={{ color: 'var(--color-text-secondary)' }}>
                                <MapPin className="w-3 h-3 flex-shrink-0" style={{ color: 'var(--color-text-tertiary)' }} />
                                <span>{att.location}</span>
                            </p>
                        )}
                        {att.note && (
                            <p className="text-[11px] flex items-start gap-1.5" style={{ color: 'var(--color-text-secondary)' }}>
                                <FileText className="w-3 h-3 flex-shrink-0 mt-0.5" style={{ color: 'var(--color-text-tertiary)' }} />
                                <span className="break-words">{att.note}</span>
                            </p>
                        )}
                    </div>
                )}
                {/* Task-visit details */}
                {extraVisits && extraVisits.length > 0 && (
                    <div className="mt-1 space-y-1">
                        {extraVisits.map((v, i) => (
                            /* Site is intentionally omitted — the site/customer is
                               already shown in the group heading above this card. */
                            <div key={i} className="space-y-0.5">
                                {v.notes && (
                                    <p className="text-[11px] flex items-start gap-1.5" style={{ color: 'var(--color-text-secondary)' }}>
                                        <FileText className="w-3 h-3 flex-shrink-0 mt-0.5" style={{ color: 'var(--color-text-tertiary)' }} />
                                        <span className="break-words">{v.notes}</span>
                                    </p>
                                )}
                            </div>
                        ))}
                    </div>
                )}
                {att?.check_in && (
                    <p className="text-[10px] mt-1" style={{ color: 'var(--color-text-tertiary)' }}>
                        เข้า {att.check_in.slice(0, 5)}
                        {att.check_out ? ` – ออก ${att.check_out.slice(0, 5)}` : ''}
                    </p>
                )}
            </div>
        </motion.div>
    );
}

// ─── Main Page ────────────────────────────────────────────────────────────────
export default function DailyPreview() {
    const { token } = useParams<{ token?: string }>();
    const [searchParams, setSearchParams] = useSearchParams();
    const dateParam = searchParams.get('date') ?? getThaiDate();
    const { theme, toggleTheme } = useTheme();
    const [data, setData]               = useState<AttendanceEntry[]>([]);
    const [loading, setLoading]         = useState(true);
    const [lastRefresh, setLastRefresh] = useState(new Date());
    const [selectedDate, setSelectedDate] = useState(dateParam);

    // Keep URL in sync whenever selectedDate changes
    useEffect(() => {
        setSearchParams({ date: selectedDate }, { replace: true });
    }, [selectedDate, setSearchParams]);

    const dateLabel = formatThaiDate(selectedDate, true);

    // Track the date that was used for the last successful fetch
    const lastFetchedDate = useRef(selectedDate);

    const load = useCallback(async (showLoader = true) => {
        if (showLoader) setLoading(true);
        try {
            const endpoint = token
                ? `/api/preview/daily/${token}?date=${selectedDate}`
                : `/api/attendance/daily?date=${selectedDate}`;
            const res = await fetch(endpoint);
            const json = await res.json();
            setData(Array.isArray(json) ? json : []);
            setLastRefresh(new Date());
            lastFetchedDate.current = selectedDate;
        } catch (e) { console.error(e); }
        if (showLoader) setLoading(false);
    }, [selectedDate, token]);

    // Fetch on selectedDate change
    useEffect(() => { load(); }, [load]);

    // Poll every 30 seconds
    useEffect(() => {
        const id = setInterval(() => load(false), 30_000);
        return () => clearInterval(id);
    }, [load]);

    // ── On mount: if URL date is stale (before today) → switch to today ────────
    useEffect(() => {
        const urlDate = searchParams.get('date');
        const today = getThaiDate();
        if (urlDate && urlDate < today) {
            setSelectedDate(today);
        }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // ── Visibility change: refresh immediately when tab becomes visible ───────
    // Browsers throttle setInterval in background tabs (1-60s+), so polling
    // becomes unreliable. This ensures data is fresh when the user returns.
    useEffect(() => {
        const onVisible = () => {
            if (document.visibilityState !== 'visible') return;
            // Check midnight date roll first
            const today = getThaiDate();
            if (selectedDate !== today) {
                setSelectedDate(today); // this triggers load() via the [load] effect
            } else {
                load(false); // same day — just refresh data silently
            }
        };
        document.addEventListener('visibilitychange', onVisible);
        return () => document.removeEventListener('visibilitychange', onVisible);
    }, [selectedDate, load]);

    // ── Auto-change date at midnight (Thai time) ──────────────────────────────
    // Uses both setInterval AND a precise setTimeout to the next midnight.
    useEffect(() => {
        const checkMidnight = () => {
            const today = getThaiDate();
            setSelectedDate(prev => prev !== today ? today : prev);
        };

        // Calculate ms until next midnight (Thailand UTC+7)
        const now = new Date();
        const bangkokNow = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Bangkok' }));
        const nextMidnight = new Date(bangkokNow);
        nextMidnight.setDate(nextMidnight.getDate() + 1);
        nextMidnight.setHours(0, 0, 1, 0); // 00:00:01 to avoid edge
        const msToMidnight = nextMidnight.getTime() - bangkokNow.getTime();

        // Precise timer for midnight rollover
        const midnightTimer = setTimeout(() => {
            checkMidnight();
        }, msToMidnight);

        // Fallback: check every 30 seconds (short enough to catch it even with throttling)
        const intervalId = setInterval(checkMidnight, 30_000);

        return () => { clearTimeout(midnightTimer); clearInterval(intervalId); };
    }, []);

    // ── Categorize ────────────────────────────────────────────────────────────
    const dow = new Date(selectedDate + 'T12:00:00').getDay();
    const isWeekday = dow >= 1 && dow <= 5;

    // "travel" = explicit travel status OR has task_visits
    const travel = data.filter(e =>
        e.attendance?.status === 'travel' || e.task_visits.length > 0
    );
    const leave = data.filter(e => e.attendance?.status === 'leave');
    const travelIds = new Set(travel.map(e => e.id));
    const leaveIds = new Set(leave.map(e => e.id));

    // "office" = explicit office status, OR on weekdays: everyone not traveling/on leave
    const office = data.filter(e => {
        if (travelIds.has(e.id) || leaveIds.has(e.id)) return false;
        if (e.attendance?.status === 'office') return true;
        if (!e.attendance && isWeekday) return true;
        return false;
    });

    // ── Build product → customer → employees groups for travel section ────────
    type SiteEmpEntry = { emp: AttendanceEntry; tv: TaskVisitEntry | null };
    type SiteProduct = {
        logo_url: string | null;
        color:    string | null;
        custGroups: Record<string, SiteEmpEntry[]>;
    };
    const siteProducts: Record<string, SiteProduct> = {};
    const addToProduct = (key: string, logo: string | null, color: string | null, cust: string, emp: AttendanceEntry, tv: TaskVisitEntry | null = null) => {
        if (!siteProducts[key]) siteProducts[key] = { logo_url: logo, color, custGroups: {} };
        if (!siteProducts[key].custGroups[cust]) siteProducts[key].custGroups[cust] = [];
        if (!siteProducts[key].custGroups[cust].find(x => x.emp.id === emp.id))
            siteProducts[key].custGroups[cust].push({ emp, tv });
    };

    const notesEntries: { emp: AttendanceEntry; visits: TaskVisitEntry[] }[] = [];

    for (const e of travel) {
        if (e.task_visits.length > 0) {
            const taskVisits  = e.task_visits.filter(tv => tv.customer !== null);
            const notesVisits = e.task_visits.filter(tv => tv.customer === null);
            if (taskVisits.length > 0) {
                for (const tv of taskVisits) {
                    addToProduct(tv.product || '_none', tv.logo_url, tv.color, tv.customer || 'ไม่ระบุลูกค้า', e, tv);
                }
            }
            if (notesVisits.length > 0) {
                notesEntries.push({ emp: e, visits: notesVisits });
            }
            if (taskVisits.length === 0 && notesVisits.length === 0) {
                addToProduct('_none', null, null, 'ไม่ระบุลูกค้า', e);
            }
        } else {
            addToProduct(e.attendance?.product || '_none', null, null, e.attendance?.customer || 'ไม่ระบุลูกค้า', e);
        }
    }

    const totalCount = data.length;

    return (
        <div className="min-h-screen" style={{ background: 'var(--color-surface-2)' }}>

            {/* ── Header ── */}
            <div className="sticky top-0 z-10 px-6 py-4"
                style={{ background: 'var(--color-surface)', borderBottom: '1px solid var(--color-border)' }}>
                <div className="max-w-6xl mx-auto flex items-center justify-between gap-4">
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0">
                            <img src="/TENIX1.png" alt="Operations One Platform" className="w-9 h-9 object-contain" />
                        </div>
                        <div>
                            <div className="flex items-center gap-1.5">
                                <h1 className="text-[15px] font-bold leading-none" style={{ color: 'var(--color-text-primary)' }}>OPERATIONS ONE PLATFORM</h1>
                                <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded uppercase tracking-wider" style={{ background: 'var(--color-primary-soft)', color: 'var(--color-primary)' }}>Daily Board</span>
                            </div>
                            <p className="text-xs mt-1" style={{ color: 'var(--color-text-secondary)' }}>{dateLabel}</p>
                        </div>
                    </div>
                    <div className="flex items-center gap-3">
                        <div style={{ position: 'relative', display: 'inline-flex', alignItems: 'center', minWidth: 180 }}>
                            <ThaiDatePicker value={selectedDate} onChange={v => { if (v) setSelectedDate(v); }} allowClear={false} size="small" />
                        </div>
                        <button onClick={() => load()} className="btn-icon" title="รีเฟรช" disabled={loading}>
                            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
                        </button>
                        <button onClick={toggleTheme} className="btn-icon" title={theme === 'dark' ? 'Light Mode' : 'Dark Mode'}>
                            {theme === 'dark' ? <Sun className="w-4 h-4" style={{ color: '#F59E0B' }} /> : <Moon className="w-4 h-4" />}
                        </button>
                        <p className="text-[11px] hidden md:block" style={{ color: 'var(--color-text-tertiary)' }}>
                            อัพเดท {lastRefresh.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone: 'Asia/Bangkok' })}
                        </p>
                    </div>
                </div>
            </div>

            {/* ── Stats bar ── */}
            <div className="px-6 py-3" style={{ borderBottom: '1px solid var(--color-border)', background: 'var(--color-surface)' }}>
                <div className="max-w-6xl mx-auto flex flex-wrap gap-4">
                    {[
                        { icon: Users,     label: 'ทั้งหมด',    count: totalCount, color: 'var(--color-text-secondary)', bg: 'var(--color-surface-2)' },
                        { icon: Building2, label: 'เข้าออฟฟิศ',  count: office.length, color: '#10B981', bg: '#ECFDF5' },
                        { icon: Car,       label: 'ออกพื้นที่',  count: travel.length, color: '#F59E0B', bg: '#FFFBEB' },
                        ...(leave.length > 0 ? [{ icon: Coffee, label: 'ลางาน', count: leave.length, color: '#9CA3AF', bg: '#F3F4F6' }] : []),
                    ].map(({ icon: Icon, label, count, color, bg }) => (
                        <div key={label} className="flex items-center gap-2 px-3 py-1.5 rounded-lg" style={{ background: bg }}>
                            <Icon className="w-3.5 h-3.5" style={{ color }} />
                            <span className="text-sm font-bold" style={{ color }}>{count}</span>
                            <span className="text-[11px]" style={{ color }}>{label}</span>
                        </div>
                    ))}
                </div>
            </div>

            {/* ── Content ── */}
            {loading ? (
                <div className="flex items-center justify-center py-32">
                    <RefreshCw className="w-6 h-6 animate-spin" style={{ color: 'var(--color-text-tertiary)' }} />
                    <span className="ml-3 text-sm" style={{ color: 'var(--color-text-tertiary)' }}>กำลังโหลด...</span>
                </div>
            ) : (
                <div className="max-w-6xl mx-auto px-6 py-6 space-y-5">

                    {/* ── Office Section ── */}
                    <div className="rounded-2xl p-5" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
                        <div className="flex items-center gap-2.5 mb-4">
                            <Building2 className="w-4.5 h-4.5" style={{ color: '#10B981' }} />
                            <span className="text-[14px] font-bold" style={{ color: 'var(--color-text-primary)' }}>เข้าออฟฟิศ</span>
                            <span className="text-[11px] px-2 py-0.5 rounded-full font-semibold"
                                style={{ background: '#10B98118', color: '#10B981' }}>{office.length} คน</span>
                        </div>
                        {office.length === 0 ? (
                            <p className="text-sm text-center py-4" style={{ color: 'var(--color-text-tertiary)' }}>
                                ไม่มีพนักงานเข้าออฟฟิศ
                            </p>
                        ) : (
                            /* Split by team so it is obvious how many each group has */
                            <div className="space-y-4">
                                {groupByTeam(office).map(([team, members]) => (
                                    <div key={team}>
                                        <div className="flex items-center gap-2 mb-2">
                                            <span className="text-[12px] font-bold" style={{ color: 'var(--color-text-secondary)' }}>{team}</span>
                                            <span className="text-[10px] px-1.5 py-0.5 rounded-full font-semibold"
                                                style={{ background: '#10B98118', color: '#10B981' }}>{members.length} คน</span>
                                            <span className="flex-1 h-px" style={{ background: 'var(--color-border)' }} />
                                        </div>
                                        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-2">
                                            {members.map((emp, idx) => (
                                                <NameChip key={emp.id} emp={emp} idx={idx} />
                                            ))}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>

                    {/* ── Leave Section ── */}
                    {leave.length > 0 && (
                        <div className="rounded-2xl p-5" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
                            <div className="flex items-center gap-2.5 mb-4">
                                <Coffee className="w-4.5 h-4.5" style={{ color: '#9CA3AF' }} />
                                <span className="text-[14px] font-bold" style={{ color: 'var(--color-text-primary)' }}>ลางาน</span>
                                <span className="text-[11px] px-2 py-0.5 rounded-full font-semibold"
                                    style={{ background: '#9CA3AF18', color: '#9CA3AF' }}>{leave.length} คน</span>
                            </div>
                            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-2">
                                {leave.map((emp, idx) => (
                                    <NameChip key={emp.id} emp={emp} idx={idx} />
                                ))}
                            </div>
                        </div>
                    )}

                    {/* ── Travel / Site Section ── */}
                    <div className="rounded-2xl p-5" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
                        <div className="flex items-center gap-2.5 mb-4">
                            <Car className="w-4.5 h-4.5" style={{ color: '#F59E0B' }} />
                            <span className="text-[14px] font-bold" style={{ color: 'var(--color-text-primary)' }}>ออกพื้นที่ / Site งาน</span>
                            <span className="text-[11px] px-2 py-0.5 rounded-full font-semibold"
                                style={{ background: '#F59E0B18', color: '#F59E0B' }}>{travel.length} คน</span>
                        </div>
                        {travel.length === 0 ? (
                            <p className="text-sm text-center py-4" style={{ color: 'var(--color-text-tertiary)' }}>
                                ไม่มีพนักงานออกพื้นที่
                            </p>
                        ) : (
                            <div className="space-y-5">
                                {Object.entries(siteProducts).map(([productKey, { logo_url, color, custGroups }]) => {
                                    const productName = productKey === '_none' ? 'ยังไม่ระบุ Product' : productKey;
                                    const totalInProd = Object.values(custGroups).flat().length;
                                    return (
                                        <div key={productKey}>
                                            {/* Product header */}
                                            <div className="flex items-center gap-2.5 mb-3">
                                                {logo_url ? (
                                                    <img src={logo_url} alt={productName}
                                                        className="w-6 h-6 rounded object-contain flex-shrink-0"
                                                        style={{ background: 'white', padding: '2px', border: '1px solid var(--color-border)' }} />
                                                ) : (
                                                    <Package className="w-4 h-4" style={{ color: color ?? 'var(--color-text-tertiary)' }} />
                                                )}
                                                <span className="text-[13px] font-bold" style={{ color: 'var(--color-text-primary)' }}>{productName}</span>
                                                <span className="text-[10px] px-1.5 py-0.5 rounded font-medium"
                                                    style={{ background: 'var(--color-surface-2)', color: 'var(--color-text-secondary)' }}>
                                                    {totalInProd} คน
                                                </span>
                                            </div>
                                            {/* Customer sub-groups */}
                                            {Object.entries(custGroups).map(([cust, custEmps]) => {
                                                const sites = [...new Set(custEmps.map(e => e.tv?.site).filter(Boolean))] as string[];
                                                return (
                                                <div key={cust} className="mb-3 ml-3">
                                                    <p className="text-[11px] font-medium mb-2 flex items-center gap-1.5 flex-wrap"
                                                        style={{ color: 'var(--color-text-secondary)' }}>
                                                        <UserCheck className="w-3 h-3" style={{ color: 'var(--color-text-tertiary)' }} />
                                                        {cust}
                                                        {sites.length > 0 && (
                                                            <span>
                                                                ไปที่ <span style={{ color: 'var(--color-primary)', fontWeight: 600 }}>{sites.join(', ')}</span>
                                                            </span>
                                                        )}
                                                        <span>จำนวน {custEmps.length} คน</span>
                                                    </p>
                                                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-2">
                                                        {custEmps.map(({ emp, tv }, idx) => (
                                                            <TravelCard
                                                                key={emp.id}
                                                                emp={emp}
                                                                idx={idx}
                                                                extraVisits={tv ? [tv] : undefined}
                                                            />
                                                        ))}
                                                    </div>
                                                </div>
                                                );
                                            })}
                                        </div>
                                    );
                                })}

                                {/* Notes-only section */}
                                {notesEntries.length > 0 && (() => {
                                    const notesByProduct: Record<string, { emp: AttendanceEntry; visits: TaskVisitEntry[] }[]> = {};
                                    for (const entry of notesEntries) {
                                        const prod = entry.visits.find(v => v.product)?.product ?? '_none';
                                        (notesByProduct[prod] ??= []).push(entry);
                                    }
                                    return Object.entries(notesByProduct).map(([prod, entries]) => {
                                        const logoEntry = entries[0]?.visits.find(v => v.logo_url);
                                        return (
                                            <div key={prod}>
                                                <div className="flex items-center gap-2.5 mb-3">
                                                    {logoEntry?.logo_url ? (
                                                        <img src={logoEntry.logo_url} alt={prod}
                                                            className="w-6 h-6 rounded object-contain flex-shrink-0"
                                                            style={{ background: 'white', padding: '2px', border: '1px solid var(--color-border)' }} />
                                                    ) : (
                                                        <FileText className="w-4 h-4" style={{ color: 'var(--color-text-tertiary)' }} />
                                                    )}
                                                    <span className="text-[13px] font-bold" style={{ color: 'var(--color-text-primary)' }}>
                                                        {prod !== '_none' ? prod : 'บันทึกกิจกรรม'}
                                                    </span>
                                                    <span className="text-[10px] px-1.5 py-0.5 rounded font-medium"
                                                        style={{ background: 'var(--color-surface-2)', color: 'var(--color-text-secondary)' }}>
                                                        {entries.length} รายการ
                                                    </span>
                                                </div>
                                                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-2 ml-3">
                                                    {entries.map(({ emp, visits }, idx) => (
                                                        <TravelCard key={emp.id + '_notes'} emp={emp} idx={idx} extraVisits={visits} />
                                                    ))}
                                                </div>
                                            </div>
                                        );
                                    });
                                })()}
                            </div>
                        )}
                    </div>

                    <p className="text-center text-[10px] pb-4" style={{ color: 'var(--color-text-tertiary)' }}>
                        รีเฟรชอัตโนมัติทุก 30 วินาที
                    </p>
                </div>
            )}
        </div>
    );
}
