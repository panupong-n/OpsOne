import { confirmDialog } from '../components/ui/confirm';
import { toast } from 'sonner';
import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { Modal } from '../components/ui/modal';
import {
    Search, CheckCircle, XCircle, Plus,
    X, SlidersHorizontal, Monitor, Server, Laptop,
    HardDrive, Router, Shield, Users, Wrench, Globe, FileText, Box,
    ChevronDown, RefreshCw, Download, ToggleLeft, ToggleRight,
    Building2, Layers, type LucideIcon, Trash2, MessageSquare, Save,
    LayoutList, UserSearch, ArrowRightLeft, Clock, Pencil,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { isAdmin } from '../lib/permissions';
import { avatarColor, initials } from '../lib/avatar';
import { planForType, MA_PLANS, currentRound, roundDueDate, formatThai, freqLabel } from './maintenance/maPlans';

// ─── Types ────────────────────────────────────────────────────────────────────
interface Asset {
    id: string;
    group_name: string;
    type_name: string;
    asset_id: string;
    description: string;
    serial_number: string;
    brand_model: string;
    responsibility: string;
    holder: string;
    employee_id?: string;
    owner: string;
    building: string;
    floor: string;
    department: string;
    sub_section: string;
    status: string;
    updated_date: string;
    notes?: string;
    created_at?: string;
    updated_at?: string;
}

interface HolderSummary {
    holder: string;
    total: number;
    active: number;
    inactive: number;
    top_groups: string[];
    employee_id?: string;
}

interface AssetTransfer {
    id: number;
    asset_id: string;
    from_holder: string | null;
    to_holder: string;
    reason: string | null;
    transferred_at: string;
    created_by: string | null;
}

interface FieldSuggestions {
    descriptions: string[];
    brand_models: string[];
    responsibilities: string[];
    holders: string[];
    buildings: string[];
    floors: string[];
    departments: string[];
    owners: string[];
    employee_ids: string[];
}

interface Stats {
    total: string;
    active: string;
    inactive: string;
    groups: string[];
    types: string[];
    departments: string[];
}

// ─── Employee ID Map (from Book1.csv) ─────────────────────────────────────────
const EMPLOYEE_MAP: Record<string, string> = {
    'Noppadol Sukhmol': 'TEN-001',
    'Thammanoon Cherjun': 'TEN-002',
    'Sasithron Pipitrat': 'TEN-003',
    'Thanyanop Rawdsatitd': 'TEN-004',
    'Nirut Rodngam': 'TEN-005',
    'Chinnawat Anutarawit': 'TEN-006',
    'Chanin Sundhagul': 'TEN-007',
    'Pasin Rattanasin': 'TEN-008',
    'Pakawat Kanchanapumintra': 'TEN-009',
    'Jidapa Onchusri': 'TEN-010',
    'Chunticha Meekreurod': 'TEN-011',
    'Anirut Naknakorn': 'TEN-012',
    'Wittaya Promma': 'TEN-013',
    'Sirirat Lompitak': 'TEN-014',
    'Pisut Potawanit': 'TEN-015',
    'Purich Matchamek': 'TEN-016',
    'Krisda Lertsaengpetch': 'TEN-018',
    'Watcharapol Wongtanajaroen': 'TEN-019',
    'San Mingkwansuk': 'TEN-020',
    'Pimonphan Srichairattanakul': 'TEN-021',
    'Wannaporn Rodjit': 'TEN-024',
    'Sarinee Kaseng': 'TEN-025',
    'Natcha Awasri': 'TEN-027',
    'Taradol Phetpraphai': 'TEN-028',
    'Nattapon Poca': 'TEN-031',
    'Variya Jantarapitak': 'TEN-033',
    'Nittaya Mokkhawat': 'TEN-034',
    'Poon Boonpan': 'TEN-037',
    'Nattapong Buaon': 'TEN-038',
    'Panupong Nijjaboon': 'TEN-040',
    'Peeradon Phaewthaisong': 'TEN-041',
    'Tawitchakorn Potinakom': 'TEN-042',
    'Ratchakit Sakuldee': 'TEN-043',
    'Pakamas Mungpao': 'TEN-044',
    'Suporn Panmaeng': 'TEN-045',
    'Wilairat Putsiri': 'TEN-046',
};

function employeeNum(name: string): number {
    const id = EMPLOYEE_MAP[name];
    if (!id) return 9999;
    const m = id.match(/\d+/);
    return m ? parseInt(m[0]) : 9999;
}

// Reverse map: TEN-001 → employee name
const ID_TO_EMPLOYEE: Record<string, string> = Object.fromEntries(
    Object.entries(EMPLOYEE_MAP).map(([name, id]) => [id, name])
);

/** Case-insensitive employee ID lookup */
function getEmpId(name: string): string {
    if (!name) return '';
    if (EMPLOYEE_MAP[name]) return EMPLOYEE_MAP[name];
    const lower = name.toLowerCase();
    const key = Object.keys(EMPLOYEE_MAP).find(k => k.toLowerCase() === lower);
    return key ? EMPLOYEE_MAP[key] : '';
}

/** Resolve name from employee ID, case-insensitive */
function getNameFromId(id: string): string {
    const upper = id.toUpperCase().trim();
    return ID_TO_EMPLOYEE[upper] ?? '';
}

/** True when a status string represents Active */
function assetIsActive(status: string) {
    return (status ?? '').trim() === 'Active';
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function getInitials(name: string) {
    return (name || '?').split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
}
const HOLDER_COLORS = ['#2563EB', '#10B981', '#F59E0B', '#0EA5E9', '#EC4899', '#F97316', '#8B5CF6'];
function holderColor(name: string) {
    let h = 0;
    for (const c of name) h = (h * 31 + c.charCodeAt(0)) % HOLDER_COLORS.length;
    return HOLDER_COLORS[h];
}

// ─── Constants ────────────────────────────────────────────────────────────────
const GROUP_META: Record<string, { icon: LucideIcon; color: string; bg: string }> = {
    Hardware:            { icon: Monitor,    color: '#2563EB', bg: '#EEF2FF' },
    Software:            { icon: Globe,      color: '#6366F1', bg: '#EEF2FF' },
    Network:             { icon: Router,     color: '#0EA5E9', bg: '#F0F9FF' },
    Facility:            { icon: Building2,  color: '#F59E0B', bg: '#FFFBEB' },
    Personnel:           { icon: Users,      color: '#10B981', bg: '#ECFDF5' },
    Information:         { icon: FileText,   color: '#0891B2', bg: '#ECFEFF' },
    'Internal Service':  { icon: Wrench,     color: '#F97316', bg: '#FFF7ED' },
};

const TYPE_ICONS: Record<string, LucideIcon> = {
    Notebook: Laptop, PC: Monitor, Server, Monitor: Monitor, Token: Shield,
    Printer: HardDrive, Storage: HardDrive, 'Network Switch': Router, Gateway: Router,
    'Extranal-Harddrive': HardDrive, 'Operating System': Globe, 'Supporting Software': Globe,
    Freeware: Globe, 'IT Staff': Users, 'IT Service': Wrench, 'Facility Management': Building2,
    'Room & Location': Building2, 'Documented Information': FileText,
};

const STATUS_META: Record<string, { label: string; color: string; bg: string; text: string; icon: LucideIcon }> = {
    Active:      { label: 'Active',    color: '#10B981', bg: '#ECFDF5', text: '#065F46', icon: CheckCircle },
    'In Active': { label: 'Inactive',  color: '#94A3B8', bg: '#F1F5F9', text: '#475569', icon: XCircle     },
};

// ─── AutocompleteInput ────────────────────────────────────────────────────────
function AutocompleteInput({
    value, onChange, suggestions, placeholder, className = 'field-input',
}: {
    value: string;
    onChange: (v: string) => void;
    suggestions: string[];
    placeholder?: string;
    className?: string;
}) {
    const [open, setOpen] = useState(false);
    const ref = useRef<HTMLDivElement>(null);

    const filtered = useMemo(() => {
        const q = value.trim().toLowerCase();
        const tenNumSort = (a: string, b: string) => {
            const na = parseInt(a.replace(/\D/g, '')) || 0;
            const nb = parseInt(b.replace(/\D/g, '')) || 0;
            return na !== nb ? na - nb : a.localeCompare(b);
        };
        if (!q) return [...suggestions].sort(tenNumSort).slice(0, 30);
        return suggestions
            .filter(s => s.toLowerCase().includes(q) && s.toLowerCase() !== q)
            .sort(tenNumSort)
            .slice(0, 30);
    }, [value, suggestions]);

    useEffect(() => {
        const handler = (e: MouseEvent) => {
            if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
        };
        document.addEventListener('mousedown', handler);
        return () => document.removeEventListener('mousedown', handler);
    }, []);

    return (
        <div ref={ref} className="relative">
            <input
                value={value}
                onChange={e => { onChange(e.target.value); setOpen(true); }}
                onFocus={() => setOpen(true)}
                placeholder={placeholder}
                className={className}
                autoComplete="off"
            />
            <AnimatePresence>
                {open && filtered.length > 0 && (
                    <motion.div
                        initial={{ opacity: 0, y: 4 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: 4 }}
                        transition={{ duration: 0.12 }}
                        className="absolute z-[9999] top-full left-0 right-0 mt-1 rounded-xl overflow-hidden shadow-xl"
                        style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', maxHeight: 220, overflowY: 'auto' }}
                    >
                        {filtered.map(s => (
                            <button
                                key={s}
                                type="button"
                                onMouseDown={e => { e.preventDefault(); onChange(s); setOpen(false); }}
                                className="w-full text-left px-3 py-2.5 text-[13px] transition-colors hover:bg-[var(--color-surface-2)]"
                                style={{ color: 'var(--color-text-primary)' }}
                            >
                                {s}
                            </button>
                        ))}
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
}

// ─── Component ────────────────────────────────────────────────────────────────
export default function ITAssets() {
    const { user } = useAuth();
    const navigate = useNavigate();
    // SUPER_ADMIN and STAFF may edit assets; interns are read-only.
    const isSuperAdmin = isAdmin(user?.role);
    const [maInfo, setMaInfo] = useState<{ start_date: string | null; check_count: number; last_checked_at: string | null; broken_count: number } | null>(null);
    const [assets,         setAssets]         = useState<Asset[]>([]);
    const [stats,          setStats]          = useState<Stats | null>(null);
    const [holders,        setHolders]        = useState<HolderSummary[]>([]);
    const [suggestions,    setSuggestions]    = useState<FieldSuggestions | null>(null);
    const [loading,        setLoading]        = useState(true);
    const [search,         setSearch]         = useState('');
    const [groupFilter,    setGroupFilter]    = useState('All');
    const [typeFilter,     setTypeFilter]     = useState('All');
    const [statusFilter,   setStatusFilter]   = useState('All');
    const [deptFilter,     setDeptFilter]     = useState('All');
    const [holderFilter,   setHolderFilter]   = useState('All');
    const [viewMode,       setViewMode]       = useState<'list' | 'byHolder'>('list');
    const [selected,       setSelected]       = useState<Asset | null>(null);
    const [detailTab,      setDetailTab]      = useState<'info' | 'transfer'>('info');
    const [notesInput,     setNotesInput]     = useState('');
    const [notesSaving,    setNotesSaving]    = useState(false);
    const [notesToast,     setNotesToast]     = useState(false);
    const [transfers,      setTransfers]      = useState<AssetTransfer[]>([]);
    const [transferTo,     setTransferTo]     = useState('');
    const [transferReason, setTransferReason] = useState('');
    const [transferring,   setTransferring]   = useState(false);
    const [showAdd,        setShowAdd]        = useState(false);
    const [showFilters,    setShowFilters]    = useState(false);
    const [editMode,       setEditMode]       = useState(false);
    const [editForm,       setEditForm]       = useState<Partial<Asset> & { employee_id?: string }>({});
    const [editSaving,     setEditSaving]     = useState(false);

    // ── Fetch ─────────────────────────────────────────────────────────────────
    const fetchAssets = useCallback(async () => {
        setLoading(true);
        try {
            const params = new URLSearchParams();
            if (groupFilter !== 'All') params.set('group_name', groupFilter);
            if (typeFilter  !== 'All') params.set('type_name', typeFilter);
            if (statusFilter !== 'All') params.set('status', statusFilter);
            if (holderFilter !== 'All') params.set('holder', holderFilter);
            if (search)                 params.set('search', search);
            const res = await fetch(`/api/assets?${params}`);
            const data = await res.json();
            setAssets(data);
        } catch (e) { console.error('fetch assets error', e); }
        setLoading(false);
    }, [groupFilter, typeFilter, statusFilter, holderFilter, search]);

    const fetchStats = useCallback(async () => {
        try {
            const res = await fetch('/api/assets/stats');
            const data = await res.json();
            setStats(data);
        } catch (e) { console.error('fetch stats error', e); }
    }, []);

    const fetchHolders = useCallback(async () => {
        try {
            const res = await fetch('/api/assets/holders');
            const data = await res.json();
            setHolders(data);
        } catch (e) { console.error('fetch holders error', e); }
    }, []);

    const fetchSuggestions = useCallback(async () => {
        try {
            const res = await fetch('/api/assets/fields');
            const data = await res.json();
            setSuggestions(data);
        } catch (e) { console.error('fetch suggestions error', e); }
    }, []);

    const fetchTransfers = useCallback(async (assetId: string) => {
        try {
            const res = await fetch(`/api/assets/${assetId}/transfers`);
            const data = await res.json();
            setTransfers(Array.isArray(data) ? data : []);
        } catch (e) { console.error('fetch transfers error', e); setTransfers([]); }
    }, []);

    useEffect(() => { fetchStats(); fetchHolders(); fetchSuggestions(); }, [fetchStats, fetchHolders, fetchSuggestions]);
    useEffect(() => {
        const t = setTimeout(fetchAssets, 300);
        return () => clearTimeout(t);
    }, [fetchAssets]);

    // ── Actions ───────────────────────────────────────────────────────────────
    const openSelected = (asset: Asset) => {
        setSelected(asset);
        setNotesInput(asset.notes ?? '');
        setDetailTab('info');
        setTransferTo('');
        setTransferReason('');
        setEditMode(false);
        setEditForm({});
        fetchTransfers(asset.id);
    };

    // Maintenance summary for the selected asset (only for MA-eligible types)
    useEffect(() => {
        setMaInfo(null);
        if (!selected || !planForType(selected.type_name)) return;
        let cancelled = false;
        (async () => {
            try {
                const res = await fetch(`/api/ma/assets?include_hidden=true&search=${encodeURIComponent(selected.asset_id)}`);
                const rows = await res.json();
                const match = Array.isArray(rows) ? rows.find((r: { asset_id: string }) => r.asset_id === selected.asset_id) : null;
                if (!cancelled && match) setMaInfo({ start_date: match.start_date, check_count: match.check_count, last_checked_at: match.last_checked_at, broken_count: match.broken_count });
            } catch (e) { console.error('fetch ma info', e); }
        })();
        return () => { cancelled = true; };
    }, [selected]);

    const toggleStatus = async (asset: Asset) => {
        const newStatus = asset.status === 'Active' ? 'In Active' : 'Active';
        try {
            const res = await fetch(`/api/assets/${asset.id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ ...asset, status: newStatus }),
            });
            if (!res.ok) throw new Error(await res.text());
            fetchAssets(); fetchStats(); fetchHolders();
            if (selected?.id === asset.id) setSelected({ ...asset, status: newStatus });
        } catch (e) { console.error(e); toast.error('เปลี่ยนสถานะไม่สำเร็จ'); }
    };

    const deleteAsset = async (id: string) => {
        if (!(await confirmDialog('ยืนยันลบทรัพย์สิน?'))) return;
        try {
            const res = await fetch(`/api/assets/${id}`, { method: 'DELETE' });
            if (!res.ok) throw new Error(await res.text());
            fetchAssets(); fetchStats(); fetchHolders();
            setSelected(null);
        } catch (e) { console.error(e); toast.error('ลบทรัพย์สินไม่สำเร็จ'); }
    };

    const saveNotes = async () => {
        if (!selected) return;
        setNotesSaving(true);
        try {
            const res = await fetch(`/api/assets/${selected.id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ ...selected, notes: notesInput }),
            });
            if (!res.ok) throw new Error(await res.text());
            setSelected({ ...selected, notes: notesInput });
            fetchAssets();
            setNotesToast(true);
            setTimeout(() => setNotesToast(false), 2500);
        } catch (e) { console.error(e); toast.error('บันทึกหมายเหตุไม่สำเร็จ'); }
        setNotesSaving(false);
    };

    const doTransfer = async () => {
        if (!selected || !transferTo.trim()) return;
        setTransferring(true);
        try {
            const res = await fetch(`/api/assets/${selected.id}/transfer`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ to_holder: transferTo.trim(), reason: transferReason }),
            });
            if (!res.ok) throw new Error(await res.text());
            const newTransfer = await res.json();
            setTransfers(prev => [newTransfer, ...prev]);
            setSelected(prev => prev ? { ...prev, holder: transferTo.trim() } : prev);
            setTransferTo('');
            setTransferReason('');
            fetchAssets(); fetchStats(); fetchHolders(); fetchSuggestions();
        } catch (e) { console.error(e); toast.error('โอนย้ายไม่สำเร็จ'); }
        setTransferring(false);
    };

    const saveEdit = async () => {
        if (!selected) return;
        setEditSaving(true);
        try {
            const updated = { ...selected, ...editForm };
            const res = await fetch(`/api/assets/${selected.id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(updated),
            });
            if (!res.ok) throw new Error(await res.text());
            setSelected(updated);
            setEditMode(false);
            fetchAssets(); fetchHolders(); fetchSuggestions();
        } catch (e) { console.error(e); toast.error('บันทึกไม่สำเร็จ'); }
        setEditSaving(false);
    };

    const setEdit = (k: keyof Asset | 'employee_id', v: string) => {
        setEditForm(f => {
            const next = { ...f, [k]: v };
            if (k === 'holder') {
                const id = getEmpId(v);
                if (id) next.employee_id = id;
            } else if (k === 'employee_id') {
                const name = getNameFromId(v);
                if (name) next.holder = name;
            }
            return next;
        });
    };

    const openHolder = (holder: string) => {
        setHolderFilter(holder);
        setViewMode('list');
        setShowFilters(true);
    };

    const filtered = useMemo(() => {
        const list = deptFilter === 'All' ? assets : assets.filter(a => a.department === deptFilter);
        return [...list].sort((a, b) => {
            const an = a.employee_id ? (parseInt(a.employee_id.replace(/\D/g, '')) || 9999) : employeeNum(a.holder);
            const bn = b.employee_id ? (parseInt(b.employee_id.replace(/\D/g, '')) || 9999) : employeeNum(b.holder);
            const diff = an - bn;
            return diff !== 0 ? diff : (a.asset_id || '').localeCompare(b.asset_id || '');
        });
    }, [assets, deptFilter]);
    const groups = stats?.groups ?? [];
    const types = stats?.types ?? [];
    const departments = stats?.departments?.filter(Boolean) ?? [];

    const exportCSV = () => {
        const header = 'Group,Type,Asset ID,Description,Serial,Brand/Model,Responsibility,Holder,Employee ID,Owner,Building,Floor,Department,Sub Section,Status,Updated,Notes\n';
        const body = filtered.map(a =>
            [a.group_name, a.type_name, a.asset_id, a.description, a.serial_number, a.brand_model,
             a.responsibility, a.holder, a.employee_id ?? getEmpId(a.holder), a.owner, a.building, a.floor, a.department, a.sub_section,
             a.status, a.updated_date, a.notes ?? ''].map(v => `"${(v ?? '').replace(/"/g, '""')}"`).join(',')
        ).join('\n');
        const blob = new Blob(['\uFEFF' + header + body], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url; link.download = 'assets_export.csv'; link.click();
        URL.revokeObjectURL(url);
    };

    return (
        <div className="space-y-6">

            {/* Stats Row */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                {([
                    { label: 'ทรัพย์สินทั้งหมด', value: stats?.total ?? '—', color: '#2563EB', bg: 'var(--color-primary-soft)', icon: Layers },
                    { label: 'Active',             value: stats?.active ?? '—', color: '#10B981', bg: 'var(--color-success-soft)', icon: CheckCircle },
                    { label: 'Inactive',           value: stats?.inactive ?? '—', color: '#94A3B8', bg: 'var(--color-surface-2)', icon: XCircle },
                    { label: 'กลุ่มประเภท',        value: String(groups.length), color: '#0EA5E9', bg: 'var(--color-info-soft)', icon: Box },
                ] as const).map(({ label, value, color, bg, icon: Icon }, i) => (
                    <motion.div key={label} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.06 }} className="card p-5 flex items-center gap-4">
                        <div className="w-11 h-11 rounded-xl flex items-center justify-center flex-shrink-0" style={{ background: bg }}>
                            <Icon className="w-5 h-5" style={{ color }} />
                        </div>
                        <div>
                            <p className="text-2xl font-black" style={{ color }}>{value}</p>
                            <p className="text-[13px] font-semibold" style={{ color: 'var(--color-text-secondary)' }}>{label}</p>
                        </div>
                    </motion.div>
                ))}
            </div>

            {/* View Mode Tabs */}
            <div className="flex items-center gap-2">
                {([
                    { mode: 'list' as const, label: 'รายการทรัพย์สิน', icon: LayoutList, active: { bg: 'var(--color-primary-soft)', color: 'var(--color-primary)', border: 'var(--color-primary)40' }, badge: null },
                    { mode: 'byHolder' as const, label: 'ดูตามผู้ถือครอง', icon: UserSearch, active: { bg: '#ECFDF5', color: '#10B981', border: '#10B98140' }, badge: holders.length },
                ]).map(({ mode, label, icon: Icon, active: act, badge }) => {
                    const isActive = viewMode === mode;
                    return (
                        <button key={mode} onClick={() => setViewMode(mode)}
                            className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-[14px] font-semibold transition-all"
                            style={{ background: isActive ? act.bg : 'var(--color-surface)', color: isActive ? act.color : 'var(--color-text-secondary)', border: `1px solid ${isActive ? act.border : 'var(--color-border)'}` }}>
                            <Icon className="w-4 h-4" />
                            {label}
                            {badge !== null && (
                                <span className="text-[11px] font-bold px-1.5 py-0.5 rounded-md" style={{ background: isActive ? act.color + '20' : 'var(--color-surface-2)', color: isActive ? act.color : 'var(--color-text-tertiary)' }}>{badge}</span>
                            )}
                        </button>
                    );
                })}
            </div>

            {viewMode === 'byHolder' && <HolderView holders={holders} onSelect={openHolder} />}

            {viewMode === 'list' && (<>

            {/* Group pills */}
            <div className="flex flex-wrap gap-2">
                <button onClick={() => { setGroupFilter('All'); setTypeFilter('All'); }}
                    className="flex items-center gap-2 px-3.5 py-2 rounded-xl text-[13px] font-semibold transition-all"
                    style={{ background: groupFilter === 'All' ? 'var(--color-primary-soft)' : 'var(--color-surface)', color: groupFilter === 'All' ? 'var(--color-primary)' : 'var(--color-text-secondary)', border: `1px solid ${groupFilter === 'All' ? 'var(--color-primary)40' : 'var(--color-border)'}` }}>
                    ทั้งหมด
                    <span className="text-[11px] font-bold px-1.5 py-0.5 rounded-md" style={{ background: groupFilter === 'All' ? 'var(--color-primary)20' : 'var(--color-surface-2)' }}>{stats?.total ?? 0}</span>
                </button>
                {groups.map(g => {
                    const meta = GROUP_META[g] ?? { icon: Box, color: '#64748B', bg: '#F8FAFC' };
                    const Icon = meta.icon;
                    const isActive = groupFilter === g;
                    return (
                        <button key={g} onClick={() => { setGroupFilter(isActive ? 'All' : g); setTypeFilter('All'); }}
                            className="flex items-center gap-2 px-3.5 py-2 rounded-xl text-[13px] font-semibold transition-all"
                            style={{ background: isActive ? meta.bg : 'var(--color-surface)', color: isActive ? meta.color : 'var(--color-text-secondary)', border: `1px solid ${isActive ? meta.color + '40' : 'var(--color-border)'}` }}>
                            <Icon className="w-3.5 h-3.5" />{g}
                        </button>
                    );
                })}
            </div>

            {/* Search + Filters bar */}
            <div className="flex flex-wrap gap-3 items-center">
                <div className="relative flex-1 min-w-[220px]">
                    <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4" style={{ color: 'var(--color-text-tertiary)' }} />
                    <input value={search} onChange={e => setSearch(e.target.value)} placeholder="ค้นหา Asset ID, Serial, ยี่ห้อ, ผู้ถือครอง..." className="input" style={{ paddingLeft: '2.5rem' }} />
                </div>
                {holderFilter !== 'All' && (
                    <div className="flex items-center gap-2 px-3 py-1.5 rounded-xl text-[13px] font-semibold" style={{ background: '#ECFDF5', color: '#065F46', border: '1px solid #10B98150' }}>
                        <UserSearch className="w-3.5 h-3.5" />{holderFilter}
                        <button onClick={() => setHolderFilter('All')} className="ml-0.5 hover:opacity-60 transition-opacity"><X className="w-3.5 h-3.5" /></button>
                    </div>
                )}
                <button onClick={() => setShowFilters(f => !f)} className="btn gap-2" style={{ color: showFilters ? 'var(--color-primary)' : 'var(--color-text-secondary)' }}>
                    <SlidersHorizontal className="w-4 h-4" />ตัวกรอง
                    <ChevronDown className={`w-3 h-3 transition-transform ${showFilters ? 'rotate-180' : ''}`} />
                </button>
                <button onClick={() => { fetchAssets(); fetchStats(); fetchHolders(); fetchSuggestions(); }} className="btn-icon" title="รีเฟรช"><RefreshCw className="w-4 h-4" /></button>
                <button onClick={exportCSV} className="btn gap-2"><Download className="w-4 h-4" />Export</button>
                <button onClick={() => setShowAdd(true)} className="btn btn-primary ml-auto gap-2"><Plus className="w-4 h-4" />เพิ่มทรัพย์สิน</button>
            </div>

            {/* Expanded filters */}
            <AnimatePresence>
                {showFilters && (
                    <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
                        <div className="card p-4 grid grid-cols-2 md:grid-cols-5 gap-3">
                            <div>
                                <label className="field-label">ประเภท</label>
                                <select value={typeFilter} onChange={e => setTypeFilter(e.target.value)} className="field-input">
                                    <option value="All">ทั้งหมด</option>
                                    {types.map(t => <option key={t} value={t}>{t}</option>)}
                                </select>
                            </div>
                            <div>
                                <label className="field-label">สถานะ</label>
                                <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} className="field-input">
                                    <option value="All">ทั้งหมด</option>
                                    <option value="Active">Active</option>
                                    <option value="In Active">Inactive</option>
                                </select>
                            </div>
                            <div>
                                <label className="field-label">แผนก</label>
                                <select value={deptFilter} onChange={e => setDeptFilter(e.target.value)} className="field-input">
                                    <option value="All">ทั้งหมด</option>
                                    {departments.map(d => <option key={d} value={d}>{d}</option>)}
                                </select>
                            </div>
                            <div>
                                <label className="field-label">ผู้ถือครอง</label>
                                <select value={holderFilter} onChange={e => setHolderFilter(e.target.value)} className="field-input">
                                    <option value="All">ทั้งหมด</option>
                                    {holders.map(h => <option key={h.holder} value={h.holder}>{h.holder} ({h.total})</option>)}
                                </select>
                            </div>
                            <div className="flex items-end">
                                <button onClick={() => { setTypeFilter('All'); setStatusFilter('All'); setDeptFilter('All'); setSearch(''); setGroupFilter('All'); setHolderFilter('All'); }} className="btn w-full justify-center">ล้างตัวกรอง</button>
                            </div>
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>

            {/* Asset Table */}
            <div className="card-lg overflow-hidden">
                <div className="px-5 py-3.5 flex items-center justify-between" style={{ borderBottom: '1px solid var(--color-border)' }}>
                    <div className="flex items-center gap-2">
                        <h3 className="text-[14px] font-semibold" style={{ color: 'var(--color-text-primary)' }}>รายการทรัพย์สิน</h3>
                        <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full" style={{ background: 'var(--color-primary-soft)', color: 'var(--color-primary)' }}>{filtered.length}</span>
                    </div>
                    <span className="text-[12px]" style={{ color: 'var(--color-text-tertiary)' }}>{loading ? 'กำลังโหลด…' : `แสดง ${filtered.length} จาก ${assets.length} รายการ`}</span>
                </div>
                <div className="hidden md:block overflow-x-auto" style={{ maxHeight: 'calc(100vh - 360px)' }}>
                    <table className="w-full min-w-[760px] border-collapse">
                        <thead className="sticky top-0 z-10">
                            <tr style={{ background: 'var(--color-surface-2)', boxShadow: 'inset 0 -1px 0 var(--color-border)' }}>
                                {['Asset ID', 'ประเภท', 'รายละเอียด', 'Serial No.', 'ยี่ห้อ/รุ่น', 'ผู้ถือครอง', 'แผนก', 'สถานะ'].map(h => (
                                    <th key={h} className="text-left px-4 py-2.5 text-[10.5px] font-semibold uppercase tracking-[0.06em] whitespace-nowrap" style={{ color: 'var(--color-text-tertiary)' }}>{h}</th>
                                ))}
                            </tr>
                        </thead>
                        <tbody>
                            {filtered.map(asset => {
                                const gMeta = GROUP_META[asset.group_name] ?? { icon: Box, color: '#64748B', bg: '#F8FAFC' };
                                const GIcon = TYPE_ICONS[asset.type_name] ?? gMeta.icon;
                                const isAct = assetIsActive(asset.status);
                                const empId = asset.employee_id || getEmpId(asset.holder);
                                return (
                                    <tr key={asset.id} className="table-row cursor-pointer transition-colors hover:bg-[var(--color-surface-2)]" style={{ borderBottom: '1px solid var(--color-border)' }} onClick={() => openSelected(asset)}>
                                        {/* Asset ID */}
                                        <td className="px-4 py-2.5">
                                            <div className="flex items-center gap-1.5">
                                                <span className="font-mono text-[12.5px] font-semibold" style={{ color: gMeta.color }}>{asset.asset_id}</span>
                                                {asset.notes && (
                                                    <span className="relative group/notestip">
                                                        <MessageSquare className="w-3.5 h-3.5 flex-shrink-0" style={{ color: 'var(--color-warning)' }} />
                                                        <span className="pointer-events-none absolute left-1/2 -translate-x-1/2 bottom-full mb-1.5 z-50 max-w-[260px] whitespace-pre-wrap rounded-lg px-2.5 py-1.5 text-[11px] font-medium shadow-lg opacity-0 group-hover/notestip:opacity-100 transition-opacity duration-150" style={{ background: 'var(--color-text-primary)', color: 'var(--color-surface)' }}>
                                                            {asset.notes}
                                                        </span>
                                                    </span>
                                                )}
                                            </div>
                                        </td>
                                        {/* Type / group */}
                                        <td className="px-4 py-2.5">
                                            <div className="flex items-center gap-2.5">
                                                <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0" style={{ background: gMeta.bg }}>
                                                    <GIcon className="w-4 h-4" style={{ color: gMeta.color }} />
                                                </div>
                                                <div className="min-w-0">
                                                    <p className="text-[13px] font-medium truncate" style={{ color: 'var(--color-text-primary)' }}>{asset.type_name}</p>
                                                    <p className="text-[10.5px]" style={{ color: 'var(--color-text-tertiary)' }}>{asset.group_name}</p>
                                                </div>
                                            </div>
                                        </td>
                                        {/* Description */}
                                        <td className="px-4 py-2.5"><p className="text-[13px] truncate max-w-[200px]" title={asset.description || ''} style={{ color: 'var(--color-text-secondary)' }}>{asset.description || '—'}</p></td>
                                        {/* Serial */}
                                        <td className="px-4 py-2.5"><span className="font-mono text-[12px]" style={{ color: 'var(--color-text-tertiary)' }}>{asset.serial_number || '—'}</span></td>
                                        {/* Brand */}
                                        <td className="px-4 py-2.5"><span className="text-[13px] truncate max-w-[140px] inline-block align-middle" title={asset.brand_model || ''} style={{ color: 'var(--color-text-secondary)' }}>{asset.brand_model || '—'}</span></td>
                                        {/* Holder with avatar */}
                                        <td className="px-4 py-2.5">
                                            {asset.holder ? (
                                                <div className="flex items-center gap-2.5">
                                                    <div className="w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-semibold text-white flex-shrink-0" style={{ background: avatarColor(asset.holder) }}>{initials(asset.holder)}</div>
                                                    <div className="min-w-0">
                                                        <p className="text-[13px] font-medium truncate max-w-[150px]" style={{ color: 'var(--color-text-primary)' }}>{asset.holder}</p>
                                                        {empId && <p className="font-mono text-[10px]" style={{ color: 'var(--color-text-tertiary)' }}>{empId}</p>}
                                                    </div>
                                                </div>
                                            ) : <span className="text-[13px]" style={{ color: 'var(--color-text-tertiary)' }}>—</span>}
                                        </td>
                                        {/* Department */}
                                        <td className="px-4 py-2.5"><span className="text-[12px] truncate max-w-[140px] inline-block align-middle" title={asset.department || ''} style={{ color: 'var(--color-text-secondary)' }}>{asset.department || '—'}</span></td>
                                        {/* Status (toggle moved into detail modal) */}
                                        <td className="px-4 py-2.5">
                                            <span className="flex items-center gap-1.5 text-[11.5px] font-semibold px-2 py-1 rounded-full w-fit" style={{ background: isAct ? 'var(--color-success-soft)' : 'var(--color-surface-2)', color: isAct ? 'var(--color-success)' : 'var(--color-text-tertiary)' }}>
                                                <span className="w-1.5 h-1.5 rounded-full" style={{ background: isAct ? 'var(--color-success)' : 'var(--color-text-tertiary)' }} />
                                                {isAct ? 'Active' : 'Inactive'}
                                            </span>
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                    {!loading && filtered.length === 0 && <div className="py-20 text-center text-[14px]" style={{ color: 'var(--color-text-tertiary)' }}>ไม่พบทรัพย์สินที่ตรงกับเงื่อนไข</div>}
                    {loading && <div className="py-20 text-center text-[14px]" style={{ color: 'var(--color-text-tertiary)' }}><RefreshCw className="w-5 h-5 mx-auto mb-2 animate-spin" />กำลังโหลดข้อมูล...</div>}
                </div>

                {/* Mobile card list (< md) */}
                <div className="md:hidden divide-y" style={{ borderColor: 'var(--color-border)' }}>
                    {loading ? (
                        <div className="py-16 text-center text-[14px]" style={{ color: 'var(--color-text-tertiary)' }}><RefreshCw className="w-5 h-5 mx-auto mb-2 animate-spin" />กำลังโหลดข้อมูล...</div>
                    ) : filtered.length === 0 ? (
                        <div className="py-16 text-center text-[14px]" style={{ color: 'var(--color-text-tertiary)' }}>ไม่พบทรัพย์สินที่ตรงกับเงื่อนไข</div>
                    ) : filtered.map(asset => {
                        const gMeta = GROUP_META[asset.group_name] ?? { icon: Box, color: '#64748B', bg: '#F8FAFC' };
                        const GIcon = TYPE_ICONS[asset.type_name] ?? gMeta.icon;
                        const isAct = assetIsActive(asset.status);
                        const empId = asset.employee_id || getEmpId(asset.holder);
                        return (
                            <button key={asset.id} onClick={() => openSelected(asset)} className="w-full text-left px-4 py-3.5 transition-colors hover:bg-[var(--color-surface-2)] active:bg-[var(--color-surface-2)]">
                                {/* Row 1: icon + type/desc + status */}
                                <div className="flex items-start gap-3">
                                    <div className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0" style={{ background: gMeta.bg }}>
                                        <GIcon className="w-4.5 h-4.5" style={{ color: gMeta.color }} />
                                    </div>
                                    <div className="min-w-0 flex-1">
                                        <div className="flex items-center gap-1.5">
                                            <span className="font-mono text-[12.5px] font-bold" style={{ color: gMeta.color }}>{asset.asset_id}</span>
                                            {asset.notes && <MessageSquare className="w-3 h-3 flex-shrink-0" style={{ color: 'var(--color-warning)' }} />}
                                        </div>
                                        <p className="text-[13px] font-medium truncate" style={{ color: 'var(--color-text-primary)' }}>{asset.description || asset.type_name}</p>
                                        <p className="text-[10.5px]" style={{ color: 'var(--color-text-tertiary)' }}>{asset.type_name} · {asset.group_name}</p>
                                    </div>
                                    <span className="flex items-center gap-1 text-[10.5px] font-semibold px-2 py-1 rounded-full flex-shrink-0" style={{ background: isAct ? 'var(--color-success-soft)' : 'var(--color-surface-2)', color: isAct ? 'var(--color-success)' : 'var(--color-text-tertiary)' }}>
                                        <span className="w-1.5 h-1.5 rounded-full" style={{ background: isAct ? 'var(--color-success)' : 'var(--color-text-tertiary)' }} />
                                        {isAct ? 'Active' : 'Inactive'}
                                    </span>
                                </div>
                                {/* Row 2: serial / brand / holder */}
                                <div className="mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-1.5 pl-12">
                                    {asset.serial_number && <span className="font-mono text-[11px]" style={{ color: 'var(--color-text-tertiary)' }}>SN: {asset.serial_number}</span>}
                                    {asset.brand_model && <span className="text-[11.5px]" style={{ color: 'var(--color-text-secondary)' }}>{asset.brand_model}</span>}
                                    {asset.holder && (
                                        <span className="flex items-center gap-1.5">
                                            <span className="w-5 h-5 rounded-full flex items-center justify-center text-[8px] font-semibold text-white flex-shrink-0" style={{ background: avatarColor(asset.holder) }}>{initials(asset.holder)}</span>
                                            <span className="text-[11.5px] font-medium" style={{ color: 'var(--color-text-primary)' }}>{asset.holder}</span>
                                            {empId && <span className="font-mono text-[10px]" style={{ color: 'var(--color-text-tertiary)' }}>· {empId}</span>}
                                        </span>
                                    )}
                                </div>
                            </button>
                        );
                    })}
                </div>
            </div>

            </>)} {/* end list view */}

            {/* Detail Modal */}
            {selected && (
                <Modal isOpen onClose={() => setSelected(null)} showCloseButton={false}
                    className="w-full max-w-4xl m-4 max-h-[90vh] overflow-y-auto">
                            {/* Header */}
                            <div className="flex items-start justify-between p-6" style={{ borderBottom: '1px solid var(--color-border)' }}>
                                <div className="flex items-center gap-4">
                                    {(() => { const gm = GROUP_META[selected.group_name] ?? { icon: Box, color: '#64748B', bg: '#F8FAFC' }; const GI = TYPE_ICONS[selected.type_name] ?? gm.icon; return <div className="w-12 h-12 rounded-2xl flex items-center justify-center" style={{ background: gm.bg }}><GI className="w-6 h-6" style={{ color: gm.color }} /></div>; })()}
                                    <div>
                                        <h3 className="text-[16px] font-bold" style={{ color: 'var(--color-text-primary)' }}>{selected.description || selected.asset_id}</h3>
                                        <code className="text-[12px] font-mono" style={{ color: 'var(--color-text-secondary)' }}>{selected.asset_id} · {selected.serial_number || 'N/A'}</code>
                                    </div>
                                </div>
                                <div className="flex items-center gap-2">
                                    {isSuperAdmin && detailTab === 'info' && (
                                        editMode
                                            ? <button onClick={() => { setEditMode(false); setEditForm({}); }} className="btn gap-1.5 text-[12px]"><X className="w-3.5 h-3.5" />ยกเลิก</button>
                                            : <button onClick={() => { setEditMode(true); setEditForm({ holder: selected.holder, responsibility: selected.responsibility, department: selected.department, building: selected.building, floor: selected.floor, owner: selected.owner, sub_section: selected.sub_section, status: selected.status, employee_id: selected.employee_id || getEmpId(selected.holder) }); }} className="btn gap-1.5 text-[12px]" style={{ color: 'var(--color-primary)' }}><Pencil className="w-3.5 h-3.5" />แก้ไข</button>
                                    )}
                                    <button onClick={() => setSelected(null)} className="btn-icon"><X className="w-4 h-4" /></button>
                                </div>
                            </div>

                            {/* Tab bar */}
                            <div className="flex" style={{ borderBottom: '1px solid var(--color-border)' }}>
                                <button onClick={() => setDetailTab('info')} className="flex-1 py-3 text-[14px] font-semibold transition-colors" style={{ color: detailTab === 'info' ? 'var(--color-primary)' : 'var(--color-text-secondary)', borderBottom: detailTab === 'info' ? '2px solid var(--color-primary)' : '2px solid transparent' }}>รายละเอียด</button>
                                <button onClick={() => setDetailTab('transfer')} className="flex-1 py-3 text-[14px] font-semibold transition-colors flex items-center justify-center gap-2" style={{ color: detailTab === 'transfer' ? '#F59E0B' : 'var(--color-text-secondary)', borderBottom: detailTab === 'transfer' ? '2px solid #F59E0B' : '2px solid transparent' }}>
                                    <ArrowRightLeft className="w-3.5 h-3.5" />โอนย้าย / ประวัติ
                                    {transfers.length > 0 && <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full" style={{ background: '#FFFBEB', color: '#B45309' }}>{transfers.length}</span>}
                                </button>
                            </div>

                            {/* Info tab */}
                            {detailTab === 'info' && (
                                <div className="p-6 space-y-2">
                                    {editMode ? (
                                        /* ── Edit mode (SUPER_ADMIN) ─────────────────────── */
                                        <>
                                            <div className="rounded-2xl p-4 mb-2 space-y-3" style={{ background: 'var(--color-primary-soft)', border: '1px solid var(--color-primary)30' }}>
                                                <div className="flex items-center gap-2"><Pencil className="w-3.5 h-3.5" style={{ color: 'var(--color-primary)' }} /><p className="text-[13px] font-bold" style={{ color: 'var(--color-primary)' }}>แก้ไขข้อมูล (SUPER ADMIN)</p></div>
                                                <div className="grid grid-cols-2 gap-3">
                                                    <div><label className="field-label">ผู้ถือครอง</label>
                                                        <AutocompleteInput value={editForm.holder ?? ''} onChange={v => setEdit('holder', v)} suggestions={suggestions?.holders ?? holders.map(h => h.holder)} placeholder="ชื่อผู้ถือครอง" /></div>
                                                    <div><label className="field-label">รหัสพนักงาน</label>
                                                        <AutocompleteInput value={editForm.employee_id ?? ''} onChange={v => setEdit('employee_id', v)} suggestions={[...new Set([...Object.keys(ID_TO_EMPLOYEE), ...(suggestions?.employee_ids ?? [])])]} placeholder="TEN-001..." /></div>
                                                </div>
                                                <div><label className="field-label">ผู้รับผิดชอบ</label>
                                                    <AutocompleteInput value={editForm.responsibility ?? ''} onChange={v => setEdit('responsibility', v)} suggestions={suggestions?.responsibilities ?? []} placeholder="" /></div>
                                                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                                                    <div><label className="field-label">ตึก</label>
                                                        <AutocompleteInput value={editForm.building ?? ''} onChange={v => setEdit('building', v)} suggestions={suggestions?.buildings ?? []} placeholder="" /></div>
                                                    <div><label className="field-label">ชั้น</label>
                                                        <AutocompleteInput value={editForm.floor ?? ''} onChange={v => setEdit('floor', v)} suggestions={suggestions?.floors ?? []} placeholder="" /></div>
                                                    <div><label className="field-label">แผนก</label>
                                                        <AutocompleteInput value={editForm.department ?? ''} onChange={v => setEdit('department', v)} suggestions={suggestions?.departments ?? []} placeholder="" /></div>
                                                </div>
                                                <div><label className="field-label">เจ้าของ</label>
                                                    <AutocompleteInput value={editForm.owner ?? ''} onChange={v => setEdit('owner', v)} suggestions={suggestions?.owners ?? []} placeholder="" /></div>
                                                <div><label className="field-label">Sub Section</label>
                                                    <input value={editForm.sub_section ?? ''} onChange={e => setEdit('sub_section', e.target.value)} className="field-input" /></div>
                                                <div><label className="field-label">สถานะ</label>
                                                    <select value={editForm.status ?? 'Active'} onChange={e => setEdit('status', e.target.value)} className="field-input">
                                                        <option value="Active">Active</option>
                                                        <option value="In Active">Inactive</option>
                                                    </select></div>
                                                <button onClick={saveEdit} disabled={editSaving} className="btn btn-primary w-full justify-center gap-2">
                                                    {editSaving ? <><RefreshCw className="w-3.5 h-3.5 animate-spin" />กำลังบันทึก...</> : <><Save className="w-3.5 h-3.5" />บันทึกการแก้ไข</>}
                                                </button>
                                            </div>
                                            {/* Read-only static rows */}
                                            {[
                                                { label: 'กลุ่ม',        value: selected.group_name },
                                                { label: 'ประเภท',       value: selected.type_name },
                                                { label: 'ยี่ห้อ / รุ่น', value: selected.brand_model },
                                                { label: 'Serial No.',    value: selected.serial_number },
                                                { label: 'อัพเดทล่าสุด', value: selected.updated_date },
                                            ].map(({ label, value }) => (
                                                <div key={label} className="flex justify-between items-center py-2.5 px-4 rounded-xl" style={{ background: 'var(--color-surface-2)' }}>
                                                    <span className="text-[13px] font-medium" style={{ color: 'var(--color-text-secondary)' }}>{label}</span>
                                                    <span className="text-[13px] font-semibold text-right" style={{ color: 'var(--color-text-primary)' }}>{value || '—'}</span>
                                                </div>
                                            ))}
                                        </>
                                    ) : (
                                        /* ── Read-only mode — 4-column horizontal layout ── */
                                        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
                                            {[
                                                { label: 'กลุ่ม',        value: selected.group_name },
                                                { label: 'ประเภท',       value: selected.type_name },
                                                { label: 'ยี่ห้อ / รุ่น', value: selected.brand_model },
                                                { label: 'Serial No.',    value: selected.serial_number },
                                                { label: 'ผู้รับผิดชอบ',  value: selected.responsibility },
                                                { label: 'ผู้ถือครอง',    value: selected.holder },
                                                { label: 'รหัสพนักงาน',  value: selected.employee_id || getEmpId(selected.holder) || '—' },
                                                { label: 'เจ้าของ',      value: selected.owner },
                                                { label: 'ตึก',          value: selected.building },
                                                { label: 'ชั้น',         value: selected.floor },
                                                { label: 'แผนก',         value: selected.department },
                                                { label: 'Sub Section',   value: selected.sub_section },
                                                { label: 'อัพเดทล่าสุด', value: selected.updated_date },
                                                { label: 'วันที่ขึ้นทะเบียน', value: selected.created_at ? new Date(selected.created_at).toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: 'numeric' }) : '—' },
                                                { label: 'จำนวนการโอนย้าย', value: `${transfers.length} ครั้ง` },
                                            ].map(({ label, value }) => (
                                                <div key={label} className="rounded-xl px-3.5 py-2.5" style={{ background: 'var(--color-surface-2)' }}>
                                                    <p className="text-[10.5px] font-semibold uppercase tracking-wide mb-1" style={{ color: 'var(--color-text-tertiary)' }}>{label}</p>
                                                    <p className="text-[13.5px] font-semibold break-words" style={{ color: label === 'รหัสพนักงาน' ? 'var(--color-primary)' : 'var(--color-text-primary)' }}>{value || '—'}</p>
                                                </div>
                                            ))}
                                            {/* Status cell — toggle lives here now */}
                                            <div className="rounded-xl px-3.5 py-2.5" style={{ background: 'var(--color-surface-2)' }}>
                                                <p className="text-[10.5px] font-semibold uppercase tracking-wide mb-1.5" style={{ color: 'var(--color-text-tertiary)' }}>สถานะ</p>
                                                <button onClick={() => toggleStatus(selected)} className="flex items-center gap-1.5 text-[13px] font-semibold px-2.5 py-1 rounded-lg cursor-pointer transition-colors w-fit" style={{ background: assetIsActive(selected.status) ? STATUS_META['Active'].bg : STATUS_META['In Active'].bg, color: assetIsActive(selected.status) ? STATUS_META['Active'].text : STATUS_META['In Active'].text }} title={assetIsActive(selected.status) ? 'คลิกเพื่อปิดใช้งาน' : 'คลิกเพื่อเปิดใช้งาน'}>
                                                    {assetIsActive(selected.status) ? <><ToggleRight className="w-4 h-4" />{STATUS_META['Active'].label}</> : <><ToggleLeft className="w-4 h-4" />{STATUS_META['In Active'].label}</>}
                                                </button>
                                            </div>
                                        </div>
                                    )}
                                    {/* Maintenance status — only for MA-eligible types */}
                                    {planForType(selected.type_name) && (() => {
                                        const plan = planForType(selected.type_name)!;
                                        const minFreq = Math.min(...MA_PLANS[plan].items.map(i => i.freqMonths));
                                        let nextDue = '';
                                        if (maInfo?.start_date) {
                                            const cur = currentRound(maInfo.start_date, minFreq);
                                            nextDue = formatThai(roundDueDate(maInfo.start_date, minFreq, cur + 1));
                                        }
                                        const lastChecked = maInfo?.last_checked_at ? new Date(maInfo.last_checked_at).toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: 'numeric' }) : '—';
                                        return (
                                            <div className="pt-4 mt-2" style={{ borderTop: '1px solid var(--color-border)' }}>
                                                <div className="flex items-center justify-between mb-2">
                                                    <div className="flex items-center gap-2"><Wrench className="w-3.5 h-3.5" style={{ color: 'var(--color-primary)' }} /><span className="text-[13px] font-bold" style={{ color: 'var(--color-text-primary)' }}>การบำรุงรักษา (Maintenance)</span></div>
                                                    <button onClick={() => navigate(`/assets/maintenance?asset=${encodeURIComponent(selected.asset_id)}`)} className="text-[12px] font-semibold" style={{ color: 'var(--color-primary)' }}>ดูการบำรุงรักษา →</button>
                                                </div>
                                                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                                                    {[
                                                        { label: 'แผนการบำรุงรักษา', value: MA_PLANS[plan].label, color: 'var(--color-text-primary)' },
                                                        { label: 'วันเริ่มตรวจ', value: maInfo?.start_date ? formatThai(new Date(maInfo.start_date.slice(0, 10) + 'T00:00:00')) : 'ยังไม่ตั้งค่า', color: maInfo?.start_date ? 'var(--color-text-primary)' : 'var(--color-warning)' },
                                                        { label: 'รอบถัดไป', value: nextDue || '—', color: 'var(--color-text-primary)' },
                                                        { label: 'ตรวจล่าสุด', value: lastChecked, color: (maInfo?.broken_count ?? 0) > 0 ? '#EF4444' : 'var(--color-text-primary)' },
                                                    ].map(({ label, value, color }) => (
                                                        <div key={label} className="rounded-xl px-3.5 py-2.5" style={{ background: 'var(--color-surface-2)' }}>
                                                            <p className="text-[10.5px] font-semibold uppercase tracking-wide mb-1" style={{ color: 'var(--color-text-tertiary)' }}>{label}</p>
                                                            <p className="text-[13px] font-semibold break-words" style={{ color }}>{value}</p>
                                                        </div>
                                                    ))}
                                                </div>
                                                <p className="text-[11px] mt-2" style={{ color: 'var(--color-text-tertiary)' }}>ความถี่ {freqLabel(minFreq)} · บันทึกการตรวจแล้ว {maInfo?.check_count ?? 0} รายการ</p>
                                            </div>
                                        );
                                    })()}

                                    {/* Notes */}
                                    <div className="pt-4 mt-2" style={{ borderTop: '1px solid var(--color-border)' }}>
                                        <div className="flex items-center gap-2 mb-2"><MessageSquare className="w-3.5 h-3.5" style={{ color: '#F59E0B' }} /><span className="text-[13px] font-bold" style={{ color: 'var(--color-text-primary)' }}>หมายเหตุ</span></div>
                                        <textarea value={notesInput} onChange={e => setNotesInput(e.target.value)} placeholder="เพิ่มหมายเหตุ หรือบันทึกเพิ่มเติม..." rows={3} className="field-input resize-none w-full" style={{ fontFamily: 'inherit', fontSize: 14 }} />
                                        <button onClick={saveNotes} disabled={notesSaving} className="btn btn-primary gap-2 mt-2 w-full justify-center">
                                            {notesSaving ? <><RefreshCw className="w-3.5 h-3.5 animate-spin" />กำลังบันทึก...</> : <><Save className="w-3.5 h-3.5" />บันทึกหมายเหตุ</>}
                                        </button>
                                    </div>
                                </div>
                            )}

                            {/* Transfer tab */}
                            {detailTab === 'transfer' && (
                                <div className="p-6 space-y-5">
                                    {/* Transfer form */}
                                    <div className="space-y-3 p-4 rounded-2xl" style={{ background: '#FFFBEB', border: '1px solid #FDE68A' }}>
                                        <div className="flex items-center gap-2 mb-1">
                                            <ArrowRightLeft className="w-4 h-4" style={{ color: '#B45309' }} />
                                            <p className="text-[14px] font-bold" style={{ color: '#B45309' }}>โอนย้าย / คืนทรัพย์สิน</p>
                                        </div>
                                        <div className="flex items-center gap-2 flex-wrap">
                                            <p className="text-[12px]" style={{ color: '#92400E' }}>ปัจจุบัน: <strong>{selected.holder || '(ไม่มีผู้ถือครอง)'}</strong></p>
                                            {(selected.employee_id || getEmpId(selected.holder)) && <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-md" style={{ background: '#FDE68A', color: '#92400E' }}>{selected.employee_id || getEmpId(selected.holder)}</span>}
                                        </div>
                                        <div>
                                            <label className="field-label text-[12px]">ผู้รับโอน (พนักงานหรือแผนก)</label>
                                            <AutocompleteInput value={transferTo} onChange={setTransferTo} suggestions={suggestions?.holders ?? holders.map(h => h.holder)} placeholder="พิมพ์ชื่อเพื่อค้นหา..." />
                                        </div>
                                        <div>
                                            <label className="field-label text-[12px]">เหตุผล / หมายเหตุ</label>
                                            <textarea value={transferReason} onChange={e => setTransferReason(e.target.value)} placeholder="เช่น พนักงานลาออก, ส่งคืนแผนก IT, เปลี่ยนผู้รับผิดชอบ..." rows={2} className="field-input resize-none w-full" style={{ fontFamily: 'inherit', fontSize: 13 }} />
                                        </div>
                                        <button onClick={doTransfer} disabled={transferring || !transferTo.trim()} className="btn btn-primary w-full justify-center gap-2" style={{ opacity: !transferTo.trim() ? 0.5 : 1 }}>
                                            {transferring ? <><RefreshCw className="w-3.5 h-3.5 animate-spin" />กำลังโอนย้าย...</> : <><ArrowRightLeft className="w-3.5 h-3.5" />ยืนยันโอนย้าย</>}
                                        </button>
                                    </div>

                                    {/* Timeline */}
                                    <div>
                                        <div className="flex items-center justify-between mb-4">
                                            <p className="text-[14px] font-bold" style={{ color: 'var(--color-text-primary)' }}>ประวัติการโอนย้าย</p>
                                            {transfers.length > 0 && <span className="text-[11px] font-bold px-2 py-0.5 rounded-full" style={{ background: '#EEF2FF', color: '#2563EB' }}>{transfers.length} ครั้ง</span>}
                                        </div>
                                        {transfers.length === 0 ? (
                                            <div className="text-center py-10 text-[13px]" style={{ color: 'var(--color-text-tertiary)' }}>
                                                <ArrowRightLeft className="w-8 h-8 mx-auto mb-2 opacity-30" />
                                                ยังไม่มีประวัติการโอนย้าย
                                            </div>
                                        ) : (
                                            <div className="relative pl-7">
                                                <div className="absolute left-3.5 top-3 bottom-3 w-0.5 rounded-full" style={{ background: 'var(--color-border)' }} />
                                                <div className="space-y-4">
                                                    {transfers.map((t, i) => {
                                                        const dt = new Date(t.transferred_at);
                                                        const dateStr = dt.toLocaleDateString('th-TH', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
                                                        const timeStr = dt.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
                                                        const fromEmpId = t.from_holder ? getEmpId(t.from_holder) : '';
                                                        const toEmpId = getEmpId(t.to_holder);
                                                        const fromColor = t.from_holder ? holderColor(t.from_holder) : '#94A3B8';
                                                        const toColor = holderColor(t.to_holder);
                                                        return (
                                                            <div key={t.id} className="relative">
                                                                <div className="absolute -left-[22px] top-3 w-4 h-4 rounded-full flex items-center justify-center" style={{ background: i === 0 ? '#2563EB' : 'var(--color-surface-2)', border: `2px solid ${i === 0 ? '#2563EB' : '#CBD5E1'}` }}>
                                                                    {i === 0 && <div className="w-1.5 h-1.5 rounded-full bg-white" />}
                                                                </div>
                                                                <div className="rounded-2xl overflow-hidden" style={{ border: `1px solid ${i === 0 ? '#2563EB30' : 'var(--color-border)'}`, background: i === 0 ? '#2563EB08' : 'var(--color-surface-2)' }}>
                                                                    {/* Header: order + date */}
                                                                    <div className="flex items-center justify-between px-4 py-2.5" style={{ background: i === 0 ? '#2563EB12' : 'var(--color-surface)', borderBottom: '1px solid var(--color-border)' }}>
                                                                        <div className="flex items-center gap-2">
                                                                            <span className="text-[10px] font-black px-2 py-0.5 rounded-full" style={{ background: i === 0 ? '#2563EB' : '#94A3B8', color: 'white' }}>#{transfers.length - i}</span>
                                                                            <code className="text-[11px] font-mono font-bold" style={{ color: i === 0 ? '#2563EB' : 'var(--color-text-secondary)' }}>{selected?.asset_id}</code>
                                                                            {selected?.description && <span className="text-[11px] truncate max-w-[120px]" style={{ color: 'var(--color-text-tertiary)' }}>{selected.description}</span>}
                                                                        </div>
                                                                        {i === 0 && <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-md" style={{ background: '#2563EB20', color: '#2563EB' }}>ล่าสุด</span>}
                                                                    </div>
                                                                    {/* From → To */}
                                                                    <div className="px-4 py-3 flex items-stretch gap-3">
                                                                        {/* From */}
                                                                        <div className="flex-1 min-w-0">
                                                                            <p className="text-[10px] font-semibold mb-1 uppercase tracking-wide" style={{ color: 'var(--color-text-tertiary)' }}>จาก</p>
                                                                            <div className="flex items-center gap-1.5 flex-wrap">
                                                                                <div className="w-6 h-6 rounded-lg flex items-center justify-center text-white text-[9px] font-black flex-shrink-0" style={{ background: fromColor }}>{t.from_holder ? getInitials(t.from_holder) : '?'}</div>
                                                                                <p className="text-[12px] font-semibold truncate" style={{ color: 'var(--color-text-primary)' }}>{t.from_holder || '(ไม่มีข้อมูล)'}</p>
                                                                            </div>
                                                                            {fromEmpId && <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-md mt-1 inline-block" style={{ background: fromColor + '18', color: fromColor }}>{fromEmpId}</span>}
                                                                        </div>
                                                                        {/* Arrow */}
                                                                        <div className="flex items-center flex-shrink-0">
                                                                            <ArrowRightLeft className="w-4 h-4" style={{ color: '#2563EB' }} />
                                                                        </div>
                                                                        {/* To */}
                                                                        <div className="flex-1 min-w-0 text-right">
                                                                            <p className="text-[10px] font-semibold mb-1 uppercase tracking-wide" style={{ color: 'var(--color-text-tertiary)' }}>ถึง</p>
                                                                            <div className="flex items-center justify-end gap-1.5 flex-wrap">
                                                                                <p className="text-[12px] font-bold truncate" style={{ color: '#2563EB' }}>{t.to_holder}</p>
                                                                                <div className="w-6 h-6 rounded-lg flex items-center justify-center text-white text-[9px] font-black flex-shrink-0" style={{ background: toColor }}>{getInitials(t.to_holder)}</div>
                                                                            </div>
                                                                            {toEmpId && <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-md mt-1 inline-block" style={{ background: toColor + '18', color: toColor }}>{toEmpId}</span>}
                                                                        </div>
                                                                    </div>
                                                                    {/* Reason */}
                                                                    {t.reason && (
                                                                        <div className="mx-4 mb-3 px-3 py-2 rounded-xl text-[12px]" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', color: 'var(--color-text-secondary)' }}>
                                                                            💬 {t.reason}
                                                                        </div>
                                                                    )}
                                                                    {/* Date / time footer */}
                                                                    <div className="flex items-center gap-1.5 px-4 pb-3">
                                                                        <Clock className="w-3 h-3 flex-shrink-0" style={{ color: 'var(--color-text-tertiary)' }} />
                                                                        <span className="text-[11px]" style={{ color: 'var(--color-text-tertiary)' }}>{dateStr}</span>
                                                                        <span className="text-[11px] font-bold" style={{ color: 'var(--color-text-secondary)' }}>· {timeStr} น.</span>
                                                                    </div>
                                                                </div>
                                                            </div>
                                                        );
                                                    })}
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                </div>
                            )}

                            <div className="flex justify-between p-5 pt-0">
                                <button onClick={() => deleteAsset(selected.id)} className="btn gap-2 text-red-500"><Trash2 className="w-4 h-4" />ลบ</button>
                                <button onClick={() => setSelected(null)} className="btn btn-primary gap-2">ปิด</button>
                            </div>
                </Modal>
            )}

            {/* Add Modal */}
            {showAdd && (
                <AddAssetModal groups={groups} types={types} suggestions={suggestions}
                    onClose={() => setShowAdd(false)}
                    onSaved={() => { setShowAdd(false); fetchAssets(); fetchStats(); fetchHolders(); fetchSuggestions(); }}
                />
            )}

            {/* Notes saved toast — rendered via portal so it never affects layout */}
            {createPortal(
                <AnimatePresence>
                    {notesToast && (
                        <motion.div
                            initial={{ opacity: 0, y: -20, scale: 0.95 }}
                            animate={{ opacity: 1, y: 0, scale: 1 }}
                            exit={{ opacity: 0, y: -12, scale: 0.95 }}
                            transition={{ type: 'spring', stiffness: 380, damping: 28 }}
                            style={{
                                position: 'fixed', top: 24, left: '50%', transform: 'translateX(-50%)',
                                zIndex: 9999, display: 'flex', alignItems: 'center', gap: 10,
                                padding: '10px 20px', borderRadius: 16,
                                background: '#1a2236', color: '#fff',
                                border: '1px solid rgba(255,255,255,0.1)',
                                minWidth: 220, boxShadow: '0 8px 32px rgba(0,0,0,0.28)',
                                pointerEvents: 'none',
                            }}
                        >
                            <CheckCircle style={{ width: 16, height: 16, flexShrink: 0, color: '#34d399' }} />
                            <span style={{ fontSize: 13, fontWeight: 600 }}>บันทึกหมายเหตุเรียบร้อยแล้ว</span>
                        </motion.div>
                    )}
                </AnimatePresence>,
                document.body
            )}
        </div>
    );
}

// ─── Holder View ──────────────────────────────────────────────────────────────
function HolderView({ holders, onSelect }: { holders: HolderSummary[]; onSelect: (h: string) => void }) {
    const [search, setSearch] = useState('');
    const valid = holders.filter(h => h.holder && h.holder !== '-');
    const holderNum = (h: HolderSummary) => {
        const id = h.employee_id || EMPLOYEE_MAP[h.holder];
        if (!id) return 9999;
        const m = id.match(/\d+/);
        return m ? parseInt(m[0]) : 9999;
    };
    const sorted = [...valid].sort((a, b) => holderNum(a) - holderNum(b));
    const filtered = search ? sorted.filter(h => h.holder.toLowerCase().includes(search.toLowerCase())) : sorted;

    return (
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="space-y-5">
            <div className="flex items-center gap-3">
                <div className="relative max-w-sm flex-1">
                    <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4" style={{ color: 'var(--color-text-tertiary)' }} />
                    <input value={search} onChange={e => setSearch(e.target.value)} placeholder="ค้นหาชื่อผู้ถือครอง..." className="input" style={{ paddingLeft: '2.5rem' }} />
                </div>
                <span className="text-[13px]" style={{ color: 'var(--color-text-secondary)' }}>{filtered.length} คน · คลิกการ์ดเพื่อดูทรัพย์สิน</span>
            </div>
            {filtered.length === 0 && <div className="text-center py-20 text-[14px]" style={{ color: 'var(--color-text-tertiary)' }}>ไม่พบผู้ถือครอง</div>}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                {filtered.map((h, i) => {
                    const color = holderColor(h.holder);
                    const empId = h.employee_id || EMPLOYEE_MAP[h.holder];
                    return (
                        <motion.button key={h.holder} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.04 }} onClick={() => onSelect(h.holder)} className="card p-5 text-left hover:shadow-md transition-all group">
                            <div className="flex items-center gap-3 mb-4">
                                <div className="w-11 h-11 rounded-xl flex items-center justify-center text-white text-[14px] font-black flex-shrink-0" style={{ background: color }}>{getInitials(h.holder)}</div>
                                <div className="flex-1 min-w-0">
                                    <p className="text-[14px] font-bold truncate" style={{ color: 'var(--color-text-primary)' }}>{h.holder}</p>
                                    <div className="flex items-center gap-2 mt-0.5">
                                        {empId && <span className="text-[11px] font-bold px-1.5 py-0.5 rounded-md" style={{ background: color + '18', color }}>{empId}</span>}
                                        <p className="text-[11px]" style={{ color: 'var(--color-text-tertiary)' }}>{h.total} รายการ</p>
                                    </div>
                                </div>
                            </div>
                            <div className="flex flex-wrap gap-2 mb-2">
                                {Number(h.active) > 0 && <span className="text-[11px] font-semibold px-2 py-1 rounded-lg" style={{ background: '#ECFDF5', color: '#065F46' }}>✓ {h.active} Active</span>}
                                {Number(h.inactive) > 0 && <span className="text-[11px] font-semibold px-2 py-1 rounded-lg" style={{ background: '#F1F5F9', color: '#475569' }}>✗ {h.inactive} Inactive</span>}
                            </div>
                            {h.top_groups && h.top_groups.length > 0 && (
                                <div className="flex flex-wrap gap-1">
                                    {h.top_groups.filter(Boolean).slice(0, 3).map(g => { const meta = GROUP_META[g] ?? { color: '#64748B', bg: '#F8FAFC' }; return <span key={g} className="text-[10px] font-semibold px-1.5 py-0.5 rounded" style={{ background: meta.bg, color: meta.color }}>{g}</span>; })}
                                </div>
                            )}
                            <p className="text-[12px] font-semibold mt-3 opacity-0 group-hover:opacity-100 transition-opacity" style={{ color: 'var(--color-primary)' }}>ดูทรัพย์สิน →</p>
                        </motion.button>
                    );
                })}
            </div>
        </motion.div>
    );
}

// ─── Add Asset Modal ──────────────────────────────────────────────────────────
function AddAssetModal({ groups, types, suggestions, onClose, onSaved }: {
    groups: string[]; types: string[];
    suggestions: FieldSuggestions | null;
    onClose: () => void; onSaved: () => void;
}) {
    const [form, setForm] = useState({
        group_name: '', type_name: '', asset_id: '', description: '', serial_number: '',
        brand_model: '', responsibility: '', holder: '', employee_id: '', owner: '', building: '', floor: '',
        department: '', sub_section: '', status: 'Active', notes: '',
    });
    const [saving, setSaving] = useState(false);
    const set = (k: string, v: string) => {
        setForm(f => {
            const next = { ...f, [k]: v };
            if (k === 'holder') {
                const empId = getEmpId(v);
                if (empId) next.employee_id = empId;
            } else if (k === 'employee_id') {
                const name = getNameFromId(v);
                if (name) next.holder = name;
            }
            return next;
        });
    };

    const save = async () => {
        if (!form.group_name || !form.type_name || !form.asset_id) { toast.error('กรุณากรอก Group, Type, Asset ID'); return; };
        setSaving(true);
        try {
            await fetch('/api/assets', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form) });
            onSaved();
        } catch (e) { console.error(e); toast.error('เกิดข้อผิดพลาด'); }
        setSaving(false);
    };

    const s = suggestions;

    return (
        <Modal isOpen onClose={onClose} showCloseButton={false}
            className="w-full max-w-lg m-4 max-h-[90vh] overflow-y-auto">
                <div className="flex items-center justify-between p-6" style={{ borderBottom: '1px solid var(--color-border)' }}>
                    <h3 className="text-[16px] font-bold" style={{ color: 'var(--color-text-primary)' }}>เพิ่มทรัพย์สินใหม่</h3>
                    <button onClick={onClose} className="btn-icon"><X className="w-4 h-4" /></button>
                </div>
                <div className="p-6 space-y-3">
                    <div className="grid grid-cols-2 gap-3">
                        <div><label className="field-label">กลุ่ม *</label>
                            <select value={form.group_name} onChange={e => set('group_name', e.target.value)} className="field-input">
                                <option value="">เลือกกลุ่ม</option>
                                {groups.map(g => <option key={g} value={g}>{g}</option>)}
                            </select></div>
                        <div><label className="field-label">ประเภท *</label>
                            <select value={form.type_name} onChange={e => set('type_name', e.target.value)} className="field-input">
                                <option value="">เลือกประเภท</option>
                                {types.map(t => <option key={t} value={t}>{t}</option>)}
                            </select></div>
                    </div>
                    <div><label className="field-label">Asset ID *</label>
                        <input value={form.asset_id} onChange={e => set('asset_id', e.target.value)} className="field-input" placeholder="e.g. NB001" /></div>
                    <div><label className="field-label">รายละเอียด</label>
                        <AutocompleteInput value={form.description} onChange={v => set('description', v)} suggestions={s?.descriptions ?? []} placeholder="รายการทรัพย์สิน" /></div>
                    <div className="grid grid-cols-2 gap-3">
                        <div><label className="field-label">Serial Number</label>
                            <input value={form.serial_number} onChange={e => set('serial_number', e.target.value)} className="field-input" /></div>
                        <div><label className="field-label">ยี่ห้อ / รุ่น</label>
                            <AutocompleteInput value={form.brand_model} onChange={v => set('brand_model', v)} suggestions={s?.brand_models ?? []} placeholder="เช่น HP ProBook 450" /></div>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                        <div><label className="field-label">ผู้รับผิดชอบ</label>
                            <AutocompleteInput value={form.responsibility} onChange={v => set('responsibility', v)} suggestions={s?.responsibilities ?? []} placeholder="ชื่อผู้รับผิดชอบ" /></div>
                        <div><label className="field-label">ผู้ถือครอง</label>
                            <AutocompleteInput value={form.holder} onChange={v => set('holder', v)} suggestions={s?.holders ?? []} placeholder="ชื่อผู้ถือครอง" /></div>
                    </div>
                    <div>
                        <label className="field-label">รหัสพนักงาน (ผู้ถือครอง)</label>
                        <AutocompleteInput
                            value={form.employee_id}
                            onChange={v => set('employee_id', v)}
                            suggestions={[...new Set([...Object.keys(ID_TO_EMPLOYEE), ...(s?.employee_ids ?? [])])]}
                            placeholder="เช่น TEN-001 – จะ mapping ชื่ออัตโนมัติ"
                        />
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                        <div><label className="field-label">ตึก</label>
                            <AutocompleteInput value={form.building} onChange={v => set('building', v)} suggestions={s?.buildings ?? []} placeholder="อาคาร" /></div>
                        <div><label className="field-label">ชั้น</label>
                            <AutocompleteInput value={form.floor} onChange={v => set('floor', v)} suggestions={s?.floors ?? []} placeholder="ชั้น" /></div>
                        <div><label className="field-label">แผนก</label>
                            <AutocompleteInput value={form.department} onChange={v => set('department', v)} suggestions={s?.departments ?? []} placeholder="แผนก" /></div>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                        <div><label className="field-label">เจ้าของ</label>
                            <AutocompleteInput value={form.owner} onChange={v => set('owner', v)} suggestions={s?.owners ?? []} placeholder="เจ้าของ" /></div>
                        <div><label className="field-label">สถานะ</label>
                            <select value={form.status} onChange={e => set('status', e.target.value)} className="field-input">
                                <option value="Active">Active</option>
                                <option value="In Active">Inactive</option>
                            </select></div>
                    </div>
                    <div><label className="field-label">หมายเหตุ</label>
                        <textarea value={form.notes} onChange={e => set('notes', e.target.value)} placeholder="หมายเหตุเพิ่มเติม (ถ้ามี)" rows={2} className="field-input resize-none" style={{ fontFamily: 'inherit', fontSize: 14 }} /></div>
                </div>
                <div className="flex justify-end gap-3 p-6 pt-0">
                    <button onClick={onClose} className="btn">ยกเลิก</button>
                    <button onClick={save} disabled={saving} className="btn btn-primary gap-2">
                        {saving ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
                        {saving ? 'กำลังบันทึก...' : 'เพิ่มทรัพย์สิน'}
                    </button>
                </div>
        </Modal>
    );
}
