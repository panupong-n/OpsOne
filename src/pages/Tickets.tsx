import { useState, useEffect, useCallback, useRef } from 'react';
import ReactDOM from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { Modal } from '../components/ui/modal';
import { useAuth } from '../context/AuthContext';
import {
    Ticket, RefreshCw, AlertCircle, Search, ExternalLink,
    ChevronLeft, ChevronRight, MessageSquare, Clock, CheckCircle2,
    XCircle, Paperclip, Download, User, Users, X, Mail, FileText,
    Image as ImageIcon, Filter, Plus, Send, Tag, Timer,
    Edit3, Save, Bold, Italic, AlignCenter, AlignLeft, AlignRight,
    List, ListOrdered, Underline as UnderlineIcon,
    Table, Trash2, GripVertical, Upload, Minus,
    Link, Strikethrough, Heading1, Heading2, Quote, Code,
} from 'lucide-react';
import Chart from 'react-apexcharts';
import type { ApexOptions } from 'apexcharts';

// ─── Types ────────────────────────────────────────────────────────────────────
interface ZTicket {
    id: number;
    number: number;
    title: string;
    state: string;
    state_id: number;
    priority: string;
    priority_id: number;
    group: string;
    group_id: number;
    owner: string;
    owner_id: number;
    customer: string;
    customer_id: number;
    article_count: number;
    created_at: string;
    updated_at: string;
}

interface ZArticle {
    id: number;
    ticket_id: number;
    from: string;
    to: string;
    cc: string;
    subject: string;
    body: string;
    content_type: string;
    internal: boolean;
    created_at: string;
    type: string;
    sender: string;
    attachments: ZAttachment[];
}

interface ZAttachment {
    id: number;
    store_file_id: number;
    filename: string;
    size: string;
    preferences: { 'Content-Type': string; 'Mime-Type'?: string; 'Content-Disposition'?: string; content_preview?: boolean };
}

// ─── State meta ───────────────────────────────────────────────────────────────
type IconComp = React.FC<React.SVGProps<SVGSVGElement>>;
const STATE_META: Record<string, { color: string; bg: string; label: string; Icon: IconComp }> = {
    'new':              { color: '#2563EB', bg: '#EEF2FF', label: 'New',              Icon: Ticket       as IconComp },
    'open':             { color: '#F59E0B', bg: '#FFFBEB', label: 'Open',             Icon: Clock        as IconComp },
    'pending reminder': { color: '#0EA5E9', bg: '#F0F9FF', label: 'Pending Reminder', Icon: Clock        as IconComp },
    'pending close':    { color: '#6366F1', bg: '#EEF2FF', label: 'Pending Close',    Icon: Clock        as IconComp },
    'closed':           { color: '#10B981', bg: '#ECFDF5', label: 'Closed',           Icon: CheckCircle2 as IconComp },
    'merged':           { color: '#6B7280', bg: '#F9FAFB', label: 'Merged',           Icon: XCircle      as IconComp },
};
const PRIO_META: Record<string, { color: string; bg: string; label: string }> = {
    // Standard Zammad priority names (lowercased for lookup)
    '1 low':          { color: '#16A34A', bg: '#F0FDF4', label: 'Low' },
    '2 medium':       { color: '#D97706', bg: '#FFFBEB', label: 'Medium' },
    '3 high':         { color: '#EA580C', bg: '#FFF7ED', label: 'High' },
    '4 informational':{ color: '#2563EB', bg: '#EFF6FF', label: 'Informational' },
    '5 critical':     { color: '#DC2626', bg: '#FEF2F2', label: 'Critical' },
    // Fallback aliases
    'low':            { color: '#16A34A', bg: '#F0FDF4', label: 'Low' },
    'medium':         { color: '#D97706', bg: '#FFFBEB', label: 'Medium' },
    'high':           { color: '#EA580C', bg: '#FFF7ED', label: 'High' },
    'informational':  { color: '#2563EB', bg: '#EFF6FF', label: 'Informational' },
    'critical':       { color: '#DC2626', bg: '#FEF2F2', label: 'Critical' },
    '2 normal':       { color: '#D97706', bg: '#FFFBEB', label: 'Normal' },
    '3 very high':    { color: '#DC2626', bg: '#FEF2F2', label: 'Very High' },
};
const STATE_ORDER = ['new', 'open', 'pending reminder', 'pending close', 'closed', 'merged'];
const PER_PAGE = 25;

const formatDate = (s: string) =>
    new Date(s).toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: '2-digit', hour: '2-digit', minute: '2-digit' });

const extractEmail = (raw: string) => {
    const m = raw?.match(/<([^>]+)>/) ?? raw?.match(/^([^\s]+@[^\s]+)$/);
    return m ? m[1] : raw ?? '—';
};
const displayName = (raw: string) => {
    if (!raw) return '—';
    const q = raw.match(/^"?([^"<]+)"?\s*</);
    return q ? q[1].trim() : extractEmail(raw);
};
const fileSize = (bytes: string) => {
    const n = parseInt(bytes || '0');
    if (n < 1024) return `${n} B`;
    if (n < 1048576) return `${(n / 1024).toFixed(1)} KB`;
    return `${(n / 1048576).toFixed(1)} MB`;
};
const isImage = (att: ZAttachment) =>
    (att.preferences['Mime-Type'] ?? att.preferences['Content-Type'] ?? '').startsWith('image/');

// CID replacement now happens server-side; client just renders the returned body directly.

// ─── Attachment Item ──────────────────────────────────────────────────────────
function AttachmentCard({ att, ticketId, articleId }: { att: ZAttachment; ticketId: number; articleId: number }) {
    const url = `/api/zammad/attachment/${ticketId}/${articleId}/${att.id}`;
    const img  = isImage(att);
    return (
        <a href={url} download={att.filename} target="_blank" rel="noopener noreferrer"
            className="flex items-center gap-2.5 px-3 py-2 rounded-xl transition-all hover:scale-[1.02]"
            style={{ background: 'var(--color-surface-2)', border: '1px solid var(--color-border)' }}>
            {img
                ? <ImageIcon className="w-4 h-4 flex-shrink-0" style={{ color: '#2563EB' }} />
                : <FileText  className="w-4 h-4 flex-shrink-0" style={{ color: '#F59E0B' }} />}
            <div className="flex-1 min-w-0">
                <p className="text-[11px] font-semibold truncate" style={{ color: 'var(--color-text-primary)' }}>{att.filename}</p>
                <p className="text-[10px]" style={{ color: 'var(--color-text-tertiary)' }}>{fileSize(att.size)}</p>
            </div>
            <Download className="w-3.5 h-3.5 flex-shrink-0" style={{ color: 'var(--color-text-tertiary)' }} />
        </a>
    );
}

