import { confirmDialog } from '../../components/ui/confirm';
import { useState, useEffect } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { DatePicker } from 'antd'
import dayjs from 'dayjs'
import { useQuery, useMutation } from '@tanstack/react-query'
import { Plus, Trash2, GripVertical, ChevronDown, Star, AlignLeft, List, CheckSquare, ArrowLeft, Save, Building2, FileText } from 'lucide-react'
import surveyApi from './api'
import type { Question, Survey } from './types'

type QType = 'RATING' | 'TEXT' | 'SINGLE_CHOICE' | 'MULTI_CHOICE' | 'DEPT_SELECT'
const TYPE_CFG: Record<QType, { label: string; icon: typeof Star; desc: string; color: string }> = {
  RATING:        { label: 'คะแนน 1-5',    icon: Star,        desc: 'ให้คะแนนระดับ 1-5',          color: 'text-amber-500' },
  TEXT:          { label: 'ข้อความ',       icon: AlignLeft,   desc: 'ตอบอิสระ',                    color: 'text-blue-500' },
  SINGLE_CHOICE: { label: 'เลือกหนึ่ง',    icon: List,        desc: 'เลือกคำตอบเดียว',             color: 'text-violet-500' },
  MULTI_CHOICE:  { label: 'เลือกหลาย',     icon: CheckSquare, desc: 'เลือกได้หลายข้อ',             color: 'text-emerald-500' },
  DEPT_SELECT:   { label: 'เลือกแผนก/ฝ่าย', icon: Building2,   desc: 'ดึงข้อมูลจากฐานข้อมูล',       color: 'text-teal-500' },
}

interface LocalQ {
  id?: string; text: string; type: QType; options: string[]; order: number; required: boolean
}

const newQ = (order: number): LocalQ => ({ text: '', type: 'RATING', options: [], order, required: true })

