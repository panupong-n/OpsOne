# 📋 Project Management System — OpsOne

## ภาพรวม

ระบบ Project Management (PM) ของ OpsOne ใช้สำหรับจัดการโปรเจกต์, ติดตามงาน, วางแผนไทม์ไลน์ และคำนวณความคืบหน้าของการดำเนินงาน รองรับทั้งมุมมอง **Kanban Board** และ **Gantt Chart** แบบ BigPicture-style (ข้อมูลซ้าย + แผนภูมิขวา)

### Routing

| URL | หน้าที่ |
|---|---|
| `/pm` | หน้ารายการโปรเจกต์ — แสดงชื่อ, ผู้สร้าง, วันที่สร้าง/อัพเดท, จำนวน Tickets |
| `/pm/:projectId` | หน้าจัดการโปรเจกต์ — Kanban / Gantt / Settings |

---

## 🗂️ โครงสร้างระบบ

### หน้ารายการ: `src/pages/ProjectList.tsx`

แสดง Project Cards พร้อมข้อมูล:
- ชื่อโปรเจกต์ + คำอธิบาย + สี
- จำนวน Tickets, สถานะ (Active/etc)
- สร้างโดยใคร + เมื่อไหร่ (พ.ศ.)
- อัพเดทล่าสุดโดยใคร + เมื่อไหร่ (พ.ศ.)

### หน้าจัดการ: `src/pages/ProjectManagement.tsx`

ประกอบด้วย Component หลัก:

| Component | หน้าที่ |
|---|---|
| `ProjectManagement` | หน้าหลัก — จัดการโปรเจกต์, โหลดข้อมูล, สลับมุมมอง |
| `ProjectSelector` | เลือก/สร้าง/ลบ โปรเจกต์ |
| `KanbanColumn` | คอลัมน์ Kanban แต่ละสถานะ (รองรับ Drag & Drop) |
| `KanbanCard` | การ์ด Ticket ใน Kanban |
| `GanttChart` | Gantt Chart แบบ Split View (ตารางข้อมูล + แผนภูมิ) |
| `TicketModal` | Modal สร้าง/แก้ไข Ticket พร้อมบันทึกจำนวน |
| `ConfirmModal` | Modal ยืนยันการลบ |
| `ToastContainer` | แจ้งเตือนผลลัพธ์ |

### Component แชร์: `src/components/ThaiDatePicker.tsx`

| Component / Function | หน้าที่ |
|---|---|
| `ThaiDatePicker` | DatePicker (Ant Design) แสดงปี พ.ศ. — ใช้ทั้งระบบ |
| `formatThaiDate()` | แปลงวันที่เป็นข้อความไทย เช่น `วันจันทร์ 16 มีนาคม 2569` |
| `formatThaiDateShort()` | แปลงวันที่เป็นย่อ เช่น `16/03/69` |

### ฐานข้อมูล (PostgreSQL)

| ตาราง | หน้าที่ |
|---|---|
| `pm_projects` | โปรเจกต์ — id, name, description, color, status, start_date, end_date, created_by, updated_by |
| `pm_tickets` | Ticket/Task — รายละเอียดงานทั้งหมด รวมถึง parent_id สำหรับ Sub-task |
| `pm_milestones` | Milestone — เป้าหมายสำคัญในโปรเจกต์ |
| `pm_sprints` | Sprint — รอบการทำงาน |
| `pm_dependencies` | Dependency — ความสัมพันธ์ระหว่าง Ticket (FS, SS, FF, SF) |
| `pm_quantity_logs` | บันทึกจำนวน In Progress รายวัน — ใช้คำนวณ Pending และ Total |

#### DB Indexes & Constraints
- `idx_pm_tickets_parent_id` — Index บน parent_id เพื่อให้การดึง Tree เร็วขึ้น
- `idx_pm_tickets_project_id` — Index บน project_id
- `idx_pm_quantity_logs_ticket_id` — Index บน ticket_id
- `chk_all_device_non_negative` — CHECK (all_device >= 0) ป้องกันค่าติดลบ
- `UNIQUE(ticket_id, log_date)` — บน pm_quantity_logs ป้องกันบันทึกซ้ำวันเดียวกัน

---

## 📅 ระบบวันที่ (พ.ศ.)

ทั้งระบบแสดงวันที่เป็น **พุทธศักราช (พ.ศ.)** โดยใช้:

