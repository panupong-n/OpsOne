# OpsOne — แผนปรับปรุง UX/UI ใหม่ทั้งระบบ

> เอกสารแผน (ฉบับให้รีวิวก่อนลงมือ) · จัดทำ 2026-06-06
> โทนสี **ฟ้า–ขาว** · ฟอนต์ **IBM Plex Sans Thai** · เมนู **Sidebar ซ้าย** · ทำเป็นเฟส
> หลักการสำคัญ: **ฟังก์ชันเดิมทุกอย่างต้องใช้งานได้ครบตลอดทุกเฟส** (no feature loss)

---

## 1. เป้าหมาย & หลักการออกแบบ

ปัญหาปัจจุบัน (ยืนยันจากการตรวจระบบจริง):
- เมนูเป็น **iOS dock ลอยล่างจอ** (`Layout.tsx`) → หาเมนูยาก ไม่เป็นมืออาชีพ
- ธีม/ฟอนต์ **migrate ค้างครึ่งทาง** → CSS มี token ฟ้า-ขาว + sidebar token ครบแล้ว แต่ UI ยังเป็น dock + มีสีม่วง `#6366F1` ฮาร์ดโค้ดหลงเหลือหลายจุด
- **ระบบงาน/โครงการซ้อนกัน 2 ชุด** สับสน: `projects`+`tasks` (งานปฏิบัติการ) กับ `pm_projects`+`pm_tickets` (วางแผนโครงการ Kanban/Gantt)
- มุมมอง "งานรายคน" มี (`TasksOverview`) แต่ **ไม่มีมิติปี / สถานะปิดโครงการ** → กระจายงานไม่ถูก
- กราฟใช้น้อย/ไม่สม่ำเสมอ (recharts ใช้แค่ใน `ProjectManagement`)

หลักการออกแบบใหม่:
1. **Navigation ชัดเจน** — sidebar ซ้ายถาวร จัดกลุ่มตามงานจริง หาเมนูเจอใน 1 คลิก
2. **Design system เดียว** — สี/ฟอนต์/การ์ด/ปุ่ม/กราฟ มาตรฐานเดียวทั้งระบบ
3. **ลดความซ้ำซ้อน** — แยกบทบาท 2 ระบบงานให้ชัด ไม่ทับซ้อน
4. **Data-first** — ทุกหน้ามีสถานะว่าง/โหลด/ผิดพลาดชัด, ตัวเลขอ่านง่าย
5. **ของเดิมไม่พัง** — เก็บทุก route/endpoint เดิม, redesign ทีละชั้น

---

## 2. Design System ใหม่

### 2.1 สี (ฟ้า–ขาว) — มีใน `index.css` แล้ว ปรับให้ใช้ทั้งระบบ
| Token | ค่า | ใช้กับ |
|------|-----|--------|
| `--color-primary` | `#2563EB` | ปุ่มหลัก, active nav, ลิงก์ |
| `--color-primary-hover` | `#1D4ED8` | hover |
| `--color-primary-soft` | `#EFF6FF` | พื้นหลังอ่อน, badge |
| `--color-bg` | `#F1F5F9` | พื้นหลังหน้า |
| `--color-surface` | `#FFFFFF` | การ์ด |
| `--color-sidebar` | `#0F172A` (navy เข้ม) | แถบ sidebar |
| semantic | success `#10B981` / warning `#F59E0B` / error `#EF4444` / info `#0EA5E9` | สถานะ |

**งานสี:** ค้นและแทนสีม่วงฮาร์ดโค้ดทั้งหมด (`#6366F1`, `rgba(99,102,241,*)`) → token ฟ้า ทุกไฟล์

### 2.2 ฟอนต์ — เปลี่ยน Sarabun → **IBM Plex Sans Thai**
- โหลดผ่าน Google Fonts ใน `index.html` (ตัด Sarabun ออก)
- `index.css` body: `'IBM Plex Sans Thai', 'IBM Plex Sans', system-ui, ...`
- น้ำหนัก: 300/400/500/600/700; ตั้ง `font-feature-settings` + tabular-nums สำหรับตัวเลข dashboard

