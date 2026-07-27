# OpsOne — UX/UI, Backend & Security Audit + Todo

> สร้างเมื่อ 2026-06-07 · อัปเดตเพิ่ม Backend + Security (เต็ม) · จากการตรวจสอบ codebase ทั้งระบบ
> ใช้เป็น backlog ทำต่อ — ติ๊ก `[x]` เมื่อเสร็จ จัดลำดับตาม Priority (P0 สูงสุด)
>
> **ขอบเขตที่ตรวจ:** Frontend (16 หน้า + components), Routing, `server.js` (~3,095 บรรทัด, ~100 endpoints),
> Security (OWASP Top 10), Dependencies (`npm audit`)
>
> **⚠️ สรุปด่วน — เรื่องที่ต้องแก้ก่อน:** API หลัก ~70 endpoint **ไม่มี auth ฝั่ง server**,
> ไม่มี rate limit / security headers, error leak 91 จุด, log access token, 29 ช่องโหว่ใน deps
>
> **สถานะที่ทำไปแล้ว (รอบก่อนหน้า):** PersonAvatar กลาง, TasksOverview redesign + หมายเหตุ,
> Modal ทุกตัว → TailAdmin Modal, AssignedTasks จัดเรียงใหม่ + หลัก/ช่วย, Sidebar logo ใหญ่ขึ้น,
> ITAssets modal 4 คอลัมน์ + ลด blur + ตัดคอลัมน์ toggle

---

## 🔴 P0 — ปัญหา/ความเสี่ยงที่ควรแก้ก่อน

- [ ] **ไม่มี Global Error Boundary** — ถ้า component ใด throw ระหว่าง render ทั้งแอปจะจอขาว
  - เพิ่ม `<ErrorBoundary>` ครอบ `<Router>` ใน [App.tsx](src/App.tsx) พร้อมหน้า fallback (ปุ่ม "โหลดใหม่")
- [ ] **เลิกใช้ `alert()` / `confirm()` แบบ native** (ปัจจุบัน ~27 `alert`, ~12 `confirm`)
  - ไฟล์หลัก: [AssignedTasks.tsx](src/pages/AssignedTasks.tsx) (11 alert), [ITAssets.tsx](src/pages/ITAssets.tsx) (7), [survey/FillSurveyPage.tsx](src/pages/survey/FillSurveyPage.tsx) (4)
  - ใช้ `sonner` toast (มี `<Toaster>` ใน [main.tsx](src/main.tsx) อยู่แล้ว) แทน `alert`
  - ทำ `ConfirmDialog` กลาง (TailAdmin Modal) แทน `confirm()` — เช่น ลบงาน/ลบทรัพย์สิน/ลบโครงการ
- [ ] **ลบ `console.*` ออกจาก production** (มีหลายไฟล์ — ITAssets 11 จุด, ProjectList 3) → ใช้ logger หรือเอาออก
- [ ] **ตรวจ error handling ฝั่ง UI ให้ครบ** — หลาย fetch ไม่มี loading/error state ที่ผู้ใช้เห็น (เงียบไป)

## 🟠 P1 — ความสม่ำเสมอ (Consistency) ของ UX/UI

- [ ] **รวม Pattern การดึงข้อมูลให้เหมือนกัน** — ตอนนี้ survey ใช้ **TanStack Query** แต่หน้าหลัก
      (Dashboard, Tasks, Assets, Tickets, PM) ใช้ `fetch + useState` เอง
  - ค่อย ๆ ย้ายหน้าหลักไป TanStack Query เพื่อได้ cache/refetch/loading state ฟรี และลด boilerplate
- [ ] **ระบบแจ้งเตือน (Toast) ชุดเดียวทั้งแอป** — ตอนนี้มีแต่ survey ที่ใช้ toast, หน้าอื่นใช้ alert
- [ ] **Loading / Empty / Error state ให้เป็นชุดเดียว** — ทำ component กลาง (`<LoadingState>`, `<EmptyState>`, `<ErrorState>`)
      แล้วใช้ทุกหน้า (ตอนนี้แต่ละหน้าทำ spinner/ข้อความเองคนละแบบ)
