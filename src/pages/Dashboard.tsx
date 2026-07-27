import { useState, useEffect } from 'react';
import Chart from 'react-apexcharts';
import type { ApexOptions } from 'apexcharts';
import { FEATURES } from '../config/features';
import {
    Users, Ticket, Boxes, ClipboardList,
    Monitor, Globe, Router, Wrench, FileText, Box, Building2, type LucideIcon,
} from 'lucide-react';

/* ─── Types ──────────────────────────────────────────────────────────────── */
interface DashStats {
    assets: { total: string; active: string };
    tasks: { total: string; in_progress: string; completed: string };
    users: { total: string };
    attendance: { total: string; office: string; travel: string };
}
interface ZTicketSummary {
    id: number; number: number; title: string; state: string;
    priority: string; group: string; owner: string; customer: string; updated_at: string;
}

const GROUP_ICONS: Record<string, { icon: LucideIcon; color: string }> = {
    Hardware: { icon: Monitor, color: '#465fff' },
    Software: { icon: Globe, color: '#0891B2' },
    Network: { icon: Router, color: '#0EA5E9' },
    Facility: { icon: Building2, color: '#F59E0B' },
    Personnel: { icon: Users, color: '#10B981' },
    Information: { icon: FileText, color: '#64748B' },
    'Internal Service': { icon: Wrench, color: '#F97316' },
};
const TICKET_LABEL: Record<string, string> = {
    new: 'ใหม่', open: 'เปิดอยู่', pending: 'รอดำเนินการ', closed: 'ปิดแล้ว', merged: 'รวมแล้ว', removed: 'ลบแล้ว',
};
const TICKET_COLOR: Record<string, string> = {
    new: '#0EA5E9', open: '#F59E0B', pending: '#6366F1', closed: '#10B981', merged: '#64748B', removed: '#EF4444',
};

/* ─── Metric card (TailAdmin style) ──────────────────────────────────────── */
function Metric({ icon: Icon, label, value, foot }: { icon: LucideIcon; label: string; value: React.ReactNode; foot?: React.ReactNode }) {
    return (
        <div className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-white/[0.03] md:p-6">
            <div className="flex items-center justify-center w-12 h-12 bg-gray-100 rounded-xl dark:bg-gray-800">
                <Icon className="w-6 h-6 text-gray-800 dark:text-white/90" />
            </div>
            <div className="mt-5">
                <span className="text-sm text-gray-500 dark:text-gray-400">{label}</span>
                <h4 className="mt-1 font-bold text-gray-800 text-title-sm dark:text-white/90 tabular-nums">{value}</h4>
            </div>
            {foot && <div className="mt-3 flex items-center gap-3 text-xs">{foot}</div>}
        </div>
    );
}

const card = 'rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-white/[0.03] md:p-6';
const heading = 'text-base font-semibold text-gray-800 dark:text-white/90';

