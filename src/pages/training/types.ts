// Training / Exam — shared types

export type QuestionType = 'SINGLE' | 'MULTI'

export interface Choice {
  text: string
  correct?: boolean
}

export interface TrainingQuestion {
  id: string
  text: string
  type: QuestionType
  points: number
  choices: Choice[]
  category: string | null
  source: string | null
  active: boolean
  created_at: string
}

export interface CategoryCount {
  category: string
  count: number
}

export type ExamStatus = 'DRAFT' | 'PUBLISHED'

export interface TrainingExam {
  id: string
  title: string
  description: string
  category: string | null
  shuffle_questions: boolean
  shuffle_choices: boolean
  question_count: number
  pass_percent: number
  duration_minutes: number
  max_violations: number
  status: ExamStatus
  created_at: string
  pool_size?: number
  invited?: number
  submitted?: number
}

export type CodeStatus = 'PENDING' | 'SENT' | 'STARTED' | 'SUBMITTED' | 'EXPIRED'
export type SubmitReason = 'MANUAL' | 'TIMEOUT' | 'VIOLATIONS'

export interface ExamResult {
  id: string
  code: string
  candidate_name: string | null
  candidate_email: string | null
  status: CodeStatus
  sent_at: string | null
  started_at: string | null
  submitted_at: string | null
  violations: number
  score: number | null
  max_score: number | null
  percent: number | null
  passed: boolean | null
  submit_reason: SubmitReason | null
}

export interface Sender {
  email: string
  label: string
}

export interface Employee {
  id: string
  name: string
  email: string
  department: string
  employeeId: string | null
}

// ── Public exam-taker payloads ────────────────────────────────────────────────
export interface ExamSnapshotQuestion {
  id: string
  text: string
  type: QuestionType
  points: number
  choices: { text: string }[]
}

export interface ExamResultPayload {
  score: number
  maxScore: number
  percent: number
  passed: boolean
  passPercent: number
  violations: number
  reason: SubmitReason
}

export interface ExamInfoResponse {
  success: boolean
  status: CodeStatus
  candidateName: string | null
  exam?: {
    title: string
    description: string
    category: string | null
    questionCount: number
    poolSize: number
    durationMinutes: number
    maxViolations: number
    passPercent: number
  }
  result?: ExamResultPayload
}

export interface ExamStartResponse {
  success: boolean
  status: 'STARTED' | 'SUBMITTED'
  result?: ExamResultPayload
  exam?: {
    title: string
    durationMinutes: number
    maxViolations: number
    passPercent: number
  }
  snapshot?: { questions: ExamSnapshotQuestion[] }
  savedAnswers?: Record<string, number[]>
  violations?: number
  deadlineAt?: string
  candidateName?: string | null
}

export interface ExamSubmitResponse {
  success: boolean
  alreadySubmitted?: boolean
  result: ExamResultPayload
}
