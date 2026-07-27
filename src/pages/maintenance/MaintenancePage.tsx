import { toast } from 'sonner';
import { useState, useEffect, useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
    Search, RefreshCw, Download, X, Calendar, Wrench, AlertTriangle,
    CheckCircle2, EyeOff, Eye, Clock, ChevronRight, ChevronDown,
    ListChecks, Lock, FolderClock, Save, FileText,
} from 'lucide-react';
import { Modal } from '../../components/ui/modal';
import ThaiDatePicker from '../../components/ThaiDatePicker';
import { useAuth } from '../../context/AuthContext';
import { avatarColor, initials } from '../../lib/avatar';
import {
    MA_PLANS, PLAN_ORDER, planForType, freqLabel, buildRounds, formatThai,
    toISODate, groupRoundsByYear, formatThaiDateTime, totalDueRounds, CONDITION_META, CONDITIONS,
    type PlanKey, type Condition, type MaItem, type RoundInfo,
} from './maPlans';
import { openMaReportPdf, type MaReportRow } from './maReportPdf';

// ─── Types ──────────────────────────────────────────────────────────────────
interface MaAsset {
    id: string;
    asset_id: string;
    type_name: string;
    group_name: string;
    description: string;
    serial_number: string;
    brand_model: string;
    holder: string;
    department: string;
    status: string;
    start_date: string | null;
    hidden: boolean;
    check_count: number;
    last_checked_at: string | null;
    broken_count: number;
}

