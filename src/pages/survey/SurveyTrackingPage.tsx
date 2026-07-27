import { confirmDialog } from '../../components/ui/confirm';
import { useState, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Search, Send, X, Clock, CheckCircle2, AlertCircle, XCircle, ChevronRight, ClipboardList, Mail } from 'lucide-react'
import surveyApi from './api'
import type { SurveyAssignment as SurveyAssignmentBase } from './types'
type SurveyAssignment = SurveyAssignmentBase & { tokenExpiresAt?: string }
import SurveyLayout from './SurveyLayout'
import PersonAvatar from '../../components/ui/avatar/PersonAvatar'

const STATUS_CFG: Record<string, { label: string; cls: string; icon: typeof Clock }> = {
  PENDING:   { label: 'รอดำเนินการ',      cls: 'badge-ghost',   icon: Clock },
  SENT:      { label: 'ส่งแล้ว',            cls: 'badge-ghost',   icon: Send },
  OPENED:    { label: 'กำลังดำเนินการ',   cls: 'badge-warning', icon: AlertCircle },
  COMPLETED: { label: 'เสร็จสิ้น',        cls: 'badge-success', icon: CheckCircle2 },
  EXPIRED:   { label: 'หมดอายุ',          cls: 'badge-error',   icon: XCircle },
  CANCELLED: { label: 'ยกเลิกแล้ว',       cls: 'badge-error',   icon: X },
}

const TABS = ['ทั้งหมด','PENDING','SENT','OPENED','COMPLETED','EXPIRED'] as const
type Tab = typeof TABS[number]