// ─── Custom Dropdown Badge (for status / priority) ───────────────────────────
function DropdownBadge({ value, options, onChange, disabled }: {
    value: number;
    options: { id: number; label: string; color: string; bg: string }[];
    onChange: (id: number) => void;
    disabled?: boolean;
}) {
    const [open, setOpen] = useState(false);
    const ref = useRef<HTMLDivElement>(null);
    const selected = options.find(o => o.id === value) ?? options[0];
    useEffect(() => {
        if (!open) return;
        const handler = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
        document.addEventListener('mousedown', handler);
        return () => document.removeEventListener('mousedown', handler);
    }, [open]);
    if (!selected) return null;
    return (
        <div ref={ref} className="relative inline-block">
            <button type="button" onClick={() => !disabled && setOpen(!open)} disabled={disabled}
                className="flex items-center gap-1.5 px-3 py-1 rounded-full text-[11px] font-bold transition-all hover:shadow-md active:scale-95"
                style={{ background: selected.bg, color: selected.color, border: `1.5px solid ${selected.color}30` }}>
                <span className="w-2 h-2 rounded-full" style={{ background: selected.color }} />
                {selected.label}
                <svg className="w-2.5 h-2.5 ml-0.5 transition-transform" style={{ transform: open ? 'rotate(180deg)' : undefined }} viewBox="0 0 12 12" fill="none">
                    <path d="M3 4.5L6 7.5L9 4.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
            </button>
            <AnimatePresence>
                {open && (
                    <motion.div initial={{ opacity: 0, y: -4, scale: 0.96 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: -4, scale: 0.96 }}
                        transition={{ duration: 0.12 }}
                        className="absolute top-full left-0 mt-1.5 py-1 rounded-xl shadow-2xl z-[600] min-w-[180px] overflow-hidden"
                        style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
                        {options.map(o => {
                            const isActive = o.id === value;
                            return (
                                <button key={o.id} type="button"
                                    onClick={() => { onChange(o.id); setOpen(false); }}
                                    className="w-full flex items-center gap-2.5 px-3 py-2 transition-colors text-left"
                                    style={{ background: isActive ? `${o.color}12` : undefined }}
                                    onMouseEnter={e => { if (!isActive) e.currentTarget.style.background = 'var(--color-surface-2)'; }}
                                    onMouseLeave={e => { e.currentTarget.style.background = isActive ? `${o.color}12` : 'transparent'; }}>
                                    <span className="w-3 h-3 rounded-full flex-shrink-0"
                                        style={{ background: o.color, boxShadow: isActive ? `0 0 0 2px var(--color-surface), 0 0 0 3.5px ${o.color}` : 'none' }} />
                                    <span className="text-[12px] font-semibold flex-1" style={{ color: isActive ? o.color : 'var(--color-text-primary)' }}>{o.label}</span>
                                    {isActive && <CheckCircle2 className="w-3.5 h-3.5 flex-shrink-0" style={{ color: o.color }} />}
                                </button>
                            );
                        })}
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
}

// ─── Rich Text Editor (enhanced: images, tables, resize, alignment) ──────────

/* Upload a file blob to the backend, returns URL */
/** Compress image client-side before upload (max 1024px, JPEG 0.8) to avoid Zammad 413 */
function compressImage(file: File): Promise<File> {
    return new Promise((resolve) => {
        // Skip non-raster formats
        if (!file.type.startsWith('image/') || file.type === 'image/svg+xml') return resolve(file);
        // Skip small files (< 100KB)
        if (file.size < 100 * 1024) return resolve(file);

        const img = new Image();
        img.onload = () => {
            const MAX = 1024;
            let { width: w, height: h } = img;
            if (w > MAX || h > MAX) {
                const ratio = Math.min(MAX / w, MAX / h);
                w = Math.round(w * ratio);
                h = Math.round(h * ratio);
            }
            const canvas = document.createElement('canvas');
            canvas.width = w;
            canvas.height = h;
            canvas.getContext('2d')!.drawImage(img, 0, 0, w, h);
            canvas.toBlob((blob) => {
                if (blob && blob.size < file.size) {
                    resolve(new File([blob], file.name.replace(/\.[^.]+$/, '.jpg'), { type: 'image/jpeg' }));
                } else {
                    resolve(file);
                }
            }, 'image/jpeg', 0.8);
        };
        img.onerror = () => resolve(file);
        img.src = URL.createObjectURL(file);
    });
}

async function uploadImage(file: File): Promise<string> {
    const compressed = await compressImage(file);
    const fd = new FormData();
    fd.append('image', compressed);
    const r = await fetch('/api/upload/editor-image', { method: 'POST', body: fd });
    if (!r.ok) throw new Error('Upload failed');
    const d = await r.json();
    return d.url as string;
}

/* Image Resize Overlay – uses fixed positioning to avoid clipping by overflow:hidden */
function ImageResizeOverlay({ img, onDone, onDismiss }: { img: HTMLImageElement; onDone: () => void; onDismiss: () => void }) {
    const [, forceUpdate] = useState(0);
    const toolbarRef = useRef<HTMLDivElement>(null);
    const reposition = () => forceUpdate(n => n + 1);

    // Keep overlay in sync with scroll / resize
    useEffect(() => {
        const handler = () => forceUpdate(n => n + 1);
        const scrollParents: (HTMLElement | Window)[] = [window];
        let el: HTMLElement | null = img.parentElement;
        while (el) {
            const st = getComputedStyle(el);
            if (['auto', 'scroll'].includes(st.overflow) || ['auto', 'scroll'].includes(st.overflowY)) {
                scrollParents.push(el);
            }
            el = el.parentElement;
        }
        scrollParents.forEach(p => p.addEventListener('scroll', handler, { passive: true }));
        window.addEventListener('resize', handler);
        return () => {
            scrollParents.forEach(p => p.removeEventListener('scroll', handler));
            window.removeEventListener('resize', handler);
        };
    }, [img]);

    const startDrag = (e: React.MouseEvent) => {
        e.preventDefault(); e.stopPropagation();
        const startX = e.clientX;
        const startW = img.offsetWidth;
        const ratio = img.naturalHeight / img.naturalWidth;
        const move = (ev: MouseEvent) => {
            const w = Math.max(60, startW + (ev.clientX - startX));
            img.style.width = w + 'px';
            img.style.height = Math.round(w * ratio) + 'px';
            reposition();
        };
        const up = () => { document.removeEventListener('mousemove', move); document.removeEventListener('mouseup', up); onDone(); reposition(); };
        document.addEventListener('mousemove', move);
        document.addEventListener('mouseup', up);
    };

    // Use viewport-relative coordinates (fixed positioning)
    const rect = img.getBoundingClientRect();

    // Ensure image has a proper wrapper div
    const ensureWrapper = (): HTMLElement => {
        const ce = img.closest('[contenteditable]')!;
        let wrapper = img.parentElement;
        if (!wrapper || wrapper === ce || wrapper.getAttribute('contenteditable') !== null) {
            wrapper = document.createElement('div');
            img.parentNode!.insertBefore(wrapper, img);
            wrapper.appendChild(img);
        }
        return wrapper;
    };

    const setAlign = (align: string) => {
        const wrapper = ensureWrapper();
        wrapper.style.textAlign = align;
        if (align === 'center') {
            img.style.display = 'block';
            img.style.marginLeft = 'auto';
            img.style.marginRight = 'auto';
        } else if (align === 'right') {
            img.style.display = 'block';
            img.style.marginLeft = 'auto';
            img.style.marginRight = '0';
        } else {
            img.style.display = 'block';
            img.style.marginLeft = '0';
            img.style.marginRight = 'auto';
        }
        onDone();
        requestAnimationFrame(reposition);
    };

    const setSize = (pct: number) => {
        const ce = img.closest('[contenteditable]');
        const containerW = ce ? ce.getBoundingClientRect().width - 24 : 600;
        const w = Math.round(containerW * pct / 100);
        const ratio = img.naturalHeight / img.naturalWidth;
        img.style.width = w + 'px';
        img.style.height = Math.round(w * ratio) + 'px';
        onDone();
        requestAnimationFrame(reposition);
    };

    const removeImg = () => {
        const wrapper = img.parentElement;
        const ce = img.closest('[contenteditable]');
        img.remove();
        if (wrapper && wrapper !== ce && wrapper.children.length === 0 && !wrapper.textContent?.trim()) {
            wrapper.remove();
        }
        onDone();
        onDismiss();
    };

    // Detect current alignment
    const ml = img.style.marginLeft;
    const mr = img.style.marginRight;
    const currentAlign = (ml === 'auto' && mr === 'auto') ? 'center'
        : (ml === 'auto' && (mr === '0px' || mr === '0')) ? 'right' : 'left';

    // Toolbar position: fixed centered above the image
    const toolbarTop = rect.top - 40;
    const toolbarLeft = rect.left + rect.width / 2;

    return (
        <>
            {/* Blue border + resize handle: fixed over the image */}
            <div data-img-overlay style={{ position: 'fixed', top: rect.top, left: rect.left, width: rect.width, height: rect.height, pointerEvents: 'none', zIndex: 9998 }}>
                <div className="absolute inset-0 ring-2 ring-blue-500 rounded" />
                <div className="absolute -right-1.5 -bottom-1.5 w-4 h-4 bg-blue-500 rounded-sm cursor-se-resize flex items-center justify-center"
                    style={{ pointerEvents: 'auto' }} onMouseDown={startDrag}>
                    <GripVertical className="w-2.5 h-2.5 text-white" />
                </div>
            </div>
            {/* Toolbar: fixed above the image */}
            <div ref={toolbarRef} data-img-overlay
                className="flex items-center gap-0.5 px-1.5 py-1 rounded-lg shadow-xl"
                style={{
                    position: 'fixed', top: toolbarTop, left: toolbarLeft, transform: 'translateX(-50%)',
                    zIndex: 9999, background: 'var(--color-surface)', border: '1px solid var(--color-border)', whiteSpace: 'nowrap',
                }}
                onMouseDown={e => { e.preventDefault(); e.stopPropagation(); }}>
                <button onClick={() => setAlign('left')} type="button"
                    className="p-1 rounded hover:bg-black/5" title="ชิดซ้าย"
                    style={{ background: currentAlign === 'left' ? 'rgba(59,130,246,0.15)' : undefined }}>
                    <AlignLeft className="w-3 h-3" style={{ color: currentAlign === 'left' ? '#3B82F6' : undefined }} />
                </button>
                <button onClick={() => setAlign('center')} type="button"
                    className="p-1 rounded hover:bg-black/5" title="กึ่งกลาง"
                    style={{ background: currentAlign === 'center' ? 'rgba(59,130,246,0.15)' : undefined }}>
                    <AlignCenter className="w-3 h-3" style={{ color: currentAlign === 'center' ? '#3B82F6' : undefined }} />
                </button>
                <button onClick={() => setAlign('right')} type="button"
                    className="p-1 rounded hover:bg-black/5" title="ชิดขวา"
                    style={{ background: currentAlign === 'right' ? 'rgba(59,130,246,0.15)' : undefined }}>
                    <AlignRight className="w-3 h-3" style={{ color: currentAlign === 'right' ? '#3B82F6' : undefined }} />
                </button>
                <div className="w-px h-3 mx-0.5" style={{ background: 'var(--color-border)' }} />
                <button onClick={() => setSize(25)} type="button" className="px-1 py-0.5 rounded hover:bg-black/5 text-[9px] font-bold" style={{ color: 'var(--color-text-secondary)' }}>25%</button>
                <button onClick={() => setSize(50)} type="button" className="px-1 py-0.5 rounded hover:bg-black/5 text-[9px] font-bold" style={{ color: 'var(--color-text-secondary)' }}>50%</button>
                <button onClick={() => setSize(75)} type="button" className="px-1 py-0.5 rounded hover:bg-black/5 text-[9px] font-bold" style={{ color: 'var(--color-text-secondary)' }}>75%</button>
                <button onClick={() => setSize(100)} type="button" className="px-1 py-0.5 rounded hover:bg-black/5 text-[9px] font-bold" style={{ color: 'var(--color-text-secondary)' }}>100%</button>
                <div className="w-px h-3 mx-0.5" style={{ background: 'var(--color-border)' }} />
                <button onClick={removeImg} type="button" className="p-1 rounded hover:bg-red-50" title="ลบรูป"><Trash2 className="w-3 h-3 text-red-500" /></button>
            </div>
        </>
    );
}

/* Table creation dialog */
function TableInsertPopup({ onInsert, onClose: _onClose }: { onInsert: (rows: number, cols: number) => void; onClose: () => void }) {
    const [rows] = useState(3);
    const [cols] = useState(3);
    const [hover, setHover] = useState<[number, number] | null>(null);
    const maxR = 8, maxC = 8;

    return (
        <div className="absolute top-full left-0 mt-1 p-3 rounded-xl shadow-xl z-50"
            style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', minWidth: 200 }}>
            <p className="text-[10px] font-bold mb-2" style={{ color: 'var(--color-text-secondary)' }}>เลือกขนาดตาราง</p>
            <div className="grid gap-0.5" style={{ gridTemplateColumns: `repeat(${maxC}, 1fr)` }}>
                {Array.from({ length: maxR * maxC }).map((_, i) => {
                    const r = Math.floor(i / maxC) + 1, c = (i % maxC) + 1;
                    const isActive = hover ? r <= hover[0] && c <= hover[1] : r <= rows && c <= cols;
                    return (
                        <div key={i}
                            className="w-5 h-5 rounded-sm border cursor-pointer transition-all"
                            style={{
                                background: isActive ? '#3B82F6' : 'var(--color-surface-2)',
                                borderColor: isActive ? '#2563EB' : 'var(--color-border)',
                                opacity: isActive ? 1 : 0.5,
                            }}
                            onMouseEnter={() => setHover([r, c])}
                            onMouseLeave={() => setHover(null)}
                            onClick={() => onInsert(r, c)}
                        />
                    );
                })}
            </div>
            <p className="text-[10px] mt-2 text-center" style={{ color: 'var(--color-text-tertiary)' }}>
                {hover ? `${hover[0]} × ${hover[1]}` : `${rows} × ${cols}`}
            </p>
        </div>
    );
}

function RichEditor({ value, onChange, placeholder, minH = 120 }: { value: string; onChange: (html: string) => void; placeholder?: string; minH?: number }) {
    const ref = useRef<HTMLDivElement>(null);
    const fileRef = useRef<HTMLInputElement>(null);
    const [selectedImg, setSelectedImg] = useState<HTMLImageElement | null>(null);
    const [showTable, setShowTable] = useState(false);
    const [uploading, setUploading] = useState(false);

    const exec = (cmd: string, val?: string) => { document.execCommand(cmd, false, val); ref.current?.focus(); emitChange(); };
    const emitChange = () => { if (ref.current) onChange(ref.current.innerHTML); };

    // Sync initial value
    useEffect(() => {
        if (ref.current && !ref.current.innerHTML && value) ref.current.innerHTML = value;
    }, []); // eslint-disable-line react-hooks/exhaustive-deps

    // Click handler on the editor — detect image clicks for resize overlay
    const handleEditorClick = (e: React.MouseEvent) => {
        const target = e.target as HTMLElement;
        if (target.tagName === 'IMG') {
            e.preventDefault();
            setSelectedImg(target as HTMLImageElement);
        } else {
            setSelectedImg(null);
        }
    };

    // Deselect image when clicking outside editor and outside toolbar
    const overlayToolbarRef = useRef<HTMLDivElement>(null);
    useEffect(() => {
        if (!selectedImg) return;
        const handler = (e: MouseEvent) => {
            const target = e.target as Node;
            // Don't dismiss if clicking inside the editor
            if (ref.current?.contains(target)) return;
            // Don't dismiss if clicking inside the fixed overlay toolbar
            if (overlayToolbarRef.current?.contains(target)) return;
            // Check any fixed overlay elements (border/resize)
            const fixedEls = document.querySelectorAll('[data-img-overlay]');
            for (const el of fixedEls) { if (el.contains(target)) return; }
            setSelectedImg(null);
        };
        document.addEventListener('mousedown', handler, true); // capture phase
        return () => document.removeEventListener('mousedown', handler, true);
    }, [selectedImg]);

    // Insert image from URL
    const insertImageUrl = (url: string) => {
        if (ref.current) {
            ref.current.focus();
            const html = `<div style="text-align:center"><img src="${url}" style="display:block;margin-left:auto;margin-right:auto;max-width:100%;height:auto;border-radius:8px" /></div>`;
            document.execCommand('insertHTML', false, html);
            emitChange();
        }
    };

    // Handle file upload
    const handleFileUpload = async (files: FileList | null) => {
        if (!files || files.length === 0) return;
        setUploading(true);
        try {
            for (const file of Array.from(files)) {
                if (!file.type.startsWith('image/')) continue;
                const url = await uploadImage(file);
                insertImageUrl(url);
            }
        } catch { /* toast would go here */ }
        setUploading(false);
        if (fileRef.current) fileRef.current.value = '';
    };

    // Paste handler — intercept images from clipboard
    const handlePaste = async (e: React.ClipboardEvent) => {
        const items = e.clipboardData?.items;
        if (!items) return;
        for (const item of Array.from(items)) {
            if (item.type.startsWith('image/')) {
                e.preventDefault();
                const file = item.getAsFile();
                if (file) {
                    setUploading(true);
                    try {
                        const url = await uploadImage(file);
                        insertImageUrl(url);
                    } catch { /* silent */ }
                    setUploading(false);
                }
                return;
            }
        }
    };

    // Drop handler — accept dropped images
    const handleDrop = async (e: React.DragEvent) => {
        const files = e.dataTransfer?.files;
        if (files && Array.from(files).some(f => f.type.startsWith('image/'))) {
            e.preventDefault();
            await handleFileUpload(files);
        }
    };

    // Insert table
    const insertTable = (rows: number, cols: number) => {
        setShowTable(false);
        if (!ref.current) return;
        ref.current.focus();
        const cellStyle = 'border:1px solid var(--color-border);padding:6px 10px;text-align:left;min-width:60px;font-size:13px';
        const headerStyle = cellStyle + ';font-weight:700;background:var(--color-surface-2)';
        let html = '<table style="border-collapse:collapse;width:100%;margin:8px 0;border-radius:8px;overflow:hidden"><thead><tr>';
        for (let c = 0; c < cols; c++) html += `<th style="${headerStyle}">หัวข้อ ${c + 1}</th>`;
        html += '</tr></thead><tbody>';
        for (let r = 0; r < rows - 1; r++) {
            html += '<tr>';
            for (let c = 0; c < cols; c++) html += `<td style="${cellStyle}">&nbsp;</td>`;
            html += '</tr>';
        }
        html += '</tbody></table><p><br></p>';
        document.execCommand('insertHTML', false, html);
        emitChange();
    };

    // Insert link
    const insertLink = () => {
        const url = prompt('URL:');
        if (url) exec('createLink', url);
    };

    // Insert horizontal rule
    const insertHR = () => {
        if (ref.current) {
            ref.current.focus();
            document.execCommand('insertHTML', false, '<hr style="border:none;border-top:2px solid var(--color-border);margin:12px 0" />');
            emitChange();
        }
    };

    const ToolBtn = ({ onClick, icon: Icon, title, active }: { onClick: () => void; icon: React.FC<React.SVGProps<SVGSVGElement>>; title: string; active?: boolean }) => (
        <button type="button" onClick={onClick}
            className="p-1.5 rounded-lg hover:bg-black/5 transition-colors"
            style={{ background: active ? 'rgba(59,130,246,0.1)' : undefined }}
            title={title}>
            <Icon className="w-3.5 h-3.5" style={{ color: active ? '#3B82F6' : 'var(--color-text-secondary)' }} />
        </button>
    );

    return (
        <div className="rounded-xl overflow-hidden" style={{ border: '1.5px solid var(--color-border)' }}>
            {/* Toolbar Row 1: Text formatting */}
            <div className="flex items-center gap-0.5 px-2 py-1.5 flex-wrap" style={{ borderBottom: '1px solid var(--color-border)', background: 'var(--color-surface-2)' }}>
                <ToolBtn onClick={() => exec('bold')} icon={Bold} title="ตัวหนา (Ctrl+B)" />
                <ToolBtn onClick={() => exec('italic')} icon={Italic} title="ตัวเอียง (Ctrl+I)" />
                <ToolBtn onClick={() => exec('underline')} icon={UnderlineIcon} title="ขีดเส้นใต้ (Ctrl+U)" />
                <ToolBtn onClick={() => exec('strikeThrough')} icon={Strikethrough} title="ขีดฆ่า" />
                <div className="w-px h-4 mx-1" style={{ background: 'var(--color-border)' }} />
                <ToolBtn onClick={() => exec('formatBlock', '<h1>')} icon={Heading1} title="หัวข้อใหญ่" />
                <ToolBtn onClick={() => exec('formatBlock', '<h2>')} icon={Heading2} title="หัวข้อรอง" />
                <ToolBtn onClick={() => exec('formatBlock', '<blockquote>')} icon={Quote} title="อ้างอิง (Quote)" />
                <ToolBtn onClick={() => exec('formatBlock', '<pre>')} icon={Code} title="Code Block" />
                <div className="w-px h-4 mx-1" style={{ background: 'var(--color-border)' }} />
                <ToolBtn onClick={() => exec('justifyLeft')} icon={AlignLeft} title="ชิดซ้าย" />
                <ToolBtn onClick={() => exec('justifyCenter')} icon={AlignCenter} title="กึ่งกลาง" />
                <ToolBtn onClick={() => exec('justifyRight')} icon={AlignRight} title="ชิดขวา" />
                <div className="w-px h-4 mx-1" style={{ background: 'var(--color-border)' }} />
                <ToolBtn onClick={() => exec('insertUnorderedList')} icon={List} title="รายการจุด" />
                <ToolBtn onClick={() => exec('insertOrderedList')} icon={ListOrdered} title="รายการลำดับ" />
                <div className="w-px h-4 mx-1" style={{ background: 'var(--color-border)' }} />
                <ToolBtn onClick={insertLink} icon={Link} title="แทรกลิงก์" />
                <ToolBtn onClick={insertHR} icon={Minus} title="เส้นคั่น" />
                <div className="w-px h-4 mx-1" style={{ background: 'var(--color-border)' }} />
                {/* Image button */}
                <ToolBtn onClick={() => fileRef.current?.click()} icon={ImageIcon} title="แทรกรูปภาพ" />
                {/* Table button */}
                <div className="relative">
                    <ToolBtn onClick={() => setShowTable(!showTable)} icon={Table} title="แทรกตาราง" active={showTable} />
                    {showTable && <TableInsertPopup onInsert={insertTable} onClose={() => setShowTable(false)} />}
                </div>
                <div className="w-px h-4 mx-1" style={{ background: 'var(--color-border)' }} />
                <select onChange={e => { if (e.target.value) exec('fontSize', e.target.value); e.target.value = ''; }}
                    className="text-[10px] px-1.5 py-1 rounded border-none outline-none cursor-pointer"
                    style={{ background: 'var(--color-surface)', color: 'var(--color-text-secondary)' }}>
                    <option value="">ขนาด</option>
                    <option value="1">เล็ก</option>
                    <option value="3">ปกติ</option>
                    <option value="5">ใหญ่</option>
                    <option value="7">ใหญ่มาก</option>
                </select>
                <select onChange={e => { if (e.target.value) exec('foreColor', e.target.value); e.target.value = ''; }}
                    className="text-[10px] px-1.5 py-1 rounded border-none outline-none cursor-pointer"
                    style={{ background: 'var(--color-surface)', color: 'var(--color-text-secondary)' }}>
                    <option value="">สี</option>
                    <option value="#000000">ดำ</option>
                    <option value="#EF4444">แดง</option>
                    <option value="#F59E0B">ส้ม</option>
                    <option value="#10B981">เขียว</option>
                    <option value="#3B82F6">น้ำเงิน</option>
                    <option value="#8B5CF6">ม่วง</option>
                    <option value="#EC4899">ชมพู</option>
                    <option value="#6B7280">เทา</option>
                </select>
                <select onChange={e => { if (e.target.value) exec('hiliteColor', e.target.value); e.target.value = ''; }}
                    className="text-[10px] px-1.5 py-1 rounded border-none outline-none cursor-pointer"
                    style={{ background: 'var(--color-surface)', color: 'var(--color-text-secondary)' }}>
                    <option value="">ไฮไลท์</option>
                    <option value="#FEF9C3">เหลือง</option>
                    <option value="#DCFCE7">เขียว</option>
                    <option value="#DBEAFE">น้ำเงิน</option>
                    <option value="#FCE7F3">ชมพู</option>
                    <option value="#F3E8FF">ม่วง</option>
                    <option value="transparent">ลบไฮไลท์</option>
                </select>
            </div>

            {/* Hidden file input */}
            <input ref={fileRef} type="file" accept="image/*" multiple className="hidden"
                onChange={e => handleFileUpload(e.target.files)} />

            {/* Editor area */}
            <div className="relative">
                {uploading && (
                    <div className="absolute inset-0 z-30 flex items-center justify-center bg-black/10 rounded-b-xl">
                        <div className="flex items-center gap-2 px-4 py-2 rounded-full shadow-lg" style={{ background: 'var(--color-surface)' }}>
                            <Upload className="w-4 h-4 animate-bounce" style={{ color: '#3B82F6' }} />
                            <span className="text-[12px] font-bold" style={{ color: 'var(--color-text-primary)' }}>กำลังอัพโหลดรูป...</span>
                        </div>
                    </div>
                )}
                <div ref={ref} contentEditable
                    className="p-3 text-[13px] outline-none min-h-[var(--min-h)] overflow-y-auto rich-editor-content"
                    style={{
                        '--min-h': `${minH}px`,
                        color: 'var(--color-text-primary)',
                        background: 'var(--color-surface)',
                    } as React.CSSProperties}
                    data-placeholder={placeholder}
                    onClick={handleEditorClick}
                    onInput={emitChange}
                    onPaste={handlePaste}
                    onDrop={handleDrop}
                    onDragOver={e => e.preventDefault()}
                />
            </div>
            {/* Image overlay: rendered OUTSIDE overflow-hidden via portal to body */}
            {selectedImg && ref.current?.contains(selectedImg) &&
                ReactDOM.createPortal(
                    <ImageResizeOverlay img={selectedImg} onDone={emitChange} onDismiss={() => setSelectedImg(null)} />,
                    document.body
                )
            }
        </div>
    );
}

// ─── Ticket Modal ─────────────────────────────────────────────────────────────
function TicketModal({ ticket, onClose, onUpdated, userName }: { ticket: ZTicket; onClose: () => void; onUpdated: () => void; userName?: string }) {
    const [articles, setArticles] = useState<ZArticle[]>([]);
    const [loading,  setLoading]  = useState(true);
    const [error,    setError]    = useState<string | null>(null);
    const [confirmDelete, setConfirmDelete] = useState(false);
    const [deleting, setDeleting] = useState(false);
    const isSuperAdmin = userName === 'Panupong Nijjaboon';

    // Lock body scroll while modal is open
    useEffect(() => {
        const orig = document.body.style.overflow;
        document.body.style.overflow = 'hidden';
        return () => { document.body.style.overflow = orig; };
    }, []);

    // Editable state
    const [editStatus, setEditStatus]     = useState(ticket.state_id);
    const [editPriority, setEditPriority] = useState(ticket.priority_id);
    const [editGroup, setEditGroup]       = useState(ticket.group_id);
    const [editOwner, setEditOwner]       = useState(ticket.owner_id);
    const [editTitle, setEditTitle]       = useState(ticket.title);
    const [isEditingTitle, setIsEditingTitle] = useState(false);
    const [saving, setSaving]             = useState(false);

    // Lookups
    const [states, setStates]       = useState<{id: number; name: string}[]>([]);
    const [priorities, setPriorities] = useState<{id: number; name: string}[]>([]);
    const [groups, setGroups]       = useState<{id: number; name: string}[]>([]);
    const [zUsers, setZUsers]       = useState<{id: number; firstname: string; lastname: string; login: string}[]>([]);

    // Internal note
    const [noteBody, setNoteBody] = useState('');
    const [sendingNote, setSendingNote] = useState(false);

    // Tags
    const [tags, setTags]         = useState<string[]>([]);
    const [newTag, setNewTag]     = useState('');

    // Time accounting
    const [timeEntries, setTimeEntries] = useState<{id: number; time_unit: number; created_at: string}[]>([]);
    const [newTime, setNewTime]   = useState('');

    // Tabs
    const [activeTab, setActiveTab] = useState<'articles' | 'note' | 'tags' | 'time'>('articles');

    // Toast
    const [toast, setToast] = useState<string | null>(null);
    const showToast = (msg: string) => { setToast(msg); setTimeout(() => setToast(null), 2500); };

    // Delete ticket handler (Super Admin only)
    const handleDelete = async () => {
        setDeleting(true);
        try {
            const r = await fetch(`/api/zammad/tickets/${ticket.id}`, { method: 'DELETE' });
            if (!r.ok) throw new Error('Delete failed');
            onUpdated();
            onClose();
        } catch {
            showToast('ลบ Ticket ไม่สำเร็จ');
        } finally {
            setDeleting(false);
            setConfirmDelete(false);
        }
    };

    // Current displayed state meta
    const currentState = states.find(s => s.id === editStatus);
    const sm = STATE_META[(currentState?.name ?? ticket.state ?? '').toLowerCase()] ?? STATE_META['open'];
    const currentPrio  = priorities.find(p => p.id === editPriority);
    void priorities.find(p => p.id === editPriority); // suppress unused
    const _pm = PRIO_META[(currentPrio?.name ?? ticket.priority ?? '').toLowerCase()] ?? { color: '#6B7280', bg: '#F9FAFB', label: ticket.priority };
    void _pm;
    const SIcon = sm.Icon;
    void SIcon;

    // Load everything on mount
    useEffect(() => {
        setLoading(true); setError(null);
        Promise.all([
            fetch(`/api/zammad/tickets/${ticket.id}/articles`).then(r => r.ok ? r.json() : []),
            fetch('/api/zammad/ticket_states').then(r => r.ok ? r.json() : []),
            fetch('/api/zammad/ticket_priorities').then(r => r.ok ? r.json() : []),
            fetch('/api/zammad/groups').then(r => r.ok ? r.json() : []),
            fetch('/api/zammad/users?limit=200').then(r => r.ok ? r.json() : []),
            fetch(`/api/zammad/tickets/${ticket.id}/tags`).then(r => r.ok ? r.json() : { tags: [] }),
            fetch(`/api/zammad/tickets/${ticket.id}/time`).then(r => r.ok ? r.json() : []),
        ]).then(([arts, sts, pris, grps, usrs, tgs, tms]) => {
            setArticles(Array.isArray(arts) ? arts : []);
            setStates(Array.isArray(sts) ? sts : []);
            setPriorities(Array.isArray(pris) ? pris : []);
            setGroups(Array.isArray(grps) ? grps : []);
            setZUsers(Array.isArray(usrs) ? usrs : []);
            setTags(Array.isArray(tgs?.tags) ? tgs.tags : []);
            setTimeEntries(Array.isArray(tms) ? tms : []);
            setLoading(false);
        }).catch(e => { setError(String(e)); setLoading(false); });
    }, [ticket.id]);

    // Save ticket update
    const saveUpdate = async (field: Record<string, unknown>) => {
        setSaving(true);
        try {
            const r = await fetch(`/api/zammad/tickets/${ticket.id}`, {
                method: 'PUT', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(field),
            });
            if (!r.ok) throw new Error(await r.text());
            showToast('บันทึกสำเร็จ');
            onUpdated();
        } catch (e) { showToast('เกิดข้อผิดพลาด: ' + String(e)); }
        setSaving(false);
    };

    // Send internal note
    const sendNote = async () => {
        if (!noteBody.trim()) return;
        setSendingNote(true);
        try {
            const r = await fetch(`/api/zammad/tickets/${ticket.id}/articles`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ body: noteBody, content_type: 'text/html' }),
            });
            if (!r.ok) throw new Error(await r.text());
            const newArt = await r.json();
            setArticles(prev => [...prev, newArt]);
            setNoteBody('');
            showToast('เพิ่มโน้ตสำเร็จ');
            setActiveTab('articles');
        } catch (e) { showToast('เกิดข้อผิดพลาด: ' + String(e)); }
        setSendingNote(false);
    };

    // Add/remove tag
    const addTag = async () => {
        const t = newTag.trim();
        if (!t || tags.includes(t)) return;
        try {
            await fetch(`/api/zammad/tickets/${ticket.id}/tags`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ item: t }),
            });
            setTags(prev => [...prev, t]);
            setNewTag('');
            showToast(`เพิ่มแท็ก "${t}"`);
        } catch { showToast('เพิ่มแท็กไม่สำเร็จ'); }
    };
    const removeTag = async (t: string) => {
        try {
            await fetch(`/api/zammad/tickets/${ticket.id}/tags`, {
                method: 'DELETE', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ item: t }),
            });
            setTags(prev => prev.filter(x => x !== t));
            showToast(`ลบแท็ก "${t}"`);
        } catch { showToast('ลบแท็กไม่สำเร็จ'); }
    };

    // Add time entry
    const addTime = async () => {
        const n = parseFloat(newTime);
        if (!n || n <= 0) return;
        try {
            const r = await fetch(`/api/zammad/tickets/${ticket.id}/time`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ time_unit: n }),
            });
            if (!r.ok) throw new Error(await r.text());
            const entry = await r.json();
            setTimeEntries(prev => [...prev, entry]);
            setNewTime('');
            showToast(`บันทึก ${n} นาที`);
        } catch { showToast('บันทึกเวลาไม่สำเร็จ'); }
    };

    // Only show non-inline files in the "all attachments" summary
    const allAttachments = articles.flatMap(a =>
        (a.attachments ?? [])
            .filter(att => !att.preferences['content_preview'])
            .map(att => ({ att, articleId: a.id }))
    );

    const totalTime = timeEntries.reduce((s, e) => s + (e.time_unit || 0), 0);

    return (
        <Modal isOpen onClose={onClose} showCloseButton={false}
            className="w-full max-w-4xl m-4 overflow-hidden">
            <div className="relative flex flex-col overflow-hidden rounded-3xl" style={{ maxHeight: '92vh' }}>

                {/* Header */}
                <div className="flex-shrink-0 px-6 py-5" style={{ borderBottom: '1px solid var(--color-border)', background: 'var(--color-surface-2)' }}>
                    <div className="flex items-start gap-3">
                        <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-2 flex-wrap">
                                <span className="text-[11px] font-black" style={{ color: 'var(--color-primary)' }}>#{ticket.number}</span>
                                {/* Status dropdown */}
                                <DropdownBadge
                                    value={editStatus}
                                    disabled={saving}
                                    options={states.filter(s => s.name !== 'merged').map(s => {
                                        const m = STATE_META[s.name.toLowerCase()] ?? { color: '#6B7280', bg: '#F9FAFB', label: s.name };
                                        return { id: s.id, label: m.label, color: m.color, bg: m.bg };
                                    })}
                                    onChange={v => { setEditStatus(v); saveUpdate({ state_id: v }); }}
                                />
                                {/* Priority dropdown */}
                                <DropdownBadge
                                    value={editPriority}
                                    disabled={saving}
                                    options={priorities.map(p => {
                                        const m = PRIO_META[p.name.toLowerCase()] ?? { color: '#6B7280', bg: '#F9FAFB', label: p.name };
                                        return { id: p.id, label: m.label, color: m.color, bg: m.bg };
                                    })}
                                    onChange={v => { setEditPriority(v); saveUpdate({ priority_id: v }); }}
                                />
                                {saving && <span className="text-[10px]" style={{ color: 'var(--color-text-tertiary)' }}>กำลังบันทึก...</span>}
                            </div>
                            {/* Editable title */}
                            {isEditingTitle ? (
                                <div className="flex items-center gap-2">
                                    <input value={editTitle} onChange={e => setEditTitle(e.target.value)}
                                        className="flex-1 text-base font-bold bg-transparent outline-none px-2 py-1 rounded-lg"
                                        style={{ color: 'var(--color-text-primary)', border: '1.5px solid var(--color-primary)' }}
                                        onKeyDown={e => { if (e.key === 'Enter') { saveUpdate({ title: editTitle }); setIsEditingTitle(false); } if (e.key === 'Escape') { setEditTitle(ticket.title); setIsEditingTitle(false); } }}
                                        autoFocus />
                                    <button onClick={() => { saveUpdate({ title: editTitle }); setIsEditingTitle(false); }} className="btn-icon" title="บันทึก">
                                        <Save className="w-4 h-4" style={{ color: '#10B981' }} />
                                    </button>
                                    <button onClick={() => { setEditTitle(ticket.title); setIsEditingTitle(false); }} className="btn-icon" title="ยกเลิก">
                                        <X className="w-4 h-4" />
                                    </button>
                                </div>
                            ) : (
                                <div className="flex items-center gap-2 group">
                                    <h2 className="text-base font-bold leading-snug" style={{ color: 'var(--color-text-primary)' }}>
                                        {editTitle}
                                    </h2>
                                    <button onClick={() => setIsEditingTitle(true)}
                                        className="opacity-0 group-hover:opacity-100 transition-opacity btn-icon" title="แก้ไขหัวข้อ">
                                        <Edit3 className="w-3.5 h-3.5" style={{ color: 'var(--color-text-tertiary)' }} />
                                    </button>
                                </div>
                            )}
                        </div>
                        <div className="flex items-center gap-2 flex-shrink-0">
                            {isSuperAdmin && (
                                <button onClick={() => setConfirmDelete(true)}
                                    className="btn-icon" title="ลบ Ticket"
                                    style={{ color: '#EF4444' }}>
                                    <Trash2 className="w-4 h-4" />
                                </button>
                            )}
                            <a href={`https://ticket.tenfw.com/#ticket/zoom/${ticket.id}`} target="_blank" rel="noopener noreferrer"
                                className="btn-icon" title="เปิดใน Zammad">
                                <ExternalLink className="w-4 h-4" />
                            </a>
                            <button onClick={onClose} className="btn-icon"><X className="w-4 h-4" /></button>
                        </div>
                    </div>

                    {/* Meta grid — editable group + owner */}
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-4">
                        {/* Customer (read-only) */}
                        <div className="flex items-center gap-2 px-3 py-2 rounded-xl"
                            style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
                            <User className="w-3.5 h-3.5 flex-shrink-0" style={{ color: 'var(--color-text-tertiary)' }} />
                            <div className="min-w-0">
                                <p className="text-[9px] font-bold uppercase tracking-wide" style={{ color: 'var(--color-text-tertiary)' }}>ผู้ส่ง</p>
                                <p className="text-[11px] font-semibold truncate" style={{ color: 'var(--color-text-primary)' }}>{displayName(ticket.customer)}</p>
                            </div>
                        </div>
                        {/* Group (editable) */}
                        <div className="flex items-center gap-2 px-3 py-2 rounded-xl"
                            style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
                            <Users className="w-3.5 h-3.5 flex-shrink-0" style={{ color: 'var(--color-text-tertiary)' }} />
                            <div className="min-w-0 flex-1">
                                <p className="text-[9px] font-bold uppercase tracking-wide" style={{ color: 'var(--color-text-tertiary)' }}>กลุ่ม</p>
                                <select value={editGroup} disabled={saving}
                                    onChange={e => { const v = Number(e.target.value); setEditGroup(v); saveUpdate({ group_id: v }); }}
                                    className="text-[11px] font-semibold bg-transparent border-none outline-none cursor-pointer w-full truncate p-0"
                                    style={{ color: 'var(--color-text-primary)' }}>
                                    {groups.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
                                    {groups.length === 0 && <option value={editGroup}>{ticket.group}</option>}
                                </select>
                            </div>
                        </div>
                        {/* Owner (editable) */}
                        <div className="flex items-center gap-2 px-3 py-2 rounded-xl"
                            style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
                            <User className="w-3.5 h-3.5 flex-shrink-0" style={{ color: 'var(--color-text-tertiary)' }} />
                            <div className="min-w-0 flex-1">
                                <p className="text-[9px] font-bold uppercase tracking-wide" style={{ color: 'var(--color-text-tertiary)' }}>ผู้รับผิดชอบ</p>
                                <select value={editOwner} disabled={saving}
                                    onChange={e => { const v = Number(e.target.value); setEditOwner(v); saveUpdate({ owner_id: v }); }}
                                    className="text-[11px] font-semibold bg-transparent border-none outline-none cursor-pointer w-full truncate p-0"
                                    style={{ color: 'var(--color-text-primary)' }}>
                                    <option value={0}>— ยังไม่กำหนด —</option>
                                    {zUsers.map(u => <option key={u.id} value={u.id}>{u.firstname} {u.lastname}</option>)}
                                </select>
                            </div>
                        </div>
                    </div>

                    {/* Tags inline */}
                    {tags.length > 0 && (
                        <div className="flex items-center gap-1.5 mt-3 flex-wrap">
                            <Tag className="w-3 h-3 flex-shrink-0" style={{ color: 'var(--color-text-tertiary)' }} />
                            {tags.map(t => (
                                <span key={t} className="inline-flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded-full"
                                    style={{ background: '#2563EB18', color: '#2563EB' }}>
                                    {t}
                                    <button onClick={() => removeTag(t)} className="hover:text-red-500">×</button>
                                </span>
                            ))}
                        </div>
                    )}
                </div>

                {/* Tabs */}
                <div className="flex-shrink-0 flex items-center gap-1 px-6 py-2" style={{ borderBottom: '1px solid var(--color-border)', background: 'var(--color-surface-2)' }}>
                    {([
                        { key: 'articles', label: 'ข้อความ', icon: MessageSquare, count: articles.length },
                        { key: 'note',     label: 'เพิ่มโน้ต', icon: Edit3 },
                        { key: 'tags',     label: 'แท็ก', icon: Tag, count: tags.length },
                        { key: 'time',     label: 'เวลา', icon: Timer, count: timeEntries.length },
                    ] as { key: typeof activeTab; label: string; icon: React.FC<React.SVGProps<SVGSVGElement>>; count?: number }[]).map(tab => {
                        const TIcon = tab.icon;
                        return (
                            <button key={tab.key} onClick={() => setActiveTab(tab.key)}
                                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-semibold transition-all"
                                style={{
                                    background: activeTab === tab.key ? 'var(--color-primary)' : 'transparent',
                                    color: activeTab === tab.key ? '#fff' : 'var(--color-text-secondary)',
                                }}>
                                <TIcon className="w-3.5 h-3.5" />
                                {tab.label}
                                {tab.count !== undefined && <span className="text-[9px] px-1 rounded-full" style={{ background: activeTab === tab.key ? 'rgba(255,255,255,0.2)' : 'var(--color-surface-2)' }}>{tab.count}</span>}
                            </button>
                        );
                    })}
                </div>

                {/* Body */}
                <div className="flex-1 overflow-y-auto p-6 space-y-5">
                    {loading ? (
                        <div className="flex flex-col items-center py-12 gap-3">
                            <div className="w-7 h-7 border-3 rounded-full animate-spin"
                                style={{ border: '3px solid var(--color-primary)', borderTopColor: 'transparent' }} />
                            <p className="text-sm" style={{ color: 'var(--color-text-tertiary)' }}>กำลังโหลดข้อความ...</p>
                        </div>
                    ) : error ? (
                        <div className="text-center py-8">
                            <AlertCircle className="w-8 h-8 mx-auto mb-2" style={{ color: '#EF4444' }} />
                            <p className="text-sm" style={{ color: 'var(--color-text-tertiary)' }}>{error}</p>
                        </div>
                    ) : activeTab === 'articles' ? (
                        /* ── Articles tab ── */
                        articles.length === 0 ? (
                            <p className="text-center py-8 text-sm" style={{ color: 'var(--color-text-tertiary)' }}>ไม่มีข้อความ</p>
                        ) : (
                            <>
                                {articles.map((article, idx) => (
                                    <motion.div key={article.id}
                                        initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
                                        transition={{ delay: idx * 0.05 }}>

                                        <div className="flex items-center gap-2 mb-2">
                                            <div className="w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-bold text-white flex-shrink-0"
                                                style={{ background: article.internal ? '#6366F1' : '#2563EB' }}>
                                                {(displayName(article.from)[0] || '?').toUpperCase()}
                                            </div>
                                            <div className="flex-1 min-w-0">
                                                <div className="flex items-center gap-2 flex-wrap">
                                                    <p className="text-[12px] font-bold" style={{ color: 'var(--color-text-primary)' }}>{displayName(article.from)}</p>
                                                    {article.internal && (
                                                        <span className="text-[9px] font-bold px-1.5 py-0.5 rounded"
                                                            style={{ background: '#F5F3FF', color: '#1D4ED8' }}>ภายใน</span>
                                                    )}
                                                </div>
                                                <div className="flex items-center gap-2 text-[10px] flex-wrap" style={{ color: 'var(--color-text-tertiary)' }}>
                                                    {article.to && (
                                                        <span className="flex items-center gap-1">
                                                            <Mail className="w-3 h-3" />ถึง: {displayName(article.to)}
                                                        </span>
                                                    )}
                                                    <span>{formatDate(article.created_at)}</span>
                                                </div>
                                            </div>
                                        </div>

                                        <div className="rounded-xl overflow-hidden ml-9"
                                            style={{ border: `1.5px solid ${article.internal ? '#DDD6FE' : 'var(--color-border)'}`, background: article.internal ? '#FAF5FF' : 'var(--color-surface-2)' }}>
                                            {article.content_type === 'text/html' ? (
                                                <div
                                                    className="p-4 text-[12px] leading-relaxed overflow-x-auto"
                                                    style={{ color: 'var(--color-text-primary)' }}
                                                    dangerouslySetInnerHTML={{
                                                        __html:
                                                            `<style>
                                                                .zmail img { display: inline-block !important; max-width: 100% !important; height: auto !important; vertical-align: middle; }
                                                                .zmail table { border-collapse: collapse; }
                                                                .zmail td, .zmail th { vertical-align: top; }
                                                            </style><div class="zmail">` +
                                                            article.body +
                                                            `</div>`
                                                    }}
                                                />
                                            ) : (
                                                <pre className="p-4 text-[12px] whitespace-pre-wrap" style={{ color: 'var(--color-text-primary)', fontFamily: 'inherit' }}>
                                                    {article.body}
                                                </pre>
                                            )}
                                        </div>

                                        {(article.attachments ?? []).filter(att => !att.preferences['content_preview']).length > 0 && (
                                            <div className="grid grid-cols-2 gap-2 ml-9 mt-2">
                                                {article.attachments.filter(att => !att.preferences['content_preview']).map(att => (
                                                    <AttachmentCard key={att.id} att={att} ticketId={ticket.id} articleId={article.id} />
                                                ))}
                                            </div>
                                        )}
                                    </motion.div>
                                ))}

                                {allAttachments.length > 0 && (
                                    <div>
                                        <p className="text-[11px] font-black uppercase tracking-widest mb-3 flex items-center gap-1.5"
                                            style={{ color: 'var(--color-text-tertiary)' }}>
                                            <Paperclip className="w-3.5 h-3.5" />ไฟล์แนบทั้งหมด ({allAttachments.length})
                                        </p>
                                        <div className="grid grid-cols-2 gap-2">
                                            {allAttachments.map(({ att, articleId }) => (
                                                <AttachmentCard key={att.id} att={att} ticketId={ticket.id} articleId={articleId} />
                                            ))}
                                        </div>
                                    </div>
                                )}
                            </>
                        )
                    ) : activeTab === 'note' ? (
                        /* ── Internal note tab ── */
                        <div className="space-y-4">
                            <div>
                                <p className="text-[12px] font-bold mb-2 flex items-center gap-1.5" style={{ color: 'var(--color-text-primary)' }}>
                                    <Edit3 className="w-3.5 h-3.5" style={{ color: '#6366F1' }} />
                                    เพิ่มโน้ตภายใน
                                </p>
                                <p className="text-[10px] mb-3" style={{ color: 'var(--color-text-tertiary)' }}>
                                    โน้ตนี้จะเป็นแบบ Internal เท่านั้น — ไม่ถูกส่งไปหาลูกค้า
                                </p>
                                <RichEditor value={noteBody} onChange={setNoteBody} placeholder="พิมพ์โน้ตที่นี่..." />
                            </div>
                            <div className="flex justify-end">
                                <button onClick={sendNote} disabled={sendingNote || !noteBody.trim()}
                                    className="btn btn-primary gap-2 text-[12px]" style={{ opacity: !noteBody.trim() ? 0.5 : 1 }}>
                                    <Send className="w-3.5 h-3.5" />
                                    {sendingNote ? 'กำลังส่ง...' : 'ส่งโน้ต (Internal)'}
                                </button>
                            </div>
                        </div>
                    ) : activeTab === 'tags' ? (
                        /* ── Tags tab ── */
                        <div className="space-y-4">
                            <p className="text-[12px] font-bold flex items-center gap-1.5" style={{ color: 'var(--color-text-primary)' }}>
                                <Tag className="w-3.5 h-3.5" style={{ color: '#2563EB' }} />
                                จัดการแท็ก
                            </p>
                            <div className="flex items-center gap-2">
                                <input value={newTag} onChange={e => setNewTag(e.target.value)}
                                    onKeyDown={e => { if (e.key === 'Enter') addTag(); }}
                                    className="flex-1 text-[12px] px-3 py-2 rounded-xl bg-transparent outline-none"
                                    style={{ border: '1.5px solid var(--color-border)', color: 'var(--color-text-primary)' }}
                                    placeholder="พิมพ์ชื่อแท็กแล้ว Enter..." />
                                <button onClick={addTag} className="btn btn-primary gap-1.5 text-[11px]">
                                    <Plus className="w-3.5 h-3.5" /> เพิ่ม
                                </button>
                            </div>
                            {tags.length === 0 ? (
                                <p className="text-center py-6 text-[12px]" style={{ color: 'var(--color-text-tertiary)' }}>ยังไม่มีแท็ก</p>
                            ) : (
                                <div className="flex flex-wrap gap-2">
                                    {tags.map(t => (
                                        <span key={t} className="inline-flex items-center gap-1.5 text-[12px] font-medium px-3 py-1.5 rounded-full"
                                            style={{ background: '#2563EB18', color: '#2563EB' }}>
                                            <Tag className="w-3 h-3" />{t}
                                            <button onClick={() => removeTag(t)} className="ml-0.5 hover:text-red-500 text-lg leading-none">×</button>
                                        </span>
                                    ))}
                                </div>
                            )}
                        </div>
                    ) : (
                        /* ── Time accounting tab ── */
                        <div className="space-y-4">
                            <p className="text-[12px] font-bold flex items-center gap-1.5" style={{ color: 'var(--color-text-primary)' }}>
                                <Timer className="w-3.5 h-3.5" style={{ color: '#F59E0B' }} />
                                บันทึกเวลาทำงาน
                            </p>
                            <div className="flex items-center gap-2">
                                <input type="number" value={newTime} onChange={e => setNewTime(e.target.value)}
                                    onKeyDown={e => { if (e.key === 'Enter') addTime(); }}
                                    className="w-32 text-[12px] px-3 py-2 rounded-xl bg-transparent outline-none"
                                    style={{ border: '1.5px solid var(--color-border)', color: 'var(--color-text-primary)' }}
                                    placeholder="นาที" min="0" step="15" />
                                <button onClick={addTime} className="btn btn-primary gap-1.5 text-[11px]">
                                    <Plus className="w-3.5 h-3.5" /> บันทึก
                                </button>
                                {totalTime > 0 && (
                                    <span className="text-[11px] font-bold px-2 py-1 rounded-lg" style={{ background: '#F59E0B18', color: '#F59E0B' }}>
                                        รวม {totalTime >= 60 ? `${Math.floor(totalTime / 60)} ชม. ${Math.round(totalTime % 60)} น.` : `${Math.round(totalTime)} นาที`}
                                    </span>
                                )}
                            </div>
                            {timeEntries.length > 0 && (
                                <div className="space-y-1.5">
                                    {timeEntries.map((e, i) => (
                                        <div key={e.id ?? i} className="flex items-center gap-3 px-3 py-2 rounded-lg text-[11px]"
                                            style={{ background: 'var(--color-surface-2)', border: '1px solid var(--color-border)' }}>
                                            <Timer className="w-3 h-3 flex-shrink-0" style={{ color: '#F59E0B' }} />
                                            <span className="font-bold" style={{ color: '#F59E0B' }}>{e.time_unit} นาที</span>
                                            <span style={{ color: 'var(--color-text-tertiary)' }}>{e.created_at ? formatDate(e.created_at) : ''}</span>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    )}
                </div>

                {/* Footer */}
                <div className="flex-shrink-0 px-6 py-3 flex items-center justify-between"
                    style={{ borderTop: '1px solid var(--color-border)', background: 'var(--color-surface-2)' }}>
                    <p className="text-[11px]" style={{ color: 'var(--color-text-tertiary)' }}>
                        สร้าง: {formatDate(ticket.created_at)} · อัปเดต: {formatDate(ticket.updated_at)}
                    </p>
                    <a href={`https://ticket.tenfw.com/#ticket/zoom/${ticket.id}`} target="_blank" rel="noopener noreferrer"
                        className="btn gap-2 text-[12px]">
                        <ExternalLink className="w-3.5 h-3.5" />เปิดใน Zammad
                    </a>
                </div>

                {/* Delete confirmation */}
                <AnimatePresence>
                    {confirmDelete && (
                        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                            className="absolute inset-0 z-50 flex items-center justify-center rounded-2xl"
                            style={{ background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(4px)' }}>
                            <motion.div initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.9, opacity: 0 }}
                                className="rounded-2xl p-6 text-center shadow-2xl" style={{ background: 'var(--color-surface-2)', border: '1px solid var(--color-border)', maxWidth: 340 }}>
                                <div className="w-12 h-12 mx-auto mb-3 rounded-full flex items-center justify-center" style={{ background: '#FEE2E2' }}>
                                    <Trash2 className="w-6 h-6" style={{ color: '#EF4444' }} />
                                </div>
                                <h3 className="text-sm font-bold mb-1" style={{ color: 'var(--color-text-primary)' }}>ลบ Ticket #{ticket.number}?</h3>
                                <p className="text-[11px] mb-4" style={{ color: 'var(--color-text-secondary)' }}>การดำเนินการนี้ไม่สามารถย้อนกลับได้</p>
                                <div className="flex gap-2 justify-center">
                                    <button onClick={() => setConfirmDelete(false)} disabled={deleting}
                                        className="px-4 py-2 rounded-xl text-[12px] font-semibold"
                                        style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', color: 'var(--color-text-primary)' }}>
                                        ยกเลิก
                                    </button>
                                    <button onClick={handleDelete} disabled={deleting}
                                        className="px-4 py-2 rounded-xl text-[12px] font-semibold text-white"
                                        style={{ background: '#EF4444' }}>
                                        {deleting ? 'กำลังลบ...' : 'ลบ Ticket'}
                                    </button>
                                </div>
                            </motion.div>
                        </motion.div>
                    )}
                </AnimatePresence>

                {/* Toast */}
                <AnimatePresence>
                    {toast && (
                        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 10 }}
                            className="absolute bottom-16 left-1/2 -translate-x-1/2 px-4 py-2 rounded-xl text-[12px] font-semibold text-white z-50"
                            style={{ background: '#10B981', boxShadow: '0 8px 30px rgba(16,185,129,0.3)' }}>
                            {toast}
                        </motion.div>
                    )}
                </AnimatePresence>
            </div>
        </Modal>
    );
}

// ─── Create Ticket Modal ──────────────────────────────────────────────────────
function CreateTicketModal({ onClose, onCreated, currentUserEmail }: { onClose: () => void; onCreated: () => void; currentUserEmail?: string }) {
    const [title, setTitle]       = useState('');
    const [body, setBody]         = useState('');
    const [groupId, setGroupId]   = useState(0);
    const [prioId, setPrioId]     = useState(2);
    const [groups, setGroups]     = useState<{id: number; name: string; signature_id?: number}[]>([]);
    const [priorities, setPris]   = useState<{id: number; name: string}[]>([]);
    const [tags, setTags]         = useState('');
    const [creating, setCreating] = useState(false);
    const [error, setError]       = useState<string | null>(null);
    const [sendEmail, setSendEmail] = useState(false);
    const [customerEmail, setCustomerEmail] = useState('');
    const [signatures, setSignatures] = useState<{id: number; name: string; body: string}[]>([]);
    const [selectedSigId, setSelectedSigId] = useState<number | null>(null);
    const [ownerId, setOwnerId] = useState(0);
    const [users, setUsers] = useState<{id: number; firstname: string; lastname: string; email: string}[]>([]);
    const [emailSuggestions, setEmailSuggestions] = useState<{id: number; firstname: string; lastname: string; email: string}[]>([]);
    const [showEmailSuggestions, setShowEmailSuggestions] = useState(false);
    const emailInputRef = useRef<HTMLInputElement>(null);
    const emailWrapRef = useRef<HTMLDivElement>(null);

    // Lock body scroll while modal is open
    useEffect(() => {
        const orig = document.body.style.overflow;
        document.body.style.overflow = 'hidden';
        return () => { document.body.style.overflow = orig; };
    }, []);

    useEffect(() => {
        Promise.all([
            fetch('/api/zammad/groups').then(r => r.json()),
            fetch('/api/zammad/ticket_priorities').then(r => r.json()),
            fetch('/api/zammad/signatures').then(r => r.json()),
            fetch('/api/zammad/users?limit=200').then(r => r.json()),
        ]).then(([g, p, sigs, u]) => {
            const grps = Array.isArray(g) ? g : [];
            setGroups(grps);
            if (grps.length > 0 && !groupId) setGroupId(grps[0].id);
            setPris(Array.isArray(p) ? p : []);
            const activeSigs = (Array.isArray(sigs) ? sigs : []).filter((s: any) => s.active);
            setSignatures(activeSigs);
            const userList = Array.isArray(u) ? u : [];
            setUsers(userList);
            // Auto-set owner to the currently logged-in OpsOne user (match by email)
            if (currentUserEmail) {
                const me = userList.find((zu: any) => zu.email?.toLowerCase() === currentUserEmail.toLowerCase());
                if (me) setOwnerId(me.id);
            }
            // Auto-select signature for first group
            if (grps.length > 0 && activeSigs.length > 0) {
                const firstSigId = grps[0].signature_id;
                if (firstSigId && activeSigs.find((s: any) => s.id === firstSigId)) {
                    setSelectedSigId(firstSigId);
                }
            }
        });
    }, []); // eslint-disable-line react-hooks/exhaustive-deps

    // Auto-switch signature when group changes
    useEffect(() => {
        if (!groupId || groups.length === 0) return;
        const grp = groups.find(g => g.id === groupId);
        if (grp?.signature_id && signatures.find(s => s.id === grp.signature_id)) {
            setSelectedSigId(grp.signature_id);
        } else {
            setSelectedSigId(null);
        }
    }, [groupId, groups, signatures]);

    // Email suggestions — filter users as user types
    const handleEmailChange = (val: string) => {
        setCustomerEmail(val);
        if (val.trim().length >= 2) {
            const q = val.toLowerCase();
            const matches = users.filter(u =>
                u.email && (
                    u.email.toLowerCase().includes(q) ||
                    `${u.firstname} ${u.lastname}`.toLowerCase().includes(q)
                )
            ).slice(0, 8);
            setEmailSuggestions(matches);
            setShowEmailSuggestions(matches.length > 0);
        } else {
            setShowEmailSuggestions(false);
        }
    };

    // Close email suggestions on outside click
    useEffect(() => {
        if (!showEmailSuggestions) return;
        const handler = (e: MouseEvent) => {
            if (!emailWrapRef.current?.contains(e.target as Node)) setShowEmailSuggestions(false);
        };
        document.addEventListener('mousedown', handler);
        return () => document.removeEventListener('mousedown', handler);
    }, [showEmailSuggestions]);

    const create = async () => {
        if (!title.trim() || !body.trim() || !groupId) { setError('กรุณากรอกหัวข้อ, เลือกกลุ่ม, และเนื้อหา'); return; }
        if (sendEmail && !customerEmail.trim()) { setError('กรุณากรอกอีเมลลูกค้า'); return; }
        setCreating(true); setError(null);
        // Append signature to body if selected
        let finalBody = body;
        if (selectedSigId) {
            const sig = signatures.find(s => s.id === selectedSigId);
            if (sig?.body) {
                finalBody += '<br><br>--<br>' + sig.body;
            }
        }
        try {
            const r = await fetch('/api/zammad/tickets', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    title: title.trim(),
                    group_id: groupId,
                    priority_id: prioId,
                    body: finalBody,
                    content_type: 'text/html',
                    tags: tags.trim() || undefined,
                    ...(ownerId && { owner_id: ownerId }),
                    ...(sendEmail && { send_email: true, customer_email: customerEmail.trim() }),
                }),
            });
            if (!r.ok) throw new Error(await r.text());
            onCreated();
            onClose();
        } catch (e) { setError(String(e)); }
        setCreating(false);
    };

    return (
        <Modal isOpen onClose={onClose} showCloseButton={false}
            className="w-full max-w-2xl m-4 overflow-hidden">
            <div className="relative flex flex-col overflow-hidden rounded-3xl" style={{ maxHeight: '90vh' }}>

                {/* Header */}
                <div className="flex items-center justify-between px-6 py-4" style={{ borderBottom: '1px solid var(--color-border)', background: 'var(--color-surface-2)' }}>
                    <div className="flex items-center gap-2">
                        <Plus className="w-5 h-5" style={{ color: 'var(--color-primary)' }} />
                        <h2 className="text-[15px] font-black" style={{ color: 'var(--color-text-primary)' }}>เปิดใบงานใหม่</h2>
                    </div>
                    <button onClick={onClose} className="btn-icon"><X className="w-4 h-4" /></button>
                </div>

                {/* Form */}
                <div className="flex-1 overflow-y-auto p-6 space-y-4">
                    {/* Title */}
                    <div>
                        <label className="text-[11px] font-bold mb-1.5 block" style={{ color: 'var(--color-text-secondary)' }}>หัวข้อ *</label>
                        <input value={title} onChange={e => setTitle(e.target.value)}
                            className="w-full text-[13px] px-3 py-2.5 rounded-xl bg-transparent outline-none"
                            style={{ border: '1.5px solid var(--color-border)', color: 'var(--color-text-primary)' }}
                            placeholder="เรื่องที่ต้องการแจ้ง..." autoFocus />
                    </div>

                    {/* Group + Priority + Owner */}
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                        <div>
                            <label className="text-[11px] font-bold mb-1.5 block" style={{ color: 'var(--color-text-secondary)' }}>กลุ่ม/ทีม *</label>
                            <select value={groupId} onChange={e => setGroupId(Number(e.target.value))}
                                className="w-full text-[13px] px-3 py-2.5 rounded-xl outline-none"
                                style={{ border: '1.5px solid var(--color-border)', color: 'var(--color-text-primary)', background: 'var(--color-surface)' }}>
                                {groups.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
                            </select>
                        </div>
                        <div>
                            <label className="text-[11px] font-bold mb-1.5 block" style={{ color: 'var(--color-text-secondary)' }}>ความสำคัญ</label>
                            <select value={prioId} onChange={e => setPrioId(Number(e.target.value))}
                                className="w-full text-[13px] px-3 py-2.5 rounded-xl outline-none"
                                style={{ border: '1.5px solid var(--color-border)', color: 'var(--color-text-primary)', background: 'var(--color-surface)' }}>
                                {priorities.map(p => <option key={p.id} value={p.id}>{PRIO_META[p.name.toLowerCase()]?.label ?? p.name}</option>)}
                            </select>
                        </div>
                        <div>
                            <label className="text-[11px] font-bold mb-1.5 block" style={{ color: 'var(--color-text-secondary)' }}>ผู้รับผิดชอบ</label>
                            <select value={ownerId} onChange={e => setOwnerId(Number(e.target.value))}
                                className="w-full text-[13px] px-3 py-2.5 rounded-xl outline-none"
                                style={{ border: '1.5px solid var(--color-border)', color: 'var(--color-text-primary)', background: 'var(--color-surface)' }}>
                                <option value={0}>— ไม่ระบุ —</option>
                                {users.filter(u => u.email).map(u => (
                                    <option key={u.id} value={u.id}>{u.firstname} {u.lastname}</option>
                                ))}
                            </select>
                        </div>
                    </div>

                    {/* Tags */}
                    <div>
                        <label className="text-[11px] font-bold mb-1.5 block" style={{ color: 'var(--color-text-secondary)' }}>แท็ก (คั่นด้วย ,)</label>
                        <input value={tags} onChange={e => setTags(e.target.value)}
                            className="w-full text-[13px] px-3 py-2.5 rounded-xl bg-transparent outline-none"
                            style={{ border: '1.5px solid var(--color-border)', color: 'var(--color-text-primary)' }}
                            placeholder="เช่น network, urgent" />
                    </div>

                    {/* Send Email Toggle */}
                    <div className="rounded-xl p-4" style={{ border: '1.5px solid var(--color-border)', background: sendEmail ? 'rgba(59,130,246,0.06)' : 'transparent' }}>
                        <label className="flex items-center gap-3 cursor-pointer select-none">
                            <div className="relative">
                                <input type="checkbox" checked={sendEmail} onChange={e => setSendEmail(e.target.checked)} className="sr-only" />
                                <div className="w-10 h-5 rounded-full transition-all" style={{ background: sendEmail ? '#3B82F6' : 'var(--color-border)' }}>
                                    <div className="w-4 h-4 rounded-full bg-white shadow-md transition-all" style={{ transform: sendEmail ? 'translate(22px, 2px)' : 'translate(2px, 2px)' }} />
                                </div>
                            </div>
                            <div className="flex items-center gap-2">
                                <Mail className="w-4 h-4" style={{ color: sendEmail ? '#3B82F6' : 'var(--color-text-tertiary)' }} />
                                <span className="text-[12px] font-bold" style={{ color: sendEmail ? '#3B82F6' : 'var(--color-text-secondary)' }}>ส่งอีเมลหาลูกค้า</span>
                            </div>
                        </label>
                        {sendEmail && (
                            <div className="mt-3">
                                <div ref={emailWrapRef} className="relative">
                                    <input ref={emailInputRef} value={customerEmail}
                                        onChange={e => handleEmailChange(e.target.value)}
                                        onFocus={() => { if (emailSuggestions.length > 0) setShowEmailSuggestions(true); }}
                                        type="email" autoComplete="off"
                                        className="w-full text-[13px] px-3 py-2.5 rounded-xl bg-transparent outline-none"
                                        style={{ border: '1.5px solid #3B82F6', color: 'var(--color-text-primary)' }}
                                        placeholder="อีเมลลูกค้า เช่น customer@example.com" />
                                    {showEmailSuggestions && emailSuggestions.length > 0 && (
                                        <div className="absolute top-full left-0 right-0 mt-1 py-1 rounded-xl shadow-2xl z-[600] max-h-48 overflow-y-auto"
                                            style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
                                            {emailSuggestions.map(u => (
                                                <button key={u.id} type="button"
                                                    className="w-full flex items-center gap-2.5 px-3 py-2 transition-colors text-left"
                                                    onMouseEnter={e => { e.currentTarget.style.background = 'var(--color-surface-2)'; }}
                                                    onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}
                                                    onClick={() => { setCustomerEmail(u.email); setShowEmailSuggestions(false); }}>
                                                    <div className="w-7 h-7 rounded-full flex-shrink-0 flex items-center justify-center text-[10px] font-bold text-white"
                                                        style={{ background: '#2563EB' }}>
                                                        {(u.firstname?.[0] || u.email[0] || '?').toUpperCase()}
                                                    </div>
                                                    <div className="min-w-0 flex-1">
                                                        <p className="text-[12px] font-semibold truncate" style={{ color: 'var(--color-text-primary)' }}>
                                                            {u.firstname} {u.lastname}
                                                        </p>
                                                        <p className="text-[10px] truncate" style={{ color: 'var(--color-text-tertiary)' }}>{u.email}</p>
                                                    </div>
                                                </button>
                                            ))}
                                        </div>
                                    )}
                                </div>
                                <p className="text-[10px] mt-1.5" style={{ color: 'var(--color-text-tertiary)' }}>
                                    อีเมลจะถูกส่งผ่าน Zammad ในนามกลุ่ม/ทีมที่เลือก
                                </p>
                            </div>
                        )}
                    </div>

                    {/* Body — Rich Editor */}
                    <div>
                        <label className="text-[11px] font-bold mb-1.5 block" style={{ color: 'var(--color-text-secondary)' }}>เนื้อหา *</label>
                        <RichEditor value={body} onChange={setBody} placeholder="รายละเอียดของใบงาน... (รองรับ ตัวหนา, จัดกึ่งกลาง, สี, ขนาด)" minH={180} />
                    </div>

                    {/* Signature selector */}
                    {signatures.length > 0 && (
                        <div>
                            <label className="text-[11px] font-bold mb-1.5 block" style={{ color: 'var(--color-text-secondary)' }}>Signature</label>
                            <select value={selectedSigId ?? ''} onChange={e => setSelectedSigId(e.target.value ? Number(e.target.value) : null)}
                                className="w-full text-[13px] px-3 py-2.5 rounded-xl outline-none"
                                style={{ border: '1.5px solid var(--color-border)', color: 'var(--color-text-primary)', background: 'var(--color-surface)' }}>
                                <option value="">ไม่ใช้ Signature</option>
                                {signatures.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                            </select>
                            {selectedSigId && (() => {
                                const sig = signatures.find(s => s.id === selectedSigId);
                                return sig?.body ? (
                                    <div className="mt-2 p-3 rounded-lg text-[11px] overflow-x-auto" style={{ background: 'var(--color-surface-2)', border: '1px solid var(--color-border)', color: 'var(--color-text-secondary)' }}>
                                        <p className="text-[9px] font-bold mb-1" style={{ color: 'var(--color-text-tertiary)' }}>ตัวอย่าง:</p>
                                        <div style={{ minWidth: 'fit-content' }} dangerouslySetInnerHTML={{ __html: sig.body }} />
                                    </div>
                                ) : null;
                            })()}
                        </div>
                    )}

                    {error && <p className="text-[12px] font-semibold" style={{ color: '#EF4444' }}>{error}</p>}
                </div>

                {/* Footer */}
                <div className="flex-shrink-0 px-6 py-4 flex items-center justify-between"
                    style={{ borderTop: '1px solid var(--color-border)', background: 'var(--color-surface-2)' }}>
                    <p className="text-[10px]" style={{ color: sendEmail ? '#3B82F6' : 'var(--color-text-tertiary)' }}>
                        {sendEmail
                            ? `📧 อีเมลจะถูกส่งไปที่ ${customerEmail || '...'}`
                            : '🔒 ใบงานจะถูกสร้างเป็น Internal Note — ไม่ส่งอีเมลไปหาลูกค้า'}
                    </p>
                    <button onClick={create} disabled={creating || !title.trim() || !body.trim()}
                        className="btn btn-primary gap-2 text-[12px]" style={{ opacity: !title.trim() || !body.trim() ? 0.5 : 1 }}>
                        {sendEmail ? <Send className="w-4 h-4" /> : <Plus className="w-4 h-4" />}
                        {creating ? 'กำลังสร้าง...' : sendEmail ? 'สร้างและส่งอีเมล' : 'สร้างใบงาน'}
                    </button>
                </div>
            </div>
        </Modal>
    );
}

// ─── Main Page ─────────────────────────────────────────────────────────────────
export default function Tickets() {
    const { user } = useAuth();
    const [tickets,     setTickets]     = useState<ZTicket[]>([]);
    const [loading,     setLoading]     = useState(true);
    const [error,       setError]       = useState<string | null>(null);
    const [search,      setSearch]      = useState('');
    const [stateFilter, setStateFilter] = useState('all');
    const [page,        setPage]        = useState(1);
    const [selected,    setSelected]    = useState<ZTicket | null>(null);
    const [showCreate, setShowCreate]  = useState(false);
    const searchRef = useRef<HTMLInputElement>(null);

    const load = useCallback(async () => {
        try {
            setError(null); setLoading(true);
            const res  = await fetch('/api/zammad/tickets?per_page=200');
            if (!res.ok) throw new Error(await res.text());
            const data = await res.json();
            let list: ZTicket[] = [];
            if (Array.isArray(data))              list = data;
            else if (data.assets?.Ticket)         list = Object.values(data.assets.Ticket) as ZTicket[];
            else if (Array.isArray(data.tickets)) list = data.tickets;
            setTickets(list.sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()));
        } catch (e) {
            setError(String(e));
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => { load(); }, [load]);

    // ── Derived ───────────────────────────────────────────────────────────────
    const filtered = tickets.filter(t => {
        const matchState  = stateFilter === 'all' || (t.state ?? '').toLowerCase() === stateFilter;
        const q           = search.toLowerCase();
        const matchSearch = !q ||
            (t.title    ?? '').toLowerCase().includes(q) ||
            String(t.number).includes(q) ||
            (t.customer ?? '').toLowerCase().includes(q) ||
            (t.owner    ?? '').toLowerCase().includes(q) ||
            (t.group    ?? '').toLowerCase().includes(q);
        return matchState && matchSearch;
    });
    const paginated  = filtered.slice((page - 1) * PER_PAGE, page * PER_PAGE);
    const totalPages = Math.ceil(filtered.length / PER_PAGE);

    const cnt = (key: string) =>
        key === 'all' ? tickets.length :
        tickets.filter(t => (t.state ?? '').toLowerCase() === key).length;

    // ── Chart data ────────────────────────────────────────────────────────────
    const donutData = STATE_ORDER.filter(s => cnt(s) > 0).map(s => ({
        label: STATE_META[s]?.label ?? s,
        value: cnt(s),
        color: STATE_META[s]?.color ?? '#6B7280',
    }));

    const weeklyData = (() => {
        const weeks: { label: string; open: number; closed: number }[] = [];
        const now = Date.now();
        for (let w = 7; w >= 0; w--) {
            const start   = now - (w + 1) * 7 * 86400000;
            const end     = now - w * 7 * 86400000;
            const inRange = tickets.filter(t => {
                const ts = new Date(t.created_at).getTime();
                return ts >= start && ts < end;
            });
            const d = new Date(end);
            weeks.push({
                label:  `${d.getDate()}/${d.getMonth() + 1}`,
                open:   inRange.filter(t => !['closed', 'merged'].includes((t.state ?? '').toLowerCase())).length,
                closed: inRange.filter(t =>  ['closed', 'merged'].includes((t.state ?? '').toLowerCase())).length,
            });
        }
        return weeks;
    })();

    const statCards = [
        { key: 'all',              label: 'ทั้งหมด',  color: '#465fff',              icon: Ticket        },
        { key: 'new',              label: 'ใหม่',      color: '#2563EB',              icon: Ticket        },
        { key: 'open',             label: 'เปิดอยู่',  color: '#F59E0B',              icon: Clock         },
        { key: 'pending reminder', label: 'รอการตอบ', color: '#0EA5E9',              icon: Clock         },
        { key: 'closed',           label: 'ปิดแล้ว',  color: '#10B981',              icon: CheckCircle2  },
    ];

    const weeklyBarOptions: ApexOptions = {
        chart: { type: 'bar', stacked: true, fontFamily: 'inherit', toolbar: { show: false } },
        colors: ['#F59E0B', '#10B981'],
        plotOptions: { bar: { columnWidth: '45%', borderRadius: 4 } },
        dataLabels: { enabled: false },
        xaxis: { categories: weeklyData.map(w => w.label), labels: { style: { colors: '#94A3B8', fontSize: '11px' } }, axisBorder: { show: false }, axisTicks: { show: false } },
        yaxis: { labels: { style: { colors: '#94A3B8' } } },
        legend: { show: false },
        grid: { borderColor: '#E2E8F0', strokeDashArray: 3 },
        fill: { opacity: 1 },
        tooltip: { y: { formatter: (v: number) => `${v} ใบ` } },
    };
    const donutOptions: ApexOptions = {
        chart: { type: 'donut', fontFamily: 'inherit' },
        labels: donutData.map(d => d.label),
        colors: donutData.map(d => d.color),
        legend: { position: 'bottom', fontFamily: 'inherit', labels: { colors: '#64748B' } },
        dataLabels: { enabled: false },
        stroke: { width: 0 },
        plotOptions: { pie: { donut: { size: '70%', labels: { show: true, total: { show: true, label: 'ทั้งหมด', fontSize: '13px', color: '#64748B', formatter: () => String(tickets.length) } } } } },
        tooltip: { y: { formatter: (v: number) => `${v} ใบ` } },
    };

    return (
        <div className="space-y-5">

            {/* ── Toolbar ──────────────────────────────────────────────────────── */}
            <div className="flex items-center justify-end gap-2 flex-wrap">
                <button className="btn btn-primary gap-2" onClick={() => setShowCreate(true)}>
                    <Plus className="w-4 h-4" />เปิดใบงาน
                </button>
                <button className="btn-icon" onClick={load} title="รีเฟรช"><RefreshCw className="w-4 h-4" /></button>
                <a href="https://ticket.tenfw.com" target="_blank" rel="noopener noreferrer" className="btn gap-2">
                    <ExternalLink className="w-4 h-4" />เปิด Zammad
                </a>
            </div>

            {error ? (
                <div className="card p-10 text-center">
                    <AlertCircle className="w-10 h-10 mx-auto mb-3" style={{ color: '#EF4444' }} />
                    <p className="text-sm font-semibold mb-1" style={{ color: 'var(--color-text-primary)' }}>เชื่อมต่อ Zammad ไม่สำเร็จ</p>
                    <p className="text-xs mb-4 max-w-sm mx-auto" style={{ color: 'var(--color-text-tertiary)' }}>{error}</p>
                    <button className="btn btn-primary mx-auto" onClick={load}><RefreshCw className="w-4 h-4 mr-2" />ลองใหม่</button>
                </div>
            ) : (
                <>
                    {/* ── Dashboard Analytics ──────────────────────────────── */}
                    {/* Stat cards — horizontal row */}
                    <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
                        {statCards.map(s => {
                            const Icon = s.icon;
                            const isActive = stateFilter === s.key;
                            return (
                                <motion.button key={s.key}
                                    whileHover={{ y: -2 }} whileTap={{ scale: 0.97 }}
                                    onClick={() => { setStateFilter(s.key); setPage(1); }}
                                    className="relative overflow-hidden rounded-2xl p-4 text-left transition-all"
                                    style={{
                                        background: isActive ? `linear-gradient(135deg, ${s.color}15, ${s.color}08)` : 'var(--color-surface)',
                                        border: isActive ? `2px solid ${s.color}` : '1.5px solid var(--color-border)',
                                        boxShadow: isActive ? `0 4px 20px ${s.color}20` : '0 1px 3px rgba(0,0,0,0.04)',
                                    }}>
                                    {/* Background icon */}
                                    <div className="absolute -right-2 -top-2" style={{ opacity: 0.06 }}>
                                        <Icon className="w-16 h-16" style={{ color: s.color }} />
                                    </div>
                                    <div className="relative">
                                        <div className="w-8 h-8 rounded-xl flex items-center justify-center mb-3"
                                            style={{ background: `${s.color}15` }}>
                                            <Icon className="w-4 h-4" style={{ color: s.color }} />
                                        </div>
                                        <p className="text-2xl font-black tracking-tight" style={{ color: isActive ? s.color : 'var(--color-text-primary)' }}>
                                            {loading ? '—' : cnt(s.key)}
                                        </p>
                                        <p className="text-[10px] font-semibold mt-1 uppercase tracking-wider" style={{ color: 'var(--color-text-tertiary)' }}>{s.label}</p>
                                    </div>
                                </motion.button>
                            );
                        })}
                    </div>

                    {/* Charts row */}
                    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                        {/* Weekly bar chart */}
                        <div className="lg:col-span-2 card p-5">
                            <div className="flex items-center justify-between mb-4">
                                <div>
                                    <p className="text-[13px] font-bold" style={{ color: 'var(--color-text-primary)' }}>Weekly Ticket Volume</p>
                                    <p className="text-[10px] mt-0.5" style={{ color: 'var(--color-text-tertiary)' }}>8 สัปดาห์ล่าสุด</p>
                                </div>
                                <div className="flex items-center gap-4 text-[10px]" style={{ color: 'var(--color-text-tertiary)' }}>
                                    <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full inline-block" style={{ background: '#F59E0B' }} />เปิดอยู่</span>
                                    <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full inline-block" style={{ background: '#10B981' }} />ปิดแล้ว</span>
                                </div>
                            </div>
                            {loading
                                ? <div className="h-[260px] rounded-xl animate-pulse" style={{ background: 'var(--color-surface-2)' }} />
                                : <Chart options={weeklyBarOptions} series={[{ name: 'เปิดอยู่', data: weeklyData.map(w => w.open) }, { name: 'ปิดแล้ว', data: weeklyData.map(w => w.closed) }]} type="bar" height={260} />}
                        </div>

                        {/* Donut */}
                        <div className="card p-5 flex flex-col">
                            <p className="text-[13px] font-bold mb-2" style={{ color: 'var(--color-text-primary)' }}>Status Distribution</p>
                            {loading ? (
                                <div className="flex-1 flex items-center justify-center">
                                    <div className="w-36 h-36 rounded-full animate-pulse" style={{ background: 'var(--color-surface-2)' }} />
                                </div>
                            ) : donutData.length === 0 ? (
                                <div className="flex-1 flex items-center justify-center text-sm" style={{ color: 'var(--color-text-tertiary)' }}>ไม่มีข้อมูล</div>
                            ) : (
                                <Chart options={donutOptions} series={donutData.map(d => d.value)} type="donut" height={300} />
                            )}
                        </div>
                    </div>

                    {/* ── Filter bar ───────────────────────────────────────── */}
                    <div className="flex items-center gap-3 flex-wrap">
                        <div className="card p-1.5 flex flex-shrink-0 gap-1">
                            {[
                                { key: 'all',              label: 'ทั้งหมด',  color: 'var(--color-primary)' },
                                { key: 'new',              label: 'ใหม่',      color: '#2563EB' },
                                { key: 'open',             label: 'เปิดอยู่',  color: '#F59E0B' },
                                { key: 'pending reminder', label: 'รอการตอบ', color: '#0EA5E9' },
                                { key: 'closed',           label: 'ปิดแล้ว',  color: '#10B981' },
                            ].map(t => {
                                const isActive = stateFilter === t.key;
                                return (
                                <button key={t.key} onClick={() => { setStateFilter(t.key); setPage(1); }}
                                    className="px-3.5 py-1.5 rounded-xl text-[12px] font-semibold transition-all flex items-center gap-1.5"
                                    style={{
                                        background: isActive ? t.color : 'transparent',
                                        color: isActive ? '#fff' : 'var(--color-text-secondary)',
                                        boxShadow: isActive ? `0 2px 8px ${t.color}30` : 'none',
                                    }}>
                                    {!isActive && <span className="w-1.5 h-1.5 rounded-full" style={{ background: t.color }} />}
                                    {t.label}
                                    <span className="text-[10px] px-1.5 rounded-full min-w-[18px] text-center font-bold"
                                        style={{ background: isActive ? 'rgba(255,255,255,0.22)' : 'var(--color-surface-2)' }}>
                                        {cnt(t.key)}
                                    </span>
                                </button>
                                );
                            })}
                        </div>

                        {/* Search — clean layout, no overlap */}
                        <div className="flex-1" style={{ minWidth: 200 }}>
                            <div className="flex items-center gap-2 px-3 py-2 rounded-xl"
                                style={{ background: 'var(--color-surface)', border: '1.5px solid var(--color-border)' }}>
                                <Search className="w-4 h-4 flex-shrink-0" style={{ color: 'var(--color-text-tertiary)' }} />
                                <input ref={searchRef}
                                    className="flex-1 bg-transparent text-[13px] outline-none border-none"
                                    style={{ color: 'var(--color-text-primary)' }}
                                    placeholder="ค้นหาหัวข้อ, เลขที่, ลูกค้า, กลุ่ม..."
                                    value={search}
                                    onChange={e => { setSearch(e.target.value); setPage(1); }}
                                />
                                {search && (
                                    <button onClick={() => { setSearch(''); setPage(1); }}>
                                        <X className="w-3.5 h-3.5 flex-shrink-0" style={{ color: 'var(--color-text-tertiary)' }} />
                                    </button>
                                )}
                            </div>
                        </div>

                        <span className="text-[11px] flex-shrink-0" style={{ color: 'var(--color-text-tertiary)' }}>
                            {loading ? '...' : `${filtered.length} รายการ`}
                        </span>
                    </div>

                    {/* ── Table ────────────────────────────────────────────── */}
                    <div className="card overflow-hidden">
                        {/* Header row */}
                        <div className="hidden md:grid px-5 py-3 text-[10px] font-black uppercase tracking-widest"
                            style={{
                                gridTemplateColumns: '72px 1fr 160px 150px 130px 90px 90px 110px',
                                color: 'var(--color-text-tertiary)',
                                borderBottom: '1px solid var(--color-border)',
                                background: 'var(--color-surface-2)',
                            }}>
                            <span># เลขที่</span>
                            <span>หัวข้อ</span>
                            <span><User  className="w-3 h-3 inline mr-1" />ผู้ส่ง</span>
                            <span><Users className="w-3 h-3 inline mr-1" />กลุ่ม / ทีม</span>
                            <span><User  className="w-3 h-3 inline mr-1" />ผู้รับผิดชอบ</span>
                            <span><Filter className="w-3 h-3 inline mr-1" />ความสำคัญ</span>
                            <span>สถานะ</span>
                            <span><Clock className="w-3 h-3 inline mr-1" />อัปเดต</span>
                        </div>

                        {loading ? (
                            <div className="py-14 flex flex-col items-center gap-3">
                                <div className="w-8 h-8 border-4 rounded-full animate-spin"
                                    style={{ borderColor: 'var(--color-primary)', borderTopColor: 'transparent' }} />
                                <p className="text-sm" style={{ color: 'var(--color-text-tertiary)' }}>กำลังโหลด Tickets จาก Zammad...</p>
                            </div>
                        ) : paginated.length === 0 ? (
                            <div className="py-16 text-center">
                                <Ticket className="w-10 h-10 mx-auto mb-3" style={{ color: 'var(--color-text-tertiary)' }} />
                                <p className="text-sm" style={{ color: 'var(--color-text-tertiary)' }}>ไม่พบ Ticket ที่ตรงกัน</p>
                            </div>
                        ) : paginated.map((t, idx) => {
                            const sm    = STATE_META[(t.state ?? '').toLowerCase()] ?? { color: '#6B7280', bg: '#F9FAFB', label: t.state, Icon: Clock as IconComp };
                            const pm    = PRIO_META[(t.priority ?? '').toLowerCase()] ?? { color: '#6B7280', bg: '#F9FAFB', label: t.priority };
                            const SIcon = sm.Icon;

                            return (
                                <motion.div key={t.id}
                                    initial={{ opacity: 0, y: 3 }} animate={{ opacity: 1, y: 0 }}
                                    transition={{ delay: idx * 0.012 }}
                                    className="border-b last:border-0"
                                    style={{ borderColor: 'var(--color-border)' }}>

                                    {/* Desktop */}
                                    <div
                                        className="hidden md:grid px-5 py-3.5 items-center gap-3 cursor-pointer transition-colors"
                                        style={{ gridTemplateColumns: '72px 1fr 160px 150px 130px 90px 90px 110px' }}
                                        onClick={() => setSelected(t)}
                                        onMouseEnter={e => (e.currentTarget.style.background = 'var(--color-surface-2)')}
                                        onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>
                                        <div>
                                            <p className="text-[12px] font-bold" style={{ color: 'var(--color-primary)' }}>#{t.number}</p>
                                            <p className="text-[10px]" style={{ color: 'var(--color-text-tertiary)' }}>
                                                {new Date(t.created_at).toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: '2-digit' })}
                                            </p>
                                        </div>
                                        <div className="min-w-0">
                                            <p className="text-[13px] font-semibold truncate" style={{ color: 'var(--color-text-primary)' }}>{t.title}</p>
                                            {t.article_count > 0 && (
                                                <span className="flex items-center gap-1 text-[10px] mt-0.5" style={{ color: 'var(--color-text-tertiary)' }}>
                                                    <MessageSquare className="w-3 h-3" />{t.article_count} ข้อความ
                                                </span>
                                            )}
                                        </div>
                                        {/* ผู้ส่ง */}
                                        <div className="flex items-center gap-1.5 min-w-0">
                                            <div className="w-6 h-6 rounded-full flex-shrink-0 flex items-center justify-center text-[9px] font-bold text-white"
                                                style={{ background: '#2563EB' }}>
                                                {(displayName(t.customer)[0] || '?').toUpperCase()}
                                            </div>
                                            <p className="text-[11px] truncate" style={{ color: 'var(--color-text-secondary)' }}>{displayName(t.customer)}</p>
                                        </div>
                                        {/* กลุ่ม */}
                                        <p className="text-[11px] truncate" style={{ color: 'var(--color-text-secondary)' }}>{t.group || '—'}</p>
                                        {/* ผู้รับผิดชอบ */}
                                        <div className="flex items-center gap-1.5 min-w-0">
                                            <div className="w-6 h-6 rounded-full flex-shrink-0 flex items-center justify-center text-[9px] font-bold text-white"
                                                style={{ background: t.owner ? '#F59E0B' : '#E5E7EB' }}>
                                                {(displayName(t.owner)[0] || '—').toUpperCase()}
                                            </div>
                                            <p className="text-[11px] truncate" style={{ color: 'var(--color-text-secondary)' }}>{displayName(t.owner) || '—'}</p>
                                        </div>
                                        <span className="text-[10px] font-bold px-2 py-0.5 rounded-full w-fit"
                                            style={{ background: pm.bg, color: pm.color }}>
                                            {pm.label || t.priority}
                                        </span>
                                        <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full w-fit"
                                            style={{ background: sm.bg, color: sm.color }}>
                                            <SIcon className="w-3 h-3" />{sm.label}
                                        </span>
                                        {/* อัปเดต */}
                                        <div>
                                            <p className="text-[11px] font-semibold" style={{ color: 'var(--color-text-secondary)' }}>
                                                {new Date(t.updated_at).toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: '2-digit' })}
                                            </p>
                                            <p className="text-[10px]" style={{ color: 'var(--color-text-tertiary)' }}>
                                                {new Date(t.updated_at).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' })}
                                            </p>
                                        </div>
                                    </div>

                                    {/* Mobile */}
                                    <button onClick={() => setSelected(t)}
                                        className="md:hidden w-full flex items-start gap-3 px-4 py-3.5 text-left">
                                        <div className="flex-1 min-w-0">
                                            <div className="flex items-center gap-2 mb-1">
                                                <span className="text-[11px] font-bold" style={{ color: 'var(--color-primary)' }}>#{t.number}</span>
                                                <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full"
                                                    style={{ background: sm.bg, color: sm.color }}>
                                                    <SIcon className="w-3 h-3" />{sm.label}
                                                </span>
                                            </div>
                                            <p className="text-[13px] font-semibold truncate" style={{ color: 'var(--color-text-primary)' }}>{t.title}</p>
                                            <p className="text-[11px] mt-0.5" style={{ color: 'var(--color-text-tertiary)' }}>
                                                {displayName(t.customer)} → {t.group || '—'} · {formatDate(t.updated_at)}
                                            </p>
                                        </div>
                                        <ChevronRight className="w-4 h-4 flex-shrink-0 mt-1" style={{ color: 'var(--color-text-tertiary)' }} />
                                    </button>
                                </motion.div>
                            );
                        })}

                        {/* Pagination */}
                        {totalPages > 1 && (
                            <div className="flex items-center justify-between px-5 py-3"
                                style={{ borderTop: '1px solid var(--color-border)', background: 'var(--color-surface-2)' }}>
                                <p className="text-[11px]" style={{ color: 'var(--color-text-tertiary)' }}>
                                    แสดง {(page - 1) * PER_PAGE + 1}–{Math.min(page * PER_PAGE, filtered.length)} จาก {filtered.length} รายการ
                                </p>
                                <div className="flex items-center gap-1">
                                    <button className="btn-icon" disabled={page === 1} onClick={() => setPage(p => p - 1)}>
                                        <ChevronLeft className="w-4 h-4" />
                                    </button>
                                    <span className="px-3 py-1 text-[12px] font-semibold" style={{ color: 'var(--color-text-secondary)' }}>
                                        {page} / {totalPages}
                                    </span>
                                    <button className="btn-icon" disabled={page === totalPages} onClick={() => setPage(p => p + 1)}>
                                        <ChevronRight className="w-4 h-4" />
                                    </button>
                                </div>
                            </div>
                        )}
                    </div>
                </>
            )}

            {/* Modal */}
            <AnimatePresence>
                {selected && <TicketModal ticket={selected} onClose={() => setSelected(null)} onUpdated={() => { load(); }} userName={user?.name} />}
                {showCreate && <CreateTicketModal onClose={() => setShowCreate(false)} onCreated={() => { load(); }} currentUserEmail={user?.email} />}
            </AnimatePresence>
        </div>
    );
}
