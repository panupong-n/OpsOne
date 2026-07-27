import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { Modal } from '../components/ui/modal';
import {
    DndContext, DragOverlay, PointerSensor, useSensor, useSensors,
    type DragStartEvent, type DragEndEvent,
    useDroppable,
} from '@dnd-kit/core';
import { useDraggable } from '@dnd-kit/core';
import { CSS } from '@dnd-kit/utilities';
import {
    Plus, X, RefreshCw, GripVertical,
    Kanban, BarChart3, FolderKanban, Settings2,
    Clock, CheckCircle2, Circle, Pause, Play,
    Zap, Trash2, Target, AlertTriangle,
    ChevronRight, ChevronDown, HardDrive, ArrowLeft,
    TrendingDown, Activity, Users, Eye, Flame,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import ThaiDatePicker, { formatThaiDateShort } from '../components/ThaiDatePicker';
import {
    ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid,
    Tooltip as ReTooltip, Legend, AreaChart, Area, BarChart, Bar, Cell,
} from 'recharts';
import dayjs from 'dayjs';
import buddhistEra from 'dayjs/plugin/buddhistEra';
import 'dayjs/locale/th';
dayjs.extend(buddhistEra); dayjs.locale('th');

// ─── Types ────────────────────────────────────────────────────────────────────
interface PmProject {
    id: string; name: string; description: string | null; color: string;
    status: string; start_date: string | null; end_date: string | null; created_by: string | null;
}
interface PmMilestone {
    id: string; project_id: string; name: string; due_date: string | null;
    color: string; sort_order: number;
}
interface PmSprint {
    id: string; project_id: string; name: string;
    start_date: string | null; end_date: string | null; status: string;
}
interface PmTicket {
    id: string; project_id: string; parent_id: string | null;
    milestone_id: string | null; sprint_id: string | null;
    title: string; description: string | null; type: string; status: string;
    priority: string; assignee_id: string | null; assignee_name?: string; assignee_email?: string;
    plan_start: string | null; plan_end: string | null; progress: number;
    sort_order: number; milestone_name?: string; sprint_name?: string;
    storypoints: number | null; plan_hours: number | null; hour_remaining: number | null;
    tags: string | null; acceptance_criteria: string | null;
    kanban_sort_index: number; date_to_finish: string | null;
    all_device: number;
    blocker_category: string | null; blocker_note: string | null;
    total_accumulated?: number; remaining_device?: number; calculated_progress?: number;
}
interface PmDependency {
    id: string; predecessor_id: string; successor_id: string; dep_type: string; lag_days: number;
}
interface PlatformUser { sub: string; name: string; email: string; }
interface PmQuantityLog {
    id: string; ticket_id: string; log_date: string; quantity: number;
}

// ─── Constants ────────────────────────────────────────────────────────────────
const STATUSES = [
    { key: 'start',       label: 'Start',       color: '#2563EB', bg: '#EEF2FF', icon: Play        },
    { key: 'all_device',  label: 'All Device',  color: '#0EA5E9', bg: '#E0F2FE', icon: HardDrive   },
    { key: 'in_progress', label: 'In Progress', color: '#F59E0B', bg: '#FFFBEB', icon: Clock       },
    { key: 'pending',     label: 'Pending',     color: '#6366F1', bg: '#F5F3FF', icon: Pause       },
    { key: 'total',       label: 'Total',       color: '#10B981', bg: '#ECFDF5', icon: CheckCircle2},
];

const PRIORITIES: Record<string, { label: string; color: string }> = {
    critical: { label: 'Critical', color: '#EF4444' },
    high:     { label: 'High',     color: '#F59E0B' },
    medium:   { label: 'Medium',   color: '#2563EB' },
    low:      { label: 'Low',      color: '#94A3B8' },
};

const TYPES: Record<string, { label: string; color: string }> = {
    product: { label: 'Product', color: '#2563EB' },
    service: { label: 'Service', color: '#10B981' },
};

const EFFORTS = [0.5, 1, 2, 3, 5, 8, 13];
const AVATAR_COLORS = ['#2563EB','#0EA5E9','#3B82F6','#1D4ED8','#0891B2','#6366F1'];
const avatarColor = (s: string) => { let h = 0; for (let i = 0; i < s.length; i++) h = s.charCodeAt(i) + ((h << 5) - h); return AVATAR_COLORS[Math.abs(h) % AVATAR_COLORS.length]; };
const initials = (name: string) => { if (!name?.trim()) return '??'; const p = name.trim().split(/\s+/); return p.length >= 2 ? (p[0][0] + p[1][0]).toUpperCase() : name.slice(0, 2).toUpperCase(); };

async function api<T>(path: string, opts?: RequestInit): Promise<T> {
    const res = await fetch(path, opts);
    if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
    if (res.status === 204) return undefined as T;
    return res.json();
}

// ─── Helper: compute quantity totals for a ticket ─────────────────────────────
function computeQuantity(ticket: PmTicket, logs: PmQuantityLog[]) {
    const ticketLogs = logs.filter(l => l.ticket_id === ticket.id).sort((a, b) => a.log_date.localeCompare(b.log_date));
    const totalDone = ticketLogs.reduce((s, l) => s + l.quantity, 0);
    const pending = Math.max(0, (ticket.all_device || 0) - totalDone);
    const pct = ticket.all_device > 0 ? Math.round((totalDone / ticket.all_device) * 100) : ticket.progress;
    return { totalDone, pending, pct, logs: ticketLogs };
}

// ─── Recursive progress: parent = Weighted AVG of children progress ──────────
function computeRecursiveProgress(tickets: PmTicket[], logs: PmQuantityLog[]): Map<string, number> {
    const childrenMap = new Map<string | null, PmTicket[]>();
    for (const t of tickets) {
        const pid = t.parent_id || null;
        if (!childrenMap.has(pid)) childrenMap.set(pid, []);
        childrenMap.get(pid)!.push(t);
    }
    const progressMap = new Map<string, number>();
    const visiting = new Set<string>(); // circular dependency guard

    const calc = (id: string): number => {
        if (progressMap.has(id)) return progressMap.get(id)!;
        if (visiting.has(id)) return 0; // break circular
        visiting.add(id);

        const kids = childrenMap.get(id) || [];
        const ticket = tickets.find(t => t.id === id);
        if (!ticket) { visiting.delete(id); return 0; }

        if (kids.length === 0) {
            // Leaf: use quantity-based or manual progress
            const qty = computeQuantity(ticket, logs);
            progressMap.set(id, qty.pct);
            visiting.delete(id);
            return qty.pct;
        }

        // Parent: choose best strategy based on children
        const childProgress = kids.map(c => ({ pct: calc(c.id), allDev: c.all_device || 0, status: c.status }));
        const totalWeight = childProgress.reduce((s, cp) => s + cp.allDev, 0);
        let avg: number;
        if (totalWeight > 0) {
            // Strategy A: Weighted by all_device (quantity-based children)
            avg = Math.round(childProgress.reduce((s, cp) => s + cp.pct * (cp.allDev || 1), 0)
                / childProgress.reduce((s, cp) => s + (cp.allDev || 1), 0));
        } else {
            // Strategy B: Task-count-based — count children whose status is 'total' as done
            const doneCount = childProgress.filter(cp => cp.status === 'total').length;
            avg = Math.round((doneCount / childProgress.length) * 100);
        }
        progressMap.set(id, avg);
        visiting.delete(id);
        return avg;
    };
    for (const t of tickets) calc(t.id);
    return progressMap;
}

// ─── Circular dependency check ────────────────────────────────────────────────
function hasCircularParent(ticketId: string | undefined, parentId: string | null, tickets: PmTicket[]): boolean {
    if (!parentId || !ticketId) return false;
    const visited = new Set<string>();
    let current: string | null = parentId;
    while (current) {
        if (current === ticketId) return true;
        if (visited.has(current)) return false;
        visited.add(current);
        const parent = tickets.find(t => t.id === current);
        current = parent?.parent_id || null;
    }
    return false;
}

// ─── Draggable Kanban Card ────────────────────────────────────────────────────
function KanbanCard({ ticket, quantityLogs, onClick, isViewOnly = false }: { ticket: PmTicket; quantityLogs: PmQuantityLog[]; onClick: () => void; isViewOnly?: boolean }) {
    const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: ticket.id, data: { ticket }, disabled: isViewOnly });
    const pri = PRIORITIES[ticket.priority] ?? PRIORITIES.medium;
    const tp = TYPES[ticket.type] ?? TYPES.product;
    const qty = computeQuantity(ticket, quantityLogs);
    const isSubtask = !!ticket.parent_id;

    return (
        <div ref={setNodeRef} style={{ transform: CSS.Translate.toString(transform), opacity: isDragging ? 0.4 : 1, marginLeft: isSubtask ? 16 : 0 }}
            className="group relative rounded-xl transition-all cursor-pointer hover:shadow-md" {...attributes} onClick={onClick}>
            <div className="p-3.5" style={{ background: 'var(--color-surface)', border: `1px solid ${isSubtask ? 'var(--color-primary)22' : 'var(--color-border)'}`, borderRadius: 12, borderLeft: isSubtask ? '3px solid var(--color-primary)' : undefined }}>
                <div className="flex items-start gap-2 mb-2">
                    {!isViewOnly && <div {...listeners} className="cursor-grab mt-0.5 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0" style={{ touchAction: 'none' }}>
                        <GripVertical className="w-3.5 h-3.5" style={{ color: 'var(--color-text-tertiary)' }} />
                    </div>}
                    <div className="w-2 h-2 rounded-full mt-1.5 flex-shrink-0" style={{ background: pri.color }} title={pri.label} />
                    <p className="text-[13px] font-semibold leading-tight flex-1" style={{ color: 'var(--color-text-primary)' }}>
                        {isSubtask && <span className="text-[10px] mr-1" style={{ color: 'var(--color-text-tertiary)' }}>↳</span>}
                        {ticket.title}
                    </p>
                </div>
                <div className="flex items-center gap-1.5 flex-wrap ml-7">
                    <span className="text-[9px] font-bold px-1.5 py-0.5 rounded" style={{ background: tp.color + '18', color: tp.color }}>{tp.label}</span>
                    {ticket.assignee_name && (
                        <div className="flex items-center gap-1">
                            <div className="w-4 h-4 rounded-full flex items-center justify-center text-[7px] font-bold text-white" style={{ background: avatarColor(ticket.assignee_id ?? '') }}>
                                {initials(ticket.assignee_name)}
                            </div>
                            <span className="text-[10px]" style={{ color: 'var(--color-text-tertiary)' }}>{ticket.assignee_name.split(' ')[0]}</span>
                        </div>
                    )}
                    {ticket.all_device > 0 && (
                        <span className="text-[9px] font-bold px-1.5 py-0.5 rounded" style={{ background: '#E0F2FE', color: '#0284C7' }}>
                            {qty.totalDone}/{ticket.all_device}
                        </span>
                    )}
                    {ticket.storypoints != null && ticket.storypoints > 0 && (
                        <span className="text-[9px] font-bold px-1.5 py-0.5 rounded" style={{ background: '#F0FDF4', color: '#059669' }}>{ticket.storypoints} SP</span>
                    )}
                </div>
                {(ticket.all_device > 0 || ticket.progress > 0) && (
                    <div className="ml-7 mt-2 h-1 rounded-full overflow-hidden" style={{ background: 'var(--color-border)' }}>
                        <div className="h-full rounded-full transition-all" style={{ width: `${Math.min(100, qty.pct)}%`, background: '#10B981' }} />
                    </div>
                )}
            </div>
        </div>
    );
}

// ─── Kanban Column ────────────────────────────────────────────────────────────
function KanbanColumn({ status, tickets, quantityLogs, onCardClick, isViewOnly = false }: {
    status: typeof STATUSES[number]; tickets: PmTicket[]; quantityLogs: PmQuantityLog[];
    onCardClick: (t: PmTicket) => void; isViewOnly?: boolean;
}) {
    const { setNodeRef, isOver } = useDroppable({ id: `col_${status.key}` });
    const Icon = status.icon;
    // group: parents first, then subtasks under their parent
    const roots = tickets.filter(t => !t.parent_id);
    const children = tickets.filter(t => !!t.parent_id);
    const ordered: PmTicket[] = [];
    for (const r of roots) {
        ordered.push(r);
        ordered.push(...children.filter(c => c.parent_id === r.id));
    }
    // orphan subs (parent in different column)
    const shown = new Set(ordered.map(t => t.id));
    for (const c of children) { if (!shown.has(c.id)) ordered.push(c); }

    return (
        <div ref={setNodeRef} className="flex-1 min-w-[260px] max-w-[340px] rounded-2xl p-3 transition-colors"
            style={{ background: isOver ? status.color + '08' : 'var(--color-surface-2)', border: isOver ? `2px dashed ${status.color}` : '2px solid transparent' }}>
            <div className="flex items-center gap-2 mb-3 px-1">
                <Icon className="w-4 h-4" style={{ color: status.color }} />
                <p className="text-[12px] font-bold" style={{ color: status.color }}>{status.label}</p>
                <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full ml-auto" style={{ background: status.bg, color: status.color }}>{tickets.length}</span>
            </div>
            <div className="space-y-2 min-h-[80px]">
                {ordered.map(t => <KanbanCard key={t.id} ticket={t} quantityLogs={quantityLogs} onClick={() => onCardClick(t)} isViewOnly={isViewOnly} />)}
            </div>
        </div>
    );
}