- **Ant Design DatePicker** + **dayjs** + **buddhistEra plugin** สำหรับตัวเลือกวันที่
- Format: `DD/MM/BBBB` (เช่น 16/03/2569)
- Calendar popup แสดงปี พ.ศ.
- Locale: `th` (ภาษาไทย)

**ตัวเลือกวันที่ที่ใช้ ThaiDatePicker:**
- Ticket Modal: วันเริ่ม, วันสิ้นสุด, Due Date, วันที่บันทึกจำนวน
- Settings Panel: Milestone due date, Sprint start/end dates
- DailyPreview: เลือกวันที่แสดงผล

**การแสดงวันที่อื่น ๆ** ใช้ `toLocaleDateString('th-TH', ...)` ซึ่งแสดงปี พ.ศ. โดยอัตโนมัติ (Attendance, Tickets, ITAssets, AssignedTasks)

---

## 📊 สถานะ (Status)

ระบบมี 5 สถานะ เรียงตามขั้นตอนการทำงาน:

| ลำดับ | Key | Label | ความหมาย | สี |
|---|---|---|---|---|
| 1 | `start` | Start | เริ่มต้น — งานพร้อมเริ่ม | 🟣 #6366F1 |
| 2 | `all_device` | All Device | กำหนดจำนวนเครื่องทั้งหมด | 🔵 #0EA5E9 |
| 3 | `in_progress` | In Progress | กำลังดำเนินการ | 🟡 #F59E0B |
| 4 | `pending` | Pending | รอดำเนินการ (คำนวณอัตโนมัติ) | 🟣 #8B5CF6 |
| 5 | `total` | Total | เสร็จสมบูรณ์ (ยอดรวม) | 🟢 #10B981 |

### การเปลี่ยนสถานะ
- สามารถลาก Ticket ระหว่างคอลัมน์ใน Kanban Board ได้ (Drag & Drop)
- หรือเปลี่ยนในหน้า Ticket Modal
- **Status → Total Auto-fill**: เมื่อเปลี่ยนเป็น Total ระบบจะถามว่าต้องการบันทึก Quantity ให้ครบ All Device หรือไม่

---

## 📦 ประเภท (Type)

| Key | Label | สี |
|---|---|---|
| `product` | Product | 🟣 #6366F1 |
| `service` | Service | 🟢 #10B981 |

---

## 🔢 ระบบจำนวน (Quantity Tracking)

### ฟิลด์หลัก

| ฟิลด์ | ตำแหน่ง | คำอธิบาย |
|---|---|---|
| **All Device** | `pm_tickets.all_device` | จำนวนเครื่องทั้งหมด (ตั้งค่าครั้งเดียว) |
| **In Progress** | `pm_quantity_logs.quantity` | จำนวนที่ดำเนินการในแต่ละวัน (Manual) |
| **Pending** | คำนวณอัตโนมัติ | จำนวนคงเหลือ |
| **Total** | คำนวณอัตโนมัติ | ยอดรวมที่ดำเนินการแล้ว |

### สูตรคำนวณ

#### วันที่ 1:
```
All Device = 1000 (ค่าคงที่)
In Progress = 100 (Manual — บันทึกจำนวนที่ทำได้ในวันนั้น)
Pending = All Device - In Progress = 1000 - 100 = 900
Total = In Progress (ของวันที่ 1) = 100
```

#### วันที่ 2 เป็นต้นไป:
```
All Device = 1000 (เท่าเดิม)
In Progress = 50 (Manual — บันทึกจำนวนที่ทำในวันที่ 2)
Pending = Pending ของวันก่อนหน้า - In Progress ของวันนี้ = 900 - 50 = 850
Total = Total ของวันก่อนหน้า + In Progress ของวันนี้ = 100 + 50 = 150
```

#### วันที่ 3:
```
All Device = 1000
In Progress = 200 (Manual)
Pending = 850 - 200 = 650
Total = 150 + 200 = 350
```

### เปอร์เซ็นต์ความคืบหน้า (Progress %)
```
Progress % = (Total / All Device) × 100
```
- เปอร์เซ็นต์จะแสดงบน **Gantt Chart** ทั้งในตารางฝั่งซ้าย และใน Bar บน Chart
- ถ้าไม่ได้ตั้งค่า All Device จะใช้ค่า Progress แบบ Manual (0-100%)
- TicketModal จะแสดง badge **"ระบบคำนวณ"** (สีเขียว) ถ้าใช้ All Device หรือ **"กำหนดเอง"** (สีฟ้า) ถ้าใช้ Manual

