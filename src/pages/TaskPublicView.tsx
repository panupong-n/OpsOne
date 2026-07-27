import { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { motion } from 'framer-motion';
import { MapPin, Crown, UserCircle2, ShieldAlert } from 'lucide-react';

interface TeamMember {
    id: string;
    task_role: 'head' | 'sub' | null;
    assignee_id: string;
    assignee_name: string;
    assignee_email: string | null;
}

interface TaskDetail {
    id: string;
    title: string;
    description: string | null;
    site: string | null;
    status: string;
    task_role: 'head' | 'sub' | null;
    project_id: string;
    project_name: string | null;
    project_color: string | null;
    project_logo_url: string | null;
    assignee_id: string;
    assignee_name: string;
    assignee_email: string | null;
    created_at: string;
}

const initials = (name: string) => {
    if (!name?.trim()) return '??';
    const p = name.trim().split(/\s+/);
    return p.length >= 2 ? (p[0][0] + p[1][0]).toUpperCase() : name.slice(0, 2).toUpperCase();
};

function PersonRow({ m, lead }: { m: TeamMember; lead?: boolean }) {
    return (
        <motion.div
            initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }}
            className="flex items-center gap-3 px-3.5 py-2.5 rounded-xl"
            style={{ background: 'var(--color-surface-2)', border: '1px solid var(--color-border)' }}
        >
            <div className="w-9 h-9 rounded-full flex items-center justify-center text-[13px] font-semibold text-white shrink-0"
                style={{ background: lead ? 'var(--color-primary)' : '#64748B' }}>
                {initials(m.assignee_name)}
            </div>
            <div className="min-w-0">
                <p className="text-[13.5px] font-semibold truncate" style={{ color: 'var(--color-text-primary)' }}>{m.assignee_name}</p>
                {m.assignee_email && <p className="text-[11px] truncate" style={{ color: 'var(--color-text-tertiary)' }}>{m.assignee_email}</p>}
            </div>
        </motion.div>
    );
}

