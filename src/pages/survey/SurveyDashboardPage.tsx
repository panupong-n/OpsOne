import { useEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { TrendingUp, Users, ClipboardList, CheckCircle2, Clock, AlertCircle, ArrowRight } from 'lucide-react'
import surveyApi from './api'
import type { DashboardStats, SurveyCompletionItem, AuditLog } from './types'
import SurveyLayout from './SurveyLayout'
import { thaiDate } from './utils'

const actionLabels: Record<string, string> = {
  SURVEY_CREATE: 'สร้างแบบประเมิน',
  SURVEY_PUBLISH: 'เผยแพร่แบบประเมิน',
  SURVEY_ASSIGN: 'มอบหมายแบบประเมิน',
  SURVEY_SUBMIT: 'ส่งคำตอบแล้ว',
  SURVEY_DELETE: 'ลบแบบประเมิน',
  SURVEY_CANCEL: 'ยกเลิกการมอบหมาย',
  USER_CREATED: 'เพิ่มพนักงาน',
  USER_DEACTIVATED: 'ปิดใช้งานพนักงาน',
  // legacy keys
  SURVEY_CREATED: 'สร้างแบบประเมิน',
  SURVEY_PUBLISHED: 'เผยแพร่แบบประเมิน',
  ASSIGNMENT_CREATED: 'มอบหมายแบบประเมิน',
  RESPONSE_SUBMITTED: 'ส่งคำตอบแล้ว',
  SURVEY_DELETED: 'ลบแบบประเมิน',
  ASSIGNMENT_CANCELLED: 'ยกเลิกการมอบหมาย',
  EMAIL_SENT: 'ส่งอีเมล',
}

function DonutChart({ completed, pending, opened, expired }: { completed: number; pending: number; opened: number; expired: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const total = completed + pending + opened + expired

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const dpr = window.devicePixelRatio || 1
    const size = 160
    canvas.width = size * dpr; canvas.height = size * dpr
    canvas.style.width = `${size}px`; canvas.style.height = `${size}px`
    ctx.scale(dpr, dpr)
    const cx = size / 2, cy = size / 2
    if (total === 0) {
      ctx.beginPath(); ctx.arc(cx, cy, 60, 0, Math.PI * 2)
      ctx.strokeStyle = '#E2E8F0'; ctx.lineWidth = 16; ctx.stroke()
      ctx.fillStyle = '#94A3B8'; ctx.font = 'bold 13px Inter,sans-serif'
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
      ctx.fillText('ไม่มีข้อมูล', cx, cy); return
    }
    const segments = [
      { value: completed, color: '#10B981' },
      { value: opened, color: '#F59E0B' },
      { value: pending, color: '#3B82F6' },
      { value: expired, color: '#EF4444' },
    ]
    let start = -Math.PI / 2
    for (const seg of segments) {
      if (seg.value === 0) continue
      const angle = (seg.value / total) * Math.PI * 2
      ctx.beginPath(); ctx.arc(cx, cy, 60, start, start + angle)
      ctx.arc(cx, cy, 44, start + angle, start, true)
      ctx.closePath(); ctx.fillStyle = seg.color; ctx.fill()
      start += angle
    }
    const pct = Math.round((completed / total) * 100)
    ctx.fillStyle = '#0F172A'; ctx.font = 'bold 22px Inter,sans-serif'
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
    ctx.fillText(`${pct}%`, cx, cy - 8)
    ctx.fillStyle = '#64748B'; ctx.font = '11px Inter,sans-serif'
    ctx.fillText('เสร็จสิ้น', cx, cy + 10)
  }, [completed, pending, opened, expired, total])

  return <canvas ref={canvasRef} />
}