### ตาราง pm_quantity_logs

| คอลัมน์ | ชนิด | คำอธิบาย |
|---|---|---|
| `id` | UUID | Primary Key |
| `ticket_id` | UUID | FK → pm_tickets |
| `log_date` | DATE | วันที่บันทึก |
| `quantity` | INT | จำนวนที่ดำเนินการ (In Progress) |
| `created_at` | TIMESTAMPTZ | เวลาที่สร้าง |

- มี UNIQUE constraint บน `(ticket_id, log_date)` — บันทึกได้วันละ 1 ครั้งต่อ Ticket
- ถ้าบันทึกซ้ำวันเดียวกัน จะ overwrite ค่าเดิม (UPSERT)
- ถ้าบันทึกจำนวน = 0 → ระบบจะ DELETE log แทนที่จะเก็บ (ลดขนาด DB)
- มี Validation: ไม่สามารถบันทึก Log ในวันที่นอกช่วง plan_start — plan_end ของ Ticket (ถ้ากำหนดไว้)

---

## 🧮 Recursive Progress (ความคืบหน้าแบบสะสม)

### หลักการ
Parent Task คิดความคืบหน้าจาก **Weighted Average** ของ Sub-task:

1. **Leaf Ticket (ไม่มี Sub-task)**:
   - ถ้ามี `all_device > 0` → คำนวณจาก `(Total / All Device) × 100`
   - ถ้าไม่มี → ใช้ค่า `progress` แบบ Manual (0-100%)

2. **Parent Ticket (มี Sub-task)**:
   - **ถ้าลูกมี all_device**: $Parent \% = \frac{\sum (ChildPct \times ChildWeight)}{\sum ChildWeight}$ (ถ่วงน้ำหนักตาม all_device)
   - **ถ้าลูกไม่มี all_device**: ใช้ `AVG(progress)` ตามเดิม
   - มีระบบป้องกัน **Circular Dependency** (visiting guard) เพื่อไม่ให้เกิด infinite loop
   - แสดงเป็นสีเทาบน Gantt Chart (เพื่อแยกจากสีเขียว/ฟ้าของ Leaf)

3. **Parent Field Locking**:
   - ถ้า Ticket มี Sub-task: Lock ฟิลด์ All Device, Progress, Quantity (คำนวณจากลูกอัตโนมัติ)
   - ถ้าไม่มี Sub-task: เปิดให้กรอกตามปกติ

### การแสดงสีบน Gantt Chart

| ประเภท | สี Progress Bar | ตัวอย่าง |
|---|---|---|
| Quantity-based (all_device > 0) | 🟢 `#10B981` (เขียว) | Ticket ที่ตั้ง All Device แล้ว |
| Manual (all_device = 0) | 🔵 `#0EA5E9` (ฟ้า) | Ticket ที่ใช้ Progress % ปกติ |
| Parent (มี Sub-task) | ⚪ `#64748B` (เทา) | AVG/Weighted ของ Sub-task |

### ฟังก์ชัน
```typescript
computeRecursiveProgress(tickets: PmTicket[], logs: PmQuantityLog[]): Map<string, number>
```
- ใช้ `useMemo([tickets, quantityLogs])` เพื่อ cache ผลลัพธ์
- ถูกเรียกใช้ใน GanttChart component

---

## 🏗️ Sub-task System

### โครงสร้าง
- ทุก Ticket สามารถมี **parent_id** อ้างอิงไปยัง Ticket อื่น
- Ticket ที่มี `parent_id = null` คือ **Root Task**
- Ticket ที่มี `parent_id` คือ **Sub-task**

### การแสดงผล
- **Kanban**: Sub-task จะย่อเข้ามาพร้อมแสดงเครื่องหมาย `↳` และเส้นขอบซ้ายสี Primary
- **Gantt**: แสดงเป็น Tree — Root Task มีปุ่ม Expand/Collapse, Sub-task ย่อเข้าตามระดับ
- เพิ่ม Sub-task ได้จาก:
  - ปุ่ม `+` ที่แต่ละแถวใน Gantt (hover แล้วจะเห็น)
  - Ticket Modal → เลือก "Parent Task"

