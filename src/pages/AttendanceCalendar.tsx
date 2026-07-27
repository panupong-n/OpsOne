import { toast } from 'sonner';
import { isHoliday, useHolidays } from '../lib/holidays';
import { useState, useEffect, useCallback } from 'react';
import { motion } from 'framer-motion';
import { openPreview } from '../lib/preview';
import { Modal } from '../components/ui/modal';
import {
    ChevronLeft, ChevronRight, Building2, Car, MapPin,
    X, RefreshCw, Eye, type LucideIcon, Package, UserCheck,
    Sun,
} from 'lucide-react';

// ─── Types ────────────────────────────────────────────────────────────────────
type AttendanceStatus = 'office' | 'travel';

interface AttendanceRecord {
    id: string;
    employee_id: string;
    date: string;
    status: string;
    location: string | null;
    check_in: string | null;
    check_out: string | null;
    note: string | null;
    product: string | null;
    customer: string | null;
}

interface PlatformUser {
    sub: string;
    email: string;
    name: string;
    given_name: string;
    family_name: string;
    role: string;
    visible?: boolean;
}

interface SiteInfo {
    product: string | null;
    customer: string | null;
}

interface Employee {
    id: string;
    name: string;
    email: string;
    role: string;
    avatar: string;
    schedule: Record<string, AttendanceStatus | undefined>;
    siteDetails: Record<string, SiteInfo>;
    location?: string;
    checkIn?: string;
}

// ─── Thai Public Holidays ────────────────────────────────────────────────────



function isWeekend(dateStr: string): boolean {
    const dow = new Date(dateStr + 'T12:00:00').getDay();
    return dow === 0 || dow === 6;
}

function isRestDay(dateStr: string): boolean {
    return isWeekend(dateStr) || !!isHoliday(dateStr);
}

// ─── Constants ────────────────────────────────────────────────────────────────
const STATUS: Record<AttendanceStatus, { label: string; color: string; bg: string; textColor: string; icon: LucideIcon }> = {
    office: { label: 'เข้าออฟฟิศ', color: '#10B981', bg: '#ECFDF5', textColor: '#065F46', icon: Building2 },
    travel: { label: 'ออกพื้นที่',  color: '#F59E0B', bg: '#FFFBEB', textColor: '#B45309', icon: Car      },
};

const TH_MONTHS = ['มกราคม','กุมภาพันธ์','มีนาคม','เมษายน','พฤษภาคม','มิถุนายน','กรกฎาคม','สิงหาคม','กันยายน','ตุลาคม','พฤศจิกายน','ธันวาคม'];
const TH_DAYS   = ['อา','จ','อ','พ','พฤ','ศ','ส'];
const AVATAR_COLORS = ['#2563EB','#0EA5E9','#3B82F6','#1D4ED8','#0891B2','#6366F1'];

const TODAY = new Date();
const fmt = (d: Date) => d.toISOString().slice(0, 10);
const dayOffset = (n: number) => { const d = new Date(TODAY); d.setDate(d.getDate() + n); return fmt(d); };

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

// ─── Site Modal ───────────────────────────────────────────────────────────────
interface SiteModalProps {
    empName: string;
    date: string;
    initial?: SiteInfo;
    onConfirm: (info: SiteInfo) => void;
    onCancel: () => void;
}