export default function TaskPublicView() {
    const { taskId, token } = useParams<{ taskId?: string; token?: string }>();
    const [task, setTask] = useState<TaskDetail | null>(null);
    const [teamTasks, setTeamTasks] = useState<TeamMember[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        const url = token ? `/api/preview/task/${token}` : taskId ? `/api/tasks/public/${taskId}` : null;
        if (!url) { setError('no-ref'); setLoading(false); return; }
        fetch(url)
            .then(r => { if (!r.ok) throw new Error(`${r.status}`); return r.json(); })
            .then(data => { setTask(data.task); setTeamTasks(data.teamTasks ?? []); })
            .catch(e => setError(String(e)))
            .finally(() => setLoading(false));
    }, [taskId, token]);

    const accent = task?.project_color || 'var(--color-primary)';
    const heads = teamTasks.filter(t => (t.task_role ?? 'head') === 'head');
    const subs = teamTasks.filter(t => t.task_role === 'sub');

    return (
        <div className="min-h-screen flex flex-col" style={{ background: 'var(--color-bg)' }}>
            {/* Top bar */}
            <div className="px-6 h-14 flex items-center gap-2.5" style={{ background: 'var(--color-surface)', borderBottom: '1px solid var(--color-border)' }}>
                <img src="/TENIX1.png" alt="OpsOne" className="h-6 w-6 object-contain" />
                <div>
                    <p className="text-[12.5px] font-semibold leading-none" style={{ color: 'var(--color-text-primary)' }}>OpsOne</p>
                    <p className="text-[9px] font-medium tracking-[0.16em] uppercase mt-0.5" style={{ color: 'var(--color-text-tertiary)' }}>Task Preview</p>
                </div>
            </div>

            {/* Content */}
            <div className="flex-1 flex items-start justify-center p-5 sm:pt-12">
                {loading && (
                    <div className="flex flex-col items-center gap-3 mt-24">
                        <div className="w-9 h-9 border-[3px] rounded-full animate-spin" style={{ borderColor: 'var(--color-primary)', borderTopColor: 'transparent' }} />
                        <p className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>กำลังโหลด...</p>
                    </div>
                )}

                {!loading && error && (
                    <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="flex flex-col items-center gap-2 mt-24 text-center">
                        <ShieldAlert style={{ width: 38, height: 38, strokeWidth: 1.75 }} className="text-[color:var(--color-error)]" />
                        <p className="text-base font-semibold" style={{ color: 'var(--color-text-primary)' }}>ไม่พบข้อมูลงาน</p>
                        <p className="text-[13px]" style={{ color: 'var(--color-text-tertiary)' }}>ลิงก์อาจหมดอายุ ถูกแก้ไข หรือถูกลบออกแล้ว</p>
                    </motion.div>
                )}

                {!loading && !error && task && (
                    <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }}
                        transition={{ type: 'spring', stiffness: 280, damping: 24 }}
                        className="w-full" style={{ maxWidth: 520 }}>
                        <div className="overflow-hidden" style={{ background: 'var(--color-surface)', borderRadius: 18, border: '1px solid var(--color-border)', boxShadow: '0 8px 32px rgba(15,23,42,0.10)' }}>
                            {/* Accent strip */}
                            <div style={{ height: 4, background: accent }} />

                            {/* Header */}
                            <div className="px-6 pt-5 pb-4" style={{ borderBottom: '1px solid var(--color-border)' }}>
                                <div className="flex items-center gap-2 mb-3">
                                    {task.project_logo_url
                                        ? <img src={task.project_logo_url} alt="" className="w-7 h-7 rounded-lg object-contain" style={{ background: '#fff', padding: 2, boxShadow: `0 0 0 1.5px var(--color-border)` }} />
                                        : <div className="w-7 h-7 rounded-lg flex items-center justify-center font-semibold text-white text-[11px]" style={{ background: accent }}>{(task.project_name ?? 'P')[0]}</div>}
                                    <span className="text-[12px] font-semibold px-2.5 py-0.5 rounded-full" style={{ background: 'var(--color-primary-soft)', color: 'var(--color-primary)' }}>
                                        {task.project_name ?? 'ไม่ระบุ Product'}
                                    </span>
                                </div>
                                <h1 className="text-[21px] font-bold leading-snug" style={{ color: 'var(--color-text-primary)' }}>{task.title || '(ไม่ระบุลูกค้า)'}</h1>
                                {task.site && (
                                    <div className="flex items-center gap-1.5 mt-2">
                                        <MapPin style={{ width: 14, height: 14, strokeWidth: 2 }} className="text-[color:var(--color-warning)] shrink-0" />
                                        <span className="text-[13px]" style={{ color: 'var(--color-text-secondary)' }}>{task.site}</span>
                                    </div>
                                )}
                            </div>

                            {/* Description */}
                            {task.description && (
                                <div className="px-6 py-4" style={{ borderBottom: '1px solid var(--color-border)', background: 'var(--color-surface-2)' }}>
                                    <p className="text-[13px] leading-relaxed" style={{ color: 'var(--color-text-secondary)' }}>{task.description}</p>
                                </div>
                            )}

                            {/* Team */}
                            <div className="px-6 py-5 space-y-5">
                                <p className="text-[11px] font-semibold uppercase tracking-[0.1em]" style={{ color: 'var(--color-text-tertiary)' }}>
                                    ทีมผู้รับผิดชอบ · {teamTasks.length} คน
                                </p>

                                {teamTasks.length === 0 && (
                                    <p className="text-[13px] text-center py-2" style={{ color: 'var(--color-text-tertiary)' }}>ยังไม่มีผู้รับผิดชอบ</p>
                                )}

                                {heads.length > 0 && (
                                    <div className="space-y-2">
                                        <div className="flex items-center gap-1.5 text-[11px] font-semibold" style={{ color: 'var(--color-primary)' }}>
                                            <Crown style={{ width: 13, height: 13, strokeWidth: 2 }} /> Main (Head)
                                        </div>
                                        {heads.map(m => <PersonRow key={m.id} m={m} lead />)}
                                    </div>
                                )}

                                {subs.length > 0 && (
                                    <div className="space-y-2">
                                        <div className="flex items-center gap-1.5 text-[11px] font-semibold" style={{ color: 'var(--color-text-secondary)' }}>
                                            <UserCircle2 style={{ width: 13, height: 13, strokeWidth: 2 }} /> Support (Sub)
                                        </div>
                                        {subs.map(m => <PersonRow key={m.id} m={m} />)}
                                    </div>
                                )}
                            </div>

                            {/* Footer */}
                            <div className="px-6 py-3" style={{ borderTop: '1px solid var(--color-border)', background: 'var(--color-surface-2)' }}>
                                <p className="text-[10px]" style={{ color: 'var(--color-text-tertiary)' }}>OpsOne · Operations Platform · Ten Forward Co., Ltd.</p>
                            </div>
                        </div>
                    </motion.div>
                )}
            </div>
        </div>
    );
}