### 2.3 คอมโพเนนต์มาตรฐาน (สร้างใหม่ใน `src/components/ui/`)
`AppShell` · `Sidebar` · `Topbar` · `PageHeader` · `Card` · `StatCard` · `DataTable` (sort/filter/paginate) · `Badge`/`StatusPill` · `Button` · `Select`/`Combobox` · `Modal`/`Drawer` · `Tabs` · `EmptyState` · `Toast` (มี sonner แล้ว) · `Chart*` (wrapper recharts: Bar/Line/Donut/Progress + ธีมฟ้า)

### 2.4 กราฟ — มาตรฐานเดียวด้วย recharts
- Wrapper `ChartCard` คุมสี/แกน/tooltip/legend แบบฟ้า-ขาว สม่ำเสมอทุกหน้า
- Dashboard/Overview/Project ใช้ชุดเดียวกัน อ่านง่าย ลด 3D/Three.js ที่หนักและไม่ช่วยสื่อสาร

---

## 3. Information Architecture ใหม่ (Sidebar)

แทน dock เดิมด้วย **sidebar ซ้าย** จัดกลุ่มเป็นหมวด (collapsible, จำสถานะ, แสดง/ซ่อนตาม role):

```
OpsOne
─ ภาพรวม
   • Dashboard            /dashboard
─ การปฏิบัติงาน (Operations)
   • งาน & ปฏิทิน          /tasks            (assign งาน + ออกพื้นที่/ลา)
   • ภาระงานทีม            /tasks/overview   (คน × ปี × สถานะ)  ← ปรับใหญ่
   • Support Tickets       /tickets
─ วางแผนโครงการ (Project Planning)   ← โมดูลแยกเดี่ยว (Kanban/Gantt)
   • โครงการทั้งหมด        /pm
   • บอร์ด/แผนงาน          /pm/:id           (Kanban · Gantt · Backlog · ภาพรวม)
─ ทรัพย์สิน
   • IT Assets             /assets
─ แบบประเมิน (Survey ISO)
   • Dashboard/รายการ/ติดตาม/รายงาน/ผู้ใช้  /survey/*
─ ระบบ (admin)
   • HR Intake             /hr/intake
   • ตั้งค่า                (SettingsModal)
```

**การลดความซ้ำ / จัดกลุ่ม:**
- 2 ระบบงานแยกบทบาทชัด (ไม่ merge ตามที่ยืนยัน):
  - **การปฏิบัติงาน** = `tasks`/`projects` → งานประจำวัน + การออกพื้นที่ + ภาระงานรายคน
  - **วางแผนโครงการ** = `pm_projects`/`pm_tickets` → Kanban/Gantt/Backlog/Sprint/Milestone (โมดูลวางแผน standalone, ออกแบบใหม่ระดับสากล)
- `/attendance` ปัจจุบัน redirect → `/tasks?tab=attendance` คงไว้ (เก็บฟังก์ชัน)
- รวมรายการ Survey 8 หน้าให้เป็นหมวดเดียวมี sub-nav ของตัวเอง (มี `SurveyLayout` อยู่แล้ว)

---

## 4. การออกแบบใหม่รายโมดูล (คงทุกฟังก์ชันเดิม)

### 4.1 App Shell (Layout)
- Sidebar ซ้าย (desktop ถาวร / มือถือ = drawer) + Topbar (โลโก้, ค้นหา, แจ้งเตือน-เก็บ logic เดิม, ผู้ใช้)
- ลบ dock + Three.js background, ใช้พื้นฟ้า-ขาวสะอาด
- ใส่ `PageHeader` มาตรฐานทุกหน้า (ชื่อ + breadcrumb + action ขวา)

### 4.2 Dashboard (`/dashboard`, 492 บรรทัด)
- การ์ดสถิติ (StatCard) แถวบน: งานทั้งหมด/กำลังทำ/เสร็จ, คนวันนี้, ทรัพย์สิน, ticket เปิด
- กราฟมาตรฐาน: งานตามสถานะ (donut), ภาระงานต่อทีม (bar), แนวโน้มการออกพื้นที่ (line)
- เมทริกซ์ พนักงาน × Product × ลูกค้า: ทำเป็น `DataTable` อ่านง่าย + ลิงก์ไปภาระงานทีม

