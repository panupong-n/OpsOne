import { useState, useEffect } from 'react';
import { X, Download, Printer, RefreshCw, FileText, Calendar, Users } from 'lucide-react';
import { Modal } from './ui/modal';
import { DatePicker } from 'antd';
import dayjs from 'dayjs';

/* ────────────────────────────────────────────────────────────── types ── */
type ReportType = 'visits' | 'attendance';

interface VisitRow {
    visit_date: string;
    employee_name: string;
    customer: string;
    product: string;
    site: string;
    notes: string;
}

interface AttRow {
    date: string;
    employee_name: string;
    status: string;
    note: string;
    product: string;
    customer: string;
}

export interface ReportModalProps {
    open: boolean;
    onClose: () => void;
    defaultYear: number;
    defaultMonth: number; // 0-based
}

/* ───────────────────────────────────────────────────────── helpers ── */
const pad = (n: number) => String(n).padStart(2, '0');

function monthFirstDay(year: number, month: number) {
    return `${year}-${pad(month + 1)}-01`;
}
function monthLastDay(year: number, month: number) {
    return `${year}-${pad(month + 1)}-${pad(new Date(year, month + 1, 0).getDate())}`;
}

const STATUS_LABEL: Record<string, string> = {
    office: 'เข้าออฟฟิศ',
    travel: 'ออกพื้นที่',
    leave:  'ลางาน',
};

