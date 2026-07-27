import { confirmDialog } from '../components/ui/confirm';
import { toast } from 'sonner';
import { useState, useEffect, useRef, useCallback, Fragment, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { isHoliday, isWeekend, useHolidays } from '../lib/holidays';
import { motion, AnimatePresence } from 'framer-motion';
import {
    DndContext, DragOverlay, PointerSensor, useSensor, useSensors,
    type DragStartEvent,
} from '@dnd-kit/core';
import { useDraggable } from '@dnd-kit/core';
import { CSS } from '@dnd-kit/utilities';
import {
    Plus, Upload, X, ChevronLeft, ChevronRight,
    Building2, Trash2, Pencil, Eye, ExternalLink,
    GripVertical, RefreshCw, AlertCircle, MapPin, Package, FileText, Maximize2,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { isAdmin as roleIsAdmin } from '../lib/permissions';
import AttendanceTab from '../components/AttendanceTab';
import ReportModal from '../components/ReportModal';
import { openPreview } from '../lib/preview';
import { Modal } from '../components/ui/modal';
import PersonAvatar from '../components/ui/avatar/PersonAvatar';
import { avatarColor, initials } from '../lib/avatar';

// ─── Types ────────────────────────────────────────────────────────────────────
interface PlatformUser {
    sub: string;
    email: string;
    name: string;
    given_name: string;
    family_name: string;
    role: string;
    user_group?: string;
    visible?: boolean;
}

interface Project {
    id: string;
    name: string;
    logo_url: string | null;
    color: string;
    description: string;
    year?: number | null;
    status?: 'active' | 'closed' | 'archived' | null;
    start_date?: string | null;
    end_date?: string | null;
}

interface Assignment {
    id: string;
    project_id: string;
    project_name?: string;
    project_color?: string;
    project_logo_url?: string | null;
    title: string;
    site: string;
    assignee_id: string;
    assignee_name?: string;
    assignee_email?: string;
    status: 'in_progress' | 'done';
    task_role?: 'head' | 'sub';
    description: string;
}

interface TaskVisit {
    id: string;
    task_id: string | null;
    employee_id: string;
    visit_date: string;       // 'YYYY-MM-DD'
    site: string | null;
    notes: string | null;
    created_at: string;
    // joined fields from API:
    customer: string;
    task_status: string | null;
    product: string | null;
    project_color: string | null;
    logo_url: string | null;
    employee_name: string;
    employee_email: string;
}

// ─── Constants ────────────────────────────────────────────────────────────────
const PROJECT_COLORS = ['#2563EB','#6366F1','#0891B2','#0EA5E9','#10B981','#F59E0B','#EF4444','#14B8A6'];

const ROLE_META = {
    head: { label: 'Main',  bg: 'var(--color-primary-soft)', textColor: 'var(--color-primary)' },
    sub:  { label: 'Support',  bg: 'var(--color-surface-2)',     textColor: 'var(--color-text-secondary)' },
};



const TH_MONTHS_SHORT = ['ม.ค.','ก.พ.','มี.ค.','เม.ย.','พ.ค.','มิ.ย.','ก.ค.','ส.ค.','ก.ย.','ต.ค.','พ.ย.','ธ.ค.'];
const TH_DAYS_SHORT   = ['อา','จ','อ','พ','พฤ','ศ','ส'];
const TODAY    = new Date();
const fmt      = (d: Date) => d.toISOString().slice(0, 10);
const todayStr = fmt(TODAY);

// Avatars use the single app-wide source of truth so colours match every page.

// ─── Thai holidays ────────────────────────────────────────────────────────────

interface AttDot { employee_id: string; name: string; status: string; }

// ─── API helpers ──────────────────────────────────────────────────────────────
async function apiFetch<T>(path: string, opts?: RequestInit): Promise<T> {
    const res = await fetch(path, opts);
    if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
    if (res.status === 204) return undefined as T;
    return res.json();
}

// ─── Draggable assignment card ────────────────────────────────────────────────
function DraggableCard({ assignment, isAdmin, isMine, onEdit, onDelete }: {
    assignment: Assignment;
    isAdmin: boolean;
    isMine: boolean;
    onEdit: (a: Assignment) => void;
    onDelete: (id: string) => void;
}) {
    const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
        id: assignment.id,
        data: { assignment },
        disabled: !isMine,
    });

    const accentColor = assignment.project_color ?? '#2563EB';
    const R = ROLE_META[assignment.task_role ?? 'head'];

    return (
        <div
            ref={setNodeRef}
            style={{ transform: CSS.Translate.toString(transform), opacity: isDragging ? 0.4 : 1 }}
            className="group relative"
            {...attributes}
        >
            <a
                href="#"
                className="block"
                onClick={e => {
                    e.preventDefault();
                    if (isDragging) return;
                    openPreview('task', { id: assignment.id, fallback: `/tasks/view/${assignment.id}` });
                }}
            >
                {/* Left accent bar */}
                <div className="absolute left-0 top-0 bottom-0 w-1 rounded-full" style={{ background: accentColor }} />

                <div className="pl-4 pr-3 py-3.5 flex items-start gap-3">
                    {isMine && (
                        <div {...listeners} className="cursor-grab mt-0.5 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0"
                            style={{ color: 'var(--color-text-tertiary)', touchAction: 'none' }}
                            onClick={e => { e.preventDefault(); e.stopPropagation(); }}>
                            <GripVertical className="w-4 h-4" />
                        </div>
                    )}

                    <div className="flex-1 min-w-0">
                        {/* Row 1: Customer name + Role badge */}
                        <div className="flex items-start justify-between gap-2 mb-1.5">
                            <p className="text-[14px] font-bold leading-tight truncate" style={{ color: 'var(--color-text-primary)' }}>
                                {assignment.title}
                            </p>
                            <span className="flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full flex-shrink-0"
                                style={{ background: R.bg, color: R.textColor }}>
                                {R.label}
                            </span>
                        </div>

                        {/* Row 2: Product badge + Employee */}
                        <div className="flex items-center gap-2 flex-wrap mb-1.5">
                            {assignment.project_name && (
                                <span className="flex items-center gap-1.5 text-[10px] font-bold px-2 py-0.5 rounded-md"
                                    style={{ background: accentColor + '18', color: accentColor }}>
                                    {assignment.project_logo_url
                                        ? <img src={assignment.project_logo_url} alt={assignment.project_name}
                                               className="w-4 h-4 rounded object-contain flex-shrink-0"
                                               style={{ background: 'white', padding: '1px' }} />
                                        : null}
                                    {assignment.project_name}
                                </span>
                            )}
                            <div className="flex items-center gap-1.5">
                                <div className="w-5 h-5 rounded-full flex items-center justify-center text-[8px] font-black text-white flex-shrink-0"
                                    style={{ background: avatarColor(assignment.assignee_id) }}>
                                    {initials(assignment.assignee_name ?? assignment.assignee_id)}
                                </div>
                                <span className="text-[11px]" style={{ color: 'var(--color-text-secondary)' }}>
                                    {assignment.assignee_name ?? assignment.assignee_email ?? assignment.assignee_id}
                                </span>
                            </div>
                        </div>

                        {/* Row 3: Location */}
                        <p className="flex items-center gap-1.5 text-[11px] mb-1.5" style={{ color: 'var(--color-text-secondary)' }}>
                            <MapPin className="w-3 h-3 flex-shrink-0" style={{ color: '#F59E0B' }} />
                            {assignment.site
                                ? <span>{assignment.site}</span>
                                : <span style={{ color: 'var(--color-text-tertiary)' }}>ยังไม่ระบุสถานที่</span>}
                        </p>

                        {assignment.description && (
                            <p className="text-[11px] leading-relaxed" style={{ color: 'var(--color-text-tertiary)' }}>
                                {assignment.description}
                            </p>
                        )}
                    </div>

                    <div className="flex flex-col gap-1 opacity-60 group-hover:opacity-100 transition-opacity flex-shrink-0 mt-0.5">
                        <button className="btn-icon w-6 h-6 rounded-md" title="ดูรายละเอียด">
                            <Eye className="w-3 h-3" style={{ color: 'var(--color-primary)' }} />
                        </button>
                        {isAdmin && (
                            <>
                                <button onClick={e => { e.preventDefault(); e.stopPropagation(); onEdit(assignment); }} className="btn-icon w-6 h-6 rounded-md">
                                    <Pencil className="w-3 h-3" />
                                </button>
                                <button onClick={e => { e.preventDefault(); e.stopPropagation(); onDelete(assignment.id); }} className="btn-icon w-6 h-6 rounded-md">
                                    <Trash2 className="w-3 h-3" style={{ color: '#EF4444' }} />
                                </button>
                            </>
                        )}
                    </div>
                </div>
            </a>
        </div>
    );
}

// ─── Calendar Drop Cell ────────────────────────────────────────────────────────
// ─── Activity group (for calendar chip grouping) ─────────────────────────────
interface ActivityGroup {
    key:    string;
    label:  string;
    date:   string;
    visits: TaskVisit[];
}

function CalendarCell({ dateStr, cellVisits, isToday, onClick, attDots, onActivityClick }: {
    dateStr: string;
    cellVisits: TaskVisit[];
    isToday: boolean;
    onClick: (d: string) => void;
    attDots: AttDot[];
    onActivityClick: (g: ActivityGroup) => void;
}) {
    const d = new Date(dateStr + 'T12:00');
    const holiday = isHoliday(dateStr);
    const weekend = isWeekend(dateStr);
    const rest = holiday || weekend;

    // Group visits by notes text (or task_id as fallback) so same activity = 1 chip
    const groups = useMemo(() => {
        const map = new Map<string, ActivityGroup>();
        for (const v of cellVisits) {
            const noteKey = v.notes?.trim().toLowerCase() ?? '';
            const key     = noteKey.length > 0 ? `n:${noteKey}` : v.task_id ? `t:${v.task_id}` : `s:${v.id}`;
            const label   = v.notes?.trim() || v.product || v.customer || 'ออกพื้นที่';
            if (!map.has(key)) map.set(key, { key, label, date: dateStr, visits: [] });
            map.get(key)!.visits.push(v);
        }
        return [...map.values()];
    }, [cellVisits, dateStr]);

    return (
        <div
            onClick={() => onClick(dateStr)}
            className="rounded-xl p-2 min-h-[100px] transition-all cursor-pointer"
            style={{
                background: rest ? 'rgba(239,68,68,0.04)' : 'transparent',
                border: isToday ? '1.5px solid var(--color-primary)' : '1.5px solid transparent',
                position: 'relative',
                overflow: 'visible',
            }}
        >
            {/* Date number */}
            <div className="flex items-center justify-between mb-1.5">
                <p className="text-[11px] font-bold px-0.5"
                    style={{ color: isToday ? 'var(--color-primary)' : weekend ? '#EF4444' : 'var(--color-text-secondary)' }}>
                    {d.getDate()}
                </p>
                {holiday && (
                    <span className="text-[7px] font-bold px-1 py-0.5 rounded" style={{ background: '#FEE2E2', color: '#DC2626' }} title={holiday}>
                        หยุด
                    </span>
                )}
            </div>

            {/* Activity chips — grouped by notes/activity */}
            {groups.map(group => (
                <div
                    key={group.key}
                    className="mb-1"
                    onClick={e => { e.stopPropagation(); onActivityClick(group); }}
                >
                    <div
                        className="text-[10px] font-semibold px-1.5 py-1 rounded-md flex items-center gap-1 cursor-pointer hover:brightness-95 transition-all"
                        style={{ background: '#EEF2FF', color: '#1E40AF', overflow: 'hidden' }}
                    >
                        {/* Avatar stack */}
                        <div className="flex -space-x-1 flex-shrink-0">
                            {group.visits.slice(0, 2).map(v => (
                                <span key={v.id}
                                    className="w-3.5 h-3.5 rounded-full flex items-center justify-center text-[6px] font-black text-white ring-1 ring-white flex-shrink-0"
                                    style={{ background: avatarColor(v.employee_id) }}
                                >
                                    {initials(v.employee_name ?? v.employee_id).slice(0, 1)}
                                </span>
                            ))}
                        </div>
                        <span className="truncate flex-1 min-w-0">{group.label}</span>
                        {group.visits.length > 1 && (
                            <span className="text-[9px] font-bold flex-shrink-0 opacity-60">{group.visits.length}</span>
                        )}
                    </div>
                </div>
            ))}

            {/* Attendance dots */}
            {attDots.length > 0 && (
                <div className="flex gap-0.5 flex-wrap mt-1">
                    {attDots.map(dot => (
                        <span
                            key={dot.employee_id}
                            className="w-2 h-2 rounded-full flex-shrink-0"
                            style={{
                                background: dot.status === 'office' ? '#10B981'
                                    : dot.status === 'leave'  ? '#9CA3AF'
                                    : '#F59E0B',
                            }}
                            title={`${dot.name}: ${
                                dot.status === 'office' ? 'เข้าออฟฟิศ'
                                : dot.status === 'leave' ? 'ลางาน'
                                : 'ออกพื้นที่'
                            }`}
                        />
                    ))}
                </div>
            )}
        </div>
    );
}

