import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import {
    LayoutDashboard, CalendarDays, Ticket, FolderKanban,
    MonitorSmartphone, ClipboardCheck, UserPlus, ChevronDown, MoreHorizontal, Wrench, GraduationCap,
} from 'lucide-react';
import { useSidebar } from '../context/SidebarContext';
import { useAuth } from '../context/AuthContext';
import { isAdmin } from '../lib/permissions';
import { FEATURES } from '../config/features';
import UserDropdown from '../components/UserDropdown';

type SubItem = { name: string; path: string };
type NavItem = {
    name: string;
    icon: React.ReactNode;
    path?: string;
    subItems?: SubItem[];
    adminOnly?: boolean;
    match?: (p: string) => boolean;
};

const NAV: NavItem[] = [
    { icon: <LayoutDashboard />, name: 'ภาพรวมระบบ', path: '/dashboard' },
    { icon: <CalendarDays />, name: 'งาน & ปฏิทิน', path: '/tasks', match: p => p === '/tasks' },
    // Support Ticket is hidden while FEATURES.supportTickets is off (Zammad down).
    ...(FEATURES.supportTickets
        ? [{ icon: <Ticket />, name: 'Support Ticket', path: '/tickets', match: (p: string) => p.startsWith('/tickets') }]
        : []),
    { icon: <FolderKanban />, name: 'วางแผนโครงการ', path: '/pm', match: p => p.startsWith('/pm') },
    { icon: <MonitorSmartphone />, name: 'ทรัพย์สิน IT', path: '/assets', match: p => p === '/assets' || (p.startsWith('/assets/') && !p.startsWith('/assets/maintenance')) },
    { icon: <Wrench />, name: 'การบำรุงรักษา', path: '/assets/maintenance', match: p => p.startsWith('/assets/maintenance') },
    {
        icon: <ClipboardCheck />, name: 'แบบประเมิน', match: p => p.startsWith('/survey'),
        subItems: [
            { name: 'ภาพรวม', path: '/survey/dashboard' },
            { name: 'แบบประเมิน', path: '/survey/surveys' },
            { name: 'ติดตามสถานะ', path: '/survey/tracking' },
            { name: 'รายงาน', path: '/survey/report' },
            { name: 'พนักงาน', path: '/survey/users' },
            { name: 'กิจกรรม', path: '/survey/activity' },
        ],
    },
    {
        icon: <GraduationCap />, name: 'Training', match: p => p.startsWith('/training'),
        subItems: [
            { name: 'แบบทดสอบ', path: '/training/exams' },
            { name: 'คลังคำถาม', path: '/training/questions' },
        ],
    },
    { icon: <UserPlus />, name: 'HR Intake', path: '/hr/intake', adminOnly: true },
];

