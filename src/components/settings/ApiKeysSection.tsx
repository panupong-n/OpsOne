import { confirmDialog } from '../ui/confirm';
import { useState, useEffect, useCallback } from 'react';
import { KeyRound, Plus, Copy, Check, Trash2, ShieldAlert, RefreshCw } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';

// ─── Types ────────────────────────────────────────────────────────────────────
export interface ApiKey {
    id: string;
    name: string;
    key_prefix: string;
    created_by: string | null;
    created_at: string;
    last_used_at: string | null;
    revoked_at: string | null;
}

/** A freshly created key — the plaintext is only ever available right here. */
interface NewApiKey extends ApiKey {
    key: string;
}

const thaiDateTime = (iso: string | null): string => {
    if (!iso) return '—';
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '—';
    return `${d.toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: 'numeric' })} ${d.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' })} น.`;
};

// ─── One-time reveal banner ───────────────────────────────────────────────────
function NewKeyBanner({ newKey, onDismiss }: { newKey: NewApiKey; onDismiss: () => void }) {
    const [copied, setCopied] = useState(false);

    const copy = async () => {
        try {
            await navigator.clipboard.writeText(newKey.key);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        } catch { /* clipboard unavailable — user can select the text manually */ }
    };

    return (
        <div className="rounded-xl p-3.5 mb-3" style={{ background: '#ECFDF5', border: '1px solid #10B98140' }}>
            <div className="flex items-center gap-2 mb-2">
                <ShieldAlert className="w-4 h-4 flex-shrink-0" style={{ color: '#059669' }} />
                <p className="text-[12px] font-bold" style={{ color: '#065F46' }}>
                    คัดลอก Key นี้เก็บไว้ทันที — จะแสดงเพียงครั้งเดียวเท่านั้น
                </p>
            </div>
            <p className="text-[11px] mb-2" style={{ color: '#047857' }}>
                ระบบเก็บเฉพาะค่า hash ของ Key จึงไม่สามารถดูย้อนหลังได้ หากทำหาย ให้สร้างใหม่และเพิกถอนอันเดิม
            </p>
            <div className="flex items-center gap-2">
                <code className="flex-1 text-[11px] font-mono px-2.5 py-2 rounded-lg break-all select-all"
                    style={{ background: '#fff', border: '1px solid #10B98140', color: '#065F46' }}>
                    {newKey.key}
                </code>
                <button onClick={copy}
                    className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-[12px] font-semibold flex-shrink-0 transition-colors"
                    style={{ background: '#059669', color: '#fff' }}>
                    {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                    {copied ? 'คัดลอกแล้ว' : 'คัดลอก'}
                </button>
            </div>
            <button onClick={onDismiss} className="text-[11px] mt-2 underline" style={{ color: '#047857' }}>
                ปิดข้อความนี้ (เก็บ Key เรียบร้อยแล้ว)
            </button>
        </div>
    );
}

// ─── Section ──────────────────────────────────────────────────────────────────
export default function ApiKeysSection({ canEdit = true }: { canEdit?: boolean }) {
    const { accessToken } = useAuth();
    const [keys, setKeys] = useState<ApiKey[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [name, setName] = useState('');
    const [creating, setCreating] = useState(false);
    const [newKey, setNewKey] = useState<NewApiKey | null>(null);
    const [revoking, setRevoking] = useState<string | null>(null);

    const authHeaders = useCallback(
        (): HeadersInit => ({ 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken ?? ''}` }),
        [accessToken],
    );

    const fetchKeys = useCallback(async () => {
        if (!accessToken) { setLoading(false); return; }
        setLoading(true);
        try {
            const res = await fetch('/api/settings/api-keys', { headers: authHeaders() });
            const json = await res.json();
            if (!res.ok) throw new Error(json.error || 'โหลดรายการ Key ไม่สำเร็จ');
            setKeys(json.data);
            setError(null);
        } catch (e) {
            setError(e instanceof Error ? e.message : 'โหลดรายการ Key ไม่สำเร็จ');
        }
        setLoading(false);
    }, [accessToken, authHeaders]);

    useEffect(() => { fetchKeys(); }, [fetchKeys]);

    const createKey = async () => {
        const trimmed = name.trim();
        if (!trimmed) { setError('กรุณาตั้งชื่อ Key เพื่อให้รู้ว่าใช้กับระบบใด'); return; }
        setCreating(true);
        try {
            const res = await fetch('/api/settings/api-keys', {
                method: 'POST', headers: authHeaders(), body: JSON.stringify({ name: trimmed }),
            });
            const json = await res.json();
            if (!res.ok) throw new Error(json.error || 'สร้าง Key ไม่สำเร็จ');
            setNewKey(json.data);
            setName('');
            setError(null);
            await fetchKeys();
        } catch (e) {
            setError(e instanceof Error ? e.message : 'สร้าง Key ไม่สำเร็จ');
        }
        setCreating(false);
    };

    const revokeKey = async (id: string, keyName: string) => {
        if (!(await confirmDialog({ title: 'เพิกถอน API Key?', message: `Key "${keyName}"\n\nระบบภายนอกที่ใช้ Key นี้จะเรียก API ไม่ได้ทันที และย้อนกลับไม่ได้`, confirmText: 'เพิกถอน' }))) return;
        setRevoking(id);
        try {
            const res = await fetch(`/api/settings/api-keys/${id}`, { method: 'DELETE', headers: authHeaders() });
            const json = await res.json();
            if (!res.ok) throw new Error(json.error || 'เพิกถอน Key ไม่สำเร็จ');
            await fetchKeys();
            setError(null);
        } catch (e) {
            setError(e instanceof Error ? e.message : 'เพิกถอน Key ไม่สำเร็จ');
        }
        setRevoking(null);
    };

    const activeCount = keys.filter(k => !k.revoked_at).length;

    const origin = typeof window !== 'undefined' ? window.location.origin : '';
    const revokedCount = keys.length - activeCount;

    return (
        <div className="space-y-5">
            {/* Overview strip */}
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                {[
                    { label: 'Key ที่ใช้งานอยู่', value: activeCount, color: '#10B981' },
                    { label: 'เพิกถอนแล้ว', value: revokedCount, color: 'var(--color-text-tertiary)' },
                    { label: 'สิทธิ์การเข้าถึง', value: 'Read-only', color: 'var(--color-primary)' },
                ].map(s => (
                    <div key={s.label} className="rounded-xl px-4 py-3"
                        style={{ background: 'var(--color-surface-2)', border: '1px solid var(--color-border)' }}>
                        <p className="text-[17px] font-bold leading-tight" style={{ color: s.color }}>{s.value}</p>
                        <p className="text-[11px] mt-0.5" style={{ color: 'var(--color-text-tertiary)' }}>{s.label}</p>
                    </div>
                ))}
            </div>

            <p className="text-[11.5px] leading-relaxed" style={{ color: 'var(--color-text-tertiary)' }}>
                Key ใช้ให้ระบบภายนอกดึงข้อมูล Asset Inventory ครบทุกรายละเอียด (ข้อมูลเครื่อง, ประวัติการโอนย้าย,
                แผนและประวัติการบำรุงรักษา) โดยไม่ต้องเปิดรหัสฐานข้อมูล — <strong>อ่านได้อย่างเดียว</strong> เขียน/แก้ไขไม่ได้
            </p>

            {newKey && <NewKeyBanner newKey={newKey} onDismiss={() => setNewKey(null)} />}

            {error && (
                <div className="rounded-lg px-3 py-2 text-[11.5px]" style={{ background: '#FEF2F2', border: '1px solid #EF444440', color: '#991B1B' }}>
                    {error}
                </div>
            )}

            {/* Create */}
            {canEdit ? (
                <div className="rounded-xl p-3.5" style={{ background: 'var(--color-surface-2)', border: '1px solid var(--color-border)' }}>
                    <p className="text-[11px] font-bold uppercase tracking-wider mb-2" style={{ color: 'var(--color-text-tertiary)' }}>
                        สร้าง Key ใหม่
                    </p>
                    <div className="flex items-center gap-2">
                        <input
                            value={name}
                            onChange={e => setName(e.target.value)}
                            onKeyDown={e => { if (e.key === 'Enter') createKey(); }}
                            placeholder="ชื่อ Key เช่น Power BI, ระบบบัญชี, n8n"
                            maxLength={120}
                            className="flex-1 px-3 py-2 rounded-lg text-[12px] outline-none"
                            style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', color: 'var(--color-text-primary)' }}
                        />
                        <button
                            onClick={createKey}
                            disabled={creating || !accessToken}
                            className="flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-[12px] font-semibold flex-shrink-0 transition-colors disabled:opacity-50"
                            style={{ background: 'var(--color-primary)', color: '#fff' }}
                        >
                            {creating ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
                            Generate Key
                        </button>
                    </div>
                </div>
            ) : null}

            {/* List — card per key */}
            <div>
                <div className="flex items-center gap-2 mb-2">
                    <KeyRound className="w-4 h-4" style={{ color: 'var(--color-primary)' }} />
                    <span className="text-[12px] font-bold" style={{ color: 'var(--color-text-primary)' }}>Key ทั้งหมด</span>
                </div>

                {loading ? (
                    <div className="flex items-center justify-center py-8">
                        <RefreshCw className="w-4 h-4 animate-spin" style={{ color: 'var(--color-text-tertiary)' }} />
                    </div>
                ) : keys.length === 0 ? (
                    <div className="text-center py-8 rounded-xl" style={{ border: '1px dashed var(--color-border)' }}>
                        <KeyRound className="w-8 h-8 mx-auto mb-2 opacity-30" style={{ color: 'var(--color-text-tertiary)' }} />
                        <p className="text-[12px]" style={{ color: 'var(--color-text-tertiary)' }}>
                            {canEdit ? 'ยังไม่มี API Key — กด "Generate Key" เพื่อสร้างอันแรก' : 'ยังไม่มี API Key'}
                        </p>
                    </div>
                ) : (
                    <div className="space-y-2">
                        {keys.map(k => {
                            const revoked = !!k.revoked_at;
                            return (
                                <div key={k.id} className="rounded-xl px-4 py-3"
                                    style={{
                                        background: 'var(--color-surface)',
                                        border: `1px solid ${revoked ? 'var(--color-border)' : 'var(--color-border)'}`,
                                        opacity: revoked ? 0.6 : 1,
                                    }}>
                                    <div className="flex items-start justify-between gap-3">
                                        <div className="min-w-0 flex-1">
                                            <div className="flex items-center gap-2 flex-wrap">
                                                <p className="text-[13px] font-bold truncate" style={{ color: 'var(--color-text-primary)' }}>{k.name}</p>
                                                <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full flex-shrink-0"
                                                    style={revoked
                                                        ? { background: '#FEF2F2', color: '#991B1B' }
                                                        : { background: 'rgba(16,185,129,0.12)', color: '#059669' }}>
                                                    {revoked ? 'เพิกถอนแล้ว' : 'ใช้งานอยู่'}
                                                </span>
                                            </div>
                                            <code className="inline-block mt-1.5 text-[11px] font-mono px-2 py-0.5 rounded"
                                                style={{ background: 'var(--color-surface-2)', color: 'var(--color-text-secondary)' }}>
                                                {k.key_prefix}••••••••••••
                                            </code>
                                        </div>
                                        {!revoked && canEdit && (
                                            <button
                                                onClick={() => revokeKey(k.id, k.name)}
                                                disabled={revoking === k.id}
                                                className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 disabled:opacity-50"
                                                style={{ background: '#EF444412', color: '#EF4444', border: '1px solid #EF444430' }}
                                                title="เพิกถอน Key นี้"
                                            >
                                                {revoking === k.id ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                                            </button>
                                        )}
                                    </div>

                                    <div className="flex flex-wrap gap-x-5 gap-y-1 mt-2.5 pt-2.5 text-[10.5px]"
                                        style={{ borderTop: '1px solid var(--color-border)', color: 'var(--color-text-tertiary)' }}>
                                        <span>สร้างเมื่อ <b style={{ color: 'var(--color-text-secondary)' }}>{thaiDateTime(k.created_at)}</b></span>
                                        <span>ใช้ล่าสุด <b style={{ color: 'var(--color-text-secondary)' }}>{thaiDateTime(k.last_used_at)}</b></span>
                                        {k.created_by && <span>โดย <b style={{ color: 'var(--color-text-secondary)' }}>{k.created_by}</b></span>}
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>

            {/* Endpoint reference */}
            <div className="rounded-xl p-4" style={{ background: 'var(--color-surface-2)', border: '1px solid var(--color-border)' }}>
                <p className="text-[11px] font-bold uppercase tracking-wider mb-2.5" style={{ color: 'var(--color-text-tertiary)' }}>
                    วิธีเรียกใช้
                </p>
                <code className="block text-[10.5px] font-mono leading-relaxed break-all mb-3 px-2.5 py-2 rounded-lg"
                    style={{ background: 'var(--color-surface)', color: 'var(--color-text-secondary)', border: '1px solid var(--color-border)' }}>
                    curl -H &quot;x-api-key: &lt;KEY&gt;&quot; {origin}/api/v1/inventory/assets?include=all
                </code>
                <div className="space-y-1.5">
                    {[
                        { m: 'GET', p: '/api/v1/inventory/assets', d: 'รายการทรัพย์สินทั้งหมด (filter + pagination)' },
                        { m: 'GET', p: '/api/v1/inventory/assets/:id', d: 'ข้อมูลเครื่องเดียวแบบเต็ม' },
                        { m: 'GET', p: '/api/v1/inventory/summary', d: 'สรุปยอดตามประเภท/สถานะ' },
                    ].map(e => (
                        <div key={e.p} className="flex items-center gap-2 text-[10.5px]">
                            <span className="font-bold px-1.5 py-0.5 rounded flex-shrink-0"
                                style={{ background: 'rgba(16,185,129,0.12)', color: '#059669' }}>{e.m}</span>
                            <code className="font-mono flex-shrink-0" style={{ color: 'var(--color-text-primary)' }}>{e.p}</code>
                            <span className="truncate" style={{ color: 'var(--color-text-tertiary)' }}>— {e.d}</span>
                        </div>
                    ))}
                </div>
                <p className="text-[10px] mt-2.5" style={{ color: 'var(--color-text-tertiary)' }}>
                    <code>include=all</code> แนบประวัติการโอนย้าย + ข้อมูลบำรุงรักษาครบทุกรอบ · limit สูงสุด 1000 ต่อหน้า (ใช้ offset เพื่อดึงต่อ)
                </p>
            </div>
        </div>
    );
}
