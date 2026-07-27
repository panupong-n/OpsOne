// Training / Exam — API clients.
// Admin client hits /api/training (TENCYBER Bearer auth, SSO). The public exam
// client hits /api/exam with NO auth — the exam code is the only credential.

function getToken(): string {
  try {
    const raw = sessionStorage.getItem('tencyber_session')
    if (!raw) return ''
    return JSON.parse(raw)?.accessToken || ''
  } catch {
    return ''
  }
}

interface Envelope<T> { success: boolean; data: T; error?: string }

async function adminRequest<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
  const token = getToken()
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (token) headers['Authorization'] = `Bearer ${token}`
  const res = await fetch(`/api/training${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
  if (res.status === 401) {
    window.location.href = '/login'
    return Promise.reject(new Error('Unauthorized'))
  }
  const json = (await res.json().catch(() => ({}))) as Envelope<T>
  if (!res.ok || json.success === false) {
    throw new Error(json?.error || `เกิดข้อผิดพลาด (${res.status})`)
  }
  return json.data
}

export const trainingApi = {
  get: <T>(path: string) => adminRequest<T>(path, 'GET'),
  post: <T>(path: string, body?: unknown) => adminRequest<T>(path, 'POST', body),
  put: <T>(path: string, body?: unknown) => adminRequest<T>(path, 'PUT', body),
  del: <T>(path: string) => adminRequest<T>(path, 'DELETE'),
}

// ── Public exam client (no auth) ──────────────────────────────────────────────
async function examRequest<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`/api/exam${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>
  if (!res.ok || json.success === false) {
    throw new Error((json.error as string) || `เกิดข้อผิดพลาด (${res.status})`)
  }
  return json as T
}

export const examApi = {
  info: (code: string) => examRequest<import('./types').ExamInfoResponse>('/info', { code }),
  start: (code: string) => examRequest<import('./types').ExamStartResponse>('/start', { code }),
  answer: (code: string, answers: Record<string, number[]>) =>
    examRequest<{ success: boolean; saved: boolean }>('/answer', { code, answers }),
  violation: (code: string, kind: string) =>
    examRequest<{ success: boolean; violations: number; max: number; limitReached: boolean }>('/violation', { code, kind }),
  submit: (code: string, answers: Record<string, number[]>, reason: string) =>
    examRequest<import('./types').ExamSubmitResponse>('/submit', { code, answers, reason }),
}
