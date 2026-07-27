import { toast } from 'sonner';
import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import type { FillSurveyData, Question } from './types'

export default function FillSurveyPage() {
  const { token } = useParams<{ token: string }>()
  const navigate = useNavigate()
  const [data, setData] = useState<FillSurveyData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [answers, setAnswers] = useState<Record<string, unknown>>({})
  const [submitting, setSubmitting] = useState(false)
  const [currentSection, setCurrentSection] = useState(0)

  useEffect(() => {
    if (!token) return
    fetch(`/api/survey/surveys/token/${token}`)
      .then(async (r) => {
        if (!r.ok) {
          const e = await r.json().catch(() => ({}))
          if (r.status === 410) setError('ลิงก์นี้หมดอายุแล้ว กรุณาติดต่อผู้ดูแลระบบ')
          else if (r.status === 409) setError('ท่านได้ส่งแบบประเมินนี้ไปแล้ว')
          else if (r.status === 404) setError('ไม่พบแบบประเมิน')
          else setError(e.error || 'เกิดข้อผิดพลาด')
          return null
        }
        return r.json()
      })
      .then((d: FillSurveyData | null) => {
        if (!d) return
        setData(d)
        // Auto-fill DEPT_SELECT questions with the user's department
        if (d.user.department) {
          const prefill: Record<string, unknown> = {}
          d.survey.questions.forEach((q) => {
            if (q.type === 'DEPT_SELECT') prefill[q.id] = d.user.department
          })
          if (Object.keys(prefill).length > 0) setAnswers((prev) => ({ ...prev, ...prefill }))
        }
      })
      .catch(() => setError('ไม่สามารถเชื่อมต่อได้'))
      .finally(() => setLoading(false))
  }, [token])

  const rawQuestions = data?.survey.questions ?? []
  
  // Dynamic question filtering based on connection type
  const connTypeQ = rawQuestions.find(q => q.text.includes('ประเภทการเชื่อมต่ออินเทอร์เน็ตที่ท่านใช้เป็นหลัก'))
  const connTypeAnswer = connTypeQ ? answers[connTypeQ.id] as string : undefined

  const questions = rawQuestions.filter(q => {
    const isLan = q.text.includes('[ระบบอินเทอร์เน็ตผ่านสายแลน')
    const isWifi = q.text.includes('[ระบบอินเทอร์เน็ตไร้สาย')
    
    if (connTypeAnswer) {
      if (isLan && connTypeAnswer !== 'สายแลน (LAN)' && connTypeAnswer !== 'ใช้ทั้งสองอย่าง') return false
      if (isWifi && connTypeAnswer !== 'อินเทอร์เน็ตไร้สาย (Wi-Fi)' && connTypeAnswer !== 'ใช้ทั้งสองอย่าง') return false
    } else if (connTypeQ) {
      // If the question exists but hasn't been answered yet, hide both LAN and Wi-Fi sections
      if (isLan || isWifi) return false
    }
    return true
  })
  
  // Parse [Section] prefix from question text to group into named sections
  const sectionPattern = /^\[([^\]]+)\]\s*/
  const sectionMap: Record<string, Question[]> = {}
  const sectionOrder: string[] = []
  
  for (const q of questions) {
    const match = q.text.match(sectionPattern)
    const sectionName = match ? match[1] : 'แบบประเมิน'
    if (!sectionMap[sectionName]) {
      sectionMap[sectionName] = []
      sectionOrder.push(sectionName)
    }
    // Remove the prefix from the displayed text
    sectionMap[sectionName].push({ ...q, text: q.text.replace(sectionPattern, '') })
  }
  
  const sections = sectionOrder.map(name => ({ name, questions: sectionMap[name] }))
  const totalSections = Math.max(sections.length, 1)
  const currentSectionData = sections[currentSection]
  const currentQuestions = currentSectionData?.questions ?? []
  const isLastSection = currentSection === totalSections - 1

  function setAnswer(questionId: string, value: unknown) {
    setAnswers((prev) => ({ ...prev, [questionId]: value }))
  }

  function validateSection(): string | null {
    for (const q of currentQuestions) {
      if (!q.required) continue
      const v = answers[q.id]
      if (v === undefined || v === null || v === '') return `กรุณาตอบคำถาม: "${q.text}"`
      if (Array.isArray(v) && v.length === 0) return `กรุณาเลือกอย่างน้อย 1 ข้อสำหรับ: "${q.text}"`
    }
    return null
  }

  function handleNext() {
    const err = validateSection()
    if (err) { toast.error(err); return }
    setCurrentSection((s) => s + 1)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  async function handleSubmit() {
    const err = validateSection()
    if (err) { toast.error(err); return }
    if (!token) return
    setSubmitting(true)
    try {
      const payload = questions.map((q) => ({ questionId: q.id, answer: answers[q.id] ?? null }))
      const r = await fetch('/api/survey/surveys/responses', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, answers: payload }),
      })
      if (!r.ok) {
        const e = await r.json().catch(() => ({}))
        toast.error(e.error || 'เกิดข้อผิดพลาดในการส่ง')
        return
      }
      navigate(`/survey/fill/${token}/done`)
    } catch {
      toast.error('ไม่สามารถส่งแบบประเมินได้ กรุณาลองใหม่')
    } finally {
      setSubmitting(false)
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="animate-spin w-10 h-10 border-4 border-blue-500 border-t-transparent rounded-full" />
      </div>
    )
  }

  if (error) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
        <div className="text-center max-w-sm">
          <div className="w-14 h-14 rounded-full bg-red-100 flex items-center justify-center mx-auto mb-4">
            <svg className="w-7 h-7 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </div>
          <h1 className="text-lg font-semibold text-gray-800 mb-2">ไม่สามารถเปิดแบบประเมินได้</h1>
          <p className="text-sm text-gray-500">{error}</p>
        </div>
      </div>
    )
  }

  if (!data) return null

  const progress = questions.length > 0
    ? Math.round((Object.keys(answers).length / questions.length) * 100)
    : 0

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-gradient-to-r from-blue-700 to-blue-800 text-white">
        <div className="max-w-2xl mx-auto px-4 py-6">
          <div className="flex items-center gap-3 mb-3">
            <img
              src="https://tenforward.co.th/wp-content/uploads/2024/09/TEN_logo.webp"
              alt="TEN Forward"
              className="h-8 opacity-90"
              style={{ filter: 'brightness(0) invert(1)' }}
            />
          </div>
          <h1 className="text-lg font-bold">{data.survey.title}</h1>
          {data.survey.description && (
            <p className="text-blue-200 text-sm mt-1 whitespace-pre-line leading-relaxed">{data.survey.description}</p>
          )}
          <div className="flex items-center gap-2 mt-3 text-blue-200 text-sm">
            <span>สวัสดีคุณ <strong className="text-white">{data.user.firstName} {data.user.lastName}</strong></span>
          </div>
        </div>
      </div>

      {/* Progress */}
      {questions.length > 0 && (
        <div className="bg-white border-b border-gray-200 px-4 py-2 sticky top-0 z-10">
          <div className="max-w-2xl mx-auto">
            <div className="flex items-center justify-between text-xs text-gray-500 mb-1">
              <span>ความคืบหน้า</span>
              <span>{Object.keys(answers).length} / {questions.length} ข้อ</span>
            </div>
            <div className="w-full bg-gray-200 rounded-full h-1.5">
              <div className="bg-blue-600 h-1.5 rounded-full transition-all" style={{ width: `${progress}%` }} />
            </div>
          </div>
        </div>
      )}

      {/* Questions */}
      <div className="max-w-2xl mx-auto px-4 py-6 space-y-5">
        {totalSections > 1 && currentSectionData && (
          <div className="mb-6">
            <div className="text-center text-sm font-bold text-blue-600 mb-1 uppercase tracking-wide">
              ส่วนที่ {currentSection + 1} / {totalSections}
            </div>
            <h2 className="text-xl font-bold text-center text-gray-800">
              {currentSectionData.name}
            </h2>
            <div className="w-12 h-1 bg-blue-500 mx-auto mt-3 rounded-full opacity-50" />
          </div>
        )}

        {currentQuestions.map((q, idx) => (
          <QuestionCard
            key={q.id}
            question={q}
            index={sections.slice(0, currentSection).reduce((sum, s) => sum + s.questions.length, 0) + idx + 1}
            answer={answers[q.id]}
            onChange={(v) => setAnswer(q.id, v)}
          />
        ))}

        {/* Navigation */}
        <div className="flex items-center justify-between pt-4 pb-10">
          {currentSection > 0 ? (
            <button
              onClick={() => { setCurrentSection((s) => s - 1); window.scrollTo({ top: 0, behavior: 'smooth' }) }}
              className="px-5 py-2.5 rounded-lg border border-gray-300 text-gray-600 text-sm font-medium hover:bg-gray-100 transition-colors"
            >
              ← ย้อนกลับ
            </button>
          ) : <div />}

          {isLastSection ? (
            <button
              onClick={handleSubmit}
              disabled={submitting}
              className="px-8 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-semibold shadow-sm disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
            >
              {submitting ? 'กำลังส่ง...' : 'ส่งแบบประเมิน ✓'}
            </button>
          ) : (
            <button
              onClick={handleNext}
              className="px-8 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-semibold shadow-sm transition-colors"
            >
              ถัดไป →
            </button>
          )}
        </div>
      </div>

      {/* Footer */}
      <div className="border-t border-gray-200 py-5 text-center text-xs text-gray-400">
        IT Survey System — ISO 9001:2015 | ISO/IEC 27001:2022
      </div>
    </div>
  )
}

