import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { Plus, Pencil, Trash2, Send, BarChart3, Clock, Shuffle, ShieldAlert, Search, X, Users, Check } from 'lucide-react'
import { Modal } from '../../components/ui/modal'
import { confirmDialog } from '../../components/ui/confirm'
import { trainingApi } from './api'
import type { TrainingExam, CategoryCount, Sender, Employee } from './types'

interface ExamForm {
  id?: string
  title: string
  description: string
  category: string
  shuffle_questions: boolean
  shuffle_choices: boolean
  question_count: number
  pass_percent: number
  duration_minutes: number
  max_violations: number
  status: 'DRAFT' | 'PUBLISHED'
}

const BLANK: ExamForm = {
  title: '', description: '', category: '', shuffle_questions: true, shuffle_choices: true,
  question_count: 90, pass_percent: 70, duration_minutes: 90, max_violations: 3, status: 'PUBLISHED',
}

export default function TrainingExamsPage() {
  const navigate = useNavigate()
  const [exams, setExams] = useState<TrainingExam[]>([])
  const [cats, setCats] = useState<CategoryCount[]>([])
  const [loading, setLoading] = useState(true)
  const [form, setForm] = useState<ExamForm | null>(null)
  const [saving, setSaving] = useState(false)
  const [invite, setInvite] = useState<TrainingExam | null>(null)

  const load = async () => {
    setLoading(true)
    try {
      const [ex, ct] = await Promise.all([
        trainingApi.get<TrainingExam[]>('/exams'),
        trainingApi.get<CategoryCount[]>('/categories'),
      ])
      setExams(ex); setCats(ct)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'โหลดข้อมูลไม่สำเร็จ')
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => { load() }, [])

  const openNew = () => setForm({ ...BLANK })
  const openEdit = (e: TrainingExam) => setForm({
    id: e.id, title: e.title, description: e.description || '', category: e.category || '',
    shuffle_questions: e.shuffle_questions, shuffle_choices: e.shuffle_choices,
    question_count: e.question_count, pass_percent: e.pass_percent,
    duration_minutes: e.duration_minutes, max_violations: e.max_violations, status: e.status,
  })

  const poolSizeFor = (category: string) =>
    category ? (cats.find(c => c.category === category)?.count ?? 0)
             : cats.reduce((s, c) => s + c.count, 0)

  const save = async () => {
    if (!form) return
    if (!form.title.trim()) { toast.error('กรุณากรอกชื่อแบบทดสอบ'); return }
    setSaving(true)
    try {
      const body = { ...form, category: form.category || null }
      if (form.id) await trainingApi.put(`/exams/${form.id}`, body)
      else await trainingApi.post('/exams', body)
      toast.success('บันทึกแบบทดสอบแล้ว')
      setForm(null); load()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'บันทึกไม่สำเร็จ')
    } finally {
      setSaving(false)
    }
  }

  const remove = async (e: TrainingExam) => {
    const ok = await confirmDialog({ title: 'ลบแบบทดสอบ?', message: `${e.title} — ผลสอบทั้งหมดจะถูกลบด้วย`, confirmText: 'ลบ' })
    if (!ok) return
    try {
      await trainingApi.del(`/exams/${e.id}`)
      toast.success('ลบแล้ว'); load()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'ลบไม่สำเร็จ')
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold" style={{ color: 'var(--color-text-primary)' }}>แบบทดสอบ</h1>
          <p className="text-sm" style={{ color: 'var(--color-text-tertiary)' }}>{exams.length} ชุด</p>
        </div>
        <button className="btn btn-primary" onClick={openNew}><Plus className="w-4 h-4" /> สร้างแบบทดสอบ</button>
      </div>

      {loading ? (
        <p className="text-center py-12" style={{ color: 'var(--color-text-tertiary)' }}>กำลังโหลด...</p>
      ) : exams.length === 0 ? (
        <p className="text-center py-12" style={{ color: 'var(--color-text-tertiary)' }}>ยังไม่มีแบบทดสอบ — กด "สร้างแบบทดสอบ"</p>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {exams.map(e => (
            <div key={e.id} className="rounded-2xl p-5 flex flex-col"
              style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <h3 className="font-bold truncate" style={{ color: 'var(--color-text-primary)' }}>{e.title}</h3>
                  <p className="text-xs mt-0.5" style={{ color: 'var(--color-text-tertiary)' }}>{e.category || 'ทุกหมวดหมู่'}</p>
                </div>
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full flex-shrink-0"
                  style={e.status === 'PUBLISHED' ? { background: 'rgba(16,185,129,0.12)', color: '#059669' } : { background: 'var(--color-surface-2)', color: 'var(--color-text-tertiary)' }}>
                  {e.status === 'PUBLISHED' ? 'เผยแพร่' : 'ร่าง'}
                </span>
              </div>

              <div className="grid grid-cols-2 gap-2 my-4 text-xs" style={{ color: 'var(--color-text-secondary)' }}>
                <span className="inline-flex items-center gap-1.5"><BarChart3 className="w-3.5 h-3.5" /> {e.question_count} / {e.pool_size ?? 0} ข้อ</span>
                <span className="inline-flex items-center gap-1.5"><Clock className="w-3.5 h-3.5" /> {e.duration_minutes} นาที</span>
                <span className="inline-flex items-center gap-1.5"><ShieldAlert className="w-3.5 h-3.5" /> ละเมิดได้ {e.max_violations} ครั้ง</span>
                <span className="inline-flex items-center gap-1.5"><Shuffle className="w-3.5 h-3.5" /> ผ่าน {e.pass_percent}%</span>
              </div>

              <div className="flex items-center justify-between mt-auto pt-3" style={{ borderTop: '1px solid var(--color-border)' }}>
                <span className="text-xs" style={{ color: 'var(--color-text-tertiary)' }}>
                  ส่ง {e.invited ?? 0} · ทำแล้ว {e.submitted ?? 0}
                </span>
                <div className="flex gap-1">
                  <button className="btn-icon" title="ส่งให้ผู้สอบ" onClick={() => setInvite(e)}><Send className="w-4 h-4" style={{ color: 'var(--color-primary)' }} /></button>
                  <button className="btn-icon" title="ผลสอบ" onClick={() => navigate(`/training/exams/${e.id}/results`)}><BarChart3 className="w-4 h-4" /></button>
                  <button className="btn-icon" title="แก้ไข" onClick={() => openEdit(e)}><Pencil className="w-4 h-4" /></button>
                  <button className="btn-icon" title="ลบ" onClick={() => remove(e)}><Trash2 className="w-4 h-4" style={{ color: '#EF4444' }} /></button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {form && (
        <ExamFormModal form={form} setForm={setForm} cats={cats} poolSize={poolSizeFor(form.category)}
          saving={saving} onSave={save} onClose={() => setForm(null)} />
      )}
      {invite && <InviteModal exam={invite} onClose={() => setInvite(null)} onDone={load} />}
    </div>
  )
}

// ── Exam config modal ─────────────────────────────────────────────────────────
function ExamFormModal({ form, setForm, cats, poolSize, saving, onSave, onClose }: {
  form: ExamForm; setForm: (f: ExamForm) => void; cats: CategoryCount[]; poolSize: number
  saving: boolean; onSave: () => void; onClose: () => void
}) {
  const tooMany = form.question_count > poolSize
  return (
    <Modal isOpen onClose={onClose} showCloseButton={false} className="max-w-xl w-full m-4 max-h-[90vh] flex flex-col">
      <div className="flex items-center justify-between px-6 py-4 flex-shrink-0" style={{ borderBottom: '1px solid var(--color-border)' }}>
        <h3 className="font-bold" style={{ color: 'var(--color-text-primary)' }}>{form.id ? 'แก้ไขแบบทดสอบ' : 'สร้างแบบทดสอบ'}</h3>
        <button className="btn-icon" onClick={onClose}>✕</button>
      </div>
      <div className="overflow-y-auto flex-1 p-6 space-y-4">
        <div>
          <label className="text-xs font-semibold mb-1 block" style={{ color: 'var(--color-text-tertiary)' }}>ชื่อแบบทดสอบ</label>
          <input className="field-input w-full" value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} placeholder="เช่น CompTIA Security+ 701" />
        </div>
        <div>
          <label className="text-xs font-semibold mb-1 block" style={{ color: 'var(--color-text-tertiary)' }}>คำอธิบาย (ไม่บังคับ)</label>
          <input className="field-input w-full" value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} />
        </div>
        <div>
          <label className="text-xs font-semibold mb-1 block" style={{ color: 'var(--color-text-tertiary)' }}>หมวดคำถามที่ใช้ออกข้อสอบ</label>
          <select className="field-input w-full" value={form.category} onChange={e => setForm({ ...form, category: e.target.value })}>
            <option value="">ทุกหมวดหมู่ (ทั้งคลัง)</option>
            {cats.map(c => <option key={c.category} value={c.category}>{c.category} ({c.count} ข้อ)</option>)}
          </select>
          <p className="text-[11px] mt-1" style={{ color: 'var(--color-text-tertiary)' }}>คลังนี้มี {poolSize} ข้อให้สุ่ม</p>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs font-semibold mb-1 block" style={{ color: 'var(--color-text-tertiary)' }}>สุ่มมากี่ข้อ</label>
            <input type="number" min={1} className="field-input w-full" value={form.question_count}
              onChange={e => setForm({ ...form, question_count: Math.max(1, parseInt(e.target.value) || 1) })} />
            {tooMany && <p className="text-[11px] mt-1" style={{ color: '#D97706' }}>มากกว่าคลัง — ระบบจะใช้ {poolSize} ข้อ</p>}
          </div>
          <div>
            <label className="text-xs font-semibold mb-1 block" style={{ color: 'var(--color-text-tertiary)' }}>เกณฑ์ผ่าน (%)</label>
            <input type="number" min={0} max={100} className="field-input w-full" value={form.pass_percent}
              onChange={e => setForm({ ...form, pass_percent: Math.min(100, Math.max(0, parseInt(e.target.value) || 0)) })} />
          </div>
          <div>
            <label className="text-xs font-semibold mb-1 block" style={{ color: 'var(--color-text-tertiary)' }}>เวลาสอบ (นาที)</label>
            <input type="number" min={1} className="field-input w-full" value={form.duration_minutes}
              onChange={e => setForm({ ...form, duration_minutes: Math.max(1, parseInt(e.target.value) || 1) })} />
          </div>
          <div>
            <label className="text-xs font-semibold mb-1 block" style={{ color: 'var(--color-text-tertiary)' }}>ละเมิดได้กี่ครั้ง</label>
            <input type="number" min={0} className="field-input w-full" value={form.max_violations}
              onChange={e => setForm({ ...form, max_violations: Math.max(0, parseInt(e.target.value) || 0) })} />
          </div>
        </div>

        <div className="flex flex-col gap-2 rounded-xl p-3" style={{ background: 'var(--color-surface-2)' }}>
          <label className="flex items-center justify-between text-sm" style={{ color: 'var(--color-text-secondary)' }}>
            สลับลำดับโจทย์
            <input type="checkbox" checked={form.shuffle_questions} onChange={e => setForm({ ...form, shuffle_questions: e.target.checked })} />
          </label>
          <label className="flex items-center justify-between text-sm" style={{ color: 'var(--color-text-secondary)' }}>
            สลับลำดับตัวเลือก
            <input type="checkbox" checked={form.shuffle_choices} onChange={e => setForm({ ...form, shuffle_choices: e.target.checked })} />
          </label>
          <label className="flex items-center justify-between text-sm" style={{ color: 'var(--color-text-secondary)' }}>
            เผยแพร่ (พร้อมส่งให้ผู้สอบ)
            <input type="checkbox" checked={form.status === 'PUBLISHED'} onChange={e => setForm({ ...form, status: e.target.checked ? 'PUBLISHED' : 'DRAFT' })} />
          </label>
        </div>
      </div>
      <div className="flex justify-end gap-2 px-6 py-4 flex-shrink-0" style={{ borderTop: '1px solid var(--color-border)' }}>
        <button className="btn btn-ghost" onClick={onClose}>ยกเลิก</button>
        <button className="btn btn-primary" onClick={onSave} disabled={saving}>{saving ? 'กำลังบันทึก...' : 'บันทึก'}</button>
      </div>
    </Modal>
  )
}

// ── Invite modal ──────────────────────────────────────────────────────────────
interface Recipient { name: string; email: string }

function InviteModal({ exam, onClose, onDone }: { exam: TrainingExam; onClose: () => void; onDone: () => void }) {
  const [senders, setSenders] = useState<Sender[]>([])
  const [sender, setSender] = useState('')
  const [employees, setEmployees] = useState<Employee[]>([])
  const [loadingEmp, setLoadingEmp] = useState(true)
  const [selected, setSelected] = useState<Map<string, Recipient>>(new Map()) // key = email
  const [search, setSearch] = useState('')
  const [deptFilter, setDeptFilter] = useState('')
  const [manual, setManual] = useState<Recipient[]>([])
  const [sending, setSending] = useState(false)

  useEffect(() => {
    trainingApi.get<Sender[]>('/senders').then(s => { setSenders(s); if (s[0]) setSender(s[0].email) }).catch(() => {})
    trainingApi.get<Employee[]>('/employees')
      .then(setEmployees)
      .catch(e => toast.error(e instanceof Error ? e.message : 'โหลดรายชื่อพนักงานไม่สำเร็จ'))
      .finally(() => setLoadingEmp(false))
  }, [])

  const departments = useMemo(() => [...new Set(employees.map(e => e.department))], [employees])
  const filtered = useMemo(() => employees.filter(e => {
    if (deptFilter && e.department !== deptFilter) return false
    if (search) {
      const s = search.toLowerCase()
      if (!e.name.toLowerCase().includes(s) && !e.email.toLowerCase().includes(s) && !(e.employeeId || '').toLowerCase().includes(s)) return false
    }
    return true
  }), [employees, deptFilter, search])

  // Group filtered employees by department for the folder-like list.
  const grouped = useMemo(() => {
    const g: Record<string, Employee[]> = {}
    for (const e of filtered) (g[e.department] ??= []).push(e)
    return Object.entries(g)
  }, [filtered])

  const toggle = (e: Employee) => {
    setSelected(prev => {
      const next = new Map(prev)
      if (next.has(e.email)) next.delete(e.email)
      else next.set(e.email, { name: e.name, email: e.email })
      return next
    })
  }
  const selectAllShown = () => {
    setSelected(prev => {
      const next = new Map(prev)
      const allSel = filtered.every(e => next.has(e.email))
      if (allSel) filtered.forEach(e => next.delete(e.email))
      else filtered.forEach(e => next.set(e.email, { name: e.name, email: e.email }))
      return next
    })
  }

  const recipients = useMemo(() => {
    const map = new Map<string, Recipient>(selected)
    for (const m of manual) {
      const email = m.email.trim()
      if (email && !map.has(email)) map.set(email, { name: m.name.trim(), email })
    }
    return [...map.values()]
  }, [selected, manual])

  const send = async () => {
    if (recipients.length === 0) { toast.error('กรุณาเลือกผู้เข้าสอบอย่างน้อย 1 คน'); return }
    setSending(true)
    try {
      const r = await trainingApi.post<{ sent: number; results: { email: string; ok: boolean; skipped?: boolean; error?: string }[] }>(
        `/exams/${exam.id}/invite`, { recipients, senderEmail: sender || undefined })
      const skipped = r.results.filter(x => x.skipped)
      const failed = r.results.filter(x => !x.ok && !x.skipped)
      if (r.sent > 0) toast.success(`ส่งรหัสเข้าสอบสำเร็จ ${r.sent} ฉบับ`)
      if (skipped.length) toast.info(`ข้าม ${skipped.length} ราย (ทำข้อสอบไปแล้ว)`)
      if (failed.length) toast.error(`ส่งไม่สำเร็จ ${failed.length} ราย: ${failed[0].error || ''}`)
      onDone()
      if (!failed.length) onClose()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'ส่งไม่สำเร็จ')
    } finally {
      setSending(false)
    }
  }

  const allShownSelected = filtered.length > 0 && filtered.every(e => selected.has(e.email))

  return (
    <Modal isOpen onClose={onClose} showCloseButton={false} className="max-w-2xl w-full m-4 max-h-[90vh] flex flex-col">
      <div className="flex items-center justify-between px-6 py-4 flex-shrink-0" style={{ borderBottom: '1px solid var(--color-border)' }}>
        <div>
          <h3 className="font-bold" style={{ color: 'var(--color-text-primary)' }}>ส่งแบบทดสอบ</h3>
          <p className="text-xs mt-0.5" style={{ color: 'var(--color-text-tertiary)' }}>{exam.title}</p>
        </div>
        <button className="btn-icon" onClick={onClose}><X className="w-4 h-4" /></button>
      </div>

      <div className="overflow-y-auto flex-1 p-6 space-y-4">
        <div>
          <label className="text-xs font-semibold mb-1 block" style={{ color: 'var(--color-text-tertiary)' }}>ส่งจากอีเมล</label>
          <select className="field-input w-full" value={sender} onChange={e => setSender(e.target.value)}>
            {senders.length === 0 && <option value="">(ค่าเริ่มต้นของระบบ)</option>}
            {senders.map(s => <option key={s.email} value={s.email}>{s.label} — {s.email}</option>)}
          </select>
        </div>

        {/* Employee picker */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <label className="text-xs font-semibold inline-flex items-center gap-1.5" style={{ color: 'var(--color-text-tertiary)' }}>
              <Users className="w-3.5 h-3.5" /> เลือกจากพนักงาน ({employees.length} คน)
            </label>
            {filtered.length > 0 && (
              <button className="text-xs font-semibold" style={{ color: 'var(--color-primary)' }} onClick={selectAllShown}>
                {allShownSelected ? 'ยกเลิกที่แสดง' : `เลือกที่แสดง (${filtered.length})`}
              </button>
            )}
          </div>
          <div className="flex gap-2 mb-2">
            <div className="relative flex-1">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--color-text-tertiary)' }} />
              <input className="field-input w-full pl-9" placeholder="ค้นหาชื่อ / อีเมล / รหัส..." value={search} onChange={e => setSearch(e.target.value)} />
            </div>
            <select className="field-input" value={deptFilter} onChange={e => setDeptFilter(e.target.value)}>
              <option value="">ทุกแผนก</option>
              {departments.map(d => <option key={d} value={d}>{d}</option>)}
            </select>
          </div>

          <div className="rounded-xl max-h-64 overflow-y-auto" style={{ border: '1px solid var(--color-border)' }}>
            {loadingEmp ? (
              <p className="text-center text-sm py-8" style={{ color: 'var(--color-text-tertiary)' }}>กำลังโหลด...</p>
            ) : grouped.length === 0 ? (
              <p className="text-center text-sm py-8" style={{ color: 'var(--color-text-tertiary)' }}>ไม่พบพนักงาน</p>
            ) : grouped.map(([dept, list]) => (
              <div key={dept}>
                <p className="sticky top-0 text-[11px] font-bold px-3 py-1.5" style={{ background: 'var(--color-surface-2)', color: 'var(--color-text-tertiary)' }}>{dept} · {list.length}</p>
                {list.map(e => {
                  const on = selected.has(e.email)
                  return (
                    <button key={e.id} onClick={() => toggle(e)}
                      className="w-full flex items-center gap-3 px-3 py-2 text-left hover:bg-black/5 dark:hover:bg-white/5">
                      <span className="flex-shrink-0 w-5 h-5 rounded flex items-center justify-center border-2"
                        style={{ borderColor: on ? 'var(--color-primary)' : 'var(--color-border)', background: on ? 'var(--color-primary)' : 'transparent' }}>
                        {on && <Check className="w-3.5 h-3.5 text-white" />}
                      </span>
                      <span className="flex-1 min-w-0">
                        <span className="block text-sm font-medium truncate" style={{ color: 'var(--color-text-primary)' }}>{e.name || e.email}</span>
                        <span className="block text-xs truncate" style={{ color: 'var(--color-text-tertiary)' }}>{e.email}{e.employeeId ? ` · ${e.employeeId}` : ''}</span>
                      </span>
                    </button>
                  )
                })}
              </div>
            ))}
          </div>
        </div>

        {/* Manual / external recipients */}
        <div>
          <div className="flex items-center justify-between mb-1">
            <label className="text-xs font-semibold" style={{ color: 'var(--color-text-tertiary)' }}>เพิ่มอีเมลภายนอก (ไม่บังคับ)</label>
            <button className="text-xs font-semibold" style={{ color: 'var(--color-primary)' }}
              onClick={() => setManual([...manual, { name: '', email: '' }])}>+ เพิ่มคน</button>
          </div>
          {manual.map((r, i) => (
            <div key={i} className="flex gap-2 mb-2">
              <input className="field-input flex-1" placeholder="ชื่อ" value={r.name}
                onChange={e => setManual(manual.map((x, j) => j === i ? { ...x, name: e.target.value } : x))} />
              <input className="field-input flex-1" placeholder="อีเมล" value={r.email}
                onChange={e => setManual(manual.map((x, j) => j === i ? { ...x, email: e.target.value } : x))} />
              <button className="btn-icon flex-shrink-0" onClick={() => setManual(manual.filter((_, j) => j !== i))}>
                <Trash2 className="w-4 h-4" style={{ color: '#EF4444' }} />
              </button>
            </div>
          ))}
          <p className="text-[11px] mt-1" style={{ color: 'var(--color-text-tertiary)' }}>
            ระบบจะสร้างรหัสเฉพาะของแต่ละคน แล้วส่งอีเมล HTML พร้อมรหัสผ่าน SMTP ของเรา
          </p>
        </div>
      </div>

      <div className="flex items-center justify-between gap-2 px-6 py-4 flex-shrink-0" style={{ borderTop: '1px solid var(--color-border)' }}>
        <span className="text-sm font-semibold" style={{ color: 'var(--color-text-secondary)' }}>เลือกแล้ว {recipients.length} คน</span>
        <div className="flex gap-2">
          <button className="btn btn-ghost" onClick={onClose}>ยกเลิก</button>
          <button className="btn btn-primary" onClick={send} disabled={sending || recipients.length === 0}>
            <Send className="w-4 h-4" /> {sending ? 'กำลังส่ง...' : `ส่งให้ ${recipients.length} คน`}
          </button>
        </div>
      </div>
    </Modal>
  )
}
