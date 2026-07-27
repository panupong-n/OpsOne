import { useState, useRef, useEffect } from 'react';
import { ChevronDown, Check, Plus, Search } from 'lucide-react';
import type { UserGroup } from './types';

/** Group selector: pick an existing group, clear it, or create a brand-new one
 *  inline. Read-only mode renders a plain chip. */
export default function GroupPicker({ value, groups, disabled, onChange, onCreate }: {
  value: string;
  groups: UserGroup[];
  disabled?: boolean;
  onChange: (name: string) => void;
  onCreate: (name: string) => Promise<UserGroup | null>;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [creating, setCreating] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  const label = value?.trim() || 'ไม่มีกลุ่ม';
  const filtered = groups.filter(g => g.name.toLowerCase().includes(query.trim().toLowerCase()));
  const exact = groups.some(g => g.name.toLowerCase() === query.trim().toLowerCase());
  const canCreate = query.trim().length > 0 && !exact;

  if (disabled) {
    return (
      <span className="inline-flex items-center px-2.5 py-1 rounded-lg text-[12px] font-medium"
        style={{ background: 'var(--color-surface-2)', border: '1px solid var(--color-border)', color: value ? 'var(--color-text-primary)' : 'var(--color-text-tertiary)' }}>
        {label}
      </span>
    );
  }

  const create = async () => {
    const name = query.trim();
    if (!name) return;
    setCreating(true);
    const g = await onCreate(name);
    setCreating(false);
    if (g) { onChange(g.name); setQuery(''); setOpen(false); }
  };

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(o => !o)}
        className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[12px] font-medium transition-colors w-full justify-between"
        style={{ background: 'var(--color-surface-2)', border: '1px solid var(--color-border)', color: value ? 'var(--color-text-primary)' : 'var(--color-text-tertiary)' }}
      >
        <span className="truncate">{label}</span>
        <ChevronDown className="w-3 h-3 flex-shrink-0" style={{ color: 'var(--color-text-tertiary)' }} />
      </button>

      {open && (
        <div className="absolute right-0 mt-1 z-[60] rounded-xl overflow-hidden w-56"
          style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', boxShadow: '0 12px 32px rgba(15,23,42,0.16)' }}>
          {/* Search / new-group input */}
          <div className="p-2" style={{ borderBottom: '1px solid var(--color-border)' }}>
            <div className="relative">
              <Search className="w-3.5 h-3.5 absolute left-2 top-1/2 -translate-y-1/2" style={{ color: 'var(--color-text-tertiary)' }} />
              <input
                autoFocus
                value={query}
                onChange={e => setQuery(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && canCreate) create(); }}
                placeholder="ค้นหา หรือพิมพ์ชื่อกลุ่มใหม่"
                className="w-full pl-7 pr-2 py-1.5 rounded-lg text-[12px] outline-none"
                style={{ background: 'var(--color-surface-2)', border: '1px solid var(--color-border)', color: 'var(--color-text-primary)' }}
              />
            </div>
          </div>

          <div className="max-h-52 overflow-y-auto py-1">
            {/* No group */}
            <button
              onClick={() => { onChange(''); setOpen(false); }}
              className="w-full flex items-center justify-between gap-3 px-3 py-1.5 text-[12px] hover:bg-black/5 dark:hover:bg-white/5"
              style={{ color: 'var(--color-text-tertiary)' }}
            >
              <span>ไม่มีกลุ่ม</span>
              {!value && <Check className="w-3.5 h-3.5" style={{ color: 'var(--color-primary)' }} />}
            </button>

            {filtered.map(g => (
              <button
                key={g.id}
                onClick={() => { onChange(g.name); setOpen(false); }}
                className="w-full flex items-center justify-between gap-3 px-3 py-1.5 text-[12px] hover:bg-black/5 dark:hover:bg-white/5"
                style={{ color: 'var(--color-text-primary)' }}
              >
                <span className="truncate">{g.name}</span>
                <span className="flex items-center gap-2 flex-shrink-0">
                  <span className="text-[10px]" style={{ color: 'var(--color-text-tertiary)' }}>{g.member_count}</span>
                  {g.name === value && <Check className="w-3.5 h-3.5" style={{ color: 'var(--color-primary)' }} />}
                </span>
              </button>
            ))}

            {filtered.length === 0 && !canCreate && (
              <p className="px-3 py-3 text-[11px] text-center" style={{ color: 'var(--color-text-tertiary)' }}>ไม่พบกลุ่ม</p>
            )}
          </div>

          {canCreate && (
            <button
              onClick={create}
              disabled={creating}
              className="w-full flex items-center gap-2 px-3 py-2 text-[12px] font-semibold"
              style={{ borderTop: '1px solid var(--color-border)', color: 'var(--color-primary)' }}
            >
              <Plus className="w-3.5 h-3.5" />
              {creating ? 'กำลังสร้าง...' : `สร้างกลุ่ม "${query.trim()}"`}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