- [ ] **Dark mode ค้าง** — มี `dark:` class หลงเหลือจาก template TailAdmin ใน layout/หลาย component
      แต่แอปจริงใช้ธีมสว่างผ่าน CSS variables → **ตัดสินใจ**: ทำ dark mode จริง หรือลบ `dark:` ทิ้งให้สะอาด
  - ไฟล์: [AppLayout.tsx](src/layout/AppLayout.tsx), [AppSidebar.tsx](src/layout/AppSidebar.tsx), [AppHeader.tsx](src/layout/AppHeader.tsx), [Modal index.tsx](src/components/ui/modal/index.tsx), ui/* components
- [ ] **Avatar ให้ใช้ `PersonAvatar` ที่เหลือทั้งหมด** — ยังมีที่ render วงกลม initials เองอยู่:
  - [ITAssets.tsx](src/pages/ITAssets.tsx) คอลัมน์ผู้ถือครองในตาราง (สีตรงกันแล้วแต่ยังไม่ใช้ component)
  - [UserDropdown.tsx](src/components/UserDropdown.tsx) avatar ใน trigger/header (คำนวณ initials เองคนละสูตร)
  - [Dashboard.tsx](src/pages/Dashboard.tsx) บางจุด
- [ ] **ปุ่ม/badge/field ให้ใช้ utility class กลาง** (`.btn`, `.badge`, `.field-input`) ให้ครบ — บางหน้ายัง hardcode style ซ้ำ

## 🟡 P2 — Responsive / Mobile / Accessibility

- [ ] **Grid ที่ fix คอลัมน์ ทำให้ล้นบนมือถือ** — เติม responsive prefix:
  - [AssignedTasks.tsx:1519](src/pages/AssignedTasks.tsx#L1519) `grid-cols-4` (stat cards) → `grid-cols-2 md:grid-cols-4`
  - [ITAssets.tsx](src/pages/ITAssets.tsx), [Tickets.tsx](src/pages/Tickets.tsx), [ProjectManagement.tsx](src/pages/ProjectManagement.tsx) มี `grid-cols-3` ในฟอร์ม
- [ ] **ตาราง IT Assets บนจอเล็ก** — ยังมี `min-w-[760px]` (ลดจาก 920) ลองทำ card view สำหรับ < md
- [ ] **Modal a11y** — [Modal index.tsx](src/components/ui/modal/index.tsx) ยังขาด:
  - `role="dialog"` + `aria-modal="true"`
  - focus trap (Tab ไม่ควรหลุดออกนอก modal) และ auto-focus ช่องแรก
  - คืน focus กลับปุ่มเดิมเมื่อปิด
- [ ] **alt / aria-label** — ปุ่ม icon-only หลายตัวไม่มี `aria-label`; รูปบางจุดไม่มี `alt`
- [ ] **โฟกัส keyboard** — ตรวจ tab order หน้า form ยาว ๆ (AssignmentModal, AddAssetModal)

## 🟢 P3 — Tech Debt / สถาปัตยกรรม

- [ ] **ไฟล์ใหญ่เกิน 800 บรรทัด** (ตาม coding-style) ควรแตกย่อย:
  - [AssignedTasks.tsx](src/pages/AssignedTasks.tsx) (~2,050) → แยก DayModal / AssignmentModal / ProjectModal / Calendar / List ออกเป็นไฟล์
  - [Tickets.tsx](src/pages/Tickets.tsx) (~2,000), [ProjectManagement.tsx](src/pages/ProjectManagement.tsx)
  - [server.js](server.js) (~3,095) → แยก route เป็น modules (tasks/projects/assets/survey/hr)
- [ ] **Bundle ก้อนเดียว ~3.2MB** (gzip 878KB) — ทำ route-level `React.lazy()` + `Suspense`
      โดยเฉพาะ Survey, PM, Three.js background ([ThreeBackground.tsx](src/components/ThreeBackground.tsx))
- [ ] **framer-motion ใช้แค่ animation list/dropdown** — พิจารณาแทนด้วย CSS transition เพื่อลด bundle
- [ ] **ไม่มี test เลย** (ตาม testing rule 80%) — เริ่มจาก unit test ของ `lib/avatar`, `lib/preview`, utils
- [ ] **Type safety** — ตรวจ `any`/`as` ใน fetch responses, ใส่ type ให้ API response (หรือ zod validate)

## 📋 ตรวจรายหน้า (Per-page checklist)

### Dashboard `/dashboard`
- [ ] ตรวจ loading/empty state ของการ์ดสถิติและ ticket list
- [ ] ใช้ PersonAvatar ให้ครบ

### งาน & ปฏิทิน `/tasks` (AssignedTasks)
- [ ] stat cards `grid-cols-4` → responsive
- [ ] แทน alert/confirm ด้วย toast/ConfirmDialog (มี 11 alert + 3 confirm)
- [ ] แตกไฟล์ย่อย (P3)
- [ ] ตรวจ DnD ว่ายัง drag ได้จริงหลัง redesign (มี DragOverlay)

### ทรัพย์สิน IT `/assets`
- [ ] (เสร็จแล้ว) modal 4 คอลัมน์ + ตัด toggle column + ลด blur
- [ ] ทำ card view สำหรับมือถือ (ตารางยังกว้าง 760px)
- [ ] holder avatar → PersonAvatar
- [ ] แทน 7 alert ด้วย toast

### Support Ticket `/tickets`
- [ ] ตรวจ modal ใหม่ (TicketModal/CreateTicketModal) — delete confirm + toast ที่อยู่ใน modal ยังแสดงถูกตำแหน่ง
- [ ] grid-cols-3 ในฟอร์ม → responsive

### วางแผนโครงการ `/pm`, `/pm/:id`
- [ ] ตรวจ TicketModal + Warning + Confirm modal ใหม่
- [ ] Gantt/Analytics view บนจอเล็ก

### แบบประเมิน ISO `/survey/*`
- [ ] FillSurveyPage แทน 4 alert ด้วย toast/inline error (หน้าผู้ใช้ภายนอกกรอกฟอร์ม สำคัญ)
- [ ] ตรวจ avatar PersonAvatar ทุกหน้า (list/tracking เสร็จแล้ว — เช็ค dashboard/report/activity)
- [ ] confirm() ลบ → ConfirmDialog

### HR Intake `/hr/intake`
- [ ] confirm() → ConfirmDialog
- [ ] ตรวจ empty/error state

### หน้า Public / Preview (`/tasks/overview`, `/attendance/daily`, `/v/*`, `/tasks/view/*`)
- [ ] (เสร็จ) TasksOverview redesign + หมายเหตุ
- [ ] DailyPreview / TaskPublicView — ตรวจ responsive + ความสม่ำเสมอกับธีมใหม่
- [ ] หน้าเหล่านี้ไม่มี ProtectedRoute — ตรวจว่าใช้ token ป้องกันข้อมูลรั่วถูกต้อง (security)

---

# 🖥️ BACKEND AUDIT — `server.js` (~3,095 บรรทัด, Express + PostgreSQL)

## 🔴 P0 — Backend ความเสี่ยงสูง

- [ ] **API หลักไม่มี Authentication/Authorization ฝั่ง server เลย** ⚠️ **(ร้ายแรงสุด)**
  - มี middleware auth (`getSurveyUser` / `surveyRequireAuth` / `surveyRequireAdmin`, line ~2213–2245)
    **ใช้เฉพาะ endpoint ของ survey เท่านั้น (30 จุด)**
  - **endpoint หลัก ~70 จุดไม่มี auth**: `/api/users`, `/api/tasks`, `/api/projects`, `/api/assets`,
    `/api/attendance`, `/api/hr/*`, `/api/pm/*`, `/api/dashboard/*`, `/api/reports/*`
  - ผลกระทบ: ใครก็ได้ที่ยิงถึง server **อ่าน/แก้/ลบ** ข้อมูลได้โดยไม่ต้อง login เช่น
    `DELETE /api/projects/:id`, `DELETE /api/assets/:id`, `GET /api/users` (คืน email/role/sub พนักงานทั้งหมด)
  - **แก้:** ทำ `requireAuth` middleware (reuse `getSurveyUser` ให้เป็น generic) แล้วครอบ `/api/*` ทั้งหมด
    ยกเว้น public ที่ตั้งใจ (proxy oauth, preview token, survey fill) + เพิ่ม `requireAdmin` ใน endpoint แก้/ลบ
- [ ] **ไม่มี Rate Limiting ทุกจุด** — เสี่ยง brute-force / spam / abuse
  - จุดสำคัญ: OAuth proxy (`/api/proxy/oauth/token`), **ส่งอีเมล survey** (spam), preview/public token, register
  - **แก้:** `express-rate-limit` — global + เข้มขึ้นที่ auth/email/public endpoints
- [ ] **ไม่มี Security Headers** — ไม่มี `helmet` (ขาด CSP, HSTS, X-Frame-Options, X-Content-Type-Options)
  - **แก้:** `app.use(helmet({ ... }))` + ตั้ง CSP ให้เข้ากับ Three.js/inline ที่ใช้
- [ ] **Error leakage — `res.status(500).json({ error: String(e) })` 91 จุด**
  - ส่ง error/stack/SQL ดิบกลับ client → รั่วโครงสร้าง DB/โค้ด
  - **แก้:** ทำ error handler กลาง — log รายละเอียดฝั่ง server, ตอบ client เป็นข้อความ generic + request id
- [ ] **Log ข้อมูลลับ** — line ~304 `console.log('[proxy] token response:', JSON.stringify(data).slice(0,120))`
    log **access token** ลง console; line ~313 log userinfo → เอา token/PII ออกจาก log

## 🟠 P1 — Backend คุณภาพ/ความถูกต้อง

- [ ] **`PREVIEW_SECRET` มี fallback ไม่ปลอดภัย** (line ~212): ถ้า env ไม่ตั้ง → ใช้ `DB_PASS` หรือ
      string ตายตัว `'opsone-dev-preview-secret-change-me'` → ปลอม HMAC ของ preview link ได้
  - **แก้:** บังคับมี `PREVIEW_SECRET` ใน production (throw ถ้าไม่มี), อย่า fallback เป็น DB_PASS
- [ ] **Preview/Public token อายุยาว 1 ปี** (`PREVIEW_TTL_MS = 365 วัน`) + ไม่มี revoke
  - **แก้:** ลด TTL, เพิ่มกลไกเพิกถอน, จำกัด scope ข้อมูลที่ลิงก์สาธารณะมองเห็น
- [ ] **Upload ตรวจไฟล์อ่อน** (line ~245–267): เช็คแค่ `mimetype` (spoof ได้), ไม่เช็ค magic byte,
      อนุญาต `image/*` รวม **SVG** → เสี่ยง stored XSS ถ้า serve แบบ inline
  - **แก้:** จำกัดเป็น raster (png/jpg/webp), ตรวจ magic byte, serve ด้วย `Content-Disposition`/`X-Content-Type-Options: nosniff`, แยกโดเมน/บล็อก SVG
- [ ] **Validation ฝั่ง server ไม่สม่ำเสมอ** — เช็ค manual บางจุด ขาดบางจุด
  - **แก้:** ใช้ schema validation (zod) ต่อ endpoint, ปฏิเสธ field เกิน, จำกัดความยาว
- [ ] **DB migration เป็น DDL ใน startup** (line ~40–200) — `ALTER/CREATE IF NOT EXISTS` รันตอนบูต
  - ใช้งานได้ แต่ควรย้ายไป migration tool (node-pg-migrate/Flyway) เพื่อ versioning/rollback
- [ ] **CSV export** (visits/attendance) — ตรวจ **CSV formula injection** (ค่าขึ้นต้น `= + - @` ควร prefix `'`)
- [ ] **`/api/users` คืนข้อมูลมากเกินไป** — ส่ง email/role/sub ของพนักงานทุกคน แม้หน้าที่เรียกไม่ต้องใช้ครบ → จำกัด field

## 🟢 P2/P3 — Backend Tech Debt

- [ ] **แตก `server.js` (3,095 บรรทัด)** เป็น route modules: `routes/{auth,users,tasks,projects,assets,attendance,hr,pm,survey,dashboard,zammad}.js` + middleware แยก
- [ ] **มาตรฐาน API response** ให้เป็น envelope เดียว (`{ success, data, error, meta }`) ทั้งระบบ
- [ ] **มาตรฐาน error response** (ตอนนี้ปนกัน — บาง `String(e)` บาง `'Internal server error'`)
- [ ] **Connection pool / query timeout** — ตั้ง `statement_timeout`, จัดการ pool error
- [ ] **ไม่มี test ฝั่ง server** — เพิ่ม integration test (supertest) ของ endpoint สำคัญ + auth
- [ ] **Structured logging** แทน `console.*` (pino/winston) + request id

---

# 🔐 SECURITY AUDIT (อิง OWASP Top 10 + global security rule)

| # | หัวข้อ | สถานะ | หมายเหตุ |
|---|--------|-------|----------|
| A01 | **Broken Access Control** | 🔴 ร้ายแรง | API หลัก ~70 จุดไม่มี auth (ดู Backend P0) — IDOR/ลบข้อมูลได้อิสระ |
| A02 | Cryptographic Failures | 🟠 | `PREVIEW_SECRET` fallback ตายตัว; preview HMAC แต่ TTL 1 ปี |
| A03 | Injection (SQL) | 🟢 ส่วนใหญ่ดี | query parameterized; dynamic `SET` ใช้ชื่อคอลัมน์ literal (ปลอดภัย). ตรวจ CSV injection เพิ่ม |
| A04 | Insecure Design | 🟠 | auth เป็น client-side (ProtectedRoute) เท่านั้นในฝั่งหลัก |
| A05 | Security Misconfiguration | 🔴 | ไม่มี helmet/headers, error leak 91 จุด, ไม่มี rate limit |
| A06 | Vulnerable Components | 🟠 | `npm audit`: **29 ช่องโหว่ (6 high, 23 moderate)** — react-router-dom (DoS), yaml (stack overflow) ฯลฯ |
| A07 | Auth Failures | 🟠 | ไม่มี rate limit ที่ login/token; token proxied ถูก log |
| A08 | Data Integrity | 🟠 | upload validate อ่อน (SVG/mimetype); ไม่มี SRI/CSP |
| A09 | Logging & Monitoring | 🟠 | log access token/PII; ไม่มี audit log รวม (มี pm_audit_logs เฉพาะ PM) |
| A10 | SSRF | 🟢/ตรวจ | proxy ยิงไป TENCYBER/Zammad โดเมนตายตัว (ปลอดภัย) — อย่าให้ user กำหนด URL |

## Security Action Items (เรียงความสำคัญ)
- [ ] **[A01] ใส่ auth middleware ครอบ `/api/*` หลักทั้งหมด** + role check ใน write/delete *(ทำก่อนสุด)*
- [ ] **[A05] เพิ่ม `helmet` + error handler กลาง** (ไม่ leak), **`express-rate-limit`**
- [ ] **[A09] เอา token/PII ออกจาก log** (proxy token/userinfo), เพิ่ม audit log การลบ/แก้ข้อมูลสำคัญ
- [ ] **[A02] บังคับ `PREVIEW_SECRET`/secret ทุกตัวมาจาก env**, ลบ fallback, ลด TTL preview link
- [ ] **[A08] เข้มงวด upload** (raster เท่านั้น, magic byte, nosniff, ห้าม SVG inline)
- [ ] **[A03] กัน CSV formula injection** ในทุก export
- [ ] **[Secrets] ตรวจ `.env`/`.gitignore`** ว่าไม่มี secret หลุดเข้า git (DB_PASS, ZAMMAD_TOKEN, SURVEY_SMTP_PASS, PREVIEW_SECRET)
- [ ] **[Deps] `npm audit fix`** — ปัจจุบัน **29 ช่องโหว่ (6 high, 23 moderate)**: react-router-dom DoS, yaml stack-overflow; พิจารณา express 5-beta → stable
- [ ] **[Public] จำกัด data ของ public routes** (`/tasks/overview`, `/v/t/:token`, `/v/d/:token`, survey fill) ให้เปิดเท่าที่จำเป็น

---

### วิธีใช้ไฟล์นี้
1. **Security P0 ก่อนสุด** — auth middleware ครอบ `/api/*`, helmet, rate limit, error handler (กระทบ production จริง)
2. หยิบ Frontend ทีละ Priority (P0 → P3)
3. งานที่ทำซ้ำทั้งแอป (toast, ConfirmDialog, ErrorBoundary, LoadingState, requireAuth) — ทำตัวกลางก่อน แล้วไล่แทนทีละหน้า/endpoint
4. ติ๊ก checkbox + commit ย่อยต่อหน้า เพื่อคุมคุณภาพและ rollback ง่าย

### คำสั่งตรวจซ้ำ (verification)
```bash
npm audit                              # ช่องโหว่ dependencies
npm run build                          # tsc + vite build ต้องผ่าน
grep -rn "alert(\|confirm(" src/       # native dialog ที่ยังเหลือ
grep -n "error: String(e)" server.js   # จุด error leak (ปัจจุบัน 91)
grep -n "surveyRequireAuth\|requireAuth" server.js   # endpoint ที่มี/ไม่มี auth
```

> **หมายเหตุ:** ตัวเลขบรรทัดอ้างอิง ณ วันที่ audit — โค้ดอาจขยับ ให้ใช้ `grep` ยืนยันตำแหน่งจริงก่อนแก้
