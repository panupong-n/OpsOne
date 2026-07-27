import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { toast } from 'sonner'
import { ArrowLeft, ShieldAlert, CheckCircle2, XCircle, Clock, Copy, RefreshCw } from 'lucide-react'
import { trainingApi } from './api'
import type { TrainingExam, ExamResult, CodeStatus, SubmitReason } from './types'

const STATUS_LABEL: Record<CodeStatus, { label: string; color: string; bg: string }> = {
  PENDING:   { label: 'รอส่ง',      color: '#6B7280', bg: 'rgba(107,114,128,0.12)' },
  SENT:      { label: 'ส่งแล้ว',    color: '#2563EB', bg: 'rgba(37,99,235,0.12)' },
  STARTED:   { label: 'กำลังสอบ',   color: '#D97706', bg: 'rgba(217,119,6,0.12)' },
  SUBMITTED: { label: 'ส่งคำตอบแล้ว', color: '#059669', bg: 'rgba(16,185,129,0.12)' },
  EXPIRED:   { label: 'หมดอายุ',    color: '#DC2626', bg: 'rgba(220,38,38,0.12)' },
}
const REASON_LABEL: Record<SubmitReason, string> = {
  MANUAL: 'ส่งเอง', TIMEOUT: 'หมดเวลา', VIOLATIONS: 'ละเมิดครบ',
}