### ความคืบหน้า Parent
- Parent Task **ไม่ต้อง** กำหนด Progress เอง
- ระบบคำนวณ Progress = AVG ของ Sub-task ทั้งหมด (recursive)

---

## 📈 Gantt Chart (BigPicture-style)

### Layout
แบ่งเป็น 2 ส่วน:
- **ฝั่งซ้าย (Data Table)**: แสดงข้อมูล Ticket — ชื่อ, สถานะ, ผู้รับผิดชอบ, วันเริ่ม, วันสิ้นสุด, Progress
- **ฝั่งขวา (Chart)**: แสดง Bar ตามช่วงวันที่ พร้อม Dependency arrows

### คอลัมน์ฝั่งซ้าย

| คอลัมน์ | คำอธิบาย |
|---|---|
| Expand/Type | ปุ่ม ▶/▼ สำหรับ Expand/Collapse Sub-task หรือ จุดสีประเภท |
| TICKET | ชื่อ Ticket (ย่อเข้าตามระดับ Sub-task) + ปุ่ม `+` เพิ่ม Sub-task |
| STATUS | แสดงสถานะ (badge สี) |
| Assignee | รูป Avatar ผู้รับผิดชอบ |
| START | วันเริ่มต้น (แสดงแบบ DD/MM/ปีย่อ พ.ศ.) |
| END | วันสิ้นสุด (แสดงแบบ DD/MM/ปีย่อ พ.ศ.) |
| PROGRESS | เปอร์เซ็นต์ + mini progress bar (สีตามประเภท) |

### ฟีเจอร์ Gantt

| ฟีเจอร์ | คำอธิบาย |
|---|---|
| **Drag to Schedule** | ลาก Bar เส้นประ (งานที่ยังไม่กำหนดวัน) ไปวางเพื่อ Set วันที่อัตโนมัติ |
| **Drag to Move** | ลาก Bar เพื่อย้ายช่วงวันที่ (อัพเดท plan_start + plan_end) |
| **Drag to Resize** | ลากขอบขวาของ Bar เพื่อเปลี่ยนวันสิ้นสุด |
| **Divider Resize** | ลากแถบกั้นตรงกลางเพื่อปรับขนาดส่วนซ้าย-ขวา (300-800px) |
| **Today Line** | เส้นแนวตั้งสีน้ำเงินแสดงวันปัจจุบัน |
| **Weekend Stripes** | แถบสีแดงอ่อนสำหรับวันเสาร์-อาทิตย์ |
| **Dependency Arrows** | เส้นลูกศร Bezier แสดงความสัมพันธ์ระหว่าง Ticket |
| **Milestone Diamonds** | เพชรสีแสดง Milestone บน Timeline |
| **Progress Bar** | แถบสีภายใน Bar แสดงความคืบหน้า (เขียว/ฟ้า/เทา) |
| **Progress Icons** | Icon หน้าเลข Progress: 📊 = Quantity, ✍️ = Manual, 🌳 = Parent AVG |
| **Sync Scroll** | Header และ Body scroll แนวนอนพร้อมกัน |
| **No-date Fallback** | Ticket ที่ยังไม่มีวันที่ จะแสดงเป็น Bar เส้นประที่ตำแหน่งวันนี้ (opacity 60%) |

### Month Header
- แสดงชื่อเดือนย่อ + ปี พ.ศ. 2 หลัก (เช่น "มี.ค. 69")
- ใช้ dayjs + buddhistEra plugin

---

## 📝 ฟิลด์ใน Ticket Modal

### ข้อมูลหลัก

| ฟิลด์ | คำอธิบาย | บังคับ |
|---|---|---|
| ชื่อ Ticket | ชื่องาน | ✅ |
| ประเภท | Product หรือ Service | ✅ (default: Product) |
| Priority | Critical, High, Medium, Low | ✅ (default: Medium) |
| สถานะ | Start, All Device, In Progress, Pending, Total | ✅ (default: Start) |
| ผู้รับผิดชอบ | เลือกจาก Platform Users | ❌ |
| Parent Task | เลือก Root Task สำหรับทำเป็น Sub-task | ❌ |

### การวางแผน