export default function SurveyTrackingPage() {
  const qc = useQueryClient()
  const [tab, setTab] = useState<Tab>('ทั้งหมด')
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState<string[]>([])
  const [msg, setMsg] = useState('')
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({})
  const [reminderSenderEmail, setReminderSenderEmail] = useState('')

  const { data: assignments = [], isLoading } = useQuery<SurveyAssignment[]>({
    queryKey: ['survey-assignments'],
    queryFn: () => surveyApi.get<SurveyAssignment[]>('/surveys/assignments/all').then((r) => r.data),
    refetchInterval: 30_000,
  })

  const { data: senders = [] } = useQuery<{ email: string; label: string }[]>({
    queryKey: ['survey-email-senders'],
    queryFn: () => surveyApi.get<{ email: string; label: string }[]>('/email/senders').then((r) => r.data),
  })

  const cancelMutation = useMutation({
    mutationFn: (id: string) => surveyApi.post(`/surveys/assignments/${id}/cancel`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['survey-assignments'] }),
  })
  const reminderMutation = useMutation<{ data: { sent?: number } }, Error, { ids: string[]; senderEmail?: string }>({
    mutationFn: ({ ids, senderEmail }) => surveyApi.post<{ sent?: number }>('/email/send-reminder', { assignmentIds: ids, senderEmail }) as Promise<{ data: { sent?: number } }>,
    onSuccess: (res) => { setMsg(`ส่งแจ้งเตือน ${res.data.sent ?? 0} คน เรียบร้อย`); setSelected([]); setTimeout(() => setMsg(''), 4000) },
    onError: () => { setMsg('ส่งอีเมลล้มเหลว'); setTimeout(() => setMsg(''), 4000) },
  })

  const deleteMutation = useMutation({
    mutationFn: (ids: string[]) => surveyApi.post('/surveys/assignments/bulk-delete', { ids }),
    onSuccess: () => { setMsg('ลบรายการที่เลือกแล้ว'); setSelected([]); setTimeout(() => setMsg(''), 4000); qc.invalidateQueries({ queryKey: ['survey-assignments'] }) },
  })

  const filtered = assignments
    .filter((a) => tab === 'ทั้งหมด' || a.status === tab)
    .filter((a) => !search || `${a.user?.firstName} ${a.user?.lastName} ${a.survey?.title}`.toLowerCase().includes(search.toLowerCase()))

  // Group filtered assignments by survey title + date
  const groups = useMemo(() => {
    const map = new Map<string, SurveyAssignment[]>()
    for (const a of filtered) {
      const dateStr = a.survey?.createdAt ? new Date(a.survey.createdAt).toLocaleDateString('th-TH', { year: 'numeric', month: 'long', day: 'numeric' }) : ''
      const key = `${dateStr ? dateStr + ' - ' : ''}${a.survey?.title ?? 'ไม่ระบุแบบประเมิน'}`
      const arr = map.get(key) ?? []
      arr.push(a)
      map.set(key, arr)
    }
    return Array.from(map.entries()).map(([title, items]) => ({
      title,
      items,
      completed: items.filter((x) => x.status === 'COMPLETED').length,
    }))
  }, [filtered])

  const toggleGroup = (title: string) =>
    setExpandedGroups((p) => ({ ...p, [title]: p[title] === false ? true : p[title] === true ? false : false }))
  const isGroupOpen = (title: string) => expandedGroups[title] !== false  // default open

  const tabCount = (t: Tab) => t === 'ทั้งหมด' ? assignments.length : assignments.filter((a) => a.status === t).length
  const toggle = (id: string) => setSelected((p) => p.includes(id) ? p.filter((x) => x !== id) : [...p, id])
  const allToggle = () => setSelected(selected.length === filtered.length && filtered.length > 0 ? [] : filtered.map((a) => a.id))

  const fmt = (d: string | undefined) => d
    ? new Date(d).toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: 'numeric' })
    : '—'

  return (
    <SurveyLayout>
      <div className="p-6">
        {/* Heading lives in AppHeader — only the bulk-action bar renders here,
            and only while rows are selected, so it takes no space otherwise. */}
        {selected.length > 0 && (
          <div className="flex items-center justify-end mb-5">
            <div className="flex items-center gap-2 flex-wrap">
              {/* Sender selector for reminders */}
              {senders.length > 0 && (
                <div className="flex items-center gap-1.5">
                  <Mail className="w-4 h-4 text-[var(--color-text-tertiary)]" />
                  <select value={reminderSenderEmail} onChange={(e) => setReminderSenderEmail(e.target.value)}
                    className="form-input text-xs py-1.5 min-w-[200px] max-w-full border-[var(--color-border)]">
                    {senders.map((s: { email: string; label: string }) => <option key={s.email} value={s.email}>{s.label}</option>)}
                  </select>
                </div>
              )}
              <button onClick={() => { confirmDialog('ยืนยันการลบรายการที่เลือก?').then(ok => { if (ok) deleteMutation.mutate(selected); }) }} disabled={deleteMutation.isPending}
                className="btn btn-danger gap-2">
                <X className="w-4 h-4" />ลบ {selected.length} รายการ
              </button>
              {selected.filter(id => assignments.find(a => a.id === id)?.status !== 'COMPLETED').length > 0 && (
                <button onClick={() => {
                  const remindIds = selected.filter(id => assignments.find(a => a.id === id)?.status !== 'COMPLETED');
                  reminderMutation.mutate({ ids: remindIds, senderEmail: reminderSenderEmail || undefined });
                }} disabled={reminderMutation.isPending}
                  className="btn btn-primary gap-2">
                  <Send className="w-4 h-4" />แจ้งเตือน {selected.filter(id => assignments.find(a => a.id === id)?.status !== 'COMPLETED').length} คน{reminderMutation.isPending ? '...' : ''}
                </button>
              )}
            </div>
          </div>
        )}

        {msg &&<div className="mb-4 px-4 py-3 bg-emerald-50 text-emerald-700 rounded-xl border border-emerald-200 text-sm font-medium">{msg}</div>}

        <div className="flex flex-wrap items-center gap-3 mb-4">
          <div className="relative min-w-52 flex-1 max-w-64">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--color-text-tertiary)]" />
            <input style={{ paddingLeft: '2.5rem' }} value={search} onChange={(e) => setSearch(e.target.value)} placeholder="ค้นหาชื่อ / แบบประเมิน..." className="form-input" />
          </div>
          <div className="flex gap-1 bg-[var(--color-surface-2)] rounded-xl p-1 border border-[var(--color-border)]">
            {TABS.map((t) => (
              <button key={t} onClick={() => setTab(t)}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all whitespace-nowrap ${tab === t ? 'bg-[var(--color-surface)] shadow-sm text-[var(--color-text-primary)] border border-[var(--color-border)]' : 'text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]'}`}>
                {t === 'ทั้งหมด' ? t : STATUS_CFG[t]?.label ?? t}
                <span className="ml-1 opacity-60">({tabCount(t)})</span>
              </button>
            ))}
          </div>
        </div>

        {/* Global select-all bar */}
        {filtered.length > 0 && (
          <div className="flex items-center gap-3 mb-2 px-2">
            <input type="checkbox" checked={filtered.length > 0 && selected.length === filtered.length}
              onChange={allToggle} className="w-4 h-4 accent-blue-600" />
            <span className="text-xs text-[var(--color-text-secondary)]">
              {selected.length > 0 ? `เลือกแล้ว ${selected.length} / ${filtered.length} รายการ` : `เลือกทั้งหมด ${filtered.length} รายการ`}
            </span>
          </div>
        )}

        {isLoading ? (
          <div className="card p-8 text-center">
            <div className="w-7 h-7 border-4 border-blue-200 border-t-blue-600 rounded-full animate-spin mx-auto mb-3" />
            <p className="text-sm text-[var(--color-text-secondary)]">กำลังโหลด...</p>
          </div>
        ) : groups.length === 0 ? (
          <div className="card py-14 text-center">
            <ClipboardList className="w-10 h-10 text-[var(--color-text-tertiary)] mx-auto mb-3" />
            <p className="text-sm text-[var(--color-text-tertiary)]">ไม่พบรายการ</p>
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            {groups.map(({ title, items, completed }) => {
              const open = isGroupOpen(title)
              return (
                <div key={title} className="card overflow-hidden">
                  {/* Group Header */}
                  <button
                    onClick={() => toggleGroup(title)}
                    className="w-full flex items-center gap-3 px-4 py-3 bg-[var(--color-surface-2)] border-b border-[var(--color-border)] hover:bg-[var(--color-surface)] transition-colors text-left"
                  >
                    <ChevronRight className={`w-4 h-4 text-[var(--color-text-tertiary)] flex-shrink-0 transition-transform ${open ? 'rotate-90' : ''}`} />
                    <ClipboardList className="w-4 h-4 text-blue-500 flex-shrink-0" />
                    <span className="font-bold text-sm text-[var(--color-text-primary)] flex-1 truncate">{title}</span>
                    <span className="text-xs text-[var(--color-text-tertiary)] flex-shrink-0">
                      {completed}/{items.length} เสร็จสิ้น
                    </span>
                    <div className="flex-shrink-0 flex items-center gap-1">
                      <div className="w-16 h-1.5 bg-[var(--color-border)] rounded-full overflow-hidden">
                        <div className="h-full bg-emerald-500 rounded-full transition-all"
                          style={{ width: `${items.length > 0 ? (completed / items.length) * 100 : 0}%` }} />
                      </div>
                    </div>
                  </button>

                  {/* Group Table */}
                  {open && (
                    <table className="w-full">
                      <thead>
                        <tr className="border-b border-[var(--color-border)] bg-[var(--color-surface-2)]">
                          <th className="table-th w-10">
                            <input type="checkbox"
                              checked={items.length > 0 && items.every((a) => selected.includes(a.id))}
                              onChange={() => {
                                const ids = items.map((a) => a.id)
                                const allIn = ids.every((id) => selected.includes(id))
                                setSelected((p) => allIn ? p.filter((id) => !ids.includes(id)) : [...new Set([...p, ...ids])])
                              }}
                              className="w-4 h-4 accent-blue-600" />
                          </th>
                          <th className="table-th">พนักงาน</th>
                          <th className="table-th text-center">สถานะ</th>
                          <th className="table-th">มอบหมายวันที่</th>
                          <th className="table-th">ครบกำหนด</th>
                          <th className="table-th text-center">จัดการ</th>
                        </tr>
                      </thead>
                      <tbody>
                        {items.map((a) => {
                          const cfg = STATUS_CFG[a.status] ?? { label: a.status, cls: 'badge-ghost', icon: Clock }
                          const StatusIcon = cfg.icon
                          const dueDate = a.displayExpiresAt ?? a.tokenExpiresAt
                          const isOverdue = dueDate && new Date(dueDate) < new Date() && a.status !== 'COMPLETED'
                          return (
                            <tr key={a.id} className="border-b border-[var(--color-border)] hover:bg-[var(--color-surface-2)] transition-colors">
                              <td className="table-td">
                                <input type="checkbox" checked={selected.includes(a.id)} onChange={() => toggle(a.id)} className="w-4 h-4 accent-blue-600" />
                              </td>
                              <td className="table-td">
                                <div className="flex items-center gap-2.5">
                                  <PersonAvatar name={a.user ? `${a.user.firstName} ${a.user.lastName ?? ''}`.trim() : '?'} colorKey={a.user?.email || a.id} size="md" />
                                  <div className="min-w-0">
                                    <p className="text-sm font-semibold text-[var(--color-text-primary)] truncate">
                                      {a.user ? `${a.user.firstName} ${a.user.lastName}` : '—'}
                                    </p>
                                    <p className="text-xs text-[var(--color-text-tertiary)] truncate">{a.user?.department || a.user?.email || ''}</p>
                                  </div>
                                </div>
                              </td>
                              <td className="table-td text-center">
                                <span className={`badge ${cfg.cls} gap-1`}>
                                  <StatusIcon className="w-3 h-3" />{cfg.label}
                                </span>
                              </td>
                              <td className="table-td">
                                <span className="text-sm text-[var(--color-text-secondary)]">{fmt(a.assignedAt)}</span>
                              </td>
                              <td className="table-td">
                                {dueDate ? (
                                  <span className={`text-sm font-medium ${isOverdue ? 'text-red-500' : 'text-[var(--color-text-secondary)]'}`}>
                                    {fmt(dueDate)}
                                  </span>
                                ) : <span className="text-[var(--color-text-tertiary)]">—</span>}
                              </td>
                              <td className="table-td text-center">
                                {(a.status === 'PENDING' || a.status === 'OPENED') && (
                                  <button onClick={() => { confirmDialog('ยกเลิกการมอบหมายนี้?').then(ok => { if (ok) cancelMutation.mutate(a.id); }) }}
                                    className="btn-icon w-7 h-7 text-red-400 hover:bg-red-50 hover:text-red-600 rounded-lg transition-colors">
                                    <X className="w-3.5 h-3.5" />
                                  </button>
                                )}
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </SurveyLayout>
  )
}
