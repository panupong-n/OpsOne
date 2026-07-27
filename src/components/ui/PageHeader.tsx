import type { ReactNode } from 'react';

interface PageHeaderProps {
    title: string;
    subtitle?: string;
    icon?: ReactNode;
    actions?: ReactNode;
}

/** Standard page header used across in-Layout pages (title + subtitle + actions). */
export default function PageHeader({ title, subtitle, icon, actions }: PageHeaderProps) {
    return (
        <div className="flex items-start justify-between gap-4 mb-6">
            <div className="flex items-center gap-3 min-w-0">
                {icon && (
                    <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
                        style={{ background: 'var(--color-primary-soft)', color: 'var(--color-primary)' }}>
                        {icon}
                    </div>
                )}
                <div className="min-w-0">
                    <h1 className="text-[20px] font-bold leading-tight truncate" style={{ color: 'var(--color-text-primary)' }}>{title}</h1>
                    {subtitle && <p className="text-[13px] mt-0.5 truncate" style={{ color: 'var(--color-text-secondary)' }}>{subtitle}</p>}
                </div>
            </div>
            {actions && <div className="flex items-center gap-2 shrink-0">{actions}</div>}
        </div>
    );
}