interface MaCheck {
    id: string;
    asset_id: string;
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

type PlanTab = 'all' | PlanKey;

// ─── Page ─────────────────────────────────────────────────────────────────────
export default function MaintenancePage() {
    const { user } = useAuth();
    const [params, setParams] = useSearchParams();
    const [assets, setAssets]           = useState<MaAsset[]>([]);
    const [loading, setLoading]         = useState(true);
    const [planTab, setPlanTab]         = useState<PlanTab>('all');
    const [search, setSearch]           = useState('');
    const [includeHidden, setIncludeHidden] = useState(false);
    const currentYear = new Date().getFullYear();
    const [startYear, setStartYear]     = useState<number>(currentYear);
    const [endYear, setEndYear]         = useState<number>(currentYear);
    const [selected, setSelected]       = useState<MaAsset | null>(null);
    const [exporting, setExporting]     = useState(false);
    const [exportingPdf, setExportingPdf] = useState(false);
    const [showExport, setShowExport]   = useState(false);

    const fetchAssets = useCallback(async () => {
        setLoading(true);
        try {
            const qs = new URLSearchParams();
            if (planTab !== 'all') qs.set('plan', planTab);
            if (search) qs.set('search', search);
            if (includeHidden) qs.set('include_hidden', 'true');
            const res = await fetch(`/api/ma/assets?${qs}`);
            setAssets(await res.json());
        } catch (e) { console.error('fetch ma assets', e); }
        setLoading(false);
    }, [planTab, search, includeHidden]);

    useEffect(() => { const t = setTimeout(fetchAssets, 250); return () => clearTimeout(t); }, [fetchAssets]);

    // Deep link from IT Assets modal: ?asset=<asset_id>
    useEffect(() => {
        const code = params.get('asset');
        if (code && assets.length) {
            const a = assets.find(x => x.asset_id === code);
            // eslint-disable-next-line react-hooks/set-state-in-effect -- one-shot deep-link open
            if (a) { setSelected(a); setParams({}, { replace: true }); }
        }
    }, [params, assets, setParams]);

    // ── Stats ─────────────────────────────────────────────────────────────────
    const stats = useMemo(() => {
        const today = new Date();
        let due = 0, checked = 0, broken = 0;
        for (const a of assets) {
            if (a.broken_count > 0) broken++;
            if (a.check_count > 0) checked++;
            if (a.start_date) {
                const plan = planForType(a.type_name);
                if (plan) {
                    // "due" only when there are due rounds still not recorded
                    const need = totalDueRounds(plan, a.start_date, today);
                    if (need > 0 && a.check_count < need) due++;
                }
            }
        }
        return { total: assets.length, due, checked, broken };
    }, [assets]);

    const grouped = useMemo(() => {
        const map: Record<PlanKey, MaAsset[]> = { notebook_pc: [], printer: [], monitor: [] };
        for (const a of assets) {
            const p = planForType(a.type_name);
            if (p) map[p].push(a);
        }
        return map;
    }, [assets]);

    const exportReport = async () => {
        setExporting(true);
        try {
            const dateFrom = `${startYear}-01-01`;
            const dateTo = `${endYear}-12-31`;
            const qs = new URLSearchParams();
            qs.set('from', dateFrom);
            qs.set('to', dateTo);
            if (planTab !== 'all') qs.set('plan', planTab);
            const res = await fetch(`/api/ma/report?${qs}`);
            const rows: (MaCheck & { asset_code: string; type_name: string; description: string; serial_number: string; brand_model: string; holder: string; department: string })[] = await res.json();
            const header = 'Asset ID,ประเภท,แผนบำรุงรักษา,รายการตรวจ,รอบที่,วันครบกำหนด,สถานะเครื่อง,หมายเหตุ,ผู้ตรวจ,เวลาที่ตรวจ,สถานะหลังแก้ไข,หมายเหตุการแก้ไข,ผู้แก้ไข,เวลาที่แก้ไข,Serial,ยี่ห้อ/รุ่น,ผู้ถือครอง,แผนก\n';
            const body = rows.map(r => {
                const item = MA_PLANS[r.plan]?.items.find(i => i.seq === r.item_seq);
                const planLabel = MA_PLANS[r.plan]?.label ?? r.plan;
                const cond = CONDITION_META[r.condition]?.label ?? r.condition;
                const checkedAt = r.checked_at ? new Date(r.checked_at).toLocaleString('th-TH') : '';
                const resCond = r.resolution_condition ? (CONDITION_META[r.resolution_condition]?.label ?? r.resolution_condition) : '';
                const resolvedAt = r.resolved_at ? new Date(r.resolved_at).toLocaleString('th-TH') : '';
                return [r.asset_code, r.type_name, planLabel, item?.title ?? `#${r.item_seq}`,
                    r.round_no, formatThai(new Date(r.due_date.slice(0, 10) + 'T00:00:00')), cond, r.remark,
                    r.checked_by ?? '', checkedAt, resCond, r.resolution_remark ?? '', r.resolved_by ?? '', resolvedAt,
                    r.serial_number, r.brand_model, r.holder, r.department]
                    .map(v => `"${String(v ?? '').replace(/"/g, '""')}"`).join(',');
            }).join('\n');
            const blob = new Blob(['﻿' + header + body], { type: 'text/csv;charset=utf-8;' });
            const url = URL.createObjectURL(blob);
            const link = document.createElement('a');
            const range = `_ปี${startYear + 543}_ถึง_${endYear + 543}`;
            link.href = url; link.download = `รายงานการบำรุงรักษา${range}.csv`; link.click();
            URL.revokeObjectURL(url);
        } catch (e) { console.error('export report', e); toast.error('ดึงรายงานไม่สำเร็จ'); }
        setExporting(false);
    };

    const exportPDF = async () => {
        setExportingPdf(true);
        try {
            const dateFrom = `${startYear}-01-01`;
            const dateTo = `${endYear}-12-31`;
            const qs = new URLSearchParams();
            qs.set('from', dateFrom);
            qs.set('to', dateTo);
            if (planTab !== 'all') qs.set('plan', planTab);
            const res = await fetch(`/api/ma/report?${qs}`);
            const rows: MaReportRow[] = await res.json();
            const ok = openMaReportPdf({
                assets, rows, startYear, endYear
            });
            if (!ok) toast.error('เบราว์เซอร์บล็อกหน้าต่างใหม่ — โปรดอนุญาต popup สำหรับเว็บนี้ แล้วลองอีกครั้ง');
        } catch (e) { console.error('export pdf', e); toast.error('สร้างรายงาน PDF ไม่สำเร็จ'); }
        setExportingPdf(false);
    };

    const STAT_CARDS = [
        { label: 'เครื่องในระบบบำรุงรักษา', value: stats.total, color: '#2563EB', bg: 'var(--color-primary-soft)', icon: Wrench },
        { label: 'ถึงรอบ / ครบกำหนด',       value: stats.due, color: '#F59E0B', bg: 'var(--color-warning-soft)', icon: Clock },
        { label: 'มีบันทึกการตรวจแล้ว',     value: stats.checked, color: '#10B981', bg: 'var(--color-success-soft)', icon: CheckCircle2 },
        { label: 'เครื่องเสีย / ส่งซ่อม',   value: stats.broken, color: '#EF4444', bg: '#FEF2F2', icon: AlertTriangle },
    ];

    return (
        <div className="space-y-6">
            {/* Title/subtitle live in AppHeader — no duplicate heading here. */}

            {/* Stats */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                {STAT_CARDS.map(({ label, value, color, bg, icon: Icon }, i) => (
                    <motion.div key={label} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.06 }} className="card p-5 flex items-center gap-4">
                        <div className="w-11 h-11 rounded-xl flex items-center justify-center flex-shrink-0" style={{ background: bg }}>
                            <Icon className="w-5 h-5" style={{ color }} />
                        </div>
                        <div>
                            <p className="text-2xl font-black" style={{ color }}>{value}</p>
                            <p className="text-[12.5px] font-semibold" style={{ color: 'var(--color-text-secondary)' }}>{label}</p>
                        </div>
                    </motion.div>
                ))}
            </div>

            {/* Plan tabs */}
            <div className="flex flex-wrap gap-2">
                {([{ key: 'all' as PlanTab, label: 'ทั้งหมด', color: '#2563EB', bg: 'var(--color-primary-soft)' },
                   ...PLAN_ORDER.map(k => ({ key: k as PlanTab, label: MA_PLANS[k].label, color: MA_PLANS[k].color, bg: MA_PLANS[k].bg }))
                ]).map(t => {
                    const active = planTab === t.key;
                    return (
                        <button key={t.key} onClick={() => setPlanTab(t.key)}
                            className="flex items-center gap-2 px-3.5 py-2 rounded-xl text-[13px] font-semibold transition-all"
                            style={{ background: active ? t.bg : 'var(--color-surface)', color: active ? t.color : 'var(--color-text-secondary)', border: `1px solid ${active ? t.color + '40' : 'var(--color-border)'}` }}>
                            {t.label}
                        </button>
                    );
                })}
            </div>

            {/* Toolbar */}
            <div className="flex flex-wrap gap-3 items-end">
                <div className="relative flex-1 min-w-[220px]">
                    <label className="field-label">ค้นหา</label>
                    <Search className="absolute left-3.5 bottom-3 w-4 h-4" style={{ color: 'var(--color-text-tertiary)' }} />
                    <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Asset ID, Serial, ยี่ห้อ, ผู้ถือครอง..." className="input" style={{ paddingLeft: '2.5rem' }} />
                </div>
                <div style={{ width: 150 }}>
                    <label className="field-label">ปีที่ออกรายงาน (จาก)</label>
                    <select value={startYear} onChange={e => setStartYear(Number(e.target.value))} className="input">
                        {Array.from({ length: 6 }, (_, i) => currentYear - 3 + i).map(y => (
                            <option key={y} value={y}>พ.ศ. {y + 543}</option>
                        ))}
                    </select>
                </div>
                <div style={{ width: 150 }}>
                    <label className="field-label">ถึงปี</label>
                    <select value={endYear} onChange={e => setEndYear(Number(e.target.value))} className="input">
                        {Array.from({ length: 6 }, (_, i) => currentYear - 3 + i).map(y => (
                            <option key={y} value={y}>พ.ศ. {y + 543}</option>
                        ))}
                    </select>
                </div>
                <button onClick={() => setIncludeHidden(h => !h)} className="btn gap-2" style={{ color: includeHidden ? 'var(--color-primary)' : 'var(--color-text-secondary)' }}>
                    {includeHidden ? <Eye className="w-4 h-4" /> : <EyeOff className="w-4 h-4" />}
                    {includeHidden ? 'แสดงเครื่องที่ซ่อน' : 'ซ่อนเครื่องที่ปิดไว้'}
                </button>
                <button onClick={fetchAssets} className="btn-icon" title="รีเฟรช"><RefreshCw className="w-4 h-4" /></button>
                {/* Unified export dropdown (PDF / CSV) */}
                <div className="relative">
                    <button onClick={() => setShowExport(v => !v)} disabled={exporting || exportingPdf} className="btn btn-primary gap-2" title="ส่งออกรายงาน">
                        {(exporting || exportingPdf) ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
                        ส่งออก
                        <ChevronDown className={`w-3.5 h-3.5 transition-transform ${showExport ? 'rotate-180' : ''}`} />
                    </button>
                    {showExport && (
                        <>
                            <div className="fixed inset-0 z-[60]" onClick={() => setShowExport(false)} />
                            <div className="absolute right-0 mt-1.5 z-[61] py-1.5 rounded-xl overflow-hidden min-w-[200px]"
                                style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', boxShadow: '0 8px 30px rgba(15,23,42,0.14)' }}>
                                <button onClick={() => { setShowExport(false); exportPDF(); }}
                                    className="w-full flex items-center gap-3 px-4 py-2.5 text-[13px] font-medium transition-colors hover:bg-[var(--color-surface-2)]"
                                    style={{ color: 'var(--color-text-primary)' }}>
                                    <FileText className="w-4 h-4" style={{ color: 'var(--color-primary)' }} />
                                    <div className="text-left">
                                        <p className="leading-none">รายงาน PDF</p>
                                        <p className="text-[10.5px] mt-0.5" style={{ color: 'var(--color-text-tertiary)' }}>ตาราง Checklist สำหรับพิมพ์</p>
                                    </div>
                                </button>
                                <button onClick={() => { setShowExport(false); exportReport(); }}
                                    className="w-full flex items-center gap-3 px-4 py-2.5 text-[13px] font-medium transition-colors hover:bg-[var(--color-surface-2)]"
                                    style={{ color: 'var(--color-text-primary)' }}>
                                    <Download className="w-4 h-4" style={{ color: 'var(--color-text-secondary)' }} />
                                    <div className="text-left">
                                        <p className="leading-none">ไฟล์ CSV</p>
                                        <p className="text-[10.5px] mt-0.5" style={{ color: 'var(--color-text-tertiary)' }}>เปิดใน Excel / Google Sheets</p>
                                    </div>
                                </button>
                            </div>
                        </>
                    )}
                </div>
            </div>

            {/* Asset groups */}
            {loading ? (
                <div className="py-20 text-center text-[14px]" style={{ color: 'var(--color-text-tertiary)' }}><RefreshCw className="w-5 h-5 mx-auto mb-2 animate-spin" />กำลังโหลดข้อมูล...</div>
            ) : assets.length === 0 ? (
                <div className="py-20 text-center text-[14px]" style={{ color: 'var(--color-text-tertiary)' }}>ไม่พบทรัพย์สินในระบบบำรุงรักษา</div>
            ) : (
                PLAN_ORDER.filter(p => grouped[p].length > 0).map(planKey => {
                    const plan = MA_PLANS[planKey];
                    const PIcon = plan.icon;
                    return (
                        <div key={planKey} className="card-lg overflow-hidden">
                            <div className="px-5 py-3.5 flex items-center gap-3" style={{ borderBottom: '1px solid var(--color-border)', background: plan.bg }}>
                                <div className="w-9 h-9 rounded-xl flex items-center justify-center" style={{ background: 'var(--color-surface)' }}>
                                    <PIcon className="w-5 h-5" style={{ color: plan.color }} />
                                </div>
                                <div className="flex-1">
                                    <h3 className="text-[14px] font-bold" style={{ color: plan.color }}>{plan.label}</h3>
                                    <p className="text-[11px]" style={{ color: 'var(--color-text-secondary)' }}>{plan.items.length} หัวข้อการบำรุงรักษา · {grouped[planKey].length} เครื่อง</p>
                                </div>
                            </div>
                            <div className="divide-y" style={{ borderColor: 'var(--color-border)' }}>
                                {grouped[planKey].map(a => <AssetRow key={a.id} asset={a} plan={planKey} onOpen={() => setSelected(a)} />)}
                            </div>
                        </div>
                    );
                })
            )}

            {selected && (
                <MaintenanceModal
                    asset={selected}
                    checkedBy={user?.name ?? user?.email ?? ''}
                    onClose={() => setSelected(null)}
                    onChanged={fetchAssets}
                />
            )}
        </div>
    );
}

// ─── Asset row ──────────────────────────────────────────────────────────────
function AssetRow({ asset, plan, onOpen }: { asset: MaAsset; plan: PlanKey; onOpen: () => void }) {
    let badge: { label: string; color: string; bg: string };
    if (!asset.start_date) {
        badge = { label: 'ยังไม่ตั้งวันเริ่มตรวจ', color: '#94A3B8', bg: 'var(--color-surface-2)' };
    } else if (asset.broken_count > 0) {
        badge = { label: 'มีรายการเครื่องเสีย', color: '#EF4444', bg: '#FEF2F2' };
    } else {
        const need = totalDueRounds(plan, asset.start_date);
        if (need === 0) {
            badge = { label: 'ยังไม่ถึงรอบ', color: '#10B981', bg: 'var(--color-success-soft)' };
        } else if (asset.check_count >= need) {
            badge = { label: 'ตรวจครบตามกำหนด', color: '#10B981', bg: 'var(--color-success-soft)' };
        } else {
            badge = { label: 'ถึงรอบบำรุงรักษา', color: '#F59E0B', bg: 'var(--color-warning-soft)' };
        }
    }
    return (
        <button onClick={onOpen} className="w-full flex items-center gap-3 px-5 py-3 text-left transition-colors hover:bg-[var(--color-surface-2)]">
            <span className="font-mono text-[13px] font-semibold w-[70px] flex-shrink-0" style={{ color: MA_PLANS[plan].color }}>{asset.asset_id}</span>
            <div className="min-w-0 flex-1">
                <p className="text-[13px] font-medium truncate" style={{ color: 'var(--color-text-primary)' }}>{asset.brand_model || asset.description || asset.type_name}</p>
                <p className="text-[11px] truncate" style={{ color: 'var(--color-text-tertiary)' }}>{asset.serial_number || '—'} · {asset.type_name}</p>
            </div>
            {asset.holder && (
                <div className="hidden sm:flex items-center gap-2 min-w-0 max-w-[180px]">
                    <div className="w-6 h-6 rounded-full flex items-center justify-center text-[9px] font-bold text-white flex-shrink-0" style={{ background: avatarColor(asset.holder) }}>{initials(asset.holder)}</div>
                    <span className="text-[12px] truncate" style={{ color: 'var(--color-text-secondary)' }}>{asset.holder}</span>
                </div>
            )}
            {asset.hidden && <span className="text-[10px] font-bold px-2 py-0.5 rounded-md flex items-center gap-1" style={{ background: 'var(--color-surface-2)', color: 'var(--color-text-tertiary)' }}><EyeOff className="w-3 h-3" />ซ่อน</span>}
            <span className="text-[11px] font-semibold px-2.5 py-1 rounded-full whitespace-nowrap" style={{ background: badge.bg, color: badge.color }}>{badge.label}</span>
            <ChevronRight className="w-4 h-4 flex-shrink-0" style={{ color: 'var(--color-text-tertiary)' }} />
        </button>
    );
}

// ─── Rich hover tooltip for a recorded check ───────────────────────────────────
function CheckTooltip({ check }: { check: MaCheck }) {
    const orig = CONDITION_META[check.condition];
    const OIcon = orig.icon;
    const res = check.resolution_condition ? CONDITION_META[check.resolution_condition] : null;
    const RIcon = res?.icon;
    return (
        <div className="absolute z-[60] bottom-full left-0 mb-2 w-64 rounded-xl p-3 shadow-xl text-left pointer-events-none"
            style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
            <p className="text-[10px] font-bold uppercase tracking-wide mb-1" style={{ color: 'var(--color-text-tertiary)' }}>ผลการตรวจครั้งแรก</p>
            <div className="flex items-center gap-1.5">
                <OIcon className="w-3.5 h-3.5" style={{ color: orig.color }} />
                <span className="text-[12px] font-bold" style={{ color: orig.text }}>{orig.label}</span>
            </div>
            {check.remark && <p className="text-[11px] mt-0.5 break-words" style={{ color: 'var(--color-text-secondary)' }}>“{check.remark}”</p>}
            <p className="text-[10px] mt-1" style={{ color: 'var(--color-text-tertiary)' }}>โดย {check.checked_by || '—'} · {formatThaiDateTime(check.checked_at)}</p>
            {res && RIcon ? (
                <>
                    <div className="my-2 border-t" style={{ borderColor: 'var(--color-border)' }} />
                    <p className="text-[10px] font-bold uppercase tracking-wide mb-1 flex items-center gap-1" style={{ color: 'var(--color-text-tertiary)' }}><Wrench className="w-3 h-3" />อัปเดตการแก้ไข</p>
                    <div className="flex items-center gap-1.5">
                        <RIcon className="w-3.5 h-3.5" style={{ color: res.color }} />
                        <span className="text-[12px] font-bold" style={{ color: res.text }}>{res.label}</span>
                    </div>
                    {check.resolution_remark && <p className="text-[11px] mt-0.5 break-words" style={{ color: 'var(--color-text-secondary)' }}>“{check.resolution_remark}”</p>}
                    <p className="text-[10px] mt-1" style={{ color: 'var(--color-text-tertiary)' }}>โดย {check.resolved_by || '—'} · {formatThaiDateTime(check.resolved_at)}</p>
                </>
            ) : (
                <p className="text-[10px] mt-2 flex items-center gap-1" style={{ color: 'var(--color-text-tertiary)' }}><Lock className="w-2.5 h-2.5" />ผลถูกล็อก — คลิกเพื่อบันทึกการแก้ไข</p>
            )}
        </div>
    );
}

// ─── A single round chip (recorded = immutable + hover tooltip, or pending) ─────
function RoundChip({ round, check, onClick }: { round: RoundInfo; check?: MaCheck; onClick: () => void }) {
    const [hover, setHover] = useState(false);
    if (check) {
        const effective = (check.resolution_condition ?? check.condition) as Condition;
        const cm = CONDITION_META[effective];
        const CIcon = cm.icon;
        const resolved = !!check.resolution_condition;
        return (
            <div className="relative" onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}>
                <button onClick={onClick} className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg transition-all hover:shadow-sm"
                    style={{ background: cm.bg, border: `1px solid ${cm.color}55` }}>
                    <CIcon className="w-3.5 h-3.5" style={{ color: cm.color }} />
                    <span className="text-[11px] font-bold" style={{ color: cm.text }}>ครั้งที่ {round.roundNo}</span>
                    <span className="text-[10px]" style={{ color: cm.text }}>· {formatThai(round.dueDate)}</span>
                    {resolved && <span className="flex items-center gap-0.5 ml-0.5 px-1 rounded text-[9px] font-bold" style={{ background: cm.color + '22', color: cm.text }}><Wrench className="w-2.5 h-2.5" />แก้ไขแล้ว</span>}
                    <Lock className="w-2.5 h-2.5 opacity-45" style={{ color: cm.text }} />
                </button>
                {hover && <CheckTooltip check={check} />}
            </div>
        );
    }
    const meta = round.status === 'due' ? { c: '#F59E0B', b: 'var(--color-warning-soft)', l: 'ถึงกำหนด' }
        : round.status === 'overdue' ? { c: '#EF4444', b: '#FEF2F2', l: 'เกินกำหนด' }
        : { c: '#94A3B8', b: 'var(--color-surface-2)', l: 'รอถึงรอบ' };
    const actionable = round.status === 'due' || round.status === 'overdue';
    return (
        <button onClick={actionable ? onClick : undefined} disabled={!actionable}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-semibold transition-all"
            style={{ background: meta.b, color: meta.c, border: `1px dashed ${meta.c}60`, opacity: actionable ? 1 : 0.7, cursor: actionable ? 'pointer' : 'default' }}
            title={actionable ? 'คลิกเพื่อบันทึกการตรวจ' : 'ยังไม่ถึงรอบ'}>
            <Clock className="w-3 h-3" />ครั้งที่ {round.roundNo} · {formatThai(round.dueDate)} · {meta.l}
        </button>
    );
}

