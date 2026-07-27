import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Activity, User, ClipboardList, Send, CheckCircle2, Trash2, X, Mail } from 'lucide-react'
import surveyApi from './api'
import type { AuditLog } from './types'
import SurveyLayout from './SurveyLayout'

const ACTION_CFG: Record<string, { label: string; icon: typeof Activity; color: string; bg: string }> = {
  SURVEY_CREATE:      { label: 'สร้างแบบประเมิน',      icon: ClipboardList, color: 'text-violet-600', bg: 'bg-violet-100' },
  SURVEY_PUBLISH:     { label: 'เผยแพร่แบบประเมิน',   icon: Activity,      color: 'text-blue-600',   bg: 'bg-blue-100' },
  SURVEY_ASSIGN:      { label: 'มอบหมายแบบประเมิน',   icon: Send,          color: 'text-blue-600', bg: 'bg-blue-100' },
  SURVEY_SUBMIT:      { label: 'ตอบแบบประเมินแล้ว',   icon: CheckCircle2,  color: 'text-emerald-600',bg: 'bg-emerald-100' },
  SURVEY_DELETE:      { label: 'ลบแบบประเมิน',          icon: Trash2,        color: 'text-red-500',    bg: 'bg-red-100' },
  SURVEY_CANCEL:      { label: 'ยกเลิกการมอบหมาย',    icon: X,             color: 'text-orange-500', bg: 'bg-orange-100' },
  EMAIL_SENT:         { label: 'ส่งอีเมลแจ้งเตือน',    icon: Mail,          color: 'text-sky-600',    bg: 'bg-sky-100' },
  USER_CREATED:       { label: 'เพิ่มพนักงานเข้าระบบ', icon: User,          color: 'text-teal-600',   bg: 'bg-teal-100' },
  USER_DEACTIVATED:   { label: 'ยกเลิกบัญชีพนักงาน',  icon: X,             color: 'text-gray-500',   bg: 'bg-gray-100' },
}

const GROUPS = ['ทั้งหมด', 'แบบประเมิน', 'การมอบหมาย', 'การตอบ', 'อื่น ๆ'] as const
const GROUP_ACTIONS: Record<string, string[]> = {
  'แบบประเมิน': ['SURVEY_CREATE','SURVEY_PUBLISH','SURVEY_DELETE'],
  'การมอบหมาย': ['SURVEY_ASSIGN','SURVEY_CANCEL'],
  'การตอบ': ['SURVEY_SUBMIT'],
  'อื่น ๆ': ['EMAIL_SENT','USER_CREATED','USER_DEACTIVATED'],
}

function formatDetails(action: string, metadata: unknown): string {
  if (!metadata) return ''
  if (typeof metadata === 'string') return metadata
  const d = metadata as Record<string, unknown>
  if (action === 'SURVEY_ASSIGN') {
    const sent = d.sent ?? 0
    const skipped = d.skipped ?? 0
    return `ส่งสำเร็จ ${sent} คน${Number(skipped) > 0 ? ` · ข้ามซ้ำ ${skipped} คน` : ''}`
  }
  if (action === 'USER_CREATED') return `เพิ่ม ${d.name ?? d.email ?? ''}`
  return Object.entries(d).map(([k, v]) => `${k}: ${v}`).join(' · ')
}