export default function Dashboard() {
    const [stats, setStats] = useState<DashStats | null>(null);
    const [zTickets, setZTickets] = useState<ZTicketSummary[]>([]);
    const [assetGroups, setGroups] = useState<{ group_name: string; count: number }[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        (async () => {
            setLoading(true);
            try {
                // Skip the Zammad call entirely while Support Tickets is disabled —
                // the upstream server is offline and would only return errors.
                const [sR, aR, tR] = await Promise.all([
                    fetch('/api/dashboard/stats'),
                    fetch('/api/assets/stats'),
                    FEATURES.supportTickets ? fetch('/api/zammad/tickets?per_page=200') : Promise.resolve(null),
                ]);
                const s = sR.ok ? await sR.json() : null;
                const a = aR.ok ? await aR.json() : {};
                const tk = tR && tR.ok ? await tR.json() : [];
                setStats(s); setZTickets(Array.isArray(tk) ? tk : []);
                if (a.groups) {
                    const allAssets: { group_name: string }[] = await (await fetch('/api/assets')).json();
                    if (Array.isArray(allAssets)) {
                        const gm: Record<string, number> = {};
                        for (const x of allAssets) gm[x.group_name] = (gm[x.group_name] || 0) + 1;
                        setGroups(Object.entries(gm).map(([group_name, count]) => ({ group_name, count })).sort((x, y) => y.count - x.count));
                    }
                }
            } catch (e) { console.error(e); }
            setLoading(false);
        })();
    }, []);

    /* ── Computed ── */
    const ticketStates: Record<string, number> = {};
    for (const t of zTickets) { const k = (t.state ?? 'unknown').toLowerCase(); ticketStates[k] = (ticketStates[k] || 0) + 1; }
    const openTickets = (ticketStates['open'] ?? 0) + (ticketStates['new'] ?? 0);
    const closedTickets = ticketStates['closed'] ?? 0;
    const recentTickets = [...zTickets].sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()).slice(0, 6);

    const totalAssets = Number(stats?.assets.total ?? 0);
    const activeAssets = Number(stats?.assets.active ?? 0);
    const officeCount = Number(stats?.attendance.office ?? 0);
    const travelCount = Number(stats?.attendance.travel ?? 0);

    /* ── Donut: ticket states ── */
    const donutEntries = Object.entries(ticketStates).sort((a, b) => b[1] - a[1]);
    const donutOptions: ApexOptions = {
        chart: { type: 'donut', fontFamily: 'inherit' },
        labels: donutEntries.map(([k]) => TICKET_LABEL[k] ?? k),
        colors: donutEntries.map(([k]) => TICKET_COLOR[k] ?? '#94A3B8'),
        legend: { position: 'bottom', fontFamily: 'inherit', labels: { colors: '#64748B' } },
        dataLabels: { enabled: false },
        stroke: { width: 0 },
        plotOptions: { pie: { donut: { size: '70%', labels: { show: true, total: { show: true, label: 'ทั้งหมด', fontSize: '13px', color: '#64748B', formatter: () => String(zTickets.length) } } } } },
        tooltip: { y: { formatter: (v: number) => `${v} รายการ` } },
    };

    /* ── Bar: assets by group ── */
    const barOptions: ApexOptions = {
        chart: { type: 'bar', fontFamily: 'inherit', toolbar: { show: false } },
        colors: ['#465fff'],
        plotOptions: { bar: { horizontal: true, borderRadius: 5, barHeight: '55%' } },
        dataLabels: { enabled: true, style: { fontSize: '11px', colors: ['#fff'] } },
        xaxis: { categories: assetGroups.map(g => g.group_name), labels: { style: { colors: '#94A3B8' } }, axisBorder: { show: false }, axisTicks: { show: false } },
        yaxis: { labels: { style: { colors: '#64748B', fontSize: '12px' } } },
        grid: { borderColor: '#E2E8F0', strokeDashArray: 3, yaxis: { lines: { show: false } } },
        tooltip: { y: { formatter: (v: number) => `${v} ชิ้น` } },
    };

    if (loading) return (
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-4">
            {[...Array(4)].map((_, i) => <div key={i} className={`${card} h-36 animate-pulse`} />)}
        </div>
    );

    return (
        <div className="space-y-5 md:space-y-6">
            {/* Metric cards */}
            <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-4">
                <Metric icon={Users} label="พนักงานวันนี้" value={Number(stats?.attendance.total ?? 0)}
                    foot={<>
                        <span className="text-emerald-600 font-semibold">{officeCount} ออฟฟิศ</span>
                        <span className="text-amber-600 font-semibold">{travelCount} พื้นที่</span>
                    </>} />
                {FEATURES.supportTickets && (
                    <Metric icon={Ticket} label="Support Ticket" value={zTickets.length}
                        foot={<>
                            <span className="text-amber-600 font-semibold">{openTickets} เปิด</span>
                            <span className="text-emerald-600 font-semibold">{closedTickets} ปิด</span>
                        </>} />
                )}
                <Metric icon={Boxes} label="ทรัพย์สิน IT" value={totalAssets}
                    foot={<span className="text-emerald-600 font-semibold">{activeAssets} Active</span>} />
                <Metric icon={ClipboardList} label="งานทั้งหมด" value={stats?.tasks.total ?? 0}
                    foot={<>
                        <span className="text-amber-600 font-semibold">{stats?.tasks.in_progress ?? 0} ดำเนินการ</span>
                        <span className="text-emerald-600 font-semibold">{stats?.tasks.completed ?? 0} เสร็จ</span>
                    </>} />
            </div>

            {/* Charts */}
            <div className="grid grid-cols-1 gap-5 lg:grid-cols-12 md:gap-6">
                {FEATURES.supportTickets && (
                    <div className={`${card} lg:col-span-5`}>
                        <h3 className={`${heading} mb-2`}>สถานะ Ticket</h3>
                        {zTickets.length === 0
                            ? <div className="py-16 text-center text-sm text-gray-400">ไม่มีข้อมูล Ticket</div>
                            : <Chart options={donutOptions} series={donutEntries.map(([, v]) => v)} type="donut" height={290} />}
                    </div>
                )}
                <div className={`${card} ${FEATURES.supportTickets ? 'lg:col-span-7' : 'lg:col-span-12'}`}>
                    <h3 className={`${heading} mb-2`}>ทรัพย์สินตามหมวดหมู่</h3>
                    {assetGroups.length === 0
                        ? <div className="py-16 text-center text-sm text-gray-400">ไม่มีข้อมูลทรัพย์สิน</div>
                        : <Chart options={barOptions} series={[{ name: 'จำนวน', data: assetGroups.map(g => g.count) }]} type="bar" height={290} />}
                </div>
            </div>

            {/* Recent tickets + asset group chips */}
            <div className="grid grid-cols-1 gap-5 lg:grid-cols-12 md:gap-6">
                {FEATURES.supportTickets && (
                <div className={`${card} lg:col-span-7`}>
                    <div className="flex items-center justify-between mb-4">
                        <h3 className={heading}>Ticket ล่าสุด</h3>
                        <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-600">● Live</span>
                    </div>
                    <div className="divide-y divide-gray-100 dark:divide-gray-800">
                        {recentTickets.length === 0 && <p className="py-10 text-center text-sm text-gray-400">ไม่มี Ticket</p>}
                        {recentTickets.map(t => {
                            const c = TICKET_COLOR[t.state?.toLowerCase()] ?? '#64748B';
                            return (
                                <div key={t.id} className="flex items-center gap-3 py-2.5">
                                    <span className="flex items-center justify-center w-9 h-9 rounded-lg text-[11px] font-bold shrink-0" style={{ background: c + '1A', color: c }}>#{t.number}</span>
                                    <div className="flex-1 min-w-0">
                                        <p className="text-[13px] font-medium truncate text-gray-800 dark:text-white/90">{t.title}</p>
                                        <p className="text-[11px] text-gray-400 truncate">{t.group} · {t.owner !== '-' ? t.owner : t.customer}</p>
                                    </div>
                                    <span className="text-[10px] font-semibold px-2 py-1 rounded-full shrink-0" style={{ background: c + '1A', color: c }}>{TICKET_LABEL[t.state?.toLowerCase()] ?? t.state}</span>
                                </div>
                            );
                        })}
                    </div>
                </div>
                )}
                <div className={`${card} ${FEATURES.supportTickets ? 'lg:col-span-5' : 'lg:col-span-12'}`}>
                    <h3 className={`${heading} mb-4`}>หมวดหมู่ทรัพย์สิน</h3>
                    <div className="grid grid-cols-2 gap-3">
                        {assetGroups.map(({ group_name, count }) => {
                            const meta = GROUP_ICONS[group_name] ?? { icon: Box, color: '#64748B' };
                            const I = meta.icon;
                            return (
                                <div key={group_name} className="flex items-center gap-3 rounded-xl border border-gray-100 p-3 dark:border-gray-800">
                                    <span className="flex items-center justify-center w-9 h-9 rounded-lg shrink-0" style={{ background: meta.color + '1A' }}><I className="w-4 h-4" style={{ color: meta.color }} /></span>
                                    <div className="min-w-0">
                                        <p className="text-lg font-bold leading-none text-gray-800 dark:text-white/90 tabular-nums">{count}</p>
                                        <p className="text-[11px] text-gray-400 truncate">{group_name}</p>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </div>
            </div>

        </div>
    );
}
