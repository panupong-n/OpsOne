import { useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { Plus, Upload, Pencil, Trash2, Search, CheckCircle2, Circle, CheckSquare, Folder, FolderOpen, ArrowLeft, FileText } from 'lucide-react'
import { Modal } from '../../components/ui/modal'
import { confirmDialog } from '../../components/ui/confirm'
import { trainingApi } from './api'
import type { TrainingQuestion, QuestionType, Choice } from './types'

const NONE = '__none__' // sentinel folder for uncategorised questions

const BLANK: { text: string; type: QuestionType; points: number; category: string; choices: Choice[] } = {
  text: '', type: 'SINGLE', points: 1, category: '',
  choices: [{ text: '', correct: false }, { text: '', correct: false }],
}

export default function TrainingQuestionBankPage() {
  const [questions, setQuestions] = useState<TrainingQuestion[]>([])
  const [loading, setLoading] = useState(true)
  const [folder, setFolder] = useState<string | null>(null) // null = folder overview
  const [search, setSearch] = useState('')
  const [editing, setEditing] = useState<null | (typeof BLANK & { id?: string })>(null)
  const [saving, setSaving] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  const load = async () => {
    setLoading(true)
    try {
      setQuestions(await trainingApi.get<TrainingQuestion[]>('/questions'))
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'โหลดคำถามไม่สำเร็จ')
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => { load() }, [])

  // Build folder list (category → count), with an "uncategorised" bucket.
  const folders = useMemo(() => {
    const map = new Map<string, number>()
    for (const q of questions) {
      const key = q.category || NONE
      map.set(key, (map.get(key) || 0) + 1)
    }
    return [...map.entries()].sort((a, b) => (a[0] === NONE ? 1 : b[0] === NONE ? -1 : a[0].localeCompare(b[0])))
  }, [questions])

  const categories = useMemo(
    () => [...new Set(questions.map(q => q.category).filter(Boolean))] as string[],
    [questions],
  )

  const inFolder = useMemo(() => questions.filter(q => {
    if (folder === null) return false
    const key = q.category || NONE
    if (key !== folder) return false
    if (search && !q.text.toLowerCase().includes(search.toLowerCase())) return false
    return true
  }), [questions, folder, search])

  const folderLabel = folder === NONE ? 'ไม่ระบุหมวดหมู่' : folder
  const folderCategoryValue = folder === NONE || folder === null ? '' : folder

  const openNew = () => setEditing({
    ...BLANK, choices: BLANK.choices.map(c => ({ ...c })), category: folderCategoryValue,
  })
  const openEdit = (q: TrainingQuestion) => setEditing({
    id: q.id, text: q.text, type: q.type, points: q.points, category: q.category || '',
    choices: q.choices.map(c => ({ text: c.text, correct: !!c.correct })),
  })

  const save = async () => {
    if (!editing) return
    if (!editing.text.trim()) { toast.error('กรุณากรอกโจทย์'); return }
    const choices = editing.choices.filter(c => c.text.trim())
    if (choices.length < 2) { toast.error('ต้องมีตัวเลือกอย่างน้อย 2 ข้อ'); return }
    if (!choices.some(c => c.correct)) { toast.error('เลือกคำตอบที่ถูกอย่างน้อย 1 ข้อ'); return }
    setSaving(true)
    try {
      const body = { ...editing, choices }
      if (editing.id) await trainingApi.put(`/questions/${editing.id}`, body)
      else await trainingApi.post('/questions', body)
      toast.success('บันทึกคำถามแล้ว')
      setEditing(null)
      load()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'บันทึกไม่สำเร็จ')
    } finally {
      setSaving(false)
    }
  }

  const remove = async (q: TrainingQuestion) => {
    const ok = await confirmDialog({ title: 'ลบคำถาม?', message: q.text.slice(0, 120), confirmText: 'ลบ' })
    if (!ok) return
    try {
      await trainingApi.del(`/questions/${q.id}`)
      toast.success('ลบแล้ว')
      load()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'ลบไม่สำเร็จ')
    }
  }

  const onImportFile = async (file: File) => {
    try {
      const parsed = JSON.parse(await file.text())
      const list = Array.isArray(parsed) ? parsed : parsed.questions
      if (!Array.isArray(list) || !list.length) { toast.error('ไฟล์ไม่มีคำถาม'); return }
      // Import into the current folder, or ask for a folder name from the overview.
      const preset = folderCategoryValue
      const category = preset || window.prompt('ชื่อโฟลเดอร์สำหรับชุดนี้', 'Imported') || null
      const r = await trainingApi.post<{ inserted: number }>('/questions/import', {
        questions: list, category, source: file.name,
      })
      toast.success(`นำเข้า ${r.inserted} คำถามเข้าโฟลเดอร์ "${category || 'ไม่ระบุ'}" แล้ว`)
      if (category) setFolder(category)
      load()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'นำเข้าไม่สำเร็จ (ไฟล์ต้องเป็น JSON)')
    }
  }

  const toggleCorrect = (idx: number) => {
    if (!editing) return
    const isSingle = editing.type === 'SINGLE'
    setEditing({
      ...editing,
      choices: editing.choices.map((c, i) =>
        i === idx ? { ...c, correct: !c.correct } : isSingle ? { ...c, correct: false } : c),
    })
  }

  const importInput = (
    <input ref={fileRef} type="file" accept="application/json,.json" hidden
      onChange={e => { const f = e.target.files?.[0]; if (f) onImportFile(f); e.target.value = '' }} />
  )

  // ═══════════════ FOLDER OVERVIEW ═══════════════
  if (folder === null) {
    return (
      <div className="space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-xl font-bold" style={{ color: 'var(--color-text-primary)' }}>คลังคำถาม</h1>
            <p className="text-sm" style={{ color: 'var(--color-text-tertiary)' }}>{folders.length} โฟลเดอร์ · {questions.length} คำถามทั้งหมด</p>
          </div>
          <div className="flex gap-2">
            {importInput}
            <button className="btn btn-ghost" onClick={() => fileRef.current?.click()}><Upload className="w-4 h-4" /> นำเข้า JSON</button>
          </div>
        </div>

        {loading ? (
          <p className="text-center py-12" style={{ color: 'var(--color-text-tertiary)' }}>กำลังโหลด...</p>
        ) : folders.length === 0 ? (
          <div className="text-center py-16 rounded-2xl" style={{ background: 'var(--color-surface)', border: '1px dashed var(--color-border)' }}>
            <Folder className="w-12 h-12 mx-auto mb-3 opacity-40" style={{ color: 'var(--color-text-tertiary)' }} />
            <p style={{ color: 'var(--color-text-tertiary)' }}>ยังไม่มีคำถาม — นำเข้า JSON เพื่อสร้างโฟลเดอร์แรก</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {folders.map(([key, count]) => (
              <button key={key} onClick={() => { setSearch(''); setFolder(key) }}
                className="rounded-2xl p-5 text-left transition-shadow hover:shadow-md"
                style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
                <div className="flex items-center gap-3">
                  <div className="w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0"
                    style={{ background: key === NONE ? 'var(--color-surface-2)' : 'rgba(37,99,235,0.1)' }}>
                    <Folder className="w-6 h-6" style={{ color: key === NONE ? 'var(--color-text-tertiary)' : '#2563EB' }} />
                  </div>
                  <div className="min-w-0">
                    <p className="font-bold truncate" style={{ color: 'var(--color-text-primary)' }}>{key === NONE ? 'ไม่ระบุหมวดหมู่' : key}</p>
                    <p className="text-xs" style={{ color: 'var(--color-text-tertiary)' }}>{count} คำถาม</p>
                  </div>
                </div>
              </button>
            ))}
          </div>
        )}

        {editing && <QuestionEditor editing={editing} setEditing={setEditing} categories={categories} saving={saving} onSave={save} toggleCorrect={toggleCorrect} />}
      </div>
    )
  }

  // ═══════════════ INSIDE A FOLDER ═══════════════
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <button className="btn-icon flex-shrink-0" onClick={() => { setFolder(null); setSearch('') }}><ArrowLeft className="w-5 h-5" /></button>
          <div className="flex items-center gap-2 min-w-0">
            <FolderOpen className="w-5 h-5 flex-shrink-0" style={{ color: '#2563EB' }} />
            <div className="min-w-0">
              <h1 className="text-xl font-bold truncate" style={{ color: 'var(--color-text-primary)' }}>{folderLabel}</h1>
              <p className="text-sm" style={{ color: 'var(--color-text-tertiary)' }}>{inFolder.length} คำถามในโฟลเดอร์นี้</p>
            </div>
          </div>
        </div>
        <div className="flex gap-2">
          {importInput}
          <button className="btn btn-ghost" onClick={() => fileRef.current?.click()}><Upload className="w-4 h-4" /> นำเข้าเข้าโฟลเดอร์นี้</button>
          <button className="btn btn-primary" onClick={openNew}><Plus className="w-4 h-4" /> เพิ่มคำถาม</button>
        </div>
      </div>

      <div className="relative">
        <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--color-text-tertiary)' }} />
        <input className="field-input w-full pl-9" placeholder="ค้นหาโจทย์ในโฟลเดอร์นี้..." value={search} onChange={e => setSearch(e.target.value)} />
      </div>

      {loading ? (
        <p className="text-center py-12" style={{ color: 'var(--color-text-tertiary)' }}>กำลังโหลด...</p>
      ) : inFolder.length === 0 ? (
        <div className="text-center py-12" style={{ color: 'var(--color-text-tertiary)' }}>
          <FileText className="w-10 h-10 mx-auto mb-2 opacity-40" />
          {search ? 'ไม่พบคำถามที่ค้นหา' : 'โฟลเดอร์นี้ยังไม่มีคำถาม'}
        </div>
      ) : (
        <div className="space-y-2">
          {inFolder.map((q, i) => (
            <div key={q.id} className="rounded-xl p-4 flex items-start gap-3"
              style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
              <span className="text-xs font-bold mt-0.5 w-6 flex-shrink-0" style={{ color: 'var(--color-text-tertiary)' }}>{i + 1}</span>
              <div className="flex-1 min-w-0">
                <div className="flex flex-wrap items-center gap-2 mb-1">
                  <span className="text-[10px] font-bold px-1.5 py-0.5 rounded"
                    style={{ background: q.type === 'MULTI' ? 'rgba(139,92,246,0.12)' : 'rgba(37,99,235,0.1)', color: q.type === 'MULTI' ? '#7C3AED' : '#2563EB' }}>
                    {q.type === 'MULTI' ? 'เลือกหลายข้อ' : 'เลือกข้อเดียว'}
                  </span>
                  <span className="text-[10px] font-semibold" style={{ color: 'var(--color-text-tertiary)' }}>{q.points} คะแนน</span>
                </div>
                <p className="text-sm font-medium" style={{ color: 'var(--color-text-primary)' }}>{q.text}</p>
                <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-0.5">
                  {q.choices.map((c, ci) => (
                    <span key={ci} className="text-xs inline-flex items-center gap-1"
                      style={{ color: c.correct ? '#16A34A' : 'var(--color-text-tertiary)' }}>
                      {c.correct ? <CheckCircle2 className="w-3 h-3" /> : <Circle className="w-3 h-3" />}{c.text}
                    </span>
                  ))}
                </div>
              </div>
              <div className="flex gap-1 flex-shrink-0">
                <button className="btn-icon" onClick={() => openEdit(q)}><Pencil className="w-4 h-4" /></button>
                <button className="btn-icon" onClick={() => remove(q)}><Trash2 className="w-4 h-4" style={{ color: '#EF4444' }} /></button>
              </div>
            </div>
          ))}
        </div>
      )}

      {editing && <QuestionEditor editing={editing} setEditing={setEditing} categories={categories} saving={saving} onSave={save} toggleCorrect={toggleCorrect} />}
    </div>
  )
}

