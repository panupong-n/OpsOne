// ISO Survey Platform — API Service
// Uses OpsOne's TENCYBER accessToken from sessionStorage

function getToken(): string {
  try {
    const raw = sessionStorage.getItem('tencyber_session')
    if (!raw) return ''
    const session = JSON.parse(raw)
    return session?.accessToken || ''
  } catch {
    return ''
  }
}

interface RequestOptions {
  method?: string
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  body?: any
  params?: Record<string, string>
}

interface SurveyApiResponse<T = unknown> {
  data: T
  status: number
}

async function request<T = unknown>(path: string, options: RequestOptions = {}): Promise<SurveyApiResponse<T>> {
  const token = getToken()
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (token) headers['Authorization'] = `Bearer ${token}`

  let url = `/api/survey${path}`
  if (options.params) {
    const qs = new URLSearchParams(options.params).toString()
    if (qs) url += `?${qs}`
  }

  const res = await fetch(url, {
    method: options.method ?? 'GET',
    headers,
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  })

  if (res.status === 401) {
    window.location.href = '/login'
    return Promise.reject(new Error('Unauthorized'))
  }

  const data = (await res.json()) as T

  if (!res.ok) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const err = data as any
    return Promise.reject({ response: { data: err, status: res.status } })
  }

  return { data, status: res.status }
}

const surveyApi = {
  get: <T = unknown>(path: string, options?: { params?: Record<string, string> }) =>
    request<T>(path, { method: 'GET', params: options?.params }),
  post: <T = unknown>(path: string, body?: unknown) =>
    request<T>(path, { method: 'POST', body }),
  put: <T = unknown>(path: string, body?: unknown) =>
    request<T>(path, { method: 'PUT', body }),
  delete: <T = unknown>(path: string) =>
    request<T>(path, { method: 'DELETE' }),
}

export default surveyApi
