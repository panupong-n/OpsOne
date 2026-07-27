import { useCallback, useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { ShieldAlert, Clock, CheckCircle2, XCircle, Lock, AlertTriangle, ListChecks, Percent, Maximize, ArrowLeft } from 'lucide-react'
import { examApi } from './api'
import type { ExamSnapshotQuestion, ExamResultPayload, ExamInfoResponse } from './types'

type Phase = 'gate' | 'lobby' | 'running' | 'result'
type ExamInfo = NonNullable<ExamInfoResponse['exam']>

interface RunningState {
  code: string
  title: string
  maxViolations: number
  passPercent: number
  questions: ExamSnapshotQuestion[]
  deadlineAt: number
}

// Best-effort fullscreen helpers (kept out of the component for clarity).
function requestFullscreen(el: HTMLElement) {
  const anyEl = el as HTMLElement & { webkitRequestFullscreen?: () => Promise<void> }
  ;(el.requestFullscreen?.() ?? anyEl.webkitRequestFullscreen?.())?.catch(() => {})
}
function exitFullscreen() {
  const anyDoc = document as Document & { webkitExitFullscreen?: () => Promise<void> }
  if (document.fullscreenElement) (document.exitFullscreen?.() ?? anyDoc.webkitExitFullscreen?.())?.catch(() => {})
}

export default function ExamPage() {
  const [params] = useSearchParams()
  const [phase, setPhase] = useState<Phase>('gate')
  const [code, setCode] = useState((params.get('code') || '').toUpperCase())
  const [checking, setChecking] = useState(false)
  const [starting, setStarting] = useState(false)
  const [gateError, setGateError] = useState('')
  const [info, setInfo] = useState<ExamInfo | null>(null)
  const [candidateName, setCandidateName] = useState<string | null>(null)
  const [resuming, setResuming] = useState(false)

  const [run, setRun] = useState<RunningState | null>(null)
  const [answers, setAnswers] = useState<Record<string, number[]>>({})
  const [violations, setViolations] = useState(0)
  const [warn, setWarn] = useState<{ count: number; max: number } | null>(null)
  const [remaining, setRemaining] = useState(0)
  const [result, setResult] = useState<ExamResultPayload | null>(null)

  const answersRef = useRef(answers); answersRef.current = answers
  const submittingRef = useRef(false)
  const cooldownRef = useRef(0)
  const runRef = useRef<RunningState | null>(null); runRef.current = run

  // ── Submit (server grades) ──────────────────────────────────────────────────
  const doSubmit = useCallback(async (reason: 'MANUAL' | 'TIMEOUT' | 'VIOLATIONS') => {
    if (submittingRef.current || !runRef.current) return
    submittingRef.current = true
    try {
      const r = await examApi.submit(runRef.current.code, answersRef.current, reason)
      setResult(r.result)
      setPhase('result')
      exitFullscreen()
    } catch {
      submittingRef.current = false
      setWarn(null)
      alert('ส่งคำตอบไม่สำเร็จ กรุณาลองอีกครั้ง')
    }
  }, [])

  // ── Register a proctoring violation (server-authoritative) ───────────────────
  const registerViolation = useCallback(async (kind: string) => {
    if (submittingRef.current || !runRef.current) return
    const now = Date.now()
    if (now < cooldownRef.current) return   // coalesce burst events (blur+visibility fire together)
    cooldownRef.current = now + 1200
    try {
      const v = await examApi.violation(runRef.current.code, kind)
      setViolations(v.violations)
      setWarn({ count: v.violations, max: v.max })
      if (v.limitReached) {
        setTimeout(() => doSubmit('VIOLATIONS'), 400)
      }
    } catch { /* ignore network blip */ }
  }, [doSubmit])

  // ── Anti-cheat listeners (only while running) ────────────────────────────────
  // Browsers cannot physically trap the cursor inside the screen while keeping a
  // visible/clickable pointer (only Pointer Lock can confine it, and that hides
  // the cursor — unusable for an exam). So we DETECT and count every escape:
  //   • mouse leaving the viewport/window (e.g. dragged to another monitor)
  //   • switching tab or window (visibility / blur)
  //   • leaving fullscreen
  // The 1200ms cooldown in registerViolation stops a single action counting twice.
  useEffect(() => {
    if (phase !== 'running') return
    const onVisibility = () => { if (document.hidden) registerViolation('tab-hidden') }
    const onBlur = () => registerViolation('window-blur')
    // Mouse left the document to outside the window (relatedTarget/toElement null).
    const onMouseOut = (e: MouseEvent) => {
      if (!e.relatedTarget && !(e as MouseEvent & { toElement?: Node }).toElement) registerViolation('mouse-left')
    }
    const onFsChange = () => { if (!document.fullscreenElement) registerViolation('exit-fullscreen') }
    const block = (e: Event) => e.preventDefault()

    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('blur', onBlur)
    document.addEventListener('mouseout', onMouseOut)
    document.addEventListener('fullscreenchange', onFsChange)
    document.addEventListener('contextmenu', block)
    document.addEventListener('copy', block)
    document.addEventListener('cut', block)
    return () => {
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('blur', onBlur)
      document.removeEventListener('mouseout', onMouseOut)
      document.removeEventListener('fullscreenchange', onFsChange)
      document.removeEventListener('contextmenu', block)
      document.removeEventListener('copy', block)
      document.removeEventListener('cut', block)
    }
  }, [phase, registerViolation])

  // ── Countdown timer ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (phase !== 'running' || !run) return
    const tick = () => {
      const secs = Math.max(0, Math.round((run.deadlineAt - Date.now()) / 1000))
      setRemaining(secs)
      if (secs <= 0) doSubmit('TIMEOUT')
    }
    tick()
    const iv = setInterval(tick, 1000)
    return () => clearInterval(iv)
  }, [phase, run, doSubmit])

  // ── Autosave (debounced) ─────────────────────────────────────────────────────
  useEffect(() => {
    if (phase !== 'running' || !run) return
    const t = setTimeout(() => { examApi.answer(run.code, answersRef.current).catch(() => {}) }, 1500)
    return () => clearTimeout(t)
  }, [answers, phase, run])

  // ── Warn banner auto-dismiss ─────────────────────────────────────────────────
  useEffect(() => {
    if (!warn) return
    const t = setTimeout(() => setWarn(null), 3500)
    return () => clearTimeout(t)
  }, [warn])

  // Step 1 (gate): look up the code and show the lobby with details — no timer yet.
  const checkCode = async () => {
    const c = code.trim().toUpperCase()
    if (!c) { setGateError('กรุณากรอกรหัสเข้าสอบ'); return }
    setGateError(''); setChecking(true)
    try {
      const r = await examApi.info(c)
      if (r.status === 'SUBMITTED' && r.result) { setResult(r.result); setPhase('result'); return }
      if (!r.exam) { setGateError('ไม่พบรายละเอียดแบบทดสอบ'); return }
      setInfo(r.exam); setCandidateName(r.candidateName); setResuming(r.status === 'STARTED'); setPhase('lobby')
    } catch (e) {
      setGateError(e instanceof Error ? e.message : 'ตรวจสอบรหัสไม่สำเร็จ')
    } finally {
      setChecking(false)
    }
  }

  // Step 2 (lobby): the "เริ่มสอบ" click — this gesture triggers fullscreen, then
  // freezes the questions + starts the server-side timer.
  const beginExam = async () => {
    const c = code.trim().toUpperCase()
    setStarting(true)
    requestFullscreen(document.documentElement)  // must run inside the click gesture
    try {
      const r = await examApi.start(c)
      if (r.status === 'SUBMITTED' && r.result) {
        setResult(r.result); setPhase('result'); exitFullscreen(); return
      }
      if (r.status === 'STARTED' && r.exam && r.snapshot && r.deadlineAt) {
        submittingRef.current = false
        setRun({
          code: c, title: r.exam.title, maxViolations: r.exam.maxViolations, passPercent: r.exam.passPercent,
          questions: r.snapshot.questions, deadlineAt: new Date(r.deadlineAt).getTime(),
        })
        setAnswers(r.savedAnswers || {})
        setViolations(r.violations || 0)
        setPhase('running')
      }
    } catch (e) {
      exitFullscreen()
      alert(e instanceof Error ? e.message : 'เริ่มทำแบบทดสอบไม่สำเร็จ')
    } finally {
      setStarting(false)
    }
  }

  const toggleAnswer = (q: ExamSnapshotQuestion, choiceIdx: number) => {
    setAnswers(prev => {
      const cur = prev[q.id] || []
      if (q.type === 'SINGLE') return { ...prev, [q.id]: [choiceIdx] }
      return { ...prev, [q.id]: cur.includes(choiceIdx) ? cur.filter(i => i !== choiceIdx) : [...cur, choiceIdx] }
    })
  }

  // ═══════════════ RENDER ═══════════════
  if (phase === 'gate') {
    return (
      <div className="min-h-screen flex items-center justify-center p-4" style={{ background: 'linear-gradient(135deg,#1e3a8a,#2563eb)' }}>
        <div className="w-full max-w-md rounded-3xl p-8 bg-white shadow-2xl">
          <div className="flex justify-center mb-4"><div className="w-14 h-14 rounded-2xl flex items-center justify-center" style={{ background: '#EFF6FF' }}><Lock className="w-7 h-7" style={{ color: '#2563EB' }} /></div></div>
          <h1 className="text-xl font-bold text-center text-gray-900">ระบบทดสอบออนไลน์</h1>
          <p className="text-sm text-center text-gray-500 mt-1 mb-6">กรอกรหัสเข้าสอบที่ได้รับทางอีเมล</p>
          <input
            className="w-full text-center text-2xl font-mono font-bold tracking-[0.4em] uppercase border-2 border-gray-200 rounded-xl py-3.5 focus:border-blue-500 outline-none text-gray-900"
            placeholder="XXXXXXXX" maxLength={16} value={code}
            onChange={e => setCode(e.target.value.toUpperCase())}
            onKeyDown={e => e.key === 'Enter' && checkCode()}
          />
          {gateError && <p className="text-sm text-red-600 text-center mt-3">{gateError}</p>}
          <button className="w-full mt-5 py-3.5 rounded-xl font-bold text-white text-base disabled:opacity-60"
            style={{ background: '#2563EB' }} onClick={checkCode} disabled={checking}>
            {checking ? 'กำลังตรวจสอบ...' : 'ตรวจสอบรหัส'}
          </button>
          <div className="mt-6 rounded-xl p-3 flex gap-2" style={{ background: '#FFFBEB' }}>
            <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" style={{ color: '#D97706' }} />
            <p className="text-xs" style={{ color: '#92400E' }}>
              การสอบจะทำในโหมดเต็มจอ ห้ามสลับแท็บ/หน้าต่าง ออกจากเต็มจอ หรือเลื่อนเมาส์ออกนอกจอ หากละเมิดเกินจำนวนที่กำหนด ระบบจะส่งคำตอบและจบการสอบทันที
            </p>
          </div>
        </div>
      </div>
    )
  }

  if (phase === 'lobby' && info) {
    const stats = [
      { icon: <ListChecks className="w-5 h-5" />, label: 'จำนวนข้อ', value: `${info.questionCount} ข้อ` },
      { icon: <Clock className="w-5 h-5" />, label: 'เวลาสอบ', value: `${info.durationMinutes} นาที` },
      { icon: <Percent className="w-5 h-5" />, label: 'เกณฑ์ผ่าน', value: `${info.passPercent}%` },
      { icon: <ShieldAlert className="w-5 h-5" />, label: 'ละเมิดได้', value: `${info.maxViolations} ครั้ง` },
    ]
    return (
      <div className="min-h-screen flex items-center justify-center p-4" style={{ background: 'linear-gradient(135deg,#1e3a8a,#2563eb)' }}>
        <div className="w-full max-w-lg rounded-3xl p-8 bg-white shadow-2xl">
          <button className="inline-flex items-center gap-1 text-sm text-gray-400 hover:text-gray-600 mb-4" onClick={() => setPhase('gate')}>
            <ArrowLeft className="w-4 h-4" /> เปลี่ยนรหัส
          </button>
          <p className="text-xs font-bold uppercase tracking-widest text-blue-600">รายละเอียดแบบทดสอบ</p>
          <h1 className="text-2xl font-bold text-gray-900 mt-1">{info.title}</h1>
          {info.description && <p className="text-sm text-gray-500 mt-1">{info.description}</p>}
          {candidateName && <p className="text-sm text-gray-600 mt-2">ผู้เข้าสอบ: <b>{candidateName}</b></p>}

          <div className="grid grid-cols-2 gap-3 my-6">
            {stats.map(s => (
              <div key={s.label} className="rounded-xl p-4 flex items-center gap-3" style={{ background: '#F8FAFC', border: '1px solid #E2E8F0' }}>
                <span className="text-blue-600">{s.icon}</span>
                <div>
                  <p className="text-lg font-bold text-gray-900 leading-tight">{s.value}</p>
                  <p className="text-xs text-gray-500">{s.label}</p>
                </div>
              </div>
            ))}
          </div>

          <div className="rounded-xl p-4" style={{ background: '#FFFBEB', border: '1px solid #FDE68A' }}>
            <p className="text-sm font-bold flex items-center gap-1.5" style={{ color: '#92400E' }}><AlertTriangle className="w-4 h-4" /> กติกาการสอบ</p>
            <ul className="text-xs mt-2 space-y-1 list-disc pl-5" style={{ color: '#92400E' }}>
              <li>เมื่อกด "เริ่มสอบ" ระบบจะขยายเป็นเต็มจอและเริ่มจับเวลาทันที</li>
              <li>ห้ามสลับแท็บ/หน้าต่าง ออกจากเต็มจอ หรือเลื่อนเมาส์ออกนอกจอ — นับเป็นการละเมิดทุกกรณี</li>
              <li>ละเมิดครบ {info.maxViolations} ครั้ง ระบบจะส่งคำตอบและจบการสอบทันที</li>
              <li>เมื่อหมดเวลา ระบบจะส่งคำตอบให้อัตโนมัติ และแสดงคะแนนทันที</li>
            </ul>
          </div>

          <button className="w-full mt-6 py-4 rounded-xl font-bold text-white text-lg inline-flex items-center justify-center gap-2 disabled:opacity-60"
            style={{ background: '#059669' }} onClick={beginExam} disabled={starting}>
            <Maximize className="w-5 h-5" /> {starting ? 'กำลังเข้าห้องสอบ...' : resuming ? 'เข้าห้องสอบต่อ' : 'เริ่มสอบ'}
          </button>
        </div>
      </div>
    )
  }

  if (phase === 'result' && result) {
    const pass = result.passed
    return (
      <div className="min-h-screen flex items-center justify-center p-4" style={{ background: pass ? 'linear-gradient(135deg,#065f46,#059669)' : 'linear-gradient(135deg,#7f1d1d,#dc2626)' }}>
        <div className="w-full max-w-md rounded-3xl p-8 bg-white shadow-2xl text-center">
          <div className="flex justify-center mb-3">
            {pass ? <CheckCircle2 className="w-16 h-16" style={{ color: '#059669' }} /> : <XCircle className="w-16 h-16" style={{ color: '#DC2626' }} />}
          </div>
          <h1 className="text-2xl font-bold text-gray-900">{pass ? 'ผ่านการทดสอบ' : 'ไม่ผ่านการทดสอบ'}</h1>
          <p className="text-5xl font-black my-4" style={{ color: pass ? '#059669' : '#DC2626' }}>{result.percent}%</p>
          <p className="text-gray-600">ได้ {result.score} จาก {result.maxScore} คะแนน</p>
          <p className="text-sm text-gray-400 mt-1">เกณฑ์ผ่าน {result.passPercent}%</p>
          {result.reason === 'VIOLATIONS' && (
            <div className="mt-5 rounded-xl p-3 text-sm font-semibold" style={{ background: '#FEF2F2', color: '#B91C1C' }}>
              ⚠️ ระบบส่งคำตอบอัตโนมัติ เนื่องจากละเมิดการทำข้อสอบครบ {result.violations} ครั้ง
            </div>
          )}
          {result.reason === 'TIMEOUT' && (
            <div className="mt-5 rounded-xl p-3 text-sm font-semibold" style={{ background: '#FFFBEB', color: '#B45309' }}>
              ⏱ หมดเวลาทำข้อสอบ ระบบส่งคำตอบอัตโนมัติ
            </div>
          )}
          {result.violations > 0 && result.reason !== 'VIOLATIONS' && (
            <p className="text-xs text-gray-400 mt-3">บันทึกการละเมิด {result.violations} ครั้ง</p>
          )}
        </div>
      </div>
    )
  }

  if (phase === 'running' && run) {
    const answeredCount = run.questions.filter(q => (answers[q.id] || []).length > 0).length
    const mm = String(Math.floor(remaining / 60)).padStart(2, '0')
    const ss = String(remaining % 60).padStart(2, '0')
    const low = remaining <= 60
    return (
      <div className="min-h-screen" style={{ background: 'var(--color-neo-bg, #F1F5F9)' }}>
        {/* Sticky top bar */}
        <div className="sticky top-0 z-40 px-4 py-3 flex items-center justify-between gap-3 bg-white shadow-sm">
          <div className="min-w-0">
            <p className="font-bold truncate text-gray-900">{run.title}</p>
            <p className="text-xs text-gray-500">ตอบแล้ว {answeredCount}/{run.questions.length} ข้อ</p>
          </div>
          <div className="flex items-center gap-3 flex-shrink-0">
            <span className="inline-flex items-center gap-1.5 text-sm font-semibold" style={{ color: violations > 0 ? '#DC2626' : '#6B7280' }}>
              <ShieldAlert className="w-4 h-4" /> {violations}/{run.maxViolations}
            </span>
            <span className={`inline-flex items-center gap-1.5 font-mono font-bold text-lg px-3 py-1 rounded-lg ${low ? 'animate-pulse' : ''}`}
              style={{ background: low ? '#FEF2F2' : '#EFF6FF', color: low ? '#DC2626' : '#2563EB' }}>
              <Clock className="w-4 h-4" /> {mm}:{ss}
            </span>
          </div>
        </div>

        {/* Questions */}
        <div className="max-w-3xl mx-auto p-4 space-y-4 pb-28">
          {run.questions.map((q, qi) => {
            const sel = answers[q.id] || []
            return (
              <div key={q.id} className="rounded-2xl p-5 bg-white shadow-sm select-none">
                <div className="flex items-start gap-2 mb-3">
                  <span className="flex-shrink-0 w-7 h-7 rounded-lg flex items-center justify-center text-sm font-bold text-white" style={{ background: '#2563EB' }}>{qi + 1}</span>
                  <p className="font-medium text-gray-900 pt-0.5">{q.text}</p>
                </div>
                {q.type === 'MULTI' && <p className="text-xs mb-2 ml-9" style={{ color: '#7C3AED' }}>เลือกได้มากกว่า 1 คำตอบ</p>}
                <div className="space-y-2 ml-9">
                  {q.choices.map((c, ci) => {
                    const active = sel.includes(ci)
                    return (
                      <button key={ci} onClick={() => toggleAnswer(q, ci)}
                        className="w-full text-left flex items-center gap-3 px-4 py-3 rounded-xl border-2 transition-colors"
                        style={{ borderColor: active ? '#2563EB' : '#E5E7EB', background: active ? '#EFF6FF' : '#fff' }}>
                        <span className={`flex-shrink-0 w-5 h-5 flex items-center justify-center border-2 ${q.type === 'MULTI' ? 'rounded' : 'rounded-full'}`}
                          style={{ borderColor: active ? '#2563EB' : '#9CA3AF', background: active ? '#2563EB' : '#fff' }}>
                          {active && <span className="w-2 h-2 bg-white rounded-full" />}
                        </span>
                        <span className="text-sm text-gray-800">{c.text}</span>
                      </button>
                    )
                  })}
                </div>
              </div>
            )
          })}
        </div>

        {/* Submit bar */}
        <div className="fixed bottom-0 left-0 right-0 z-40 px-4 py-3 bg-white border-t border-gray-200">
          <div className="max-w-3xl mx-auto flex items-center justify-between gap-3">
            <span className="text-sm text-gray-500">ตอบแล้ว {answeredCount}/{run.questions.length}</span>
            <button className="px-8 py-3 rounded-xl font-bold text-white disabled:opacity-60" style={{ background: '#059669' }}
              onClick={() => { if (confirm(`ยืนยันส่งคำตอบ? (ตอบแล้ว ${answeredCount}/${run.questions.length} ข้อ)`)) doSubmit('MANUAL') }}>
              ส่งคำตอบ
            </button>
          </div>
        </div>

        {/* Violation warning overlay */}
        {warn && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.55)' }}>
            <div className="w-full max-w-sm rounded-2xl p-6 bg-white text-center shadow-2xl">
              <AlertTriangle className="w-14 h-14 mx-auto mb-3" style={{ color: '#DC2626' }} />
              <h3 className="text-lg font-bold text-gray-900">ตรวจพบการละเมิดการทำข้อสอบ</h3>
              <p className="text-sm text-gray-600 mt-2">
                กรุณาอยู่ในหน้าต่างสอบแบบเต็มจอตลอดการทำข้อสอบ<br />
                ห้ามสลับหน้าจอหรือเลื่อนเมาส์ออกนอกจอ
              </p>
              <p className="text-2xl font-black mt-3" style={{ color: '#DC2626' }}>ครั้งที่ {warn.count} / {warn.max}</p>
              {warn.count >= warn.max
                ? <p className="text-sm font-semibold mt-2" style={{ color: '#B91C1C' }}>ละเมิดครบ — กำลังส่งคำตอบ...</p>
                : <button className="mt-4 px-6 py-2.5 rounded-xl font-semibold text-white" style={{ background: '#2563EB' }}
                    onClick={() => { setWarn(null); requestFullscreen(document.documentElement) }}>รับทราบ กลับเข้าสอบ</button>}
            </div>
          </div>
        )}
      </div>
    )
  }

  return null
}
