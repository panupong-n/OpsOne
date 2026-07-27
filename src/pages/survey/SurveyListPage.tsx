import { confirmDialog } from '../../components/ui/confirm';
import { useState, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { DatePicker } from 'antd'
import dayjs from 'dayjs'
import { useAuth } from '../../context/AuthContext'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, Eye, Edit3, Trash2, Send, Search, Filter, Mail, Copy } from 'lucide-react'
import surveyApi from './api'
import type { Survey, SurveyUser } from './types'
import SurveyLayout from './SurveyLayout'
import PersonAvatar from '../../components/ui/avatar/PersonAvatar'
import { Modal } from '../../components/ui/modal'

const STATUS_CFG: Record<string, { label: string; cls: string; dot: string }> = {
  DRAFT:     { label: 'ร่าง',         cls: 'badge-ghost',   dot: 'bg-slate-400' },
  PUBLISHED: { label: 'เผยแพร่แล้ว', cls: 'badge-success', dot: 'bg-emerald-500' },
  ARCHIVED:  { label: 'เก็บถาวร',    cls: 'badge-warning', dot: 'bg-amber-500' },
}

const TABS = ['ทั้งหมด','DRAFT','PUBLISHED','ARCHIVED'] as const
type Tab = typeof TABS[number]

export default function SurveyListPage() {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const [tab, setTab] = useState<Tab>('ทั้งหมด')
  const [search, setSearch] = useState('')
  const [copyModal, setCopyModal] = useState<{ id: string; title: string; createdAt: string } | null>(null)
  const [assignModal, setAssignModal] = useState<Survey | null>(null)
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [assignMsg, setAssignMsg] = useState('')
  const [assignDeptFilter, setAssignDeptFilter] = useState('')
  const [assignCustomDate, setAssignCustomDate] = useState('')
  const [assignSenderEmail, setAssignSenderEmail] = useState('')
  const { user } = useAuth()
  const isPanupong = user?.name?.includes('Panupong Nijjaboon') || user?.email?.toLowerCase().includes('panupong')

  const { data: surveys = [], isLoading } = useQuery<Survey[]>({
    queryKey: ['surveys'],
    queryFn: () => surveyApi.get<Survey[]>('/surveys').then((r) => r.data),
  })
  const { data: users = [] } = useQuery<SurveyUser[]>({
    queryKey: ['survey-users-all'],
    queryFn: () => surveyApi.get<SurveyUser[]>('/users').then((r) => r.data),
    enabled: !!assignModal,
  })
  const { data: senders = [] } = useQuery<{ email: string; label: string }[]>({
    queryKey: ['survey-email-senders'],
    queryFn: () => surveyApi.get<{ email: string; label: string }[]>('/email/senders').then((r) => r.data),
    enabled: !!assignModal,
  })

  const publishMutation = useMutation({
    mutationFn: (id: string) => surveyApi.post(`/surveys/${id}/publish`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['surveys'] }),
  })
  const deleteMutation = useMutation({
    mutationFn: (id: string) => surveyApi.delete(`/surveys/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['surveys'] }),
  })
  const duplicateMutation = useMutation({
    mutationFn: (data: { id: string; title: string; createdAt: string }) => surveyApi.post(`/surveys/${data.id}/duplicate`, { title: data.title, createdAt: data.createdAt }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['surveys'] }); setCopyModal(null) },
  })
  const assignMutation = useMutation<{ data: { message?: string } }, Error, { id: string; userIds: string[]; customDate?: string; senderEmail?: string }>({
    mutationFn: ({ id, userIds, customDate, senderEmail }) => surveyApi.post<{ message?: string }>(`/surveys/${id}/assign`, { userIds, customDate, senderEmail }) as Promise<{ data: { message?: string } }>,
    onSuccess: (res) => { setAssignMsg(res.data.message ?? 'มอบหมายสำเร็จ'); qc.invalidateQueries({ queryKey: ['surveys'] }); setTimeout(() => { setAssignModal(null); setSelectedIds([]); setAssignMsg(''); setAssignCustomDate(''); setAssignSenderEmail('') }, 2500) },
    onError: (e: unknown) => setAssignMsg((e as { response?: { data?: { error?: string } } })?.response?.data?.error || 'เกิดข้อผิดพลาด'),
  })

  const filtered = surveys
    .filter((s) => tab === 'ทั้งหมด' || s.status === tab)
    .filter((s) => !search || s.title.toLowerCase().includes(search.toLowerCase()))

  const activeUsers = users.filter((u) => u.isActive)
  const assignDepartments = useMemo(() => [...new Set(activeUsers.map((u) => u.department).filter(Boolean) as string[])].sort(), [activeUsers])
  const assignFilteredUsers = activeUsers.filter((u) => !assignDeptFilter || u.department === assignDeptFilter)
  const toggle = (id: string) => setSelectedIds((p) => p.includes(id) ? p.filter((x) => x !== id) : [...p, id])
  const tabCount = (t: Tab) => t === 'ทั้งหมด' ? surveys.length : surveys.filter((s) => s.status === t).length

  return (
    <SurveyLayout>
      <div className="p-6">
        {/* Heading lives in AppHeader — the create action moved into the toolbar below. */}

        {/* Search + tabs + create */}
        <div className="flex flex-wrap items-center gap-3 mb-5">
          <div className="relative flex-1 min-w-48 max-w-64">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--color-text-tertiary)]" />
            <input style={{ paddingLeft: '2.5rem' }} value={search} onChange={(e) => setSearch(e.target.value)} placeholder="ค้นหาแบบประเมิน..." className="form-input" />
          </div>
          <div className="flex gap-1 bg-[var(--color-surface-2)] rounded-xl p-1 border border-[var(--color-border)]">
            {TABS.map((t) => (
              <button key={t} onClick={() => setTab(t)}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${tab === t ? 'bg-[var(--color-surface)] shadow-sm text-[var(--color-text-primary)] border border-[var(--color-border)]' : 'text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]'}`}>
                {t === 'ทั้งหมด' ? t : STATUS_CFG[t].label} <span className="ml-1 opacity-60">({tabCount(t)})</span>
              </button>
            ))}
          </div>
          <button onClick={() => navigate('/survey/surveys/new')} className="btn btn-primary gap-2 flex-shrink-0">
            <Plus className="w-4 h-4" /> สร้างแบบประเมิน
          </button>
        </div>

        {/* Cards grid */}
        {isLoading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {[...Array(6)].map((_, i) => <div key={i} className="card p-5 h-36 skeleton bg-[var(--color-surface-2)]" />)}
          </div>
        ) : filtered.length === 0 ? (
          <div className="card py-16 flex flex-col items-center text-[var(--color-text-tertiary)]">
            <Filter className="w-10 h-10 mb-3 opacity-20" />
            <p className="text-sm font-medium">ไม่พบแบบประเมิน</p>
            <p className="text-xs mt-1">ลองเปลี่ยนตัวกรองหรือสร้างใหม่</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {filtered.map((s) => {
              const cfg = STATUS_CFG[s.status]
              return (
                <div key={s.id} className="card p-5 flex flex-col gap-3 hover:shadow-lg transition-shadow duration-200">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <p className="font-bold text-[var(--color-text-primary)] leading-snug line-clamp-2">{s.title}</p>
                      {s.description && <p className="text-xs text-[var(--color-text-tertiary)] mt-1 line-clamp-1">{s.description}</p>}
                    </div>
                    <span className={`badge ${cfg.cls} flex-shrink-0`}>
                      <span className={`w-1.5 h-1.5 rounded-full ${cfg.dot}`} />{cfg.label}
                    </span>
                  </div>

                  <div className="flex items-center gap-4 text-xs text-[var(--color-text-secondary)]">
                    <span className="flex items-center gap-1"><Eye className="w-3.5 h-3.5" />{s._count?.questions ?? 0} คำถาม</span>
                    <span className="flex items-center gap-1"><Send className="w-3.5 h-3.5" />{s._count?.assignments ?? 0} มอบหมาย</span>
                    <span className="ml-auto">{new Date(s.createdAt).toLocaleDateString('th-TH', { day: 'numeric', month: 'long', year: 'numeric' })}</span>
                  </div>

                  <div className="flex items-center gap-2 pt-2 border-t border-[var(--color-border)]">
                    {s.status === 'DRAFT' && (
                      <button onClick={() => { confirmDialog('เผยแพร่แบบประเมินนี้?').then(ok => { if (ok) publishMutation.mutate(s.id); }) }}
                        className="btn btn-primary flex-1 text-xs py-1.5 gap-1.5">
                        <Send className="w-3.5 h-3.5" /> เผยแพร่
                      </button>
                    )}
                    {s.status === 'PUBLISHED' && (
                      <button onClick={() => { setAssignModal(s); setSelectedIds([]); setAssignMsg(''); setAssignDeptFilter(''); setAssignCustomDate(''); setAssignSenderEmail('') }}
                        className="btn btn-primary flex-1 text-xs py-1.5 gap-1.5">
                        <Send className="w-3.5 h-3.5" /> มอบหมาย
                      </button>
                    )}
                    <button onClick={() => setCopyModal({ id: s.id, title: s.title + ' (Copy)', createdAt: s.createdAt })}
                      className="btn btn-ghost text-xs py-1.5 gap-1.5 flex-1" title="คัดลอก">
                      <Copy className="w-3.5 h-3.5" /> คัดลอก
                    </button>
                    <button onClick={() => navigate(`/survey/surveys/${s.id}/edit`)}
                      className="btn btn-ghost text-xs py-1.5 gap-1.5 flex-1">
                      <Edit3 className="w-3.5 h-3.5" /> แก้ไข
                    </button>
                    <button onClick={() => { confirmDialog('ลบแบบประเมินนี้?').then(ok => { if (ok) deleteMutation.mutate(s.id); }) }}
                      className="w-8 h-8 rounded-lg flex items-center justify-center text-red-400 hover:bg-red-50 hover:text-red-600 transition-colors flex-shrink-0">
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Assign Modal */}
      {assignModal && (
        <Modal isOpen onClose={() => setAssignModal(null)} showCloseButton={false}
          className="w-full max-w-lg m-4 max-h-[85vh] overflow-hidden">
          <div className="flex flex-col max-h-[85vh] overflow-hidden">
            <div className="px-5 py-4 border-b border-[var(--color-border)]">
              <h2 className="font-bold text-[var(--color-text-primary)]">มอบหมายแบบประเมิน</h2>
              <p className="text-sm text-[var(--color-text-secondary)] mt-0.5 line-clamp-1">{assignModal.title}</p>
            </div>
            <div className="px-5 py-3 border-b border-[var(--color-border)] flex flex-col md:flex-row md:flex-wrap gap-3 items-start md:items-center justify-between">
              <div className="flex gap-2 items-center w-full md:w-auto">
                <select value={assignDeptFilter} onChange={(e) => setAssignDeptFilter(e.target.value)}
                  className="form-input text-xs py-1.5 max-w-[200px] border-[var(--color-border)]">
                  <option value="">ทุกแผนก</option>
                  {assignDepartments.map((d: string) => <option key={d} value={d}>{d}</option>)}
                </select>
                {isPanupong && (
                  <DatePicker 
                    showTime={{ format: 'HH:mm' }}
                    format="YYYY-MM-DD HH:mm"
                    value={assignCustomDate ? dayjs(assignCustomDate) : null}
                    onChange={(date) => setAssignCustomDate(date ? date.toISOString() : '')}
                    placeholder="ระบุวันที่มอบหมาย"
                    style={{ height: '32px', maxWidth: '200px' }}
                    title="ระบุวันที่มอบหมาย (เฉพาะ Panupong Nijjaboon)" 
                    popupClassName="!z-[9999]"
                    getPopupContainer={(trigger) => trigger.parentElement!}
                  />
                )}
              </div>
              {/* Sender Email selector */}
              {senders.length > 0 && (
                <div className="flex items-center gap-2 w-full md:w-auto">
                  <Mail className="w-4 h-4 text-[var(--color-text-tertiary)] flex-shrink-0" />
                  <select value={assignSenderEmail} onChange={(e) => setAssignSenderEmail(e.target.value)}
                    className="form-input text-xs py-1.5 min-w-[200px] max-w-full border-[var(--color-border)]">
                    {senders.map((s: { email: string; label: string }) => <option key={s.email} value={s.email}>{s.label}</option>)}
                  </select>
                </div>
              )}
              <div className="flex items-center gap-4 w-full md:w-auto justify-between md:justify-end">
                <span className="text-sm text-[var(--color-text-secondary)]">
                  เลือก <span className="font-bold text-[var(--color-primary)]">{selectedIds.length}</span> คน
                </span>
                <button onClick={() => {
                  const ids = assignFilteredUsers.map((u) => u.id)
                  const allSelected = ids.length > 0 && ids.every((id) => selectedIds.includes(id))
                  if (allSelected) {
                    setSelectedIds((p) => p.filter((id) => !ids.includes(id)))
                  } else {
                    setSelectedIds((p) => Array.from(new Set([...p, ...ids])))
                  }
                }}
                  className="text-xs text-[var(--color-primary)] hover:underline font-semibold">
                  {assignFilteredUsers.length > 0 && assignFilteredUsers.every((u) => selectedIds.includes(u.id)) ? 'ยกเลิกทั้งหมด' : 'เลือกทั้งหมด'}
                </button>
              </div>
            </div>
            <div className="flex-1 overflow-y-auto divide-y divide-[var(--color-border)] max-h-96">
              {assignFilteredUsers.map((u) => (
                <label key={u.id} className="flex items-center gap-3 px-5 py-3 cursor-pointer hover:bg-[var(--color-surface-2)] transition-colors">
                  <input type="checkbox" checked={selectedIds.includes(u.id)} onChange={() => toggle(u.id)}
                    className="w-4 h-4 accent-blue-600 flex-shrink-0" />
                  <PersonAvatar name={`${u.firstName} ${u.lastName ?? ''}`.trim()} colorKey={u.email || u.id} size="md" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-[var(--color-text-primary)]">{u.firstName} {u.lastName}</p>
                    <p className="text-xs text-[var(--color-text-tertiary)] truncate">{u.email} · {u.department || '—'}</p>
                  </div>
                </label>
              ))}
            </div>
            {assignMsg && <div className="px-5 py-2 bg-emerald-50 text-emerald-700 text-sm text-center font-medium">{assignMsg}</div>}
            <div className="px-5 py-4 border-t border-[var(--color-border)] flex gap-2">
              <button onClick={() => setAssignModal(null)} className="btn btn-ghost flex-1">ยกเลิก</button>
              <button onClick={() => assignMutation.mutate({ id: assignModal.id, userIds: selectedIds, customDate: assignCustomDate, senderEmail: assignSenderEmail || undefined })}
                disabled={selectedIds.length === 0 || assignMutation.isPending}
                className="btn btn-primary flex-1 disabled:opacity-50">
                {assignMutation.isPending ? 'กำลังส่ง...' : `ส่งแบบประเมิน (${selectedIds.length})`}
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* Copy Modal */}
      {copyModal && (
        <Modal isOpen onClose={() => setCopyModal(null)} showCloseButton={false} className="w-full max-w-sm m-4">
          <div className="flex flex-col">
            <div className="px-5 py-4 border-b border-[var(--color-border)]">
              <h2 className="font-bold text-[var(--color-text-primary)]">คัดลอกแบบประเมิน</h2>
            </div>
            <div className="p-5 space-y-4">
              <div>
                <label className="form-label">ชื่อแบบประเมิน</label>
                <input type="text" value={copyModal.title} onChange={(e) => setCopyModal(p => p ? { ...p, title: e.target.value } : p)} className="form-input" />
              </div>
              <div>
                <label className="form-label">วันที่รอบประเมิน</label>
                <DatePicker 
                  showTime={{ format: 'HH:mm' }}
                  format="YYYY-MM-DD HH:mm"
                  value={copyModal.createdAt ? dayjs(copyModal.createdAt) : null}
                  onChange={(date) => setCopyModal(p => p ? { ...p, createdAt: date ? date.toISOString() : '' } : p)}
                  className="w-full border-[var(--color-border)]"
                  popupClassName="!z-[9999]"
                  getPopupContainer={(trigger) => trigger.parentElement!}
                />
              </div>
            </div>
            <div className="px-5 py-4 border-t border-[var(--color-border)] flex gap-2">
              <button onClick={() => setCopyModal(null)} className="btn btn-ghost flex-1">ยกเลิก</button>
              <button onClick={() => duplicateMutation.mutate(copyModal)} disabled={duplicateMutation.isPending || !copyModal.title || !copyModal.createdAt} className="btn btn-primary flex-1 disabled:opacity-50">
                {duplicateMutation.isPending ? 'กำลังคัดลอก...' : 'ยืนยันคัดลอก'}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </SurveyLayout>
  )
}
