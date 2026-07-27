// ISO Survey Platform — Shared Types

export interface SurveyUser {
  id: string
  email: string
  firstName: string
  lastName: string
  employeeId: string
  department?: string
  company?: string
  role: 'admin' | 'user' | 'viewer' | 'respondent'
  isActive: boolean
  createdAt: string
  _count?: { assignments: number }
}

export interface Survey {
  id: string
  title: string
  description?: string
  version: number
  status: 'DRAFT' | 'PUBLISHED' | 'ARCHIVED'
  createdById: string
  createdAt: string
  updatedAt: string
  createdBy?: { firstName: string; lastName: string }
  questions?: Question[]
  _count?: { questions: number; assignments: number }
}

export interface Question {
  id: string
  surveyId: string
  text: string
  type: 'RATING' | 'TEXT' | 'SINGLE_CHOICE' | 'MULTI_CHOICE' | 'DEPT_SELECT'
  options?: string[]
  order: number
  required: boolean
}

export interface SurveyAssignment {
  id: string
  surveyId: string
  userId: string
  token: string
  tokenExpiresAt: string
  displayExpiresAt?: string
  status: 'PENDING' | 'SENT' | 'OPENED' | 'COMPLETED' | 'EXPIRED'
  assignedAt: string
  sentAt?: string
  openedAt?: string
  completedAt?: string
  user?: {
    firstName: string
    lastName: string
    email: string
    employeeId: string
    department?: string
  }
  survey?: { title: string; createdAt?: string }
}

export interface DashboardStats {
  totalUsers: number
  totalSurveys: number
  totalAssigned: number
  completed: number
  pending: number
  opened: number
  expired: number
  completionRate: number
  completedThisMonth: number
  satisfactionPercent?: number
  satisfactionBySurvey?: Record<string, number>
  completionBySurvey?: Record<string, { completed: number; pending: number; opened: number; expired: number }>
}

export interface SurveyCompletionItem {
  id: string
  title: string
  total: number
  completed: number
  rate: number
  createdAt?: string
  satisfactionScore?: number
}

export interface AuditLog {
  id: string
  actorId?: string
  userId?: string
  action: string
  entity: string
  entityId?: string
  details?: string | Record<string, unknown>
  metadata?: Record<string, unknown>
  ipAddress?: string
  createdAt: string
  user?: { firstName: string; lastName: string }
}

export interface FillSurveyData {
  survey: {
    id: string
    title: string
    description?: string
    questions: Question[]
  }
  user: { firstName: string; lastName: string; employeeId: string; department: string }
  assignmentId: string
  expiresAt: string
}

export interface QuestionStat {
  id: string
  text: string
  type: string
  order: number
  avg: number | null
  count: number
  distribution: Record<string, number>
  textAnswers?: string[]
}

export interface SectionData {
  name: string
  questions: QuestionStat[]
}

export interface DeptBreakdown {
  department: string
  count: number
  overallAvg: number
  questionAvgs: { questionId: string; avg: number; count: number }[]
}

export interface SurveyReport {
  survey: { id: string; title: string; description: string; createdAt: string }
  summary: { totalAssigned: number; totalCompleted: number; completionRate: number; overallAvg: number; satisfactionScore?: number; scoreMethod?: 'simple' | 'weighted' }
  sections: SectionData[]
  deptBreakdown: DeptBreakdown[]
  generatedAt: string
}
