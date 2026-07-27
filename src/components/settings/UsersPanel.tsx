import { useState, useEffect, useCallback, useMemo } from 'react';
import { Eye, EyeOff, Search, Users, Layers, Trash2, Pencil, Check, X } from 'lucide-react';
import { toast } from 'sonner';
import PersonAvatar from '../ui/avatar/PersonAvatar';
import { confirmDialog } from '../ui/confirm';
import { roleLabel } from '../../lib/permissions';
import { groupByTeam } from '../../lib/teams';
import GroupPicker from './GroupPicker';
import type { PlatformUser, UserGroup } from './types';

function authHeaders(): Record<string, string> {
  const h: Record<string, string> = { 'Content-Type': 'application/json' };
  try {
    const raw = sessionStorage.getItem('tencyber_session');
    const token = raw ? JSON.parse(raw)?.accessToken : '';
    if (token) h['Authorization'] = `Bearer ${token}`;
  } catch { /* no session */ }
  return h;
}

export default function UsersPanel({ canEdit }: { canEdit: boolean }) {
  const [users, setUsers] = useState<PlatformUser[]>([]);
  const [groups, setGroups] = useState<UserGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [groupFilter, setGroupFilter] = useState('');
  const [manageGroups, setManageGroups] = useState(false);

  const load = useCallback(async () => {
    try {
      const [u, g] = await Promise.all([
        fetch('/api/users').then(r => r.json()),
        fetch('/api/user-groups').then(r => r.json()),
      ]);
      setUsers(Array.isArray(u) ? u : []);
      setGroups(Array.isArray(g) ? g : []);
    } catch {
      toast.error('โหลดข้อมูลผู้ใช้ไม่สำเร็จ');
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  const updateUser = async (sub: string, updates: { user_group?: string; visible?: boolean }) => {
    setSaving(sub);
    const prev = users;
    setUsers(cur => cur.map(u => (u.sub === sub ? { ...u, ...updates } : u)));   // optimistic
    try {
      const res = await fetch(`/api/users/${sub}`, {
        method: 'PATCH', headers: authHeaders(), body: JSON.stringify(updates),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'บันทึกไม่สำเร็จ');
      load();
    } catch (e) {
      setUsers(prev);                                                            // rollback
      toast.error(e instanceof Error ? e.message : 'บันทึกไม่สำเร็จ');
    } finally {
      setSaving(null);
    }
  };

  const createGroup = async (name: string): Promise<UserGroup | null> => {
    try {
      const res = await fetch('/api/user-groups', {
        method: 'POST', headers: authHeaders(), body: JSON.stringify({ name }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'สร้างกลุ่มไม่สำเร็จ');
      const g = await res.json();
      await load();
      toast.success(`สร้างกลุ่ม "${name}" แล้ว`);
      return g;
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'สร้างกลุ่มไม่สำเร็จ');
      return null;
    }
  };

  const filtered = useMemo(() => users.filter(u => {
    if (groupFilter && (u.user_group ?? '').trim() !== groupFilter) return false;
    if (search) {
      const s = search.toLowerCase();
      if (!u.name?.toLowerCase().includes(s) && !u.email?.toLowerCase().includes(s)) return false;
    }
    return true;
  }), [users, search, groupFilter]);

  const visibleCount = users.filter(u => u.visible !== false).length;

  return (
    <div className="space-y-4">
      {/* Summary + filters */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[180px]">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--color-text-tertiary)' }} />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="ค้นหาชื่อ หรืออีเมล..."
            className="w-full pl-9 pr-3 py-2 rounded-lg text-[13px] outline-none"
            style={{ background: 'var(--color-surface-2)', border: '1px solid var(--color-border)', color: 'var(--color-text-primary)' }} />
        </div>
        <select value={groupFilter} onChange={e => setGroupFilter(e.target.value)}
          className="px-3 py-2 rounded-lg text-[13px] outline-none"
          style={{ background: 'var(--color-surface-2)', border: '1px solid var(--color-border)', color: 'var(--color-text-primary)' }}>
          <option value="">ทุกกลุ่ม</option>
          {groups.map(g => <option key={g.id} value={g.name}>{g.name} ({g.member_count})</option>)}
        </select>
        {canEdit && (
          <button onClick={() => setManageGroups(v => !v)}
            className="px-3 py-2 rounded-lg text-[13px] font-semibold inline-flex items-center gap-1.5"
            style={{ background: manageGroups ? 'var(--color-primary)' : 'var(--color-surface-2)', color: manageGroups ? '#fff' : 'var(--color-text-primary)', border: '1px solid var(--color-border)' }}>
            <Layers className="w-4 h-4" /> จัดการกลุ่ม
          </button>
        )}
      </div>

      {manageGroups && canEdit && (
        <GroupManager groups={groups} onChanged={load} onCreate={createGroup} />
      )}

      <div className="flex items-center gap-2 text-[11px]" style={{ color: 'var(--color-text-tertiary)' }}>
        <Users className="w-3.5 h-3.5" />
        แสดง {visibleCount} / {users.length} คน · ผู้ใช้ที่ถูกซ่อนยังเข้าระบบได้ แต่ชื่อจะไม่ปรากฏใน Dashboard และปฏิทิน
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-10">
          <div className="w-5 h-5 border-2 rounded-full animate-spin" style={{ borderColor: 'var(--color-border)', borderTopColor: 'transparent' }} />
        </div>
      ) : (
        <div className="space-y-1">
          <div className="grid items-center gap-3 px-3 py-2" style={{ gridTemplateColumns: '1fr 160px 72px', color: 'var(--color-text-tertiary)' }}>
            <span className="text-[11px] font-semibold uppercase tracking-wider">ผู้ใช้งาน</span>
            <span className="text-[11px] font-semibold uppercase tracking-wider text-center">กลุ่ม</span>
            <span className="text-[11px] font-semibold uppercase tracking-wider text-center">แสดงผล</span>
          </div>

          {groupByTeam(filtered).map(([team, members]) => (
            <div key={team}>
              {/* Group heading — Cyber first, interns last, ungrouped bottom */}
              <div className="flex items-center gap-2 px-3 pt-3 pb-1.5">
                <span className="text-[11px] font-bold" style={{ color: 'var(--color-text-secondary)' }}>{team}</span>
                <span className="text-[10px] px-1.5 py-0.5 rounded-full font-semibold"
                  style={{ background: 'var(--color-surface-2)', color: 'var(--color-text-tertiary)' }}>{members.length} คน</span>
                <span className="flex-1 h-px" style={{ background: 'var(--color-border)' }} />
              </div>

              {members.map(u => (
            <div key={u.sub} className="grid items-center gap-3 px-3 py-2.5 rounded-xl"
              style={{
                gridTemplateColumns: '1fr 160px 72px',
                background: u.visible === false ? 'var(--color-surface-2)' : 'transparent',
                opacity: u.visible === false ? 0.6 : 1,
              }}>
              <div className="flex items-center gap-3 min-w-0">
                <PersonAvatar name={u.name} colorKey={u.sub} size="md" />
                <div className="min-w-0">
                  <p className="text-[12px] font-semibold truncate" style={{ color: 'var(--color-text-primary)' }}>{u.name}</p>
                  <p className="text-[10px] truncate" style={{ color: 'var(--color-text-tertiary)' }}>
                    {u.email} · {roleLabel(u.role)}
                  </p>
                </div>
              </div>

              <div className="flex justify-center">
                <GroupPicker
                  value={(u.user_group ?? '').trim()}
                  groups={groups}
                  disabled={!canEdit || saving === u.sub}
                  onChange={v => updateUser(u.sub, { user_group: v })}
                  onCreate={createGroup}
                />
              </div>

              <div className="flex justify-center">
                <button
                  onClick={() => updateUser(u.sub, { visible: u.visible === false })}
                  disabled={!canEdit || saving === u.sub}
                  className="w-8 h-8 rounded-lg flex items-center justify-center transition-all disabled:cursor-not-allowed"
                  style={{
                    background: u.visible === false ? 'var(--color-surface-2)' : '#10B98118',
                    color: u.visible === false ? 'var(--color-text-tertiary)' : '#10B981',
                    border: `1px solid ${u.visible === false ? 'var(--color-border)' : '#10B98130'}`,
                    opacity: canEdit ? 1 : 0.5,
                  }}
                  title={!canEdit ? 'เฉพาะ Super Admin' : u.visible === false ? 'ซ่อนอยู่ — คลิกเพื่อแสดง' : 'แสดงอยู่ — คลิกเพื่อซ่อน'}
                >
                  {u.visible === false ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                </button>
              </div>
            </div>
              ))}
            </div>
          ))}

          {filtered.length === 0 && (
            <p className="text-center py-8 text-[13px]" style={{ color: 'var(--color-text-tertiary)' }}>ไม่พบผู้ใช้ที่ค้นหา</p>
          )}
        </div>
      )}
    </div>
  );
}

// ── Inline group manager (rename / delete / create) ───────────────────────────
function GroupManager({ groups, onChanged, onCreate }: {
  groups: UserGroup[];
  onChanged: () => void;
  onCreate: (name: string) => Promise<UserGroup | null>;
}) {
  const [newName, setNewName] = useState('');
  const [editing, setEditing] = useState<{ id: string; name: string } | null>(null);

  const rename = async () => {
    if (!editing || !editing.name.trim()) return;
    try {
      const res = await fetch(`/api/user-groups/${editing.id}`, {
        method: 'PATCH', headers: authHeaders(), body: JSON.stringify({ name: editing.name.trim() }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'เปลี่ยนชื่อไม่สำเร็จ');
      toast.success('เปลี่ยนชื่อกลุ่มแล้ว');
      setEditing(null);
      onChanged();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'เปลี่ยนชื่อไม่สำเร็จ');
    }
  };

  const remove = async (g: UserGroup) => {
    const ok = await confirmDialog({
      title: `ลบกลุ่ม "${g.name}"?`,
      message: g.member_count > 0 ? `สมาชิก ${g.member_count} คนจะกลายเป็นไม่มีกลุ่ม` : 'กลุ่มนี้ไม่มีสมาชิก',
      confirmText: 'ลบกลุ่ม',
    });
    if (!ok) return;
    try {
      const res = await fetch(`/api/user-groups/${g.id}`, { method: 'DELETE', headers: authHeaders() });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'ลบไม่สำเร็จ');
      toast.success('ลบกลุ่มแล้ว');
      onChanged();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'ลบไม่สำเร็จ');
    }
  };

  return (
    <div className="rounded-xl p-3 space-y-2" style={{ background: 'var(--color-surface-2)', border: '1px solid var(--color-border)' }}>
      <p className="text-[11px] font-bold uppercase tracking-wider" style={{ color: 'var(--color-text-tertiary)' }}>กลุ่มทั้งหมด ({groups.length})</p>

      {groups.map(g => (
        <div key={g.id} className="flex items-center gap-2">
          {editing?.id === g.id ? (
            <>
              <input value={editing.name} onChange={e => setEditing({ ...editing, name: e.target.value })}
                onKeyDown={e => { if (e.key === 'Enter') rename(); if (e.key === 'Escape') setEditing(null); }}
                autoFocus
                className="flex-1 px-2 py-1 rounded-lg text-[12px] outline-none"
                style={{ background: 'var(--color-surface)', border: '1px solid var(--color-primary)', color: 'var(--color-text-primary)' }} />
              <button onClick={rename} className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ color: '#10B981' }}><Check className="w-4 h-4" /></button>
              <button onClick={() => setEditing(null)} className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ color: 'var(--color-text-tertiary)' }}><X className="w-4 h-4" /></button>
            </>
          ) : (
            <>
              <span className="flex-1 text-[12px] font-medium truncate" style={{ color: 'var(--color-text-primary)' }}>{g.name}</span>
              <span className="text-[10px] px-1.5 py-0.5 rounded-full" style={{ background: 'var(--color-surface)', color: 'var(--color-text-tertiary)' }}>{g.member_count} คน</span>
              <button onClick={() => setEditing({ id: g.id, name: g.name })} className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ color: 'var(--color-text-tertiary)' }} title="เปลี่ยนชื่อ"><Pencil className="w-3.5 h-3.5" /></button>
              <button onClick={() => remove(g)} className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ color: '#EF4444' }} title="ลบกลุ่ม"><Trash2 className="w-3.5 h-3.5" /></button>
            </>
          )}
        </div>
      ))}

      <div className="flex gap-2 pt-1">
        <input value={newName} onChange={e => setNewName(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && newName.trim()) { onCreate(newName.trim()).then(() => setNewName('')); } }}
          placeholder="ชื่อกลุ่มใหม่..."
          className="flex-1 px-2.5 py-1.5 rounded-lg text-[12px] outline-none"
          style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', color: 'var(--color-text-primary)' }} />
        <button
          onClick={() => { if (newName.trim()) onCreate(newName.trim()).then(() => setNewName('')); }}
          disabled={!newName.trim()}
          className="px-3 py-1.5 rounded-lg text-[12px] font-semibold disabled:opacity-40"
          style={{ background: 'var(--color-primary)', color: '#fff' }}>
          สร้างกลุ่ม
        </button>
      </div>
    </div>
  );
}
