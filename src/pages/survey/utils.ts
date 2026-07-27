// Survey date/time utilities — Thai Buddhist Era (พ.ศ.)

export function thaiDate(dateStr: string | null | undefined): string {
  if (!dateStr) return '—'
  try {
    const d = new Date(dateStr)
    if (isNaN(d.getTime())) return '—'
    return d.toLocaleDateString('th-TH', { year: 'numeric', month: 'long', day: 'numeric' })
  } catch { return '—' }
}

export function thaiDateShort(dateStr: string | null | undefined): string {
  if (!dateStr) return '—'
  try {
    const d = new Date(dateStr)
    if (isNaN(d.getTime())) return '—'
    return d.toLocaleDateString('th-TH', { year: 'numeric', month: 'short', day: 'numeric' })
  } catch { return '—' }
}

export function thaiDateTime(dateStr: string | null | undefined): string {
  if (!dateStr) return '—'
  try {
    const d = new Date(dateStr)
    if (isNaN(d.getTime())) return '—'
    return d.toLocaleString('th-TH', {
      year: 'numeric', month: 'short', day: 'numeric',
      hour: '2-digit', minute: '2-digit',
    })
  } catch { return '—' }
}

export function timeAgo(dateStr: string | null | undefined): string {
  if (!dateStr) return '—'
  try {
    const diffMs = Date.now() - new Date(dateStr).getTime()
    const mins = Math.floor(diffMs / 60000)
    if (mins < 1) return 'เมื่อกี้'
    if (mins < 60) return `${mins} นาทีที่แล้ว`
    const hrs = Math.floor(mins / 60)
    if (hrs < 24) return `${hrs} ชั่วโมงที่แล้ว`
    const days = Math.floor(hrs / 24)
    if (days < 30) return `${days} วันที่แล้ว`
    return thaiDateShort(dateStr)
  } catch { return '—' }
}
