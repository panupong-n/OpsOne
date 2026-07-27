import { confirmDialog } from '../components/ui/confirm';
import { useState, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { RefreshCw, Circle, CheckCircle, XCircle, SkipForward, ChevronDown, ChevronUp, Trash2 } from 'lucide-react';

/* ── Types ── */
interface IntakeRecord {
    id: number;
    source: string;
    payload: Record<string, unknown>;
    status: 'pending' | 'processed' | 'skipped' | 'error';
    note: string | null;
    processed_at: string | null;
    created_at: string;
    _isNew?: boolean;
}

/* ── Helpers ── */
const STATUS_META = {
    pending:   { label: 'รอดำเนินการ', bg: '#FEF3C7', color: '#92400E', icon: Circle },
    processed: { label: 'เสร็จแล้ว',   bg: '#D1FAE5', color: '#065F46', icon: CheckCircle },
    skipped:   { label: 'ข้าม',         bg: '#F3F4F6', color: '#374151', icon: SkipForward },
    error:     { label: 'Error',        bg: '#FEE2E2', color: '#991B1B', icon: XCircle },
};

function timeAgo(iso: string) {
    const diff = Date.now() - new Date(iso).getTime();
    if (diff < 60_000)  return `${Math.floor(diff / 1000)} วิที่แล้ว`;
    if (diff < 3600_000) return `${Math.floor(diff / 60_000)} นาทีที่แล้ว`;
    return new Date(iso).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' });
}

/* ── Component ── */
export default function HRIntakeMonitor() {
    const [rows,       setRows]       = useState<IntakeRecord[]>([]);
    const [total,      setTotal]      = useState(0);
    const [filter,     setFilter]     = useState<string>('');
    const [loading,    setLoading]    = useState(false);
    const [autoRefresh, setAutoRefresh] = useState(true);
    const [expanded,   setExpanded]   = useState<Set<number>>(new Set());
    const [lastFetch,  setLastFetch]  = useState<Date | null>(null);
    const prevIds = useRef<Set<number>>(new Set());
    const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

    const load = useCallback(async (silent = false) => {
        if (!silent) setLoading(true);
        try {
            const url = filter ? `/api/hr/intake?status=${filter}&limit=100` : '/api/hr/intake?limit=100';
            const res = await fetch(url);
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const data: { total: number; rows: IntakeRecord[] } = await res.json();

            // Mark new records
            const marked = data.rows.map(r => ({
                ...r,
                _isNew: !prevIds.current.has(r.id),
            }));
            prevIds.current = new Set(data.rows.map(r => r.id));

            setRows(marked);
            setTotal(data.total);
            setLastFetch(new Date());
        } catch { /* silent fail */ }
        finally { if (!silent) setLoading(false); }
    }, [filter]);

    /* initial load */
    useEffect(() => { load(); }, [load]);

    /* auto-refresh every 4s */
    useEffect(() => {
        if (intervalRef.current) clearInterval(intervalRef.current);
        if (autoRefresh) {
            intervalRef.current = setInterval(() => load(true), 4000);
        }
        return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
    }, [autoRefresh, load]);

    async function markStatus(id: number, status: IntakeRecord['status'], note?: string) {
        await fetch(`/api/hr/intake/${id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ status, note: note ?? undefined }),
        });
        load(true);
    }

    async function deleteRecord(id: number) {
        if (!(await confirmDialog('ลบ record นี้?'))) return;
        await fetch(`/api/hr/intake/${id}`, { method: 'DELETE' });
        load(true);
    }

    function toggleExpand(id: number) {
        setExpanded(prev => {
            const next = new Set(prev);
            next.has(id) ? next.delete(id) : next.add(id);
            return next;
        });
    }

    const pendingCount = rows.filter(r => r.status === 'pending').length;

    return (
        <div className="p-6 max-w-5xl mx-auto space-y-5">
            {/* Header */}
            <div className="flex items-center justify-between flex-wrap gap-3">
                <div>
                    <h1 className="text-xl font-black" style={{ color: 'var(--color-text-primary)' }}>
                        HR Intake Monitor
                    </h1>
                    <p className="text-[12px] mt-0.5" style={{ color: 'var(--color-text-tertiary)' }}>
                        ดูข้อมูลที่รับจากระบบ HR แบบ Realtime
                    </p>
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                    {/* Live indicator */}
                    <button
                        onClick={() => setAutoRefresh(v => !v)}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[12px] font-semibold transition-all"
                        style={{
                            background: autoRefresh ? '#D1FAE5' : 'var(--color-surface-2)',
                            color: autoRefresh ? '#065F46' : 'var(--color-text-secondary)',
                            border: '1px solid ' + (autoRefresh ? '#6EE7B7' : 'var(--color-border)'),
                        }}
                    >
                        <span className={`w-2 h-2 rounded-full ${autoRefresh ? 'animate-pulse bg-green-500' : 'bg-gray-400'}`} />
                        {autoRefresh ? 'Live (4s)' : 'Paused'}
                    </button>
                    <button onClick={() => load()} disabled={loading} className="btn-icon" title="รีเฟรชทันที">
                        <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
                    </button>
                </div>
            </div>

            {/* Stats row */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {(Object.entries(STATUS_META) as [IntakeRecord['status'], typeof STATUS_META[keyof typeof STATUS_META]][]).map(([key, meta]) => {
                    const count = rows.filter(r => r.status === key).length;
                    return (
                        <button key={key}
                            onClick={() => setFilter(filter === key ? '' : key)}
                            className="card p-4 text-left transition-all"
                            style={{
                                border: '2px solid ' + (filter === key ? meta.color : 'var(--color-border)'),
                                opacity: filter && filter !== key ? 0.5 : 1,
                            }}>
                            <p className="text-2xl font-black" style={{ color: meta.color }}>{count}</p>
                            <p className="text-[11px] font-semibold mt-0.5" style={{ color: 'var(--color-text-secondary)' }}>{meta.label}</p>
                        </button>
                    );
                })}
            </div>

            {/* Last fetch + total */}
            <div className="flex items-center justify-between text-[11px]" style={{ color: 'var(--color-text-tertiary)' }}>
                <span>แสดง {rows.length} จาก {total} รายการ {filter ? `(กรอง: ${STATUS_META[filter as keyof typeof STATUS_META]?.label})` : ''}</span>
                {lastFetch && <span>อัปเดตล่าสุด {lastFetch.toLocaleTimeString('th-TH')}</span>}
            </div>

            {/* Record list */}
            <div className="space-y-2">
                {rows.length === 0 && !loading && (
                    <div className="card p-12 flex flex-col items-center gap-3">
                        <span className="text-3xl">📭</span>
                        <p className="text-[13px]" style={{ color: 'var(--color-text-tertiary)' }}>
                            {filter ? 'ไม่มีข้อมูลในสถานะนี้' : 'ยังไม่มีข้อมูลเข้ามา รอรับจาก HR...'}
                        </p>
                    </div>
                )}

                <AnimatePresence initial={false}>
                    {rows.map(record => {
                        const meta = STATUS_META[record.status];
                        const isExpanded = expanded.has(record.id);
                        const StatusIcon = meta.icon;

                        return (
                            <motion.div
                                key={record.id}
                                initial={record._isNew ? { opacity: 0, y: -8, scale: 0.98 } : false}
                                animate={{ opacity: 1, y: 0, scale: 1 }}
                                exit={{ opacity: 0, height: 0, overflow: 'hidden' }}
                                transition={{ duration: 0.2 }}
                                className="card overflow-hidden"
                                style={{
                                    border: record._isNew ? '2px solid #2563EB' : '1px solid var(--color-border)',
                                }}
                            >
                                {/* Row header */}
                                <div className="flex items-center gap-3 p-4">
                                    {/* ID + source */}
                                    <div className="flex-shrink-0 text-center w-10">
                                        <p className="text-[10px] font-bold" style={{ color: 'var(--color-text-tertiary)' }}>#</p>
                                        <p className="text-[14px] font-black" style={{ color: 'var(--color-text-primary)' }}>{record.id}</p>
                                    </div>
                                    <div className="w-px h-8 flex-shrink-0" style={{ background: 'var(--color-border)' }} />

                                    {/* Source + time */}
                                    <div className="flex-1 min-w-0">
                                        <div className="flex items-center gap-2 flex-wrap">
                                            {record._isNew && (
                                                <span className="text-[10px] font-bold px-1.5 py-0.5 rounded"
                                                    style={{ background: '#EEF2FF', color: '#1E40AF' }}>NEW</span>
                                            )}
                                            <span className="text-[12px] font-semibold px-2 py-0.5 rounded-full"
                                                style={{ background: 'var(--color-surface-2)', color: 'var(--color-text-secondary)' }}>
                                                {record.source}
                                            </span>
                                            <span className="text-[11px]" style={{ color: 'var(--color-text-tertiary)' }}>
                                                {timeAgo(record.created_at)}
                                            </span>
                                        </div>
                                        {/* Payload preview */}
                                        <p className="text-[11px] mt-1 truncate font-mono" style={{ color: 'var(--color-text-tertiary)' }}>
                                            {JSON.stringify(record.payload).slice(0, 120)}…
                                        </p>
                                    </div>

                                    {/* Status badge */}
                                    <span className="flex items-center gap-1 text-[11px] font-semibold px-2 py-1 rounded-lg flex-shrink-0"
                                        style={{ background: meta.bg, color: meta.color }}>
                                        <StatusIcon className="w-3 h-3" />{meta.label}
                                    </span>

                                    {/* Actions */}
                                    <div className="flex items-center gap-1 flex-shrink-0">
                                        {record.status === 'pending' && (
                                            <>
                                                <button
                                                    onClick={() => markStatus(record.id, 'processed', 'ประมวลผลแล้ว')}
                                                    className="text-[10px] font-semibold px-2 py-1 rounded-lg transition-all"
                                                    style={{ background: '#D1FAE5', color: '#065F46' }}
                                                    title="Mark processed">
                                                    ✓ เสร็จ
                                                </button>
                                                <button
                                                    onClick={() => markStatus(record.id, 'skipped')}
                                                    className="text-[10px] font-semibold px-2 py-1 rounded-lg transition-all"
                                                    style={{ background: '#F3F4F6', color: '#374151' }}
                                                    title="Skip">
                                                    ข้าม
                                                </button>
                                            </>
                                        )}
                                        <button onClick={() => deleteRecord(record.id)} className="btn-icon" title="ลบ">
                                            <Trash2 className="w-3.5 h-3.5" style={{ color: '#EF4444' }} />
                                        </button>
                                        <button onClick={() => toggleExpand(record.id)} className="btn-icon" title="ดู payload">
                                            {isExpanded
                                                ? <ChevronUp className="w-4 h-4" />
                                                : <ChevronDown className="w-4 h-4" />}
                                        </button>
                                    </div>
                                </div>

                                {/* Expanded payload */}
                                {isExpanded && (
                                    <div className="border-t px-4 pb-4 pt-3" style={{ borderColor: 'var(--color-border)' }}>
                                        <p className="text-[10px] font-bold mb-2 uppercase tracking-wide"
                                            style={{ color: 'var(--color-text-tertiary)' }}>Raw Payload</p>
                                        <pre className="text-[11px] p-3 rounded-xl overflow-x-auto"
                                            style={{ background: 'var(--color-surface-2)', color: 'var(--color-text-primary)', lineHeight: 1.6 }}>
                                            {JSON.stringify(record.payload, null, 2)}
                                        </pre>
                                        {record.note && (
                                            <p className="text-[11px] mt-2" style={{ color: 'var(--color-text-tertiary)' }}>
                                                <span className="font-semibold">Note:</span> {record.note}
                                            </p>
                                        )}
                                        {record.processed_at && (
                                            <p className="text-[11px] mt-1" style={{ color: 'var(--color-text-tertiary)' }}>
                                                <span className="font-semibold">Processed at:</span>{' '}
                                                {new Date(record.processed_at).toLocaleString('th-TH')}
                                            </p>
                                        )}
                                    </div>
                                )}
                            </motion.div>
                        );
                    })}
                </AnimatePresence>
            </div>

            {pendingCount > 0 && (
                <p className="text-center text-[12px]" style={{ color: 'var(--color-text-tertiary)' }}>
                    มี <strong style={{ color: '#92400E' }}>{pendingCount}</strong> รายการรอดำเนินการ
                </p>
            )}
        </div>
    );
}