| ฟิลด์ | คำอธิบาย |
|---|---|
| Milestone | เชื่อมกับ Milestone ของโปรเจกต์ |
| Sprint | เชื่อมกับ Sprint ของโปรเจกต์ |
| วันเริ่ม | วันเริ่มต้นงาน (ThaiDatePicker — พ.ศ.) |
| วันสิ้นสุด | วันสิ้นสุดงาน (ThaiDatePicker — พ.ศ.) |
| All Device | จำนวนเครื่องทั้งหมด (สำหรับคำนวณ) |
| ความคืบหน้า | Manual 0-100% หรือ คำนวณอัตโนมัติจาก Total/All Device |

### บันทึกจำนวน (Quantity Tracking)

- แสดงเฉพาะเมื่อ Ticket มี `All Device > 0` และเป็น Ticket ที่บันทึกแล้ว (มี id)
- แสดง 3 การ์ดสรุป: **ALL DEVICE** (ฟ้า), **PENDING** (ม่วง), **TOTAL** (เขียว)
- เพิ่มบันทึกรายวัน: เลือกวันที่ (ThaiDatePicker) + ใส่จำนวน → กด "เพิ่ม"
- บันทึกซ้ำวันเดียวกัน = UPSERT (overwrite ค่าเดิม)
- แต่ละรายการแสดง: วันที่ (DD/MM/ปีย่อ), In Progress, Pending สะสม, Total สะสม
- ลบรายการได้ (ปุ่ม ×)

### ข้อมูลเพิ่มเติม

| ฟิลด์ | คำอธิบาย |
|---|---|
| Story Points | คะแนน Effort (0.5, 1, 2, 3, 5, 8, 13) |
| Due Date | วันครบกำหนด (ThaiDatePicker — พ.ศ.) |
| Plan Hours | ชั่วโมงที่วางแผน |
| Hour Remaining | ชั่วโมงคงเหลือ |
| Tags | แท็ก (คั่นด้วย `,`) |
| รายละเอียด | Description |
| เกณฑ์การยอมรับ | Acceptance Criteria |

---

## 🔧 API Endpoints

### Projects 
| Method | Path | คำอธิบาย |
|---|---|---|
| GET | `/api/pm/projects` | รายการโปรเจกต์ทั้งหมด |
| POST | `/api/pm/projects` | สร้างโปรเจกต์ใหม่ |
| PUT | `/api/pm/projects/:id` | แก้ไขโปรเจกต์ |
| DELETE | `/api/pm/projects/:id` | ลบโปรเจกต์ (CASCADE ลบ tickets, milestones, sprints ด้วย) |

### Tickets
| Method | Path | คำอธิบาย |
|---|---|---|
| GET | `/api/pm/projects/:pid/tickets` | รายการ Ticket พร้อม computed fields (JOIN กับ users, milestones, sprints, quantity_logs) |
| POST | `/api/pm/tickets` | สร้าง Ticket ใหม่ (รวม all_device, parent_id) |
| PUT | `/api/pm/tickets/:id` | แก้ไข Ticket ทั้งหมด (empty strings → null สำหรับ date fields, validate plan_start ≤ plan_end) |
| PATCH | `/api/pm/tickets/:id` | แก้ไขบางฟิลด์ (ใช้กับ Kanban DnD, Gantt drag) |
| PATCH | `/api/pm/tickets/:id/quantity` | UPSERT บันทึกจำนวนรายวัน |
| DELETE | `/api/pm/tickets/:id` | ลบ Ticket |
| POST | `/api/pm/tickets/:id/ripple` | Dependency Ripple — เลื่อนวันที่ Ticket ที่เกี่ยวข้อง |

### GET Tickets — Computed Fields
API คืนค่าเพิ่มเติมจาก query JOIN:

| Field | สูตร |
|---|---|
| `ticket_count` | จำนวน Ticket ในโปรเจกต์ (GET /api/pm/projects) |
| `created_by_name` | ชื่อผู้สร้างโปรเจกต์ (JOIN) |
| `updated_by_name` | ชื่อผู้อัพเดทล่าสุด (JOIN) |
| `total_accumulated` | `SUM(pm_quantity_logs.quantity)` สำหรับ ticket นั้น |
| `remaining_device` | `MAX(0, all_device - total_accumulated)` |
| `calculated_progress` | `all_device > 0 ? (total_accumulated / all_device) × 100 : progress` |
| `assignee_name` | จาก `platform_users.name` (LEFT JOIN) |
| `milestone_name` | จาก `pm_milestones.name` (LEFT JOIN) |
| `sprint_name` | จาก `pm_sprints.name` (LEFT JOIN) |