// Survey.docx template — IT Satisfaction Survey
const TEMPLATE_QUESTIONS: LocalQ[] = [
  // ส่วนที่ 1: ข้อมูลทั่วไป
  { text: '[ข้อมูลทั่วไปของผู้ตอบแบบสอบถาม] แผนก/ฝ่าย', type: 'DEPT_SELECT', options: [], order: 1, required: true },
  { text: '[ข้อมูลทั่วไปของผู้ตอบแบบสอบถาม] ประเภทการเชื่อมต่ออินเทอร์เน็ตที่ท่านใช้เป็นหลัก (เลือกเพื่อแสดงคำถามที่เกี่ยวข้อง)', type: 'SINGLE_CHOICE', options: ['สายแลน (LAN)', 'อินเทอร์เน็ตไร้สาย (Wi-Fi)', 'ใช้ทั้งสองอย่าง'], order: 2, required: true },
  // ส่วนที่ 2: ประเมินความพึงพอใจรายระบบ
  // 1. ระบบอินเทอร์เน็ตผ่านสายแลน (LAN Connection)
  { text: '[ระบบอินเทอร์เน็ตผ่านสายแลน (LAN Connection)] ความเสถียรของสัญญาณ (สัญญาณไม่หลุดบ่อย)', type: 'RATING', options: [], order: 3, required: true },
  { text: '[ระบบอินเทอร์เน็ตผ่านสายแลน (LAN Connection)] ความเร็วในการโหลดข้อมูล/เข้าเว็บไซต์/ระบบงาน', type: 'RATING', options: [], order: 4, required: true },
  { text: '[ระบบอินเทอร์เน็ตผ่านสายแลน (LAN Connection)] ความพร้อมใช้งานของพอร์ต LAN สภาพสายแลนที่โต๊ะ', type: 'RATING', options: [], order: 5, required: true },
  // 2. ระบบอินเทอร์เน็ตไร้สาย (Wi-Fi Connection)
  { text: '[ระบบอินเทอร์เน็ตไร้สาย (Wi-Fi Connection)] ความครอบคลุมของสัญญาณ Wi-Fi (เช่น ในห้องประชุม, พื้นที่ส่วนกลาง)', type: 'RATING', options: [], order: 6, required: true },
  { text: '[ระบบอินเทอร์เน็ตไร้สาย (Wi-Fi Connection)] ความง่ายและความสะดวกรวดเร็วในการเชื่อมต่อ (Log-in)', type: 'RATING', options: [], order: 7, required: true },
  { text: '[ระบบอินเทอร์เน็ตไร้สาย (Wi-Fi Connection)] ความเสถียรของ Wi-Fi ในช่วงเวลาที่มีคนใช้งานหนาแน่น', type: 'RATING', options: [], order: 8, required: true },
  { text: '[ระบบอินเทอร์เน็ตไร้สาย (Wi-Fi Connection)] ความเร็วของ Wi-Fi ในช่วงเวลาที่มีคนใช้งานหนาแน่น', type: 'RATING', options: [], order: 9, required: true },
  // 3. การใช้งานเครื่องพิมพ์และอุปกรณ์สำนักงาน
  { text: '[เครื่องพิมพ์และอุปกรณ์สำนักงาน (Printer / Copier)] ความเร็วและคุณภาพของการพิมพ์ (ตัวหนังสือชัดเจน/สีสันถูกต้อง)', type: 'RATING', options: [], order: 10, required: true },
  { text: '[เครื่องพิมพ์และอุปกรณ์สำนักงาน (Printer / Copier)] ความเสถียรในการสั่งพิมพ์ (เช่น เครื่องไม่ออฟไลน์, สั่งแล้วออกทันที)', type: 'RATING', options: [], order: 11, required: true },
  { text: '[เครื่องพิมพ์และอุปกรณ์สำนักงาน (Printer / Copier)] ความเพียงพอของอุปกรณ์ (จำนวนเครื่องพิมพ์, กระดาษ, หมึกพิมพ์)', type: 'RATING', options: [], order: 12, required: true },
  // 4. การใช้งานเครื่องคอมพิวเตอร์
  { text: '[เครื่องคอมพิวเตอร์ (PC / Laptop ของบริษัท)] ความเร็วและประสิทธิภาพของเครื่อง (เครื่องไม่ค้าง, เปิดโปรแกรมเร็ว)', type: 'RATING', options: [], order: 13, required: true },
  { text: '[เครื่องคอมพิวเตอร์ (PC / Laptop ของบริษัท)] ความพร้อมของโปรแกรมพื้นฐานและโปรแกรมที่ใช้ทำงาน', type: 'RATING', options: [], order: 14, required: true },
  { text: '[เครื่องคอมพิวเตอร์ (PC / Laptop ของบริษัท)] สภาพฮาร์ดแวร์ภายนอก (จอภาพ, คีย์บอร์ด, เมาส์, แบตเตอรี่โน้ตบุ๊ก)', type: 'RATING', options: [], order: 15, required: true },
  // 5. การให้บริการของเจ้าหน้าที่ไอที
  { text: '[การให้บริการของเจ้าหน้าที่ไอที (IT Support & Service)] ความรวดเร็วในการเข้าแก้ไขปัญหาเมื่อได้รับแจ้ง', type: 'RATING', options: [], order: 16, required: true },
  { text: '[การให้บริการของเจ้าหน้าที่ไอที (IT Support & Service)] ความสุภาพ มนุษยสัมพันธ์ และความเต็มใจในการให้บริการ', type: 'RATING', options: [], order: 17, required: true },
  { text: '[การให้บริการของเจ้าหน้าที่ไอที (IT Support & Service)] ประสิทธิภาพในการแก้ไขปัญหาและการให้บริการจนแล้วเสร็จ', type: 'RATING', options: [], order: 18, required: true },
  // ส่วนที่ 3: ข้อเสนอแนะและปัญหาที่พบบ่อย (ไม่นับคะแนน, ไม่บังคับ)
  { text: '[ข้อเสนอแนะและปัญหาที่พบบ่อย] ปัญหาที่ท่านพบเจอบ่อยที่สุดในการใช้งานระบบไอทีคืออะไร?', type: 'MULTI_CHOICE', options: ['Wi-Fi หลุดบ่อย', 'เครื่องคอมพิวเตอร์ช้า/ค้าง', 'เครื่องพิมพ์มีปัญหาบ่อย — กระดาษติดบ่อย', 'เครื่องพิมพ์มีปัญหาบ่อย — หมึกจาง', 'เครื่องพิมพ์มีปัญหาบ่อย — สั่งปริ้นท์ไม่ออก', 'อื่นๆ'], order: 19, required: false },
  { text: '[ข้อเสนอแนะและปัญหาที่พบบ่อย] ข้อเสนอแนะเพิ่มเติมเพื่อการปรับปรุงระบบไอทีของบริษัท', type: 'TEXT', options: [], order: 20, required: false },
]

