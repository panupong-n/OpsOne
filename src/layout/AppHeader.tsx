import { useRef, useState, useEffect, useCallback } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { Moon, Sun, Bell, Check, Menu } from 'lucide-react';
import { useSidebar } from '../context/SidebarContext';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';

const PAGE_META: { test: (p: string) => boolean; title: string; subtitle: string }[] = [
    { test: p => p === '/dashboard', title: 'ภาพรวมระบบ', subtitle: 'สรุปการเข้างาน · Ticket · ทรัพย์สิน · ภาระงานทีม' },
    { test: p => p === '/tasks', title: 'งาน & ปฏิทิน', subtitle: 'มอบหมายงาน · บันทึกการออกพื้นที่และการลา' },
    { test: p => p.startsWith('/tickets'), title: 'Support Tickets', subtitle: 'ระบบรับแจ้งและติดตามงาน · Zammad' },
    { test: p => p.startsWith('/pm'), title: 'วางแผนโครงการ', subtitle: 'Kanban · Gantt · Analytics' },
    // Maintenance must be tested BEFORE the generic /assets rule, otherwise
    // /assets/maintenance would inherit the "ทรัพย์สิน IT" title.
    { test: p => p.startsWith('/assets/maintenance'), title: 'การบำรุงรักษา (Maintenance)', subtitle: 'แผนการตรวจเช็คและบำรุงรักษาทรัพย์สิน IT ตามรอบเวลา' },
    { test: p => p.startsWith('/assets'), title: 'ทรัพย์สิน IT', subtitle: 'ทะเบียนทรัพย์สิน · ผู้ถือครอง · การโอนย้าย' },
    // Survey sub-pages no longer print their own heading, so each one needs its
    // own entry here — most specific first, generic /survey last.
    { test: p => p.startsWith('/survey/dashboard'), title: 'ภาพรวม — แบบประเมิน ISO', subtitle: 'สรุปอัตราการตอบรับ · ความพึงพอใจ · สถานะแต่ละแบบประเมิน' },
    { test: p => p.startsWith('/survey/surveys'), title: 'แบบประเมิน', subtitle: 'สร้างและจัดการแบบประเมิน' },
    { test: p => p.startsWith('/survey/tracking'), title: 'ติดตามสถานะ', subtitle: 'ติดตามการตอบแบบประเมินของพนักงาน' },
    { test: p => p.startsWith('/survey/report'), title: 'รายงาน', subtitle: 'สรุปผลการประเมิน · วิเคราะห์ข้อมูลเชิงลึก' },
    { test: p => p.startsWith('/survey/users'), title: 'จัดการพนักงาน', subtitle: 'ผู้รับแบบประเมิน' },
    { test: p => p.startsWith('/survey/activity'), title: 'กิจกรรม', subtitle: 'ประวัติการใช้งานระบบแบบประเมิน' },
    { test: p => p.startsWith('/survey'), title: 'แบบประเมิน ISO', subtitle: 'แบบสอบถาม · ติดตามสถานะ · รายงานผล' },
    { test: p => p.startsWith('/training'), title: 'Training', subtitle: 'คลังคำถาม · แบบทดสอบ · ผลสอบ' },
    { test: p => p.startsWith('/hr'), title: 'HR Intake', subtitle: 'ข้อมูลรับเข้าจากฝ่ายบุคคล' },
];
const pageMeta = (p: string) => PAGE_META.find(m => m.test(p)) ?? { title: 'OpsOne', subtitle: 'Operations Platform' };

interface Notif { id: string; title: string; body: string; link: string | null; is_read: boolean; created_at: string }