// ─── Ticket Edit Modal ────────────────────────────────────────────────────────
function TicketModal({ ticket, projectId, users, milestones, sprints, allTickets, onSave, onClose, onDelete, onRefreshLogs, isViewOnly = false, currentUserSub = '' }: {
    ticket: Partial<PmTicket>;
    projectId: string;
    users: PlatformUser[];
    milestones: PmMilestone[];
    sprints: PmSprint[];
    allTickets: PmTicket[];
    onSave: (data: Partial<PmTicket>) => void;
    onClose: () => void;
    onDelete?: (id: string) => void;
    onRefreshLogs: () => void;
    isViewOnly?: boolean;
    currentUserSub?: string;
}) {
    const toDateStr = (v: string | null | undefined) => v ? v.slice(0, 10) : '';
    const [form, setForm] = useState<Partial<PmTicket>>({
        project_id: projectId, type: 'product', status: 'start', priority: 'medium', progress: 0, all_device: 0,
        ...ticket,
        plan_start: toDateStr(ticket.plan_start), plan_end: toDateStr(ticket.plan_end), date_to_finish: toDateStr(ticket.date_to_finish),
    });
    const set = <K extends keyof PmTicket>(k: K, v: PmTicket[K]) => setForm(f => ({ ...f, [k]: v }));

    // Assignee-only mode: if ticket has an assignee and current user is NOT that assignee, restrict editing
    // They can still view and edit Quantity Logs only
    const isAssigneeOnly = !isViewOnly && !!ticket.id && !!ticket.assignee_id && ticket.assignee_id !== currentUserSub;
    const canEditFields = !isViewOnly && !isAssigneeOnly;

    // Quantity logs for this ticket
    const [qtyLogs, setQtyLogs] = useState<PmQuantityLog[]>([]);
    const [newLogDate, setNewLogDate] = useState(new Date().toISOString().slice(0, 10));
    const [newLogQty, setNewLogQty] = useState(0);
    const [savingLog, setSavingLog] = useState(false);

    // Audit trail
    const [auditLogs, setAuditLogs] = useState<{ id: string; field_name: string; old_value: string | null; new_value: string | null; user_name: string | null; created_at: string }[]>([]);
    const [showAudit, setShowAudit] = useState(false);

    useEffect(() => {
        if (ticket.id) {
            api<PmQuantityLog[]>(`/api/pm/tickets/${ticket.id}/quantity-logs`).then(setQtyLogs).catch(() => {});
            api<typeof auditLogs>(`/api/pm/tickets/${ticket.id}/audit-logs`).then(setAuditLogs).catch(() => {});
        }
    }, [ticket.id]);

    const addQuantityLog = async () => {
        if (!ticket.id || newLogQty <= 0) return;
        setSavingLog(true);
        try {
            await api('/api/pm/tickets/' + ticket.id + '/quantity-logs', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ log_date: newLogDate, quantity: newLogQty }),
            });
            const updated = await api<PmQuantityLog[]>(`/api/pm/tickets/${ticket.id}/quantity-logs`);
            setQtyLogs(updated);
            setNewLogQty(0);
            onRefreshLogs();
        } catch { /* ignore */ }
        setSavingLog(false);
    };

    const deleteLog = async (logId: string) => {
        try {
            await api(`/api/pm/quantity-logs/${logId}`, { method: 'DELETE' });
            setQtyLogs(prev => prev.filter(l => l.id !== logId));
            onRefreshLogs();
        } catch { /* ignore */ }
    };

    const totalDone = qtyLogs.reduce((s, l) => s + l.quantity, 0);
    const allDev = form.all_device || 0;
    const pendingCalc = Math.max(0, allDev - totalDone);
    const parentOptions = allTickets.filter(t => t.id !== ticket.id && !t.parent_id && !hasCircularParent(ticket.id, t.id, allTickets));
    const hasChildren = ticket.id ? allTickets.some(t => t.parent_id === ticket.id) : false;

    // ── Warning modal before save ──────────────────────────────────────────────
    const [warnModal, setWarnModal] = useState<{ items: { field: string; tip: string }[] } | null>(null);
    const handleSave = () => {
        if (!form.title?.trim()) return;
        const warns: { field: string; tip: string }[] = [];
        if (!form.plan_start)
            warns.push({ field: '📅 วันเริ่มแผน', tip: 'งานจะ ไม่แสดงบน Gantt Chart และระบบไม่สามารถตรวจสอบช่วงวันที่บันทึก Quantity ได้' });
        if (!form.plan_end)
            warns.push({ field: '📅 วันสิ้นสุดแผน', tip: 'งานจะ ไม่แสดงบน Gantt Chart (ไม่มีจุดสิ้นสุด) และไม่สามารถลาก/ขยาย Bar ใน Gantt ได้' });
        if (!hasChildren && (form.all_device ?? 0) === 0)
            warns.push({ field: '📱 จำนวนเครื่องทั้งหมด (All Device)', tip: 'ระบบจะไม่สามารถบันทึกจำนวนรายวัน (Quantity Tracking) ได้ ความคืบหน้าต้องกำหนดเองด้วย Slider 0–100% แทนการคำนวณอัตโนมัติ' });
        if (warns.length > 0) { setWarnModal({ items: warns }); return; }
        onSave(form);
    };

    // Status → Total auto-fill prompt
    const handleStatusChange = (newStatus: string) => {
        if (newStatus === 'total' && allDev > 0 && totalDone < allDev && ticket.id) {
            const remaining = allDev - totalDone;
            if (confirm(`ต้องการบันทึก Quantity ให้เต็มจำนวน (เพิ่ม ${remaining} ให้ครบ ${allDev}) หรือไม่?`)) {
                // Add a log entry for today with the remaining quantity
                const todayStr = new Date().toISOString().slice(0, 10);
                api('/api/pm/tickets/' + ticket.id + '/quantity-logs', {
                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ log_date: todayStr, quantity: remaining }),
                }).then(() => api<PmQuantityLog[]>(`/api/pm/tickets/${ticket.id}/quantity-logs`))
                  .then(setQtyLogs).then(onRefreshLogs).catch(() => {});
            }
        }
        set('status', newStatus);
    };

    return (
        <>
        <Modal isOpen onClose={onClose} showCloseButton={false}
            className="w-full max-w-lg m-4 overflow-hidden flex flex-col" >
            <div className="flex flex-col" style={{ maxHeight: '85vh' }}>
                {/* Header */}
                <div className="flex items-center justify-between px-6 py-4 flex-shrink-0" style={{ borderBottom: '1px solid var(--color-border)' }}>
                    <div className="flex items-center gap-2">
                        <h3 className="text-base font-bold" style={{ color: 'var(--color-text-primary)' }}>
                            {ticket.id ? 'แก้ไข Ticket' : 'สร้าง Ticket ใหม่'}
                        </h3>
                        {isViewOnly && <span className="text-[10px] font-bold px-2 py-0.5 rounded-lg" style={{ background: '#FFF7ED', color: '#EA580C', border: '1px solid #FDBA7440' }}>View Only</span>}
                        {isAssigneeOnly && <span className="text-[10px] font-bold px-2 py-0.5 rounded-lg" style={{ background: '#EEF2FF', color: '#2563EB', border: '1px solid #2563EB40' }}>แก้ไขได้เฉพาะ Quantity</span>}
                    </div>
                    <button onClick={onClose} className="btn-icon"><X className="w-4 h-4" /></button>
                </div>

                {/* Body */}
                <div className="overflow-y-auto flex-1 p-6 space-y-4">
                    {/* Title */}
                    <div>
                        <label className="text-[12px] font-semibold mb-1.5 block" style={{ color: 'var(--color-text-secondary)' }}>ชื่อ Ticket <span className="text-red-400">*</span></label>
                        <input className="field-input" value={form.title ?? ''} onChange={e => set('title', e.target.value)} placeholder="ชื่องาน..." disabled={!canEditFields} />
                    </div>

                    {/* Type + Priority */}
                    <div className="grid grid-cols-2 gap-3">
                        <div>
                            <label className="text-[12px] font-semibold mb-1.5 block" style={{ color: 'var(--color-text-secondary)' }}>ประเภท</label>
                            <select className="field-input" value={form.type ?? 'product'} onChange={e => set('type', e.target.value)} disabled={!canEditFields}>
                                {Object.entries(TYPES).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
                            </select>
                        </div>
                        <div>
                            <label className="text-[12px] font-semibold mb-1.5 block" style={{ color: 'var(--color-text-secondary)' }}>ความสำคัญ</label>
                            <select className="field-input" value={form.priority ?? 'medium'} onChange={e => set('priority', e.target.value)} disabled={!canEditFields}>
                                {Object.entries(PRIORITIES).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
                            </select>
                        </div>
                    </div>

                    {/* Status + Assignee */}
                    <div className="grid grid-cols-2 gap-3">
                        <div>
                            <label className="text-[12px] font-semibold mb-1.5 block" style={{ color: 'var(--color-text-secondary)' }}>สถานะ</label>
                            <select className="field-input" value={form.status ?? 'start'} onChange={e => handleStatusChange(e.target.value)} disabled={!canEditFields}>
                                {STATUSES.map(s => <option key={s.key} value={s.key}>{s.label}</option>)}
                            </select>
                        </div>
                        <div>
                            <label className="text-[12px] font-semibold mb-1.5 block" style={{ color: 'var(--color-text-secondary)' }}>ผู้รับผิดชอบ</label>
                            <select className="field-input" value={form.assignee_id ?? ''} onChange={e => set('assignee_id', e.target.value || null as unknown as string)} disabled={!canEditFields}>
                                <option value="">— ไม่ระบุ —</option>
                                {users.map(u => <option key={u.sub} value={u.sub}>{u.name || u.email}</option>)}
                            </select>
                        </div>
                    </div>

                    {/* Blocker Details — shown when status is pending */}
                    {form.status === 'pending' && (
                        <div className="rounded-xl p-4 space-y-3" style={{ background: '#FDF2F8', border: '1px solid #F9A8D4' }}>
                            <p className="text-[11px] font-black uppercase tracking-widest" style={{ color: '#BE185D' }}>
                                🚧 สาเหตุที่งานติดขัด (Blocker)
                            </p>
                            <div>
                                <label className="text-[10px] font-semibold mb-1 block" style={{ color: '#9D174D' }}>หมวดหมู่</label>
                                <select className="field-input text-[12px]" value={form.blocker_category ?? ''} onChange={e => set('blocker_category', e.target.value || null as unknown as string)} disabled={!canEditFields}>
                                    <option value="">— เลือกสาเหตุ —</option>
                                    <option value="waiting_vendor">รอของจาก Vendor</option>
                                    <option value="site_not_ready">หน้างานยังไม่พร้อม</option>
                                    <option value="waiting_approval">รออนุมัติ</option>
                                    <option value="waiting_info">รอข้อมูลเพิ่มเติม</option>
                                    <option value="technical_issue">ปัญหาทางเทคนิค</option>
                                    <option value="resource_unavailable">ทรัพยากรไม่เพียงพอ</option>
                                    <option value="other">อื่นๆ</option>
                                </select>
                            </div>
                            <div>
                                <label className="text-[10px] font-semibold mb-1 block" style={{ color: '#9D174D' }}>รายละเอียดเพิ่มเติม</label>
                                <textarea className="field-input resize-none text-[12px]" rows={2} value={form.blocker_note ?? ''} onChange={e => set('blocker_note', e.target.value || null as unknown as string)} placeholder="ระบุรายละเอียด..." disabled={!canEditFields} />
                            </div>
                        </div>
                    )}

                    {/* Parent (Sub-task) */}
                    <div>
                        <label className="text-[12px] font-semibold mb-1.5 block" style={{ color: 'var(--color-text-secondary)' }}>งานหลัก <span className="font-normal opacity-60">(เลือกถ้าเป็นงานย่อย)</span></label>
                        <select className="field-input" value={form.parent_id ?? ''} onChange={e => set('parent_id', e.target.value || null as unknown as string)} disabled={!canEditFields}>
                            <option value="">— ไม่มี (งานหลัก) —</option>
                            {parentOptions.map(t => <option key={t.id} value={t.id}>{t.title}</option>)}
                        </select>
                    </div>

                    {/* Milestone + Sprint */}
                    <div className="grid grid-cols-2 gap-3">
                        <div>
                            <label className="text-[12px] font-semibold mb-1.5 block" style={{ color: 'var(--color-text-secondary)' }}>ไมล์สโตน</label>
                            <select className="field-input" value={form.milestone_id ?? ''} onChange={e => set('milestone_id', e.target.value || null as unknown as string)} disabled={!canEditFields}>
                                <option value="">— ไม่ระบุ —</option>
                                {milestones.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
                            </select>
                        </div>
                        <div>
                            <label className="text-[12px] font-semibold mb-1.5 block" style={{ color: 'var(--color-text-secondary)' }}>สปรินต์</label>
                            <select className="field-input" value={form.sprint_id ?? ''} onChange={e => set('sprint_id', e.target.value || null as unknown as string)} disabled={!canEditFields}>
                                <option value="">— ไม่ระบุ —</option>
                                {sprints.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                            </select>
                        </div>
                    </div>

                    {/* Dates */}
                    <div className="grid grid-cols-2 gap-3">
                        <div>
                            <label className="text-[12px] font-semibold mb-1.5 block" style={{ color: 'var(--color-text-secondary)' }}>วันเริ่มแผน <span className="text-amber-400">*</span></label>
                            <ThaiDatePicker value={form.plan_start} onChange={v => set('plan_start', v as unknown as string)} placeholder="เลือกวันเริ่ม" disabled={!canEditFields} />
                            {!form.plan_start && <p className="text-[10px] mt-1" style={{ color: '#F59E0B' }}>⚠️ ไม่มีจะไม่แสดงบน Gantt Chart</p>}
                        </div>
                        <div>
                            <label className="text-[12px] font-semibold mb-1.5 block" style={{ color: 'var(--color-text-secondary)' }}>วันสิ้นสุดแผน <span className="text-amber-400">*</span></label>
                            <ThaiDatePicker value={form.plan_end} onChange={v => set('plan_end', v as unknown as string)} placeholder="เลือกวันสิ้นสุด" disabled={!canEditFields} />
                            {!form.plan_end && <p className="text-[10px] mt-1" style={{ color: '#F59E0B' }}>⚠️ ไม่มีจะไม่แสดงบน Gantt Chart</p>}
                        </div>
                    </div>

                    {/* All Device + Progress */}
                    <div className="grid grid-cols-2 gap-3">
                        <div>
                            <label className="text-[12px] font-semibold mb-1.5 block" style={{ color: 'var(--color-text-secondary)' }}>จำนวนเครื่องทั้งหมด <span className="text-amber-400">*</span></label>
                            <input type="number" min="0" className="field-input" value={form.all_device ?? 0} onChange={e => set('all_device', Number(e.target.value))} placeholder="0" disabled={hasChildren || !canEditFields} />
                            {hasChildren
                                ? <p className="text-[10px] mt-1" style={{ color: 'var(--color-text-tertiary)' }}>🔒 มีงานย่อย — ระบบรวมค่าจากลูกอัตโนมัติ</p>
                                : (form.all_device ?? 0) === 0 && <p className="text-[10px] mt-1" style={{ color: '#F59E0B' }}>⚠️ ถ้าเป็น 0 จะไม่สามารถบันทึก Quantity/วันได้</p>}
                        </div>
                        <div>
                            <label className="text-[12px] font-semibold mb-1.5 flex items-center gap-2" style={{ color: 'var(--color-text-secondary)' }}>
                                ความคืบหน้า
                                {allDev > 0 ? (
                                    <span className="text-[9px] font-bold px-1.5 py-0.5 rounded" style={{ background: '#ECFDF5', color: '#059669' }}>ระบบคำนวณ</span>
                                ) : (
                                    <span className="text-[9px] font-bold px-1.5 py-0.5 rounded" style={{ background: '#E0F2FE', color: '#0284C7' }}>กำหนดเอง</span>
                                )}
                            </label>
                            {hasChildren ? (
                                <div className="flex items-center gap-2 h-10">
                                    <span className="text-[12px]" style={{ color: 'var(--color-text-tertiary)' }}>🔒 คำนวณจาก Sub-task อัตโนมัติ</span>
                                </div>
                            ) : allDev > 0 ? (
                                <div className="flex items-center gap-2 h-10">
                                    <div className="flex-1 h-2 rounded-full overflow-hidden" style={{ background: 'var(--color-border)' }}>
                                        <div className="h-full rounded-full" style={{ width: `${Math.min(100, Math.round(totalDone / allDev * 100))}%`, background: '#10B981' }} />
                                    </div>
                                    <span className="text-[12px] font-bold" style={{ color: '#10B981' }}>{totalDone}/{allDev} ({Math.min(100, Math.round(totalDone / allDev * 100))}%)</span>
                                </div>
                            ) : (
                                <div className="flex items-center gap-2">
                                    <input type="range" min={0} max={100} step={5} className="flex-1 accent-[#0EA5E9]" value={form.progress ?? 0} onChange={e => set('progress', Number(e.target.value))} disabled={!canEditFields} />
                                    <span className="text-[12px] font-bold w-10 text-center" style={{ color: '#0EA5E9' }}>{form.progress ?? 0}%</span>
                                </div>
                            )}
                        </div>
                    </div>

                    {/* Quantity Tracking — only for existing tickets without children */}
                    {ticket.id && allDev > 0 && !hasChildren && (
                        <div className="rounded-xl p-4 space-y-3" style={{ background: 'var(--color-surface-2)', border: '1px solid var(--color-border)' }}>
                            <p className="text-[11px] font-black uppercase tracking-widest" style={{ color: '#F59E0B' }}>
                                📊 บันทึกจำนวน (In Progress)
                            </p>
                            {/* Summary cards */}
                            <div className="grid grid-cols-3 gap-2">
                                <div className="rounded-lg p-2 text-center" style={{ background: '#E0F2FE' }}>
                                    <p className="text-[9px] font-bold" style={{ color: '#0284C7' }}>ALL DEVICE</p>
                                    <p className="text-[16px] font-black" style={{ color: '#0284C7' }}>{allDev}</p>
                                </div>
                                <div className="rounded-lg p-2 text-center" style={{ background: '#F5F3FF' }}>
                                    <p className="text-[9px] font-bold" style={{ color: '#1D4ED8' }}>PENDING</p>
                                    <p className="text-[16px] font-black" style={{ color: '#1D4ED8' }}>{pendingCalc}</p>
                                </div>
                                <div className="rounded-lg p-2 text-center" style={{ background: '#ECFDF5' }}>
                                    <p className="text-[9px] font-bold" style={{ color: '#059669' }}>TOTAL</p>
                                    <p className="text-[16px] font-black" style={{ color: '#059669' }}>{totalDone}</p>
                                </div>
                            </div>
                            {/* Add new log */}
                            {!isViewOnly && <div className="flex items-end gap-2">
                                <div className="flex-1">
                                    <label className="text-[10px] font-semibold mb-1 block" style={{ color: 'var(--color-text-tertiary)' }}>วันที่</label>
                                    <ThaiDatePicker value={newLogDate} onChange={v => setNewLogDate(v || new Date().toISOString().slice(0, 10))} size="small" placeholder="เลือกวันที่" />
                                </div>
                                <div className="w-24">
                                    <label className="text-[10px] font-semibold mb-1 block" style={{ color: 'var(--color-text-tertiary)' }}>จำนวน</label>
                                    <input type="number" min="0" className="field-input text-[12px]" value={newLogQty} onChange={e => setNewLogQty(Number(e.target.value))} />
                                </div>
                                <button className="btn btn-primary text-[11px] px-3 py-2" onClick={addQuantityLog} disabled={savingLog || newLogQty <= 0}>
                                    {savingLog ? '...' : 'เพิ่ม'}
                                </button>
                            </div>}
                            {/* Log entries */}
                            {qtyLogs.length > 0 && (
                                <div className="space-y-1 max-h-40 overflow-y-auto">
                                    {qtyLogs.map((l, i) => {
                                        const cumulative = qtyLogs.slice(0, i + 1).reduce((s, x) => s + x.quantity, 0);
                                        const dayPending = allDev - cumulative;
                                        return (
                                            <div key={l.id} className="flex items-center gap-2 px-2 py-1.5 rounded-lg text-[11px]"
                                                style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
                                                <span className="font-medium" style={{ color: 'var(--color-text-secondary)' }}>{formatThaiDateShort(l.log_date)}</span>
                                                <span className="font-bold" style={{ color: '#F59E0B' }}>In Progress: {l.quantity}</span>
                                                <span style={{ color: '#1D4ED8' }}>Pending: {dayPending}</span>
                                                <span style={{ color: '#059669' }}>Total: {cumulative}</span>
                                                <button onClick={() => deleteLog(l.id)} className="ml-auto text-red-400 hover:text-red-600" disabled={isViewOnly} style={{ display: isViewOnly ? 'none' : undefined }}>
                                                    <X className="w-3 h-3" />
                                                </button>
                                            </div>
                                        );
                                    })}
                                </div>
                            )}
                        </div>
                    )}

                    {/* Story Points + Due Date */}
                    <div className="grid grid-cols-2 gap-3">
                        <div>
                            <label className="text-[12px] font-semibold mb-1.5 block" style={{ color: 'var(--color-text-secondary)' }}>คะแนนความยาก (Story Points)</label>
                            <select className="field-input" value={form.storypoints ?? ''} onChange={e => set('storypoints', e.target.value ? Number(e.target.value) : null as unknown as number)} disabled={!canEditFields}>
                                <option value="">— ไม่ระบุ —</option>
                                {EFFORTS.map(e => <option key={e} value={e}>{e}</option>)}
                            </select>
                        </div>
                        <div>
                            <label className="text-[12px] font-semibold mb-1.5 block" style={{ color: 'var(--color-text-secondary)' }}>วันกำหนดส่ง (Due Date)</label>
                            <ThaiDatePicker value={form.date_to_finish} onChange={v => set('date_to_finish', v as unknown as string)} placeholder="เลือกวันกำหนดส่ง" disabled={!canEditFields} />
                            <p className="text-[10px] mt-1" style={{ color: 'var(--color-text-tertiary)' }}>ใช้สำหรับอ้างอิงกำหนดส่ง (ไม่มีผลต่อ Gantt)</p>
                        </div>
                    </div>

                    {/* Plan Hours + Hour Remaining */}
                    <div className="grid grid-cols-2 gap-3">
                        <div>
                            <label className="text-[12px] font-semibold mb-1.5 block" style={{ color: 'var(--color-text-secondary)' }}>ชั่วโมงที่วางแผน</label>
                            <input type="number" step="0.5" min="0" className="field-input" value={form.plan_hours ?? ''} onChange={e => set('plan_hours', e.target.value ? Number(e.target.value) : null as unknown as number)} placeholder="0" disabled={!canEditFields} />
                            <p className="text-[10px] mt-1" style={{ color: 'var(--color-text-tertiary)' }}>จำนวนชั่วโมงที่วางแผนไว้ (เพื่ออ้างอิง)</p>
                        </div>
                        <div>
                            <label className="text-[12px] font-semibold mb-1.5 block" style={{ color: 'var(--color-text-secondary)' }}>ชั่วโมงที่เหลือ</label>
                            <input type="number" step="0.5" min="0" className="field-input" value={form.hour_remaining ?? ''} onChange={e => set('hour_remaining', e.target.value ? Number(e.target.value) : null as unknown as number)} placeholder="0" disabled={!canEditFields} />
                            <p className="text-[10px] mt-1" style={{ color: 'var(--color-text-tertiary)' }}>ชั่วโมงที่เหลืออยู่ (เพื่ออ้างอิง)</p>
                        </div>
                    </div>

                    {/* Tags */}
                    <div>
                        <label className="text-[12px] font-semibold mb-1.5 block" style={{ color: 'var(--color-text-secondary)' }}>แท็ก <span className="font-normal opacity-60">(คั่นด้วยเครื่องหมาย ,)</span></label>
                        <input className="field-input" value={form.tags ?? ''} onChange={e => set('tags', e.target.value || null as unknown as string)} placeholder="เช่น backend, urgent, ติดตั้ง" disabled={!canEditFields} />
                        <p className="text-[10px] mt-1" style={{ color: 'var(--color-text-tertiary)' }}>ใช้สำหรับจัดกลุ่ม/ค้นหา (ยังไม่มีผลต่อการคำนวณ)</p>
                    </div>

                    {/* Description */}
                    <div>
                        <label className="text-[12px] font-semibold mb-1.5 block" style={{ color: 'var(--color-text-secondary)' }}>รายละเอียด</label>
                        <textarea className="field-input resize-none" rows={3} value={form.description ?? ''} onChange={e => set('description', e.target.value)} placeholder="รายละเอียดเพิ่มเติม..." disabled={!canEditFields} />
                    </div>

                    {/* Acceptance Criteria */}
                    <div>
                        <label className="text-[12px] font-semibold mb-1.5 block" style={{ color: 'var(--color-text-secondary)' }}>เกณฑ์การยอมรับงาน</label>
                        <textarea className="field-input resize-none" rows={2} value={form.acceptance_criteria ?? ''} onChange={e => set('acceptance_criteria', e.target.value)} placeholder="เงื่อนไขที่ต้องผ่านก่อนถือว่าเสร็จ..." disabled={!canEditFields} />
                    </div>

                    {/* Audit Trail */}
                    {ticket.id && auditLogs.length > 0 && (
                        <div className="rounded-xl overflow-hidden" style={{ border: '1px solid var(--color-border)' }}>
                            <button onClick={() => setShowAudit(v => !v)} className="w-full flex items-center justify-between px-4 py-2.5 text-[11px] font-bold" style={{ background: 'var(--color-surface-2)', color: 'var(--color-text-secondary)' }}>
                                <span>📋 ประวัติการแก้ไข ({auditLogs.length})</span>
                                <span style={{ transform: showAudit ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform 0.2s' }}>▼</span>
                            </button>
                            {showAudit && (
                                <div className="max-h-40 overflow-y-auto">
                                    {auditLogs.map(log => (
                                        <div key={log.id} className="flex items-center gap-2 px-4 py-2 text-[10px]" style={{ borderTop: '1px solid var(--color-border)' }}>
                                            <span className="font-medium" style={{ color: 'var(--color-text-tertiary)' }}>{new Date(log.created_at).toLocaleDateString('th-TH', { day: 'numeric', month: 'short' })} {new Date(log.created_at).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' })}</span>
                                            <span style={{ color: 'var(--color-text-secondary)' }}>{log.user_name || '—'}</span>
                                            <span className="font-bold" style={{ color: '#2563EB' }}>{log.field_name}</span>
                                            <span style={{ color: '#EF4444' }}>{log.old_value || '(ว่าง)'}</span>
                                            <span style={{ color: 'var(--color-text-tertiary)' }}>→</span>
                                            <span style={{ color: '#10B981' }}>{log.new_value || '(ว่าง)'}</span>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    )}
                </div>

                {/* Footer */}
                <div className="px-6 py-4 flex gap-3 justify-between flex-shrink-0" style={{ borderTop: '1px solid var(--color-border)' }}>
                    <div className="flex gap-2">
                        {ticket.id && onDelete && canEditFields && (
                            <button className="btn flex items-center gap-1.5 text-red-500 hover:bg-red-50 transition-colors" onClick={() => onDelete(ticket.id!)}>
                                <Trash2 className="w-3.5 h-3.5" /> ลบ
                            </button>
                        )}
                    </div>
                    <div className="flex gap-3">
                        <button className="btn" onClick={onClose}>{isViewOnly ? 'ปิด' : 'ยกเลิก'}</button>
                        {!isViewOnly && (
                            <button className="btn btn-primary" disabled={!form.title?.trim() || isAssigneeOnly} onClick={handleSave}>
                                {ticket.id ? 'บันทึก' : 'สร้าง'}
                            </button>
                        )}
                    </div>
                </div>
            </div>
        </Modal>

            {/* ── Warning Modal ── */}
            {warnModal && (
                <Modal isOpen onClose={() => setWarnModal(null)} showCloseButton={false}
                    className="w-full max-w-md m-4 overflow-hidden">
                        <div className="px-6 py-4 flex items-center gap-3" style={{ borderBottom: '1px solid var(--color-border)', background: '#FFFBEB' }}>
                            <span className="text-xl">⚠️</span>
                            <div>
                                <h4 className="text-sm font-bold" style={{ color: '#92400E' }}>ข้อมูลที่ยังไม่ได้กรอก</h4>
                                <p className="text-[11px]" style={{ color: '#B45309' }}>ฟิลด์ต่อไปนี้หากไม่กรอก จะส่งผลต่อการทำงานของระบบ</p>
                            </div>
                        </div>
                        <div className="px-6 py-4 space-y-3">
                            {warnModal.items.map((w, i) => (
                                <div key={i} className="rounded-xl p-3" style={{ background: '#FEF3C7', border: '1px solid #FDE68A' }}>
                                    <p className="text-[12px] font-bold mb-1" style={{ color: '#92400E' }}>{w.field}</p>
                                    <p className="text-[11px]" style={{ color: '#B45309' }}>{w.tip}</p>
                                </div>
                            ))}
                        </div>
                        <div className="px-6 py-4 flex gap-3 justify-end" style={{ borderTop: '1px solid var(--color-border)' }}>
                            <button className="btn" onClick={() => setWarnModal(null)}>กลับไปแก้ไข</button>
                            <button className="btn" style={{ background: '#F59E0B', color: '#fff' }}
                                onClick={() => { setWarnModal(null); onSave(form); }}>
                                บันทึกต่อโดยไม่กรอก
                            </button>
                        </div>
                </Modal>
            )}
        </>
    );
}

// ─── Project Selector + Creator ───────────────────────────────────────────────
function ProjectSelector({ projects, selected, onChange }: {
    projects: PmProject[]; selected: string;
    onChange: (id: string) => void;
}) {
    return (
        <div className="flex items-center gap-3 flex-wrap">
            {projects.map(p => (
                <button key={p.id} onClick={() => onChange(p.id)} className="flex items-center gap-2 px-3 py-2 rounded-xl text-[13px] font-semibold transition-all"
                    style={{ background: selected === p.id ? p.color + '18' : 'var(--color-surface-2)', color: selected === p.id ? p.color : 'var(--color-text-secondary)', border: selected === p.id ? `1.5px solid ${p.color}` : '1.5px solid var(--color-border)' }}>
                    <div className="w-3 h-3 rounded-full" style={{ background: p.color }} />{p.name}
                </button>
            ))}
        </div>
    );
}

// ─── Confirm Delete Modal ─────────────────────────────────────────────────────
function ConfirmModal({ title, message, onConfirm, onCancel }: { title: string; message: string; onConfirm: () => void; onCancel: () => void }) {
    return (
        <Modal isOpen onClose={onCancel} showCloseButton={false}
            className="w-[380px] max-w-[calc(100vw-2rem)] m-4 p-6">
                <div className="flex items-center gap-3 mb-4">
                    <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: '#FEF2F2' }}>
                        <AlertTriangle className="w-5 h-5 text-red-500" />
                    </div>
                    <h3 className="text-[15px] font-bold" style={{ color: 'var(--color-text-primary)' }}>{title}</h3>
                </div>
                <p className="text-[13px] mb-6" style={{ color: 'var(--color-text-secondary)' }}>{message}</p>
                <div className="flex justify-end gap-2">
                    <button onClick={onCancel} className="px-4 py-2 text-[13px] font-semibold rounded-xl"
                        style={{ color: 'var(--color-text-secondary)', background: 'var(--color-surface-2)', border: '1px solid var(--color-border)' }}>ยกเลิก</button>
                    <button onClick={onConfirm} className="px-4 py-2 text-[13px] font-semibold rounded-xl text-white" style={{ background: '#EF4444' }}>ลบ</button>
                </div>
        </Modal>
    );
}

// ─── Toast Notifications ──────────────────────────────────────────────────────
function ToastContainer({ toasts }: { toasts: { id: string; type: 'success' | 'error' | 'info'; message: string }[] }) {
    const icons = { success: CheckCircle2, error: AlertTriangle, info: Circle };
    const colors = { success: '#10B981', error: '#EF4444', info: '#2563EB' };
    const bgs = { success: '#ECFDF5', error: '#FEF2F2', info: '#EEF2FF' };
    return (
        <div className="fixed bottom-6 right-6 z-[60] flex flex-col gap-2">
            <AnimatePresence>
                {toasts.map(t => {
                    const Icon = icons[t.type];
                    return (
                        <motion.div key={t.id} initial={{ opacity: 0, y: 20, scale: 0.95 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: -10, scale: 0.95 }}
                            className="flex items-center gap-2.5 px-4 py-3 rounded-xl shadow-lg" style={{ background: bgs[t.type], border: `1px solid ${colors[t.type]}30` }}>
                            <Icon className="w-4 h-4 flex-shrink-0" style={{ color: colors[t.type] }} />
                            <span className="text-[13px] font-medium" style={{ color: colors[t.type] }}>{t.message}</span>
                        </motion.div>
                    );
                })}
            </AnimatePresence>
        </div>
    );
}

// ─── Gantt Chart (BigPicture-style split view) ────────────────────────────────
interface GanttRow {
    ticket: PmTicket;
    depth: number;
    hasChildren: boolean;
    isExpanded: boolean;
}

function GanttChart({ tickets, milestones, dependencies, quantityLogs, onTicketUpdate, onTicketClick, onAddSubtask, isViewOnly = false }: {
    tickets: PmTicket[];
    milestones: PmMilestone[];
    dependencies: PmDependency[];
    quantityLogs: PmQuantityLog[];
    onTicketUpdate: (id: string, data: Partial<PmTicket>) => Promise<void>;
    onTicketClick: (ticket: PmTicket) => void;
    onAddSubtask: (parentId: string) => void;
    isViewOnly?: boolean;
}) {
    const chartBodyRef = useRef<HTMLDivElement>(null);
    const chartHeaderRef = useRef<HTMLDivElement>(null);
    const dayWidth = 36;
    const rowHeight = 40;
    const headerHeight = 52;
    const [leftWidth, setLeftWidth] = useState(520);
    const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

    // Initialize expanded to show all
    useEffect(() => {
        const parents = new Set(tickets.filter(t => !t.parent_id).map(t => t.id));
        setExpandedIds(parents);
    }, [tickets]);

    const toggleExpand = (id: string) => {
        setExpandedIds(prev => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id); else next.add(id);
            return next;
        });
    };

    // Build flat row list from tree
    const ganttRows = useMemo<GanttRow[]>(() => {
        const childrenMap = new Map<string | null, PmTicket[]>();
        for (const t of tickets) {
            const pid = t.parent_id || null;
            if (!childrenMap.has(pid)) childrenMap.set(pid, []);
            childrenMap.get(pid)!.push(t);
        }
        const rows: GanttRow[] = [];
        const addRows = (parentId: string | null, depth: number) => {
            const items = childrenMap.get(parentId) || [];
            for (const t of items) {
                const kids = childrenMap.get(t.id) || [];
                const hasChildren = kids.length > 0;
                const isExpanded = expandedIds.has(t.id);
                rows.push({ ticket: t, depth, hasChildren, isExpanded });
                if (hasChildren && isExpanded) addRows(t.id, depth + 1);
            }
        };
        addRows(null, 0);
        return rows;
    }, [tickets, expandedIds]);

    /* ── Gantt drag state ── */
    const dragRef = useRef<{ ticketId: string; type: 'move' | 'resize'; startMouseX: number; origStart: string; origEnd: string } | null>(null);
    const dragDeltaRef = useRef<{ ticketId: string; type: 'move' | 'resize'; days: number } | null>(null);
    const [dragDelta, setDragDelta] = useState<{ ticketId: string; type: 'move' | 'resize'; days: number } | null>(null);
    const clickGuard = useRef(false);
    const onUpdateRef = useRef(onTicketUpdate);
    onUpdateRef.current = onTicketUpdate;

    const startDrag = (e: React.MouseEvent, ticketId: string, type: 'move' | 'resize', origStart: string, origEnd: string) => {
        e.preventDefault(); e.stopPropagation(); clickGuard.current = false;
        dragRef.current = { ticketId, type, startMouseX: e.clientX, origStart, origEnd };
    };

    useEffect(() => {
        const onMove = (e: MouseEvent) => {
            if (!dragRef.current) return;
            const dx = e.clientX - dragRef.current.startMouseX;
            const days = Math.round(dx / dayWidth);
            const d = { ticketId: dragRef.current.ticketId, type: dragRef.current.type, days };
            dragDeltaRef.current = d; setDragDelta(d);
            if (days !== 0) clickGuard.current = true;
        };
        const onUp = () => {
            if (!dragRef.current) return;
            const info = dragRef.current;
            const days = dragDeltaRef.current?.days ?? 0;
            dragRef.current = null; dragDeltaRef.current = null; setDragDelta(null);
            if (days === 0) return;
            const shift = (ds: string, d: number) => { const dt = new Date(ds); dt.setDate(dt.getDate() + d); return dt.toISOString().slice(0, 10); };
            if (info.type === 'move') {
                onUpdateRef.current(info.ticketId, { plan_start: shift(info.origStart, days), plan_end: info.origEnd ? shift(info.origEnd, days) : undefined } as Partial<PmTicket>);
            } else {
                const newEnd = shift(info.origEnd || info.origStart, days);
                onUpdateRef.current(info.ticketId, { plan_end: newEnd >= info.origStart ? newEnd : info.origStart } as Partial<PmTicket>);
            }
        };
        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp);
        return () => { document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp); };
    }, []);

    // Resizable divider
    const dividerRef = useRef<{ startX: number; startWidth: number } | null>(null);
    useEffect(() => {
        const onMove = (e: MouseEvent) => {
            if (!dividerRef.current) return;
            const dx = e.clientX - dividerRef.current.startX;
            setLeftWidth(Math.max(300, Math.min(800, dividerRef.current.startWidth + dx)));
        };
        const onUp = () => { dividerRef.current = null; };
        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp);
        return () => { document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp); };
    }, []);

    // Sync horizontal scroll between header and body
    const handleChartScroll = () => {
        if (chartBodyRef.current && chartHeaderRef.current) {
            chartHeaderRef.current.scrollLeft = chartBodyRef.current.scrollLeft;
        }
    };

    // Compute recursive progress for all tickets
    const progressMap = useMemo(() => computeRecursiveProgress(tickets, quantityLogs), [tickets, quantityLogs]);

    // Date range — include today as fallback so Gantt always shows
    const allDates: Date[] = [new Date()];
    for (const t of tickets) { if (t.plan_start) allDates.push(new Date(t.plan_start)); if (t.plan_end) allDates.push(new Date(t.plan_end)); }
    for (const m of milestones) { if (m.due_date) allDates.push(new Date(m.due_date)); }

    if (ganttRows.length === 0) {
        return <div className="text-center py-16 text-sm" style={{ color: 'var(--color-text-tertiary)' }}>ยังไม่มี Ticket</div>;
    }

    const minDate = new Date(Math.min(...allDates.map(d => d.getTime())));
    const maxDate = new Date(Math.max(...allDates.map(d => d.getTime())));
    minDate.setDate(minDate.getDate() - 3);
    maxDate.setDate(maxDate.getDate() + 14);
    const totalDays = Math.ceil((maxDate.getTime() - minDate.getTime()) / 86400000) + 1;

    const dayToX = (d: Date) => Math.floor((d.getTime() - minDate.getTime()) / 86400000) * dayWidth;

    const today = new Date(); today.setHours(0, 0, 0, 0);
    const days: { date: Date; label: string; isWeekend: boolean; isToday: boolean }[] = [];
    for (let i = 0; i < totalDays; i++) {
        const d = new Date(minDate); d.setDate(d.getDate() + i); const w = d.getDay();
        days.push({ date: d, label: d.getDate().toString(), isWeekend: w === 0 || w === 6, isToday: d.getTime() === today.getTime() });
    }
    const months: { label: string; start: number; width: number }[] = []; let curMonth = -1;
    for (let i = 0; i < days.length; i++) {
        const m = days[i].date.getMonth();
        if (m !== curMonth) {
            curMonth = m;
            const label = dayjs(days[i].date).format('MMM BB');
            if (months.length > 0) months[months.length - 1].width = i * dayWidth - months[months.length - 1].start;
            months.push({ label, start: i * dayWidth, width: 0 });
        }
    }
    if (months.length > 0) months[months.length - 1].width = totalDays * dayWidth - months[months.length - 1].start;

    // Dependency arrows
    const arrows: { x1: number; y1: number; x2: number; y2: number }[] = [];
    for (const dep of dependencies) {
        const predIdx = ganttRows.findIndex(r => r.ticket.id === dep.predecessor_id);
        const succIdx = ganttRows.findIndex(r => r.ticket.id === dep.successor_id);
        if (predIdx < 0 || succIdx < 0) continue;
        const pT = ganttRows[predIdx].ticket, sT = ganttRows[succIdx].ticket;
        if (!pT.plan_end || !sT.plan_start) continue;
        arrows.push({ x1: dayToX(new Date(pT.plan_end)) + dayWidth, y1: predIdx * rowHeight + rowHeight / 2, x2: dayToX(new Date(sT.plan_start)), y2: succIdx * rowHeight + rowHeight / 2 });
    }

    const chartWidth = totalDays * dayWidth;

    return (
        <div className="rounded-2xl overflow-hidden" style={{ border: '1px solid var(--color-border)', background: 'var(--color-surface)' }}>
            {/* === HEADER ROW === */}
            <div className="flex" style={{ borderBottom: '1px solid var(--color-border)' }}>
                {/* Left header */}
                <div className="flex-shrink-0 flex items-center" style={{ width: leftWidth, borderRight: '1px solid var(--color-border)', height: headerHeight }}>
                    <div className="flex items-center w-full px-2" style={{ height: headerHeight }}>
                        <span className="text-[10px] font-bold uppercase tracking-wider w-8 text-center flex-shrink-0" style={{ color: 'var(--color-text-tertiary)' }}></span>
                        <span className="text-[10px] font-bold uppercase tracking-wider flex-1 px-1" style={{ color: 'var(--color-text-tertiary)' }}>TICKET</span>
                        <span className="text-[10px] font-bold uppercase tracking-wider w-20 text-center flex-shrink-0" style={{ color: 'var(--color-text-tertiary)' }}>STATUS</span>
                        <span className="text-[10px] font-bold uppercase tracking-wider w-8 text-center flex-shrink-0" style={{ color: 'var(--color-text-tertiary)' }}></span>
                        <span className="text-[10px] font-bold uppercase tracking-wider w-[68px] text-center flex-shrink-0" style={{ color: 'var(--color-text-tertiary)' }}>START</span>
                        <span className="text-[10px] font-bold uppercase tracking-wider w-[68px] text-center flex-shrink-0" style={{ color: 'var(--color-text-tertiary)' }}>END</span>
                        <span className="text-[10px] font-bold uppercase tracking-wider w-16 text-center flex-shrink-0" style={{ color: 'var(--color-text-tertiary)' }}>PROGRESS</span>
                    </div>
                </div>
                {/* Divider */}
                <div className="w-1.5 cursor-col-resize flex-shrink-0 hover:bg-blue-400/30 transition-colors" style={{ background: 'var(--color-border)' }}
                    onMouseDown={e => { dividerRef.current = { startX: e.clientX, startWidth: leftWidth }; }} />
                {/* Right header (chart) */}
                <div ref={chartHeaderRef} className="flex-1 overflow-hidden" style={{ height: headerHeight }}>
                    <div style={{ minWidth: chartWidth }}>
                        <div className="flex" style={{ height: 24 }}>
                            {months.map((m, i) => (
                                <div key={i} className="flex items-center justify-center text-[10px] font-bold"
                                    style={{ width: m.width, minWidth: m.width, color: 'var(--color-text-secondary)', borderRight: '1px solid var(--color-border)' }}>{m.label}</div>
                            ))}
                        </div>
                        <div className="flex" style={{ height: 28 }}>
                            {days.map((d, i) => (
                                <div key={i} className="flex items-center justify-center text-[10px]"
                                    style={{ width: dayWidth, minWidth: dayWidth, color: d.isToday ? '#2563EB' : d.isWeekend ? '#EF4444' : 'var(--color-text-tertiary)',
                                        fontWeight: d.isToday ? 800 : 400, background: d.isToday ? 'rgba(37, 99, 235,0.06)' : d.isWeekend ? 'rgba(239,68,68,0.03)' : 'transparent' }}>{d.label}</div>
                            ))}
                        </div>
                    </div>
                </div>
            </div>

            {/* === BODY === */}
            <div className="flex" style={{ maxHeight: '60vh', overflowY: 'auto' }}>
                {/* Left body (data table) */}
                <div className="flex-shrink-0" style={{ width: leftWidth, borderRight: '1px solid var(--color-border)' }}>
                    {ganttRows.map((row) => {
                        const t = row.ticket;
                        const pri = PRIORITIES[t.priority] ?? PRIORITIES.medium;
                        const st = STATUSES.find(s => s.key === t.status) ?? STATUSES[0];
                        const pct = progressMap.get(t.id) ?? computeQuantity(t, quantityLogs).pct;
                        const isParent = row.hasChildren;

                        return (
                            <div key={t.id} className="flex items-center px-2 group/row hover:bg-[var(--color-surface-2)] transition-colors"
                                style={{ height: rowHeight, borderBottom: '1px solid var(--color-border)' }}>
                                {/* Expand/collapse + type icon */}
                                <div className="w-8 flex items-center justify-center flex-shrink-0">
                                    {row.hasChildren ? (
                                        <button onClick={() => toggleExpand(t.id)} className="w-5 h-5 rounded flex items-center justify-center hover:bg-[var(--color-surface-2)]">
                                            {row.isExpanded ? <ChevronDown className="w-3.5 h-3.5" style={{ color: 'var(--color-text-tertiary)' }} /> : <ChevronRight className="w-3.5 h-3.5" style={{ color: 'var(--color-text-tertiary)' }} />}
                                        </button>
                                    ) : (
                                        <div className="w-2 h-2 rounded-full" style={{ background: (TYPES[t.type] ?? TYPES.product).color }} />
                                    )}
                                </div>
                                {/* Title (indented) */}
                                <div className="flex-1 min-w-0 px-1 flex items-center gap-1.5 cursor-pointer" style={{ paddingLeft: row.depth * 20 + 4 }}
                                    onClick={() => onTicketClick(t)}>
                                    <div className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: pri.color }} />
                                    <p className="text-[12px] font-medium truncate" style={{ color: 'var(--color-text-primary)' }}>{t.title}</p>
                                    {/* Add subtask button */}
                                    {!t.parent_id && !isViewOnly && (
                                        <button onClick={e => { e.stopPropagation(); onAddSubtask(t.id); }}
                                            className="opacity-0 group-hover/row:opacity-100 transition-opacity w-4 h-4 rounded flex items-center justify-center flex-shrink-0"
                                            style={{ background: 'var(--color-primary)', color: '#fff' }} title="เพิ่ม Sub-task">
                                            <Plus className="w-2.5 h-2.5" />
                                        </button>
                                    )}
                                </div>
                                {/* Status */}
                                <div className="w-20 flex-shrink-0 flex justify-center">
                                    <span className="text-[9px] font-bold px-1.5 py-0.5 rounded" style={{ background: st.bg, color: st.color }}>{st.label}</span>
                                </div>
                                {/* Assignee */}
                                <div className="w-8 flex-shrink-0 flex justify-center">
                                    {t.assignee_name ? (
                                        <div className="w-5 h-5 rounded-full flex items-center justify-center text-[7px] font-bold text-white" style={{ background: avatarColor(t.assignee_id ?? '') }} title={t.assignee_name}>
                                            {initials(t.assignee_name)}
                                        </div>
                                    ) : <div className="w-5 h-5 rounded-full" style={{ background: 'var(--color-border)' }} />}
                                </div>
                                {/* Start */}
                                <div className="w-[68px] flex-shrink-0 text-center">
                                    <span className="text-[10px]" style={{ color: 'var(--color-text-secondary)' }}>{formatThaiDateShort(t.plan_start)}</span>
                                </div>
                                {/* End */}
                                <div className="w-[68px] flex-shrink-0 text-center">
                                    <span className="text-[10px]" style={{ color: 'var(--color-text-secondary)' }}>{formatThaiDateShort(t.plan_end)}</span>
                                </div>
                                {/* Progress: quantity-based (green), manual (blue), parent avg (gray) */}
                                <div className="w-16 flex-shrink-0 flex items-center justify-center gap-1">
                                    <span className="text-[9px] flex-shrink-0" title={isParent ? 'ค่าเฉลี่ยจากลูก' : t.all_device > 0 ? 'คำนวณจาก Quantity' : 'กรอกเอง'}>
                                        {isParent ? '🌳' : t.all_device > 0 ? '📊' : '✍️'}
                                    </span>
                                    <div className="w-6 h-1.5 rounded-full overflow-hidden" style={{ background: 'var(--color-border)' }}>
                                        <div className="h-full rounded-full" style={{ width: `${Math.min(100, pct)}%`, background: isParent ? '#64748B' : t.all_device > 0 ? '#10B981' : '#0EA5E9' }} />
                                    </div>
                                    <span className="text-[10px] font-bold" style={{ color: isParent ? '#64748B' : t.all_device > 0 ? '#10B981' : '#0EA5E9' }}>{pct}%</span>
                                </div>
                            </div>
                        );
                    })}
                    {ganttRows.length === 0 && (
                        <div className="text-center py-10 text-[12px]" style={{ color: 'var(--color-text-tertiary)' }}>ไม่มี Ticket ที่มีวันที่</div>
                    )}
                </div>

                {/* Divider (visual only for body) */}
                <div className="w-1.5 flex-shrink-0" style={{ background: 'var(--color-border)' }} />

                {/* Right body (chart) */}
                <div ref={chartBodyRef} className="flex-1 overflow-x-auto" onScroll={handleChartScroll}>
                    <div style={{ minWidth: chartWidth, position: 'relative' }}>
                        {/* Weekend stripes */}
                        {days.map((d, i) => d.isWeekend && (
                            <div key={`we_${i}`} style={{ position: 'absolute', left: i * dayWidth, top: 0, width: dayWidth, height: ganttRows.length * rowHeight, background: 'rgba(239,68,68,0.06)' }} />
                        ))}
                        {/* Today line */}
                        {(() => { const tx = dayToX(today); return tx >= 0 && tx <= chartWidth ? <div style={{ position: 'absolute', left: tx + dayWidth / 2, top: 0, width: 2, height: ganttRows.length * rowHeight, background: '#2563EB', opacity: 0.5, zIndex: 5 }} /> : null; })()}

                        {/* SVG dependency arrows */}
                        <svg style={{ position: 'absolute', top: 0, left: 0, width: chartWidth, height: ganttRows.length * rowHeight, pointerEvents: 'none', zIndex: 4 }}>
                            <defs><marker id="arrowhead" markerWidth="8" markerHeight="6" refX="7" refY="3" orient="auto"><polygon points="0 0, 8 3, 0 6" fill="#94A3B8" /></marker></defs>
                            {arrows.map((a, i) => (
                                <path key={i} d={`M ${a.x1} ${a.y1} C ${a.x1 + 20} ${a.y1}, ${a.x2 - 20} ${a.y2}, ${a.x2} ${a.y2}`}
                                    stroke="#94A3B8" strokeWidth={1.5} fill="none" markerEnd="url(#arrowhead)" />
                            ))}
                        </svg>

                        {/* Ticket bars */}
                        {ganttRows.map((row) => {
                            const t = row.ticket;
                            const todayStr = today.toISOString().slice(0, 10);
                            // Fallback: tickets without dates show as a small bar at today
                            let startDate = t.plan_start ? new Date(t.plan_start) : new Date(todayStr);
                            let endDate = t.plan_end ? new Date(t.plan_end) : new Date(startDate);
                            const hasDates = !!t.plan_start;
                            if (dragDelta && dragDelta.ticketId === t.id) {
                                if (dragDelta.type === 'move') {
                                    startDate = new Date(startDate.getTime() + dragDelta.days * 86400000);
                                    endDate = new Date(endDate.getTime() + dragDelta.days * 86400000);
                                } else {
                                    endDate = new Date(endDate.getTime() + dragDelta.days * 86400000);
                                    if (endDate < startDate) endDate = new Date(startDate);
                                }
                            }
                            const x = dayToX(startDate);
                            const w = Math.max(dayWidth, (dayToX(endDate) - x) + dayWidth);
                            const st = STATUSES.find(s => s.key === t.status) ?? STATUSES[0];
                            const pct = progressMap.get(t.id) ?? computeQuantity(t, quantityLogs).pct;
                            const isParent = row.hasChildren;
                            const isDragging = dragDelta && dragDelta.ticketId === t.id;
                            const barColor = isParent ? '#64748B' : t.all_device > 0 ? '#10B981' : st.color;
                            const barBg = isParent ? '#64748B22' : st.color + '18';
                            const barBorder = isParent ? '#64748B40' : (row.depth > 0 ? st.color + '40' : st.color + '60');

                            return (
                                <div key={t.id} style={{ height: rowHeight, borderBottom: '1px solid var(--color-border)', position: 'relative' }}>
                                    <div className="absolute rounded-lg flex items-center px-2 gap-1 select-none group/bar"
                                        title={`${t.title}${t.plan_start ? `\n${t.plan_start}${t.plan_end ? ' → ' + t.plan_end : ''}` : '\n(ยังไม่กำหนดวัน)'}`}
                                        style={{ left: x, top: row.depth > 0 ? 8 : 6, width: w, height: row.depth > 0 ? rowHeight - 16 : rowHeight - 12,
                                            background: barBg, border: `1.5px solid ${barBorder}`, borderStyle: hasDates ? 'solid' : 'dashed', zIndex: isDragging ? 10 : 3,
                                            cursor: isViewOnly ? 'default' : isDragging ? 'grabbing' : 'grab', opacity: isDragging ? 0.85 : hasDates ? 1 : 0.6, transition: isDragging ? 'none' : 'box-shadow 0.15s',
                                            boxShadow: isDragging ? '0 4px 12px rgba(0,0,0,0.15)' : 'none' }}
                                        onMouseDown={isViewOnly ? undefined : e => startDrag(e, t.id, 'move', t.plan_start || todayStr, t.plan_end || t.plan_start || todayStr)}
                                        onClick={() => { if (!clickGuard.current) onTicketClick(t); }}>
                                        {/* Progress fill inside bar */}
                                        <div className="absolute left-0 top-0 bottom-0 rounded-lg" style={{ width: `${Math.min(100, pct)}%`, background: barColor + '30' }} />
                                        <span className="text-[10px] font-semibold truncate relative z-[1]" style={{ color: barColor }}>{t.title}</span>
                                        {pct > 0 && <span className="text-[8px] font-bold relative z-[1] ml-auto flex-shrink-0" style={{ color: barColor }}>{pct}%</span>}
                                        {/* Resize handle — works for both scheduled and unscheduled (drag-to-schedule) */}
                                        {!isViewOnly && <div className="absolute right-0 top-0 bottom-0 w-2 cursor-ew-resize opacity-0 group-hover/bar:opacity-100 rounded-r-lg"
                                            style={{ background: barColor + '40' }}
                                            onMouseDown={e => { e.stopPropagation(); startDrag(e, t.id, 'resize', t.plan_start || todayStr, t.plan_end || t.plan_start || todayStr); }} />}
                                    </div>
                                </div>
                            );
                        })}

                        {/* Milestone diamonds */}
                        {milestones.filter(m => m.due_date).map(m => {
                            const x = dayToX(new Date(m.due_date!));
                            return <div key={m.id} title={m.name} style={{ position: 'absolute', left: x + dayWidth / 2 - 6, top: -2, width: 12, height: 12, background: m.color, transform: 'rotate(45deg)', zIndex: 6, borderRadius: 2 }} />;
                        })}
                    </div>
                </div>
            </div>
        </div>
    );
}

// ─── Analytics View (Burn-down, S-Curve, Efficiency) ──────────────────────────
function AnalyticsView({ tickets, quantityLogs }: { tickets: PmTicket[]; quantityLogs: PmQuantityLog[] }) {
    // ── Burn-down + S-Curve data ──────────────────────────────
    const chartData = useMemo(() => {
        // Collect all dates from plan + logs
        const allDates: string[] = [];
        for (const t of tickets) {
            if (t.plan_start) allDates.push(t.plan_start.slice(0, 10));
            if (t.plan_end) allDates.push(t.plan_end.slice(0, 10));
        }
        for (const l of quantityLogs) allDates.push(l.log_date.slice(0, 10));
        if (allDates.length === 0) return [];

        allDates.sort();
        const minD = allDates[0];
        const maxD = allDates[allDates.length - 1];
        const today = new Date().toISOString().slice(0, 10);
        const endDate = maxD > today ? maxD : today;

        const totalAllDevice = tickets.reduce((s, t) => s + (t.all_device || 0), 0);
        const totalTasks = tickets.filter(t => !t.parent_id).length; // root tasks only

        // Build day-by-day log sum map
        const dayLogMap = new Map<string, number>();
        for (const l of quantityLogs) {
            const d = l.log_date.slice(0, 10);
            dayLogMap.set(d, (dayLogMap.get(d) || 0) + l.quantity);
        }

        // Count tickets completed (status=total) per day — approximate: use today for all 'total' tickets
        // Better: we count current completed
        // (used implicitly via totalWork / useDeviceMode branch)

        // Build data points
        const points: { date: string; label: string; ideal: number; actual: number; cumActual: number; cumIdeal: number }[] = [];
        const start = new Date(minD);
        const end = new Date(endDate);
        const totalDays = Math.ceil((end.getTime() - start.getTime()) / 86400000) + 1;
        let cumActual = 0;

        const useDeviceMode = totalAllDevice > 0;
        const totalWork = useDeviceMode ? totalAllDevice : totalTasks;

        for (let i = 0; i < totalDays; i++) {
            const d = new Date(start);
            d.setDate(d.getDate() + i);
            const ds = d.toISOString().slice(0, 10);
            const label = dayjs(ds).format('D/M');

            // Ideal: linear from totalWork to 0 (burn-down)
            const idealRemaining = Math.max(0, Math.round(totalWork - (totalWork * (i / Math.max(1, totalDays - 1)))));
            const idealCum = totalWork - idealRemaining;

            // Actual: accumulated from logs
            const dayQty = dayLogMap.get(ds) || 0;
            cumActual += dayQty;
            const actualRemaining = Math.max(0, totalWork - cumActual);

            // Only show actual up to today
            if (ds <= today) {
                points.push({ date: ds, label, ideal: idealRemaining, actual: actualRemaining, cumActual, cumIdeal: idealCum });
            } else {
                points.push({ date: ds, label, ideal: idealRemaining, actual: NaN, cumActual: NaN, cumIdeal: idealCum });
            }
        }
        return points;
    }, [tickets, quantityLogs]);

    // ── Efficiency data ──────────────────────────────────────
    const efficiencyData = useMemo(() => {
        // Group logs by assignee
        const ticketMap = new Map<string, PmTicket>();
        for (const t of tickets) ticketMap.set(t.id, t);

        const assigneeMap = new Map<string, { name: string; totalQty: number; days: Set<string> }>();
        for (const l of quantityLogs) {
            const ticket = ticketMap.get(l.ticket_id);
            if (!ticket?.assignee_id || !ticket.assignee_name) continue;
            const key = ticket.assignee_id;
            if (!assigneeMap.has(key)) {
                assigneeMap.set(key, { name: ticket.assignee_name.split(' ')[0], totalQty: 0, days: new Set() });
            }
            const entry = assigneeMap.get(key)!;
            entry.totalQty += l.quantity;
            entry.days.add(l.log_date.slice(0, 10));
        }

        return Array.from(assigneeMap.values()).map(e => ({
            name: e.name,
            total: e.totalQty,
            avgPerDay: e.days.size > 0 ? Math.round(e.totalQty / e.days.size) : 0,
            workDays: e.days.size,
        })).sort((a, b) => b.avgPerDay - a.avgPerDay);
    }, [tickets, quantityLogs]);

    if (chartData.length === 0 && efficiencyData.length === 0) {
        return <div className="text-center py-16 text-sm" style={{ color: 'var(--color-text-tertiary)' }}>ยังไม่มีข้อมูลเพียงพอสำหรับแสดงกราฟ</div>;
    }

    return (
        <div className="space-y-6">
            {/* ── Burn-down Chart ── */}
            {chartData.length > 0 && (
                <div className="rounded-2xl p-5" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
                    <div className="flex items-center gap-2 mb-4">
                        <TrendingDown className="w-4 h-4" style={{ color: '#EF4444' }} />
                        <h3 className="text-sm font-bold" style={{ color: 'var(--color-text-primary)' }}>Burn-down Chart</h3>
                        <span className="text-[10px] ml-2" style={{ color: 'var(--color-text-tertiary)' }}>แผนที่วางไว้ vs สิ่งที่ทำจริง — ดูว่าโปรเจกต์จะเสร็จทันกำหนดไหม</span>
                    </div>
                    <ResponsiveContainer width="100%" height={280}>
                        <LineChart data={chartData} margin={{ top: 5, right: 20, bottom: 5, left: 0 }}>
                            <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
                            <XAxis dataKey="label" tick={{ fontSize: 10, fill: 'var(--color-text-tertiary)' }} interval={Math.max(0, Math.floor(chartData.length / 15))} />
                            <YAxis tick={{ fontSize: 10, fill: 'var(--color-text-tertiary)' }} />
                            <ReTooltip contentStyle={{ fontSize: 11, borderRadius: 12, background: 'var(--color-surface)', border: '1px solid var(--color-border)' }} />
                            <Legend wrapperStyle={{ fontSize: 11 }} />
                            <Line type="monotone" dataKey="ideal" stroke="#94A3B8" strokeDasharray="5 5" name="แผนที่วางไว้" dot={false} strokeWidth={2} />
                            <Line type="monotone" dataKey="actual" stroke="#EF4444" name="งานคงเหลือจริง" dot={false} strokeWidth={2} connectNulls={false} />
                        </LineChart>
                    </ResponsiveContainer>
                </div>
            )}

            {/* ── S-Curve ── */}
            {chartData.length > 0 && (
                <div className="rounded-2xl p-5" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
                    <div className="flex items-center gap-2 mb-4">
                        <Activity className="w-4 h-4" style={{ color: '#2563EB' }} />
                        <h3 className="text-sm font-bold" style={{ color: 'var(--color-text-primary)' }}>S-Curve</h3>
                        <span className="text-[10px] ml-2" style={{ color: 'var(--color-text-tertiary)' }}>การสะสมของงานเทียบกับเวลา — ช่วงงานชุก vs ช่วงล่าช้า</span>
                    </div>
                    <ResponsiveContainer width="100%" height={280}>
                        <AreaChart data={chartData} margin={{ top: 5, right: 20, bottom: 5, left: 0 }}>
                            <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
                            <XAxis dataKey="label" tick={{ fontSize: 10, fill: 'var(--color-text-tertiary)' }} interval={Math.max(0, Math.floor(chartData.length / 15))} />
                            <YAxis tick={{ fontSize: 10, fill: 'var(--color-text-tertiary)' }} />
                            <ReTooltip contentStyle={{ fontSize: 11, borderRadius: 12, background: 'var(--color-surface)', border: '1px solid var(--color-border)' }} />
                            <Legend wrapperStyle={{ fontSize: 11 }} />
                            <Area type="monotone" dataKey="cumIdeal" stroke="#94A3B8" fill="#94A3B820" strokeDasharray="5 5" name="แผนสะสม (Ideal)" strokeWidth={2} />
                            <Area type="monotone" dataKey="cumActual" stroke="#2563EB" fill="#2563EB20" name="งานสะสมจริง (Actual)" strokeWidth={2} connectNulls={false} />
                        </AreaChart>
                    </ResponsiveContainer>
                </div>
            )}

            {/* ── Efficiency Report ── */}
            {efficiencyData.length > 0 && (
                <div className="rounded-2xl p-5" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
                    <div className="flex items-center gap-2 mb-4">
                        <Users className="w-4 h-4" style={{ color: '#10B981' }} />
                        <h3 className="text-sm font-bold" style={{ color: 'var(--color-text-primary)' }}>Efficiency Report</h3>
                        <span className="text-[10px] ml-2" style={{ color: 'var(--color-text-tertiary)' }}>ค่าเฉลี่ยจำนวนที่แต่ละคนทำได้ต่อวัน — ใช้วางแผนโปรเจกต์ถัดไป</span>
                    </div>
                    <ResponsiveContainer width="100%" height={Math.max(200, efficiencyData.length * 50 + 40)}>
                        <BarChart data={efficiencyData} layout="vertical" margin={{ top: 5, right: 30, bottom: 5, left: 10 }}>
                            <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
                            <XAxis type="number" tick={{ fontSize: 10, fill: 'var(--color-text-tertiary)' }} />
                            <YAxis type="category" dataKey="name" tick={{ fontSize: 11, fill: 'var(--color-text-primary)' }} width={80} />
                            <ReTooltip formatter={(val: unknown, name: unknown) => [val as import('react').ReactNode, name === 'avgPerDay' ? 'เฉลี่ย/วัน' : name === 'total' ? 'รวม' : String(name)] as [import('react').ReactNode, string]}
                                contentStyle={{ fontSize: 11, borderRadius: 12, background: 'var(--color-surface)', border: '1px solid var(--color-border)' }} />
                            <Legend wrapperStyle={{ fontSize: 11 }} />
                            <Bar dataKey="avgPerDay" name="เฉลี่ย/วัน" radius={[0, 6, 6, 0]}>
                                {efficiencyData.map((_, i) => (
                                    <Cell key={i} fill={AVATAR_COLORS[i % AVATAR_COLORS.length]} />
                                ))}
                            </Bar>
                        </BarChart>
                    </ResponsiveContainer>

                    {/* Detail table */}
                    <div className="mt-4 overflow-x-auto">
                        <table className="w-full text-[12px]">
                            <thead>
                                <tr style={{ borderBottom: '1px solid var(--color-border)' }}>
                                    <th className="text-left py-2 px-2 font-bold" style={{ color: 'var(--color-text-secondary)' }}>พนักงาน</th>
                                    <th className="text-right py-2 px-2 font-bold" style={{ color: 'var(--color-text-secondary)' }}>จำนวนวันที่ทำ</th>
                                    <th className="text-right py-2 px-2 font-bold" style={{ color: 'var(--color-text-secondary)' }}>จำนวนรวม</th>
                                    <th className="text-right py-2 px-2 font-bold" style={{ color: 'var(--color-text-secondary)' }}>เฉลี่ย/วัน</th>
                                </tr>
                            </thead>
                            <tbody>
                                {efficiencyData.map((e, i) => (
                                    <tr key={i} style={{ borderBottom: '1px solid var(--color-border)' }}>
                                        <td className="py-2 px-2 font-medium" style={{ color: 'var(--color-text-primary)' }}>{e.name}</td>
                                        <td className="py-2 px-2 text-right" style={{ color: 'var(--color-text-secondary)' }}>{e.workDays} วัน</td>
                                        <td className="py-2 px-2 text-right font-bold" style={{ color: '#2563EB' }}>{e.total.toLocaleString()}</td>
                                        <td className="py-2 px-2 text-right font-bold" style={{ color: '#10B981' }}>{e.avgPerDay.toLocaleString()}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}

            {/* ── Workload Heatmap ── */}
            {(() => {
                const assigneeTickets = new Map<string, { name: string; todo: number; progress: number; pending: number; total: number }>();
                for (const t of tickets) {
                    if (!t.assignee_id || !t.assignee_name) continue;
                    if (!assigneeTickets.has(t.assignee_id)) assigneeTickets.set(t.assignee_id, { name: t.assignee_name.split(' ')[0], todo: 0, progress: 0, pending: 0, total: 0 });
                    const e = assigneeTickets.get(t.assignee_id)!;
                    if (t.status === 'todo') e.todo++;
                    else if (t.status === 'progress') e.progress++;
                    else if (t.status === 'pending') e.pending++;
                    else if (t.status === 'total') e.total++;
                }
                const heatData = Array.from(assigneeTickets.values()).sort((a, b) => (b.todo + b.progress + b.pending) - (a.todo + a.progress + a.pending));
                if (heatData.length === 0) return null;
                return (
                    <div className="rounded-2xl p-5" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
                        <div className="flex items-center gap-2 mb-4">
                            <Flame className="w-4 h-4" style={{ color: '#F59E0B' }} />
                            <h3 className="text-sm font-bold" style={{ color: 'var(--color-text-primary)' }}>Workload Heatmap</h3>
                            <span className="text-[10px] ml-2" style={{ color: 'var(--color-text-tertiary)' }}>จำนวน Ticket ที่แต่ละคนรับผิดชอบ แยกตามสถานะ</span>
                        </div>
                        <ResponsiveContainer width="100%" height={Math.max(200, heatData.length * 45 + 40)}>
                            <BarChart data={heatData} layout="vertical" margin={{ top: 5, right: 30, bottom: 5, left: 10 }}>
                                <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
                                <XAxis type="number" tick={{ fontSize: 10, fill: 'var(--color-text-tertiary)' }} />
                                <YAxis type="category" dataKey="name" tick={{ fontSize: 11, fill: 'var(--color-text-primary)' }} width={80} />
                                <ReTooltip contentStyle={{ fontSize: 11, borderRadius: 12, background: 'var(--color-surface)', border: '1px solid var(--color-border)' }} />
                                <Legend wrapperStyle={{ fontSize: 11 }} />
                                <Bar dataKey="todo" name="รอดำเนินการ" stackId="a" fill="#94A3B8" radius={0} />
                                <Bar dataKey="progress" name="กำลังทำ" stackId="a" fill="#3B82F6" radius={0} />
                                <Bar dataKey="pending" name="ติดปัญหา" stackId="a" fill="#F59E0B" radius={0} />
                                <Bar dataKey="total" name="เสร็จ" stackId="a" fill="#10B981" radius={[0, 6, 6, 0]} />
                            </BarChart>
                        </ResponsiveContainer>
                    </div>
                );
            })()}

            {/* ── Forecast Completion ── */}
            {(() => {
                const totalAllDevice = tickets.reduce((s, t) => s + (t.all_device || 0), 0);
                if (totalAllDevice === 0 || quantityLogs.length === 0) return null;

                const sortedLogs = [...quantityLogs].sort((a, b) => a.log_date.localeCompare(b.log_date));
                const totalDone = quantityLogs.reduce((s, l) => s + l.quantity, 0);
                const remaining = totalAllDevice - totalDone;
                if (remaining <= 0) return (
                    <div className="rounded-2xl p-5" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
                        <div className="flex items-center gap-2 mb-2">
                            <Target className="w-4 h-4" style={{ color: '#10B981' }} />
                            <h3 className="text-sm font-bold" style={{ color: 'var(--color-text-primary)' }}>Forecast Completion</h3>
                        </div>
                        <p className="text-sm font-bold" style={{ color: '#10B981' }}>✅ งานทั้งหมดเสร็จสมบูรณ์แล้ว ({totalDone.toLocaleString()} / {totalAllDevice.toLocaleString()})</p>
                    </div>
                );

                // Calculate velocity: avg quantity per working-day
                const dayMap = new Map<string, number>();
                for (const l of sortedLogs) { const d = l.log_date.slice(0, 10); dayMap.set(d, (dayMap.get(d) || 0) + l.quantity); }
                const workingDays = dayMap.size;
                const velocity = workingDays > 0 ? totalDone / workingDays : 0;
                const daysNeeded = velocity > 0 ? Math.ceil(remaining / velocity) : null;

                const today = new Date();
                const forecastDate = daysNeeded ? new Date(today.getTime() + daysNeeded * 86400000) : null;

                // Check against plan_end
                const planEnds = tickets.filter(t => t.plan_end).map(t => t.plan_end!).sort();
                const latestPlanEnd = planEnds.length > 0 ? planEnds[planEnds.length - 1] : null;
                const isOverdue = forecastDate && latestPlanEnd ? forecastDate.toISOString().slice(0, 10) > latestPlanEnd : null;

                return (
                    <div className="rounded-2xl p-5" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
                        <div className="flex items-center gap-2 mb-4">
                            <Target className="w-4 h-4" style={{ color: '#6366F1' }} />
                            <h3 className="text-sm font-bold" style={{ color: 'var(--color-text-primary)' }}>Forecast Completion</h3>
                            <span className="text-[10px] ml-2" style={{ color: 'var(--color-text-tertiary)' }}>คาดการณ์วันเสร็จจาก Velocity เฉลี่ย</span>
                        </div>
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                            <div className="text-center p-3 rounded-xl" style={{ background: 'var(--color-surface-2)' }}>
                                <div className="text-[10px] mb-1" style={{ color: 'var(--color-text-tertiary)' }}>ทำไปแล้ว</div>
                                <div className="text-lg font-black" style={{ color: '#2563EB' }}>{totalDone.toLocaleString()}</div>
                                <div className="text-[10px]" style={{ color: 'var(--color-text-tertiary)' }}>/ {totalAllDevice.toLocaleString()}</div>
                            </div>
                            <div className="text-center p-3 rounded-xl" style={{ background: 'var(--color-surface-2)' }}>
                                <div className="text-[10px] mb-1" style={{ color: 'var(--color-text-tertiary)' }}>คงเหลือ</div>
                                <div className="text-lg font-black" style={{ color: '#EF4444' }}>{remaining.toLocaleString()}</div>
                                <div className="text-[10px]" style={{ color: 'var(--color-text-tertiary)' }}>{Math.round((totalDone / totalAllDevice) * 100)}% เสร็จ</div>
                            </div>
                            <div className="text-center p-3 rounded-xl" style={{ background: 'var(--color-surface-2)' }}>
                                <div className="text-[10px] mb-1" style={{ color: 'var(--color-text-tertiary)' }}>Velocity เฉลี่ย</div>
                                <div className="text-lg font-black" style={{ color: '#10B981' }}>{Math.round(velocity).toLocaleString()}</div>
                                <div className="text-[10px]" style={{ color: 'var(--color-text-tertiary)' }}>ต่อวันทำงาน</div>
                            </div>
                            <div className="text-center p-3 rounded-xl" style={{ background: isOverdue ? '#FEF2F2' : 'var(--color-surface-2)' }}>
                                <div className="text-[10px] mb-1" style={{ color: 'var(--color-text-tertiary)' }}>คาดว่าเสร็จ</div>
                                <div className="text-lg font-black" style={{ color: isOverdue ? '#EF4444' : '#10B981' }}>
                                    {forecastDate ? dayjs(forecastDate).format('D MMM') : '—'}
                                </div>
                                <div className="text-[10px]" style={{ color: isOverdue ? '#EF4444' : 'var(--color-text-tertiary)' }}>
                                    {isOverdue ? '⚠️ เลยกำหนด' : latestPlanEnd ? '✅ ทันกำหนด' : `อีก ${daysNeeded} วัน`}
                                </div>
                            </div>
                        </div>
                    </div>
                );
            })()}
        </div>
    );
}

// ─── Main Page ────────────────────────────────────────────────────────────────
export default function ProjectManagement() {
    const { user } = useAuth();
    const { projectId: selProjectId } = useParams<{ projectId: string }>();
    const navigate = useNavigate();
    const [searchParams] = useSearchParams();
    const isViewOnly = searchParams.get('mode') === 'view';

    const [projects,     setProjects]     = useState<PmProject[]>([]);
    const [tickets,      setTickets]      = useState<PmTicket[]>([]);
    const [milestones,   setMilestones]   = useState<PmMilestone[]>([]);
    const [sprints,      setSprints]      = useState<PmSprint[]>([]);
    const [dependencies, setDependencies] = useState<PmDependency[]>([]);
    const [quantityLogs, setQuantityLogs] = useState<PmQuantityLog[]>([]);
    const [users,        setUsers]        = useState<PlatformUser[]>([]);
    const [loading,      setLoading]      = useState(true);
    const [view,         setView]         = useState<'kanban' | 'gantt' | 'analytics'>('kanban');
    const [ticketModal,  setTicketModal]  = useState<Partial<PmTicket> | null>(null);
    const [activeId,     setActiveId]     = useState<string | null>(null);
    const [showSettings, setShowSettings] = useState(false);
    const [newMilestoneName, setNewMilestoneName] = useState('');
    const [newMilestoneDue,  setNewMilestoneDue]  = useState('');
    const [newSprintName,    setNewSprintName]    = useState('');
    const [newSprintStart,   setNewSprintStart]   = useState('');
    const [newSprintEnd,     setNewSprintEnd]     = useState('');
    const [confirmDialog, setConfirmDialog] = useState<{ title: string; message: string; onConfirm: () => void } | null>(null);
    const [toasts, setToasts] = useState<{ id: string; type: 'success' | 'error' | 'info'; message: string }[]>([]);

    const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }));

    const addToast = useCallback((type: 'success' | 'error' | 'info', message: string) => {
        const id = Date.now().toString();
        setToasts(prev => [...prev, { id, type, message }]);
        setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 3000);
    }, []);

    // ── Load projects ─────────────────────────────────────────────────────────
    const loadProjects = useCallback(async () => {
        try {
            const [prjs, usrs] = await Promise.all([
                api<PmProject[]>('/api/pm/projects'),
                api<PlatformUser[]>('/api/users'),
            ]);
            setProjects(prjs); setUsers(usrs);
        } catch (e) { console.error(e); }
    }, []);

    useEffect(() => { loadProjects(); }, [loadProjects]);

    // ── Load project data ─────────────────────────────────────────────────────
    const loadProjectData = useCallback(async () => {
        if (!selProjectId) { setLoading(false); return; }
        setLoading(true);
        try {
            const [t, m, s, d, q] = await Promise.all([
                api<PmTicket[]>(`/api/pm/projects/${selProjectId}/tickets`),
                api<PmMilestone[]>(`/api/pm/projects/${selProjectId}/milestones`),
                api<PmSprint[]>(`/api/pm/projects/${selProjectId}/sprints`),
                api<PmDependency[]>(`/api/pm/projects/${selProjectId}/dependencies`),
                api<PmQuantityLog[]>(`/api/pm/projects/${selProjectId}/quantity-logs`),
            ]);
            setTickets(t); setMilestones(m); setSprints(s); setDependencies(d); setQuantityLogs(q);
        } catch (e) { console.error(e); }
        setLoading(false);
    }, [selProjectId]);

    useEffect(() => { loadProjectData(); }, [loadProjectData]);

    const refreshQuantityLogs = useCallback(async () => {
        if (!selProjectId) return;
        try {
            const q = await api<PmQuantityLog[]>(`/api/pm/projects/${selProjectId}/quantity-logs`);
            setQuantityLogs(q);
        } catch { /* ignore */ }
    }, [selProjectId]);

    // ── CRUD ──────────────────────────────────────────────────────────────────
    const saveTicket = async (data: Partial<PmTicket>) => {
        const payload = { ...data, updated_by: user?.sub, updated_by_name: user?.name };
        if (data.id) {
            await api(`/api/pm/tickets/${data.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
        } else {
            await api('/api/pm/tickets', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...payload, project_id: selProjectId, created_by: user?.sub }) });
        }
        // Update project's updated_by
        if (selProjectId) {
            api(`/api/pm/projects/${selProjectId}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ updated_by: user?.sub }) }).catch(() => {});
        }
        setTicketModal(null);
        await loadProjectData();
    };

    const deleteTicket = (id: string) => {
        setConfirmDialog({
            title: 'ลบ Ticket', message: 'ต้องการลบ Ticket นี้?',
            onConfirm: async () => {
                setConfirmDialog(null);
                try { await api(`/api/pm/tickets/${id}`, { method: 'DELETE' }); setTicketModal(null); await loadProjectData(); addToast('success', 'ลบ Ticket แล้ว'); }
                catch { addToast('error', 'ลบ Ticket ไม่สำเร็จ'); }
            },
        });
    };

    const createMilestone = async () => {
        if (!newMilestoneName.trim() || !selProjectId) return;
        await api(`/api/pm/projects/${selProjectId}/milestones`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: newMilestoneName.trim(), due_date: newMilestoneDue || null }) });
        setNewMilestoneName(''); setNewMilestoneDue(''); await loadProjectData();
    };

    const deleteMilestone = (id: string) => {
        setConfirmDialog({
            title: 'ลบ Milestone', message: 'ลบ Milestone นี้?',
            onConfirm: async () => { setConfirmDialog(null); try { await api(`/api/pm/milestones/${id}`, { method: 'DELETE' }); await loadProjectData(); addToast('success', 'ลบ Milestone แล้ว'); } catch { addToast('error', 'ลบ Milestone ไม่สำเร็จ'); } },
        });
    };

    const createSprint = async () => {
        if (!newSprintName.trim() || !selProjectId) return;
        await api(`/api/pm/projects/${selProjectId}/sprints`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: newSprintName.trim(), start_date: newSprintStart || null, end_date: newSprintEnd || null }) });
        setNewSprintName(''); setNewSprintStart(''); setNewSprintEnd(''); await loadProjectData();
    };

    const deleteSprint = (id: string) => {
        setConfirmDialog({
            title: 'ลบ Sprint', message: 'ลบ Sprint นี้?',
            onConfirm: async () => { setConfirmDialog(null); try { await api(`/api/pm/sprints/${id}`, { method: 'DELETE' }); await loadProjectData(); addToast('success', 'ลบ Sprint แล้ว'); } catch { addToast('error', 'ลบ Sprint ไม่สำเร็จ'); } },
        });
    };

    // ── Kanban DnD ────────────────────────────────────────────────────────────
    const handleDragStart = (e: DragStartEvent) => { setActiveId(String(e.active.id)); };
    const handleDragEnd = async (e: DragEndEvent) => {
        setActiveId(null);
        const { active, over } = e;
        if (!over) return;
        const overId = String(over.id);
        if (!overId.startsWith('col_')) return;
        const newStatus = overId.replace('col_', '');
        const ticketId = String(active.id);
        const ticket = tickets.find(t => t.id === ticketId);
        if (!ticket || ticket.status === newStatus) return;
        setTickets(prev => prev.map(t => t.id === ticketId ? { ...t, status: newStatus } : t));
        await api(`/api/pm/tickets/${ticketId}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: newStatus }) });
    };

    // ── Gantt ticket date update ──────────────────────────────────────────────
    const updateTicketDates = useCallback(async (id: string, data: Partial<PmTicket>) => {
        try {
            await api(`/api/pm/tickets/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
            await loadProjectData();
            addToast('success', 'อัพเดทวันที่แล้ว');
        } catch { addToast('error', 'อัพเดทวันที่ไม่สำเร็จ'); }
    }, [loadProjectData, addToast]);

    // ── Derived data ──────────────────────────────────────────────────────────
    const activeTicket = activeId ? tickets.find(t => t.id === activeId) : null;
    const selectedProject = projects.find(p => p.id === selProjectId);

    // Stats with quantity calculation
    const totalTickets = tickets.length;
    const totalAllDevice = tickets.reduce((s, t) => s + (t.all_device || 0), 0);
    const totalQtyDone = quantityLogs.reduce((s, l) => s + l.quantity, 0);
    const totalPending = Math.max(0, totalAllDevice - totalQtyDone);
    const overallProgress = totalAllDevice > 0 ? Math.round((totalQtyDone / totalAllDevice) * 100) : (totalTickets > 0 ? Math.round(tickets.reduce((s, t) => s + (t.progress || 0), 0) / totalTickets) : 0);
    const startCount = tickets.filter(t => t.status === 'start').length;
    const inProgressCount = tickets.filter(t => t.status === 'in_progress').length;
    const totalCount = tickets.filter(t => t.status === 'total').length;

    if (loading && projects.length === 0) {
        return (
            <div className="flex items-center justify-center py-32">
                <RefreshCw className="w-6 h-6 animate-spin" style={{ color: 'var(--color-text-tertiary)' }} />
                <span className="ml-3 text-sm" style={{ color: 'var(--color-text-tertiary)' }}>กำลังโหลด...</span>
            </div>
        );
    }

    if (!selProjectId) {
        return (
            <div className="text-center py-20">
                <FolderKanban className="w-12 h-12 mx-auto mb-4" style={{ color: 'var(--color-text-tertiary)' }} />
                <p className="text-sm font-semibold" style={{ color: 'var(--color-text-secondary)' }}>ไม่พบโปรเจกต์</p>
                <button className="btn btn-primary mt-4" onClick={() => navigate('/pm')}>กลับหน้ารายการ</button>
            </div>
        );
    }

    return (
        <div className="space-y-5">
            {/* ── Header ── */}
            <div className="flex items-center justify-between flex-wrap gap-4">
                <div className="flex items-center gap-3">
                    <button onClick={() => navigate('/pm')} className="btn-icon" title="กลับหน้ารายการโปรเจกต์">
                        <ArrowLeft className="w-5 h-5" style={{ color: 'var(--color-text-secondary)' }} />
                    </button>
                    <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
                        style={{ background: selectedProject?.color ? selectedProject.color + '18' : 'var(--color-primary-soft)' }}>
                        <FolderKanban className="w-5 h-5" style={{ color: selectedProject?.color ?? 'var(--color-primary)' }} />
                    </div>
                    <div className="min-w-0">
                        <h1 className="text-lg font-bold truncate" style={{ color: 'var(--color-text-primary)' }}>
                            {selectedProject?.name ?? 'วางแผนโครงการ'}
                        </h1>
                        <p className="text-[12px]" style={{ color: 'var(--color-text-tertiary)' }}>
                            {selectedProject ? 'Kanban · Gantt · Analytics' : 'เลือกโครงการเพื่อเปิดบอร์ด'}
                        </p>
                    </div>
                </div>
                <div className="flex items-center gap-3">
                    {totalTickets > 0 && (
                        <div className="flex items-center gap-4 mr-2">
                            <span className="text-[11px] font-semibold" style={{ color: 'var(--color-text-tertiary)' }}>{totalCount}/{totalTickets} เสร็จ</span>
                            <div className="w-24 h-1.5 rounded-full overflow-hidden" style={{ background: 'var(--color-border)' }}>
                                <div className="h-full rounded-full" style={{ width: `${totalTickets > 0 ? (totalCount / totalTickets * 100) : 0}%`, background: '#10B981' }} />
                            </div>
                        </div>
                    )}
                    {isViewOnly && (
                        <span className="flex items-center gap-1 px-2.5 py-1.5 rounded-xl text-[11px] font-bold" style={{ background: '#FFF7ED', color: '#EA580C', border: '1px solid #FDBA7440' }}>
                            <Eye className="w-3.5 h-3.5" /> View Only
                        </span>
                    )}
                    <div className="flex rounded-xl overflow-hidden" style={{ border: '1px solid var(--color-border)' }}>
                        {([
                            { key: 'kanban', icon: Kanban, label: 'Kanban' },
                            { key: 'gantt', icon: BarChart3, label: 'Gantt' },
                            { key: 'analytics', icon: Activity, label: 'Analytics' },
                        ] as const).map(v => (
                            <button key={v.key} onClick={() => setView(v.key as typeof view)}
                                className="flex items-center gap-1.5 px-3.5 py-2 text-[12px] font-semibold transition-colors"
                                style={{ background: view === v.key ? 'var(--color-primary)' : 'var(--color-surface)', color: view === v.key ? '#fff' : 'var(--color-text-secondary)' }}>
                                <v.icon className="w-3.5 h-3.5" />{v.label}
                            </button>
                        ))}
                    </div>
                    {selProjectId && !isViewOnly && (
                        <>
                            <button className="btn flex items-center gap-1.5" onClick={() => setShowSettings(v => !v)}
                                style={{ color: showSettings ? '#2563EB' : 'var(--color-text-secondary)' }}><Settings2 className="w-4 h-4" /></button>
                            <button className="btn btn-primary flex items-center gap-1.5" onClick={() => setTicketModal({ project_id: selProjectId })}>
                                <Plus className="w-4 h-4" /><span className="text-[13px]">Ticket ใหม่</span>
                            </button>
                        </>
                    )}
                </div>
            </div>

            {/* ── Project Selector ── */}
            <ProjectSelector projects={projects} selected={selProjectId ?? ''} onChange={id => navigate(`/pm/${id}`)} />

            {/* ── Sprint & Milestone Management Panel ── */}
            <AnimatePresence>
                {showSettings && selProjectId && (
                    <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.2 }} className="overflow-hidden">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 p-4 rounded-2xl" style={{ background: 'var(--color-surface-2)', border: '1px solid var(--color-border)' }}>
                            {/* Milestones */}
                            <div>
                                <p className="text-[12px] font-bold mb-2 flex items-center gap-1.5" style={{ color: '#F59E0B' }}><Target className="w-3.5 h-3.5" /> Milestones</p>
                                <div className="space-y-1.5 mb-2">
                                    {milestones.map(m => (
                                        <div key={m.id} className="flex items-center justify-between px-2.5 py-1.5 rounded-lg" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
                                            <div className="flex items-center gap-2">
                                                <div className="w-2.5 h-2.5 rounded-sm" style={{ background: m.color, transform: 'rotate(45deg)' }} />
                                                <span className="text-[12px] font-medium" style={{ color: 'var(--color-text-primary)' }}>{m.name}</span>
                                                {m.due_date && <span className="text-[10px]" style={{ color: 'var(--color-text-tertiary)' }}>{formatThaiDateShort(m.due_date)}</span>}
                                            </div>
                                            <button onClick={() => deleteMilestone(m.id)} className="btn-icon opacity-50 hover:opacity-100"><Trash2 className="w-3 h-3 text-red-400" /></button>
                                        </div>
                                    ))}
                                    {milestones.length === 0 && <p className="text-[11px] px-2" style={{ color: 'var(--color-text-tertiary)' }}>ยังไม่มี Milestone</p>}
                                </div>
                                <div className="flex items-center gap-2">
                                    <input className="field-input text-[12px] flex-1" placeholder="ชื่อ Milestone..." value={newMilestoneName} onChange={e => setNewMilestoneName(e.target.value)} />
                                    <div style={{ width: 150 }}><ThaiDatePicker value={newMilestoneDue || null} onChange={v => setNewMilestoneDue(v || '')} size="small" placeholder="วันครบกำหนด" /></div>
                                    <button className="btn btn-primary text-[11px] px-2 py-1" onClick={createMilestone} disabled={!newMilestoneName.trim()}>เพิ่ม</button>
                                </div>
                            </div>
                            {/* Sprints */}
                            <div>
                                <p className="text-[12px] font-bold mb-2 flex items-center gap-1.5" style={{ color: '#6366F1' }}><Zap className="w-3.5 h-3.5" /> Sprints</p>
                                <div className="space-y-1.5 mb-2">
                                    {sprints.map(s => (
                                        <div key={s.id} className="flex items-center justify-between px-2.5 py-1.5 rounded-lg" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
                                            <div className="flex items-center gap-2">
                                                <Zap className="w-3 h-3" style={{ color: '#6366F1' }} />
                                                <span className="text-[12px] font-medium" style={{ color: 'var(--color-text-primary)' }}>{s.name}</span>
                                                <span className="text-[10px]" style={{ color: 'var(--color-text-tertiary)' }}>{formatThaiDateShort(s.start_date)} → {formatThaiDateShort(s.end_date)}</span>
                                                <span className="text-[9px] font-bold px-1.5 py-0.5 rounded" style={{ background: s.status === 'active' ? '#ECFDF5' : '#F1F5F9', color: s.status === 'active' ? '#059669' : '#64748B' }}>{s.status}</span>
                                            </div>
                                            <button onClick={() => deleteSprint(s.id)} className="btn-icon opacity-50 hover:opacity-100"><Trash2 className="w-3 h-3 text-red-400" /></button>
                                        </div>
                                    ))}
                                    {sprints.length === 0 && <p className="text-[11px] px-2" style={{ color: 'var(--color-text-tertiary)' }}>ยังไม่มี Sprint</p>}
                                </div>
                                <div className="flex items-center gap-2">
                                    <input className="field-input text-[12px] flex-1" placeholder="ชื่อ Sprint..." value={newSprintName} onChange={e => setNewSprintName(e.target.value)} />
                                    <div style={{ width: 140 }}><ThaiDatePicker value={newSprintStart || null} onChange={v => setNewSprintStart(v || '')} size="small" placeholder="วันเริ่ม" /></div>
                                    <div style={{ width: 140 }}><ThaiDatePicker value={newSprintEnd || null} onChange={v => setNewSprintEnd(v || '')} size="small" placeholder="วันสิ้นสุด" /></div>
                                    <button className="btn btn-primary text-[11px] px-2 py-1" onClick={createSprint} disabled={!newSprintName.trim()}>เพิ่ม</button>
                                </div>
                            </div>
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>

            {/* ── Project Stats ── */}
            {!loading && selProjectId && totalTickets > 0 && (
                <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                    {[
                        { label: 'Tickets', value: `${totalTickets}`, sub: `Start: ${startCount} · In Progress: ${inProgressCount}`, color: '#2563EB', pct: null },
                        { label: 'All Device', value: `${totalAllDevice.toLocaleString()}`, sub: 'จำนวนเครื่องทั้งหมด', color: '#0EA5E9', pct: null },
                        { label: 'In Progress', value: `${totalQtyDone.toLocaleString()}`, sub: 'จำนวนที่ดำเนินการ', color: '#F59E0B', pct: totalAllDevice > 0 ? (totalQtyDone / totalAllDevice * 100) : null },
                        { label: 'Pending', value: `${totalPending.toLocaleString()}`, sub: 'จำนวนคงเหลือ', color: '#6366F1', pct: totalAllDevice > 0 ? (totalPending / totalAllDevice * 100) : null },
                        { label: 'Progress', value: `${overallProgress}%`, sub: 'ความคืบหน้า', color: '#10B981', pct: overallProgress },
                    ].map(s => (
                        <div key={s.label} className="rounded-xl p-3.5" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
                            <p className="text-[10px] font-bold uppercase tracking-wider mb-1" style={{ color: 'var(--color-text-tertiary)' }}>{s.label}</p>
                            <p className="text-[20px] font-black leading-none mb-1" style={{ color: s.color }}>{s.value}</p>
                            <p className="text-[11px] mb-2" style={{ color: 'var(--color-text-secondary)' }}>{s.sub}</p>
                            {s.pct !== null && s.pct !== undefined && (
                                <div className="w-full h-1.5 rounded-full overflow-hidden" style={{ background: 'var(--color-border)' }}>
                                    <div className="h-full rounded-full transition-all" style={{ width: `${Math.min(100, Math.max(0, s.pct))}%`, background: s.color }} />
                                </div>
                            )}
                        </div>
                    ))}
                </div>
            )}

            {loading && <div className="flex items-center justify-center py-12"><RefreshCw className="w-5 h-5 animate-spin" style={{ color: 'var(--color-text-tertiary)' }} /></div>}

            {/* ── Content ── */}
            {!loading && selProjectId && (
                <>
                    {view === 'kanban' ? (
                        <DndContext sensors={isViewOnly ? [] : sensors} onDragStart={isViewOnly ? undefined : handleDragStart} onDragEnd={isViewOnly ? undefined : handleDragEnd}>
                            <div className="flex gap-3 overflow-x-auto pb-4">
                                {STATUSES.map(s => (
                                    <KanbanColumn key={s.key} status={s} tickets={tickets.filter(t => t.status === s.key)} quantityLogs={quantityLogs} onCardClick={t => setTicketModal(t)} isViewOnly={isViewOnly} />
                                ))}
                            </div>
                            <DragOverlay dropAnimation={null}>
                                {activeTicket && <div style={{ width: 300, opacity: 0.9 }}><KanbanCard ticket={activeTicket} quantityLogs={quantityLogs} onClick={() => {}} isViewOnly={isViewOnly} /></div>}
                            </DragOverlay>
                        </DndContext>
                    ) : view === 'gantt' ? (
                        <GanttChart tickets={tickets} milestones={milestones} dependencies={dependencies} quantityLogs={quantityLogs}
                            onTicketUpdate={updateTicketDates} onTicketClick={t => setTicketModal(t)}
                            onAddSubtask={parentId => setTicketModal({ project_id: selProjectId, parent_id: parentId })} isViewOnly={isViewOnly} />
                    ) : (
                        <AnalyticsView tickets={tickets} quantityLogs={quantityLogs} />
                    )}
                </>
            )}

            {/* Modals */}
            <AnimatePresence>
                {ticketModal && selProjectId && (
                    <TicketModal ticket={ticketModal} projectId={selProjectId} users={users} milestones={milestones} sprints={sprints}
                        allTickets={tickets} onSave={saveTicket} onClose={() => setTicketModal(null)} onDelete={deleteTicket} onRefreshLogs={refreshQuantityLogs}
                        isViewOnly={isViewOnly} currentUserSub={user?.sub ?? ''} />
                )}
            </AnimatePresence>
            <AnimatePresence>
                {confirmDialog && <ConfirmModal title={confirmDialog.title} message={confirmDialog.message} onConfirm={confirmDialog.onConfirm} onCancel={() => setConfirmDialog(null)} />}
            </AnimatePresence>
            <ToastContainer toasts={toasts} />
        </div>
    );
}