export default function AppSidebar() {
    const { isExpanded, isMobileOpen, isHovered, setIsHovered } = useSidebar();
    const location = useLocation();
    const { user } = useAuth();
    const admin = isAdmin(user?.role);
    const items = NAV.filter(i => !i.adminOnly || admin);

    const showText = isExpanded || isHovered || isMobileOpen;

    const isActive = useCallback(
        (item: NavItem) => item.match ? item.match(location.pathname) : location.pathname === item.path,
        [location.pathname],
    );

    const [openIdx, setOpenIdx] = useState<number | null>(null);
    const subRefs = useRef<Record<number, HTMLDivElement | null>>({});
    const [subHeight, setSubHeight] = useState<Record<number, number>>({});

    useEffect(() => {
        const i = items.findIndex(n => n.subItems && n.match?.(location.pathname));
        setOpenIdx(i >= 0 ? i : null);
    }, [location.pathname]); // eslint-disable-line react-hooks/exhaustive-deps

    useEffect(() => {
        if (openIdx !== null && subRefs.current[openIdx]) {
            setSubHeight(h => ({ ...h, [openIdx]: subRefs.current[openIdx]?.scrollHeight || 0 }));
        }
    }, [openIdx]);

    return (
        <aside
            className={`fixed mt-16 flex flex-col lg:mt-0 top-0 px-5 left-0 bg-white dark:bg-gray-900 dark:border-gray-800 text-gray-900 h-screen transition-all duration-300 ease-in-out z-50 border-r border-gray-200
                ${isExpanded || isMobileOpen ? 'w-[290px]' : isHovered ? 'w-[290px]' : 'w-[90px]'}
                ${isMobileOpen ? 'translate-x-0' : '-translate-x-full'} lg:translate-x-0`}
            onMouseEnter={() => !isExpanded && setIsHovered(true)}
            onMouseLeave={() => setIsHovered(false)}
        >
            {/* Brand */}
            <div className={`py-5 flex ${!isExpanded && !isHovered ? 'lg:justify-center' : 'justify-start'}`}>
                <Link to="/dashboard" className="flex items-center justify-center w-full">
                    <img src={showText ? '/TENIX-LOGO.png' : '/TENIX1.png'} alt="OpsOne" className={`object-contain shrink-0 transition-all duration-300 ${showText ? 'h-16 w-auto max-w-[220px]' : 'h-12 w-12'}`} />
                </Link>
            </div>

            {/* Nav */}
            <div className="flex flex-col flex-1 min-h-0 overflow-y-auto duration-300 ease-linear no-scrollbar">
                <nav className="mb-6">
                    <h2 className={`mb-4 text-xs uppercase flex leading-[20px] text-gray-400 ${!isExpanded && !isHovered ? 'lg:justify-center' : 'justify-start'}`}>
                        {showText ? 'เมนู' : <MoreHorizontal className="size-5" />}
                    </h2>
                    <ul className="flex flex-col gap-3">
                        {items.map((nav, index) => {
                            const active = isActive(nav);
                            return (
                                <li key={nav.name}>
                                    {nav.subItems ? (
                                        <button
                                            onClick={() => setOpenIdx(p => p === index ? null : index)}
                                            className={`menu-item group ${active || openIdx === index ? 'menu-item-active' : 'menu-item-inactive'} cursor-pointer ${!isExpanded && !isHovered ? 'lg:justify-center' : 'lg:justify-start'}`}
                                        >
                                            <span className={`menu-item-icon-size ${active || openIdx === index ? 'menu-item-icon-active' : 'menu-item-icon-inactive'}`}>{nav.icon}</span>
                                            {showText && <span className="menu-item-text">{nav.name}</span>}
                                            {showText && <ChevronDown className={`ml-auto w-5 h-5 transition-transform duration-200 ${openIdx === index ? 'rotate-180 text-brand-500' : ''}`} />}
                                        </button>
                                    ) : nav.path && (
                                        <Link to={nav.path} className={`menu-item group ${active ? 'menu-item-active' : 'menu-item-inactive'} ${!isExpanded && !isHovered ? 'lg:justify-center' : 'lg:justify-start'}`}>
                                            <span className={`menu-item-icon-size ${active ? 'menu-item-icon-active' : 'menu-item-icon-inactive'}`}>{nav.icon}</span>
                                            {showText && <span className="menu-item-text">{nav.name}</span>}
                                        </Link>
                                    )}
                                    {nav.subItems && showText && (
                                        <div
                                            ref={el => { subRefs.current[index] = el; }}
                                            className="overflow-hidden transition-all duration-300"
                                            style={{ height: openIdx === index ? `${subHeight[index] ?? 0}px` : '0px' }}
                                        >
                                            <ul className="mt-2 space-y-1 ml-9">
                                                {nav.subItems.map(sub => (
                                                    <li key={sub.path}>
                                                        <Link
                                                            to={sub.path}
                                                            className={`menu-dropdown-item ${location.pathname === sub.path ? 'menu-dropdown-item-active' : 'menu-dropdown-item-inactive'}`}
                                                        >
                                                            {sub.name}
                                                        </Link>
                                                    </li>
                                                ))}
                                            </ul>
                                        </div>
                                    )}
                                </li>
                            );
                        })}
                    </ul>
                </nav>
            </div>

            {/* User menu — pinned to the bottom */}
            <div className="mt-auto py-4" style={{ borderTop: '1px solid var(--color-border)' }}>
                <UserDropdown variant="sidebar" collapsed={!showText} />
            </div>
        </aside>
    );
}