export default function AppHeader() {
    const { toggleSidebar, toggleMobileSidebar } = useSidebar();
    const { user } = useAuth();
    const { theme, toggleTheme } = useTheme();
    const navigate = useNavigate();
    const location = useLocation();
    const meta = pageMeta(location.pathname);

    const handleToggle = () => {
        if (window.innerWidth >= 1024) toggleSidebar();
        else toggleMobileSidebar();
    };

    const [notifications, setNotifications] = useState<Notif[]>([]);
    const [unreadCount, setUnreadCount] = useState(0);
    const [showNotif, setShowNotif] = useState(false);
    const notifRef = useRef<HTMLDivElement>(null);

    const fetchNotifications = useCallback(async () => {
        if (!user?.sub) return;
        try {
            const [n, c] = await Promise.all([
                fetch(`/api/notifications/${encodeURIComponent(user.sub)}`).then(r => r.json()),
                fetch(`/api/notifications/${encodeURIComponent(user.sub)}/unread-count`).then(r => r.json()),
            ]);
            setNotifications(n); setUnreadCount(c.count);
        } catch { /* ignore */ }
    }, [user?.sub]);

    useEffect(() => {
        fetchNotifications();
        const iv = setInterval(fetchNotifications, 30000);
        return () => clearInterval(iv);
    }, [fetchNotifications]);

    useEffect(() => {
        const h = (e: MouseEvent) => { if (notifRef.current && !notifRef.current.contains(e.target as Node)) setShowNotif(false); };
        document.addEventListener('mousedown', h);
        return () => document.removeEventListener('mousedown', h);
    }, []);

    const markRead = async (id: string) => { await fetch(`/api/notifications/${encodeURIComponent(id)}/read`, { method: 'PATCH' }); fetchNotifications(); };
    const markAllRead = async () => { if (!user?.sub) return; await fetch(`/api/notifications/${encodeURIComponent(user.sub)}/read-all`, { method: 'PATCH' }); fetchNotifications(); };

    return (
        <header className="sticky top-0 flex w-full bg-white border-gray-200 z-50 dark:border-gray-800 dark:bg-gray-900 lg:border-b">
            <div className="flex items-center justify-between grow px-3 py-3 lg:px-6 lg:py-3">
                {/* Left: toggle + page title */}
                <div className="flex items-center gap-3 min-w-0">
                    <button
                        onClick={handleToggle}
                        aria-label="Toggle Sidebar"
                        className="flex items-center justify-center w-10 h-10 text-gray-500 border border-gray-200 rounded-lg dark:border-gray-800 dark:text-gray-400 lg:h-11 lg:w-11"
                    >
                        <Menu className="w-5 h-5" />
                    </button>
                    <div className="min-w-0">
                        <h1 className="text-[15px] font-semibold leading-tight truncate text-gray-800 dark:text-white/90">{meta.title}</h1>
                        <p className="text-[11.5px] leading-tight truncate mt-0.5 text-gray-400">{meta.subtitle}</p>
                    </div>
                </div>

                {/* Right: theme + notifications + user */}
                <div className="flex items-center gap-2 sm:gap-3 shrink-0">
                    <button
                        onClick={toggleTheme}
                        className="flex items-center justify-center w-10 h-10 text-gray-500 border border-gray-200 rounded-full dark:border-gray-800 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800"
                        title={theme === 'dark' ? 'Light Mode' : 'Dark Mode'}
                    >
                        {theme === 'dark' ? <Sun className="w-4 h-4 text-amber-500" /> : <Moon className="w-4 h-4" />}
                    </button>

                    <div className="relative" ref={notifRef}>
                        <button
                            onClick={() => { setShowNotif(v => !v); if (!showNotif) fetchNotifications(); }}
                            className="relative flex items-center justify-center w-10 h-10 text-gray-500 border border-gray-200 rounded-full dark:border-gray-800 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800"
                            title="การแจ้งเตือน"
                        >
                            <Bell className="w-4 h-4" />
                            {unreadCount > 0 && (
                                <span className="absolute -top-0.5 -right-0.5 w-4 h-4 rounded-full text-[9px] font-bold flex items-center justify-center text-white bg-red-500">
                                    {unreadCount > 9 ? '9+' : unreadCount}
                                </span>
                            )}
                        </button>
                        <AnimatePresence>
                            {showNotif && (
                                <motion.div
                                    initial={{ opacity: 0, y: -8, scale: 0.97 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: -6, scale: 0.97 }}
                                    transition={{ duration: 0.14 }}
                                    className="absolute right-0 top-full mt-2 w-80 rounded-2xl overflow-hidden z-50 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 shadow-xl"
                                >
                                    <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 dark:border-gray-800">
                                        <span className="text-[13px] font-semibold text-gray-800 dark:text-white/90">การแจ้งเตือน</span>
                                        {unreadCount > 0 && (
                                            <button onClick={markAllRead} className="text-[11px] font-semibold flex items-center gap-1 px-2 py-1 rounded-lg text-brand-500 hover:bg-brand-50 dark:hover:bg-white/5">
                                                <Check className="w-3 h-3" /> อ่านทั้งหมด
                                            </button>
                                        )}
                                    </div>
                                    <div className="max-h-72 overflow-y-auto">
                                        {notifications.length === 0 ? (
                                            <div className="text-center py-10 text-xs text-gray-400">
                                                <Bell className="w-6 h-6 mx-auto mb-2 opacity-30" /> ไม่มีการแจ้งเตือน
                                            </div>
                                        ) : notifications.map(n => (
                                            <div key={n.id} className={`flex items-start gap-3 px-4 py-3 cursor-pointer border-b border-gray-100 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-white/5 ${n.is_read ? '' : 'bg-brand-50/50 dark:bg-white/[0.03]'}`}
                                                onClick={() => { if (!n.is_read) markRead(n.id); if (n.link) { navigate(n.link); setShowNotif(false); } }}>
                                                <div className="flex-1 min-w-0">
                                                    <p className="text-[12px] font-semibold truncate text-gray-800 dark:text-white/90">{n.title}</p>
                                                    <p className="text-[11px] mt-0.5 line-clamp-2 text-gray-500 dark:text-gray-400">{n.body}</p>
                                                    <p className="text-[10px] mt-1 text-gray-400">
                                                        {new Date(n.created_at).toLocaleDateString('th-TH', { day: 'numeric', month: 'short' })} {new Date(n.created_at).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' })}
                                                    </p>
                                                </div>
                                                {!n.is_read && <div className="w-2 h-2 rounded-full mt-1.5 shrink-0 bg-brand-500" />}
                                            </div>
                                        ))}
                                    </div>
                                </motion.div>
                            )}
                        </AnimatePresence>
                    </div>
                </div>
            </div>
        </header>
    );
}
