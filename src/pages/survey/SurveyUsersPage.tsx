import { confirmDialog } from '../../components/ui/confirm';
import { useState, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Plus, Search, Building2, X, UserX, ChevronDown,
  UserCheck, Pencil, Loader2, Users, Filter,
} from 'lucide-react'
import { toast } from 'sonner'
import surveyApi from './api'
import type { SurveyUser } from './types'
import SurveyLayout from './SurveyLayout'
import { thaiDate } from './utils'
import { Modal } from '../../components/ui/modal'

interface EmployeeForm {
  firstName: string; lastName: string; email: string
  department: string; employeeId: string; company: string
}
const emptyForm = (): EmployeeForm => ({
  firstName: '', lastName: '', email: '',
  department: '', employeeId: '', company: '',
})

type ModalMode = 'add' | 'edit'

export default function SurveyUsersPage() {
  const qc = useQueryClient()

  // ── filters / search ──────────────────────────────────────────────────────
  const [search, setSearch] = useState('')
  const [filterCompany, setFilterCompany] = useState('')
  const [filterDept, setFilterDept] = useState('')
  const [filterStatus, setFilterStatus] = useState<'all' | 'active' | 'inactive'>('active')

  // ── selection ─────────────────────────────────────────────────────────────
  const [selected, setSelected] = useState<Set<string>>(new Set())

  // ── modal ─────────────────────────────────────────────────────────────────
  const [modal, setModal] = useState<{ open: boolean; mode: ModalMode; user?: SurveyUser }>({ open: false, mode: 'add' })
  const [form, setForm] = useState<EmployeeForm>(emptyForm())
  const [formErr, setFormErr] = useState('')
  const [deptCustom, setDeptCustom] = useState(false)

  // ── data ──────────────────────────────────────────────────────────────────
  const { data: users = [], isLoading } = useQuery<SurveyUser[]>({
    queryKey: ['survey-users'],
    queryFn: () => surveyApi.get<SurveyUser[]>('/users').then((r) => r.data),
  })

  const { data: companies = [] } = useQuery<string[]>({
    queryKey: ['survey-companies'],
    queryFn: () => surveyApi.get<string[]>('/companies').then((r) => r.data),
  })

  const { data: apiDepartments = [] } = useQuery<string[]>({
    queryKey: ['survey-departments'],
    queryFn: () => surveyApi.get<string[]>('/departments').then((r) => r.data),
  })

  // ── filtered list ─────────────────────────────────────────────────────────
  const filtered = useMemo(() => {
    let list = users
    if (filterStatus === 'active') list = list.filter((u) => u.isActive)
    if (filterStatus === 'inactive') list = list.filter((u) => !u.isActive)
    if (filterCompany) list = list.filter((u) => u.company === filterCompany)
    if (filterDept) list = list.filter((u) => u.department === filterDept)
    if (search.trim()) {
      const q = search.trim().toLowerCase()
      list = list.filter((u) =>
        `${u.firstName} ${u.lastName}`.toLowerCase().includes(q) ||
        u.email.toLowerCase().includes(q) ||
        (u.employeeId || '').toLowerCase().includes(q) ||
        (u.department || '').toLowerCase().includes(q),
      )
    }
    return list.sort((a, b) => (a.employeeId || '').localeCompare(b.employeeId || '', undefined, { numeric: true }))
  }, [users, search, filterCompany, filterDept, filterStatus])

  const departments = useMemo(
    () => {
      const fromApi = new Set(apiDepartments)
      const fromUsers = users.filter((u) => u.department).map((u) => u.department!)
      const combined = [...new Set([...fromApi, ...fromUsers])].sort()
      return combined
    },
    [apiDepartments, users],
  )

  // ── select all ────────────────────────────────────────────────────────────
  const allIds = filtered.map((u) => u.id)
  const allSelected = allIds.length > 0 && allIds.every((id) => selected.has(id))
  const someSelected = allIds.some((id) => selected.has(id)) && !allSelected

  function toggleAll() {
    if (allSelected) {
      setSelected((prev) => { const next = new Set(prev); allIds.forEach((id) => next.delete(id)); return next })
    } else {
      setSelected((prev) => new Set([...prev, ...allIds]))
    }
  }
  function toggleOne(id: string) {
    setSelected((prev) => { const next = new Set(prev); next.has(id) ? next.delete(id) : next.add(id); return next })
  }

  // ── mutations ─────────────────────────────────────────────────────────────
  const addMutation = useMutation({
    mutationFn: (data: EmployeeForm) => surveyApi.post<SurveyUser>('/users', data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['survey-users'] })
      qc.invalidateQueries({ queryKey: ['survey-companies'] })
      closeModal(); toast.success('เพิ่มพนักงานเรียบร้อยแล้ว')
    },
    onError: (e: unknown) => {
      const msg = (e as { response?: { data?: { error?: string } } })?.response?.data?.error
      const status = (e as { response?: { status?: number } })?.response?.status
      if (status === 409) setFormErr('อีเมลนี้มีอยู่ในระบบแล้ว')
      else setFormErr(msg || 'เกิดข้อผิดพลาด')
    },
  })

  const editMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<EmployeeForm> }) => surveyApi.put(`/users/${id}`, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['survey-users'] })
      qc.invalidateQueries({ queryKey: ['survey-companies'] })
      closeModal(); toast.success('บันทึกการเปลี่ยนแปลงแล้ว')
    },
    onError: () => toast.error('ไม่สามารถบันทึกได้'),
  })

  const deactivateMutation = useMutation({
    mutationFn: (id: string) => surveyApi.delete(`/users/${id}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['survey-users'] }); setSelected(new Set()); toast.success('ปิดใช้งานพนักงานแล้ว') },
    onError: () => toast.error('ไม่สามารถปิดใช้งานได้'),
  })

  const reactivateMutation = useMutation({
    mutationFn: (id: string) => surveyApi.put(`/users/${id}`, { isActive: true }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['survey-users'] }); toast.success('เปิดใช้งานพนักงานแล้ว') },
    onError: () => toast.error('ไม่สามารถเปิดใช้งานได้'),
  })

  // ── modal helpers ─────────────────────────────────────────────────────────
  function openAdd() { setForm(emptyForm()); setFormErr(''); setDeptCustom(false); setModal({ open: true, mode: 'add' }) }
  function openEdit(u: SurveyUser) {
    const dept = u.department || ''
    setForm({ firstName: u.firstName, lastName: u.lastName, email: u.email,
      department: dept, employeeId: u.employeeId || '', company: u.company || '' })
    setDeptCustom(dept !== '' && !apiDepartments.includes(dept))
    setFormErr(''); setModal({ open: true, mode: 'edit', user: u })
  }
  function closeModal() { setModal({ open: false, mode: 'add' }); setForm(emptyForm()); setFormErr(''); setDeptCustom(false) }

  function handleSubmit() {
    setFormErr('')
    if (!form.firstName.trim()) return setFormErr('กรุณากรอกชื่อ')
    if (!form.lastName.trim()) return setFormErr('กรุณากรอกนามสกุล')
    if (modal.mode === 'add') {
      if (!form.email.trim() || !/^[^@]+@[^@]+\.[^@]+$/.test(form.email)) return setFormErr('กรุณากรอกอีเมลให้ถูกต้อง')
      addMutation.mutate(form)
    } else if (modal.user) {
      editMutation.mutate({ id: modal.user.id, data: form })
    }
  }

  const isBusy = addMutation.isPending || editMutation.isPending
  const companyTabs = ['ทั้งหมด', ...companies]

  return (
    <SurveyLayout>
      <div className="p-6">
        {/* Header */}
        <div className="flex items-center justify-between mb-5">
          <div>
            <h1 className="text-2xl font-black text-[var(--color-text-primary)]">จัดการพนักงาน</h1>
            <p className="text-sm text-[var(--color-text-secondary)] mt-1">
              ผู้รับแบบประเมิน — {users.filter((u) => u.isActive).length} คนที่ใช้งาน
            </p>
          </div>
          <button onClick={openAdd} className="btn btn-primary flex items-center gap-2 text-sm">
            <Plus className="w-4 h-4" />เพิ่มพนักงาน
          </button>
        </div>

        {/* Company tabs */}
        {companies.length > 0 && (
          <div className="flex gap-1.5 mb-4 flex-wrap">
            {companyTabs.map((c) => (
              <button key={c}
                onClick={() => setFilterCompany(c === 'ทั้งหมด' ? '' : c)}
                className={`px-3.5 py-1.5 rounded-full text-xs font-semibold border transition-all flex items-center gap-1 ${
                  (c === 'ทั้งหมด' && !filterCompany) || filterCompany === c
                    ? 'bg-blue-600 text-white border-blue-600 shadow-sm'
                    : 'bg-white text-[var(--color-text-secondary)] border-[var(--color-border)] hover:border-blue-300 hover:text-blue-600'
                }`}>
                {c !== 'ทั้งหมด' && <Building2 className="w-3 h-3 opacity-70" />}
                {c}
              </button>
            ))}
          </div>
        )}

        {/* Toolbar */}
        <div className="card p-3 mb-4 flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-48">
            <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--color-text-tertiary)]" />
            <input style={{ paddingLeft: '2.5rem' }} value={search} onChange={(e) => setSearch(e.target.value)}
              placeholder="ค้นหาชื่อ, อีเมล, รหัสพนักงาน..."
              className="form-input h-9 text-sm w-full" />
          </div>
          <div className="relative">
            <Filter className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[var(--color-text-tertiary)]" />
            <select value={filterDept} onChange={(e) => setFilterDept(e.target.value)}
              className="form-input pl-8 pr-7 h-9 text-xs appearance-none">
              <option value="">ฝ่าย/แผนก (ทั้งหมด)</option>
              {departments.map((d) => <option key={d} value={d}>{d}</option>)}
            </select>
            <ChevronDown className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[var(--color-text-tertiary)]" />
          </div>
          <div className="relative">
            <select value={filterStatus} onChange={(e) => setFilterStatus(e.target.value as typeof filterStatus)}
              className="form-input pr-7 h-9 text-xs appearance-none">
              <option value="active">ใช้งาน</option>
              <option value="inactive">ปิดใช้</option>
              <option value="all">ทั้งหมด</option>
            </select>
            <ChevronDown className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[var(--color-text-tertiary)]" />
          </div>
          {selected.size > 0 && (
            <button
              onClick={() => { confirmDialog(`ปิดใช้งาน ${selected.size} รายการ?`).then(ok => { if (ok) Array.from(selected).forEach((id) => deactivateMutation.mutate(id)); }); }}
              className="flex items-center gap-1.5 px-3 h-9 rounded-lg bg-red-50 text-red-600 border border-red-200 text-xs font-semibold hover:bg-red-100 transition-colors">
              <UserX className="w-3.5 h-3.5" />ปิดใช้งาน ({selected.size})
            </button>
          )}
        </div>

        {/* Table */}
        <div className="card overflow-hidden">
          {isLoading ? (
            <div className="flex items-center justify-center p-16 text-[var(--color-text-tertiary)]">
              <Loader2 className="w-6 h-6 animate-spin mr-2" />กำลังโหลด...
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center py-16 text-[var(--color-text-tertiary)]">
              <Users className="w-10 h-10 mb-2 opacity-20" />
              <p className="text-sm font-medium">ไม่พบพนักงาน</p>
              {(search || filterCompany || filterDept) && (
                <button onClick={() => { setSearch(''); setFilterCompany(''); setFilterDept('') }}
                  className="mt-2 text-xs text-blue-600 hover:underline">ล้างตัวกรอง</button>
              )}
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-[var(--color-surface-2)] border-b border-[var(--color-border)]">
                  <th className="w-10 px-3 py-3">
                    <input type="checkbox" checked={allSelected}
                      ref={(el) => { if (el) el.indeterminate = someSelected }}
                      onChange={toggleAll}
                      className="w-4 h-4 rounded accent-blue-600 cursor-pointer" />
                  </th>
                  <th className="table-th">รหัสพนักงาน</th>
                  <th className="table-th">ชื่อ-นามสกุล</th>
                  <th className="table-th">อีเมล</th>
                  {!filterCompany && <th className="table-th">บริษัท</th>}
                  <th className="table-th">ฝ่าย/แผนก</th>
                  <th className="table-th text-center">สถานะ</th>
                  <th className="table-th">วันที่เพิ่ม</th>
                  <th className="table-th" />
                </tr>
              </thead>
              <tbody>
                {filtered.map((u) => (
                  <tr key={u.id}
                    className={`border-b border-[var(--color-border)] transition-colors ${selected.has(u.id) ? 'bg-blue-50' : 'hover:bg-[var(--color-surface-2)]'}`}>
                    <td className="px-3 py-3">
                      <input type="checkbox" checked={selected.has(u.id)} onChange={() => toggleOne(u.id)}
                        className="w-4 h-4 rounded accent-blue-600 cursor-pointer" />
                    </td>
                    <td className="table-td font-mono text-xs text-[var(--color-text-tertiary)]">
                      {u.employeeId || '—'}
                    </td>
                    <td className="table-td font-semibold text-[var(--color-text-primary)]">
                      {u.firstName} {u.lastName}
                    </td>
                    <td className="table-td text-[var(--color-text-secondary)]">{u.email}</td>
                    {!filterCompany && (
                      <td className="table-td text-xs">
                        {u.company ? <span className="badge badge-info">{u.company}</span> : <span className="text-[var(--color-text-tertiary)]">—</span>}
                      </td>
                    )}
                    <td className="table-td text-[var(--color-text-secondary)]">{u.department || '—'}</td>
                    <td className="table-td text-center">
                      {u.isActive ? <span className="badge badge-success">ใช้งาน</span> : <span className="badge badge-error">ปิดใช้</span>}
                    </td>
                    <td className="table-td text-xs text-[var(--color-text-tertiary)]">{thaiDate(u.createdAt)}</td>
                    <td className="table-td">
                      <div className="flex items-center gap-1 justify-end">
                        <button onClick={() => openEdit(u)}
                          className="p-1.5 rounded-lg hover:bg-blue-50 text-[var(--color-text-tertiary)] hover:text-blue-600 transition-colors">
                          <Pencil className="w-3.5 h-3.5" />
                        </button>
                        {u.isActive ? (
                          <button onClick={() => { confirmDialog(`ปิดใช้งาน ${u.firstName} ${u.lastName}?`).then(ok => { if (ok) deactivateMutation.mutate(u.id); }); }}
                            className="p-1.5 rounded-lg hover:bg-red-50 text-[var(--color-text-tertiary)] hover:text-red-500 transition-colors">
                            <UserX className="w-3.5 h-3.5" />
                          </button>
                        ) : (
                          <button onClick={() => reactivateMutation.mutate(u.id)}
                            className="p-1.5 rounded-lg hover:bg-green-50 text-[var(--color-text-tertiary)] hover:text-green-600 transition-colors">
                            <UserCheck className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {filtered.length > 0 && (
            <div className="px-4 py-2.5 border-t border-[var(--color-border)] bg-[var(--color-surface-2)] flex items-center justify-between">
              <span className="text-xs text-[var(--color-text-tertiary)]">
                แสดง {filtered.length} จาก {users.length} รายการ{selected.size > 0 && ` · เลือก ${selected.size}`}
              </span>
              {selected.size > 0 && (
                <button onClick={() => setSelected(new Set())} className="text-xs text-blue-600 hover:underline">ยกเลิกการเลือก</button>
              )}
            </div>
          )}
        </div>
      </div>

      {/* ── Add / Edit Modal ─────────────────────────────────────────────── */}
      {modal.open && (
        <Modal isOpen onClose={closeModal} showCloseButton={false}
          className="w-full max-w-md m-4">
            <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--color-border)]">
              <h3 className="text-base font-bold text-[var(--color-text-primary)]">
                {modal.mode === 'add' ? 'เพิ่มพนักงานใหม่' : 'แก้ไขข้อมูลพนักงาน'}
              </h3>
              <button onClick={closeModal}
                className="p-1.5 rounded-lg hover:bg-[var(--color-surface-2)] text-[var(--color-text-tertiary)] transition-colors">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="px-6 py-5 space-y-4">
              {formErr && (
                <div className="px-3 py-2 bg-red-50 border border-red-200 rounded-lg text-sm text-red-600">{formErr}</div>
              )}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="form-label">ชื่อ *</label>
                  <input value={form.firstName} onChange={(e) => setForm((p) => ({ ...p, firstName: e.target.value }))}
                    className="form-input" placeholder="ชื่อ" />
                </div>
                <div>
                  <label className="form-label">นามสกุล *</label>
                  <input value={form.lastName} onChange={(e) => setForm((p) => ({ ...p, lastName: e.target.value }))}
                    className="form-input" placeholder="นามสกุล" />
                </div>
              </div>
              <div>
                <label className="form-label">อีเมล{modal.mode === 'add' && ' *'}</label>
                <input value={form.email} onChange={(e) => setForm((p) => ({ ...p, email: e.target.value }))}
                  className="form-input" type="email" placeholder="email@example.com"
                  disabled={modal.mode === 'edit'} style={modal.mode === 'edit' ? { opacity: 0.6 } : {}} />
                {modal.mode === 'edit' && <p className="text-xs text-[var(--color-text-tertiary)] mt-1">ไม่สามารถเปลี่ยนอีเมลได้</p>}
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="form-label">รหัสพนักงาน</label>
                  <input value={form.employeeId} onChange={(e) => setForm((p) => ({ ...p, employeeId: e.target.value }))}
                    className="form-input" placeholder="EMP001" />
                </div>
                <div>
                  <label className="form-label">บริษัท</label>
                  <input value={form.company} onChange={(e) => setForm((p) => ({ ...p, company: e.target.value }))}
                    className="form-input" placeholder="เช่น TEN Forward" list="company-list" />
                  <datalist id="company-list">{companies.map((c) => <option key={c} value={c} />)}</datalist>
                </div>
              </div>
              <div>
                <label className="form-label">ฝ่าย/แผนก</label>
                {!deptCustom ? (
                  <select value={form.department}
                    onChange={(e) => {
                      if (e.target.value === '__custom__') { setDeptCustom(true); setForm((p) => ({ ...p, department: '' })) }
                      else setForm((p) => ({ ...p, department: e.target.value }))
                    }}
                    className="form-input">
                    <option value="">-- เลือกฝ่าย/แผนก --</option>
                    {departments.map((d) => <option key={d} value={d}>{d}</option>)}
                    <option value="__custom__">กรอกเอง...</option>
                  </select>
                ) : (
                  <div className="flex gap-2">
                    <input value={form.department} onChange={(e) => setForm((p) => ({ ...p, department: e.target.value }))}
                      className="form-input flex-1" placeholder="พิมพ์ชื่อฝ่าย/แผนก" autoFocus />
                    <button type="button" onClick={() => { setDeptCustom(false); setForm((p) => ({ ...p, department: '' })) }}
                      className="btn btn-ghost text-xs px-3 flex-shrink-0">เลือกจากรายการ</button>
                  </div>
                )}
              </div>
            </div>
            <div className="flex justify-end gap-2 px-6 py-4 border-t border-[var(--color-border)] bg-[var(--color-surface-2)] rounded-b-2xl">
              <button onClick={closeModal} className="btn btn-ghost text-sm" disabled={isBusy}>ยกเลิก</button>
              <button onClick={handleSubmit} disabled={isBusy}
                className="btn btn-primary flex items-center gap-2 text-sm">
                {isBusy && <Loader2 className="w-4 h-4 animate-spin" />}
                {modal.mode === 'add' ? 'เพิ่มพนักงาน' : 'บันทึก'}
              </button>
            </div>
        </Modal>
      )}
    </SurveyLayout>
  )
}