function QuestionCard({ question, index, answer, onChange }: {
  question: Question
  index: number
  answer: unknown
  onChange: (v: unknown) => void
}) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
      <div className="flex items-start gap-3 mb-4">
        <span className="flex-shrink-0 w-7 h-7 rounded-full bg-blue-600 text-white text-xs font-bold flex items-center justify-center mt-0.5">
          {index}
        </span>
        <p className="text-sm font-medium text-gray-800 leading-relaxed">
          {question.text}
          {question.required && <span className="text-red-500 ml-1">*</span>}
        </p>
      </div>

      {question.type === 'RATING' && (
        <div className="flex gap-2 flex-wrap pl-10">
          {[1, 2, 3, 4, 5].map((n) => (
            <button
              key={n}
              onClick={() => onChange(n)}
              className={`w-12 h-12 rounded-xl border-2 font-bold text-base transition-all ${
                answer === n
                  ? 'border-blue-600 bg-blue-600 text-white shadow-md scale-105'
                  : 'border-gray-200 bg-white text-gray-600 hover:border-blue-400 hover:bg-blue-50'
              }`}
            >
              {n}
            </button>
          ))}
          <div className="w-full flex justify-between text-xs text-gray-400 px-1 mt-1">
            <span>น้อยที่สุด</span>
            <span>มากที่สุด</span>
          </div>
        </div>
      )}

      {question.type === 'TEXT' && (
        <div className="pl-10">
          <textarea
            rows={3}
            value={(answer as string) ?? ''}
            onChange={(e) => onChange(e.target.value)}
            placeholder="พิมพ์คำตอบของท่านที่นี่..."
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-800 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-200 resize-none placeholder-gray-400"
          />
        </div>
      )}

      {question.type === 'SINGLE_CHOICE' && (
        <div className="pl-10 space-y-2">
          {(question.options ?? []).map((opt) => (
            <label key={opt} className="flex items-center gap-3 cursor-pointer group">
              <input
                type="radio"
                name={question.id}
                value={opt}
                checked={answer === opt}
                onChange={() => onChange(opt)}
                className="w-4 h-4 accent-blue-600"
              />
              <span className="text-sm text-gray-700 group-hover:text-gray-900">{opt}</span>
            </label>
          ))}
        </div>
      )}

      {question.type === 'MULTI_CHOICE' && (
        <div className="pl-10 space-y-3">
          {(question.options ?? []).map((opt) => {
            const selected = Array.isArray(answer) ? answer as string[] : []
            
            const getBaseAndText = (val: string) => {
              const parts = val.split(':::')
              return { base: parts[0], text: parts[1] || '' }
            }
            
            const isChecked = selected.some(s => getBaseAndText(s).base === opt)
            const currentText = selected.find(s => getBaseAndText(s).base === opt)
            const detailText = currentText ? getBaseAndText(currentText).text : ''
            
            const handleCheck = (checked: boolean) => {
              if (checked) {
                onChange([...selected, opt])
              } else {
                onChange(selected.filter(s => getBaseAndText(s).base !== opt))
              }
            }
            
            const handleTextChange = (text: string) => {
              const val = text ? `${opt}:::${text}` : opt
              onChange(selected.map(s => getBaseAndText(s).base === opt ? val : s))
            }
            
            // Determine if this option needs a text input
            let inputLabel = null
            if (opt.includes('Wi-Fi หลุดบ่อย')) inputLabel = 'บริเวณ :'
            else if (opt.includes('คอมพิวเตอร์ช้า')) inputLabel = 'ตอนใช้งานโปรแกรม :'
            else if (opt.includes('อื่นๆ')) inputLabel = 'ระบุ :'

            return (
              <div key={opt} className="flex flex-col gap-2">
                <label className="flex items-center gap-3 cursor-pointer group">
                  <input
                    type="checkbox"
                    checked={isChecked}
                    onChange={(e) => handleCheck(e.target.checked)}
                    className="w-4 h-4 accent-blue-600"
                  />
                  <span className="text-sm text-gray-700 group-hover:text-gray-900">{opt}</span>
                </label>
                {isChecked && inputLabel && (
                  <div className="ml-7 flex items-center gap-2">
                    <span className="text-sm text-gray-500">{inputLabel}</span>
                    <input
                      type="text"
                      value={detailText}
                      onChange={(e) => handleTextChange(e.target.value)}
                      placeholder="พิมพ์รายละเอียด..."
                      className="form-input text-sm py-1 px-3 bg-white border border-gray-300 rounded-md w-full max-w-xs focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {question.type === 'DEPT_SELECT' && (
        <div className="pl-10">
          <div className="flex items-center gap-2 px-3 py-2 bg-blue-50 border border-blue-200 rounded-lg">
            <svg className="w-4 h-4 text-blue-500 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-2 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
            </svg>
            <span className="text-sm font-medium text-blue-800">
              {(answer as string) || 'ไม่ระบุแผนก'}
            </span>
          </div>
          <p className="text-xs text-gray-400 mt-1.5">แผนก/ฝ่ายถูกกำหนดตามข้อมูลของท่านในระบบ</p>
        </div>
      )}
    </div>
  )
}