function SiteModal({ empName, date, initial, onConfirm, onCancel }: SiteModalProps) {
    const [product,  setProduct]  = useState(initial?.product  ?? '');
    const [customer, setCustomer] = useState(initial?.customer ?? '');

    const dateLabel = new Date(date + 'T12:00:00').toLocaleDateString('th-TH', {
        weekday: 'long', day: 'numeric', month: 'long',
    });

    return (
        <Modal isOpen onClose={onCancel} showCloseButton={false}
            className="w-full max-w-sm m-4 overflow-hidden">
                <div className="flex items-center justify-between px-6 py-4" style={{ borderBottom: '1px solid var(--color-border)' }}>
                    <div>
                        <div className="flex items-center gap-2">
                            <Car className="w-4 h-4" style={{ color: '#F59E0B' }} />
                            <p className="text-sm font-bold" style={{ color: 'var(--color-text-primary)' }}>ออกพื้นที่ / Site งาน</p>
                        </div>
                        <p className="text-[11px] mt-0.5" style={{ color: 'var(--color-text-tertiary)' }}>
                            {empName} · {dateLabel}
                        </p>
                    </div>
                    <button onClick={onCancel} className="btn-icon"><X className="w-4 h-4" /></button>
                </div>
                <div className="p-6 space-y-4">
                    <div>
                        <label className="field-label flex items-center gap-1.5 mb-1.5">
                            <Package className="w-3.5 h-3.5" style={{ color: '#2563EB' }} />
                            Product
                        </label>
                        <input
                            type="text"
                            value={product}
                            onChange={e => setProduct(e.target.value)}
                            placeholder="ระบุ Product..."
                            className="input w-full"
                            autoFocus
                        />
                    </div>
                    <div>
                        <label className="field-label flex items-center gap-1.5 mb-1.5">
                            <UserCheck className="w-3.5 h-3.5" style={{ color: '#F59E0B' }} />
                            ลูกค้า (Customer)
                        </label>
                        <input
                            type="text"
                            value={customer}
                            onChange={e => setCustomer(e.target.value)}
                            placeholder="ระบุชื่อลูกค้า..."
                            className="input w-full"
                            onKeyDown={e => { if (e.key === 'Enter') onConfirm({ product: product.trim() || null, customer: customer.trim() || null }); }}
                        />
                    </div>
                </div>
                <div className="px-6 pb-6 flex gap-3">
                    <button onClick={onCancel} className="btn flex-1 justify-center"
                        style={{ background: 'var(--color-surface-2)', color: 'var(--color-text-secondary)' }}>
                        ยกเลิก
                    </button>
                    <button
                        onClick={() => onConfirm({ product: product.trim() || null, customer: customer.trim() || null })}
                        className="btn btn-primary flex-1 justify-center gap-2"
                    >
                        <Car className="w-3.5 h-3.5" />
                        ยืนยันออกพื้นที่
                    </button>
                </div>
        </Modal>
    );
}