function timeAgo(date: string) {
  const diff = Date.now() - new Date(date).getTime()
  const m = Math.floor(diff / 60000)
  if (m < 1) return 'เมื่อกี้'
  if (m < 60) return `${m} นาทีที่แล้ว`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h} ชั่วโมงที่แล้ว`
  return new Date(date).toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: 'numeric' })
}

export default function SurveyActivityPage() {
  const [group, setGroup] = useState<typeof GROUPS[number]>('ทั้งหมด')

  const { data: logs = [], isLoading } = useQuery<AuditLog[]>({
    queryKey: ['audit-logs'],
    queryFn: () => surveyApi.get<{ logs: AuditLog[]; total: number }>('/audit').then((r) => r.data.logs),
    refetchInterval: 30_000,
  })

  const filtered = group === 'ทั้งหมด' ? logs
    : logs.filter((l) => GROUP_ACTIONS[group]?.includes(l.action))

  // Group by date
  const byDate: Record<string, AuditLog[]> = {}
  filtered.forEach((l) => {
    const day = new Date(l.createdAt).toLocaleDateString('th-TH', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
    if (!byDate[day]) byDate[day] = []
    byDate[day].push(l)
  })

  return (
    <SurveyLayout>
      <div className="p-6">
        <div className="mb-5">
          <h1 className="text-2xl font-black text-[var(--color-text-primary)]">กิจกรรม</h1>
          <p className="text-sm text-[var(--color-text-secondary)] mt-1">ประวัติการใช้งานระบบทั้งหมด</p>
        </div>

        {/* Filter */}
        <div className="flex gap-1 bg-[var(--color-surface-2)] rounded-xl p-1 border border-[var(--color-border)] mb-6 flex-wrap">
          {GROUPS.map((g) => (
            <button key={g} onClick={() => setGroup(g)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${group === g ? 'bg-[var(--color-surface)] shadow-sm text-[var(--color-text-primary)] border border-[var(--color-border)]' : 'text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]'}`}>
              {g}
            </button>
          ))}
        </div>

        {isLoading && (
          <div className="space-y-3">{[...Array(5)].map((_, i) => (
            <div key={i} className="card p-4 flex gap-3 animate-pulse">
              <div className="w-8 h-8 rounded-full bg-[var(--color-surface-2)]" />
              <div className="flex-1 space-y-2"><div className="h-3 bg-[var(--color-surface-2)] rounded w-3/4" /><div className="h-2 bg-[var(--color-surface-2)] rounded w-1/2" /></div>
            </div>
          ))}</div>
        )}

        {!isLoading && filtered.length === 0 && (
          <div className="card py-16 flex flex-col items-center text-[var(--color-text-tertiary)]">
            <Activity className="w-10 h-10 mb-3 opacity-20" />
            <p className="text-sm font-medium">ยังไม่มีกิจกรรม</p>
          </div>
        )}

        {!isLoading && Object.entries(byDate).map(([day, dayLogs]) => (
          <div key={day} className="mb-6">
            <div className="flex items-center gap-3 mb-3">
              <div className="text-xs font-bold text-[var(--color-text-tertiary)] uppercase tracking-wider">{day}</div>
              <div className="flex-1 h-px bg-[var(--color-border)]" />
              <span className="text-xs text-[var(--color-text-tertiary)] badge badge-ghost">{dayLogs.length}</span>
            </div>
            <div className="space-y-2">
              {dayLogs.map((log, i) => {
                        const cfg = ACTION_CFG[log.action] ?? { label: log.action, icon: Activity, color: 'text-gray-500', bg: 'bg-gray-100' }
                const Icon = cfg.icon
                const detailText = formatDetails(log.action, log.metadata ?? log.details)
                return (
                  <div key={log.id ?? i} className="card p-4 flex items-start gap-3 hover:shadow-md transition-shadow">
                    <div className={`w-9 h-9 rounded-xl ${cfg.bg} flex items-center justify-center flex-shrink-0`}>
                      <Icon className={`w-4 h-4 ${cfg.color}`} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <span className="text-sm font-semibold text-[var(--color-text-primary)]">
                            {log.user ? `${log.user.firstName} ${log.user.lastName}` : 'ระบบ'}
                          </span>
                          <span className="text-sm text-[var(--color-text-secondary)]"> {cfg.label}</span>
                          {detailText && <p className="text-xs text-[var(--color-text-tertiary)] mt-0.5 truncate">{detailText}</p>}
                        </div>
                        <span className="text-xs text-[var(--color-text-tertiary)] flex-shrink-0 mt-0.5">{timeAgo(log.createdAt)}</span>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        ))}
      </div>
    </SurveyLayout>
  )
}