function fmt(ts: string | null): string {
  if (!ts) return '—'
  return new Date(ts).toLocaleString('th-TH', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
}

export default function TrainingResultsPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [exam, setExam] = useState<TrainingExam | null>(null)
  const [rows, setRows] = useState<ExamResult[]>([])
  const [loading, setLoading] = useState(true)

  const load = async () => {
    if (!id) return
    setLoading(true)
    try {
      const [ex, res] = await Promise.all([
        trainingApi.get<TrainingExam>(`/exams/${id}`),
        trainingApi.get<ExamResult[]>(`/exams/${id}/results`),
      ])
      setExam(ex); setRows(res)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'โหลดผลสอบไม่สำเร็จ')
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => { load() }, [id])

  const stats = useMemo(() => {
    const done = rows.filter(r => r.status === 'SUBMITTED')
    const passed = done.filter(r => r.passed).length
    return { total: rows.length, done: done.length, passed, failed: done.length - passed }
  }, [rows])

  const copyCode = (code: string) => {
    navigator.clipboard?.writeText(code).then(() => toast.success(`คัดลอกรหัส ${code}`)).catch(() => {})
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <button className="btn-icon" onClick={() => navigate('/training/exams')}><ArrowLeft className="w-5 h-5" /></button>
          <div>
            <h1 className="text-xl font-bold" style={{ color: 'var(--color-text-primary)' }}>ผลสอบ</h1>
            <p className="text-sm" style={{ color: 'var(--color-text-tertiary)' }}>{exam?.title || '...'}</p>
          </div>
        </div>
        <button className="btn btn-ghost" onClick={load}><RefreshCw className="w-4 h-4" /> รีเฟรช</button>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: 'ส่งทั้งหมด', value: stats.total, color: 'var(--color-text-primary)' },
          { label: 'ทำเสร็จ', value: stats.done, color: '#2563EB' },
          { label: 'ผ่าน', value: stats.passed, color: '#059669' },
          { label: 'ไม่ผ่าน', value: stats.failed, color: '#DC2626' },
        ].map(s => (
          <div key={s.label} className="rounded-2xl p-4" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
            <p className="text-2xl font-bold" style={{ color: s.color }}>{s.value}</p>
            <p className="text-xs" style={{ color: 'var(--color-text-tertiary)' }}>{s.label}</p>
          </div>
        ))}
      </div>

      {loading ? (
        <p className="text-center py-12" style={{ color: 'var(--color-text-tertiary)' }}>กำลังโหลด...</p>
      ) : rows.length === 0 ? (
        <p className="text-center py-12" style={{ color: 'var(--color-text-tertiary)' }}>ยังไม่มีผู้เข้าสอบ — ส่งรหัสให้ผู้สอบก่อน</p>
      ) : (
        <>
          {/* Desktop table */}
          <div className="hidden md:block overflow-x-auto rounded-2xl" style={{ border: '1px solid var(--color-border)' }}>
            <table className="w-full text-sm">
              <thead>
                <tr style={{ background: 'var(--color-surface-2)' }}>
                  {['ผู้สอบ', 'รหัส', 'สถานะ', 'คะแนน', 'ผล', 'ละเมิด', 'เริ่ม', 'ส่ง'].map(h => (
                    <th key={h} className="text-left px-4 py-2.5 font-semibold text-xs" style={{ color: 'var(--color-text-tertiary)' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map(r => <ResultRow key={r.id} r={r} onCopy={copyCode} />)}
              </tbody>
            </table>
          </div>

          {/* Mobile cards */}
          <div className="md:hidden space-y-2">
            {rows.map(r => <ResultCard key={r.id} r={r} onCopy={copyCode} />)}
          </div>
        </>
      )}
    </div>
  )
}

function ScoreCell({ r }: { r: ExamResult }) {
  if (r.status !== 'SUBMITTED' || r.score === null) return <span style={{ color: 'var(--color-text-tertiary)' }}>—</span>
  return (
    <span className="font-semibold" style={{ color: 'var(--color-text-primary)' }}>
      {Number(r.score)}/{Number(r.max_score)} <span className="text-xs" style={{ color: 'var(--color-text-tertiary)' }}>({Number(r.percent)}%)</span>
    </span>
  )
}

function PassBadge({ r }: { r: ExamResult }) {
  if (r.status !== 'SUBMITTED' || r.passed === null) return <span style={{ color: 'var(--color-text-tertiary)' }}>—</span>
  return r.passed
    ? <span className="inline-flex items-center gap-1 text-xs font-bold" style={{ color: '#059669' }}><CheckCircle2 className="w-4 h-4" /> ผ่าน</span>
    : <span className="inline-flex items-center gap-1 text-xs font-bold" style={{ color: '#DC2626' }}><XCircle className="w-4 h-4" /> ไม่ผ่าน</span>
}

function ResultRow({ r, onCopy }: { r: ExamResult; onCopy: (c: string) => void }) {
  const st = STATUS_LABEL[r.status]
  return (
    <tr style={{ borderTop: '1px solid var(--color-border)' }}>
      <td className="px-4 py-2.5">
        <p className="font-medium" style={{ color: 'var(--color-text-primary)' }}>{r.candidate_name || '—'}</p>
        <p className="text-xs" style={{ color: 'var(--color-text-tertiary)' }}>{r.candidate_email}</p>
      </td>
      <td className="px-4 py-2.5">
        <button className="font-mono text-xs inline-flex items-center gap-1 hover:underline" style={{ color: 'var(--color-primary)' }} onClick={() => onCopy(r.code)}>
          {r.code} <Copy className="w-3 h-3" />
        </button>
      </td>
      <td className="px-4 py-2.5"><span className="text-xs font-semibold px-2 py-0.5 rounded-full" style={{ color: st.color, background: st.bg }}>{st.label}</span></td>
      <td className="px-4 py-2.5"><ScoreCell r={r} /></td>
      <td className="px-4 py-2.5">
        <PassBadge r={r} />
        {r.submit_reason === 'VIOLATIONS' && <span className="block text-[10px]" style={{ color: '#DC2626' }}>ส่งเพราะละเมิดครบ</span>}
        {r.submit_reason === 'TIMEOUT' && <span className="block text-[10px]" style={{ color: '#D97706' }}>หมดเวลา</span>}
      </td>
      <td className="px-4 py-2.5">
        <span className="inline-flex items-center gap-1 text-xs font-semibold" style={{ color: r.violations > 0 ? '#DC2626' : 'var(--color-text-tertiary)' }}>
          <ShieldAlert className="w-3.5 h-3.5" /> {r.violations}
        </span>
      </td>
      <td className="px-4 py-2.5 text-xs" style={{ color: 'var(--color-text-tertiary)' }}>{fmt(r.started_at)}</td>
      <td className="px-4 py-2.5 text-xs" style={{ color: 'var(--color-text-tertiary)' }}>{fmt(r.submitted_at)}</td>
    </tr>
  )
}

function ResultCard({ r, onCopy }: { r: ExamResult; onCopy: (c: string) => void }) {
  const st = STATUS_LABEL[r.status]
  return (
    <div className="rounded-xl p-4" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-medium truncate" style={{ color: 'var(--color-text-primary)' }}>{r.candidate_name || '—'}</p>
          <p className="text-xs truncate" style={{ color: 'var(--color-text-tertiary)' }}>{r.candidate_email}</p>
        </div>
        <span className="text-xs font-semibold px-2 py-0.5 rounded-full flex-shrink-0" style={{ color: st.color, background: st.bg }}>{st.label}</span>
      </div>
      <div className="flex items-center justify-between mt-3 text-sm">
        <ScoreCell r={r} />
        <PassBadge r={r} />
      </div>
      <div className="flex items-center justify-between mt-2 text-xs" style={{ color: 'var(--color-text-tertiary)' }}>
        <button className="font-mono inline-flex items-center gap-1" style={{ color: 'var(--color-primary)' }} onClick={() => onCopy(r.code)}>{r.code} <Copy className="w-3 h-3" /></button>
        <span className="inline-flex items-center gap-1"><ShieldAlert className="w-3.5 h-3.5" /> ละเมิด {r.violations}{r.submit_reason ? ` · ${REASON_LABEL[r.submit_reason]}` : ''}</span>
      </div>
      <div className="flex items-center gap-3 mt-1 text-[11px]" style={{ color: 'var(--color-text-tertiary)' }}>
        <span className="inline-flex items-center gap-1"><Clock className="w-3 h-3" /> เริ่ม {fmt(r.started_at)}</span>
        <span>ส่ง {fmt(r.submitted_at)}</span>
      </div>
    </div>
  )
}