// ─── Activity Detail Modal ───────────────────────────────────────────────────
function ActivityDetailModal({ group, onClose }: { group: ActivityGroup; onClose: () => void }) {
    const dateLabel = new Date(group.date + 'T12:00').toLocaleDateString('th-TH', {
        weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
    });
    return (
        <Modal isOpen onClose={onClose} showCloseButton={false} className="max-w-md w-full m-4 max-h-[80vh] flex flex-col">
                {/* Header */}
                <div className="flex items-center justify-between px-6 py-4 flex-shrink-0" style={{ borderBottom: '1px solid var(--color-border)' }}>
                    <div>
                        <p className="text-base font-bold leading-snug" style={{ color: 'var(--color-text-primary)' }}>
                            {group.label}
                        </p>
                        <p className="text-[11px] mt-0.5" style={{ color: 'var(--color-text-tertiary)' }}>
                            {dateLabel}
                        </p>
                    </div>
                    <div className="flex items-center gap-2">
                        <span className="text-[11px] font-bold px-2.5 py-1 rounded-full"
                            style={{ background: 'var(--color-surface-2)', color: 'var(--color-text-secondary)', border: '1px solid var(--color-border)' }}>
                            {group.visits.length} คน
                        </span>
                        <button onClick={onClose} className="btn-icon"><X className="w-4 h-4" /></button>
                    </div>
                </div>

                {/* Participant list */}
                <div className="p-4 space-y-2 overflow-y-auto flex-1">
                    {group.visits.map((v, i) => (
                        <motion.div
                            key={v.id}
                            initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }}
                            transition={{ delay: i * 0.04 }}
                            className="flex items-start gap-3 p-3 rounded-xl"
                            style={{ background: 'var(--color-surface-2)', border: '1px solid var(--color-border)' }}
                        >
                            <div className="w-9 h-9 rounded-full flex items-center justify-center text-[11px] font-bold text-white flex-shrink-0"
                                style={{ background: avatarColor(v.employee_id) }}>
                                {initials(v.employee_name ?? v.employee_id)}
                            </div>
                            <div className="flex-1 min-w-0">
                                <p className="text-[13px] font-semibold" style={{ color: 'var(--color-text-primary)' }}>
                                    {v.employee_name ?? v.employee_email}
                                </p>
                                <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-0.5">
                                    {v.product && (
                                        <p className="text-[11px] font-medium" style={{ color: 'var(--color-primary)' }}>
                                            {v.product}
                                        </p>
                                    )}
                                    {v.customer && (
                                        <p className="text-[11px]" style={{ color: 'var(--color-text-secondary)' }}>
                                            {v.customer}
                                        </p>
                                    )}
                                    {v.notes && v.notes.trim() !== group.label.trim() && (
                                        <p className="text-[11px]" style={{ color: 'var(--color-text-tertiary)' }}>
                                            {v.notes}
                                        </p>
                                    )}
                                </div>
                            </div>
                        </motion.div>
                    ))}
                    {group.visits.length === 0 && (
                        <p className="text-sm text-center py-8" style={{ color: 'var(--color-text-tertiary)' }}>ไม่มีข้อมูล</p>
                    )}
                </div>
        </Modal>
    );
}