// dialog state: record a new check, or view/resolve an existing one
type ChecklistDialog =
    | { mode: 'record'; item: MaItem; roundNo: number; dueDate: Date }
    | { mode: 'resolve'; item: MaItem; roundNo: number; check: MaCheck };

// ─── Maintenance detail modal ──────────────────────────────────────────────────
function MaintenanceModal({ asset, checkedBy, onClose, onChanged }: {
    asset: MaAsset; checkedBy: string; onClose: () => void; onChanged: () => void;
}) {
    const plan = planForType(asset.type_name);
    const [startDate, setStartDate] = useState(asset.start_date ? asset.start_date.slice(0, 10) : '');
    const [savedStart, setSavedStart] = useState(asset.start_date ? asset.start_date.slice(0, 10) : '');
    const [hidden, setHidden] = useState(asset.hidden);
    const [checks, setChecks] = useState<MaCheck[]>([]);
    const [savingSettings, setSavingSettings] = useState(false);
    const [dialog, setDialog] = useState<ChecklistDialog | null>(null);
    const [condition, setCondition] = useState<Condition>('normal');
    const [remark, setRemark] = useState('');
    const [resCondition, setResCondition] = useState<Condition>('normal');
    const [resRemark, setResRemark] = useState('');
    const [savingCheck, setSavingCheck] = useState(false);
    // year folders: collapsed by default except the current Buddhist year
    const curBYear = new Date().getFullYear() + 543;
    const [openYears, setOpenYears] = useState<Record<string, boolean>>({});
    const yearKey = (seq: number, year: number) => `${seq}-${year}`;
    const isYearOpen = (seq: number, year: number) => openYears[yearKey(seq, year)] ?? (year === curBYear);
    const toggleYear = (seq: number, year: number) =>
        setOpenYears(o => ({ ...o, [yearKey(seq, year)]: !(o[yearKey(seq, year)] ?? (year === curBYear)) }));

    const loadChecks = useCallback(async () => {
        try {
            const res = await fetch(`/api/ma/checks?asset_id=${asset.id}`);
            setChecks(await res.json());
        } catch (e) { console.error('load checks', e); }
    }, [asset.id]);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- state set inside async fetch
    useEffect(() => { loadChecks(); }, [loadChecks]);

    const checksByItem = useMemo(() => {
        const m = new Map<number, Map<number, MaCheck>>();
        for (const c of checks) {
            if (!m.has(c.item_seq)) m.set(c.item_seq, new Map());
            m.get(c.item_seq)!.set(c.round_no, c);
        }
        return m;
    }, [checks]);

    const saveSettings = async (patch: { start_date?: string; hidden?: boolean }) => {
        setSavingSettings(true);
        try {
            await fetch(`/api/ma/settings/${asset.id}`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(patch),
            });
            if (patch.start_date) setSavedStart(patch.start_date);
            if (typeof patch.hidden === 'boolean') setHidden(patch.hidden);
            onChanged();
        } catch (e) { console.error('save settings', e); toast.error('บันทึกการตั้งค่าไม่สำเร็จ'); }
        setSavingSettings(false);
    };

    const openRecord = (item: MaItem, roundNo: number, dueDate: Date) => {
        setDialog({ mode: 'record', item, roundNo, dueDate });
        setCondition('normal');
        setRemark('');
    };
    const openResolve = (item: MaItem, roundNo: number, check: MaCheck) => {
        setDialog({ mode: 'resolve', item, roundNo, check });
        setResCondition(check.resolution_condition ?? 'normal');
        setResRemark(check.resolution_remark ?? '');
    };

    const saveCheck = async () => {
        if (dialog?.mode !== 'record' || !plan) return;
        setSavingCheck(true);
        try {
            const res = await fetch('/api/ma/checks', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    asset_id: asset.id, plan, item_seq: dialog.item.seq, round_no: dialog.roundNo,
                    due_date: toISODate(dialog.dueDate), condition, remark, checked_by: checkedBy,
                }),
            });
            if (!res.ok) { const j = await res.json().catch(() => ({})); toast.error(j.error || 'บันทึกการตรวจไม่สำเร็จ'); }
            setDialog(null);
            await loadChecks();
            onChanged();
        } catch (e) { console.error('save check', e); toast.error('บันทึกการตรวจไม่สำเร็จ'); }
        setSavingCheck(false);
    };

    const resolveCheck = async () => {
        if (dialog?.mode !== 'resolve') return;
        setSavingCheck(true);
        try {
            await fetch(`/api/ma/checks/${dialog.check.id}/resolve`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ resolution_condition: resCondition, resolution_remark: resRemark, resolved_by: checkedBy }),
            });
            setDialog(null);
            await loadChecks();
            onChanged();
        } catch (e) { console.error('resolve check', e); toast.error('บันทึกการแก้ไขไม่สำเร็จ'); }
        setSavingCheck(false);
    };

    const planMeta = plan ? MA_PLANS[plan] : null;

    return (
        <Modal isOpen onClose={onClose} showCloseButton={false} className="w-full max-w-4xl m-4 max-h-[90vh] overflow-y-auto">
            {/* Header */}
            <div className="flex items-start justify-between p-6" style={{ borderBottom: '1px solid var(--color-border)' }}>
                <div className="flex items-center gap-4">
                    {planMeta && <div className="w-12 h-12 rounded-2xl flex items-center justify-center" style={{ background: planMeta.bg }}><planMeta.icon className="w-6 h-6" style={{ color: planMeta.color }} /></div>}
                    <div>
                        <h3 className="text-[16px] font-bold" style={{ color: 'var(--color-text-primary)' }}>{asset.brand_model || asset.description || asset.asset_id}</h3>
                        <code className="text-[12px] font-mono" style={{ color: 'var(--color-text-secondary)' }}>{asset.asset_id} · {asset.serial_number || 'N/A'} · {asset.type_name}</code>
                    </div>
                </div>
                <button onClick={onClose} className="btn-icon"><X className="w-4 h-4" /></button>
            </div>

            <div className="p-6 space-y-5">
                {/* Settings: start date + hide */}
                <div className="rounded-2xl p-4 space-y-3" style={{ background: 'var(--color-surface-2)', border: '1px solid var(--color-border)' }}>
                    <div className="flex items-center gap-2"><Calendar className="w-4 h-4" style={{ color: 'var(--color-primary)' }} /><p className="text-[13px] font-bold" style={{ color: 'var(--color-text-primary)' }}>ตั้งค่ารอบการบำรุงรักษา</p></div>
                    <div className="flex flex-wrap items-end gap-3">
                        <div style={{ width: 180 }}>
                            <label className="field-label">วันเริ่มตรวจเช็ค</label>
                            <ThaiDatePicker value={startDate || null} onChange={v => setStartDate(v || '')} placeholder="เลือกวันเริ่มตรวจ" />
                        </div>
                        <button onClick={() => startDate && saveSettings({ start_date: startDate })} disabled={savingSettings || !startDate || startDate === savedStart} className="btn btn-primary gap-2">
                            {savingSettings ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}บันทึกวันเริ่ม
                        </button>
                        <button onClick={() => saveSettings({ hidden: !hidden })} disabled={savingSettings} className="btn gap-2 ml-auto" style={{ color: hidden ? 'var(--color-primary)' : 'var(--color-text-secondary)' }}>
                            {hidden ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
                            {hidden ? 'เลิกซ่อนเครื่องนี้' : 'ซ่อนเครื่องนี้จากการบำรุงรักษา'}
                        </button>
                    </div>
                    {savedStart
                        ? <p className="text-[12px]" style={{ color: 'var(--color-text-secondary)' }}>เริ่มตรวจ: <strong>{formatThai(new Date(savedStart + 'T00:00:00'))}</strong> — ระบบคำนวณวันครบกำหนดแต่ละรอบให้อัตโนมัติ</p>
                        : <p className="text-[12px]" style={{ color: 'var(--color-warning)' }}>ยังไม่ได้ตั้งวันเริ่มตรวจ — กำหนดวันเริ่มเพื่อให้ระบบคำนวณรอบการบำรุงรักษา</p>}
                </div>

                {/* Checklist */}
                {!planMeta ? (
                    <p className="text-[13px]" style={{ color: 'var(--color-text-tertiary)' }}>ทรัพย์สินประเภทนี้ไม่มีแผนการบำรุงรักษา</p>
                ) : !savedStart ? (
                    <div className="text-center py-12 text-[13px]" style={{ color: 'var(--color-text-tertiary)' }}>
                        <ListChecks className="w-8 h-8 mx-auto mb-2 opacity-30" />ตั้งวันเริ่มตรวจด้านบนเพื่อเริ่มทำ Checklist
                    </div>
                ) : (
                    <div className="space-y-3">
                        <p className="text-[12px]" style={{ color: 'var(--color-text-secondary)' }}>
                            <ListChecks className="w-4 h-4 inline mr-1" style={{ color: planMeta.color }} />
                            รายการตรวจ {planMeta.items.length} หัวข้อ — คลิกที่รอบเพื่อบันทึกผล
                        </p>
                        {planMeta.items.map(item => {
                            const doneMap = checksByItem.get(item.seq) ?? new Map<number, MaCheck>();
                            const rounds = buildRounds(savedStart, item.freqMonths, new Set(doneMap.keys()));
                            const years = groupRoundsByYear(rounds);
                            return (
                                <div key={item.seq} className="rounded-2xl overflow-hidden" style={{ border: '1px solid var(--color-border)' }}>
                                    <div className="px-4 py-3" style={{ background: 'var(--color-surface-2)' }}>
                                        <div className="flex items-start gap-2">
                                            <span className="text-[11px] font-black w-6 h-6 rounded-lg flex items-center justify-center flex-shrink-0" style={{ background: planMeta.color + '18', color: planMeta.color }}>{item.seq}</span>
                                            <div className="min-w-0 flex-1">
                                                <p className="text-[13px] font-bold" style={{ color: 'var(--color-text-primary)' }}>{item.title}</p>
                                                <p className="text-[11.5px] leading-snug" style={{ color: 'var(--color-text-secondary)' }}>{item.detail}</p>
                                                <div className="flex flex-wrap items-center gap-2 mt-1.5">
                                                    <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded" style={{ background: 'var(--color-surface)', color: 'var(--color-text-tertiary)' }}>ความถี่: {freqLabel(item.freqMonths)}</span>
                                                    <span className="text-[10px] px-1.5 py-0.5 rounded" style={{ background: 'var(--color-surface)', color: 'var(--color-text-tertiary)' }}>ผู้รับผิดชอบ: {item.responsible}</span>
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                    {/* Round chips grouped into year folders */}
                                    <div className="px-4 py-3 space-y-2">
                                        {years.map(({ year, rounds: yrRounds }) => {
                                            const open = isYearOpen(item.seq, year);
                                            let doneN = 0, overdueN = 0, dueN = 0;
                                            for (const r of yrRounds) {
                                                if (doneMap.has(r.roundNo)) doneN++;
                                                else if (r.status === 'overdue') overdueN++;
                                                else if (r.status === 'due') dueN++;
                                            }
                                            return (
                                                <div key={year} className="rounded-xl overflow-hidden" style={{ border: '1px solid var(--color-border)' }}>
                                                    <button onClick={() => toggleYear(item.seq, year)} className="w-full flex items-center gap-2 px-3 py-2 transition-colors hover:bg-[var(--color-surface-2)]" style={{ background: 'var(--color-surface)' }}>
                                                        <ChevronDown className={`w-4 h-4 transition-transform ${open ? '' : '-rotate-90'}`} style={{ color: 'var(--color-text-tertiary)' }} />
                                                        <FolderClock className="w-4 h-4" style={{ color: planMeta.color }} />
                                                        <span className="text-[12px] font-bold" style={{ color: 'var(--color-text-primary)' }}>ปี {year}</span>
                                                        <span className="text-[10px]" style={{ color: 'var(--color-text-tertiary)' }}>· {yrRounds.length} รอบ</span>
                                                        <div className="ml-auto flex items-center gap-1.5">
                                                            {doneN > 0 && <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full" style={{ background: '#ECFDF5', color: '#065F46' }}>✓ {doneN} ตรวจแล้ว</span>}
                                                            {overdueN > 0 && <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full" style={{ background: '#FEF2F2', color: '#991B1B' }}>{overdueN} เกินกำหนด</span>}
                                                            {dueN > 0 && <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full" style={{ background: 'var(--color-warning-soft)', color: '#92400E' }}>{dueN} ถึงกำหนด</span>}
                                                        </div>
                                                    </button>
                                                    {open && (
                                                        <div className="px-3 py-2.5 flex flex-wrap gap-2" style={{ background: 'var(--color-surface-2)', borderTop: '1px solid var(--color-border)' }}>
                                                            {yrRounds.map(r => (
                                                                <RoundChip key={r.roundNo} round={r} check={doneMap.get(r.roundNo)}
                                                                    onClick={() => {
                                                                        const ex = doneMap.get(r.roundNo);
                                                                        if (ex) openResolve(item, r.roundNo, ex);
                                                                        else openRecord(item, r.roundNo, r.dueDate);
                                                                    }} />
                                                            ))}
                                                        </div>
                                                    )}
                                                </div>
                                            );
                                        })}
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>

            {/* Record / Resolve dialog */}
            <AnimatePresence>
                {dialog && (
                    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 flex items-center justify-center p-4" style={{ background: 'rgba(15,23,42,0.45)', zIndex: 100001 }}>
                        <motion.div initial={{ scale: 0.95, y: 10 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.95, y: 10 }} className="w-full max-w-md rounded-2xl overflow-hidden max-h-[80vh] overflow-y-auto" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
                            {dialog.mode === 'record' ? (
                                <div className="p-5 space-y-4">
                                    <div>
                                        <p className="text-[14px] font-bold" style={{ color: 'var(--color-text-primary)' }}>บันทึกการตรวจ — ครั้งที่ {dialog.roundNo}</p>
                                        <p className="text-[12px]" style={{ color: 'var(--color-text-secondary)' }}>{dialog.item.title} · ครบกำหนด {formatThai(dialog.dueDate)}</p>
                                    </div>
                                    <div>
                                        <label className="field-label">สถานะเครื่อง</label>
                                        <div className="grid grid-cols-2 gap-2">
                                            {CONDITIONS.map(cond => {
                                                const cm = CONDITION_META[cond];
                                                const CIcon = cm.icon;
                                                const sel = condition === cond;
                                                return (
                                                    <button key={cond} onClick={() => setCondition(cond)} className="flex items-center gap-2 px-3 py-2 rounded-xl text-[12.5px] font-semibold transition-all"
                                                        style={{ background: sel ? cm.bg : 'var(--color-surface-2)', color: sel ? cm.text : 'var(--color-text-secondary)', border: `1px solid ${sel ? cm.color : 'var(--color-border)'}` }}>
                                                        <CIcon className="w-4 h-4" style={{ color: sel ? cm.color : 'var(--color-text-tertiary)' }} />{cm.label}
                                                    </button>
                                                );
                                            })}
                                        </div>
                                    </div>
                                    <div>
                                        <label className="field-label">หมายเหตุ / Remark</label>
                                        <textarea value={remark} onChange={e => setRemark(e.target.value)} rows={3} placeholder="รายละเอียดเพิ่มเติม เช่น อาการ, อะไหล่ที่เปลี่ยน..." className="field-input resize-none w-full" style={{ fontFamily: 'inherit', fontSize: 13 }} />
                                    </div>
                                    <p className="text-[11px] flex items-center gap-1" style={{ color: 'var(--color-text-tertiary)' }}><Lock className="w-3 h-3" />เมื่อบันทึกแล้วจะไม่สามารถแก้ไขผลได้ แต่อัปเดตการแก้ไขภายหลังได้</p>
                                    <div className="flex justify-end gap-2">
                                        <button onClick={() => setDialog(null)} className="btn">ยกเลิก</button>
                                        <button onClick={saveCheck} disabled={savingCheck} className="btn btn-primary gap-2">
                                            {savingCheck ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle2 className="w-3.5 h-3.5" />}บันทึกการตรวจ
                                        </button>
                                    </div>
                                </div>
                            ) : (
                                <div className="p-5 space-y-4">
                                    <div>
                                        <p className="text-[14px] font-bold" style={{ color: 'var(--color-text-primary)' }}>รายละเอียดการตรวจ — ครั้งที่ {dialog.roundNo}</p>
                                        <p className="text-[12px]" style={{ color: 'var(--color-text-secondary)' }}>{dialog.item.title} · ครบกำหนด {formatThai(new Date(dialog.check.due_date.slice(0, 10) + 'T00:00:00'))}</p>
                                    </div>
                                    {/* Locked original result */}
                                    {(() => {
                                        const cm = CONDITION_META[dialog.check.condition];
                                        const CIcon = cm.icon;
                                        return (
                                            <div className="rounded-xl p-3" style={{ background: cm.bg, border: `1px solid ${cm.color}40` }}>
                                                <div className="flex items-center justify-between">
                                                    <div className="flex items-center gap-1.5">
                                                        <CIcon className="w-4 h-4" style={{ color: cm.color }} />
                                                        <span className="text-[13px] font-bold" style={{ color: cm.text }}>{cm.label}</span>
                                                    </div>
                                                    <span className="text-[10px] font-bold flex items-center gap-1" style={{ color: cm.text }}><Lock className="w-3 h-3" />ผลตรวจครั้งแรก (ล็อก)</span>
                                                </div>
                                                {dialog.check.remark && <p className="text-[12px] mt-1 break-words" style={{ color: cm.text }}>“{dialog.check.remark}”</p>}
                                                <p className="text-[10px] mt-1" style={{ color: cm.text, opacity: 0.8 }}>โดย {dialog.check.checked_by || '—'} · {formatThaiDateTime(dialog.check.checked_at)}</p>
                                            </div>
                                        );
                                    })()}
                                    {/* Resolution form */}
                                    <div>
                                        <label className="field-label flex items-center gap-1"><Wrench className="w-3.5 h-3.5" />อัปเดตว่าได้แก้ไขแล้ว — สถานะหลังแก้ไข</label>
                                        <div className="grid grid-cols-2 gap-2">
                                            {CONDITIONS.map(cond => {
                                                const cm = CONDITION_META[cond];
                                                const CIcon = cm.icon;
                                                const sel = resCondition === cond;
                                                return (
                                                    <button key={cond} onClick={() => setResCondition(cond)} className="flex items-center gap-2 px-3 py-2 rounded-xl text-[12.5px] font-semibold transition-all"
                                                        style={{ background: sel ? cm.bg : 'var(--color-surface-2)', color: sel ? cm.text : 'var(--color-text-secondary)', border: `1px solid ${sel ? cm.color : 'var(--color-border)'}` }}>
                                                        <CIcon className="w-4 h-4" style={{ color: sel ? cm.color : 'var(--color-text-tertiary)' }} />{cm.label}
                                                    </button>
                                                );
                                            })}
                                        </div>
                                    </div>
                                    <div>
                                        <label className="field-label">หมายเหตุการแก้ไข / Remark</label>
                                        <textarea value={resRemark} onChange={e => setResRemark(e.target.value)} rows={3} placeholder="รายละเอียดการแก้ไข เช่น เปลี่ยนอะไหล่อะไร, แก้ไขอย่างไร..." className="field-input resize-none w-full" style={{ fontFamily: 'inherit', fontSize: 13 }} />
                                    </div>
                                    <div className="flex justify-end gap-2">
                                        <button onClick={() => setDialog(null)} className="btn">ปิด</button>
                                        <button onClick={resolveCheck} disabled={savingCheck} className="btn btn-primary gap-2">
                                            {savingCheck ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Wrench className="w-3.5 h-3.5" />}บันทึกการแก้ไข
                                        </button>
                                    </div>
                                </div>
                            )}
                        </motion.div>
                    </motion.div>
                )}
            </AnimatePresence>

            <div className="flex justify-end p-5 pt-0">
                <button onClick={onClose} className="btn btn-primary">ปิด</button>
            </div>
        </Modal>
    );
}