/* ───────────────────────────────────────────────────── component ── */
export default function ReportModal({ open, onClose, defaultYear, defaultMonth }: ReportModalProps) {
    const [reportType, setReportType] = useState<ReportType>('visits');
    const [fromDate,   setFromDate]   = useState(monthFirstDay(defaultYear, defaultMonth));
    const [toDate,     setToDate]     = useState(monthLastDay(defaultYear, defaultMonth));
    const [loading,    setLoading]    = useState(false);
    const [visitRows,  setVisitRows]  = useState<VisitRow[]>([]);
    const [attRows,    setAttRows]    = useState<AttRow[]>([]);
    const [fetched,    setFetched]    = useState(false);
    const [error,      setError]      = useState('');

    /* reset preview when type or dates change */
    useEffect(() => {
        setFetched(false);
        setVisitRows([]);
        setAttRows([]);
        setError('');
    }, [reportType, fromDate, toDate]);

    /* close on Escape */
    useEffect(() => {
        if (!open) return;
        const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
        window.addEventListener('keydown', handler);
        return () => window.removeEventListener('keydown', handler);
    }, [open, onClose]);

    async function fetchPreview() {
        setLoading(true);
        setError('');
        try {
            const url = reportType === 'visits'
                ? `/api/reports/visits?from=${fromDate}&to=${toDate}`
                : `/api/reports/attendance?from=${fromDate}&to=${toDate}`;
            const res = await fetch(url);
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const data = await res.json();
            if (reportType === 'visits') setVisitRows(data);
            else setAttRows(data);
            setFetched(true);
        } catch (e) {
            setError(String(e));
        } finally {
            setLoading(false);
        }
    }

    function downloadCSV() {
        const url = reportType === 'visits'
            ? `/api/reports/visits/csv?from=${fromDate}&to=${toDate}`
            : `/api/reports/attendance/csv?from=${fromDate}&to=${toDate}`;
        window.open(url);
    }

    function printReport() {
        window.print();
    }

    if (!open) return null;

    const rows = reportType === 'visits' ? visitRows.length : attRows.length;

    if (!open) return null;

    return (
        <Modal isOpen={open} onClose={onClose} showCloseButton={false}
            className="w-full max-w-3xl m-4 max-h-[90vh] flex flex-col overflow-hidden">
                    <div className="flex flex-col max-h-[90vh] overflow-hidden">
                        {/* Header */}
                        <div className="flex items-center justify-between p-5 border-b flex-shrink-0"
                            style={{ borderColor: 'var(--color-border)' }}>
                            <div className="flex items-center gap-2.5">
                                <FileText className="w-4.5 h-4.5" style={{ color: 'var(--color-primary)' }} />
                                <h2 className="text-[15px] font-bold" style={{ color: 'var(--color-text-primary)' }}>
                                    ออกรายงาน
                                </h2>
                            </div>
                            <button onClick={onClose} className="btn-icon">
                                <X className="w-4 h-4" />
                            </button>
                        </div>

                        {/* Controls */}
                        <div className="p-5 border-b flex-shrink-0 space-y-4"
                            style={{ borderColor: 'var(--color-border)' }}>
                            {/* Report type */}
                            <div className="flex items-center gap-3">
                                <span className="text-[12px] font-semibold w-20 flex-shrink-0"
                                    style={{ color: 'var(--color-text-secondary)' }}>ประเภท</span>
                                <div className="flex items-center gap-2">
                                    {([
                                        { key: 'visits',     label: 'บันทึกออกพื้นที่', icon: Users },
                                        { key: 'attendance', label: 'การเข้างาน',        icon: Calendar },
                                    ] as const).map(({ key, label, icon: Icon }) => (
                                        <button key={key}
                                            onClick={() => setReportType(key)}
                                            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-semibold transition-all"
                                            style={{
                                                background: reportType === key ? 'var(--color-primary)' : 'var(--color-surface-2)',
                                                color: reportType === key ? '#fff' : 'var(--color-text-secondary)',
                                                border: '1px solid ' + (reportType === key ? 'var(--color-primary)' : 'var(--color-border)'),
                                            }}>
                                            <Icon className="w-3.5 h-3.5" />{label}
                                        </button>
                                    ))}
                                </div>
                            </div>

                            {/* Date range */}
                            <div className="flex items-center gap-3 flex-wrap">
                                <span className="text-[12px] font-semibold w-20 flex-shrink-0"
                                    style={{ color: 'var(--color-text-secondary)' }}>ช่วงวันที่</span>
                                <div className="flex items-center gap-2 flex-wrap">
                                    <DatePicker 
                                        showTime={{ format: 'HH:mm' }}
                                        format="YYYY-MM-DD HH:mm"
                                        value={fromDate ? dayjs(fromDate) : null}
                                        onChange={(date) => setFromDate(date ? date.format('YYYY-MM-DD HH:mm') : '')}
                                        style={{ height: '32px', width: '160px' }}
                                    />
                                    <span className="text-[12px]" style={{ color: 'var(--color-text-tertiary)' }}>ถึง</span>
                                    <DatePicker 
                                        showTime={{ format: 'HH:mm' }}
                                        format="YYYY-MM-DD HH:mm"
                                        value={toDate ? dayjs(toDate) : null}
                                        onChange={(date) => setToDate(date ? date.format('YYYY-MM-DD HH:mm') : '')}
                                        style={{ height: '32px', width: '160px' }}
                                    />
                                    <button
                                        onClick={fetchPreview}
                                        disabled={loading}
                                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-semibold"
                                        style={{
                                            background: 'var(--color-primary)',
                                            color: '#fff',
                                            opacity: loading ? 0.7 : 1,
                                        }}>
                                        <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
                                        {loading ? 'กำลังโหลด...' : 'แสดงตัวอย่าง'}
                                    </button>
                                </div>
                            </div>
                        </div>

                        {/* Preview table */}
                        <div className="flex-1 overflow-auto p-5 min-h-0">
                            {error && (
                                <p className="text-sm text-center py-8" style={{ color: '#EF4444' }}>{error}</p>
                            )}
                            {!fetched && !loading && !error && (
                                <div className="flex flex-col items-center justify-center py-12 gap-3">
                                    <FileText className="w-8 h-8" style={{ color: 'var(--color-text-tertiary)' }} />
                                    <p className="text-[13px]" style={{ color: 'var(--color-text-tertiary)' }}>
                                        เลือกช่วงวันที่และกด "แสดงตัวอย่าง"
                                    </p>
                                </div>
                            )}
                            {fetched && reportType === 'visits' && (
                                <div className="overflow-x-auto">
                                    <p className="text-[11px] mb-3" style={{ color: 'var(--color-text-tertiary)' }}>
                                        {rows} รายการ
                                    </p>
                                    <table className="w-full min-w-[520px] text-[12px]">
                                        <thead>
                                            <tr style={{ borderBottom: '2px solid var(--color-border)' }}>
                                                {['วันที่', 'พนักงาน', 'ลูกค้า / งาน', 'Product', 'สถานที่', 'หมายเหตุ'].map(h => (
                                                    <th key={h} className="text-left pb-2 pr-4 font-bold"
                                                        style={{ color: 'var(--color-text-secondary)' }}>{h}</th>
                                                ))}
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {visitRows.map((r, i) => (
                                                <tr key={i} className="border-t"
                                                    style={{ borderColor: 'var(--color-border)' }}>
                                                    <td className="py-2 pr-4 whitespace-nowrap" style={{ color: 'var(--color-text-tertiary)' }}>
                                                        {r.visit_date ? new Date(r.visit_date).toLocaleDateString('th-TH', { day: 'numeric', month: 'short' }) : '—'}
                                                    </td>
                                                    <td className="py-2 pr-4" style={{ color: 'var(--color-text-primary)' }}>{r.employee_name || '—'}</td>
                                                    <td className="py-2 pr-4" style={{ color: 'var(--color-text-primary)' }}>{r.customer || '—'}</td>
                                                    <td className="py-2 pr-4" style={{ color: 'var(--color-text-secondary)' }}>{r.product || '—'}</td>
                                                    <td className="py-2 pr-4" style={{ color: 'var(--color-text-tertiary)' }}>{r.site || '—'}</td>
                                                    <td className="py-2 pr-4" style={{ color: 'var(--color-text-tertiary)' }}>{r.notes || '—'}</td>
                                                </tr>
                                            ))}
                                            {visitRows.length === 0 && (
                                                <tr>
                                                    <td colSpan={6} className="py-8 text-center" style={{ color: 'var(--color-text-tertiary)' }}>
                                                        ไม่มีข้อมูลในช่วงที่เลือก
                                                    </td>
                                                </tr>
                                            )}
                                        </tbody>
                                    </table>
                                </div>
                            )}
                            {fetched && reportType === 'attendance' && (
                                <div className="overflow-x-auto">
                                    <p className="text-[11px] mb-3" style={{ color: 'var(--color-text-tertiary)' }}>
                                        {rows} รายการ
                                    </p>
                                    <table className="w-full min-w-[460px] text-[12px]">
                                        <thead>
                                            <tr style={{ borderBottom: '2px solid var(--color-border)' }}>
                                                {['วันที่', 'พนักงาน', 'สถานะ', 'Product', 'ลูกค้า', 'หมายเหตุ'].map(h => (
                                                    <th key={h} className="text-left pb-2 pr-4 font-bold"
                                                        style={{ color: 'var(--color-text-secondary)' }}>{h}</th>
                                                ))}
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {attRows.map((r, i) => (
                                                <tr key={i} className="border-t"
                                                    style={{ borderColor: 'var(--color-border)' }}>
                                                    <td className="py-2 pr-4 whitespace-nowrap" style={{ color: 'var(--color-text-tertiary)' }}>
                                                        {r.date ? new Date(r.date).toLocaleDateString('th-TH', { day: 'numeric', month: 'short' }) : '—'}
                                                    </td>
                                                    <td className="py-2 pr-4" style={{ color: 'var(--color-text-primary)' }}>{r.employee_name || '—'}</td>
                                                    <td className="py-2 pr-4">
                                                        <span className="px-2 py-0.5 rounded text-[11px] font-semibold"
                                                            style={{
                                                                background: r.status === 'office' ? '#D1FAE5' : r.status === 'travel' ? '#EDE9FE' : '#FEE2E2',
                                                                color: r.status === 'office' ? '#065F46' : r.status === 'travel' ? '#4C1D95' : '#991B1B',
                                                            }}>
                                                            {STATUS_LABEL[r.status] ?? r.status}
                                                        </span>
                                                    </td>
                                                    <td className="py-2 pr-4" style={{ color: 'var(--color-text-secondary)' }}>{r.product || '—'}</td>
                                                    <td className="py-2 pr-4" style={{ color: 'var(--color-text-secondary)' }}>{r.customer || '—'}</td>
                                                    <td className="py-2 pr-4" style={{ color: 'var(--color-text-tertiary)' }}>{r.note || '—'}</td>
                                                </tr>
                                            ))}
                                            {attRows.length === 0 && (
                                                <tr>
                                                    <td colSpan={6} className="py-8 text-center" style={{ color: 'var(--color-text-tertiary)' }}>
                                                        ไม่มีข้อมูลในช่วงที่เลือก
                                                    </td>
                                                </tr>
                                            )}
                                        </tbody>
                                    </table>
                                </div>
                            )}
                        </div>

                        {/* Footer actions */}
                        <div className="flex items-center justify-end gap-2 p-5 border-t flex-shrink-0"
                            style={{ borderColor: 'var(--color-border)' }}>
                            <button onClick={onClose} className="btn text-[13px]"
                                style={{ color: 'var(--color-text-secondary)' }}>
                                ปิด
                            </button>
                            <button
                                onClick={printReport}
                                className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-[13px] font-semibold btn"
                            >
                                <Printer className="w-3.5 h-3.5" />พิมพ์
                            </button>
                            <button
                                onClick={downloadCSV}
                                className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-[13px] font-semibold"
                                style={{ background: 'var(--color-primary)', color: '#fff' }}
                            >
                                <Download className="w-3.5 h-3.5" />ดาวน์โหลด CSV
                            </button>
                        </div>
                    </div>
        </Modal>
    );
}
