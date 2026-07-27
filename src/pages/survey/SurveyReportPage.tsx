import { useState, useMemo, useRef, useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { BarChart2, ChevronDown, Printer, Users, Star, MessageSquare, CheckCircle, PieChart, TrendingUp, Award, Target, ArrowUpRight } from 'lucide-react'
import surveyApi from './api'
import type { Survey, SurveyReport, DeptBreakdown, SectionData, QuestionStat } from './types'
import SurveyLayout from './SurveyLayout'
import { thaiDate } from './utils'

/* ── Reusable chart components ─────────────────────────────────────── */

function HorizBar({ label, value, max, color = '#2563EB', showValue = true }: { label: string; value: number; max: number; color?: string; showValue?: boolean }) {
  const pct = max === 0 ? 0 : Math.round((value / max) * 100)
  return (
    <div className="flex items-center gap-3 mb-2.5">
      <span className="text-xs font-semibold text-[var(--color-text-secondary)] w-20 text-right flex-shrink-0 truncate">{label}</span>
      <div className="flex-1 h-6 bg-[var(--color-surface-2)] rounded-md overflow-hidden border border-[var(--color-border)] relative">
        <div className="h-full rounded-md transition-all duration-700 ease-out min-w-0" style={{ width: `${pct}%`, backgroundColor: color }} />
        {showValue && pct > 5 && (
          <span className="absolute inset-y-0 left-2 flex items-center text-[11px] font-bold text-white drop-shadow-sm mix-blend-difference">{value}</span>
        )}
      </div>
      <div className="text-xs text-[var(--color-text-tertiary)] w-12 text-right flex-shrink-0 font-mono">
        {pct}%
      </div>
    </div>
  )
}

function SatisfactionGauge({ score, size = 180 }: { score: number; size?: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const dpr = window.devicePixelRatio || 1
    canvas.width = size * dpr; canvas.height = (size * 0.65) * dpr
    canvas.style.width = `${size}px`; canvas.style.height = `${size * 0.65}px`
    ctx.scale(dpr, dpr)
    const cx = size / 2, cy = size * 0.55
    const radius = size * 0.38
    const lineWidth = size * 0.1

    // Background arc (semi-circle)
    ctx.beginPath()
    ctx.arc(cx, cy, radius, Math.PI, 0)
    ctx.strokeStyle = '#E2E8F0'; ctx.lineWidth = lineWidth; ctx.lineCap = 'round'; ctx.stroke()

    // Gradient foreground
    if (score > 0) {
      const angle = Math.PI + (score / 100) * Math.PI
      const grad = ctx.createLinearGradient(cx - radius, cy, cx + radius, cy)
      grad.addColorStop(0, '#EF4444')
      grad.addColorStop(0.35, '#F59E0B')
      grad.addColorStop(0.65, '#84CC16')
      grad.addColorStop(1, '#10B981')
      ctx.beginPath()
      ctx.arc(cx, cy, radius, Math.PI, angle)
      ctx.strokeStyle = grad; ctx.lineWidth = lineWidth; ctx.lineCap = 'round'; ctx.stroke()
    }

    // Center text
    ctx.fillStyle = '#0F172A'; ctx.font = `bold ${size * 0.18}px Inter,sans-serif`
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
    ctx.fillText(`${score}`, cx, cy - size * 0.04)
    ctx.fillStyle = '#64748B'; ctx.font = `${size * 0.065}px Inter,sans-serif`
    ctx.fillText('คะแนนจาก 100', cx, cy + size * 0.08)
  }, [score, size])
  return <canvas ref={canvasRef} />
}

const TABS = ['ภาพรวม', 'รายคำถาม', 'รายแผนก'] as const
const RATING_LABEL: Record<number, string> = { 1: 'ควรปรับปรุง', 2: 'พึงพอใจน้อย', 3: 'ปานกลาง', 4: 'พึงพอใจมาก', 5: 'มากที่สุด' }
const ratingColors = ['#EF4444', '#F97316', '#F59E0B', '#84CC16', '#10B981']

function scoreColor(score: number) {
  if (score >= 80) return 'text-emerald-600'
  if (score >= 60) return 'text-amber-600'
  return 'text-red-500'
}
function scoreBg(score: number) {
  if (score >= 80) return 'bg-emerald-50 border-emerald-100'
  if (score >= 60) return 'bg-amber-50 border-amber-100'
  return 'bg-red-50 border-red-100'
}

