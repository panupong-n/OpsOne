# OpsOne Platform — System Overview

> เอกสารอธิบายภาพรวมระบบ OpsOne Platform ครอบคลุมทุกส่วนตั้งแต่ Architecture, Authentication, Database, API, Pages, และ Components  
> อัปเดตล่าสุด: มีนาคม 2569

---

## สารบัญ

1. [Architecture ภาพรวม](#1-architecture-ภาพรวม)
2. [Technology Stack](#2-technology-stack)
3. [Authentication & Authorization](#3-authentication--authorization)
4. [Database Schema](#4-database-schema)
5. [Backend API (server.js)](#5-backend-api-serverjs)
6. [Frontend — Pages](#6-frontend--pages)
7. [Frontend — Components & Utilities](#7-frontend--components--utilities)
8. [Routing & Navigation](#8-routing--navigation)
9. [PM Module — ลึกเป็นพิเศษ](#9-pm-module--ลึกเป็นพิเศษ)
10. [การ Deploy & Infrastructure](#10-การ-deploy--infrastructure)
11. [Error ที่แก้ไขแล้ว](#11-error-ที่แก้ไขแล้ว)

---

## 1. Architecture ภาพรวม

```
┌─────────────────────────────────────────────────────────┐
│                     Browser (Client)                    │
│  React 19 + Vite + TypeScript + Tailwind CSS 4          │
│  react-router-dom v6 · framer-motion · recharts         │
│  @dnd-kit (Drag & Drop) · antd (ThaiDatePicker)         │
└───────────────────┬─────────────────────────────────────┘
                    │ HTTP / HTTPS (Cloudflare → Nginx)
┌───────────────────▼─────────────────────────────────────┐
│              Express 5 ESM (server.js : port 3000)      │
│  ┌──────────────┐  ┌──────────────┐  ┌───────────────┐ │
│  │ OAuth Proxy  │  │  REST API    │  │  Static SPA   │ │
│  │ (TENCYBER)   │  │  /api/*      │  │  dist/        │ │
│  └──────────────┘  └──────────────┘  └───────────────┘ │
└───────────────────┬─────────────────────────────────────┘
                    │ pg Pool
┌───────────────────▼─────────────────────────────────────┐
│           PostgreSQL (opsone_db)                        │
│  platform_users · projects · tasks · task_visits        │
│  attendance_log · assets · pm_* tables                  │
└─────────────────────────────────────────────────────────┘
                    │ HTTPS proxy
┌───────────────────▼─────────────────────────────────────┐
│     TENCYBER SSO (dashboard.tenfw.com)                  │
│  OAuth 2.0 + OIDC · PKCE Flow · /api/oauth/*           │
└─────────────────────────────────────────────────────────┘
```

- **Frontend**: React SPA — build ด้วย Vite → ไฟล์ static ใน `dist/`
- **Backend**: Express 5 serve ทั้ง API และ SPA static ในโปรเซสเดียว (port 3000)
- **Nginx**: Reverse proxy รับ port 80/443 → forward ต่อไป port 3000
- **PM2**: Process manager ดูแล server.js (`pm2 restart all`)
- **TENCYBER**: Identity Provider (IdP) ภายนอก — Login ผ่าน OAuth 2.0 PKCE

---

## 2. Technology Stack

### Frontend
| ส่วน | Library | เวอร์ชัน |
|------|---------|---------|
| Framework | React | 19.x |
| Build Tool | Vite | 8.0.0-beta.15 |
| Language | TypeScript | ~5.x |
| Styling | Tailwind CSS | 4.x |
| Animation | framer-motion | - |
| Routing | react-router-dom | v6 |
| Drag & Drop | @dnd-kit/core, @dnd-kit/utilities | - |
| Charts | recharts | - |
| Date Picker | antd + dayjs + buddhistEra plugin | - |
| Icons | lucide-react | - |

### Backend
| ส่วน | Library |
|------|---------|
| Framework | Express 5 (ESM) |
| Database | PostgreSQL (node-postgres `pg`) |
| File Upload | multer |
| Process Manager | PM2 |

---

## 3. Authentication & Authorization

### Flow การ Login (PKCE OAuth 2.0)

```
User คลิก Login
    ↓
src/lib/auth.ts :: redirectToTencyberLogin()
    - สร้าง code_verifier (PKCE, 43 chars random)
    - สร้าง code_challenge (SHA-256 hash, base64url)
    - บันทึก verifier ใน sessionStorage
    - Redirect ไป TENCYBER authorize URL
    ↓
TENCYBER SSO Login Page (dashboard.tenfw.com)
    - User กรอก username/password
    - TENCYBER redirect กลับมา /callback?code=...&state=...
    ↓
src/pages/AuthCallback.tsx
    - ดึง code + state จาก URL
    - เรียก AuthContext.handleCallback()
    ↓
src/lib/auth.ts :: exchangeCodeForToken()
    - POST /api/proxy/oauth/token (ผ่าน proxy เพื่อหลีก CORS)
    - รับ access_token + id_token
    - เรียก fetchUserInfo() → GET /api/proxy/oauth/userinfo
    ↓
src/context/AuthContext.tsx
    - บันทึก user + token ใน sessionStorage (saveSession)
    - POST /api/users/register — upsert user record ใน PostgreSQL
    - เปลี่ยน state isAuthenticated = true
    ↓
Navigate ไป /dashboard
```

### ไฟล์ที่เกี่ยวข้อง

| ไฟล์ | หน้าที่ |
|------|---------|
| `src/lib/auth.ts` | PKCE helpers, token exchange, session storage |
| `src/lib/pkce.ts` | `generateCodeVerifier()`, `generateCodeChallenge()` |
| `src/context/AuthContext.tsx` | React Context — user state, handleCallback, logout |
| `src/pages/Login.tsx` | หน้า Login UI — ปุ่ม redirect ไป TENCYBER |
| `src/pages/AuthCallback.tsx` | จัดการ callback หลัง TENCYBER redirect กลับ |
| `server.js` `/api/proxy/*` | Proxy OAuth token/userinfo/revoke (หลีก CORS) |

### Session Storage
- Token เก็บใน **sessionStorage** (ไม่ใช่ localStorage) — หายเมื่อปิด Tab
- Key: `tencyber_session` → `{ user, accessToken, idToken, expiresAt }`

### Logout
1. `endTencyberSession()` → revoke token → redirect ไป TENCYBER end_session URL
2. TENCYBER ล้าง SSO cookie แล้ว redirect กลับ /login
3. `clearSession()` → ล้าง sessionStorage

### Role ของ User (จาก TENCYBER)
- `SUPER_ADMIN`, `ADMIN`, `ENGINEER`, `VIEWER` ฯลฯ  
- Field: `user.role` — ใช้แสดงใน Badge บน Header

---

## 4. Database Schema

### ตาราง platform_users
```sql
CREATE TABLE platform_users (
    sub         TEXT PRIMARY KEY,        -- TENCYBER user ID (unique)
    email       TEXT,
    name        TEXT,
    given_name  TEXT,
    family_name TEXT,
    role        TEXT,
    tenant_id   TEXT,
    last_seen   TIMESTAMPTZ,
    user_group  TEXT DEFAULT 'engineer',  -- สำหรับ grouping ใน UI
    visible     BOOLEAN DEFAULT true      -- แสดง/ซ่อนในตาราง
);
```

### ตาราง projects (Task Management — เก่า)
```sql
CREATE TABLE projects (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name        TEXT NOT NULL,
    description TEXT,
    color       TEXT,
    logo_url    TEXT,
    created_by  TEXT,
    created_at  TIMESTAMPTZ DEFAULT NOW(),
    updated_at  TIMESTAMPTZ DEFAULT NOW()
);
```

### ตาราง tasks (Task Management — ใช้ร่วมกับ Tickets/AssignedTasks)
```sql
CREATE TABLE tasks (
    id          UUID PRIMARY KEY,
    project_id  UUID REFERENCES projects(id),
    title       TEXT NOT NULL,         -- ชื่อลูกค้า / งาน
    description TEXT,
    assignee_id TEXT,                  -- sub ของ platform_users
    status      TEXT,                  -- in_progress / completed / pending
    site        TEXT,                  -- สถานที่ติดตั้ง
    created_by  TEXT,
    created_at  TIMESTAMPTZ DEFAULT NOW(),
    updated_at  TIMESTAMPTZ DEFAULT NOW()
);
```

### ตาราง task_visits (บันทึกการเข้าพื้นที่)
```sql
CREATE TABLE task_visits (
    id          UUID PRIMARY KEY,
    task_id     UUID REFERENCES tasks(id),     -- NULL ได้ (บันทึกทั่วไป)
    employee_id TEXT,                           -- sub ของ platform_users
    visit_date  DATE,
    site        TEXT,
    notes       TEXT,
    product     TEXT,                           -- Product label (ถ้าไม่มี task)
    UNIQUE(task_id, employee_id, visit_date),
    UNIQUE(employee_id, visit_date) WHERE task_id IS NULL
);
```

### ตาราง attendance_log (สถานะประจำวัน)
```sql
CREATE TABLE attendance_log (
    id          UUID PRIMARY KEY,
    employee_id TEXT,
    date        DATE,
    status      TEXT CHECK (status IN ('office','travel','leave')),
    location    TEXT,
    product     TEXT,
    customer    TEXT,
    UNIQUE(employee_id, date)
);
```

### ตาราง assets (IT Asset Management)
```sql
-- ตารางจริงดู /api/assets ใน server.js
-- รองรับ fields แบบ dynamic: group, device_type, model, serial_number,
--   holder_id, status, purchase_date, warranty_date, location, notes
-- มี asset_transfers สำหรับ log การโอนย้าย holder
```

### PM Module Tables (ใหม่)

#### pm_projects
```sql
CREATE TABLE pm_projects (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name        TEXT NOT NULL,
    description TEXT,
    color       TEXT DEFAULT '#6366F1',
    status      TEXT DEFAULT 'active',
    start_date  DATE,
    end_date    DATE,
    created_by  TEXT,
    updated_by  TEXT,
    created_at  TIMESTAMPTZ DEFAULT NOW(),
    updated_at  TIMESTAMPTZ DEFAULT NOW()
);
```

#### pm_milestones
```sql
CREATE TABLE pm_milestones (
    id          UUID PRIMARY KEY,
    project_id  UUID REFERENCES pm_projects(id) ON DELETE CASCADE,
    name        TEXT NOT NULL,
    due_date    DATE,
    color       TEXT DEFAULT '#F59E0B',
    sort_order  INT DEFAULT 0,
    created_at  TIMESTAMPTZ DEFAULT NOW()
);
```

#### pm_sprints
```sql
CREATE TABLE pm_sprints (
    id          UUID PRIMARY KEY,
    project_id  UUID REFERENCES pm_projects(id) ON DELETE CASCADE,
    name        TEXT NOT NULL,
    start_date  DATE,
    end_date    DATE,
    status      TEXT DEFAULT 'planned',  -- planned / active / completed
    created_at  TIMESTAMPTZ DEFAULT NOW()
);
```

#### pm_tickets (หัวใจหลักของ PM)
```sql
CREATE TABLE pm_tickets (
    id                  UUID PRIMARY KEY,
    project_id          UUID REFERENCES pm_projects(id) ON DELETE CASCADE,
    parent_id           UUID REFERENCES pm_tickets(id) ON DELETE SET NULL,  -- Sub-task
    milestone_id        UUID REFERENCES pm_milestones(id) ON DELETE SET NULL,
    sprint_id           UUID REFERENCES pm_sprints(id) ON DELETE SET NULL,
    title               TEXT NOT NULL,
    description         TEXT,
    acceptance_criteria TEXT,
    type                TEXT DEFAULT 'task',    -- product/task/bug/feature
    status              TEXT DEFAULT 'open',    -- start/in_progress/pending/total
    priority            TEXT DEFAULT 'medium',  -- low/medium/high/critical
    assignee_id         TEXT,                   -- sub ของ platform_users
    plan_start          DATE,
    plan_end            DATE,
    date_to_finish      DATE,                   -- Due Date
    progress            INT DEFAULT 0,          -- 0-100 (manual)
    all_device          INT DEFAULT 0,          -- จำนวนเครื่องทั้งหมด
    storypoints         FLOAT,
    plan_hours          FLOAT,
    hour_remaining      FLOAT,
    tags                TEXT,                   -- comma-separated
    kanban_sort_index   INT DEFAULT 0,
    sort_order          INT DEFAULT 0,
    created_by          TEXT,
    created_at          TIMESTAMPTZ DEFAULT NOW(),
    updated_at          TIMESTAMPTZ DEFAULT NOW()
);
-- Indexes: idx_pm_tickets_parent_id, idx_pm_tickets_project_id
```

#### pm_dependencies (Gantt dependency arrows)
```sql
CREATE TABLE pm_dependencies (
    id              UUID PRIMARY KEY,
    predecessor_id  UUID REFERENCES pm_tickets(id) ON DELETE CASCADE,
    successor_id    UUID REFERENCES pm_tickets(id) ON DELETE CASCADE,
    dep_type        TEXT DEFAULT 'finish_to_start',
    lag_days        INT DEFAULT 0,
    UNIQUE(predecessor_id, successor_id)
);
```

#### pm_quantity_logs (บันทึกจำนวนรายวัน)
```sql
CREATE TABLE pm_quantity_logs (
    id          UUID PRIMARY KEY,
    ticket_id   UUID REFERENCES pm_tickets(id) ON DELETE CASCADE,
    log_date    DATE NOT NULL,
    quantity    INT NOT NULL DEFAULT 0,
    created_at  TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(ticket_id, log_date)   -- 1 record ต่อวันต่อ ticket
);
-- Index: idx_pm_quantity_logs_ticket_id
```

---

## 5. Backend API (server.js)

ไฟล์เดียว `server.js` (1,397 บรรทัด) เขียนด้วย Express 5 ESM

### OAuth Proxy
| Method | Path | ทำอะไร |
|--------|------|---------|
| POST | `/api/proxy/oauth/token` | Proxy token exchange → TENCYBER (หลีก CORS) |
| GET | `/api/proxy/oauth/userinfo` | Proxy user info → TENCYBER |
| POST | `/api/proxy/oauth/revoke` | Proxy token revoke → TENCYBER (RFC 7009) |

### Users API
| Method | Path | ทำอะไร |
|--------|------|---------|
| POST | `/api/users/register` | Upsert user หลัง login (INSERT ON CONFLICT) |
| GET | `/api/users` | ดึงรายชื่อ user ทั้งหมด (สำหรับ dropdown assignee) |
| PATCH | `/api/users/:sub` | แก้ไข user_group / visible |

### Projects API (Tasks System — เก่า)
| Method | Path | ทำอะไร |
|--------|------|---------|
| GET | `/api/projects` | ดึง project ทั้งหมด |
| POST | `/api/projects` | สร้าง project ใหม่ |
| PUT | `/api/projects/:id` | แก้ไข project |
| DELETE | `/api/projects/:id` | ลบ project |

### Tasks API
| Method | Path | ทำอะไร |
|--------|------|---------|
| GET | `/api/tasks` | ดึง task (filter: project_id, assignee_id, status) |
| POST | `/api/tasks` | สร้าง task ใหม่ |
| PUT | `/api/tasks/:id` | แก้ไข task |
| DELETE | `/api/tasks/:id` | ลบ task (cascade ลบ task_visits, clean attendance) |

### Task Visits API
| Method | Path | ทำอะไร |
|--------|------|---------|
| GET | `/api/task-visits` | ดึง visits (filter: year, month, task_id, employee_id) |
| POST | `/api/task-visits` | บันทึก visit (linked task หรือ notes-only) |
| DELETE | `/api/task-visits/:id` | ลบ visit |
| GET | `/api/task-visits/export/csv` | Export CSV รายงาน (UTF-8 BOM) |

### Attendance API
| Method | Path | ทำอะไร |
|--------|------|---------|
| GET | `/api/attendance` | ดึง attendance (filter: year, month) |
| POST | `/api/attendance` | บันทึก/อัปเดต attendance (UPSERT) |
| DELETE | `/api/attendance` | ลบ attendance (by employee_id + date) |
| GET | `/api/attendance/daily` | ดึงข้อมูล Daily Preview (สรุปวัน + รายคน) |

### Assets API
| Method | Path | ทำอะไร |
|--------|------|---------|
| GET | `/api/assets` | ดึง asset ทั้งหมด (support filter/search) |
| GET | `/api/assets/holders` | ดึงรายชื่อ holder ปัจจุบัน |
| GET | `/api/assets/stats` | สถิติ (total, by group) |
| GET | `/api/assets/fields` | Dynamic fields definition |
| POST | `/api/assets` | เพิ่ม asset ใหม่ |
| PUT | `/api/assets/:id` | แก้ไข asset |
| DELETE | `/api/assets/:id` | ลบ asset |
| GET | `/api/assets/:id/transfers` | ดู history การโอนย้าย holder |
| POST | `/api/assets/:id/transfer` | โอนย้าย holder (บันทึก transfer log) |

### PM (Project Management) API — `/api/pm/*`
| Method | Path | ทำอะไร |
|--------|------|---------|
| GET | `/api/pm/projects` | ดึง project ทั้งหมด + ticket_count + created/updated_by_name |
| POST | `/api/pm/projects` | สร้าง PM project ใหม่ |
| PUT | `/api/pm/projects/:id` | แก้ไข project (name, color, description, updated_by) |
| DELETE | `/api/pm/projects/:id` | ลบ project (cascade ลบทุกอย่าง) |
| GET | `/api/pm/projects/:pid/milestones` | ดึง milestones ของ project |
| POST | `/api/pm/projects/:pid/milestones` | สร้าง milestone |
| PUT | `/api/pm/milestones/:id` | แก้ไข milestone |
| DELETE | `/api/pm/milestones/:id` | ลบ milestone |
| GET | `/api/pm/projects/:pid/sprints` | ดึง sprints ของ project |
| POST | `/api/pm/projects/:pid/sprints` | สร้าง sprint |
| PUT | `/api/pm/sprints/:id` | แก้ไข sprint |
| DELETE | `/api/pm/sprints/:id` | ลบ sprint |
| GET | `/api/pm/projects/:pid/tickets` | ดึง ticket ทั้งหมดของ project (พร้อม assignee_name) |
| POST | `/api/pm/tickets` | สร้าง ticket ใหม่ |
| PUT | `/api/pm/tickets/:id` | แก้ไข ticket ทั้งหมด (full update) |
| PATCH | `/api/pm/tickets/:id` | แก้ไข ticket บางส่วน (partial: status, kanban sort) |
| DELETE | `/api/pm/tickets/:id` | ลบ ticket |
| GET | `/api/pm/projects/:pid/dependencies` | ดึง dependency arrows |
| POST | `/api/pm/dependencies` | สร้าง dependency (predecessor → successor) |
| DELETE | `/api/pm/dependencies/:id` | ลบ dependency |
| POST | `/api/pm/tickets/:id/ripple` | **Ripple Effect** — เลื่อนวันทั้ง sub-graph เมื่อ parent เปลี่ยน |
| GET | `/api/pm/projects/:pid/quantity-logs` | ดึง quantity logs ทั้ง project |
| GET | `/api/pm/tickets/:tid/quantity-logs` | ดึง quantity logs ของ ticket หนึ่ง |
| POST | `/api/pm/tickets/:tid/quantity-logs` | บันทึก quantity log วันนั้น (UPSERT: รวมกับที่มีอยู่แล้ว) |
| DELETE | `/api/pm/quantity-logs/:id` | ลบ quantity log |
| PATCH | `/api/pm/tickets/:id/quantity` | อัปเดต all_device ของ ticket |

### Dashboard API
| Method | Path | ทำอะไร |
|--------|------|---------|
| GET | `/api/dashboard/stats` | สถิติรวม: assets, tasks, users, attendance วันนี้ |
| GET | `/api/dashboard/employee-matrix` | Matrix ทีมงาน + งานที่รับผิดชอบ |

### Zammad Integration API
| Method | Path | ทำอะไร |
|--------|------|---------|
| GET | `/api/zammad/tickets` | ดึง tickets จาก Zammad (IT Support System) |
| GET | `/api/zammad/tickets/:id` | ดึง ticket รายตัว |
| GET | `/api/zammad/ticket_states` | ดึง states ทั้งหมด |
| GET | `/api/zammad/ticket_priorities` | ดึง priorities |
| GET | `/api/zammad/groups` | ดึง groups/queues |
| GET | `/api/zammad/tickets/:id/articles` | ดึง conversation thread |
| GET | `/api/zammad/attachment/:tid/:aid/:attach_id` | Proxy ไฟล์แนบ |

### Misc
| Method | Path | ทำอะไร |
|--------|------|---------|
| POST | `/api/upload/logo` | Upload logo image (multer, max 5MB) → `/uploads/` |
| GET | `/uploads/*` | Serve uploaded files (cache 7 วัน) |
| GET | `/{*path}` | SPA fallback → serve `dist/index.html` |

---

## 6. Frontend — Pages

### `/login` — Login.tsx
- หน้าแรกที่เจอเมื่อยังไม่ล็อกอิน
- แสดง branding OpsOne + ThreeBackground (Three.js animation)
- ปุ่ม "เข้าสู่ระบบด้วย TENCYBER" → เรียก `redirectToTencyberLogin()`
- มี environment check แสดง debug info ใน dev mode

### `/callback` — AuthCallback.tsx  
- หน้าที่ TENCYBER redirect กลับมาหลัง login
- ดึง `code` + `state` จาก URL searchParams
- ตรวจสอบ state ตรงกับที่เก็บใน sessionStorage
- เรียก `handleCallback()` → exchange code → เก็บ session → navigate ไป /dashboard

### `/dashboard` — Dashboard.tsx
**ภาพรวม Dashboard ประจำองค์กร**

ส่วนที่แสดง:
1. **Stats Cards** — Assets ทั้งหมด / งาน in_progress / Users / Attendance วันนี้
2. **Asset Groups** — จำนวน asset แยกตาม group (Hardware, Software, Network ฯลฯ)
3. **Recent Tasks** — งาน 8 รายการล่าสุด + สี + ชื่อ project + assignee
4. **Employee Matrix** — ตารางทีมงาน แสดงว่าใครดูแล customer ใด (Product view / Employee view)
   - Mode "Product": แกน X = engineer, แกน Y = product/customer → cell แสดง task ที่ active
   - Mode "Employee": แสดงงานแต่ละคนแบบ expand ได้

API ที่ใช้:
- `GET /api/dashboard/stats`
- `GET /api/tasks`
- `GET /api/assets/stats` + `GET /api/assets`
- `GET /api/dashboard/employee-matrix`

### `/attendance` — AttendanceCalendar.tsx
**ระบบบันทึกการเข้างาน (Attendance Management)**

ฟีเจอร์:
- ปฏิทินแบบ Grid (เดือนต่อเดือน) แสดงสถานะรายวันของแต่ละคน
- สถานะ 3 แบบ: **Office** (สีเขียว) / **Travel** (สีส้ม — ออกนอกสถานที่) / **Leave** (สีแดง — ลา)
- คลิกวันใดวันหนึ่งเพื่อ set สถานะ (toggle หรือเปลี่ยน)
- Export ข้อมูลเป็น CSV
- Tab ปีด้วย dropdown เลือกเดือน+ปี
- **ลิงก์ไป Daily Preview** — เปิดหน้าสรุปวันนั้นแยก tab (noLayout)

API ที่ใช้:
- `GET /api/attendance?year=&month=`
- `POST /api/attendance` (UPSERT: employee_id + date)
- `DELETE /api/attendance`
- `GET /api/users`

### `/attendance/daily` — DailyPreview.tsx
**หน้าสรุปรายวัน (Daily Summary — แบบ standalone, ไม่มี Layout)**

ฟีเจอร์:
- URL parameter `?date=YYYY-MM-DD` — auto-update เป็นวันปัจจุบันถ้า URL เก่า
- Midnight auto-update (เปลี่ยนวันอัตโนมัติเมื่อเที่ยงคืน)
- URL sync: เปลี่ยน selectedDate → URL อัปเดตด้วย `setSearchParams` (replace: true)
- แสดง: กี่คนอยู่ Office / Travel / Leave พร้อมชื่อ + avatar
- Navigation วันก่อน/หน้า ด้วยลูกศร
- Design เรียบ มีแค่ข้อมูลสำคัญ (ใช้ฉายบน TV/monitor ใน office)

API ที่ใช้:
- `GET /api/attendance/daily?date=YYYY-MM-DD`

### `/tickets` — Tickets.tsx
**ระบบ IT Support Tickets (ผ่าน Zammad integration)**

ฟีเจอร์:
- ดึง tickets จาก Zammad helpdesk system
- แสดง: ID, Title, State, Priority, Group, Assignee, สร้างเมื่อ, อัปเดตเมื่อ
- ค้นหาแบบ real-time (filter by title/customer/assignee)
- Filter ตาม State / Group / Priority
- คลิก ticket → modal แสดง conversation thread (articles)
- ดูและ download ไฟล์แนบ (proxy ผ่าน `/api/zammad/attachment/*`)

API ที่ใช้:
- `GET /api/zammad/tickets`
- `GET /api/zammad/ticket_states`
- `GET /api/zammad/ticket_priorities`
- `GET /api/zammad/groups`
- `GET /api/zammad/tickets/:id/articles`
- `GET /api/zammad/attachment/:tid/:aid/:attach_id`

### `/assets` — ITAssets.tsx
**ระบบจัดการ IT Assets**

ฟีเจอร์:
- ตาราง asset ทั้งหมดพร้อม filter/search
- แสดง group (Hardware/Software/Network ฯลฯ), model, serial, holder, status, location
- สร้าง/แก้ไข/ลบ asset ผ่าน modal
- โอนย้าย holder พร้อม log ประวัติ
- แสดง transfer history ของแต่ละ asset
- Chart สรุปจำนวนตาม group

API ที่ใช้:
- `GET /api/assets` + `GET /api/assets/stats` + `GET /api/assets/fields`
- `POST /api/assets`, `PUT /api/assets/:id`, `DELETE /api/assets/:id`
- `GET /api/assets/:id/transfers`, `POST /api/assets/:id/transfer`
- `GET /api/assets/holders`

### `/tasks` — AssignedTasks.tsx
**หน้างานที่รับผิดชอบ (My Tasks)**

ฟีเจอร์:
- แสดงงาน (tasks) ที่ user ล็อกอินอยู่ได้รับมอบหมาย
- Filter ตาม status
- บันทึก task_visit (เข้าพื้นที่) แต่ละวัน
- แสดง customer / project / สถานที่

API ที่ใช้:
- `GET /api/tasks?assignee_id=`
- `GET /api/task-visits?employee_id=`
- `POST /api/task-visits`

### `/pm` — ProjectList.tsx
**หน้ารายการ PM Projects**

ฟีเจอร์:
- แสดง PM project ทั้งหมดในรูปแบบ Card Grid (3 คอลัมน์)
- แต่ละ card แสดง: ชื่อ project, สี, description, ticket count, status badge
- แสดง สร้างโดย + วันที่+เวลา / อัพเดทโดย + วันที่+เวลา
- สร้าง project ใหม่ผ่าน Modal (ชื่อ, description, สี)
- ลบ project (พร้อม confirm modal)
- คลิก card → navigate ไป `/pm/:projectId`

API ที่ใช้:
- `GET /api/pm/projects`
- `POST /api/pm/projects`
- `DELETE /api/pm/projects/:id`

### `/pm/:projectId` — ProjectManagement.tsx
**หน้าหลักของ PM Module (ซับซ้อนที่สุดในระบบ)**

ดูรายละเอียดใน [Section 9](#9-pm-module--ลึกเป็นพิเศษ)

---

## 7. Frontend — Components & Utilities

### `src/components/Layout.tsx`
**Shell หลักของแอป (Sidebar + Top Bar)**

ส่วนประกอบ:
- **Top Bar**: Logo "Operations One", dark mode toggle, user dropdown (ชื่อ, role badge, logout)
- **Bottom Navigation Bar** (mobile-style): ปุ่ม icon นำทาง 6 หน้า (Dashboard, Attendance, Matrix, Assets/Tickets, PM, Tasks)
- มี `ThemeProvider` context ดูแล dark/light mode
- แสดง `<Outlet>` สำหรับ page content

### `src/components/ThaiDatePicker.tsx`
**Date Picker ที่แสดงปี พ.ศ. (Buddhist Era)**

- Wrapper ของ antd `DatePicker` + `dayjs` + `buddhistEra` plugin
- Locale: Thai (th_TH)
- Format: `DD/MM/BBBB` (BBBB = Buddhist year เช่น 2569)
- Props: `value`, `onChange`, `disabled`, `size`, `placeholder`
- Export `formatThaiDate(isoString)` → แสดงวันเป็นไทย เช่น "17 มี.ค. 2569"
- Export `formatThaiDateShort(isoString)` → short version

### `src/components/SettingsModal.tsx`
**Modal ตั้งค่าผู้ใช้**
- จัดการ user_group, visible setting ผ่าน `PATCH /api/users/:sub`

### `src/components/SaveButton.tsx`
**ปุ่ม Save พร้อม loading state animation**

### `src/components/UserDropdown.tsx`
**Dropdown เมนูผู้ใช้ (logout, settings)**

### `src/components/ThreeBackground.tsx`
**Three.js animation ใช้ใน Login page**
- แสดง particle/geometry 3D animation เป็น background

### `src/context/AuthContext.tsx`
**React Context สำหรับ Authentication State**
```typescript
interface AuthContextType {
    user: TencyberUser | null;   // { sub, email, name, role, tenant_id, ... }
    accessToken: string | null;
    isAuthenticated: boolean;
    isLoading: boolean;
    handleCallback: (code, state) => Promise<void>;
    logout: () => void;
}
```

### `src/context/ThemeContext.tsx` (อ้างอิงจาก Layout)
**Dark/Light Mode Context**
- บันทึก preference ตาม user sub (ต่างคนต่าง theme)
- ใช้ CSS variables (--color-*) จาก `src/index.css`

### `src/lib/auth.ts`
**Helper functions สำหรับ TENCYBER Auth**

| Function | ทำอะไร |
|----------|---------|
| `redirectToTencyberLogin()` | เริ่ม PKCE flow, redirect ไป TENCYBER |
| `exchangeCodeForToken(code, verifier)` | Exchange authorization code → tokens |
| `fetchUserInfo(accessToken)` | ดึง user profile จาก TENCYBER |
| `endTencyberSession(idToken)` | Logout + revoke + redirect end_session |
| `loadSession()` | อ่าน session จาก sessionStorage |
| `saveSession(session)` | บันทึก session ลง sessionStorage |
| `clearSession()` | ลบ session |

### `src/lib/pkce.ts`
**PKCE (Proof Key for Code Exchange) helpers**

| Function | ทำอะไร |
|----------|---------|
| `generateCodeVerifier()` | สุ่ม 43 chars string (URL-safe base64) |
| `generateCodeChallenge(verifier)` | SHA-256 hash → base64url |

### `src/lib/utils.ts`
**Utility functions ทั่วไป** (formatDate, avatarColor ฯลฯ)

---

## 8. Routing & Navigation

```
/                    → redirect → /dashboard
/login               → Login.tsx (ไม่ต้องล็อกอิน)
/callback            → AuthCallback.tsx (ไม่ต้องล็อกอิน)
/dashboard           → Dashboard.tsx [Layout]
/attendance          → AttendanceCalendar.tsx [Layout]
/tickets             → Tickets.tsx [Layout]
/assets              → ITAssets.tsx [Layout]
/tasks               → AssignedTasks.tsx [Layout]
/pm                  → ProjectList.tsx [Layout]
/pm/:projectId       → ProjectManagement.tsx [Layout]
/attendance/daily    → DailyPreview.tsx [noLayout — standalone]
```

**ProtectedRoute**: ทุก route ยกเว้น `/login` และ `/callback` ต้องผ่าน `isAuthenticated` check  
ถ้าไม่ได้ล็อกอิน → redirect ไป `/login`

**View-Only Mode**: เพิ่ม `?mode=view` ต่อท้าย URL `/pm/:projectId?mode=view`  
→ ซ่อนปุ่ม edit ทั้งหมด, disable drag, แสดง badge "View Only"

---

## 9. PM Module — ลึกเป็นพิเศษ

### ภาพรวม

PM Module คือระบบบริหารโปรเจกต์ที่ซับซ้อนที่สุดใน OpsOne  
ไฟล์ `ProjectManagement.tsx` มีมากกว่า 1,700 บรรทัด ประกอบด้วย sub-components, hooks, และ business logic หลายชั้น

### Sub-components ภายใน ProjectManagement.tsx

#### `KanbanCard`
- Card แสดง ticket หนึ่งใบในมุมมอง Kanban
- **Draggable** ด้วย `useDraggable` (@dnd-kit)
- แสดง: priority dot (สี), type badge, assignee avatar, all_device progress bar
- ถ้า `isViewOnly=true` → ไม่มี drag handle และ drag ถูก disable

#### `KanbanColumn`
- Column หนึ่งในบอร์ด Kanban (Start / All Device / In Progress / Pending / Total)
- **Droppable** ด้วย `useDroppable`
- จัดเรียง tickets: parent tickets ก่อน → sub-tasks ตามหลัง (indent ซ้าย 16px)

#### `GanttChart`
- Split-panel Gantt Chart (ซ้าย: ตาราง ticket, ขวา: กราฟแท่งเวลา)
- **Drag**: ลากแท่งซ้าย-ขวา → เลื่อน plan_start และ plan_end
- **Resize**: ลาก handle ขวาสุดของแท่ง → ขยาย plan_end
- **Resizable divider**: ลากเส้นตรงกลางเพื่อปรับ width ของ left panel
- แสดง: milestones (diamond shape), dependency arrows (SVG Bezier curves)
- Today line (เส้นแนวตั้งสีม่วง)
- Weekend shading (พื้นหลังสีแดงอ่อน)
- ถ้า `isViewOnly=true` → ไม่มี drag/resize/add-subtask

#### `AnalyticsView`
- Burn-down Chart (recharts LineChart): เส้นแผน (dashed) vs งานคงเหลือจริง
- S-Curve (recharts AreaChart): งานสะสมแผน vs งานสะสมจริง
- Efficiency Report (recharts BarChart horizontal): เฉลี่ย quantity/วัน ของแต่ละ assignee

#### `TicketModal`
- Modal สร้าง/แก้ไข ticket
- **Validation**: ถ้าไม่กรอก plan_start / plan_end / all_device → แสดง Warning Modal ก่อน (ยังบันทึกต่อได้)
- **Quantity Tracking**: บันทึกจำนวนรายวัน พร้อม summary cards (All Device / Pending / Total)
- **isViewOnly**: ทุก field disabled, ซ่อนปุ่ม save/delete
- **isAssigneeOnly**: user ที่ไม่ใช่ assignee → field ทั้งหมด disabled แต่ยังดู/เพิ่ม Quantity ได้
- Warning modal ใช้ `e.stopPropagation()` ป้องกัน click bubble ปิด TicketModal

#### `ProjectSelector`
- แสดง project chip buttons (สลับ project ใน view เดียวกัน)
- ไม่มีปุ่มสร้าง/ลบ (ให้กลับไปสร้างที่หน้า `/pm` แทน)

#### `ConfirmModal`, `ToastContainer`
- Reusable modal ยืนยันการลบ
- Toast notification (success/error/info) ปรากฏล่างขวา auto-dismiss

### Business Logic สำคัญ

#### `computeRecursiveProgress(tickets, quantityLogs)`
คำนวณ progress ของ ticket แบบ recursive (ลงลึกถึง leaf)

**Strategy A** (ticket มี all_device): `progress = totalDone / all_device × 100`  
**Strategy B** (parent ticket ที่ลูกไม่มี all_device): `progress = completedChildren / totalChildren × 100`  
(นับ status='total' เป็น "เสร็จ")

ใช้ `Map<ticketId, {pct, status}>` เก็บผลลัพธ์เพื่อ reuse ใน Gantt และ Summary stats

#### `computeQuantity(ticket, quantityLogs)`
สำหรับ leaf ticket: `totalDone = sum(logs.quantity)`, `pct = totalDone / all_device × 100`

#### `hasCircularParent(ticketId, proposedParentId, tickets)`
Guard ป้องกัน circular parent reference ใน parent_id dropdown

#### Ripple Effect (server-side `/api/pm/tickets/:id/ripple`)
เมื่อ ticket ถูกเลื่อนวัน → เลื่อน successor tickets และ sub-tasks ด้วยตาม dependency graph  
ใช้ BFS traversal ใน server.js

#### Kanban Drag & Drop
- `@dnd-kit/core` — `DndContext`, `PointerSensor`
- `handleDragStart`: บันทึก activeId
- `handleDragEnd`: detect column ที่ drop → PATCH `/api/pm/tickets/:id` อัปเดต status
- `isViewOnly`: pass `sensors={[]}` (ไม่มี sensor = drag disable)

### Views (3 modes)

| View | URL Parameter | ทำอะไร |
|------|--------------|---------|
| `kanban` | (default) | Kanban board แบ่งตาม status |
| `gantt` | - | Gantt chart + timeline |
| `analytics` | - | Charts: Burn-down, S-Curve, Efficiency |
| View-Only | `?mode=view` | ทุก view แต่ไม่มี edit |

### Permission Logic

```
isViewOnly   = searchParams.get('mode') === 'view'
               → ซ่อนปุ่มทั้งหมด, disable drag, modal read-only

isAssigneeOnly (ใน TicketModal)
               = ticket.assignee_id !== currentUser.sub && ticket มี assignee
               → field ทั้งหมด disabled แต่ยังเพิ่ม Quantity Log ได้

canEditFields = !isViewOnly && !isAssigneeOnly
```

---

## 10. การ Deploy & Infrastructure

### Server
- **OS**: Linux (Ubuntu/Debian)
- **Node.js**: รัน server.js ด้วย PM2
- **Port**: 3000 (internal), 80/443 (public via Nginx)
- **PM2 Config**: `ecosystem.config.cjs`

### Commands ที่ใช้บ่อย
```bash
# Build frontend
cd /home/opsone/OpsOne && npx vite build

# Deploy (restart server)
sudo pm2 restart all --update-env

# ดู logs
sudo pm2 logs opsone

# ดู status
sudo pm2 status
```

### Nginx Config
`nginx.conf` — reverse proxy จาก 80/443 → localhost:3000  
Cloudflare อยู่ด้านหน้า (X-Forwarded-For ผ่าน trust proxy)

### Environment Variables
```
PORT         = 3000
DB_HOST      = localhost
DB_PORT      = 5432
DB_NAME      = opsone_db
DB_USER      = opsone
DB_PASS      = <set-in-ecosystem.config.cjs>   # never commit the real value

VITE_TENCYBER_URL          = https://dashboard.tenfw.com
VITE_TENCYBER_CLIENT_ID    = <client_id>
VITE_TENCYBER_REDIRECT_URI = https://opsone.tenfw.com/callback
```

### Database Migration Strategy
- Migration รันแบบ `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` ตอน server start
- ไม่มี migration framework — รัน SQL ตรงใน `pool.connect().then()`
- ใช้ `DO $$ ... EXCEPTION WHEN ... END $$` สำหรับ idempotent changes

---

## 11. Error ที่แก้ไขแล้ว

### ชุดนี้ (มีนาคม 2569)

| ไฟล์ | Error | วิธีแก้ |
|------|-------|---------|
| `ProjectManagement.tsx` | `Tag` imported แต่ไม่ใช้ | ลบออกจาก import |
| `ProjectManagement.tsx` | `rowIdx` declared แต่ไม่ใช้ | เปลี่ยน `(row, rowIdx)` → `(row)` |
| `ProjectManagement.tsx` | `completedTaskCount` ไม่ถูกใช้ | เปลี่ยนเป็น comment |
| `ProjectManagement.tsx` | `maxAvg` ไม่ถูกใช้ | ลบออก (ไม่ได้ใช้ใน JSX) |
| `ProjectManagement.tsx` | `ReTooltip formatter` type error | เปลี่ยน type `number` → `unknown` |
| `ProjectManagement.tsx` | `createProject`, `deleteProject` ไม่ถูกใช้ | ลบออก (ย้ายสร้าง/ลบไปที่ ProjectList แล้ว) |
| `ProjectList.tsx` | `X`, `CheckCircle2`, `Clock` imported แต่ไม่ใช้ | ลบออกจาก import |

### Bug ที่แก้ไขใน Session นี้

| Bug | สาเหตุ | วิธีแก้ |
|-----|--------|---------|
| Warning Modal กด "กลับไปแก้ไข" แล้วปิด TicketModal ด้วย | Click event bubble ขึ้นไปถึง backdrop ของ TicketModal | เพิ่ม `e.stopPropagation()` ที่ backdrop ของ Warning Modal |
| DailyPreview ไม่อัปเดตวันเมื่อ URL มี `?date=` | Guard `if (searchParams.get('date')) return;` block midnight check | ลบ guard + เพิ่ม mount-time stale check |
| URL ไม่ sync เมื่อเปลี่ยนวันใน DailyPreview | selectedDate เปลี่ยนแต่ URL ไม่อัปเดต | เพิ่ม useEffect `setSearchParams({date: selectedDate}, {replace: true})` |

---

*เอกสารนี้สร้างโดย GitHub Copilot จากการวิเคราะห์ source code ทั้งหมดของ OpsOne Platform*