// ─── Day Modal ────────────────────────────────────────────────────────────────
function DayModal({ dateStr, visitsOnDay, leaveRecords, allAssignments, allTaskVisits, isAdmin, users, projects, onRefresh, onClose }: {
    dateStr: string;
    visitsOnDay: TaskVisit[];
    leaveRecords: AttDot[];
    allAssignments: Assignment[];
    allTaskVisits: TaskVisit[];
    isAdmin: boolean;
    users: { sub: string; name: string; email: string }[];
    projects: { id: string; name: string; color: string | null }[];
    onRefresh: () => void;
    onClose: () => void;
}) {
    const { user: currentUser } = useAuth();
    const d = new Date(dateStr + 'T12:00');
    const dateLabel = d.toLocaleDateString('th-TH', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
    const holiday = isHoliday(dateStr);

    const [selProduct, setSelProduct] = useState<string>('');
    const [selUser,    setSelUser]    = useState<string>(currentUser?.sub ?? '');
    const [selTask,    setSelTask]    = useState<string>('');
    const [selNote,    setSelNote]    = useState<string>('');
    const [saving,     setSaving]     = useState(false);
    const [savingLeave, setSavingLeave] = useState(false);
    const [removing,   setRemoving]   = useState<string | null>(null);
    const [removingLeave, setRemovingLeave] = useState<string | null>(null);
    const [recordType, setRecordType] = useState<'visit' | 'leave'>('visit');
    const [showAll, setShowAll] = useState(false);

    // distinct product names from all projects
    const allProductNames = [...new Set(projects.map(p => p.name).filter(Boolean))];

    // filter tasks by product (show all tasks for the product, not filtered by user)
    const filteredTasks = allAssignments.filter(a => {
        const matchProd = selProduct ? (a.project_name ?? '') === selProduct : true;
        return matchProd;
    });

    // The raw task list repeats the same customer once per assignee, which floods
    // the picker with identical rows. Collapse to one entry per
    // (Product × customer) and group the options under their Product. When a
    // duplicate exists, prefer the task actually assigned to the selected user so
    // the visit still links to their own task.
    const taskOptionGroups = useMemo(() => {
        const unique = new Map<string, Assignment>();
        for (const a of filteredTasks) {
            const key = `${a.project_name ?? ''}||${(a.title ?? '').trim()}`;
            const existing = unique.get(key);
            const better = !existing || (!!selUser && a.assignee_id === selUser && existing.assignee_id !== selUser);
            if (better) unique.set(key, a);
        }
        const groups = new Map<string, Assignment[]>();
        for (const a of unique.values()) {
            const product = a.project_name || 'ไม่ระบุ Product';
            const list = groups.get(product);
            if (list) list.push(a); else groups.set(product, [a]);
        }
        return [...groups.entries()]
            .sort((x, y) => x[0].localeCompare(y[0], 'th'))
            .map(([product, list]) => ({
                product,
                tasks: list.sort((x, y) => (x.title ?? '').localeCompare(y.title ?? '', 'th')),
            }));
    }, [filteredTasks, selUser]);

    // Datalist suggestions for อื่นๆ — from historical visits filtered by product
    const noteSuggestions = [...new Set(
        allTaskVisits
            .filter(v => {
                if (!selProduct) return true;
                return (v.product ?? '') === selProduct;
            })
            .map(v => v.notes)
            .filter((n): n is string => !!n && n.trim() !== '')
    )].sort();

    const handleAdd = async () => {
        // Either a task must be selected OR a note must be provided (or both)
        if ((!selTask && !selNote.trim()) || !selUser) return;
        setSaving(true);
        try {
            // If a task is selected, get its site to pass along
            const selectedAssignment = selTask ? allAssignments.find(a => a.id === selTask) : null;
            await apiFetch('/api/task-visits', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    task_id:     selTask || undefined,
                    employee_id: selUser,
                    visit_date:  dateStr,
                    site:        selectedAssignment?.site || null,
                    notes:       selNote.trim() || null,
                    // save product label for notes-only visits (no task selected)
                    product:     (!selTask && selProduct) ? selProduct : undefined,
                }),
            });
            onRefresh();
            setSelTask('');
            setSelNote('');
        } catch (ex) {
            toast.error('บันทึกไม่สำเร็จ: ' + String(ex));
        } finally {
            setSaving(false);
        }
    };

    const handleLeave = async () => {
        if (!selUser) return;
        setSavingLeave(true);
        try {
            // Delete any existing task_visits for this employee on this date first
            const existingVisits = visitsOnDay.filter(v => v.employee_id === selUser);
            for (const v of existingVisits) {
                await apiFetch(`/api/task-visits/${v.id}`, { method: 'DELETE' });
            }
            await apiFetch('/api/attendance', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    employee_id: selUser,
                    date:        dateStr,
                    status:      'leave',
                }),
            });
            onRefresh();
        } catch (ex) {
            toast.error('บันทึกไม่สำเร็จ: ' + String(ex));
        } finally {
            setSavingLeave(false);
        }
    };

    const handleRemove = async (visitId: string) => {
        setRemoving(visitId);
        try {
            await apiFetch(`/api/task-visits/${visitId}`, { method: 'DELETE' });
            onRefresh();
        } catch (ex) {
            toast.error('ลบไม่สำเร็จ: ' + String(ex));
        } finally {
            setRemoving(null);
        }
    };

    const handleRemoveLeave = async (employeeId: string) => {
        setRemovingLeave(employeeId);
        try {
            await apiFetch(`/api/attendance?employee_id=${encodeURIComponent(employeeId)}&date=${dateStr}`, { method: 'DELETE' });
            onRefresh();
        } catch (ex) {
            toast.error('ลบไม่สำเร็จ: ' + String(ex));
        } finally {
            setRemovingLeave(null);
        }
    };

    // group visits by employee
    const byPerson = visitsOnDay.reduce<Record<string, TaskVisit[]>>((acc, v) => {
        (acc[v.employee_id] ??= []).push(v);
        return acc;
    }, {});

    // ── Reusable row renderers (shared by the day modal and the "view all" modal) ──
    const renderLeaveRow = (lr: AttDot) => {
        const canRemove = isAdmin || lr.employee_id === currentUser?.sub;
        return (
            <div key={lr.employee_id}
                className="flex items-center gap-2 px-3 py-2 rounded-xl mb-1.5"
                style={{ background: 'rgba(245,158,11,0.10)', border: '1px solid rgba(245,158,11,0.25)' }}
            >
                <div className="w-5 h-5 rounded-full flex items-center justify-center text-[8px] font-bold text-white flex-shrink-0"
                    style={{ background: avatarColor(lr.employee_id) }}>
                    {initials(lr.name ?? lr.employee_id)}
                </div>
                <div className="flex-1 min-w-0">
                    <p className="text-[12px] font-bold" style={{ color: 'var(--color-text-primary)' }}>{lr.name}</p>
                    <p className="text-[10px] font-semibold" style={{ color: '#F59E0B' }}>ลางาน</p>
                </div>
                {canRemove && (
                    <button
                        onClick={() => handleRemoveLeave(lr.employee_id)}
                        className="btn-icon w-6 h-6 rounded-md flex-shrink-0"
                        disabled={removingLeave === lr.employee_id}
                        title="ยกเลิกการลา"
                    >
                        {removingLeave === lr.employee_id
                            ? <div className="w-3 h-3 border border-current border-t-transparent rounded-full animate-spin" />
                            : <X className="w-3 h-3" style={{ color: '#EF4444' }} />}
                    </button>
                )}
            </div>
        );
    };

    const renderVisitRow = (v: TaskVisit) => {
        const canRemove = isAdmin || v.employee_id === currentUser?.sub;
        return (
            <div key={v.id}
                className="flex items-center gap-2 px-3 py-2 rounded-xl mb-1.5"
                style={{ background: 'var(--color-surface-2)', border: '1px solid var(--color-border)' }}
            >
                {/* Note-only vs task-linked icon */}
                {v.task_id === null ? (
                    <div className="w-5 h-5 rounded flex items-center justify-center flex-shrink-0"
                        style={{ background: '#F3F4F6' }}>
                        <FileText className="w-3 h-3" style={{ color: '#6B7280' }} />
                    </div>
                ) : v.logo_url ? (
                    <img src={v.logo_url} alt={v.product ?? ''} className="w-5 h-5 rounded object-contain flex-shrink-0" style={{ background: 'white', padding: '1px', boxShadow: `0 0 0 1px ${v.project_color ?? '#2563EB'}44` }} />
                ) : (
                    <Package className="w-3.5 h-3.5 flex-shrink-0" style={{ color: v.project_color ?? '#2563EB' }} />
                )}
                <div className="flex-1 min-w-0">
                    {v.task_id !== null && (
                        <p className="text-[12px] font-bold truncate" style={{ color: 'var(--color-text-primary)' }}>{v.customer}</p>
                    )}
                    {v.product && <p className="text-[10px] font-semibold" style={{ color: v.project_color ?? '#2563EB' }}>{v.product}</p>}
                    {v.notes && <p className="text-[11px] font-medium" style={{ color: v.task_id === null ? 'var(--color-text-primary)' : 'var(--color-text-tertiary)', fontStyle: v.task_id !== null ? 'italic' : 'normal' }}>{v.notes}</p>}
                    {v.site && <p className="text-[10px]" style={{ color: 'var(--color-text-tertiary)' }}><MapPin className="w-2.5 h-2.5 inline mr-0.5" />{v.site}</p>}
                </div>
                {canRemove && (
                    <button
                        onClick={() => handleRemove(v.id)}
                        className="btn-icon w-6 h-6 rounded-md flex-shrink-0"
                        disabled={removing === v.id}
                        title="ลบการเยี่ยมชม"
                    >
                        {removing === v.id
                            ? <div className="w-3 h-3 border border-current border-t-transparent rounded-full animate-spin" />
                            : <X className="w-3 h-3" style={{ color: '#EF4444' }} />}
                    </button>
                )}
            </div>
        );
    };

    const renderPersonGroup = (empId: string, visits: TaskVisit[]) => (
        <div key={empId} className="mb-3">
            <div className="flex items-center gap-2 mb-1.5 px-1">
                <div className="w-5 h-5 rounded-full flex items-center justify-center text-[8px] font-bold text-white flex-shrink-0"
                    style={{ background: avatarColor(empId) }}>
                    {initials(visits[0].employee_name ?? empId)}
                </div>
                <p className="text-[12px] font-bold" style={{ color: 'var(--color-text-secondary)' }}>
                    {visits[0].employee_name ?? visits[0].employee_email ?? empId}
                </p>
            </div>
            {visits.map(renderVisitRow)}
        </div>
    );

    return (
        <>
        <Modal isOpen onClose={onClose} showCloseButton={false} className="max-w-lg w-full m-4 max-h-[85vh] flex flex-col">
                {/* Header */}
                <div className="flex items-center justify-between px-6 py-4 flex-shrink-0" style={{ borderBottom: '1px solid var(--color-border)' }}>
                    <div>
                        <h3 className="text-base font-bold" style={{ color: 'var(--color-text-primary)' }}>บันทึกการออกพื้นที่</h3>
                        <p className="text-xs mt-0.5" style={{ color: 'var(--color-text-tertiary)' }}>
                            {dateLabel}{holiday && <span className="ml-2 text-[10px] font-bold px-1.5 py-0.5 rounded" style={{ background: '#FEE2E2', color: '#DC2626' }}>หยุด: {holiday}</span>}
                        </p>
                    </div>
                    <button onClick={onClose} className="btn-icon"><X className="w-4 h-4" /></button>
                </div>

                {/* Body */}
                <div className="overflow-y-auto flex-1 p-5 space-y-4">
                    {/* Quick-add panel */}
                    <div className="rounded-xl p-4 space-y-3" style={{ background: 'var(--color-surface-2)', border: '1px solid var(--color-border)' }}>
                        {/* Type toggle: ออกพื้นที่ / ลางาน */}
                        <div className="flex gap-1 p-0.5 rounded-lg" style={{ background: 'var(--color-surface)' }}>
                            {(['visit', 'leave'] as const).map(t => (
                                <button
                                    key={t}
                                    onClick={() => setRecordType(t)}
                                    className="flex-1 py-1.5 px-3 rounded-md text-[12px] font-semibold transition-all"
                                    style={recordType === t ? {
                                        background: t === 'leave' ? '#F59E0B' : 'var(--color-primary)',
                                        color: '#fff',
                                        boxShadow: `0 2px 8px ${t === 'leave' ? 'rgba(245,158,11,0.3)' : 'rgba(37, 99, 235,0.3)'}`,
                                    } : {
                                        color: 'var(--color-text-secondary)',
                                    }}
                                >
                                    {t === 'visit' ? 'ออกพื้นที่' : 'ลางาน'}
                                </button>
                            ))}
                        </div>

                        {recordType === 'visit' ? (
                            <>
                                <p className="text-[11px] font-black uppercase tracking-widest" style={{ color: 'var(--color-primary)' }}>
                                    เพิ่มการออกพื้นที่
                                </p>

                                {/* Step 1: Product filter */}
                                <div>
                                    <label className="text-[10px] font-semibold mb-1 block" style={{ color: 'var(--color-text-tertiary)' }}>1. กรอง Product (ไม่บังคับ)</label>
                                    <select className="field-input w-full text-[13px]" value={selProduct}
                                        onChange={e => { setSelProduct(e.target.value); setSelTask(''); }}>
                                        <option value="">— ทุก Product —</option>
                                        {allProductNames.map(name => (
                                            <option key={name} value={name}>{name}</option>
                                        ))}
                                    </select>
                                </div>

                                {/* Step 2: Employee — non-admins may only log their own work */}
                                <div>
                                    <label className="text-[10px] font-semibold mb-1 block" style={{ color: 'var(--color-text-tertiary)' }}>2. เลือกพนักงาน</label>
                                    <select className="field-input w-full text-[13px]" value={selUser}
                                        disabled={!isAdmin}
                                        onChange={e => { setSelUser(e.target.value); setSelTask(''); }}>
                                        <option value="">— เลือกพนักงาน —</option>
                                        {(isAdmin ? users : users.filter(u => u.sub === currentUser?.sub)).map(u => (
                                            <option key={u.sub} value={u.sub}>{u.name || u.email}</option>
                                        ))}
                                    </select>
                                    {!isAdmin && (
                                        <p className="text-[10px] mt-1" style={{ color: 'var(--color-text-tertiary)' }}>
                                            บันทึกได้เฉพาะงานของตัวเอง
                                        </p>
                                    )}
                                </div>

                                {/* Step 3: Task */}
                                <div>
                                    <label className="text-[10px] font-semibold mb-1 block" style={{ color: 'var(--color-text-tertiary)' }}>3. เลือกงาน (ลูกค้า)</label>
                                    <select className="field-input w-full text-[13px]" value={selTask} onChange={e => setSelTask(e.target.value)}>
                                        <option value="">— เลือกงาน —</option>
                                        {taskOptionGroups.map(({ product, tasks }) => (
                                            <optgroup key={product} label={product}>
                                                {tasks.map(a => (
                                                    <option key={a.id} value={a.id}>{a.title}</option>
                                                ))}
                                            </optgroup>
                                        ))}
                                    </select>
                                </div>

                                {/* Step 4: อื่นๆ (notes) */}
                                <datalist id="dm-notes">
                                    {noteSuggestions.map(n => <option key={n} value={n} />)}
                                </datalist>
                                <div>
                                    <label className="text-[10px] font-semibold mb-1 block" style={{ color: 'var(--color-text-tertiary)' }}>
                                        4. อื่นๆ (บันทึกกิจกรรม — ไม่บังคับ)
                                        {noteSuggestions.length > 0 && (
                                            <span className="ml-1 font-normal" style={{ color: 'var(--color-text-tertiary)' }}>
                                                — มี {noteSuggestions.length} รายการในระบบ
                                            </span>
                                        )}
                                    </label>
                                    <div className="flex gap-2">
                                        <input
                                            list="dm-notes"
                                            className="field-input flex-1 text-[13px]"
                                            value={selNote}
                                            onChange={e => setSelNote(e.target.value)}
                                            placeholder="เช่น ไป PoC ที่..., นำเสนอ Product, อบรม..."
                                            autoComplete="off"
                                        />
                                        <button
                                            className="btn btn-primary flex-shrink-0"
                                            onClick={handleAdd}
                                            disabled={(!selTask && !selNote.trim()) || !selUser || saving}
                                        >
                                            {saving ? '...' : 'เพิ่ม'}
                                        </button>
                                    </div>
                                </div>
                            </>
                        ) : (
                            <>
                                <p className="text-[11px] font-black uppercase tracking-widest" style={{ color: '#F59E0B' }}>
                                    บันทึกลางาน
                                </p>
                                {/* Employee selector — non-admins may only record their own leave */}
                                <div>
                                    <label className="text-[10px] font-semibold mb-1 block" style={{ color: 'var(--color-text-tertiary)' }}>เลือกพนักงาน</label>
                                    <select className="field-input w-full text-[13px]" value={selUser}
                                        disabled={!isAdmin}
                                        onChange={e => setSelUser(e.target.value)}>
                                        <option value="">— เลือกพนักงาน —</option>
                                        {(isAdmin ? users : users.filter(u => u.sub === currentUser?.sub)).map(u => (
                                            <option key={u.sub} value={u.sub}>{u.name || u.email}</option>
                                        ))}
                                    </select>
                                    {!isAdmin && (
                                        <p className="text-[10px] mt-1" style={{ color: 'var(--color-text-tertiary)' }}>
                                            บันทึกได้เฉพาะการลาของตัวเอง
                                        </p>
                                    )}
                                </div>
                                <p className="text-[11px]" style={{ color: 'var(--color-text-tertiary)' }}>
                                    เลือกพนักงานแล้วกดบันทึก ระบบจะบันทึกวันลาให้อัตโนมัติ
                                </p>
                                <button
                                    className="btn w-full justify-center"
                                    style={{ background: '#F59E0B', color: '#fff', boxShadow: '0 2px 8px rgba(245,158,11,0.3)' }}
                                    onClick={handleLeave}
                                    disabled={!selUser || savingLeave}
                                >
                                    {savingLeave ? '...' : 'บันทึกลางาน'}
                                </button>
                            </>
                        )}
                    </div>

                    {/* Leave records on this day */}
                    {leaveRecords.length > 0 && (
                        <div>
                            <p className="text-[11px] font-black uppercase tracking-widest mb-3" style={{ color: '#F59E0B' }}>
                                ลางานในวันนี้ ({leaveRecords.length})
                            </p>
                            {leaveRecords.map(renderLeaveRow)}
                        </div>
                    )}

                    {/* Visits on this day */}
                    <div>
                        <div className="flex items-center justify-between mb-3">
                            <p className="text-[11px] font-black uppercase tracking-widest" style={{ color: 'var(--color-text-tertiary)' }}>
                                การออกพื้นที่ในวันนี้ ({visitsOnDay.length})
                            </p>
                            {(visitsOnDay.length > 0 || leaveRecords.length > 0) && (
                                <button
                                    onClick={() => setShowAll(true)}
                                    className="text-[11px] font-bold px-2.5 py-1 rounded-lg flex items-center gap-1 flex-shrink-0"
                                    style={{ color: 'var(--color-primary)', background: 'rgba(37,99,235,0.08)' }}
                                    title="ดูทั้งหมดในหน้าเดียว"
                                >
                                    <Maximize2 className="w-3 h-3" /> ดูทั้งหมด
                                </button>
                            )}
                        </div>
                        {visitsOnDay.length === 0 && leaveRecords.length === 0 ? (
                            <p className="text-sm text-center py-6" style={{ color: 'var(--color-text-tertiary)' }}>ยังไม่มีการบันทึกในวันนี้</p>
                        ) : Object.entries(byPerson).map(([empId, visits]) => renderPersonGroup(empId, visits))}
                    </div>
                </div>
        </Modal>

        {/* ── View-all modal: everything on one page (wide, multi-column grid) ── */}
        {showAll && (
            <Modal isOpen onClose={() => setShowAll(false)} showCloseButton={false} className="max-w-5xl w-full m-4 max-h-[90vh] flex flex-col">
                {/* Header */}
                <div className="flex items-center justify-between px-6 py-4 flex-shrink-0" style={{ borderBottom: '1px solid var(--color-border)' }}>
                    <div>
                        <h3 className="text-base font-bold" style={{ color: 'var(--color-text-primary)' }}>การออกพื้นที่ทั้งหมด</h3>
                        <p className="text-xs mt-0.5" style={{ color: 'var(--color-text-tertiary)' }}>
                            {dateLabel} · {visitsOnDay.length} รายการ{leaveRecords.length > 0 ? ` · ลางาน ${leaveRecords.length}` : ''}
                            {holiday && <span className="ml-2 text-[10px] font-bold px-1.5 py-0.5 rounded" style={{ background: '#FEE2E2', color: '#DC2626' }}>หยุด: {holiday}</span>}
                        </p>
                    </div>
                    <button onClick={() => setShowAll(false)} className="btn-icon"><X className="w-4 h-4" /></button>
                </div>

                {/* Body — scrolls within its own frame */}
                <div className="overflow-y-auto flex-1 p-5 space-y-5">
                    {leaveRecords.length > 0 && (
                        <div>
                            <p className="text-[11px] font-black uppercase tracking-widest mb-3" style={{ color: '#F59E0B' }}>
                                ลางานในวันนี้ ({leaveRecords.length})
                            </p>
                            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-4">
                                {leaveRecords.map(renderLeaveRow)}
                            </div>
                        </div>
                    )}

                    <div>
                        <p className="text-[11px] font-black uppercase tracking-widest mb-3" style={{ color: 'var(--color-text-tertiary)' }}>
                            การออกพื้นที่ในวันนี้ ({visitsOnDay.length})
                        </p>
                        {visitsOnDay.length === 0 && leaveRecords.length === 0 ? (
                            <p className="text-sm text-center py-6" style={{ color: 'var(--color-text-tertiary)' }}>ยังไม่มีการบันทึกในวันนี้</p>
                        ) : (
                            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-4">
                                {Object.entries(byPerson).map(([empId, visits]) => renderPersonGroup(empId, visits))}
                            </div>
                        )}
                    </div>
                </div>
            </Modal>
        )}
        </>
    );
}

