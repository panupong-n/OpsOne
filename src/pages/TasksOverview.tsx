import { useState, useEffect, useMemo } from 'react';
import { AlertCircle, RefreshCw, Shield, Camera, Wrench, Lock, CalendarRange, StickyNote, Users2, FolderKanban } from 'lucide-react';
import Chart from 'react-apexcharts';
import type { ApexOptions } from 'apexcharts';
import PersonAvatar from '../components/ui/avatar/PersonAvatar';

// ─── Types ────────────────────────────────────────────────────────────────────
interface OverviewUser { sub: string; name: string; email: string; user_group: string | null }
interface OverviewProject {
    id: string; name: string; color: string; logo_url: string | null;
    year: number | null; status: string | null;
    start_date: string | null; end_date: string | null;
}
interface OverviewAssignment {
    id: string; project_id: string; assignee_id: string;
    task_role: 'head' | 'sub' | null; title: string; site: string | null;
    status: string; description: string | null;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
const beYear = (y: number) => y + 543; // Buddhist year
const TH_MONTHS_SHORT = ['', 'ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];

const projectDateLabel = (p: OverviewProject): string | null => {
    if (!p.start_date) return p.year ? `ปี ${beYear(p.year)}` : null;
    const d = new Date(p.start_date);
    const y = p.year ?? d.getFullYear();
    // start_date stores y-m-d; day === 1 may mean "month only" (day optional)
    return `${d.getDate() > 1 ? d.getDate() + ' ' : ''}${TH_MONTHS_SHORT[d.getMonth() + 1]} ${beYear(y)}`;
};

const TEAM_ORDER = ['TEAM CYBERSECURITY', 'TEAM CCTV', 'engineer'];
const TEAM_CONFIG: Record<string, { label: string; accent: string; icon: React.ReactNode }> = {
    'TEAM CYBERSECURITY': { label: 'Team Cybersecurity', accent: '#2563EB', icon: <Shield style={{ width: 14, height: 14 }} /> },
    'TEAM CCTV':          { label: 'Team CCTV',          accent: '#0EA5E9', icon: <Camera style={{ width: 14, height: 14 }} /> },
    'engineer':           { label: 'Engineer',           accent: '#64748B', icon: <Wrench style={{ width: 14, height: 14 }} /> },
};

const ROLE_PILL = (isHead: boolean): React.CSSProperties => ({
    fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 6, flexShrink: 0,
    background: isHead ? 'var(--color-primary-soft)' : 'var(--color-surface-2)',
    color: isHead ? 'var(--color-primary)' : 'var(--color-text-secondary)',
    border: `1px solid ${isHead ? 'rgba(37,99,235,0.2)' : 'var(--color-border)'}`,
});

export default function TasksOverview() {
    const [users, setUsers] = useState<OverviewUser[]>([]);
    const [projects, setProjects] = useState<OverviewProject[]>([]);
    const [assignments, setAssignments] = useState<OverviewAssignment[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const [year, setYear] = useState<number | 'all'>('all');
    const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'closed'>('all');

    const load = () => {
        setLoading(true);
        fetch('/api/tasks/overview')
            .then(r => { if (!r.ok) throw new Error(`${r.status}`); return r.json(); })
            .then(data => {
                setUsers(data.users ?? []);
                setProjects(data.projects ?? []);
                setAssignments(data.assignments ?? []);
                setError(null);
            })
            .catch(e => setError(String(e)))
            .finally(() => setLoading(false));
    };

    useEffect(() => {
        load();
        const iv = setInterval(load, 60_000);
        return () => clearInterval(iv);
    }, []);

    const projById = useMemo(() => Object.fromEntries(projects.map(p => [p.id, p])), [projects]);
    const userById = useMemo(() => Object.fromEntries(users.map(u => [u.sub, u])), [users]);

    const years = useMemo(
        () => [...new Set(projects.map(p => p.year).filter((y): y is number => y != null))].sort((a, b) => b - a),
        [projects],
    );

    useEffect(() => { if (year === 'all' && years.length > 0) setYear(years[0]); }, [years]); // eslint-disable-line react-hooks/exhaustive-deps

    const visibleAssignments = useMemo(() => assignments.filter(a => {
        const p = projById[a.project_id];
        if (year !== 'all' && p?.year !== year) return false;
        if (statusFilter === 'active' && p?.status === 'closed') return false;
        if (statusFilter === 'closed' && p?.status !== 'closed') return false;
        return true;
    }), [assignments, projById, year, statusFilter]);

    const teamMap = users.reduce<Record<string, OverviewUser[]>>((acc, u) => {
        const team = u.user_group ?? 'engineer';
        (acc[team] ??= []).push(u);
        return acc;
    }, {});
    const sortedTeams = [
        ...TEAM_ORDER.filter(t => teamMap[t]),
        ...Object.keys(teamMap).filter(t => !TEAM_ORDER.includes(t)),
    ];

    const assignmentsForUser = (sub: string) =>
        visibleAssignments.filter(a => a.assignee_id === sub)
            .sort((a, b) => (a.task_role === 'sub' ? 1 : 0) - (b.task_role === 'sub' ? 1 : 0));

    // projects active in the selected year (for the project section)
    const yearProjects = useMemo(() => {
        const ids = new Set(visibleAssignments.map(a => a.project_id));
        return projects.filter(p => ids.has(p.id) || (year !== 'all' && p.year === year))
            .sort((a, b) => a.name.localeCompare(b.name));
    }, [projects, visibleAssignments, year]);

    const totalHead = visibleAssignments.filter(a => (a.task_role ?? 'head') === 'head').length;
    const totalSub = visibleAssignments.filter(a => a.task_role === 'sub').length;
    const closedCount = yearProjects.filter(p => p.status === 'closed').length;

    const stats = [
        { label: 'พนักงาน', val: users.length },
        { label: 'โครงการ', val: yearProjects.length },
        { label: 'ปิดแล้ว', val: closedCount },
        { label: 'งาน Main', val: totalHead },
        { label: 'งาน Support', val: totalSub },
        { label: 'งานทั้งหมด', val: visibleAssignments.length },
    ];

    const selectStyle: React.CSSProperties = {
        height: 34, padding: '0 12px', borderRadius: 9, fontSize: 12.5, fontWeight: 600,
        background: 'var(--color-surface)', color: 'var(--color-text-primary)',
        border: '1px solid var(--color-border)', cursor: 'pointer',
    };

    // per-person workload (for comparison chart)
    const workload = users
        .map(u => ({ name: u.name, count: visibleAssignments.filter(a => a.assignee_id === u.sub).length }))
        .filter(w => w.count > 0)
        .sort((a, b) => b.count - a.count);
    const workloadOptions: ApexOptions = {
        chart: { type: 'bar', fontFamily: 'inherit', toolbar: { show: false } },
        colors: ['#2563EB'],
        plotOptions: { bar: { horizontal: true, borderRadius: 5, barHeight: '58%', distributed: false } },
        dataLabels: { enabled: true, style: { fontSize: '11px', colors: ['#fff'], fontWeight: 700 } },
        xaxis: { categories: workload.map(w => w.name), labels: { style: { colors: '#94A3B8', fontSize: '11px' } }, axisBorder: { show: false }, axisTicks: { show: false } },
        yaxis: { labels: { style: { colors: '#475569', fontSize: '12px' } } },
        grid: { borderColor: 'var(--color-border)', strokeDashArray: 3, yaxis: { lines: { show: false } } },
        tooltip: { y: { formatter: (v: number) => `${v} งาน` } },
    };

    const yearLabel = year !== 'all' ? `ปี ${beYear(year as number)}` : 'ทุกปี';

    return (
        <div style={{ minHeight: '100vh', background: 'var(--color-bg)' }} className="font-sans">
            {/* ── Header ── */}
            <header style={{ background: 'var(--color-surface)', borderBottom: '1px solid var(--color-border)', position: 'sticky', top: 0, zIndex: 100 }}>
                <div style={{ padding: '0 28px', minHeight: 60, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 0' }}>
                        <img src="/TENIX1.png" alt="OpsOne" style={{ width: 30, height: 30, objectFit: 'contain' }} />
                        <span style={{ fontWeight: 800, color: 'var(--color-text-primary)', fontSize: 15 }}>OpsOne</span>
                        <span style={{ color: 'var(--color-border-strong)', fontSize: 14 }}>/</span>
                        <span style={{ color: 'var(--color-text-secondary)', fontSize: 13.5, fontWeight: 600 }}>ภาระงานทีม</span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 0' }}>
                        <CalendarRange style={{ width: 16, height: 16, color: 'var(--color-text-tertiary)' }} />
                        <select value={String(year)} onChange={e => setYear(e.target.value === 'all' ? 'all' : Number(e.target.value))} style={selectStyle}>
                            <option value="all">ทุกปี</option>
                            {years.map(y => <option key={y} value={y}>ปี {beYear(y)}</option>)}
                        </select>
                        <select value={statusFilter} onChange={e => setStatusFilter(e.target.value as typeof statusFilter)} style={selectStyle}>
                            <option value="all">ทุกสถานะ</option>
                            <option value="active">เปิดอยู่</option>
                            <option value="closed">ปิดแล้ว</option>
                        </select>
                        <button onClick={load} style={{ ...selectStyle, display: 'flex', alignItems: 'center', gap: 6, color: 'var(--color-primary)', borderColor: 'var(--color-primary)' }}>
                            <RefreshCw style={{ width: 13, height: 13 }} className={loading ? 'animate-spin' : ''} /> รีเฟรช
                        </button>
                    </div>
                </div>
            </header>

            {/* ── Stats bar ── */}
            <div style={{ background: 'var(--color-surface)', borderBottom: '1px solid var(--color-border)' }}>
                <div style={{ padding: '0 28px', display: 'flex', flexWrap: 'wrap' }}>
                    {stats.map((s, i) => (
                        <div key={s.label} className="tabular-nums" style={{ display: 'flex', alignItems: 'baseline', gap: 7, padding: '14px 20px', borderRight: i < stats.length - 1 ? '1px solid var(--color-border)' : 'none' }}>
                            <span style={{ fontSize: 22, fontWeight: 800, color: 'var(--color-text-primary)', lineHeight: 1 }}>{s.val}</span>
                            <span style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--color-text-tertiary)' }}>{s.label}</span>
                        </div>
                    ))}
                </div>
            </div>

            <main style={{ padding: '24px 28px 56px', maxWidth: 1400, margin: '0 auto' }}>
                {loading && (
                    <div style={{ textAlign: 'center', padding: '80px 0' }}>
                        <div className="animate-spin" style={{ width: 30, height: 30, border: '2.5px solid var(--color-border)', borderTopColor: 'var(--color-primary)', borderRadius: '50%', margin: '0 auto' }} />
                    </div>
                )}
                {error && !loading && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 16px', borderRadius: 10, background: 'var(--color-error-soft)', maxWidth: 480, margin: '32px auto' }}>
                        <AlertCircle style={{ width: 16, height: 16, color: 'var(--color-error)' }} />
                        <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-error)' }}>โหลดข้อมูลไม่สำเร็จ: {error}</span>
                    </div>
                )}

                {!loading && !error && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 28 }}>
                        {/* ── Per-person workload comparison ── */}
                        {workload.length > 0 && (
                            <section className="card" style={{ padding: 18 }}>
                                <SectionTitle icon={<Users2 style={{ width: 15, height: 15 }} />} title="ภาระงานรายคน"
                                    sub={`เปรียบเทียบจำนวนงานที่รับผิดชอบ · ${yearLabel}`} />
                                <Chart options={workloadOptions} series={[{ name: 'งาน', data: workload.map(w => w.count) }]} type="bar" height={Math.max(180, workload.length * 36)} />
                            </section>
                        )}

                        {/* ── Projects this year — with notes (หมายเหตุ) ── */}
                        {yearProjects.length > 0 && (
                            <section>
                                <SectionTitle icon={<FolderKanban style={{ width: 15, height: 15 }} />}
                                    title={`โครงการ ${yearLabel}`}
                                    sub="งานและหมายเหตุของแต่ละโครงการ" />
                                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(380px, 1fr))', gap: 14, marginTop: 14 }}>
                                    {yearProjects.map(p => {
                                        const closed = p.status === 'closed';
                                        const projAssignments = visibleAssignments
                                            .filter(a => a.project_id === p.id)
                                            .sort((a, b) => (a.task_role === 'sub' ? 1 : 0) - (b.task_role === 'sub' ? 1 : 0));
                                        const dateLabel = projectDateLabel(p);
                                        return (
                                            <div key={p.id} className="card" style={{ overflow: 'hidden', opacity: closed ? 0.72 : 1 }}>
                                                {/* Project header */}
                                                <div style={{ display: 'flex', alignItems: 'center', gap: 11, padding: '12px 14px', borderBottom: '1px solid var(--color-border)', background: 'var(--color-surface-2)' }}>
                                                    {p.logo_url
                                                        ? <img src={p.logo_url} alt="" style={{ width: 30, height: 30, borderRadius: 8, objectFit: 'contain', background: '#fff', boxShadow: '0 0 0 1px var(--color-border)' }} />
                                                        : <div style={{ width: 30, height: 30, borderRadius: 8, background: p.color || 'var(--color-primary)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, color: '#fff', fontSize: 13 }}>{p.name?.[0] ?? '?'}</div>}
                                                    <div style={{ flex: 1, minWidth: 0 }}>
                                                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                                            <span style={{ fontSize: 13.5, fontWeight: 700, color: 'var(--color-text-primary)', textDecoration: closed ? 'line-through' : 'none', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.name}</span>
                                                            {closed && <Lock style={{ width: 12, height: 12, color: 'var(--color-text-tertiary)', flexShrink: 0 }} />}
                                                        </div>
                                                        <span style={{ fontSize: 11, color: 'var(--color-text-tertiary)' }}>
                                                            {dateLabel ? dateLabel + ' · ' : ''}{projAssignments.length} งาน
                                                        </span>
                                                    </div>
                                                </div>

                                                {/* Assignments with notes */}
                                                {projAssignments.length === 0 ? (
                                                    <p style={{ margin: 0, padding: '12px 14px', fontSize: 12, color: 'var(--color-text-tertiary)', fontStyle: 'italic' }}>ยังไม่มีงานในโครงการนี้</p>
                                                ) : projAssignments.map((a, idx) => {
                                                    const u = userById[a.assignee_id];
                                                    const isHead = (a.task_role ?? 'head') === 'head';
                                                    return (
                                                        <div key={a.id} style={{ padding: '10px 14px', borderTop: idx > 0 ? '1px solid var(--color-surface-2)' : 'none' }}>
                                                            <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
                                                                <PersonAvatar name={u?.name ?? '?'} colorKey={a.assignee_id} size="sm" />
                                                                <div style={{ flex: 1, minWidth: 0 }}>
                                                                    <span style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--color-text-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', display: 'block' }}>{u?.name ?? '—'}</span>
                                                                    {(a.title || a.site) && (
                                                                        <span style={{ fontSize: 11, color: 'var(--color-text-tertiary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', display: 'block' }}>
                                                                            {[a.title, a.site].filter(Boolean).join(' · ')}
                                                                        </span>
                                                                    )}
                                                                </div>
                                                                <span style={ROLE_PILL(isHead)}>{isHead ? 'Main' : 'Support'}</span>
                                                            </div>
                                                            {a.description && a.description.trim() && (
                                                                <div style={{ display: 'flex', gap: 6, marginTop: 7, marginLeft: 37, padding: '7px 9px', borderRadius: 8, background: 'var(--color-warning-soft)', border: '1px solid rgba(245,158,11,0.2)' }}>
                                                                    <StickyNote style={{ width: 12, height: 12, color: '#B45309', flexShrink: 0, marginTop: 1 }} />
                                                                    <span style={{ fontSize: 11.5, color: '#92400E', lineHeight: 1.4, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{a.description}</span>
                                                                </div>
                                                            )}
                                                        </div>
                                                    );
                                                })}
                                            </div>
                                        );
                                    })}
                                </div>
                            </section>
                        )}

                        {/* ── Teams ── */}
                        {sortedTeams.map(team => {
                            const members = teamMap[team] ?? [];
                            const cfg = TEAM_CONFIG[team] ?? TEAM_CONFIG['engineer'];
                            const teamAssignments = visibleAssignments.filter(a => members.some(m => m.sub === a.assignee_id));
                            return (
                                <section key={team}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14, paddingBottom: 10, borderBottom: '1px solid var(--color-border)' }}>
                                        <span style={{ width: 4, height: 18, borderRadius: 2, background: cfg.accent }} />
                                        <span style={{ color: cfg.accent, display: 'flex' }}>{cfg.icon}</span>
                                        <span style={{ fontWeight: 700, fontSize: 14, color: 'var(--color-text-primary)' }}>{cfg.label}</span>
                                        <span style={{ fontSize: 12, color: 'var(--color-text-tertiary)' }}>
                                            {members.length} คน · {teamAssignments.length} งาน
                                        </span>
                                    </div>

                                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))', gap: 12 }}>
                                        {members.map(u => {
                                            const ua = assignmentsForUser(u.sub);
                                            const headCnt = ua.filter(a => (a.task_role ?? 'head') === 'head').length;
                                            const subCnt = ua.filter(a => a.task_role === 'sub').length;
                                            return (
                                                <div key={u.sub} className="card" style={{ overflow: 'hidden' }}>
                                                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', background: 'var(--color-surface-2)', borderBottom: '1px solid var(--color-border)' }}>
                                                        <PersonAvatar name={u.name} colorKey={u.sub} size="md" />
                                                        <div style={{ flex: 1, minWidth: 0 }}>
                                                            <p title={`${u.name}${u.email ? ' · ' + u.email : ''}`} style={{ margin: 0, fontWeight: 600, fontSize: 13, color: 'var(--color-text-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{u.name}</p>
                                                            <p style={{ margin: 0, fontSize: 10.5, color: 'var(--color-text-tertiary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                                                {ua.length === 0 ? 'ว่าง' : `${headCnt} Main · ${subCnt} Support`}
                                                            </p>
                                                        </div>
                                                    </div>

                                                    {ua.length === 0 ? (
                                                        <p style={{ margin: 0, padding: '10px 12px', fontSize: 12, color: 'var(--color-text-tertiary)', fontStyle: 'italic' }}>ไม่มีงานในช่วงที่เลือก</p>
                                                    ) : ua.map((a, idx) => {
                                                        const proj = projById[a.project_id];
                                                        const isHead = (a.task_role ?? 'head') === 'head';
                                                        const closed = proj?.status === 'closed';
                                                        return (
                                                            <div key={a.id} style={{
                                                                display: 'grid', gridTemplateColumns: '20px 1fr auto', alignItems: 'center', gap: 8,
                                                                padding: '7px 12px', borderTop: idx > 0 ? '1px solid var(--color-surface-2)' : 'none',
                                                                borderLeft: `3px solid ${isHead ? 'var(--color-primary)' : '#94A3B8'}`, opacity: closed ? 0.55 : 1,
                                                            }}>
                                                                {proj?.logo_url
                                                                    ? <img src={proj.logo_url} alt="" style={{ width: 18, height: 18, borderRadius: 4, objectFit: 'contain', boxShadow: '0 0 0 1px var(--color-border)' }} />
                                                                    : <div style={{ width: 18, height: 18, borderRadius: 4, background: proj?.color || '#94A3B8', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, color: 'white', fontSize: 8 }}>{proj?.name?.[0] ?? '?'}</div>}
                                                                <div style={{ minWidth: 0 }} title={[proj?.name, a.title, a.site, a.description].filter(Boolean).join(' · ')}>
                                                                    <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                                                                        <span style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--color-text-secondary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 120 }}>{proj?.name ?? '—'}</span>
                                                                        {a.title && <><span style={{ color: 'var(--color-border-strong)', fontSize: 10 }}>·</span><span style={{ fontSize: 11.5, color: 'var(--color-text-tertiary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{a.title}</span></>}
                                                                        {closed && <span style={{ fontSize: 8.5, fontWeight: 700, padding: '1px 5px', borderRadius: 3, background: 'var(--color-surface-2)', color: 'var(--color-text-tertiary)', flexShrink: 0 }}>ปิดแล้ว</span>}
                                                                    </div>
                                                                    {a.site && <span style={{ fontSize: 10, color: 'var(--color-text-tertiary)', display: 'block', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{a.site}</span>}
                                                                </div>
                                                                <span style={ROLE_PILL(isHead)}>{isHead ? 'Main' : 'Support'}</span>
                                                            </div>
                                                        );
                                                    })}
                                                </div>
                                            );
                                        })}
                                    </div>
                                </section>
                            );
                        })}
                    </div>
                )}
            </main>

            <footer style={{ borderTop: '1px solid var(--color-border)', padding: '12px 28px', background: 'var(--color-surface)' }}>
                <p style={{ margin: 0, fontSize: 11, color: 'var(--color-text-tertiary)' }}>OpsOne · ภาระงานทีม · รีเฟรชอัตโนมัติทุก 60 วินาที</p>
            </footer>
        </div>
    );
}

// ─── Small section title ──────────────────────────────────────────────────────
function SectionTitle({ icon, title, sub }: { icon: React.ReactNode; title: string; sub?: string }) {
    return (
        <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
            <span style={{ display: 'flex', width: 28, height: 28, borderRadius: 8, alignItems: 'center', justifyContent: 'center', background: 'var(--color-primary-soft)', color: 'var(--color-primary)' }}>{icon}</span>
            <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--color-text-primary)' }}>{title}</span>
            {sub && <span style={{ fontSize: 11.5, color: 'var(--color-text-tertiary)' }}>{sub}</span>}
        </div>
    );
}