function GaugeChart({ percent }: { percent: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const dpr = window.devicePixelRatio || 1
    const size = 160
    canvas.width = size * dpr; canvas.height = size * dpr
    canvas.style.width = `${size}px`; canvas.style.height = `${size}px`
    ctx.scale(dpr, dpr)
    const cx = size / 2, cy = size / 2
    
    // Background circle
    ctx.beginPath(); ctx.arc(cx, cy, 60, 0, Math.PI * 2)
    ctx.strokeStyle = '#E2E8F0'; ctx.lineWidth = 16; ctx.stroke()

    // Foreground arc
    if (percent > 0) {
      const angle = (percent / 100) * Math.PI * 2
      ctx.beginPath(); ctx.arc(cx, cy, 60, -Math.PI / 2, -Math.PI / 2 + angle)
      ctx.strokeStyle = percent >= 80 ? '#10B981' : percent >= 50 ? '#F59E0B' : '#EF4444'
      ctx.lineWidth = 16; ctx.lineCap = 'round'; ctx.stroke()
    }
    
    ctx.fillStyle = '#0F172A'; ctx.font = 'bold 28px Inter,sans-serif'
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
    ctx.fillText(`${percent}%`, cx, cy)
  }, [percent])

  return <canvas ref={canvasRef} />
}