### Quantity Logs
| Method | Path | คำอธิบาย |
|---|---|---|
| GET | `/api/pm/projects/:pid/quantity-logs` | รายการ Log ทั้งหมดในโปรเจกต์ |
| GET | `/api/pm/tickets/:tid/quantity-logs` | รายการ Log ของ Ticket |
| POST | `/api/pm/tickets/:tid/quantity-logs` | เพิ่ม/อัพเดท Log (UPSERT by ticket_id + log_date, quantity=0 → DELETE, validate date range) |
| DELETE | `/api/pm/quantity-logs/:id` | ลบ Log |

### Milestones
| Method | Path | คำอธิบาย |
|---|---|---|
| GET | `/api/pm/projects/:pid/milestones` | รายการ Milestone |
| POST | `/api/pm/projects/:pid/milestones` | สร้าง Milestone |
| DELETE | `/api/pm/milestones/:id` | ลบ Milestone |

### Sprints
| Method | Path | คำอธิบาย |
|---|---|---|
| GET | `/api/pm/projects/:pid/sprints` | รายการ Sprint |
| POST | `/api/pm/projects/:pid/sprints` | สร้าง Sprint |
| DELETE | `/api/pm/sprints/:id` | ลบ Sprint |

### Dependencies
| Method | Path | คำอธิบาย |
|---|---|---|
| GET | `/api/pm/projects/:pid/dependencies` | รายการ Dependency |
| POST | `/api/pm/dependencies` | สร้าง Dependency |
| DELETE | `/api/pm/dependencies/:id` | ลบ Dependency |

---

## 🔄 Project Stats (สรุปภาพรวม)

แสดง 5 การ์ดสถิติด้านบน:

| การ์ด | สูตร | สี | คำอธิบาย |
|---|---|---|---|
| **Tickets** | `tickets.length` | 🟣 #6366F1 | จำนวน Ticket ทั้งหมด + Start / In Progress |
| **All Device** | `SUM(tickets.all_device)` | 🔵 #0EA5E9 | จำนวนเครื่องทั้งหมดในโปรเจกต์ |
| **In Progress** | `SUM(quantity_logs.quantity)` | 🟡 #F59E0B | จำนวนที่ดำเนินการแล้วทั้งหมด |
| **Pending** | `All Device - In Progress` | 🟣 #8B5CF6 | จำนวนคงเหลือ |
| **Progress** | `(In Progress / All Device) × 100` | 🟢 #10B981 | ความคืบหน้าโดยรวม (หรือ AVG manual ถ้าไม่มี All Device) |

Header ยังแสดง Progress bar: `(สถานะ Total / จำนวน Ticket ทั้งหมด) × 100%`

---

## 🛠️ Tech Stack

- **Frontend**: React 19 + TypeScript + Tailwind CSS 4 + Framer Motion
- **Date Picker**: Ant Design (antd) + dayjs + buddhistEra plugin — แสดงปี พ.ศ.
- **Drag & Drop**: @dnd-kit/core (Kanban) + Mouse events (Gantt)
- **Backend**: Express 5 ESM, `server.js`
- **Database**: PostgreSQL (`opsone_db`)
- **Process Manager**: PM2

---

## 📐 State Management Flow

```
loadProjects()
  ├── GET /api/pm/projects
  └── GET /api/users
       ↓
  selProjectId (เลือกโปรเจกต์)
       ↓
loadProjectData()
  ├── GET /api/pm/projects/:pid/tickets        → tickets[]
  ├── GET /api/pm/projects/:pid/milestones     → milestones[]
  ├── GET /api/pm/projects/:pid/sprints        → sprints[]
  ├── GET /api/pm/projects/:pid/dependencies   → dependencies[]
  └── GET /api/pm/projects/:pid/quantity-logs  → quantityLogs[]
       ↓
  ┌─ Kanban View: แสดง KanbanColumn × 5 สถานะ
  └─ Gantt View: แสดง GanttChart (tree + timeline)
```

### Data Refresh
- **หลัง CRUD**: `loadProjectData()` ดึงข้อมูลใหม่ทั้งหมด
- **หลังเพิ่ม Quantity Log**: `refreshQuantityLogs()` ดึงเฉพาะ logs ใหม่
- **Kanban DnD**: Optimistic update (เปลี่ยน state ก่อน → PATCH API)