### 4.3 งาน & ปฏิทิน (`/tasks`, `AssignedTasks` 1,962 บรรทัด)
- คงแท็บ: รายการงาน assign + ปฏิทินการออกพื้นที่/ลา (logic เดิม `task_visits`, วันหยุดไทย)
- ปรับ: ฟอร์มบันทึกออกพื้นที่ (3 สเต็ป) เป็น Drawer สะอาด, การ์ดงานใช้ StatusPill, avatar คน
- เพิ่มตัวกรอง: ทีม / สถานะ / Product

### 4.4 ภาระงานทีม (`/tasks/overview`, `TasksOverview`) ← **เพิ่มฟีเจอร์ตามโจทย์**
มุมมองหลักสำหรับ "กระจายงานให้ถูก":
- **ตัวกรองปี** (พ.ศ.) + **สถานะโครงการ (เปิด/ปิด)** ด้านบน
- Group: ทีม → คน; แต่ละคนแสดง: จำนวนงาน head/sub, จำนวนโครงการ, แยกตามปี
- คลิกคน → drawer: "ปีนี้คนนี้มีงานอะไรบ้าง" (โครงการ, สถานะ, head/sub, เปิด/ปิด)
- กราฟภาระงานเปรียบเทียบรายคน (bar) เพื่อดูใครงานล้น/ว่าง

### 4.5 Support Tickets (`/tickets`, 2,103 บรรทัด)
- คงทุกฟังก์ชัน, จัดเป็น `DataTable` + ฟิลเตอร์สถานะ/ผู้รับผิดชอบ + รายละเอียดเป็น Drawer

### 4.6 IT Assets (`/assets`, `ITAssets` 1,160 บรรทัด, 220 รายการ)
- `DataTable` + ค้นหา/กรอง (กลุ่ม/ประเภท/สถานะ/ผู้ถือครอง/อาคาร), นำเข้า CSV เดิมคงไว้
- รายละเอียด/โอนย้าย (`asset_transfers`) เป็น Drawer

### 4.7 วางแผนโครงการ — Kanban/Gantt (`/pm`, `ProjectManagement` 1,832 บรรทัด) ← **ออกแบบใหม่ระดับสากล**
โมดูลแยกเดี่ยวสำหรับวางแผน (ตามที่ยืนยัน) ให้ครบ ใช้งานได้จริง:
- `/pm` รายการโครงการ: การ์ด + ความคืบหน้า + ช่วงวันที่ + สถานะ
- `/pm/:id` มี 4 view: **Board (Kanban)** drag-drop (@dnd-kit มีแล้ว) · **Gantt** (plan_start/plan_end/dependencies/milestones) · **Backlog/Sprint** · **ภาพรวม** (burndown, progress, storypoints)
- ฟอร์มงาน (pm_tickets) ครบฟิลด์: ประเภท/สถานะ/ความสำคัญ/ผู้รับผิดชอบ/แผนวัน/ชั่วโมง/storypoints/acceptance/tags/blocker
- กราฟ: ความคืบหน้าโครงการ, burndown sprint, ภาระตามผู้รับผิดชอบ

### 4.8 Survey ISO (`/survey/*`, 8 หน้า)
- คง `SurveyLayout` + sub-nav, ปรับธีมฟ้า-ขาว + กราฟรายงานมาตรฐาน (`SurveyReportPage`)

### 4.9 HR Intake (`/hr/intake`) — ปรับธีม + `DataTable`

---

## 5. ฟีเจอร์ใหม่: ภาระงานรายคน × ปี × สถานะปิดโครงการ

**ปัญหา:** งานปฏิบัติการ (`tasks`/`projects`) ไม่มีมิติปี/สถานะปิดโครงการเลย (tasks มีแค่ `created_at`, projects ไม่มีวันที่/สถานะ)