export default function SurveyDashboardPage() {
  const [selectedSurveyId, setSelectedSurveyId] = useState<string>('')
  const navigate = useNavigate()
  const { data: stats, isLoading } = useQuery<DashboardStats>({
    queryKey: ['survey-stats'],
    queryFn: () => surveyApi.get<DashboardStats>('/dashboard/stats').then((r) => r.data),
    refetchInterval: 60_000,
  })
  const { data: completion = [] } = useQuery<SurveyCompletionItem[]>({
    queryKey: ['survey-completion'],
    queryFn: () => surveyApi.get<SurveyCompletionItem[]>('/dashboard/survey-completion').then((r) => r.data),
  })
  const { data: activity = [] } = useQuery<AuditLog[]>({
    queryKey: ['survey-activity'],
    queryFn: () => surveyApi.get<AuditLog[]>('/dashboard/recent-activity').then((r) => r.data),
  })

  useEffect(() => {
    if (completion.length > 0 && selectedSurveyId === '') {
      setSelectedSurveyId(completion[0].id)
    }
  }, [completion, selectedSurveyId])

  // Compute donut chart values based on selectedSurveyId
  const donutData = (() => {
    const bySurvey = stats?.completionBySurvey?.[selectedSurveyId]
    if (bySurvey) {
      return bySurvey
    }
    return { completed: 0, pending: 0, opened: 0, expired: 0 }
  })()

  const donutTotal = donutData.completed + donutData.pending + donutData.opened + donutData.expired
  const donutRate = donutTotal > 0 ? Math.round((donutData.completed / donutTotal) * 100) : 0

  // Compute satisfaction based on selectedSurveyId
  const satisfactionValue = stats?.satisfactionBySurvey?.[selectedSurveyId] ?? 0

  const statCards = [
    { label: 'พนักงาน', value: stats?.totalUsers ?? 0, icon: Users, color: 'from-blue-500 to-blue-600', bg: 'bg-blue-50', text: 'text-blue-600' },
    { label: 'แบบประเมิน', value: stats?.totalSurveys ?? 0, icon: ClipboardList, color: 'from-blue-400 to-blue-500', bg: 'bg-blue-50', text: 'text-blue-600' },
    { label: 'เสร็จสิ้น', value: stats?.completed ?? 0, icon: CheckCircle2, color: 'from-emerald-500 to-green-600', bg: 'bg-emerald-50', text: 'text-emerald-600' },
    { label: 'รอดำเนินการ', value: stats?.pending ?? 0, icon: Clock, color: 'from-amber-500 to-orange-500', bg: 'bg-amber-50', text: 'text-amber-600' },
  ]

  return (
    <SurveyLayout>
      <div className="p-6 space-y-6">
        {/* Heading lives in AppHeader; "สร้างแบบประเมิน" lives on the แบบประเมิน page. */}

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {statCards.map((s) => (
            <div key={s.label} className="card p-5 relative overflow-hidden">
              <div className={`absolute -right-3 -top-3 w-16 h-16 rounded-full ${s.bg} opacity-60`} />
              <div className={`w-10 h-10 rounded-xl bg-gradient-to-br ${s.color} flex items-center justify-center shadow-md mb-3`}>
                <s.icon className="w-5 h-5 text-white" />
              </div>
              <div className={`text-3xl font-black ${s.text}`}>
                {isLoading ? <span className="skeleton inline-block w-10 h-7 rounded bg-gray-200" /> : s.value.toLocaleString()}
              </div>
              <p className="text-xs text-[var(--color-text-secondary)] font-semibold mt-1">{s.label}</p>
            </div>
          ))}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
          <div className="card p-5">
            <div className="flex items-center justify-between mb-4">
              <div>
                <p className="text-[13px] font-bold text-[var(--color-text-primary)]">อัตราการตอบรับ</p>
                <p className="text-xs text-[var(--color-text-tertiary)]">
                  {completion.find(c => c.id === selectedSurveyId)?.title ?? 'แบบประเมินที่เลือก'}
                </p>
              </div>
              <span className="badge badge-success">{donutRate}%</span>
            </div>
            <div className="flex items-center justify-center mb-4">
              <DonutChart
                completed={donutData.completed}
                pending={donutData.pending}
                opened={donutData.opened}
                expired={donutData.expired}
              />
            </div>
            <div className="grid grid-cols-2 gap-2 text-xs">
              {[
                { label: 'เสร็จสิ้น', value: donutData.completed, color: 'bg-emerald-500' },
                { label: 'กำลังดำเนินการ', value: donutData.opened, color: 'bg-amber-400' },
                { label: 'รอดำเนินการ', value: donutData.pending, color: 'bg-blue-400' },
                { label: 'หมดอายุ', value: donutData.expired, color: 'bg-red-400' },
              ].map((item) => (
                <div key={item.label} className="flex items-center gap-2">
                  <div className={`w-2 h-2 rounded-full ${item.color} flex-shrink-0`} />
                  <span className="text-[var(--color-text-secondary)] truncate">{item.label}</span>
                  <span className="font-bold text-[var(--color-text-primary)] ml-auto">{item.value}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="card p-5">
            <div className="flex flex-col gap-2 mb-4">
              <p className="text-[13px] font-bold text-[var(--color-text-primary)]">ความพึงพอใจ</p>
              <p className="text-xs text-[var(--color-text-tertiary)]">
                {completion.find(c => c.id === selectedSurveyId)?.title ?? 'แบบประเมินที่เลือก'}
              </p>
            </div>
            <div className="flex items-center justify-center mb-6 mt-2">
              <GaugeChart percent={satisfactionValue} />
            </div>
            <div className="text-center text-xs text-[var(--color-text-secondary)] bg-[var(--color-surface-2)] p-3 rounded-lg border border-[var(--color-border)]">
              คะแนนความพึงพอใจเฉลี่ย (เต็ม 100 คะแนน)
              <br/>คำนวณจากคะแนน Rating ทุกข้อ
            </div>
          </div>

          <div className="card p-5 col-span-2">
            <div className="flex items-center justify-between mb-4">
              <div>
                <p className="text-[13px] font-bold text-[var(--color-text-primary)]">สถานะแต่ละแบบประเมิน</p>
                <p className="text-xs text-[var(--color-text-tertiary)]">คลิกเพื่อดูรายละเอียด ความพึงพอใจ และอัตราการตอบรับ</p>
              </div>
              <button onClick={() => navigate('/survey/surveys')} className="flex items-center gap-1 text-xs text-[var(--color-primary)] hover:underline font-semibold">
                ดูทั้งหมด <ArrowRight className="w-3 h-3" />
              </button>
            </div>
            {completion.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-10 text-[var(--color-text-tertiary)]">
                <ClipboardList className="w-10 h-10 mb-2 opacity-20" />
                <p className="text-sm">ยังไม่มีแบบประเมินที่เผยแพร่</p>
              </div>
            ) : (
              <div className="space-y-4">
                {completion.slice(0, 5).map((item) => (
                  <div
                    key={item.id}
                    className={`cursor-pointer rounded-xl p-3 transition-all border-2 ${selectedSurveyId === item.id ? 'border-blue-400 bg-blue-50/50' : 'border-transparent hover:bg-[var(--color-surface-2)]'}`}
                    onClick={() => setSelectedSurveyId(selectedSurveyId === item.id ? 'all' : item.id)}
                  >
                    <div className="flex items-center justify-between mb-1.5">
                      <div className="flex-1 mr-3 min-w-0">
                        <p className="text-sm font-semibold text-[var(--color-text-primary)] truncate">{item.title}</p>
                        {item.createdAt && (
                          <p className="text-[11px] text-[var(--color-text-tertiary)] mt-0.5">
                            📅 {thaiDate(item.createdAt)}
                          </p>
                        )}
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        <span className="text-xs text-[var(--color-text-secondary)]">{item.completed}/{item.total}</span>
                        <span className={`badge text-[10px] ${item.rate >= 80 ? 'badge-success' : item.rate >= 50 ? 'badge-warning' : 'badge-ghost'}`}>
                          {item.rate}%
                        </span>
                      </div>
                    </div>
                    <div className="h-2 rounded-full bg-[var(--color-surface-2)] border border-[var(--color-border)] overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all duration-700 ${item.rate >= 80 ? 'bg-gradient-to-r from-emerald-400 to-green-500' : item.rate >= 50 ? 'bg-gradient-to-r from-amber-400 to-orange-400' : 'bg-gradient-to-r from-blue-400 to-blue-500'}`}
                        style={{ width: `${item.rate}%` }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="card p-5 bg-gradient-to-br from-blue-600 to-blue-700 border-0 text-white">
            <div className="flex items-center gap-2 mb-4">
              <TrendingUp className="w-4 h-4 opacity-80" />
              <p className="text-[13px] font-bold opacity-90">เดือนนี้</p>
            </div>
            <div className="text-5xl font-black mb-1">{stats?.completedThisMonth ?? 0}</div>
            <p className="text-sm opacity-70">แบบประเมินเสร็จสิ้น</p>
            <div className="mt-4 pt-4 border-t border-white/20 grid grid-cols-2 gap-3">
              <div>
                <div className="text-xl font-bold">{stats?.totalAssigned ?? 0}</div>
                <div className="text-xs opacity-60 mt-0.5">มอบหมายทั้งหมด</div>
              </div>
              <div>
                <div className="text-xl font-bold">{stats?.completionRate ?? 0}%</div>
                <div className="text-xs opacity-60 mt-0.5">อัตราตอบกลับ</div>
              </div>
            </div>
          </div>

          <div className="card col-span-2 overflow-hidden">
            <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--color-border)]">
              <p className="text-[13px] font-bold text-[var(--color-text-primary)]">กิจกรรมล่าสุด</p>
              <button onClick={() => navigate('/survey/activity')} className="flex items-center gap-1 text-xs text-[var(--color-primary)] hover:underline font-semibold">
                ดูทั้งหมด <ArrowRight className="w-3 h-3" />
              </button>
            </div>
            <div className="divide-y divide-[var(--color-border)]">
              {activity.length === 0 && (
                <div className="py-10 text-center text-sm text-[var(--color-text-tertiary)]">ยังไม่มีกิจกรรม</div>
              )}
              {activity.slice(0, 5).map((log, i) => (
                <div key={log.id ?? i} className="flex items-start gap-3 px-5 py-3">
                  <div className="w-7 h-7 rounded-full bg-[var(--color-primary-soft)] flex items-center justify-center flex-shrink-0 mt-0.5">
                    <AlertCircle className="w-3.5 h-3.5 text-[var(--color-primary)]" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-[var(--color-text-primary)] font-medium">
                      {log.user ? `${log.user.firstName} ${log.user.lastName}` : 'ระบบ'}
                      <span className="text-[var(--color-text-secondary)] font-normal"> — {actionLabels[log.action] || log.action}</span>
                    </p>
                    <p className="text-xs text-[var(--color-text-tertiary)] mt-0.5">
                      {(() => {
                        const d = new Date((log as unknown as Record<string, string>).createdAt || (log as unknown as Record<string, string>).created_at)
                        return isNaN(d.getTime()) ? '—' : `${d.toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: 'numeric' })} · ${d.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' })}`
                      })()}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </SurveyLayout>
  )
}