export default function SurveyReportPage() {
  const [surveyId, setSurveyId] = useState('')
  const [activeTab, setActiveTab] = useState<typeof TABS[number]>('ภาพรวม')
  const [expandedQs, setExpandedQs] = useState<Record<string, boolean>>({})

  const { data: surveys = [] } = useQuery<Survey[]>({
    queryKey: ['surveys'],
    queryFn: () => surveyApi.get<Survey[]>('/surveys').then((r) => r.data),
  })
  const published = surveys.filter((s) => s.status === 'PUBLISHED' && (s._count?.assignments ?? 0) > 0)

  const { data: report, isLoading } = useQuery<SurveyReport>({
    queryKey: ['survey-report', surveyId],
    queryFn: () => surveyApi.get<SurveyReport>(`/surveys/${surveyId}/report`).then((r) => r.data),
    enabled: !!surveyId,
  })

  const allQuestions: QuestionStat[] = (report?.sections ?? []).flatMap((s: SectionData) => s.questions)
  const selectedSurvey = published.find((s) => s.id === surveyId)

  const combinedRatingDist = useMemo(() => {
    if (!report) return null
    const dist: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 }
    const ratingQs = allQuestions.filter(q => q.type === 'RATING')
    if (ratingQs.length === 0) return null
    ratingQs.forEach(q => {
      Object.entries(q.distribution).forEach(([k, v]) => { dist[Number(k)] += v })
    })
    return dist
  }, [allQuestions, report])

  // Section-level averages for overview
  const sectionAverages = useMemo(() => {
    if (!report) return []
    const weightPattern = /\s*[—-]?\s*น้ำหนัก\s*([\d.]+)\s*%/
    return (report.sections ?? []).map(s => {
      const ratingQs = s.questions.filter(q => q.avg != null)
      const avg = ratingQs.length > 0 ? ratingQs.reduce((sum, q) => sum + (q.avg ?? 0), 0) / ratingQs.length : 0
      const score = avg > 0 ? Math.round((avg / 5) * 100) : 0
      const wm = s.name.match(weightPattern)
      const weight = wm ? parseFloat(wm[1]) : null
      const name = s.name.replace(weightPattern, '').trim()
      return { name, weight, avg: Math.round(avg * 100) / 100, score, questionCount: s.questions.length }
    }).filter(s => s.avg > 0)
  }, [report])

  function handlePrint() { window.print() }
  function toggleExpand(id: string) { setExpandedQs(p => ({ ...p, [id]: !p[id] })) }

  return (
    <SurveyLayout>
      <style>{`
        @media print {
          body { background: #fff !important; }
          body * { visibility: hidden !important; }
          #print-report, #print-report * { visibility: visible !important; color: #000 !important; }
          #print-report { position: absolute; left: 0; top: 0; width: 100%; font-family: 'Sarabun', 'TH Sarabun New', sans-serif !important; font-size: 11pt; }
          .print-screen-only { display: none !important; }
          .print-only { display: block !important; }
          .print-page-break { page-break-before: always; }
          table { page-break-inside: avoid; }
          .print-section { page-break-inside: avoid; }
          @page { size: A4; margin: 15mm; }
        }
      `}</style>
      <div className="p-6">
        {/* Heading lives in AppHeader — only the export action renders here, and
            only once a report is loaded, so it takes no space otherwise. */}
        {report && (
          <div className="flex items-center justify-end mb-6 no-print">
            <button onClick={handlePrint} className="btn btn-primary shadow-blue-500/30 gap-2 text-sm h-9">
              <Printer className="w-4 h-4" />Export PDF
            </button>
          </div>
        )}

        {/* Survey selector */}
        <div className="card p-5 mb-6 no-print border-[var(--color-border)] shadow-sm">
          <label className="block text-xs font-bold text-[var(--color-text-secondary)] uppercase tracking-wider mb-2">เลือกแบบประเมิน</label>
          <div className="relative max-w-xl">
            <select value={surveyId} onChange={(e) => { setSurveyId(e.target.value); setActiveTab('ภาพรวม') }}
              className="form-input appearance-none pr-10 border-[var(--color-border)] shadow-sm bg-[var(--color-surface)] font-medium text-[var(--color-text-primary)]">
              <option value="">-- เลือกแบบประเมินเพื่อดูรายงาน --</option>
              {published.map((s) => <option key={s.id} value={s.id}>{s.title} - วันที่ {new Date(s.createdAt).toLocaleDateString('th-TH', { day: 'numeric', month: 'long', year: 'numeric' })}</option>)}
            </select>
            <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-5 h-5 text-[var(--color-text-tertiary)] pointer-events-none" />
          </div>
          {surveys.some((s) => s.status === 'PUBLISHED') && published.length === 0 && (
            <p className="text-xs text-amber-600 mt-2">⚠️ แบบประเมินที่เผยแพร่ยังไม่มีการมอบหมาย กรุณาไปที่หน้า <span className="font-semibold">แบบประเมิน</span> เพื่อมอบหมายก่อน</p>
          )}
        </div>

        {!surveyId && (
          <div className="card py-20 flex flex-col items-center text-center no-print border-dashed border-2 border-[var(--color-border)]">
            <div className="w-16 h-16 bg-[var(--color-surface-2)] text-[var(--color-text-tertiary)] rounded-2xl flex items-center justify-center mb-4 rotate-3">
              <BarChart2 className="w-8 h-8" />
            </div>
            <h3 className="text-lg font-bold text-[var(--color-text-primary)]">ยังไม่ได้เลือกแบบประเมิน</h3>
            <p className="text-sm text-[var(--color-text-secondary)] mt-1 max-w-sm">กรุณาเลือกแบบประเมินจากเมนูด้านบน เพื่อดูรายงานสรุปผลเชิงวิเคราะห์อย่างละเอียด</p>
          </div>
        )}

        {surveyId && isLoading && (
          <div className="card py-20 flex flex-col items-center justify-center no-print">
            <div className="w-8 h-8 border-4 border-blue-200 border-t-blue-600 rounded-full animate-spin mb-4" />
            <p className="text-sm font-semibold text-[var(--color-text-secondary)] animate-pulse">กำลังประมวลผลข้อมูลรายงาน...</p>
          </div>
        )}

        {report && (
          <div id="print-report" className="animate-in fade-in slide-in-from-bottom-4 duration-500">
            {/* --- OFFICIAL PRINT VIEW --- */}
            <div className="hidden print-only w-full pb-10">
              <div className="flex items-start justify-between border-b-2 border-black pb-4 mb-6" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', borderBottom: '2px solid black', paddingBottom: '16px', marginBottom: '24px' }}>
                <div>
                  <h1 className="text-2xl font-bold m-0">{selectedSurvey?.title ?? 'รายงานผลการประเมิน'}</h1>
                  <p className="mt-1 m-0">วันที่ออกรายงาน: {thaiDate(new Date().toISOString())}</p>
                </div>
                <img src="https://tenforward.co.th/wp-content/uploads/2024/09/TEN_logo.webp" alt="TEN FORWARD" style={{ height: '40px' }} />
              </div>
              
              <div className="mb-6">
                <h2 className="text-lg font-bold mb-3">สรุปผลการประเมินภาพรวม</h2>
                <table className="w-full border-collapse border border-black text-sm mb-6" style={{ width: '100%', borderCollapse: 'collapse', border: '1px solid black' }}>
                  <tbody>
                    <tr>
                      <td className="border border-black p-2 font-bold w-1/4" style={{ border: '1px solid black', padding: '8px', fontWeight: 'bold', width: '25%' }}>เป้าหมายทั้งหมด</td>
                      <td className="border border-black p-2 w-1/4 text-center" style={{ border: '1px solid black', padding: '8px', textAlign: 'center', width: '25%' }}>{report.summary.totalAssigned} คน</td>
                      <td className="border border-black p-2 font-bold w-1/4" style={{ border: '1px solid black', padding: '8px', fontWeight: 'bold', width: '25%' }}>ตอบแบบประเมินแล้ว</td>
                      <td className="border border-black p-2 w-1/4 text-center" style={{ border: '1px solid black', padding: '8px', textAlign: 'center', width: '25%' }}>{report.summary.totalCompleted} คน</td>
                    </tr>
                    <tr>
                      <td className="border border-black p-2 font-bold" style={{ border: '1px solid black', padding: '8px', fontWeight: 'bold' }}>ยังไม่ได้ตอบ</td>
                      <td className="border border-black p-2 text-center" style={{ border: '1px solid black', padding: '8px', textAlign: 'center' }}>{report.summary.totalAssigned - report.summary.totalCompleted} คน</td>
                      <td className="border border-black p-2 font-bold" style={{ border: '1px solid black', padding: '8px', fontWeight: 'bold' }}>อัตราการตอบกลับ</td>
                      <td className="border border-black p-2 text-center" style={{ border: '1px solid black', padding: '8px', textAlign: 'center' }}>{report.summary.completionRate}%</td>
                    </tr>
                    <tr>
                      <td className="border border-black p-2 font-bold" style={{ border: '1px solid black', padding: '8px', fontWeight: 'bold' }}>คะแนนเฉลี่ยรวม</td>
                      <td className="border border-black p-2 text-center" style={{ border: '1px solid black', padding: '8px', textAlign: 'center' }}>{report.summary.overallAvg?.toFixed(2) ?? '-'} / 5.00</td>
                      <td className="border border-black p-2 font-bold" style={{ border: '1px solid black', padding: '8px', fontWeight: 'bold' }}>คะแนนความพึงพอใจ</td>
                      <td className="border border-black p-2 text-center font-bold" style={{ border: '1px solid black', padding: '8px', textAlign: 'center', fontWeight: 'bold' }}>{report.summary.satisfactionScore ?? 0} / 100 คะแนน</td>
                    </tr>
                  </tbody>
                </table>
              </div>

              <div className="mb-6 print-page-break">
                <h2 className="text-lg font-bold mb-3">รายละเอียดการประเมินรายคำถาม</h2>
                {allQuestions.map((qs, i) => (
                  <div key={i} className="mb-4 print-section">
                    <p className="font-bold">{i + 1}. {qs.text}</p>
                    {qs.type === 'RATING' && (
                      <table className="w-full mt-2 text-sm" style={{ width: '100%', marginTop: '8px' }}>
                        <tbody>
                          {[5, 4, 3, 2, 1].map(s => {
                            const count = qs.distribution[s] ?? 0;
                            const pct = qs.count > 0 ? Math.round((count / qs.count) * 100) : 0;
                            return (
                              <tr key={s}>
                                <td className="w-32" style={{ width: '120px', whiteSpace: 'nowrap' }}>{RATING_LABEL[s] ?? `ระดับ ${s}`}</td>
                                <td className="align-middle">
                                  <div style={{ height: '12px', background: '#ccc', width: '100%', maxWidth: '300px' }}>
                                    <div style={{ height: '100%', background: '#444', width: `${pct}%` }} />
                                  </div>
                                </td>
                                <td className="w-24 text-right" style={{ width: '96px', textAlign: 'right' }}>{count} ({pct}%)</td>
                              </tr>
                            )
                          })}
                        </tbody>
                      </table>
                    )}
                    {(qs.type === 'SINGLE_CHOICE' || qs.type === 'MULTI_CHOICE') && (
                      <ul className="list-disc ml-5 mt-2 text-sm" style={{ marginLeft: '20px', marginTop: '8px' }}>
                        {Object.entries(qs.distribution)
                          .filter(([c]) => c && c.trim() !== '' && c.trim() !== '-' && c.trim() !== 'null')
                          .sort(([, a], [, b]) => b - a)
                          .map(([c, count]) => (
                          <li key={c}>{c}: {count} โหวต ({qs.count > 0 ? Math.round((count / qs.count) * 100) : 0}%)</li>
                        ))}
                      </ul>
                    )}
                    {qs.type === 'TEXT' && (
                      <ul className="list-disc ml-5 mt-2 text-sm" style={{ marginLeft: '20px', marginTop: '8px' }}>
                        {qs.textAnswers?.filter(t => t && t.trim() !== '' && t.trim() !== '-' && t.trim() !== 'null').map((t, j) => <li key={j}>{t}</li>)}
                      </ul>
                    )}
                  </div>
                ))}
              </div>

              <div className="mb-6 print-page-break">
                <h2 className="text-lg font-bold mb-3">ผลการประเมินรายแผนก</h2>
                <table className="w-full border-collapse border border-black text-sm text-center" style={{ width: '100%', borderCollapse: 'collapse', border: '1px solid black', textAlign: 'center' }}>
                  <thead>
                    <tr>
                      <th className="border border-black p-2" style={{ border: '1px solid black', padding: '8px', background: '#f5f5f5' }}>แผนก</th>
                      <th className="border border-black p-2" style={{ border: '1px solid black', padding: '8px', background: '#f5f5f5' }}>ผู้ตอบกลับ</th>
                      <th className="border border-black p-2" style={{ border: '1px solid black', padding: '8px', background: '#f5f5f5' }}>คะแนนเฉลี่ย</th>
                      <th className="border border-black p-2" style={{ border: '1px solid black', padding: '8px', background: '#f5f5f5' }}>ความพึงพอใจ (/100)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.deptBreakdown?.map((d, i) => (
                      <tr key={i}>
                        <td className="border border-black p-2 text-left" style={{ border: '1px solid black', padding: '8px', textAlign: 'left' }}>{d.department || '-'}</td>
                        <td className="border border-black p-2" style={{ border: '1px solid black', padding: '8px' }}>{d.count}</td>
                        <td className="border border-black p-2" style={{ border: '1px solid black', padding: '8px' }}>{d.overallAvg?.toFixed(2) ?? '-'}</td>
                        <td className="border border-black p-2" style={{ border: '1px solid black', padding: '8px' }}>{d.overallAvg ? Math.round((d.overallAvg / 5) * 100) : '-'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* --- SCREEN VIEW --- */}
            <div className="print-screen-only">

            {/* Survey Info Header */}
            <div className="rounded-2xl shadow-md p-6 mb-6 bg-gradient-to-r from-blue-600 via-blue-700 to-indigo-700 text-white border-none relative overflow-hidden">
              <div className="absolute -right-8 -top-8 w-32 h-32 bg-white/5 rounded-full" />
              <div className="absolute -right-4 -bottom-4 w-20 h-20 bg-white/5 rounded-full" />
              <h2 className="text-xl font-black relative z-10">{selectedSurvey?.title}</h2>
              <p className="text-blue-100 text-sm mt-1 relative z-10">วันที่ประเมิน: {thaiDate(selectedSurvey?.createdAt || '')}</p>
              {report.summary.totalAssigned === 0 && (
                <div className="mt-4 bg-white/15 rounded-lg px-4 py-3 text-sm relative z-10">
                  ⚠️ ยังไม่มีข้อมูลการตอบกลับ — กรุณามอบหมายแบบประเมินก่อน แล้วกลับมาดูรายงานอีกครั้ง
                </div>
              )}
            </div>

            {report.summary.totalAssigned > 0 && (<>
            {/* Summary KPI Cards — redesigned */}
            <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-6">
              {[
                { label: 'ความพึงพอใจ', value: `${report.summary.satisfactionScore ?? 0}`, suffix: '/100', icon: Award, color: 'text-emerald-600', bg: 'bg-gradient-to-br from-emerald-50 to-green-50', border: 'border-emerald-200', highlight: true },
                { label: 'มอบหมาย', value: String(report.summary.totalAssigned), suffix: 'คน', icon: Users, color: 'text-blue-600', bg: 'bg-blue-50', border: 'border-blue-100' },
                { label: 'ตอบกลับ', value: String(report.summary.totalCompleted), suffix: 'คน', icon: CheckCircle, color: 'text-emerald-600', bg: 'bg-emerald-50', border: 'border-emerald-100' },
                { label: 'อัตราตอบกลับ', value: `${report.summary.completionRate}`, suffix: '%', icon: Target, color: 'text-blue-600', bg: 'bg-blue-50', border: 'border-blue-100' },
                { label: 'คะแนนเฉลี่ย', value: report.summary.overallAvg?.toFixed(2) ?? '—', suffix: '/5.00', icon: Star, color: 'text-amber-500', bg: 'bg-amber-50', border: 'border-amber-100' },
              ].map((c) => {
                const Icon = c.icon
                return (
                  <div key={c.label} className={`card p-5 border ${c.border} ${c.bg} hover:shadow-lg transition-all ${(c as { highlight?: boolean }).highlight ? 'ring-2 ring-emerald-200 shadow-emerald-100/50' : ''}`}>
                    <div className="flex items-center gap-2 mb-3">
                      <div className={`w-8 h-8 rounded-lg ${c.color} flex items-center justify-center bg-white/80 shadow-sm`}>
                        <Icon className="w-4 h-4" />
                      </div>
                      <span className="text-[11px] font-bold text-[var(--color-text-tertiary)] uppercase tracking-wider">{c.label}</span>
                    </div>
                    <div className="flex items-baseline gap-1">
                      <p className={`text-2xl font-black ${c.color} tracking-tight`}>{c.value}</p>
                      {c.suffix && <span className="text-xs text-[var(--color-text-tertiary)] font-semibold">{c.suffix}</span>}
                    </div>
                  </div>
                )
              })}
            </div>

            {/* Tabs */}
            <div className="flex gap-1 mb-6 bg-[var(--color-surface-2)] rounded-xl p-1 border border-[var(--color-border)] no-print">
              {TABS.map((t) => (
                <button key={t} onClick={() => setActiveTab(t)}
                  className={`flex-1 px-4 py-2.5 text-sm font-bold rounded-lg transition-all ${activeTab === t ? 'bg-[var(--color-surface)] text-blue-600 shadow-sm border border-[var(--color-border)]' : 'text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]'}`}>
                  {t}
                </button>
              ))}
            </div>

            {/* Tab Content: Overview */}
            {activeTab === 'ภาพรวม' && (
              <div className="space-y-6">
                {/* Top row — Gauge + Response Status */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  {/* Satisfaction Gauge */}
                  <div className="card overflow-hidden">
                    <div className="p-5 border-b border-[var(--color-border)] bg-gradient-to-r from-emerald-50 to-green-50">
                      <h3 className="text-sm font-bold text-emerald-900 flex items-center gap-2">
                        <Award className="w-4 h-4 text-emerald-600" />
                        {report.summary.scoreMethod === 'weighted' ? 'คะแนนรวม (ถ่วงน้ำหนัก)' : 'คะแนนความพึงพอใจ'}
                      </h3>
                      <p className="text-xs text-emerald-600 mt-0.5">
                        {report.summary.scoreMethod === 'weighted'
                          ? 'คำนวณแบบถ่วงน้ำหนักตามหมวด (เต็ม 100)'
                          : 'คำนวณจากคะแนน Rating ทุกข้อ เฉลี่ยทุกผู้ตอบ (เต็ม 100)'}
                      </p>
                    </div>
                    <div className="p-6 flex flex-col items-center">
                      <SatisfactionGauge score={report.summary.satisfactionScore ?? 0} />
                      <div className={`mt-2 px-4 py-2 rounded-full border text-sm font-bold ${scoreBg(report.summary.satisfactionScore ?? 0)} ${scoreColor(report.summary.satisfactionScore ?? 0)}`}>
                        {(report.summary.satisfactionScore ?? 0) >= 80 ? '✓ ดีมาก' : (report.summary.satisfactionScore ?? 0) >= 60 ? '~ ปานกลาง' : '⚠ ควรปรับปรุง'}
                      </div>
                    </div>
                  </div>

                  {/* Response Status */}
                  <div className="card overflow-hidden">
                    <div className="p-5 border-b border-[var(--color-border)] bg-[var(--color-surface-2)]">
                      <h3 className="text-sm font-bold text-[var(--color-text-primary)] flex items-center gap-2">
                        <PieChart className="w-4 h-4 text-blue-500" />
                        สถานะการตอบกลับ
                      </h3>
                    </div>
                    <div className="p-6">
                      <HorizBar label="สำเร็จ" value={report.summary.totalCompleted} max={report.summary.totalAssigned} color="#10B981" />
                      <HorizBar label="รอตอบ" value={report.summary.totalAssigned - report.summary.totalCompleted} max={report.summary.totalAssigned} color="#94A3B8" />
                      <div className="mt-6 pt-5 border-t border-[var(--color-border)] flex justify-between items-center">
                        <div className="text-center">
                          <p className="text-2xl font-black text-[var(--color-text-primary)]">{report.summary.totalAssigned}</p>
                          <p className="text-xs text-[var(--color-text-tertiary)] font-medium mt-1">เป้าหมายทั้งหมด</p>
                        </div>
                        <div className="text-center">
                          <p className="text-2xl font-black text-emerald-500">{report.summary.totalCompleted}</p>
                          <p className="text-xs text-[var(--color-text-tertiary)] font-medium mt-1">บรรลุแล้ว</p>
                        </div>
                        <div className="text-center">
                          <p className={`text-2xl font-black ${scoreColor(report.summary.completionRate)}`}>{report.summary.completionRate}%</p>
                          <p className="text-xs text-[var(--color-text-tertiary)] font-medium mt-1">อัตราตอบกลับ</p>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Bottom row — Section breakdown + Rating distribution */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  {/* Section breakdown */}
                  {sectionAverages.length > 0 && (
                    <div className="card overflow-hidden">
                      <div className="p-5 border-b border-[var(--color-border)] bg-[var(--color-surface-2)]">
                        <h3 className="text-sm font-bold text-[var(--color-text-primary)] flex items-center gap-2">
                          <TrendingUp className="w-4 h-4 text-blue-500" />
                          คะแนนรายหมวด
                        </h3>
                      </div>
                      <div className="p-5 space-y-4">
                        {sectionAverages.map((s, i) => (
                          <div key={i}>
                            <div className="flex items-center justify-between mb-1.5">
                              <span className="text-xs font-semibold text-[var(--color-text-primary)] flex-1 mr-2 truncate">
                                {s.name}
                                {s.weight != null && (
                                  <span className="ml-1.5 inline-block px-1.5 py-0.5 rounded-full bg-blue-50 text-blue-600 border border-blue-100 text-[10px] font-bold align-middle">น้ำหนัก {s.weight}%</span>
                                )}
                              </span>
                              <div className="flex items-center gap-2">
                                <span className="text-xs text-[var(--color-text-secondary)]">{s.avg}/5.00</span>
                                <span className={`text-xs font-bold ${scoreColor(s.score)}`}>{s.score}/100</span>
                              </div>
                            </div>
                            <div className="h-3 rounded-full bg-[var(--color-surface-2)] border border-[var(--color-border)] overflow-hidden">
                              <div
                                className="h-full rounded-full transition-all duration-700"
                                style={{
                                  width: `${s.score}%`,
                                  background: s.score >= 80 ? 'linear-gradient(90deg, #34D399, #10B981)' : s.score >= 60 ? 'linear-gradient(90deg, #FBBF24, #F59E0B)' : 'linear-gradient(90deg, #F87171, #EF4444)',
                                }}
                              />
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Combined rating distribution */}
                  <div className="card overflow-hidden">
                    <div className="p-5 border-b border-[var(--color-border)] bg-[var(--color-surface-2)]">
                      <h3 className="text-sm font-bold text-[var(--color-text-primary)] flex items-center gap-2">
                        <Star className="w-4 h-4 text-amber-500" />
                        การกระจายคะแนน Rating รวม
                      </h3>
                    </div>
                    <div className="p-6">
                      {combinedRatingDist ? (
                        (() => {
                          const maxVal = Math.max(...Object.values(combinedRatingDist))
                          return [5, 4, 3, 2, 1].map((star) => (
                            <HorizBar key={star} label={`★${star} ${RATING_LABEL[star]}`} value={combinedRatingDist[star]} max={maxVal} color={ratingColors[star - 1]} />
                          ))
                        })()
                      ) : (
                        <div className="h-full flex flex-col items-center justify-center text-[var(--color-text-tertiary)] py-8">
                          <Star className="w-8 h-8 mb-2 opacity-20" />
                          <p className="text-sm">ไม่มีคำถามประเภท Rating</p>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Tab Content: Questions (grouped by section) */}
            {activeTab === 'รายคำถาม' && (
              <div className="space-y-8">
                {(report.sections ?? []).map((section: SectionData, si: number) => {
                  const sectionAvg = section.questions.filter(q => q.avg != null).reduce((s, q, _, a) => s + (q.avg ?? 0) / a.length, 0)
                  const sectionScore = sectionAvg > 0 ? Math.round((sectionAvg / 5) * 100) : 0
                  const globalOffset = (report.sections ?? []).slice(0, si).reduce((s, sec) => s + sec.questions.length, 0)
                  return (
                    <div key={si}>
                      {/* Section header */}
                      {(report.sections ?? []).length > 1 && (
                        <div className="flex items-center gap-3 mb-4 p-4 rounded-xl bg-gradient-to-r from-blue-50 to-indigo-50 border border-blue-100">
                          <div className="w-8 h-8 rounded-lg bg-blue-600 text-white font-black text-sm flex items-center justify-center flex-shrink-0">
                            {si + 1}
                          </div>
                          <div className="flex-1 min-w-0">
                            <h3 className="text-sm font-bold text-blue-900">{section.name}</h3>
                            <p className="text-xs text-blue-600 mt-0.5">{section.questions.length} คำถาม</p>
                          </div>
                          {sectionAvg > 0 && (
                            <div className="flex items-center gap-3">
                              <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-white border border-blue-200">
                                <Star className="w-4 h-4 text-amber-500 fill-amber-500" />
                                <span className="font-black text-amber-600 text-sm">{sectionAvg.toFixed(2)}</span>
                              </div>
                              <div className={`flex items-center gap-1 px-3 py-1.5 rounded-full border ${scoreBg(sectionScore)}`}>
                                <span className={`font-black text-sm ${scoreColor(sectionScore)}`}>{sectionScore}</span>
                                <span className="text-[10px] text-[var(--color-text-tertiary)]">/100</span>
                              </div>
                            </div>
                          )}
                        </div>
                      )}

                      {/* Questions in this section */}
                      <div className="space-y-4">
                        {section.questions.map((qs, i) => {
                          const qScore = qs.avg ? Math.round((qs.avg / 5) * 100) : null
                          return (
                            <div key={qs.id ?? i} className="card overflow-hidden shadow-sm hover:shadow-md transition-shadow">
                              <div className="p-5 bg-[var(--color-surface-2)] border-b border-[var(--color-border)] flex items-start gap-3">
                                <div className="w-8 h-8 rounded-xl bg-blue-600 text-white font-black text-sm flex items-center justify-center shadow-inner flex-shrink-0">
                                  {globalOffset + i + 1}
                                </div>
                                <div className="flex-1 mt-1">
                                  <h4 className="text-base font-bold text-[var(--color-text-primary)] leading-snug">{qs.text}</h4>
                                  <div className="flex items-center gap-3 mt-2 text-xs font-semibold text-[var(--color-text-secondary)]">
                                    <span className="bg-[var(--color-surface)] border border-[var(--color-border)] px-2 py-0.5 rounded-full text-[var(--color-text-secondary)]">{qs.type === 'RATING' ? 'คะแนน 1-5' : qs.type === 'TEXT' ? 'ข้อความ' : qs.type === 'MULTI_CHOICE' ? 'เลือกหลาย' : qs.type === 'SINGLE_CHOICE' ? 'เลือกหนึ่ง' : qs.type}</span>
                                    <span>{qs.count} คำตอบ</span>
                                    {qs.avg != null && (
                                      <div className="flex items-center gap-2">
                                        <span className="text-amber-600 bg-amber-50 px-2 py-0.5 rounded-full">เฉลี่ย {qs.avg.toFixed(2)}/5.00</span>
                                        {qScore !== null && (
                                          <span className={`px-2 py-0.5 rounded-full ${scoreBg(qScore)} ${scoreColor(qScore)} font-bold`}>
                                            {qScore}/100
                                          </span>
                                        )}
                                      </div>
                                    )}
                                  </div>
                                </div>
                              </div>
                      
                              <div className="p-6">
                                {qs.type === 'RATING' && (
                                  <div className="max-w-2xl">
                                    {[5, 4, 3, 2, 1].map((s) => <HorizBar key={s} label={`★ ${s} ${RATING_LABEL[s] ?? ''}`} value={qs.distribution[s] ?? 0} max={qs.count} color={ratingColors[s - 1]} />)}
                                  </div>
                                )}
                        
                                {(qs.type === 'SINGLE_CHOICE' || qs.type === 'MULTI_CHOICE' || qs.type === 'DEPT_SELECT') && (
                                  <div className="max-w-2xl space-y-2">
                                    {Object.entries(qs.distribution)
                                      .sort(([, a], [, b]) => b - a)
                                      .map(([choice, count], idx) => (
                                      <div key={choice} className="mb-4">
                                        <div className="flex justify-between text-sm font-medium mb-1.5">
                                          <span className="text-[var(--color-text-primary)]">{choice}</span>
                                          <span className="text-[var(--color-text-secondary)]">{count} โหวต ({qs.count > 0 ? Math.round((count / qs.count) * 100) : 0}%)</span>
                                        </div>
                                        <div className="h-3 bg-[var(--color-surface-2)] rounded-full overflow-hidden">
                                          <div className="h-full bg-blue-500 rounded-full" style={{ width: `${qs.count > 0 ? (count / qs.count) * 100 : 0}%`, opacity: 1 - (idx * 0.15) }} />
                                        </div>
                                      </div>
                                    ))}
                                    {qs.type === 'MULTI_CHOICE' && qs.textAnswers && qs.textAnswers.length > 0 && (
                                      <div className="mt-4 pt-4 border-t border-[var(--color-border)]">
                                        <div className="flex items-center gap-2 mb-3 text-sm font-bold text-[var(--color-text-primary)]">
                                          <MessageSquare className="w-4 h-4 text-blue-500" />
                                          รายละเอียดเพิ่มเติมที่ระบุมา ({qs.textAnswers.length})
                                        </div>
                                        <div className="space-y-2 max-h-[200px] overflow-y-auto pr-2">
                                          {qs.textAnswers.map((t, j) => (
                                            <div key={j} className="text-xs text-[var(--color-text-secondary)] bg-[var(--color-surface)] p-2 rounded-lg border border-[var(--color-border)]">
                                              {t}
                                            </div>
                                          ))}
                                        </div>
                                      </div>
                                    )}
                                  </div>
                                )}
                        
                                {qs.type === 'TEXT' && qs.textAnswers && qs.textAnswers.length > 0 && (
                                  <div>
                                    <div className="flex items-center gap-2 mb-4 text-sm font-bold text-[var(--color-text-primary)]">
                                      <MessageSquare className="w-4 h-4 text-blue-500" />
                                      ความคิดเห็น / ข้อเสนอแนะ ({qs.textAnswers.length})
                                    </div>
                                    <div className={`grid gap-3 ${expandedQs[qs.id!] ? '' : 'max-h-[300px] overflow-hidden relative'}`}>
                                      {qs.textAnswers.map((t, j) => (
                                        <div key={j} className="p-4 bg-[var(--color-surface-2)] border border-[var(--color-border)] rounded-xl text-sm text-[var(--color-text-secondary)] relative">
                                          <span className="absolute -left-1 -top-2 text-3xl text-[var(--color-text-tertiary)] opacity-40 font-serif">&quot;</span>
                                          <p className="relative z-10 pl-2">{t}</p>
                                        </div>
                                      ))}
                                      {!expandedQs[qs.id!] && qs.textAnswers.length > 4 && (
                                        <div className="absolute bottom-0 left-0 right-0 h-24 bg-gradient-to-t from-[var(--color-surface)] to-transparent flex items-end justify-center pb-2">
                                          <button onClick={() => toggleExpand(qs.id!)} className="text-xs font-bold text-blue-500 bg-[var(--color-surface)] px-4 py-2 rounded-full shadow-sm border border-[var(--color-border)] hover:bg-[var(--color-surface-2)]">
                                            แสดงความคิดเห็นทั้งหมด ({qs.textAnswers.length})
                                          </button>
                                        </div>
                                      )}
                                    </div>
                                    {expandedQs[qs.id!] && qs.textAnswers.length > 4 && (
                                      <div className="mt-4 text-center">
                                        <button onClick={() => toggleExpand(qs.id!)} className="text-xs font-bold text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]">
                                          ซ่อนความคิดเห็น
                                        </button>
                                      </div>
                                    )}
                                  </div>
                                )}
                        
                                {qs.type === 'TEXT' && (!qs.textAnswers || qs.textAnswers.length === 0) && (
                                  <div className="text-center py-6 text-[var(--color-text-tertiary)] text-sm">
                                    ไม่มีความคิดเห็นสำหรับคำถามนี้
                                  </div>
                                )}
                              </div>
                            </div>
                          )
                        })}
                      </div>
                    </div>
                  )
                })}
              </div>
            )}

            {/* Tab Content: Departments — redesigned */}
            {activeTab === 'รายแผนก' && (
              <div className="space-y-6">
                {/* Department cards */}
                {report.deptBreakdown && report.deptBreakdown.length > 0 ? (
                  <>
                    {/* Department comparison bar chart */}
                    <div className="card overflow-hidden">
                      <div className="p-5 border-b border-[var(--color-border)] bg-[var(--color-surface-2)]">
                        <h3 className="text-sm font-bold text-[var(--color-text-primary)] flex items-center gap-2">
                          <BarChart2 className="w-4 h-4 text-blue-500" />
                          เปรียบเทียบคะแนนรายแผนก
                        </h3>
                      </div>
                      <div className="p-6">
                        {report.deptBreakdown.sort((a, b) => (b.overallAvg ?? 0) - (a.overallAvg ?? 0)).map((d: DeptBreakdown, i: number) => {
                          const deptScore = d.overallAvg ? Math.round((d.overallAvg / 5) * 100) : 0
                          return (
                            <div key={i} className="mb-4 last:mb-0">
                              <div className="flex items-center justify-between mb-1.5">
                                <span className="text-sm font-semibold text-[var(--color-text-primary)]">{d.department || 'ไม่ระบุแผนก'}</span>
                                <div className="flex items-center gap-3 text-xs">
                                  <span className="text-[var(--color-text-secondary)]">{d.count} คน</span>
                                  <span className="text-[var(--color-text-secondary)]">{d.overallAvg?.toFixed(2)}/5.00</span>
                                  <span className={`font-bold ${scoreColor(deptScore)}`}>{deptScore}/100</span>
                                </div>
                              </div>
                              <div className="h-4 rounded-full bg-[var(--color-surface-2)] border border-[var(--color-border)] overflow-hidden">
                                <div
                                  className="h-full rounded-full transition-all duration-700"
                                  style={{
                                    width: `${deptScore}%`,
                                    background: deptScore >= 80 ? 'linear-gradient(90deg, #34D399, #10B981)' : deptScore >= 60 ? 'linear-gradient(90deg, #FBBF24, #F59E0B)' : 'linear-gradient(90deg, #F87171, #EF4444)',
                                  }}
                                />
                              </div>
                            </div>
                          )
                        })}
                      </div>
                    </div>

                    {/* Department detail table */}
                    <div className="card overflow-hidden border-[var(--color-border)]">
                      <div className="p-5 border-b border-[var(--color-border)] bg-[var(--color-surface-2)]">
                        <h3 className="text-sm font-bold text-[var(--color-text-primary)]">รายละเอียดรายแผนก</h3>
                      </div>
                      <table className="w-full text-left">
                        <thead>
                          <tr className="bg-[var(--color-surface-2)] border-b border-[var(--color-border)] text-xs uppercase tracking-wider text-[var(--color-text-tertiary)] font-bold">
                            <th className="px-6 py-4">แผนก / สังกัด</th>
                            <th className="px-6 py-4 text-center">จำนวนผู้ตอบกลับ</th>
                            <th className="px-6 py-4 text-center">คะแนนเฉลี่ย (Rating)</th>
                            <th className="px-6 py-4 text-center">ความพึงพอใจ (/100)</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-[var(--color-border)]">
                          {report.deptBreakdown.map((d: DeptBreakdown, i: number) => {
                            const deptScore = d.overallAvg ? Math.round((d.overallAvg / 5) * 100) : 0
                            return (
                              <tr key={i} className="hover:bg-[var(--color-surface-2)] transition-colors">
                                <td className="px-6 py-4 font-semibold text-[var(--color-text-primary)]">{d.department || 'ไม่ระบุแผนก'}</td>
                                <td className="px-6 py-4 text-center">
                                  <span className="inline-flex items-center justify-center px-3 py-1 rounded-full bg-emerald-50 text-emerald-700 font-bold text-sm">
                                    {d.count}
                                  </span>
                                </td>
                                <td className="px-6 py-4 text-center">
                                  {d.overallAvg != null ? (
                                    <div className="flex items-center justify-center gap-1.5">
                                      <Star className="w-4 h-4 text-amber-500 fill-amber-500" />
                                      <span className="font-black text-amber-600 text-base">{d.overallAvg.toFixed(2)}</span>
                                      <span className="text-xs text-[var(--color-text-tertiary)]">/5.00</span>
                                    </div>
                                  ) : (
                                    <span className="text-[var(--color-text-tertiary)]">—</span>
                                  )}
                                </td>
                                <td className="px-6 py-4 text-center">
                                  <span className={`inline-flex items-center gap-1 px-3 py-1 rounded-full text-sm font-bold ${scoreBg(deptScore)} ${scoreColor(deptScore)}`}>
                                    {deptScore}
                                    {deptScore >= 80 && <ArrowUpRight className="w-3 h-3" />}
                                  </span>
                                </td>
                              </tr>
                            )
                          })}
                        </tbody>
                      </table>
                    </div>
                  </>
                ) : (
                  <div className="card p-12 flex flex-col items-center text-center">
                    <Users className="w-10 h-10 text-[var(--color-text-tertiary)] opacity-30 mb-3" />
                    <p className="text-sm text-[var(--color-text-tertiary)]">ไม่มีข้อมูลการแบ่งตามแผนก</p>
                  </div>
                )}
              </div>
            )}
            </>)}
            </div>
          </div>
        )}
      </div>
    </SurveyLayout>
  )
}
