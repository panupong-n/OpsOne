import { useState, useEffect } from 'react';
import { AlertTriangle } from 'lucide-react';
import { Modal } from './modal';

// ─── Promise-based confirm dialog ───────────────────────────────────────────────
// Replaces native window.confirm() with an in-app, theme-aware dialog.
//   if (!(await confirmDialog('ลบรายการนี้?'))) return;
//   confirmDialog({ message, danger: true }).then(ok => ok && doIt());
// Mount <ConfirmHost /> once at the app root (see main.tsx).

export interface ConfirmOptions {
    title?: string;
    message: string;
    confirmText?: string;
    cancelText?: string;
    danger?: boolean;
}

let notify: ((o: ConfirmOptions | null) => void) | null = null;
let resolver: ((v: boolean) => void) | null = null;

export function confirmDialog(opts: ConfirmOptions | string): Promise<boolean> {
    const options = typeof opts === 'string' ? { message: opts } : opts;
    return new Promise(resolve => {
        // If the host isn't mounted, fall back to native confirm so nothing breaks.
        if (!notify) { resolve(window.confirm(options.message)); return; }
        resolver = resolve;
        notify(options);
    });
}

export function ConfirmHost() {
    const [opts, setOpts] = useState<ConfirmOptions | null>(null);

    useEffect(() => {
        notify = setOpts;
        return () => { notify = null; };
    }, []);

    const close = (result: boolean) => {
        resolver?.(result);
        resolver = null;
        setOpts(null);
    };

    if (!opts) return null;
    const danger = opts.danger ?? true;

    return (
        <Modal isOpen onClose={() => close(false)} showCloseButton={false}
            className="w-full max-w-[380px] m-4 p-7 text-center">
            <div className="w-12 h-12 rounded-2xl mx-auto mb-5 flex items-center justify-center"
                style={{ background: danger ? 'var(--color-error-soft)' : 'var(--color-primary-soft)' }}>
                <AlertTriangle className="w-5 h-5" style={{ color: danger ? 'var(--color-error)' : 'var(--color-primary)' }} />
            </div>
            {opts.title && (
                <h2 className="text-base font-bold mb-1.5" style={{ color: 'var(--color-text-primary)' }}>{opts.title}</h2>
            )}
            <p className="text-sm leading-relaxed mb-6 whitespace-pre-line" style={{ color: 'var(--color-text-secondary)' }}>
                {opts.message}
            </p>
            <div className="flex gap-3">
                <button onClick={() => close(false)} className="btn btn-ghost flex-1 justify-center">
                    {opts.cancelText ?? 'ยกเลิก'}
                </button>
                <button onClick={() => close(true)} className="btn flex-1 justify-center"
                    style={danger
                        ? { background: 'var(--color-error)', color: '#fff', boxShadow: '0 2px 8px rgba(239,68,68,0.3)' }
                        : { background: 'var(--color-primary)', color: '#fff' }}>
                    {opts.confirmText ?? 'ยืนยัน'}
                </button>
            </div>
        </Modal>
    );
}