export default function SurveyBuilderPage() {
  const { id } = useParams<{ id: string }>()
  const isEdit = !!id
  const navigate = useNavigate()
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [createdAt, setCreatedAt] = useState('')
  const [questions, setQuestions] = useState<LocalQ[]>([newQ(1)])
  const [error, setError] = useState('')
  const [openIdx, setOpenIdx] = useState<number | null>(0)
  const [showTemplateModal, setShowTemplateModal] = useState(false)

  const { data: existing } = useQuery({
    queryKey: ['survey-edit', id],
    queryFn: () => surveyApi.get<Survey>(`/surveys/${id}`).then((r) => r.data),
    enabled: isEdit,
  })

  useEffect(() => {
    if (!existing) return
    setTitle(existing.title); setDescription(existing.description || ''); setCreatedAt(existing.createdAt || '')
    setQuestions((existing.questions ?? []).map((q: Question) => ({ id: q.id, text: q.text, type: q.type as QType, options: q.options ?? [], order: q.order, required: q.required })))
  }, [existing])

  const saveMutation = useMutation({
    mutationFn: (p: { title: string; description: string; createdAt?: string; questions: LocalQ[] }) =>
      isEdit ? surveyApi.put(`/surveys/${id}`, p) : surveyApi.post('/surveys', p),
    onSuccess: () => navigate('/survey/surveys'),
    onError: (e: unknown) => setError((e as { response?: { data?: { error?: string } } })?.response?.data?.error || 'เกิดข้อผิดพลาด'),
  })

  function updQ(idx: number, patch: Partial<LocalQ>) {
    setQuestions((p) => p.map((q, i) => i === idx ? { ...q, ...patch } : q))
  }
  function addOption(idx: number) { updQ(idx, { options: [...questions[idx].options, ''] }) }
  function updOption(qi: number, oi: number, v: string) {
    const opts = [...questions[qi].options]; opts[oi] = v; updQ(qi, { options: opts })
  }
  function removeOption(qi: number, oi: number) {
    updQ(qi, { options: questions[qi].options.filter((_, i) => i !== oi) })
  }

  function handleSubmit() {
    setError('')
    if (!title.trim()) { setError('กรุณากรอกชื่อแบบประเมิน'); return }
    for (const q of questions) {
      if (!q.text.trim()) { setError('กรุณากรอกข้อความคำถามให้ครบ'); return }
      if ((q.type === 'SINGLE_CHOICE' || q.type === 'MULTI_CHOICE') && q.options.length < 2) { setError('คำถามแบบเลือกต้องมีตัวเลือกอย่างน้อย 2 ข้อ'); return }
    }
    saveMutation.mutate({ title: title.trim(), description: description.trim(), createdAt: createdAt || undefined, questions })
  }

  function loadTemplate() {
    setTitle('แบบสำรวจความพึงพอใจการใช้งานระบบสารสนเทศและอุปกรณ์สำนักงาน')
    setDescription('เพื่อนำข้อมูลไปปรับปรุงประสิทธิภาพการให้บริการระบบเครือข่าย อินเทอร์เน็ต และอุปกรณ์ไอทีภายในบริษัทให้ดียิ่งขึ้น\n\nเกณฑ์การให้คะแนนความพึงพอใจ: 5 = พึงพอใจมากที่สุด | 4 = พึงพอใจมาก | 3 = ปานกลาง | 2 = พึงพอใจน้อย | 1 = ควรปรับปรุง')
    setQuestions(TEMPLATE_QUESTIONS.map(q => ({ ...q })))
    setOpenIdx(null)
    setShowTemplateModal(false)
  }

  return (
    <div className="min-h-screen bg-[var(--color-bg)]">
      {/* Top bar */}
      <div className="sticky top-0 z-20 bg-[var(--color-surface)] border-b border-[var(--color-border)] px-6 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button onClick={() => navigate('/survey/surveys')} className="w-8 h-8 rounded-lg flex items-center justify-center hover:bg-[var(--color-surface-2)] transition-colors">
            <ArrowLeft className="w-4 h-4 text-[var(--color-text-secondary)]" />
          </button>
          <div>
            <h1 className="text-sm font-bold text-[var(--color-text-primary)]">{isEdit ? 'แก้ไขแบบประเมิน' : 'สร้างแบบประเมินใหม่'}</h1>
            <p className="text-xs text-[var(--color-text-tertiary)]">{questions.length} คำถาม</p>
          </div>
        </div>
        <div className="flex gap-2">
          {!isEdit && (
            <button onClick={() => setShowTemplateModal(true)} className="btn btn-ghost text-sm gap-2 border border-blue-200 text-blue-600 hover:bg-blue-50">
              <FileText className="w-4 h-4" />สร้างจาก Template
            </button>
          )}
          <button onClick={() => navigate('/survey/surveys')} className="btn btn-ghost text-sm">ยกเลิก</button>
          <button onClick={handleSubmit} disabled={saveMutation.isPending} className="btn btn-primary text-sm gap-2 disabled:opacity-50">
            <Save className="w-4 h-4" />{saveMutation.isPending ? 'กำลังบันทึก...' : isEdit ? 'บันทึก' : 'สร้าง'}
          </button>
        </div>
      </div>

      <div className="max-w-2xl mx-auto px-4 py-6 space-y-4">
        {error && (
          <div className="px-4 py-3 bg-[var(--color-error-soft)] text-[var(--color-error)] rounded-xl text-sm border border-red-200">{error}</div>
        )}

        {/* Survey info card */}
        <div className="card p-5 border-l-4 border-l-blue-500">
          <p className="text-xs font-bold text-[var(--color-text-tertiary)] uppercase tracking-wider mb-3">ข้อมูลแบบประเมิน</p>
          <div className="space-y-3">
            <div>
              <label className="form-label">ชื่อแบบประเมิน <span className="text-red-500">*</span></label>
              <input type="text" value={title} onChange={(e) => setTitle(e.target.value)}
                placeholder="เช่น แบบประเมินความพึงพอใจ IT Q1/2025" className="form-input text-base font-semibold" />
            </div>
            <div>
              <label className="form-label">วันที่รอบประเมิน</label>
              <DatePicker 
                showTime={{ format: 'HH:mm' }}
                format="YYYY-MM-DD HH:mm"
                value={createdAt ? dayjs(createdAt) : null}
                onChange={(date) => setCreatedAt(date ? date.toISOString() : '')}
                className="w-full border-[var(--color-border)] form-input py-1.5"
              />
            </div>
            <div>
              <label className="form-label">คำอธิบาย</label>
              <textarea value={description} onChange={(e) => setDescription(e.target.value)}
                placeholder="คำอธิบายแบบประเมิน (ไม่บังคับ)" rows={2} className="form-input resize-none" />
            </div>
          </div>
        </div>

        {/* Questions */}
        {questions.map((q, idx) => {
          const TypeIcon = TYPE_CFG[q.type].icon
          const isOpen = openIdx === idx
          return (
            <div key={idx} className={`card border-2 transition-all duration-150 ${isOpen ? 'border-blue-200 shadow-md' : 'border-transparent'}`}>
              {/* Question header (always visible) */}
              <div className="flex items-center gap-3 px-4 py-3 cursor-pointer select-none" onClick={() => setOpenIdx(isOpen ? null : idx)}>
                <div className="cursor-grab text-[var(--color-text-tertiary)]"><GripVertical className="w-4 h-4" /></div>
                <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 ${isOpen ? 'bg-blue-600 text-white' : 'bg-[var(--color-surface-2)] text-[var(--color-text-secondary)]'}`}>{idx + 1}</div>
                <div className="flex-1 min-w-0">
                  <p className={`text-sm font-semibold truncate ${q.text ? 'text-[var(--color-text-primary)]' : 'text-[var(--color-text-tertiary)]'}`}>
                    {q.text || 'คำถามที่ ' + (idx + 1)}
                  </p>
                  <div className="flex items-center gap-1.5 mt-0.5">
                    <TypeIcon className={`w-3 h-3 ${TYPE_CFG[q.type].color}`} />
                    <span className="text-[11px] text-[var(--color-text-tertiary)]">{TYPE_CFG[q.type].label}</span>
                    {q.required && <span className="text-[10px] bg-red-50 text-red-500 px-1.5 rounded-full border border-red-100">บังคับ</span>}
                  </div>
                </div>
                <div className="flex items-center gap-1 flex-shrink-0">
                  <button onClick={(e) => { e.stopPropagation(); confirmDialog('ลบคำถามนี้?').then(ok => { if (ok) setQuestions((p) => p.filter((_, i) => i !== idx).map((q, i) => ({ ...q, order: i + 1 }))); }); }}
                    className="w-7 h-7 rounded-lg flex items-center justify-center text-[var(--color-text-tertiary)] hover:text-red-500 hover:bg-red-50 transition-colors">
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                  <ChevronDown className={`w-4 h-4 text-[var(--color-text-tertiary)] transition-transform ${isOpen ? 'rotate-180' : ''}`} />
                </div>
              </div>

              {/* Expanded editor */}
              {isOpen && (
                <div className="px-4 pb-4 border-t border-[var(--color-border)] pt-4 space-y-3">
                  <div>
                    <label className="form-label">ข้อความคำถาม</label>
                    <input type="text" value={q.text} onChange={(e) => updQ(idx, { text: e.target.value })}
                      placeholder="พิมพ์คำถามที่นี่..." className="form-input" autoFocus />
                  </div>

                  <div className="flex gap-3">
                    <div className="flex-1">
                      <label className="form-label">ประเภท</label>
                      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                        {(Object.entries(TYPE_CFG) as [QType, typeof TYPE_CFG[QType]][]).map(([k, v]) => (
                          <button key={k} onClick={() => updQ(idx, { type: k, options: [] })}
                            className={`flex items-center gap-2 p-2.5 rounded-xl border-2 text-left transition-all ${q.type === k ? 'border-blue-400 bg-blue-50' : 'border-[var(--color-border)] hover:border-[var(--color-border-strong)]'}`}>
                            <v.icon className={`w-4 h-4 flex-shrink-0 ${q.type === k ? 'text-blue-600' : v.color}`} />
                            <div>
                              <p className={`text-xs font-semibold ${q.type === k ? 'text-blue-700' : 'text-[var(--color-text-primary)]'}`}>{v.label}</p>
                              <p className="text-[10px] text-[var(--color-text-tertiary)]">{v.desc}</p>
                            </div>
                          </button>
                        ))}
                      </div>
                    </div>
                    <div className="flex items-end pb-1">
                      <label className="flex items-center gap-2 cursor-pointer">
                        <div onClick={() => updQ(idx, { required: !q.required })}
                          className={`w-10 h-5 rounded-full transition-colors relative flex-shrink-0 ${q.required ? 'bg-blue-500' : 'bg-[var(--color-surface-2)]'}`}>
                          <div className={`absolute top-0.5 w-4 h-4 bg-[var(--color-surface)] rounded-full shadow transition-transform ${q.required ? 'translate-x-5' : 'translate-x-0.5'}`} />
                        </div>
                        <span className="text-xs font-medium text-[var(--color-text-secondary)]">บังคับตอบ</span>
                      </label>
                    </div>
                  </div>

                  {q.type === 'RATING' && (
                    <div className="flex gap-2 py-2">
                      {[1,2,3,4,5].map((n) => (
                        <div key={n} className="w-10 h-10 rounded-xl border-2 border-[var(--color-border)] flex items-center justify-center">
                          <Star className={`w-5 h-5 ${n <= 3 ? 'text-amber-400' : 'text-amber-500'}`} />
                        </div>
                      ))}
                      <span className="text-xs text-[var(--color-text-tertiary)] self-center ml-1">1 = น้อยที่สุด, 5 = มากที่สุด</span>
                    </div>
                  )}

                  {(q.type === 'SINGLE_CHOICE' || q.type === 'MULTI_CHOICE') && (
                    <div className="space-y-2">
                      <label className="form-label">ตัวเลือก</label>
                      {q.options.map((opt, oi) => (
                        <div key={oi} className="flex gap-2 items-center">
                          <div className={`w-4 h-4 flex-shrink-0 border-2 border-[var(--color-border)] ${q.type === 'MULTI_CHOICE' ? 'rounded' : 'rounded-full'}`} />
                          <input type="text" value={opt} onChange={(e) => updOption(idx, oi, e.target.value)}
                            placeholder={`ตัวเลือกที่ ${oi + 1}`} className="form-input flex-1" />
                          <button onClick={() => removeOption(idx, oi)}
                            className="w-7 h-7 rounded-lg flex items-center justify-center text-red-400 hover:bg-red-50 transition-colors flex-shrink-0">
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      ))}
                      <button onClick={() => addOption(idx)} className="text-xs text-blue-600 hover:underline font-semibold">
                        <Plus className="w-3 h-3 inline mr-1" />เพิ่มตัวเลือก
                      </button>
                    </div>
                  )}

                  {q.type === 'DEPT_SELECT' && (
                    <div className="flex items-center gap-3 p-3 rounded-xl bg-teal-50 border border-teal-100">
                      <Building2 className="w-5 h-5 text-teal-500 flex-shrink-0" />
                      <div>
                        <p className="text-xs font-semibold text-teal-700">ดึงรายชื่อแผนก/ฝ่ายจากฐานข้อมูลอัตโนมัติ</p>
                        <p className="text-[11px] text-teal-500 mt-0.5">ผู้ตอบจะเห็น dropdown เลือกแผนก/ฝ่ายที่มีอยู่ในระบบ</p>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          )
        })}

        {/* Add question */}
        <button onClick={() => { const nq = newQ(questions.length + 1); setQuestions((p) => [...p, nq]); setOpenIdx(questions.length) }}
          className="w-full border-2 border-dashed border-[var(--color-border)] hover:border-blue-400 hover:bg-blue-50/30 rounded-2xl py-4 flex items-center justify-center gap-2 text-sm font-semibold text-[var(--color-text-tertiary)] hover:text-blue-600 transition-all">
          <Plus className="w-5 h-5" /> เพิ่มคำถาม
        </button>
      </div>

      {/* Template Modal */}
      {showTemplateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setShowTemplateModal(false)}>
          <div className="bg-[var(--color-surface)] rounded-2xl shadow-2xl max-w-lg w-full mx-4 overflow-hidden" onClick={(e) => e.stopPropagation()}>
            <div className="p-6 border-b border-[var(--color-border)]">
              <h2 className="text-lg font-bold text-[var(--color-text-primary)]">สร้างจาก Template</h2>
              <p className="text-sm text-[var(--color-text-secondary)] mt-1">เลือก template สำเร็จรูปตามเอกสาร Survey.docx</p>
            </div>
            <div className="p-6">
              <div
                className="p-4 rounded-xl border-2 border-blue-200 bg-blue-50/50 cursor-pointer hover:border-blue-400 transition-colors"
                onClick={loadTemplate}
              >
                <div className="flex items-center gap-3 mb-2">
                  <div className="w-10 h-10 rounded-xl bg-blue-600 text-white flex items-center justify-center">
                    <FileText className="w-5 h-5" />
                  </div>
                  <div>
                    <p className="text-sm font-bold text-[var(--color-text-primary)]">แบบสำรวจความพึงพอใจ IT</p>
                    <p className="text-xs text-[var(--color-text-tertiary)]">ตามเอกสาร Survey.docx — 20 คำถาม</p>
                  </div>
                </div>
                <div className="text-xs text-[var(--color-text-secondary)] space-y-1 ml-[52px]">
                  <p>• ข้อมูลทั่วไป (พร้อมตัวเลือกประเภทอินเทอร์เน็ต) — 2 ข้อ</p>
                  <p>• ระบบอินเทอร์เน็ตผ่านสายแลน (LAN) — 3 ข้อ</p>
                  <p>• ระบบอินเทอร์เน็ตไร้สาย (Wi-Fi) — 4 ข้อ</p>
                  <p>• เครื่องพิมพ์และอุปกรณ์สำนักงาน — 3 ข้อ</p>
                  <p>• เครื่องคอมพิวเตอร์ (PC / Laptop) — 3 ข้อ</p>
                  <p>• การให้บริการของเจ้าหน้าที่ไอที — 3 ข้อ</p>
                  <p>• ข้อเสนอแนะและปัญหาที่พบบ่อย (ไม่บังคับ) — 2 ข้อ</p>
                </div>
              </div>
              <p className="text-xs text-amber-600 mt-3 flex items-center gap-1">
                ⚠️ การใช้ Template จะแทนที่คำถามทั้งหมดที่มีอยู่
              </p>
            </div>
            <div className="p-4 border-t border-[var(--color-border)] flex justify-end">
              <button onClick={() => setShowTemplateModal(false)} className="btn btn-ghost text-sm">ยกเลิก</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