// ─── Main Calendar Page ───────────────────────────────────────────────────────
export default function AttendanceCalendar() {
    useHolidays();   // re-render when the daily holiday sync lands
    const [viewDate,     setViewDate]   = useState(new Date());
    const [selectedDate, setSelectedDate] = useState(fmt(TODAY));
    const [employees,    setEmployees]  = useState<Employee[]>([]);
    const [loading,      setLoading]    = useState(true);
    const [siteModal,    setSiteModal]  = useState<{ empId: string; empName: string; date: string } | null>(null);

    const year        = viewDate.getFullYear();
    const month       = viewDate.getMonth();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const firstDay    = new Date(year, month, 1).getDay();
    const todayStr    = fmt(TODAY);

    // ── Load data ─────────────────────────────────────────────────────────────
    const loadData = useCallback(async () => {
        setLoading(true);
        try {
            const [usersRes, attRes] = await Promise.all([
                fetch('/api/users'),
                fetch(`/api/attendance?year=${year}&month=${month + 1}`),
            ]);
            const users: PlatformUser[] = usersRes.ok ? await usersRes.json() : [];
            // Only show visible users in attendance calendar
            const visibleUsers = users.filter(u => u.visible !== false);
            const records: AttendanceRecord[] = attRes.ok ? await attRes.json() : [];

            const scheduleMap:    Record<string, Record<string, AttendanceStatus>> = {};
            const siteDetailsMap: Record<string, Record<string, SiteInfo>>         = {};
            const locationMap:    Record<string, string> = {};
            const checkInMap:     Record<string, string> = {};

            for (const r of records) {
                if (!scheduleMap[r.employee_id])    scheduleMap[r.employee_id]    = {};
                if (!siteDetailsMap[r.employee_id]) siteDetailsMap[r.employee_id] = {};
                const dateStr = r.date.slice(0, 10);
                scheduleMap[r.employee_id][dateStr]    = r.status as AttendanceStatus;
                siteDetailsMap[r.employee_id][dateStr] = { product: r.product, customer: r.customer };
                if (r.location) locationMap[r.employee_id] = r.location;
                if (r.check_in) checkInMap[r.employee_id]  = r.check_in.slice(0, 5);
            }

            // Auto-fill weekdays (Mon–Fri, non-holiday) as 'office' if no DB record
            for (const u of visibleUsers) {
                if (!scheduleMap[u.sub]) scheduleMap[u.sub] = {};
                for (let day = 1; day <= daysInMonth; day++) {
                    const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
                    if (!scheduleMap[u.sub][dateStr] && !isRestDay(dateStr)) {
                        scheduleMap[u.sub][dateStr] = 'office';
                    }
                }
            }

            const emps: Employee[] = visibleUsers.map(u => ({
                id:          u.sub,
                name:        u.name || `${u.given_name} ${u.family_name}`,
                email:       u.email,
                role:        u.role,
                avatar:      getInitials(u.name || `${u.given_name} ${u.family_name}`),
                schedule:    scheduleMap[u.sub]    ?? {},
                siteDetails: siteDetailsMap[u.sub] ?? {},
                location:    locationMap[u.sub],
                checkIn:     checkInMap[u.sub],
            }));

            setEmployees(emps);
        } catch (e) { console.error('load attendance data error', e); }
        setLoading(false);
    }, [year, month]);

    useEffect(() => { loadData(); }, [loadData]);

    // ── Counts for selected date ───────────────────────────────────────────────
    const officeCount = employees.filter(e => e.schedule[selectedDate] === 'office').length;
    const travelCount = employees.filter(e => e.schedule[selectedDate] === 'travel').length;

    // ── Handlers ──────────────────────────────────────────────────────────────
    const confirmSite = async (info: SiteInfo) => {
        if (!siteModal) return;
        try {
            const res = await fetch('/api/attendance', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    employee_id: siteModal.empId,
                    date:        siteModal.date,
                    status:      'travel',
                    product:     info.product,
                    customer:    info.customer,
                }),
            });
            if (!res.ok) throw new Error(await res.text());
            await loadData();
        } catch (e) { console.error(e); toast.error('บันทึกไม่สำเร็จ'); }
        setSiteModal(null);
    };

    return (
        <div className="space-y-6">

            {/* ── Summary cards ── */}
            <div className="grid grid-cols-2 gap-4">
                {([
                    { s: 'office' as AttendanceStatus, count: officeCount },
                    { s: 'travel' as AttendanceStatus, count: travelCount },
                ]).map(({ s, count }) => {
                    const m = STATUS[s];
                    const Icon = m.icon;
                    return (
                        <div key={s} className="card p-5 flex items-center gap-4">
                            <div className="w-11 h-11 rounded-xl flex items-center justify-center flex-shrink-0"
                                style={{ background: m.bg }}>
                                <Icon className="w-5 h-5" style={{ color: m.color }} />
                            </div>
                            <div>
                                <p className="text-2xl font-black" style={{ color: m.color }}>{count}</p>
                                <p className="text-xs font-semibold" style={{ color: 'var(--color-text-secondary)' }}>{m.label}</p>
                            </div>
                        </div>
                    );
                })}
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

                {/* ── Calendar ── */}
                <div>
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

                        <div className="grid grid-cols-7 mb-1">
                            {TH_DAYS.map((d, i) => (
                                <div key={d} className="text-center text-[10px] font-bold py-1"
                                    style={{ color: i === 0 || i === 6 ? '#EF4444' : 'var(--color-text-tertiary)' }}>
                                    {d}
                                </div>
                            ))}
                        </div>

                        <div className="grid grid-cols-7 gap-0.5">
                            {Array.from({ length: firstDay }).map((_, i) => <div key={`e${i}`} />)}
                            {Array.from({ length: daysInMonth }).map((_, i) => {
                                const day     = i + 1;
                                const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
                                const isToday = dateStr === todayStr;
                                const isSel   = dateStr === selectedDate;
                                const isRest  = isRestDay(dateStr);
                                const hName   = isHoliday(dateStr);
                                const dow     = new Date(dateStr + 'T12:00:00').getDay();
                                const isWE    = dow === 0 || dow === 6;
                                const hasOff  = employees.some(e => e.schedule[dateStr] === 'office');
                                const hasTrav = employees.some(e => e.schedule[dateStr] === 'travel');

                                return (
                                    <button
                                        key={day}
                                        onClick={() => setSelectedDate(dateStr)}
                                        title={hName ?? (isWE ? 'วันหยุดสุดสัปดาห์' : undefined)}
                                        className="aspect-square flex flex-col items-center justify-center rounded-xl text-xs font-semibold relative transition-all"
                                        style={{
                                            background: isSel
                                                ? 'var(--color-primary)'
                                                : isToday
                                                ? 'var(--color-primary-soft)'
                                                : isRest
                                                ? '#FEF2F2'
                                                : 'transparent',
                                            color: isSel
                                                ? '#fff'
                                                : isToday
                                                ? 'var(--color-primary)'
                                                : isRest
                                                ? '#EF4444'
                                                : 'var(--color-text-primary)',
                                        }}
                                    >
                                        {day}
                                        {isRest && !isSel && (
                                            <Sun className="w-2 h-2 absolute top-0.5 right-0.5 opacity-50" style={{ color: '#EF4444' }} />
                                        )}
                                        {(hasOff || hasTrav) && (
                                            <div className="absolute bottom-0.5 flex gap-0.5 justify-center">
                                                {hasOff  && <span className="w-1 h-1 rounded-full" style={{ background: isSel ? 'rgba(255,255,255,0.7)' : '#10B981' }} />}
                                                {hasTrav && <span className="w-1 h-1 rounded-full" style={{ background: isSel ? 'rgba(255,255,255,0.7)' : '#F59E0B' }} />}
                                            </div>
                                        )}
                                    </button>
                                );
                            })}
                        </div>

                        <button
                            onClick={() => openPreview('daily', { fallback: `/attendance/daily?date=${selectedDate}` })}
                            className="btn btn-primary w-full mt-4 justify-center gap-2"
                        >
                            <Eye className="w-4 h-4" />
                            Preview ประจำวัน
                        </button>

                        <div className="flex flex-wrap gap-3 mt-3">
                            <span className="flex items-center gap-1.5 text-[10px]" style={{ color: 'var(--color-text-tertiary)' }}>
                                <span className="w-2 h-2 rounded-full" style={{ background: '#10B981' }} />เข้าออฟฟิศ
                            </span>
                            <span className="flex items-center gap-1.5 text-[10px]" style={{ color: 'var(--color-text-tertiary)' }}>
                                <span className="w-2 h-2 rounded-full" style={{ background: '#F59E0B' }} />ออกพื้นที่
                            </span>
                            <span className="flex items-center gap-1.5 text-[10px]" style={{ color: '#EF4444' }}>
                                <Sun className="w-2.5 h-2.5" />วันหยุด
                            </span>
                        </div>
                    </div>

                    {isRestDay(selectedDate) && (
                        <motion.div
                            initial={{ opacity: 0, y: -8 }}
                            animate={{ opacity: 1, y: 0 }}
                            className="card mt-3 p-4 flex items-center gap-3"
                            style={{ border: '1px solid #FECACA', background: '#FEF2F2' }}
                        >
                            <Sun className="w-5 h-5 flex-shrink-0" style={{ color: '#EF4444' }} />
                            <div>
                                <p className="text-[12px] font-bold" style={{ color: '#DC2626' }}>วันหยุด</p>
                                <p className="text-[11px]" style={{ color: '#EF4444' }}>
                                    {isHoliday(selectedDate) ?? (isWeekend(selectedDate) ? 'วันหยุดสุดสัปดาห์' : '')}
                                </p>
                                <p className="text-[10px] mt-0.5" style={{ color: '#B91C1C' }}>
                                    ยังสามารถบันทึกการเข้าทำงาน/ออกพื้นที่ได้
                                </p>
                            </div>
                        </motion.div>
                    )}
                </div>

                {/* ── Employee list ── */}
                <div className="lg:col-span-2">
                    <div className="card p-5">
                        <div className="flex items-center justify-between mb-4">
                            <h3 className="text-sm font-bold" style={{ color: 'var(--color-text-primary)' }}>
                                {new Date(selectedDate + 'T12:00:00').toLocaleDateString('th-TH', { weekday: 'long', day: 'numeric', month: 'long' })}
                                {isRestDay(selectedDate) && (
                                    <span className="ml-2 text-[10px] font-bold px-2 py-0.5 rounded-full align-middle"
                                        style={{ background: '#FEF2F2', color: '#EF4444' }}>
                                        วันหยุด
                                    </span>
                                )}
                            </h3>
                            <span className="text-[11px] font-medium" style={{ color: 'var(--color-text-tertiary)' }}>
                                {employees.length} คน
                            </span>
                        </div>

                        {loading ? (
                            <div className="flex items-center justify-center py-12">
                                <RefreshCw className="w-5 h-5 animate-spin" style={{ color: 'var(--color-text-tertiary)' }} />
                                <span className="ml-2 text-sm" style={{ color: 'var(--color-text-tertiary)' }}>กำลังโหลด...</span>
                            </div>
                        ) : employees.length === 0 ? (
                            <div className="text-center py-12 text-sm" style={{ color: 'var(--color-text-tertiary)' }}>
                                ยังไม่มีพนักงานในระบบ
                            </div>
                        ) : (
                        <div className="space-y-2.5 max-h-[460px] overflow-y-auto pr-1">
                            {employees.map((emp, idx) => {
                                const status = emp.schedule[selectedDate];
                                const site   = emp.siteDetails[selectedDate];
                                const m      = status ? STATUS[status] : null;
                                return (
                                    <motion.div
                                        key={emp.id}
                                        initial={{ opacity: 0, y: 6 }}
                                        animate={{ opacity: 1, y: 0 }}
                                        transition={{ delay: idx * 0.04 }}
                                        className="flex items-start gap-3.5 p-3.5 rounded-xl"
                                        style={{ background: 'var(--color-surface-2)', border: '1px solid var(--color-border)' }}
                                    >
                                        <div className="w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold text-white flex-shrink-0 mt-0.5"
                                            style={{ background: avatarColor(emp.id) }}>
                                            {emp.avatar}
                                        </div>
                                        <div className="flex-1 min-w-0">
                                            <p className="text-[13px] font-semibold" style={{ color: 'var(--color-text-primary)' }}>
                                                {emp.name}
                                            </p>
                                            <p className="text-[11px]" style={{ color: 'var(--color-text-secondary)' }}>
                                                {emp.email}
                                            </p>
                                            {status === 'travel' && site && (
                                                <div className="mt-1 space-y-0.5">
                                                    {site.product && (
                                                        <p className="text-[10px] flex items-center gap-1" style={{ color: '#2563EB' }}>
                                                            <Package className="w-2.5 h-2.5" />{site.product}
                                                        </p>
                                                    )}
                                                    {site.customer && (
                                                        <p className="text-[10px] flex items-center gap-1" style={{ color: '#B45309' }}>
                                                            <UserCheck className="w-2.5 h-2.5" />{site.customer}
                                                        </p>
                                                    )}
                                                </div>
                                            )}
                                            {selectedDate === todayStr && emp.location && (
                                                <p className="text-[11px] flex items-center gap-1 mt-0.5"
                                                    style={{ color: m?.color ?? 'var(--color-text-tertiary)' }}>
                                                    <MapPin className="w-3 h-3" />{emp.location}
                                                </p>
                                            )}
                                        </div>
                                        {/* Status label only — read-only, no click */}
                                        <div className="flex-shrink-0">
                                            {status === 'travel' ? (
                                                <span className="flex items-center gap-1.5 text-[10px] font-bold px-2.5 py-1.5 rounded-lg"
                                                    style={{ background: '#FEF3C7', color: '#B45309' }}>
                                                    <Car className="w-3 h-3" />ออกพื้นที่
                                                </span>
                                            ) : (
                                                <span className="flex items-center gap-1.5 text-[10px] font-bold px-2.5 py-1.5 rounded-lg"
                                                    style={{ background: '#ECFDF5', color: '#065F46' }}>
                                                    <Building2 className="w-3 h-3" />เข้าออฟฟิศ
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
            </div>

            {/* ── Weekly overview table ── */}
            <div className="card p-5 overflow-x-auto">
                <h3 className="text-sm font-bold mb-4" style={{ color: 'var(--color-text-primary)' }}>ภาพรวมสัปดาห์นี้</h3>
                <table className="w-full min-w-[540px]">
                    <thead>
                        <tr>
                            <th className="text-left text-[11px] font-bold pb-3 pr-4" style={{ color: 'var(--color-text-tertiary)' }}>พนักงาน</th>
                            {[-2, -1, 0, 1, 2].map(offset => {
                                const ds     = dayOffset(offset);
                                const isRest = isRestDay(ds);
                                const d      = new Date(ds + 'T12:00:00');
                                return (
                                    <th key={offset} className="text-center text-[11px] font-bold pb-3 px-2"
                                        style={{ color: offset === 0 ? 'var(--color-primary)' : isRest ? '#EF4444' : 'var(--color-text-tertiary)' }}>
                                        {d.toLocaleDateString('th-TH', { weekday: 'short' })}<br />
                                        <span className="font-semibold">{d.getDate()}</span>
                                        {isRest && <span className="block text-[8px] opacity-70">หยุด</span>}
                                    </th>
                                );
                            })}
                        </tr>
                    </thead>
                    <tbody>
                        {employees.map(emp => (
                            <tr key={emp.id} className="border-t" style={{ borderColor: 'var(--color-border)' }}>
                                <td className="py-3 pr-4">
                                    <div className="flex items-center gap-2.5">
                                        <div className="w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-bold text-white flex-shrink-0"
                                            style={{ background: avatarColor(emp.id) }}>
                                            {emp.avatar}
                                        </div>
                                        <div>
                                            <p className="text-[12px] font-semibold" style={{ color: 'var(--color-text-primary)' }}>{emp.name}</p>
                                            <p className="text-[10px]" style={{ color: 'var(--color-text-tertiary)' }}>{emp.email}</p>
                                        </div>
                                    </div>
                                </td>
                                {[-2, -1, 0, 1, 2].map(offset => {
                                    const ds     = dayOffset(offset);
                                    const status = emp.schedule[ds];
                                    const m      = status ? STATUS[status] : null;
                                    const Icon   = m?.icon;
                                    const isRest = isRestDay(ds);
                                    return (
                                        <td key={offset} className="text-center py-3 px-2">
                                            <div className="flex justify-center">
                                                {Icon && m ? (
                                                    <div className="w-7 h-7 rounded-lg flex items-center justify-center"
                                                        style={{ background: m.bg }}>
                                                        <Icon className="w-3.5 h-3.5" style={{ color: m.color }} />
                                                    </div>
                                                ) : isRest ? (
                                                    <div className="w-7 h-7 rounded-lg flex items-center justify-center"
                                                        style={{ background: '#FEF2F2' }}>
                                                        <Sun className="w-3.5 h-3.5" style={{ color: '#EF4444' }} />
                                                    </div>
                                                ) : (
                                                    <div className="w-7 h-7 rounded-lg flex items-center justify-center"
                                                        style={{ background: 'var(--color-surface-2)' }}>
                                                        <span className="text-xs" style={{ color: 'var(--color-border)' }}>—</span>
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

            {/* ── Site Modal ── */}
            {siteModal && (
                <SiteModal
                    empName={siteModal.empName}
                    date={siteModal.date}
                    initial={employees.find(e => e.id === siteModal?.empId)?.siteDetails[siteModal.date]}
                    onConfirm={confirmSite}
                    onCancel={() => setSiteModal(null)}
                />
            )}
        </div>
    );
}
