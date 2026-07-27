import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Modal } from '../components/ui/modal';
import {
    Plus, FolderKanban, RefreshCw, Trash2,
    AlertTriangle, BarChart3, CalendarRange,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { formatThaiDate } from '../components/ThaiDatePicker';

interface PmProject {
    id: string; name: string; description: string | null; color: string;
    status: string; start_date: string | null; end_date: string | null;
    created_by: string | null; created_at: string; updated_at: string;
    updated_by: string | null;
    created_by_name?: string | null; created_by_email?: string | null;
    updated_by_name?: string | null; updated_by_email?: string | null;
    ticket_count?: number;
}

async function api<T>(path: string, opts?: RequestInit): Promise<T> {
    const res = await fetch(path, opts);
    if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
    if (res.status === 204) return undefined as T;
    return res.json();
}

const AVATAR_COLORS = ['#2563EB','#0EA5E9','#3B82F6','#1D4ED8','#0891B2','#6366F1'];
const avatarColor = (s: string) => { let h = 0; for (let i = 0; i < s.length; i++) h = s.charCodeAt(i) + ((h << 5) - h); return AVATAR_COLORS[Math.abs(h) % AVATAR_COLORS.length]; };
const initials = (name: string) => { if (!name?.trim()) return '??'; const p = name.trim().split(/\s+/); return p.length >= 2 ? (p[0][0] + p[1][0]).toUpperCase() : name.slice(0, 2).toUpperCase(); };

export default function ProjectList() {
    const { user } = useAuth();
    const navigate = useNavigate();
    const [projects, setProjects] = useState<PmProject[]>([]);
    const [loading, setLoading] = useState(true);
    const [showNew, setShowNew] = useState(false);
    const [newName, setNewName] = useState('');
    const [newColor, setNewColor] = useState('#2563EB');
    const [newDesc, setNewDesc] = useState('');
    const [creating, setCreating] = useState(false);
    const [createError, setCreateError] = useState('');
    const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
    const [deleteError, setDeleteError] = useState('');

    const COLORS = ['#2563EB','#1D4ED8','#0EA5E9','#0891B2','#10B981','#F59E0B','#EF4444','#6366F1'];
    const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'closed'>('all');

    const loadProjects = useCallback(async () => {
        setLoading(true);
        try {
            const prjs = await api<PmProject[]>('/api/pm/projects');
            setProjects(prjs);
        } catch (e) { console.error(e); }
        setLoading(false);
    }, []);

    useEffect(() => { loadProjects(); }, [loadProjects]);

    const createProject = async () => {
        if (!newName.trim()) return;
        setCreating(true);
        setCreateError('');
        try {
            const proj = await api<PmProject>('/api/pm/projects', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name: newName.trim(), description: newDesc || null, color: newColor, created_by: user?.sub }),
            });
            setShowNew(false); setNewName(''); setNewDesc(''); setNewColor('#2563EB');
            navigate(`/pm/${proj.id}`);
        } catch (e) {
            setCreateError('เกิดข้อผิดพลาด กรุณาลองใหม่');
            console.error(e);
        }
        setCreating(false);
    };

    const deleteProject = async (id: string) => {
        setDeleteError('');
        try {
            await api(`/api/pm/projects/${id}`, { method: 'DELETE' });
            setConfirmDelete(null);
            await loadProjects();
        } catch (e) {
            console.error(e);
            setDeleteError('ลบไม่สำเร็จ กรุณาลองใหม่');
        }
    };

    const visible = projects.filter(p =>
        statusFilter === 'all' ? true : statusFilter === 'closed' ? p.status === 'closed' : p.status !== 'closed',
    );

    return (
        <div className="space-y-6">
            {/* Toolbar */}
            <div className="flex items-center justify-end gap-2 flex-wrap">
                <div className="flex items-center rounded-lg overflow-hidden mr-auto" style={{ border: '1px solid var(--color-border)' }}>
                    {([['all', 'ทั้งหมด'], ['active', 'เปิดอยู่'], ['closed', 'ปิดแล้ว']] as const).map(([v, label]) => (
                        <button key={v} onClick={() => setStatusFilter(v)}
                            className="px-3 h-9 text-[12px] font-semibold transition-colors"
                            style={{
                                background: statusFilter === v ? 'var(--color-primary)' : 'var(--color-surface)',
                                color: statusFilter === v ? '#fff' : 'var(--color-text-secondary)',
                            }}>
                            {label}
                        </button>
                    ))}
                </div>
                <button className="btn-icon" onClick={loadProjects} title="รีเฟรช"><RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} /></button>
                <button className="btn btn-primary flex items-center gap-1.5" onClick={() => setShowNew(true)}>
                    <Plus className="w-4 h-4" /><span className="text-[13px]">โครงการใหม่</span>
                </button>
            </div>

            {/* Create New Project Modal */}
            {showNew && (
                <Modal isOpen onClose={() => setShowNew(false)} showCloseButton={false}
                    className="w-full max-w-md m-4 p-6">
                            <h3 className="text-base font-bold mb-4" style={{ color: 'var(--color-text-primary)' }}>สร้างโปรเจกต์ใหม่</h3>
                            <div className="space-y-3">
                                <div>
                                    <label className="text-[12px] font-semibold mb-1.5 block" style={{ color: 'var(--color-text-secondary)' }}>ชื่อโปรเจกต์ <span className="text-red-400">*</span></label>
                                    <input className="field-input" value={newName} onChange={e => { setNewName(e.target.value); setCreateError(''); }} placeholder="ชื่อโปรเจกต์..."
                                        onKeyDown={e => { if (e.key === 'Enter') createProject(); }} autoFocus />
                                </div>
                                <div>
                                    <label className="text-[12px] font-semibold mb-1.5 block" style={{ color: 'var(--color-text-secondary)' }}>คำอธิบาย</label>
                                    <textarea className="field-input resize-none" rows={2} value={newDesc} onChange={e => setNewDesc(e.target.value)} placeholder="คำอธิบายโปรเจกต์..." />
                                </div>
                                <div>
                                    <label className="text-[12px] font-semibold mb-1.5 block" style={{ color: 'var(--color-text-secondary)' }}>สี</label>
                                    <div className="flex gap-2">
                                        {COLORS.map(c => (
                                            <button key={c} className="w-7 h-7 rounded-full transition-transform"
                                                style={{ background: c, transform: newColor === c ? 'scale(1.25)' : 'scale(1)', boxShadow: newColor === c ? `0 0 0 2px white, 0 0 0 4px ${c}` : 'none' }}
                                                onClick={() => setNewColor(c)} />
                                        ))}
                                    </div>
                                </div>
                            </div>
                            {createError && (
                                <p className="text-[12px] mt-3 px-3 py-2 rounded-lg" style={{ background: 'var(--color-error-soft)', color: 'var(--color-error)', border: '1px solid var(--color-error)' }}>
                                    {createError}
                                </p>
                            )}
                            <div className="flex justify-end gap-2 mt-5">
                                <button className="btn" onClick={() => { setShowNew(false); setCreateError(''); }}>ยกเลิก</button>
                                <button className="btn btn-primary" disabled={!newName.trim() || creating} onClick={createProject}>
                                    {creating ? 'กำลังสร้าง...' : 'สร้าง'}
                                </button>
                            </div>
                </Modal>
            )}

            {/* Loading */}
            {loading && (
                <div className="flex items-center justify-center py-20">
                    <RefreshCw className="w-6 h-6 animate-spin" style={{ color: 'var(--color-text-tertiary)' }} />
                    <span className="ml-3 text-sm" style={{ color: 'var(--color-text-tertiary)' }}>กำลังโหลด...</span>
                </div>
            )}

            {/* Empty state */}
            {!loading && visible.length === 0 && (
                <div className="text-center py-20">
                    <FolderKanban className="w-16 h-16 mx-auto mb-4" style={{ color: 'var(--color-text-tertiary)', opacity: 0.4 }} />
                    <p className="text-base font-semibold mb-1" style={{ color: 'var(--color-text-secondary)' }}>ยังไม่มีโปรเจกต์</p>
                    <p className="text-[13px] mb-4" style={{ color: 'var(--color-text-tertiary)' }}>เริ่มต้นสร้างโปรเจกต์แรกของคุณ</p>
                    <button className="btn btn-primary" onClick={() => setShowNew(true)}>
                        <Plus className="w-4 h-4 mr-1.5 inline" />สร้างโปรเจกต์
                    </button>
                </div>
            )}

            {/* Project Cards */}
            {!loading && visible.length > 0 && (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {visible.map((p) => (
                        <div key={p.id}
                            className="group rounded-2xl cursor-pointer transition-all hover:shadow-lg"
                            style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}
                            onClick={() => navigate(`/pm/${p.id}`)}>
                            {/* Color bar */}
                            <div className="h-1.5 rounded-t-2xl" style={{ background: p.color }} />
                            <div className="p-5">
                                {/* Title row */}
                                <div className="flex items-start justify-between mb-3">
                                    <div className="flex items-center gap-2.5 min-w-0">
                                        <div className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0" style={{ background: p.color + '18' }}>
                                            <FolderKanban className="w-4.5 h-4.5" style={{ color: p.color }} />
                                        </div>
                                        <div className="min-w-0">
                                            <h3 className="text-[15px] font-bold truncate" style={{ color: 'var(--color-text-primary)' }}>{p.name}</h3>
                                            {p.description && (
                                                <p className="text-[12px] truncate mt-0.5" style={{ color: 'var(--color-text-tertiary)' }}>{p.description}</p>
                                            )}
                                        </div>
                                    </div>
                                    <button onClick={e => { e.stopPropagation(); setConfirmDelete(p.id); }}
                                        className="opacity-0 group-hover:opacity-100 transition-opacity btn-icon flex-shrink-0 ml-2" title="ลบโปรเจกต์">
                                        <Trash2 className="w-3.5 h-3.5 text-red-400" />
                                    </button>
                                </div>

                                {/* Stats row */}
                                <div className="flex items-center gap-3 mb-4 flex-wrap">
                                    <div className="flex items-center gap-1">
                                        <BarChart3 className="w-3 h-3" style={{ color: 'var(--color-text-tertiary)' }} />
                                        <span className="text-[11px] font-semibold" style={{ color: 'var(--color-text-secondary)' }}>{p.ticket_count ?? 0} งาน</span>
                                    </div>
                                    <span className="text-[10px] font-bold px-2 py-0.5 rounded-full"
                                        style={{
                                            background: p.status === 'closed' ? 'var(--color-surface-2)' : 'var(--color-success-soft)',
                                            color: p.status === 'closed' ? 'var(--color-text-tertiary)' : 'var(--color-success)',
                                        }}>
                                        {p.status === 'closed' ? 'ปิดแล้ว' : p.status === 'active' ? 'เปิดอยู่' : p.status}
                                    </span>
                                    {(p.start_date || p.end_date) && (
                                        <span className="flex items-center gap-1 text-[10px]" style={{ color: 'var(--color-text-tertiary)' }}>
                                            <CalendarRange className="w-3 h-3" />
                                            {p.start_date ? formatThaiDate(p.start_date) : '—'} → {p.end_date ? formatThaiDate(p.end_date) : '—'}
                                        </span>
                                    )}
                                </div>

                                {/* Meta info */}
                                <div className="space-y-2 pt-3" style={{ borderTop: '1px solid var(--color-border)' }}>
                                    {/* Created by */}
                                    <div className="flex items-center gap-2">
                                        <span className="text-[10px] font-semibold w-14 flex-shrink-0" style={{ color: 'var(--color-text-tertiary)' }}>สร้างโดย</span>
                                        {p.created_by_name ? (
                                            <div className="flex items-center gap-1.5">
                                                <div className="w-5 h-5 rounded-full flex items-center justify-center text-[8px] font-bold text-white" style={{ background: avatarColor(p.created_by ?? '') }}>
                                                    {initials(p.created_by_name)}
                                                </div>
                                                <span className="text-[11px] font-medium" style={{ color: 'var(--color-text-secondary)' }}>{p.created_by_name}</span>
                                            </div>
                                        ) : (
                                            <span className="text-[11px]" style={{ color: 'var(--color-text-tertiary)' }}>—</span>
                                        )}
                                        <span className="text-[10px] ml-auto" style={{ color: 'var(--color-text-tertiary)' }}>
                                            {formatThaiDate(p.created_at)}{' '}
                                            {new Date(p.created_at).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' })} น.
                                        </span>
                                    </div>
                                    {/* Updated by */}
                                    <div className="flex items-center gap-2">
                                        <span className="text-[10px] font-semibold w-14 flex-shrink-0" style={{ color: 'var(--color-text-tertiary)' }}>อัพเดท</span>
                                        {p.updated_by_name ? (
                                            <div className="flex items-center gap-1.5">
                                                <div className="w-5 h-5 rounded-full flex items-center justify-center text-[8px] font-bold text-white" style={{ background: avatarColor(p.updated_by ?? '') }}>
                                                    {initials(p.updated_by_name)}
                                                </div>
                                                <span className="text-[11px] font-medium" style={{ color: 'var(--color-text-secondary)' }}>{p.updated_by_name}</span>
                                            </div>
                                        ) : (
                                            <span className="text-[11px]" style={{ color: 'var(--color-text-tertiary)' }}>—</span>
                                        )}
                                        <span className="text-[10px] ml-auto" style={{ color: 'var(--color-text-tertiary)' }}>
                                            {formatThaiDate(p.updated_at)}{' '}
                                            {new Date(p.updated_at).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' })} น.
                                        </span>
                                    </div>
                                </div>
                            </div>
                        </div>
                    ))}
                </div>
            )}

            {/* Confirm Delete Modal */}
            {confirmDelete && (
                <Modal isOpen onClose={() => { setConfirmDelete(null); setDeleteError(''); }} showCloseButton={false}
                    className="w-[380px] max-w-[calc(100vw-2rem)] m-4 p-6">
                            <div className="flex items-center gap-3 mb-4">
                                <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: 'var(--color-error-soft)' }}>
                                    <AlertTriangle className="w-5 h-5" style={{ color: 'var(--color-error)' }} />
                                </div>
                                <h3 className="text-[15px] font-bold" style={{ color: 'var(--color-text-primary)' }}>ลบโปรเจกต์</h3>
                            </div>
                            {(() => { const proj = projects.find(p => p.id === confirmDelete); return proj ? (
                                <p className="text-[13px] font-semibold mb-2 px-3 py-2 rounded-xl truncate" style={{ background: proj.color + '18', color: proj.color }}>
                                    {proj.name}
                                </p>
                            ) : null; })()}
                            <p className="text-[13px] mb-4" style={{ color: 'var(--color-text-secondary)' }}>
                                ต้องการลบโปรเจกต์นี้? ข้อมูล Ticket, Milestone, Sprint ทั้งหมดจะถูกลบด้วย
                            </p>
                            {deleteError && (
                                <p className="text-[12px] mb-4 px-3 py-2 rounded-lg" style={{ background: 'var(--color-error-soft)', color: 'var(--color-error)', border: '1px solid var(--color-error)' }}>
                                    {deleteError}
                                </p>
                            )}
                            <div className="flex justify-end gap-2">
                                <button onClick={() => { setConfirmDelete(null); setDeleteError(''); }} className="px-4 py-2 text-[13px] font-semibold rounded-xl"
                                    style={{ color: 'var(--color-text-secondary)', background: 'var(--color-surface-2)', border: '1px solid var(--color-border)' }}>ยกเลิก</button>
                                <button onClick={() => deleteProject(confirmDelete)} className="px-4 py-2 text-[13px] font-semibold rounded-xl text-white" style={{ background: 'var(--color-error)' }}>ลบ</button>
                            </div>
                </Modal>
            )}
        </div>
    );
}