**Schema (เพิ่มแบบ backward-compatible, มี default):**
```sql
-- โครงการปฏิบัติการ: เพิ่มปี + วงจรชีวิต
ALTER TABLE projects ADD COLUMN IF NOT EXISTS year        smallint;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS status      text DEFAULT 'active';   -- active|closed|archived
ALTER TABLE projects ADD COLUMN IF NOT EXISTS start_date  date;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS end_date    date;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS closed_at   timestamptz;
-- backfill ปีจากงานที่มีอยู่
UPDATE projects p SET year = sub.y FROM (
  SELECT project_id, EXTRACT(YEAR FROM MIN(created_at))::smallint y
  FROM tasks GROUP BY project_id) sub
WHERE p.id = sub.project_id AND p.year IS NULL;
```
(ทางเลือก: เพิ่ม `tasks.due_date`/`tasks.year` ถ้าต้องการมิติปีระดับงาน — สรุปตอนเริ่มเฟส)

**Backend:** เพิ่ม endpoint `GET /api/workload?year=&status=` คืน คน → {ปี, โครงการ, เปิด/ปิด, head/sub, จำนวน}; และ CRUD ปิด/เปิดโครงการ (`PATCH /api/projects/:id/status`)

**UI:** อยู่ใน "ภาระงานทีม" (§4.4) + badge สถานะโครงการในทุกที่ที่อ้างถึงโครงการ

---

## 6. การแบ่งเฟส (ฟังก์ชันเดิมใช้ได้ครบทุกเฟส)

| เฟส | งาน | ผลลัพธ์ |
|----|-----|--------|
| **0** | git init + .gitignore, สำรอง, ลบไฟล์ `.bak`/ขยะ, ตั้ง type-check baseline | ปลอดภัยก่อนแก้ |
| **1** | Design system + **AppShell/Sidebar** + ฟอนต์ IBM Plex + แทนสีม่วง→ฟ้า ทั้งระบบ | เปลี่ยน look ทั้งระบบทันที เมนูใหม่ |
| **2** | คอมโพเนนต์ UI กลาง (`ui/`) + `ChartCard` + `DataTable` | ฐานสำหรับทุกหน้า |
| **3** | Dashboard + งาน&ปฏิทิน redesign | โมดูลหลักที่ใช้บ่อย |
| **4** | **ภาระงานทีม + ฟีเจอร์ปี/ปิดโครงการ** (schema+API+UI) | โจทย์หลักของผู้ใช้ |
| **5** | IT Assets + Tickets redesign | ตารางข้อมูลใหญ่ |
| **6** | **วางแผนโครงการ Kanban/Gantt** ออกแบบใหม่เต็ม | โมดูล planning |
| **7** | Survey + HR Intake ปรับธีม + polish + responsive + a11y | เก็บงาน |

แต่ละเฟส: ทำ → `npm run build`/type-check ผ่าน → ผมรายงาน → คุณรีวิว → ไปเฟสถัดไป

---

## 7. ความเสี่ยง & การป้องกัน
- ⚠️ **ไม่ใช่ git repo** → เฟส 0 ทำ `git init` ก่อน (สำคัญมากสำหรับงาน redesign 14,600 บรรทัด) เพื่อย้อนได้
- ระบบงาน 2 ชุดแยกชัด — ไม่ merge, ลด confusion ด้วย IA/ป้ายกำกับ
- `server.js` 155KB โมโนลิธ — แก้เฉพาะส่วน workload/projects-status, ไม่รื้อ (ลดความเสี่ยง)
- มี MUI + AntD + Tailwind ปนกัน → design system ใหม่ยึด Tailwind+token เป็นหลัก ค่อย ๆ ลดการพึ่ง 2 ตัวแรก
- คงทุก route/endpoint เดิม, ทดสอบ build ทุกเฟส

---

## 8. สิ่งที่จะ "เอาออก/ลด"
- iOS dock + Three.js background (หนัก ไม่ช่วยใช้งาน)
- สีม่วงฮาร์ดโค้ดที่ไม่ใช่ token
- ไฟล์ `.bak` และสคริปต์ทดลองที่ค้างใน root
- การพึ่ง MUI/AntD ที่ซ้ำกับคอมโพเนนต์ใหม่ (ทยอยลด ไม่รื้อทันที)