// ─── Assignment Modal ─────────────────────────────────────────────────────────
function AssignmentModal({ assignment, projects, users, allAssignments, onSave, onClose, onProjectStatus, onProjectMeta }: {
    assignment: Partial<Assignment>;
    projects: Project[];
    users: PlatformUser[];
    allAssignments: Assignment[];
    onSave: (data: Partial<Assignment>) => void;
    onClose: () => void;
    onProjectStatus: (projectId: string, status: 'active' | 'closed') => void;
    onProjectMeta: (projectId: string, meta: { year: number; start_date: string | null }) => void;
}) {
    const [form, setForm] = useState<Partial<Assignment>>({
        project_id:   '',
        title:        '',
        site:         '',
        assignee_id:  '',
        status:       'in_progress',
        task_role:    undefined,
        description:  '',
        ...assignment,
    });

    const set = <K extends keyof Assignment>(k: K, v: Assignment[K]) => setForm(f => ({ ...f, [k]: v }));

    // Derive suggestions from existing assignments
    // Customers already using the selected product
    const suggestedTitles = [...new Set(
        allAssignments
            .filter(a => !form.project_id || a.project_id === form.project_id)
            .map(a => a.title)
            .filter(Boolean)
    )].sort();

    // Sites already used for the selected customer (title)
    const suggestedSites = [...new Set(
        allAssignments
            .filter(a => {
                const matchProj  = !form.project_id || a.project_id === form.project_id;
                const matchTitle = !form.title      || a.title      === form.title;
                return matchProj && matchTitle && a.site;
            })
            .map(a => a.site)
            .filter(Boolean)
    )].sort() as string[];

    return (
        <Modal isOpen onClose={onClose} showCloseButton={false} className="max-w-lg w-full m-4 max-h-[92vh] overflow-y-auto">
                <div className="flex items-center justify-between px-6 py-4" style={{ borderBottom: '1px solid var(--color-border)' }}>
                    <h3 className="text-base font-bold" style={{ color: 'var(--color-text-primary)' }}>
                        {assignment.id ? 'แก้ไขงานที่ Assign' : 'เพิ่มงานที่ Assign'}
                    </h3>
                    <button onClick={onClose} className="btn-icon"><X className="w-4 h-4" /></button>
                </div>

                {/* datalist for customer autocomplete */}
                <datalist id="am-titles">
                    {suggestedTitles.map(t => <option key={t} value={t} />)}
                </datalist>
                {/* datalist for site autocomplete */}
                <datalist id="am-sites">
                    {suggestedSites.map(s => <option key={s} value={s} />)}
                </datalist>

                <div className="p-6 space-y-5">
                    {/* ── Required fields ── */}
                    <div className="space-y-4">
                        <div className="flex items-center gap-2">
                            <span className="text-[10px] font-black uppercase tracking-widest" style={{ color: 'var(--color-primary)' }}>
                                ข้อมูลหลัก
                            </span>
                            <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded"
                                style={{ background: '#EEF2FF', color: '#1E40AF' }}>
                                จำเป็น
                            </span>
                            <div className="flex-1 h-px" style={{ background: 'var(--color-border)' }} />
                        </div>

                        <div className="grid grid-cols-2 gap-3">
                            <div>
                                <label className="text-[12px] font-semibold mb-1.5 block" style={{ color: 'var(--color-text-secondary)' }}>
                                    Product / ระบบ
                                    <span className="ml-1 text-red-400">*</span>
                                </label>
                                <select className="field-input" value={form.project_id ?? ''}
                                    onChange={e => {
                                        set('project_id', e.target.value);
                                        set('title', '');
                                        set('site', '');
                                    }}>
                                    <option value="">— เลือก Product —</option>
                                    {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                                </select>
                            </div>
                            <div>
                                <label className="text-[12px] font-semibold mb-1.5 block" style={{ color: 'var(--color-text-secondary)' }}>
                                    พนักงานที่รับผิดชอบ
                                    <span className="ml-1 text-red-400">*</span>
                                </label>
                                <select className="field-input" value={form.assignee_id ?? ''} onChange={e => set('assignee_id', e.target.value)}>
                                    <option value="">— เลือกพนักงาน —</option>
                                    {users.map(u => <option key={u.sub} value={u.sub}>{u.name || u.email}</option>)}
                                </select>
                            </div>
                        </div>

                        <div>
                            <label className="text-[12px] font-semibold mb-1.5 block" style={{ color: 'var(--color-text-secondary)' }}>
                                บทบาทใน Project
                            </label>
                            <div className="flex gap-2">
                                {(['head', 'sub'] as const).map(r => {
                                    const R = ROLE_META[r];
                                    return (
                                        <button
                                            key={r}
                                            onClick={() => set('task_role', r)}
                                            className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl text-[13px] font-semibold transition-all"
                                            style={{
                                                background: form.task_role === r ? R.bg : 'var(--color-surface-2)',
                                                color: form.task_role === r ? R.textColor : 'var(--color-text-secondary)',
                                                border: `1.5px solid ${
                                                    form.task_role === r ? R.textColor : 'var(--color-border)'
                                                }`,
                                            }}
                                        >
                                            <span className="font-black">{R.label}</span>
                                            <span className="text-[11px] font-normal opacity-75">
                                                {r === 'head' ? '(Main)' : '(Support)'}
                                            </span>
                                        </button>
                                    );
                                })}
                            </div>
                        </div>
                    </div>

                    {/* ── Status (task close / project close) ── */}
                    {assignment.id && (() => {
                        const selProject = projects.find(p => p.id === form.project_id);
                        const projClosed = selProject?.status === 'closed';
                        return (
                            <div className="space-y-3">
                                <div className="flex items-center gap-2">
                                    <span className="text-[10px] font-bold uppercase tracking-widest" style={{ color: 'var(--color-text-tertiary)' }}>สถานะ</span>
                                    <div className="flex-1 h-px" style={{ background: 'var(--color-border)' }} />
                                </div>

                                {/* Task status */}
                                <div>
                                    <label className="text-[12px] font-semibold mb-1.5 block" style={{ color: 'var(--color-text-secondary)' }}>สถานะงานนี้</label>
                                    <div className="flex gap-2">
                                        {([['in_progress', 'กำลังดำเนินการ'], ['done', 'ปิดงาน (เสร็จสิ้น)']] as const).map(([val, label]) => {
                                            const active = (form.status ?? 'in_progress') === val;
                                            const isDone = val === 'done';
                                            return (
                                                <button key={val} onClick={() => set('status', val)}
                                                    className="flex-1 py-2.5 rounded-xl text-[13px] font-semibold transition-all"
                                                    style={{
                                                        background: active ? (isDone ? 'var(--color-success-soft)' : 'var(--color-primary-soft)') : 'var(--color-surface-2)',
                                                        color: active ? (isDone ? 'var(--color-success)' : 'var(--color-primary)') : 'var(--color-text-secondary)',
                                                        border: `1.5px solid ${active ? (isDone ? 'var(--color-success)' : 'var(--color-primary)') : 'var(--color-border)'}`,
                                                    }}>
                                                    {label}
                                                </button>
                                            );
                                        })}
                                    </div>
                                </div>

                                {/* Project lifecycle */}
                                {selProject && (
                                    <div className="flex items-center justify-between gap-3 rounded-xl px-3.5 py-3" style={{ background: 'var(--color-surface-2)', border: '1px solid var(--color-border)' }}>
                                        <div className="min-w-0">
                                            <p className="text-[12px] font-semibold" style={{ color: 'var(--color-text-secondary)' }}>โครงการ: <span style={{ color: 'var(--color-text-primary)' }}>{selProject.name}</span></p>
                                            <p className="text-[11px]" style={{ color: projClosed ? 'var(--color-text-tertiary)' : 'var(--color-success)' }}>
                                                {projClosed ? 'ปิดโครงการแล้ว — ทุกงานในโครงการถือว่าปิด' : 'โครงการเปิดอยู่'}
                                            </p>
                                        </div>
                                        <button
                                            onClick={() => {
                                                const next = projClosed ? 'active' : 'closed';
                                                if (next === 'active') { onProjectStatus(selProject.id, next); return; }
                                                confirmDialog({ title: 'ปิดทั้งโครงการ?', message: `"${selProject.name}"\nงานทั้งหมดในโครงการนี้จะถูกแสดงเป็น "ปิดแล้ว"`, confirmText: 'ปิดโครงการ' })
                                                    .then(ok => { if (ok) onProjectStatus(selProject.id, next); });
                                            }}
                                            className="shrink-0 px-3 py-2 rounded-lg text-[12px] font-semibold transition-all"
                                            style={{
                                                background: projClosed ? 'var(--color-primary-soft)' : 'var(--color-error-soft)',
                                                color: projClosed ? 'var(--color-primary)' : 'var(--color-error)',
                                                border: `1px solid ${projClosed ? 'var(--color-primary)' : 'var(--color-error)'}`,
                                            }}>
                                            {projClosed ? 'เปิดโครงการ' : 'ปิดโครงการ'}
                                        </button>
                                    </div>
                                )}

                                {/* Project date — year required, month/day optional */}
                                {selProject && (() => {
                                    const sd = selProject.start_date ? new Date(selProject.start_date) : null;
                                    const curYear = selProject.year ?? (sd ? sd.getFullYear() : new Date().getFullYear());
                                    const curMonth = sd ? sd.getMonth() + 1 : 0;
                                    const curDay = sd ? sd.getDate() : 0;
                                    const commit = (y: number, m: number, d: number) => {
                                        const start_date = m > 0 ? `${y}-${String(m).padStart(2, '0')}-${String(d > 0 ? d : 1).padStart(2, '0')}` : null;
                                        onProjectMeta(selProject.id, { year: y, start_date });
                                    };
                                    const nowCE = new Date().getFullYear();
                                    const years = Array.from({ length: 7 }, (_, i) => nowCE - 4 + i);
                                    const selStyle = 'field-input text-[13px]';
                                    return (
                                        <div className="rounded-xl px-3.5 py-3 space-y-2" style={{ background: 'var(--color-surface-2)', border: '1px solid var(--color-border)' }}>
                                            <label className="text-[12px] font-semibold block" style={{ color: 'var(--color-text-secondary)' }}>ช่วงเวลาโครงการ <span className="text-[11px] font-normal" style={{ color: 'var(--color-text-tertiary)' }}>(ระบุปีอย่างน้อย · เดือน/วันไม่บังคับ)</span></label>
                                            <div className="grid grid-cols-3 gap-2">
                                                <div>
                                                    <span className="text-[10px] block mb-1" style={{ color: 'var(--color-text-tertiary)' }}>ปี (พ.ศ.) *</span>
                                                    <select className={selStyle} value={curYear} onChange={e => commit(Number(e.target.value), curMonth, curDay)}>
                                                        {years.map(y => <option key={y} value={y}>{y + 543}</option>)}
                                                    </select>
                                                </div>
                                                <div>
                                                    <span className="text-[10px] block mb-1" style={{ color: 'var(--color-text-tertiary)' }}>เดือน</span>
                                                    <select className={selStyle} value={curMonth} onChange={e => commit(curYear, Number(e.target.value), curDay)}>
                                                        <option value={0}>—</option>
                                                        {TH_MONTHS_SHORT.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
                                                    </select>
                                                </div>
                                                <div>
                                                    <span className="text-[10px] block mb-1" style={{ color: 'var(--color-text-tertiary)' }}>วัน</span>
                                                    <select className={selStyle} value={curDay} onChange={e => commit(curYear, curMonth, Number(e.target.value))} disabled={curMonth === 0}>
                                                        <option value={0}>—</option>
                                                        {Array.from({ length: 31 }, (_, i) => i + 1).map(d => <option key={d} value={d}>{d}</option>)}
                                                    </select>
                                                </div>
                                            </div>
                                        </div>
                                    );
                                })()}
                            </div>
                        );
                    })()}

                    {/* ── Optional fields ── */}
                    <div className="rounded-xl p-4 space-y-4" style={{ background: 'var(--color-surface-2)', border: '1px solid var(--color-border)' }}>
                        <div className="flex items-center gap-2">
                            <span className="text-[10px] font-black uppercase tracking-widest" style={{ color: 'var(--color-text-tertiary)' }}>
                                ข้อมูลเพิ่มเติม
                            </span>
                            <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded"
                                style={{ background: '#F3F4F6', color: '#6B7280' }}>
                                ไม่บังคับ — สามารถเพิ่มภายหลังได้
                            </span>
                            <div className="flex-1 h-px" style={{ background: 'var(--color-border)' }} />
                        </div>

                        <div>
                            <label className="text-[12px] font-semibold mb-1.5 block" style={{ color: 'var(--color-text-secondary)' }}>
                                ลูกค้า (ชื่อบริษัท)
                                {suggestedTitles.length > 0 && (
                                    <span className="ml-1.5 text-[11px] font-normal" style={{ color: 'var(--color-text-tertiary)' }}>
                                        — {suggestedTitles.length} รายการในระบบ
                                    </span>
                                )}
                            </label>
                            <input
                                className="field-input"
                                list="am-titles"
                                value={form.title ?? ''}
                                onChange={e => { set('title', e.target.value); set('site', ''); }}
                                placeholder="พิมพ์หรือเลือกชื่อบริษัทลูกค้า..."
                                autoComplete="off"
                            />
                        </div>

                        <div>
                            <label className="text-[12px] font-semibold mb-1.5 block" style={{ color: 'var(--color-text-secondary)' }}>
                                สถานที่ / Location
                                {suggestedSites.length > 0 && (
                                    <span className="ml-1.5 text-[11px] font-normal" style={{ color: 'var(--color-text-tertiary)' }}>
                                        — {suggestedSites.length} รายการในระบบ
                                    </span>
                                )}
                            </label>
                            <input
                                className="field-input"
                                list="am-sites"
                                value={form.site ?? ''}
                                onChange={e => set('site', e.target.value)}
                                placeholder="พิมพ์หรือเลือกสถานที่..."
                                autoComplete="off"
                            />
                        </div>

                        <div>
                            <label className="text-[12px] font-semibold mb-1.5 block" style={{ color: 'var(--color-text-secondary)' }}>
                                หมายเหตุ
                            </label>
                            <textarea className="field-input resize-none" rows={2}
                                value={form.description ?? ''}
                                onChange={e => set('description', e.target.value)}
                                placeholder="รายละเอียดเพิ่มเติม..." />
                        </div>
                    </div>
                </div>

                <div className="px-6 pb-5 flex gap-3 justify-end">
                    <button className="btn" onClick={onClose}>ยกเลิก</button>
                    <button
                        className="btn btn-primary"
                        disabled={!form.project_id || !form.assignee_id || !form.task_role}
                        onClick={() => { if (form.project_id && form.assignee_id && form.task_role) onSave(form); }}
                    >
                        บันทึก
                    </button>
                </div>
        </Modal>
    );
}

// ─── Project Modal ─────────────────────────────────────────────────────────────
function ProjectModal({ project, onSave, onClose }: {
    project: Partial<Project>;
    onSave: (p: Partial<Project>) => void;
    onClose: () => void;
}) {
    const [form, setForm] = useState<Partial<Project>>({
        name: '', description: '', color: PROJECT_COLORS[0], logo_url: null, ...project,
    });
    const [uploading, setUploading] = useState(false);
    const fileRef = useRef<HTMLInputElement>(null);

    const set = <K extends keyof Project>(k: K, v: Project[K]) => setForm(f => ({ ...f, [k]: v }));

    const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;
        setUploading(true);
        try {
            const fd = new FormData();
            fd.append('logo', file);
            const res = await fetch('/api/upload/logo', { method: 'POST', body: fd });
            if (!res.ok) throw new Error(await res.text());
            const data = await res.json();
            if (data.url) set('logo_url', data.url);
        } catch (e) {
            console.error('Logo upload failed:', e);
            toast.error('อัพโหลดรูปไม่สำเร็จ');
        } finally {
            setUploading(false);
        }
    };

    return (
        <Modal isOpen onClose={onClose} showCloseButton={false} className="max-w-md w-full m-4 max-h-[92vh] overflow-y-auto">
                <div className="flex items-center justify-between px-6 py-4" style={{ borderBottom: '1px solid var(--color-border)' }}>
                    <h3 className="text-base font-bold" style={{ color: 'var(--color-text-primary)' }}>
                        {form.id ? 'แก้ไขผลิตภัณฑ์' : 'เพิ่มผลิตภัณฑ์'}
                    </h3>
                    <button onClick={onClose} className="btn-icon"><X className="w-4 h-4" /></button>
                </div>

                <div className="p-6 space-y-4">
                    <div className="flex items-center gap-4">
                        <div
                            className="w-16 h-16 rounded-2xl flex items-center justify-center flex-shrink-0 overflow-hidden cursor-pointer relative group"
                            style={{ background: form.logo_url ? 'transparent' : ((form.color ?? '#2563EB') + '22'), border: '2px dashed ' + (form.color ?? '#2563EB') }}
                            onClick={() => fileRef.current?.click()}
                        >
                            {uploading
                                ? <div className="w-6 h-6 border-2 border-current border-t-transparent rounded-full animate-spin" style={{ color: form.color ?? '#2563EB' }} />
                                : form.logo_url
                                    ? <img src={form.logo_url} alt="logo" className="w-full h-full object-contain" />
                                    : <Upload className="w-6 h-6" style={{ color: form.color ?? '#2563EB' }} />}
                            <div className="absolute inset-0 bg-black/30 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center rounded-2xl">
                                <Upload className="w-5 h-5 text-white" />
                            </div>
                        </div>
                        <input ref={fileRef} type="file" accept="image/*,image/gif,image/webp" className="hidden" onChange={handleFile} />
                        <div className="flex-1">
                            <p className="text-xs font-semibold mb-2" style={{ color: 'var(--color-text-secondary)' }}>สีโปรเจกต์</p>
                            <div className="flex flex-wrap gap-2">
                                {PROJECT_COLORS.map(c => (
                                    <button key={c} onClick={() => set('color', c)} className="w-6 h-6 rounded-lg transition-transform"
                                        style={{ background: c, transform: form.color === c ? 'scale(1.25)' : 'scale(1)', boxShadow: form.color === c ? `0 0 0 2px white, 0 0 0 4px ${c}` : 'none' }} />
                                ))}
                            </div>
                        </div>
                    </div>
                    <div>
                        <label className="field-label">ชื่อผลิตภัณฑ์</label>
                        <input className="field-input" value={form.name ?? ''} onChange={e => set('name', e.target.value)} placeholder="ชื่อผลิตภัณฑ์..." />
                    </div>
                </div>

                <div className="px-6 pb-5 flex gap-3 justify-end">
                    <button className="btn" onClick={onClose}>ยกเลิก</button>
                    <button className="btn btn-primary" onClick={() => { if (form.name?.trim()) onSave(form); }}>บันทึก</button>
                </div>
        </Modal>
    );
}

// ─── Section divider ──────────────────────────────────────────────────────────
function SectionHeader({ label, count, color }: { label: string; count: number; color: string }) {
    return (
        <div className="flex items-center gap-3 mb-3">
            <div className="w-1 h-5 rounded-full flex-shrink-0" style={{ background: color }} />
            <p className="text-[11px] font-black uppercase tracking-widest" style={{ color }}>
                {label}
            </p>
            <span className="text-[11px] font-bold px-2 py-0.5 rounded-full"
                style={{ background: color + '18', color }}>
                {count}
            </span>
            <div className="flex-1 h-px" style={{ background: 'var(--color-border)' }} />
        </div>
    );
}

// ─── Main Page ────────────────────────────────────────────────────────────────
export default function AssignedTasks() {
    useHolidays();   // re-render when the daily holiday sync lands
    const { user } = useAuth();
    // Admin (SUPER_ADMIN/STAFF) manages products, assigns work and edits anyone's
    // records. Interns are read-only here except their OWN calendar entries.
    const isAdmin = roleIsAdmin(user?.role);

    const [assignments,  setAssignments]  = useState<Assignment[]>([]);
    const [projects,     setProjects]     = useState<Project[]>([]);
    const [users,        setUsers]        = useState<PlatformUser[]>([]);
    const [loading,      setLoading]      = useState(true);
    const [error,        setError]        = useState<string | null>(null);

    const [activeId,     setActiveId]     = useState<string | null>(null);
    const [viewDate,     setViewDate]     = useState(new Date());
    const [searchParams] = useSearchParams();
    const [tab,          setTab]          = useState<'list' | 'calendar' | 'attendance'>(() => {
        const p = searchParams.get('tab');
        return (p === 'calendar' || p === 'attendance') ? p : 'list';
    });
    const [selProject,   setSelProject]   = useState<string>('all');
    const [assignModal,  setAssignModal]  = useState<Partial<Assignment> | null>(null);
    const [projectModal, setProjectModal] = useState<Partial<Project> | null>(null);
    const [dayDate,      setDayDate]      = useState<string | null>(null);
    const [attByDay,     setAttByDay]     = useState<Record<string, AttDot[]>>({});
    const [taskVisits,   setTaskVisits]   = useState<TaskVisit[]>([]);
    const [expandedEmps, setExpandedEmps] = useState<Set<string>>(new Set());
    const [activityModal, setActivityModal] = useState<ActivityGroup | null>(null);
    const [reportOpen,   setReportOpen]   = useState(false);

    const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }));

    // ── Load data ─────────────────────────────────────────────────────────────
    const loadAll = useCallback(async () => {
        try {
            setError(null);
            setLoading(true);
            const [a, p, u] = await Promise.all([
                apiFetch<Assignment[]>('/api/tasks'),
                apiFetch<Project[]>('/api/projects'),
                apiFetch<PlatformUser[]>('/api/users'),
            ]);
            setAssignments(a);
            setProjects(p);
            setUsers(u);
        } catch (e) {
            setError(String(e));
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => { loadAll(); }, [loadAll]);

    // ── Load attendance for current calendar month ─────────────────────────────
    const fetchAttendance = useCallback(() => {
        const yr = viewDate.getFullYear();
        const mo = viewDate.getMonth() + 1;
        fetch(`/api/attendance?year=${yr}&month=${mo}`)
            .then(r => r.json())
            .then((rows: { employee_id: string; date: string; status: string }[]) => {
                const byDay: Record<string, AttDot[]> = {};
                for (const row of rows) {
                    const day = row.date.slice(0, 10);
                    if (!byDay[day]) byDay[day] = [];
                    const u2 = users.find(x => x.sub === row.employee_id);
                    if (u2) {
                        byDay[day].push({ employee_id: row.employee_id, name: u2.name, status: row.status });
                    }
                }
                setAttByDay(byDay);
            })
            .catch(() => {});
    }, [viewDate, users]);

    useEffect(() => { fetchAttendance(); }, [fetchAttendance]);

    // ── Load task visits for current calendar month ───────────────────────────
    const fetchTaskVisits = useCallback(() => {
        const yr = viewDate.getFullYear();
        const mo = viewDate.getMonth() + 1;
        fetch(`/api/task-visits?year=${yr}&month=${mo}`)
            .then(r => r.json())
            .then((data: TaskVisit[]) => setTaskVisits(data))
            .catch(() => {});
    }, [viewDate]);

    useEffect(() => { fetchTaskVisits(); }, [fetchTaskVisits]);

    // Refresh both attendance and task visits together
    const refreshAll = useCallback(() => {
        fetchAttendance();
        fetchTaskVisits();
    }, [fetchAttendance, fetchTaskVisits]);

    // ── Calendar ──────────────────────────────────────────────────────────────
    const year        = viewDate.getFullYear();
    const month       = viewDate.getMonth();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const firstDay    = new Date(year, month, 1).getDay();

    // ── Derived ───────────────────────────────────────────────────────────────
    const filtered   = selProject === 'all' ? assignments : assignments.filter(a => a.project_id === selProject);
    const myWork     = filtered.filter(a => a.assignee_id === user?.sub);
    const othersWork = filtered.filter(a => a.assignee_id !== user?.sub);

    // ── CRUD ──────────────────────────────────────────────────────────────────
    const saveAssignment = async (data: Partial<Assignment>) => {
        try {
            if (data.id) {
                await apiFetch<Assignment>(`/api/tasks/${data.id}`, {
                    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data),
                });
            } else {
                await apiFetch<Assignment>('/api/tasks', {
                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ ...data, created_by: user?.sub }),
                });
            }
            setAssignModal(null);
            await loadAll();
        } catch (e) { toast.error('เกิดข้อผิดพลาด: ' + String(e)); }
    };

    const deleteAssignment = async (id: string) => {
        if (!(await confirmDialog('ต้องการลบงานนี้?'))) return;
        try {
            await apiFetch(`/api/tasks/${id}`, { method: 'DELETE' });
            setAssignments(p => p.filter(a => a.id !== id));
        } catch (e) { toast.error('ลบไม่สำเร็จ: ' + String(e)); }
    };

    const setProjectStatus = async (projectId: string, status: 'active' | 'closed') => {
        setProjects(prev => prev.map(p => p.id === projectId ? { ...p, status } : p)); // optimistic
        try {
            await apiFetch(`/api/projects/${projectId}/status`, {
                method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status }),
            });
        } catch (e) { toast.error('อัปเดตสถานะโครงการไม่สำเร็จ: ' + String(e)); loadAll(); }
    };

    const setProjectMeta = async (projectId: string, meta: { year: number; start_date: string | null }) => {
        const proj = projects.find(p => p.id === projectId);
        if (!proj) return;
        setProjects(prev => prev.map(p => p.id === projectId ? { ...p, ...meta } : p)); // optimistic
        try {
            await apiFetch(`/api/projects/${projectId}`, {
                method: 'PUT', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name: proj.name, description: proj.description, color: proj.color, logo_url: proj.logo_url, year: meta.year, start_date: meta.start_date }),
            });
        } catch (e) { toast.error('อัปเดตช่วงเวลาโครงการไม่สำเร็จ: ' + String(e)); loadAll(); }
    };

    const saveProject = async (data: Partial<Project>) => {
        try {
            if (data.id) {
                await apiFetch<Project>(`/api/projects/${data.id}`, {
                    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data),
                });
            } else {
                await apiFetch<Project>('/api/projects', {
                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ ...data, created_by: user?.sub }),
                });
            }
            setProjectModal(null);
            await loadAll();
        } catch (e) { toast.error('บันทึกไม่สำเร็จ: ' + String(e)); }
    };

    const deleteProject = async (id: string) => {
        if (!(await confirmDialog('ต้องการลบโปรเจกต์นี้?'))) return;
        try {
            await apiFetch(`/api/projects/${id}`, { method: 'DELETE' });
            if (selProject === id) setSelProject('all');
            await loadAll();
        } catch (e) { toast.error('ลบไม่สำเร็จ: ' + String(e)); }
    };

    // ── DnD ───────────────────────────────────────────────────────────────────
    const handleDragStart = useCallback((e: DragStartEvent) => setActiveId(e.active.id as string), []);

    const handleDragEnd = useCallback(() => {
        setActiveId(null);
    }, []);

    const activeA = assignments.find(a => a.id === activeId);

    // ── Grouped all by person (for admin list view) ───────────────────────────
    const allGrouped = filtered.reduce<Record<string, Assignment[]>>((acc, a) => {
        (acc[a.assignee_id] ??= []).push(a);
        return acc;
    }, {});

    // ── Grouped by team (preserves per-person grouping, adds team header) ────
    const teamGrouped = Object.entries(allGrouped).reduce<Record<string, [string, Assignment[]][]>>(
        (acc, entry) => {
            const u = users.find(x => x.sub === entry[0]);
            const team = u?.user_group ?? 'engineer';
            (acc[team] ??= []).push(entry);
            return acc;
        }, {}
    );

    // Sort all employees by team name so team members are always contiguous
    const allGroupedSorted = Object.entries(allGrouped).sort(([subA], [subB]) => {
        const teamA = (users.find(x => x.sub === subA)?.user_group ?? 'engineer');
        const teamB = (users.find(x => x.sub === subB)?.user_group ?? 'engineer');
        return teamA.localeCompare(teamB);
    });

    // First sub in each team (sorted) — used to render team section headers
    const seenTeams = new Set<string>();
    const sortedTeamFirstSubs = new Set(
        allGroupedSorted
            .filter(([sub]) => {
                const team = users.find(x => x.sub === sub)?.user_group ?? 'engineer';
                if (seenTeams.has(team)) return false;
                seenTeams.add(team);
                return true;
            })
            .map(([sub]) => sub),
    );

    // ── Grouped others by person ───────────────────────────────────────────────
    const othersGrouped = othersWork.reduce<Record<string, Assignment[]>>((acc, a) => {
        (acc[a.assignee_id] ??= []).push(a);
        return acc;
    }, {});

    // ── Calendar: visits by date ───────────────────────────────────────────────
    const visitsByDate = taskVisits.reduce<Record<string, TaskVisit[]>>((acc, v) => {
        const d = v.visit_date.slice(0, 10);
        (acc[d] ??= []).push(v);
        return acc;
    }, {});

    // ── Render ────────────────────────────────────────────────────────────────
    if (loading) return (
        <div className="flex items-center justify-center py-24">
            <div className="text-center">
                <div className="w-10 h-10 border-4 rounded-full animate-spin mx-auto mb-3"
                    style={{ borderColor: 'var(--color-primary)', borderTopColor: 'transparent' }} />
                <p className="text-sm" style={{ color: 'var(--color-text-tertiary)' }}>กำลังโหลดข้อมูล...</p>
            </div>
        </div>
    );

    if (error) return (
        <div className="card p-8 text-center">
            <AlertCircle className="w-10 h-10 mx-auto mb-3" style={{ color: '#EF4444' }} />
            <p className="text-sm font-semibold mb-1" style={{ color: 'var(--color-text-primary)' }}>โหลดข้อมูลไม่สำเร็จ</p>
            <p className="text-xs mb-4" style={{ color: 'var(--color-text-tertiary)' }}>{error}</p>
            <button className="btn btn-primary mx-auto" onClick={loadAll}>
                <RefreshCw className="w-4 h-4 mr-2"/>ลองใหม่
            </button>
        </div>
    );

    return (
        <div className="space-y-5">

            {/* Stats — the page title/subtitle lives in AppHeader, so the content
                starts here and the actions sit inline with the tabs below. */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {[
                    { label: 'งานของฉัน',         count: myWork.length,   color: 'var(--color-primary)' },
                    { label: 'Main',    count: myWork.filter(a => (a.task_role ?? 'head') === 'head').length, color: '#F59E0B' },
                    { label: 'Support',     count: myWork.filter(a => a.task_role === 'sub').length, color: '#64748B' },
                    { label: 'งานทีมทั้งหมด',     count: filtered.length, color: 'var(--color-text-secondary)' },
                ].map(s => (
                    <div key={s.label} className="card p-4">
                        <p className="text-2xl font-black" style={{ color: s.color }}>{s.count}</p>
                        <p className="text-[11px] font-semibold" style={{ color: 'var(--color-text-secondary)' }}>{s.label}</p>
                    </div>
                ))}
            </div>

            <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
                <div className="grid grid-cols-1 lg:grid-cols-4 gap-5">

                    {/* Sidebar */}
                    <div>
                        <div className="card p-4 space-y-1.5">
                            <p className="text-[11px] font-bold mb-3 uppercase tracking-widest" style={{ color: 'var(--color-text-tertiary)' }}>
                                ผลิตภัณฑ์ / บริษัท
                            </p>
                            <button
                                onClick={() => setSelProject('all')}
                                className="w-full text-left px-3 py-2.5 rounded-xl text-[13px] font-semibold transition-all"
                                style={{ background: selProject === 'all' ? 'var(--color-primary)' : 'transparent', color: selProject === 'all' ? '#fff' : 'var(--color-text-secondary)' }}
                            >
                                ทั้งหมด ({assignments.length})
                            </button>
                            {[...projects].sort((a, b) =>
                                assignments.filter(x => x.project_id === b.id).length -
                                assignments.filter(x => x.project_id === a.id).length
                            ).map(p => (
                                <div key={p.id} className="group flex items-center gap-1">
                                    <button
                                        onClick={() => setSelProject(p.id)}
                                        className="flex-1 text-left px-3 py-2.5 rounded-xl text-[13px] font-semibold transition-all flex items-center gap-2 relative group/logo"
                                        style={{
                                            background: selProject === p.id ? p.color + '18' : 'transparent',
                                            color: selProject === p.id ? p.color : 'var(--color-text-secondary)',
                                        }}
                                    >
                                        {p.logo_url
                                            ? <img
                                                src={p.logo_url}
                                                alt={p.name}
                                                className="w-8 h-8 rounded-lg object-contain flex-shrink-0 transition-all duration-200 group-hover/logo:scale-[2.5] group-hover/logo:shadow-xl group-hover/logo:z-50 group-hover/logo:relative"
                                                style={{ transformOrigin: 'left center', background: 'white', padding: '2px' }}
                                              />
                                            : <span className="w-8 h-8 rounded-lg flex items-center justify-center text-[11px] font-black text-white flex-shrink-0"
                                                style={{ background: p.color }}>{p.name[0]}</span>}
                                        <span className="truncate">{p.name}</span>
                                        <span className="ml-auto text-[10px] opacity-60">
                                            {assignments.filter(a => a.project_id === p.id).length}
                                        </span>
                                    </button>
                                    {isAdmin && (
                                        <div className="flex gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                                            <button onClick={() => setProjectModal(p)} className="btn-icon w-6 h-6 rounded-md"><Pencil className="w-3 h-3" /></button>
                                            <button onClick={() => deleteProject(p.id)} className="btn-icon w-6 h-6 rounded-md"><Trash2 className="w-3 h-3" style={{ color: '#EF4444' }} /></button>
                                        </div>
                                    )}
                                </div>
                            ))}
                            {projects.length === 0 && (
                                <p className="text-xs text-center py-6" style={{ color: 'var(--color-text-tertiary)' }}>
                                    ยังไม่มีข้อมูล
                                </p>
                            )}
                        </div>
                    </div>

                    {/* Main content */}
                    <div className="lg:col-span-3">
                        {/* Tabs + page actions on one row */}
                        <div className="flex items-start justify-between gap-3 mb-4 flex-wrap">
                        <div className="card p-1 flex items-center gap-1 w-fit flex-wrap">
                            {([
                                { key: 'list',       label: 'รายการงาน' },
                                { key: 'calendar',   label: 'ปฏิทิน' },
                                { key: 'attendance', label: 'การเข้างาน' },
                            ] as const).map(({ key, label }) => (
                                <button key={key} onClick={() => setTab(key)}
                                    className="px-4 py-2 rounded-xl text-[13px] font-semibold transition-all"
                                    style={{
                                        background: tab === key ? 'var(--color-primary)' : 'transparent',
                                        color: tab === key ? '#fff' : 'var(--color-text-secondary)',
                                    }}>
                                    {label}
                                </button>
                            ))}
                            <div className="w-px h-5 mx-1 flex-shrink-0" style={{ background: 'var(--color-border)' }} />
                            <a href="/tasks/overview" target="_blank" rel="noopener noreferrer"
                                className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-[13px] font-semibold transition-all"
                                style={{ color: 'var(--color-text-secondary)' }}
                                title="ดู Overview สาธารณะ">
                                <ExternalLink className="w-3.5 h-3.5" />Overview
                            </a>
                            <a href="#"
                                onClick={e => { e.preventDefault(); openPreview('daily', { fallback: `/attendance/daily?date=${todayStr}` }); }}
                                className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-[13px] font-semibold transition-all cursor-pointer"
                                style={{ color: 'var(--color-text-secondary)' }}
                                title="ดู Daily Preview">
                                <Eye className="w-3.5 h-3.5" />Preview
                            </a>
                        </div>

                            <div className="flex gap-2 flex-shrink-0">
                                <button className="btn-icon" onClick={loadAll} title="รีเฟรช"><RefreshCw className="w-4 h-4" /></button>
                                {isAdmin && (
                                    <>
                                        <button className="btn gap-2" onClick={() => setProjectModal({})}>
                                            <Building2 className="w-4 h-4" />เพิ่มผลิตภัณฑ์
                                        </button>
                                        <button className="btn btn-primary gap-2" onClick={() => setAssignModal({})}>
                                            <Plus className="w-4 h-4" />Assign งาน
                                        </button>
                                    </>
                                )}
                            </div>
                        </div>

                        {tab === 'list' && (
                            <div className="space-y-4">
                                {isAdmin ? (
                                    /* ── Admin: collapsible employee list ── */
                                    <div className="space-y-3">
                                        {/* Summary bar */}
                                        <div className="card p-4 flex items-center gap-4">
                                            <div>
                                                <p className="text-2xl font-black" style={{ color: 'var(--color-primary)' }}>{Object.keys(allGrouped).length}</p>
                                                <p className="text-[11px] font-semibold" style={{ color: 'var(--color-text-secondary)' }}>พนักงาน</p>
                                            </div>
                                            <div className="w-px h-8 self-center" style={{ background: 'var(--color-border)' }} />
                                            <div>
                                                <p className="text-2xl font-black" style={{ color: '#F59E0B' }}>{[...new Set(filtered.map(a => a.project_id))].length}</p>
                                                <p className="text-[11px] font-semibold" style={{ color: 'var(--color-text-secondary)' }}>Products</p>
                                            </div>
                                            <div className="w-px h-8 self-center" style={{ background: 'var(--color-border)' }} />
                                            <div>
                                                <p className="text-2xl font-black" style={{ color: '#2563EB' }}>{filtered.filter(a => (a.task_role ?? 'head') === 'head').length}</p>
                                                <p className="text-[11px] font-semibold" style={{ color: 'var(--color-text-secondary)' }}>งาน Main</p>
                                            </div>
                                            <div className="w-px h-8 self-center" style={{ background: 'var(--color-border)' }} />
                                            <div>
                                                <p className="text-2xl font-black" style={{ color: '#64748B' }}>{filtered.filter(a => a.task_role === 'sub').length}</p>
                                                <p className="text-[11px] font-semibold" style={{ color: 'var(--color-text-secondary)' }}>งาน Support</p>
                                            </div>
                                            <div className="w-px h-8 self-center" style={{ background: 'var(--color-border)' }} />
                                            <div>
                                                <p className="text-2xl font-black" style={{ color: 'var(--color-text-secondary)' }}>{filtered.length}</p>
                                                <p className="text-[11px] font-semibold" style={{ color: 'var(--color-text-secondary)' }}>งานทั้งหมด</p>
                                            </div>
                                            {expandedEmps.size > 0 && (
                                                <button className="ml-auto btn text-[12px]" onClick={() => setExpandedEmps(new Set())}>
                                                    ย่อทั้งหมด
                                                </button>
                                            )}
                                        </div>

                                        {filtered.length === 0 ? (
                                            <div className="card p-10 text-center">
                                                <p className="text-sm" style={{ color: 'var(--color-text-tertiary)' }}>ยังไม่มีงานในระบบ</p>
                                            </div>
                                        ) : allGroupedSorted.map(([sub, items], empIdx) => {
                                            const isOpen    = expandedEmps.has(sub);
                                            const headCount = items.filter(a => (a.task_role ?? 'head') === 'head').length;
                                            const subCount  = items.filter(a => a.task_role === 'sub').length;
                                            // Collect distinct products and customers
                                            const products  = [...new Set(items.map(a => a.project_name).filter(Boolean))];
                                            const customers = [...new Set(items.map(a => a.title).filter(Boolean))];
                                            const u2 = users.find(x => x.sub === sub);
                                            const empTeam = u2?.user_group ?? 'engineer';
                                            const isTeamFirst = sortedTeamFirstSubs.has(sub);
                                            return (
                                                <Fragment key={sub}>
                                                {isTeamFirst && (
                                                    <div className="flex items-center gap-3 px-1 mb-2 mt-1">
                                                        <div className="h-px flex-1" style={{ background: 'var(--color-border)' }} />
                                                        <span className="text-[11px] font-black uppercase tracking-widest px-3 py-1.5 rounded-full"
                                                            style={{ background: 'var(--color-surface-2)', color: 'var(--color-text-secondary)', border: '1px solid var(--color-border)' }}>
                                                            {empTeam.toUpperCase()} · {(teamGrouped[empTeam] ?? []).length} คน
                                                        </span>
                                                        <div className="h-px flex-1" style={{ background: 'var(--color-border)' }} />
                                                    </div>
                                                )}
                                                <motion.div
                                                    initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}
                                                    transition={{ delay: empIdx * 0.04 }}
                                                    className="card overflow-hidden"
                                                >
                                                    {/* Employee header row — click to expand */}
                                                    <button
                                                        className="w-full flex items-center gap-3 px-5 py-4 text-left transition-colors"
                                                        style={{ background: isOpen ? 'var(--color-surface-2)' : 'transparent' }}
                                                        onClick={() => setExpandedEmps(prev => {
                                                            const next = new Set(prev);
                                                            isOpen ? next.delete(sub) : next.add(sub);
                                                            return next;
                                                        })}
                                                    >
                                                        {/* Avatar */}
                                                        <PersonAvatar name={items[0].assignee_name ?? items[0].assignee_email ?? sub} colorKey={sub} size="lg" />

                                                        {/* Name + concise summary */}
                                                        <div className="flex-1 min-w-0">
                                                            <p className="text-[14px] font-bold truncate" style={{ color: 'var(--color-text-primary)' }}>
                                                                {items[0].assignee_name ?? items[0].assignee_email ?? sub}
                                                            </p>
                                                            <p className="text-[11px] truncate" style={{ color: 'var(--color-text-tertiary)' }}>
                                                                {items.length} งาน · {headCount} Main · {subCount} Support · {products.length} Product
                                                            </p>
                                                        </div>

                                                        {/* Product logos (up to 3) */}
                                                        <div className="hidden md:flex items-center gap-1.5 flex-wrap flex-shrink-0 max-w-[160px]">
                                                            {products.slice(0, 3).map(p => {
                                                                if (!p) return null;
                                                                const proj = projects.find(pr => pr.name === p);
                                                                return proj?.logo_url ? (
                                                                    <img key={p} src={proj.logo_url} alt={p} title={p}
                                                                        className="w-7 h-7 rounded-lg object-contain flex-shrink-0"
                                                                        style={{ background: 'white', padding: '2px', boxShadow: '0 0 0 1px ' + (proj.color ?? '#2563EB') + '44' }} />
                                                                ) : (
                                                                    <span key={p}
                                                                        className="w-7 h-7 rounded-lg flex items-center justify-center text-[9px] font-black text-white flex-shrink-0"
                                                                        style={{ background: proj?.color ?? '#2563EB' }}
                                                                        title={p}>
                                                                        {p.charAt(0)}
                                                                    </span>
                                                                );
                                                            })}
                                                            {products.length > 3 && (
                                                                <span className="w-7 h-7 rounded-lg flex items-center justify-center text-[9px] font-bold flex-shrink-0"
                                                                    style={{ background: 'var(--color-surface-2)', color: 'var(--color-text-tertiary)', border: '1px solid var(--color-border)' }}
                                                                    title={products.slice(3).join(', ')}>
                                                                    +{products.length - 3}
                                                                </span>
                                                            )}
                                                        </div>

                                                        {/* Role count chips — Main / Support */}
                                                        <div className="hidden sm:flex items-center gap-1.5 flex-shrink-0 ml-2">
                                                            {headCount > 0 && (
                                                                <span className="text-[11px] font-bold px-2.5 py-1 rounded-lg"
                                                                    style={{ background: 'var(--color-primary-soft)', color: 'var(--color-primary)' }}>
                                                                    {headCount} Main
                                                                </span>
                                                            )}
                                                            {subCount > 0 && (
                                                                <span className="text-[11px] font-bold px-2.5 py-1 rounded-lg"
                                                                    style={{ background: 'var(--color-surface-2)', color: 'var(--color-text-secondary)', border: '1px solid var(--color-border)' }}>
                                                                    {subCount} Support
                                                                </span>
                                                            )}
                                                        </div>

                                                        {/* Chevron */}
                                                        <ChevronRight className="w-4 h-4 flex-shrink-0 transition-transform ml-1"
                                                            style={{ color: 'var(--color-text-tertiary)', transform: isOpen ? 'rotate(90deg)' : 'rotate(0deg)' }} />
                                                    </button>

                                                    {/* Expanded: task cards + summary chips */}
                                                    <AnimatePresence initial={false}>
                                                        {isOpen && (
                                                            <motion.div
                                                                key="tasks"
                                                                initial={{ height: 0, opacity: 0 }}
                                                                animate={{ height: 'auto', opacity: 1 }}
                                                                exit={{ height: 0, opacity: 0 }}
                                                                transition={{ duration: 0.22, ease: 'easeInOut' }}
                                                                style={{ overflow: 'hidden' }}
                                                            >
                                                                {/* Customer + Product summary section */}
                                                                <div className="px-5 pt-3 pb-2 flex flex-wrap gap-2" style={{ borderTop: '1px solid var(--color-border)' }}>
                                                                    <div className="flex-1 min-w-[180px]">
                                                                        <p className="text-[10px] font-black uppercase tracking-widest mb-1.5" style={{ color: 'var(--color-text-tertiary)' }}>ลูกค้า ({customers.length})</p>
                                                                        <div className="flex flex-wrap gap-1">
                                                                            {customers.map(c => (
                                                                                <span key={c} className="text-[11px] px-2 py-0.5 rounded-full"
                                                                                    style={{ background: 'var(--color-surface-2)', color: 'var(--color-text-secondary)', border: '1px solid var(--color-border)' }}>
                                                                                    {c}
                                                                                </span>
                                                                            ))}
                                                                        </div>
                                                                    </div>
                                                                    <div className="flex-1 min-w-[180px]">
                                                                        <p className="text-[10px] font-black uppercase tracking-widest mb-1.5" style={{ color: 'var(--color-text-tertiary)' }}>Product ({products.length})</p>
                                                                        <div className="flex flex-wrap gap-2">
                                                                            {products.map(p => {
                                                                                if (!p) return null;
                                                                                const proj = projects.find(pr => pr.name === p);
                                                                                return proj?.logo_url ? (
                                                                                    <img key={p} src={proj.logo_url} alt={p} title={p}
                                                                                        className="w-8 h-8 rounded-lg object-contain flex-shrink-0"
                                                                                        style={{ background: 'white', padding: '2px', boxShadow: '0 0 0 1.5px ' + (proj.color ?? '#2563EB') + '55' }} />
                                                                                ) : (
                                                                                    <span key={p}
                                                                                        className="w-8 h-8 rounded-lg flex items-center justify-center text-[10px] font-black text-white flex-shrink-0"
                                                                                        style={{ background: proj?.color ?? '#2563EB' }}
                                                                                        title={p}>
                                                                                        {p.charAt(0)}
                                                                                    </span>
                                                                                );
                                                                            })}
                                                                        </div>
                                                                    </div>
                                                                </div>

                                                                {/* Task cards */}
                                                                <div className="px-4 pb-4 space-y-2" style={{ borderTop: '1px solid var(--color-border)' }}>
                                                                    <p className="text-[10px] font-black uppercase tracking-widest pt-3 pb-1" style={{ color: 'var(--color-text-tertiary)' }}>รายการงาน</p>
                                                                    {items.map((a, idx) => (
                                                                        <motion.div key={a.id}
                                                                            initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }}
                                                                            transition={{ delay: idx * 0.03 }}
                                                                        >
                                                                            <DraggableCard assignment={a} isAdmin={isAdmin}
                                                                                isMine={a.assignee_id === user?.sub}
                                                                                onEdit={x => setAssignModal(x)} onDelete={deleteAssignment} />
                                                                        </motion.div>
                                                                    ))}
                                                                </div>
                                                            </motion.div>
                                                        )}
                                                    </AnimatePresence>
                                                </motion.div>
                                                </Fragment>
                                            );
                                        })}
                                    </div>
                                ) : (
                                    /* ── Regular user: my work + others' ── */
                                    <>
                                        <div className="card p-5">
                                            <SectionHeader label="งานของฉัน" count={myWork.length} color="var(--color-primary)" />
                                            {myWork.length === 0 ? (
                                                <p className="text-sm text-center py-10" style={{ color: 'var(--color-text-tertiary)' }}>
                                                    ยังไม่มีงานที่ถูก Assign ให้คุณ
                                                </p>
                                            ) : myWork.map((a, idx) => (
                                                <motion.div key={a.id}
                                                    initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}
                                                    transition={{ delay: idx * 0.04 }}
                                                    className="mb-3"
                                                >
                                                    <DraggableCard assignment={a} isAdmin={isAdmin} isMine={true}
                                                        onEdit={x => setAssignModal(x)} onDelete={deleteAssignment} />
                                                </motion.div>
                                            ))}
                                        </div>

                                        <div className="card p-5">
                                            <SectionHeader label="งานของทีม" count={othersWork.length} color="#F59E0B" />
                                            {othersWork.length === 0 ? (
                                                <p className="text-sm text-center py-10" style={{ color: 'var(--color-text-tertiary)' }}>
                                                    ไม่มีข้อมูลงานของสมาชิกคนอื่น
                                                </p>
                                            ) : Object.entries(othersGrouped).map(([sub, items]) => (
                                                <div key={sub} className="mb-5 last:mb-0">
                                                    <div className="flex items-center gap-2 mb-2 px-1">
                                                        <PersonAvatar name={items[0].assignee_name ?? sub} colorKey={sub} size="xs" />
                                                        <p className="text-[12px] font-bold" style={{ color: 'var(--color-text-secondary)' }}>
                                                            {items[0].assignee_name ?? items[0].assignee_email ?? sub}
                                                        </p>
                                                        <span className="text-[10px]" style={{ color: 'var(--color-text-tertiary)' }}>
                                                            — {items.length} งาน
                                                        </span>
                                                    </div>
                                                    {items.map((a, idx) => (
                                                        <motion.div key={a.id}
                                                            initial={{ opacity: 0, x: 8 }} animate={{ opacity: 1, x: 0 }}
                                                            transition={{ delay: idx * 0.04 }}
                                                            className="mb-2"
                                                        >
                                                            <DraggableCard assignment={a} isAdmin={isAdmin} isMine={false}
                                                                onEdit={x => setAssignModal(x)} onDelete={deleteAssignment} />
                                                        </motion.div>
                                                    ))}
                                                </div>
                                            ))}
                                        </div>
                                    </>
                                )}
                            </div>
                        )}

                        {tab === 'calendar' && (
                            <div className="card p-5">
                                <div className="flex items-center justify-between mb-4">
                                    <button onClick={() => setViewDate(new Date(year, month - 1, 1))} className="btn-icon">
                                        <ChevronLeft className="w-4 h-4" />
                                    </button>
                                    <h3 className="text-sm font-bold" style={{ color: 'var(--color-text-primary)' }}>
                                        {TH_MONTHS_SHORT[month]} {year + 543}
                                    </h3>
                                    <button onClick={() => setViewDate(new Date(year, month + 1, 1))} className="btn-icon">
                                        <ChevronRight className="w-4 h-4" />
                                    </button>
                                </div>

                                {/* Export button */}
                                <div className="flex items-center gap-2 mb-3">
                                    <button
                                        className="btn gap-1.5 text-[12px]"
                                        onClick={() => setReportOpen(true)}
                                    >
                                        <FileText className="w-3.5 h-3.5" />รายงาน
                                    </button>
                                </div>

                                {/* Legend */}
                                <div className="flex items-center gap-4 mb-3 flex-wrap">
                                    {isAdmin && users.filter(u => u.visible !== false).slice(0, 6).map(u => (
                                        <div key={u.sub} className="flex items-center gap-1.5">
                                            <div className="w-3.5 h-3.5 rounded-full flex items-center justify-center text-[7px] font-bold text-white"
                                                style={{ background: avatarColor(u.sub) }}>
                                                {initials(u.name || u.email).slice(0, 1)}
                                            </div>
                                            <span className="text-[10px]" style={{ color: 'var(--color-text-tertiary)' }}>
                                                {u.name || u.email}
                                            </span>
                                        </div>
                                    ))}
                                </div>

                                <div className="grid grid-cols-7 mb-1">
                                    {TH_DAYS_SHORT.map(d => (
                                        <div key={d} className="text-center text-[10px] font-bold py-1"
                                            style={{ color: 'var(--color-text-tertiary)' }}>{d}</div>
                                    ))}
                                </div>
                                <div className="grid grid-cols-7 gap-1" style={{ overflow: 'visible' }}>
                                    {Array.from({ length: firstDay }).map((_, i) => <div key={`e${i}`} />)}
                                    {Array.from({ length: daysInMonth }).map((_, i) => {
                                        const day     = i + 1;
                                        const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
                                        return (
                                            <CalendarCell
                                                key={day}
                                                dateStr={dateStr}
                                                cellVisits={visitsByDate[dateStr] ?? []}
                                                isToday={dateStr === todayStr}
                                                onClick={setDayDate}
                                                attDots={attByDay[dateStr] ?? []}
                                                onActivityClick={setActivityModal}
                                            />
                                        );
                                    })}
                                </div>
                                <p className="text-[11px] mt-4 text-center" style={{ color: 'var(--color-text-tertiary)' }}>
                                    คลิกวันเพื่อบันทึกการออกพื้นที่
                                </p>
                            </div>
                        )}

                        {tab === 'attendance' && (
                            <AttendanceTab
                                viewDate={viewDate}
                                setViewDate={setViewDate}
                                users={users}
                                isAdmin={isAdmin}
                                onRefresh={refreshAll}
                            />
                        )}
                    </div>
                </div>

                {/* DragOverlay */}
                <DragOverlay>
                    {activeA && (
                        <div className="px-3 py-2 rounded-xl text-sm font-semibold flex items-center gap-2"
                            style={{ background: 'var(--color-surface)', border: '1.5px solid var(--color-primary)', color: 'var(--color-text-primary)', boxShadow: '0 12px 32px rgba(37, 99, 235,0.25)', maxWidth: 240 }}>
                            <Package className="w-4 h-4 flex-shrink-0" style={{ color: 'var(--color-primary)' }} />
                            {activeA.title}
                        </div>
                    )}
                </DragOverlay>
            </DndContext>

            {/* Modals */}
            <AnimatePresence>
                {assignModal !== null && (
                    <AssignmentModal
                        assignment={assignModal}
                        projects={projects}
                        users={users}
                        allAssignments={assignments}
                        onSave={saveAssignment}
                        onClose={() => setAssignModal(null)}
                        onProjectStatus={setProjectStatus}
                        onProjectMeta={setProjectMeta}
                    />
                )}
            </AnimatePresence>
            <AnimatePresence>
                {projectModal !== null && (
                    <ProjectModal
                        project={projectModal}
                        onSave={saveProject}
                        onClose={() => setProjectModal(null)}
                    />
                )}
            </AnimatePresence>
            <AnimatePresence>
                {dayDate !== null && (
                    <DayModal
                        dateStr={dayDate}
                        visitsOnDay={taskVisits.filter(v => v.visit_date.slice(0, 10) === dayDate)}
                        leaveRecords={(attByDay[dayDate] ?? []).filter(a => a.status === 'leave')}
                        allAssignments={assignments}
                        allTaskVisits={taskVisits}
                        isAdmin={isAdmin}
                        users={users}
                        projects={projects}
                        onRefresh={refreshAll}
                        onClose={() => setDayDate(null)}
                    />
                )}
            </AnimatePresence>
            <AnimatePresence>
                {activityModal !== null && (
                    <ActivityDetailModal
                        group={activityModal}
                        onClose={() => setActivityModal(null)}
                    />
                )}
            </AnimatePresence>
            <ReportModal
                open={reportOpen}
                onClose={() => setReportOpen(false)}
                defaultYear={year}
                defaultMonth={month}
            />
        </div>
    );
}
