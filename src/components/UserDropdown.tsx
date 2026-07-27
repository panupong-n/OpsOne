import { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronDown, LogOut, Settings } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { avatarColor } from '../lib/avatar';
import { roleLabel } from '../lib/permissions';
import SettingsModal from './SettingsModal';
import { Modal } from './ui/modal';

interface UserDropdownProps {
    /** 'header' opens downward on the right; 'sidebar' opens upward, full-width. */
    variant?: 'header' | 'sidebar';
    /** In the sidebar's collapsed state, show only the avatar. */
    collapsed?: boolean;
}

export default function UserDropdown({ variant = 'header', collapsed = false }: UserDropdownProps = {}) {
    const isSidebar = variant === 'sidebar';
    const showLabel = isSidebar ? !collapsed : true;
    const [open, setOpen] = useState(false);
    const [showLogoutConfirm, setShowLogoutConfirm] = useState(false);
    const [showSettings, setShowSettings] = useState(false);
    const ref = useRef<HTMLDivElement>(null);
    const { user, logout } = useAuth();
    const navigate = useNavigate();

    useEffect(() => {
        const handler = (e: MouseEvent) => {
            if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
        };
        const keyHandler = (e: KeyboardEvent) => {
            if (e.key === 'Escape') setOpen(false);
        };
        document.addEventListener('mousedown', handler);
        document.addEventListener('keydown', keyHandler);
        return () => {
            document.removeEventListener('mousedown', handler);
            document.removeEventListener('keydown', keyHandler);
        };
    }, []);

    const handleLogout = () => {
        setShowLogoutConfirm(false);
        logout();
        navigate('/login', { replace: true });
    };

    const initials = user
        ? (`${user.given_name?.[0] ?? ''}${user.family_name?.[0] ?? ''}`.toUpperCase() || user.name?.slice(0, 2).toUpperCase() || 'U')
        : 'U';
    const displayName = user?.name || user?.email || 'User';

    return (
        <>
            <div ref={ref} className={isSidebar ? 'relative w-full' : 'relative'}>
                {/* Trigger */}
                <button
                    onClick={() => setOpen(!open)}
                    className={`flex items-center gap-2.5 rounded-xl transition-all duration-150 outline-none ${
                        isSidebar ? `w-full ${collapsed ? 'justify-center px-0 py-2' : 'px-2.5 py-2'}` : 'px-3 py-2'
                    }`}
                    style={{
                        background: open ? 'var(--color-surface-2)' : 'transparent',
                        border: '1px solid',
                        borderColor: open ? 'var(--color-border)' : 'transparent',
                    }}
                >
                    {/* Avatar */}
                    <div className="w-9 h-9 rounded-full flex items-center justify-center text-xs font-bold text-white flex-shrink-0"
                        style={{ background: avatarColor(user?.sub ?? displayName) }}>
                        {initials}
                    </div>
                    {showLabel && (
                        <div className={`text-left min-w-0 flex-1 ${isSidebar ? '' : 'hidden sm:block'}`}>
                            <p className="text-[13px] font-semibold leading-none truncate" style={{ color: 'var(--color-text-primary)' }}>
                                {displayName}
                            </p>
                            <p className="text-[11px] mt-0.5 leading-none truncate" style={{ color: 'var(--color-text-secondary)' }}>
                                {roleLabel(user?.role)}
                            </p>
                        </div>
                    )}
                    {showLabel && (
                        <motion.div animate={{ rotate: open ? 180 : 0 }} transition={{ duration: 0.18 }}>
                            <ChevronDown className="w-3.5 h-3.5" style={{ color: 'var(--color-text-tertiary)' }} />
                        </motion.div>
                    )}
                </button>

                {/* Dropdown */}
                <AnimatePresence>
                    {open && (
                        <motion.div
                            initial={{ opacity: 0, y: isSidebar ? 6 : -6, scale: 0.97 }}
                            animate={{ opacity: 1, y: 0, scale: 1 }}
                            exit={{ opacity: 0, y: isSidebar ? 6 : -6, scale: 0.97 }}
                            transition={{ duration: 0.13 }}
                            className={`absolute w-56 z-[200] overflow-hidden ${isSidebar ? 'left-0 bottom-full mb-2' : 'right-0 mt-2'}`}
                            style={{
                                background: 'var(--color-surface)',
                                border: '1px solid var(--color-border)',
                                borderRadius: 14,
                                boxShadow: '0 8px 30px rgba(15,23,42,0.12), 0 2px 8px rgba(15,23,42,0.06)',
                            }}
                        >
                            {/* User header */}
                            <div className="px-4 py-3.5" style={{ borderBottom: '1px solid var(--color-border)' }}>
                                <div className="flex items-center gap-3">
                                    <div className="w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold text-white flex-shrink-0"
                                        style={{ background: avatarColor(user?.sub ?? displayName) }}>
                                        {initials}
                                    </div>
                                    <div className="min-w-0">
                                        <p className="text-[13px] font-semibold truncate" style={{ color: 'var(--color-text-primary)' }}>
                                            {displayName}
                                        </p>
                                        <p className="text-[11px] truncate" style={{ color: 'var(--color-text-secondary)' }}>
                                            {user?.email}
                                        </p>
                                    </div>
                                </div>
                            </div>

                            {/* Menu */}
                            <div className="p-1.5">
                                <button
                                    onClick={() => { setOpen(false); setShowSettings(true); }}
                                    className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-[13px] font-medium transition-colors"
                                    style={{ color: 'var(--color-text-primary)' }}
                                    onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'var(--color-surface-2)'; }}
                                    onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
                                >
                                    <Settings className="w-4 h-4" style={{ color: 'var(--color-text-tertiary)' }} />
                                    ตั้งค่า
                                </button>
                                <button
                                    onClick={() => { setOpen(false); setShowLogoutConfirm(true); }}
                                    className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-[13px] font-medium transition-colors"
                                    style={{ color: 'var(--color-error)' }}
                                    onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'var(--color-error-soft)'; }}
                                    onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
                                >
                                    <LogOut className="w-4 h-4" />
                                    ออกจากระบบ
                                </button>
                            </div>
                        </motion.div>
                    )}
                </AnimatePresence>
            </div>

            {/* Settings modal */}
            {showSettings && <SettingsModal onClose={() => setShowSettings(false)} />}

            {/* Logout confirm modal */}
            {showLogoutConfirm && (
                <Modal isOpen onClose={() => setShowLogoutConfirm(false)} showCloseButton={false}
                    className="w-full max-w-[360px] m-4 p-8 text-center">
                    <div className="w-12 h-12 rounded-2xl mx-auto mb-5 flex items-center justify-center"
                        style={{ background: 'var(--color-error-soft)' }}>
                        <LogOut className="w-5 h-5" style={{ color: 'var(--color-error)' }} />
                    </div>
                    <h2 className="text-base font-bold mb-1.5" style={{ color: 'var(--color-text-primary)' }}>
                        ออกจากระบบ?
                    </h2>
                    <p className="text-sm leading-relaxed mb-6" style={{ color: 'var(--color-text-secondary)' }}>
                        ระบบจะล้าง session ของ OpsOne<br />
                        และคุณจะต้อง login ผ่าน TENCYBER ครั้งถัดไป
                    </p>
                    <div className="flex gap-3">
                        <button
                            onClick={() => setShowLogoutConfirm(false)}
                            className="btn btn-ghost flex-1 justify-center"
                        >
                            ยกเลิก
                        </button>
                        <button
                            onClick={handleLogout}
                            className="btn flex-1 justify-center"
                            style={{ background: 'var(--color-error)', color: '#fff', boxShadow: '0 2px 8px rgba(239,68,68,0.3)' }}
                        >
                            ออกจากระบบ
                        </button>
                    </div>
                </Modal>
            )}
        </>
    );
}

