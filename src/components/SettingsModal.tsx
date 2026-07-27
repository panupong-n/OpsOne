import { useState } from 'react';
import { X, Users, KeyRound, ShieldAlert } from 'lucide-react';
import { Modal } from './ui/modal';
import { useAuth } from '../context/AuthContext';
import { normalizeRole } from '../lib/permissions';
import UsersPanel from './settings/UsersPanel';
import ApiKeysSection from './settings/ApiKeysSection';

type Tab = 'users' | 'api';

const TABS: { key: Tab; label: string; icon: React.ReactNode; desc: string }[] = [
  { key: 'users', label: 'จัดการผู้ใช้งาน', icon: <Users className="w-4 h-4" />,     desc: 'กลุ่มผู้ใช้และการแสดงผลในระบบ' },
  { key: 'api',   label: 'API Keys',        icon: <KeyRound className="w-4 h-4" />, desc: 'คีย์สำหรับดึงข้อมูล Inventory แบบอ่านอย่างเดียว' },
];

export default function SettingsModal({ onClose }: { onClose: () => void }) {
  const { user } = useAuth();
  // System settings are SUPER_ADMIN only. Everyone else sees a read-only view.
  const canEdit = normalizeRole(user?.role) === 'SUPER_ADMIN';
  const [tab, setTab] = useState<Tab>('users');
  const active = TABS.find(t => t.key === tab)!;

  return (
    <Modal isOpen onClose={onClose} showCloseButton={false}
      className="w-full max-w-3xl m-4 max-h-[88vh] flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 flex-shrink-0" style={{ borderBottom: '1px solid var(--color-border)' }}>
        <div>
          <h2 className="text-base font-bold" style={{ color: 'var(--color-text-primary)' }}>ตั้งค่าระบบ</h2>
          <p className="text-[12px] mt-0.5" style={{ color: 'var(--color-text-secondary)' }}>{active.desc}</p>
        </div>
        <button onClick={onClose}
          className="w-8 h-8 rounded-lg flex items-center justify-center transition-colors"
          style={{ color: 'var(--color-text-tertiary)' }}
          onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'var(--color-surface-2)'; }}
          onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'transparent'; }}>
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Tabs — clear separation between settings areas */}
      <div className="flex gap-1 px-6 pt-3 flex-shrink-0" style={{ borderBottom: '1px solid var(--color-border)' }}>
        {TABS.map(t => {
          const on = t.key === tab;
          return (
            <button key={t.key} onClick={() => setTab(t.key)}
              className="inline-flex items-center gap-2 px-4 py-2.5 text-[13px] font-semibold rounded-t-lg transition-colors"
              style={{
                color: on ? 'var(--color-primary)' : 'var(--color-text-secondary)',
                borderBottom: `2px solid ${on ? 'var(--color-primary)' : 'transparent'}`,
                background: on ? 'var(--color-surface-2)' : 'transparent',
              }}>
              {t.icon} {t.label}
            </button>
          );
        })}
      </div>

      {/* Read-only notice for non super-admins */}
      {!canEdit && (
        <div className="mx-6 mt-4 rounded-xl px-4 py-2.5 flex items-start gap-2 flex-shrink-0"
          style={{ background: 'rgba(245,158,11,0.10)', border: '1px solid rgba(245,158,11,0.25)' }}>
          <ShieldAlert className="w-4 h-4 flex-shrink-0 mt-0.5" style={{ color: '#D97706' }} />
          <p className="text-[12px]" style={{ color: '#92400E' }}>
            โหมดดูอย่างเดียว — เฉพาะ <b>Super Admin</b> เท่านั้นที่แก้ไขการตั้งค่าระบบได้
          </p>
        </div>
      )}

      {/* Body — plain scroll; text stays selectable (no drag-to-scroll) */}
      <div className="flex-1 overflow-y-auto px-6 py-5" style={{ overscrollBehavior: 'contain' }}>
        {tab === 'users' ? <UsersPanel canEdit={canEdit} /> : <ApiKeysSection canEdit={canEdit} />}
      </div>

      {/* Footer */}
      <div className="px-6 py-3 flex justify-end flex-shrink-0" style={{ borderTop: '1px solid var(--color-border)' }}>
        <button onClick={onClose}
          className="px-4 py-2 rounded-lg text-[13px] font-semibold transition-colors"
          style={{ background: 'var(--color-primary)', color: '#fff' }}>
          เสร็จสิ้น
        </button>
      </div>
    </Modal>
  );
}