// ── Question editor modal ─────────────────────────────────────────────────────
function QuestionEditor({ editing, setEditing, categories, saving, onSave, toggleCorrect }: {
  editing: typeof BLANK & { id?: string }
  setEditing: (e: (typeof BLANK & { id?: string }) | null) => void
  categories: string[]
  saving: boolean
  onSave: () => void
  toggleCorrect: (idx: number) => void
}) {
  return (
    <Modal isOpen onClose={() => setEditing(null)} showCloseButton={false} className="max-w-2xl w-full m-4 max-h-[90vh] flex flex-col">
      <div className="flex items-center justify-between px-6 py-4 flex-shrink-0" style={{ borderBottom: '1px solid var(--color-border)' }}>
        <h3 className="font-bold" style={{ color: 'var(--color-text-primary)' }}>{editing.id ? 'แก้ไขคำถาม' : 'เพิ่มคำถาม'}</h3>
        <button className="btn-icon" onClick={() => setEditing(null)}>✕</button>
      </div>
      <div className="overflow-y-auto flex-1 p-6 space-y-4">
        <div>
          <label className="text-xs font-semibold mb-1 block" style={{ color: 'var(--color-text-tertiary)' }}>โจทย์</label>
          <textarea className="field-input w-full" rows={3} value={editing.text}
            onChange={e => setEditing({ ...editing, text: e.target.value })} placeholder="พิมพ์โจทย์..." />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div>
            <label className="text-xs font-semibold mb-1 block" style={{ color: 'var(--color-text-tertiary)' }}>ประเภท</label>
            <div className="flex gap-1 p-0.5 rounded-lg" style={{ background: 'var(--color-surface-2)' }}>
              {(['SINGLE', 'MULTI'] as const).map(t => (
                <button key={t}
                  onClick={() => setEditing({
                    ...editing, type: t,
                    choices: t === 'SINGLE'
                      ? editing.choices.map((c, i) => ({ ...c, correct: c.correct && editing.choices.findIndex(x => x.correct) === i }))
                      : editing.choices,
                  })}
                  className="flex-1 py-1.5 rounded-md text-xs font-semibold"
                  style={editing.type === t ? { background: 'var(--color-primary)', color: '#fff' } : { color: 'var(--color-text-secondary)' }}>
                  {t === 'SINGLE' ? 'ข้อเดียว' : 'หลายข้อ'}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="text-xs font-semibold mb-1 block" style={{ color: 'var(--color-text-tertiary)' }}>คะแนน</label>
            <input type="number" min={1} className="field-input w-full" value={editing.points}
              onChange={e => setEditing({ ...editing, points: Math.max(1, parseInt(e.target.value) || 1) })} />
          </div>
          <div>
            <label className="text-xs font-semibold mb-1 block" style={{ color: 'var(--color-text-tertiary)' }}>โฟลเดอร์ (หมวดหมู่)</label>
            <input list="tr-cats" className="field-input w-full" value={editing.category}
              onChange={e => setEditing({ ...editing, category: e.target.value })} placeholder="เช่น CompTIA Security+ 701" />
            <datalist id="tr-cats">{categories.map(c => <option key={c} value={c} />)}</datalist>
          </div>
        </div>
        <div>
          <div className="flex items-center justify-between mb-1">
            <label className="text-xs font-semibold" style={{ color: 'var(--color-text-tertiary)' }}>
              ตัวเลือก {editing.type === 'MULTI' ? '(เลือกได้หลายคำตอบที่ถูก)' : '(เลือก 1 คำตอบที่ถูก)'}
            </label>
            <button className="text-xs font-semibold" style={{ color: 'var(--color-primary)' }}
              onClick={() => setEditing({ ...editing, choices: [...editing.choices, { text: '', correct: false }] })}>
              + เพิ่มตัวเลือก
            </button>
          </div>
          <div className="space-y-2">
            {editing.choices.map((c, idx) => (
              <div key={idx} className="flex items-center gap-2">
                <button onClick={() => toggleCorrect(idx)} className="flex-shrink-0"
                  title="ทำเครื่องหมายคำตอบที่ถูก"
                  style={{ color: c.correct ? '#16A34A' : 'var(--color-text-tertiary)' }}>
                  {c.correct ? <CheckCircle2 className="w-5 h-5" /> : editing.type === 'MULTI' ? <CheckSquare className="w-5 h-5 opacity-40" /> : <Circle className="w-5 h-5" />}
                </button>
                <input className="field-input flex-1" value={c.text} placeholder={`ตัวเลือกที่ ${idx + 1}`}
                  onChange={e => setEditing({ ...editing, choices: editing.choices.map((x, i) => i === idx ? { ...x, text: e.target.value } : x) })} />
                {editing.choices.length > 2 && (
                  <button className="btn-icon flex-shrink-0"
                    onClick={() => setEditing({ ...editing, choices: editing.choices.filter((_, i) => i !== idx) })}>
                    <Trash2 className="w-4 h-4" style={{ color: '#EF4444' }} />
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
      <div className="flex justify-end gap-2 px-6 py-4 flex-shrink-0" style={{ borderTop: '1px solid var(--color-border)' }}>
        <button className="btn btn-ghost" onClick={() => setEditing(null)}>ยกเลิก</button>
        <button className="btn btn-primary" onClick={onSave} disabled={saving}>{saving ? 'กำลังบันทึก...' : 'บันทึก'}</button>
      </div>
    </Modal>
  )
}
