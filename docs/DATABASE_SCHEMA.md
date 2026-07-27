# Database Schema — ISO Survey Platform

**Database:** PostgreSQL 16  
**ORM:** Prisma 5  
**Database name:** `isosurveydb`

---

## Enums

| Enum | ค่าที่รองรับ |
|------|-------------|
| `Role` | `ADMIN`, `USER`, `VIEWER` |
| `SurveyStatus` | `DRAFT`, `PUBLISHED`, `ARCHIVED` |
| `QuestionType` | `RATING`, `TEXT`, `SINGLE_CHOICE`, `MULTI_CHOICE` |
| `AssignmentStatus` | `PENDING`, `SENT`, `OPENED`, `COMPLETED`, `EXPIRED` |
| `EmailStatus` | `QUEUED`, `SENT`, `FAILED` |

---

## Tables

### User

ข้อมูลผู้ใช้งานระบบ (ทั้ง local login และ SSO)

| Column | Type | Nullable | Default | หมายเหตุ |
|--------|------|----------|---------|----------|
| `id` | `TEXT` | No | `uuid()` | Primary Key |
| `email` | `TEXT` | No | — | Unique |
| `password` | `TEXT` | No | — | Bcrypt hashed |
| `firstName` | `TEXT` | No | — | |
| `lastName` | `TEXT` | No | — | |
| `phone` | `TEXT` | **Yes** | — | |
| `employeeId` | `TEXT` | No | — | Unique |
| `department` | `TEXT` | **Yes** | — | |
| `role` | `Role` | No | `USER` | |
| `isActive` | `BOOLEAN` | No | `true` | |
| `lastLoginAt` | `TIMESTAMP` | **Yes** | — | |
| `ssoId` | `TEXT` | **Yes** | — | Unique, TENCYBER subject UUID |
| `ssoProvider` | `TEXT` | **Yes** | — | เช่น `"tencyber"` |
| `createdAt` | `TIMESTAMP` | No | `now()` | |
| `updatedAt` | `TIMESTAMP` | No | — | Auto-updated |

**Relations:**  
→ มี Survey หลายรายการ (สร้างโดย)  
→ มี SurveyAssignment หลายรายการ  
→ มี Document หลายรายการ  
→ มี RefreshToken หลายรายการ  
→ มี AuditLog หลายรายการ  

---

### Survey

แบบสอบถาม

| Column | Type | Nullable | Default | หมายเหตุ |
|--------|------|----------|---------|----------|
| `id` | `TEXT` | No | `uuid()` | Primary Key |
| `title` | `TEXT` | No | — | |
| `description` | `TEXT` | **Yes** | — | |
| `version` | `INT` | No | `1` | |
| `status` | `SurveyStatus` | No | `DRAFT` | |
| `createdById` | `TEXT` | No | — | FK → User.id |
| `createdAt` | `TIMESTAMP` | No | `now()` | |
| `updatedAt` | `TIMESTAMP` | No | — | Auto-updated |

**Relations:**  
→ createdBy: User  
→ มี Question หลายรายการ  
→ มี SurveyAssignment หลายรายการ  
→ มี Document หลายรายการ  

---

### Question

คำถามในแบบสอบถาม

| Column | Type | Nullable | Default | หมายเหตุ |
|--------|------|----------|---------|----------|
| `id` | `TEXT` | No | `uuid()` | Primary Key |
| `surveyId` | `TEXT` | No | — | FK → Survey.id (Cascade Delete) |
| `text` | `TEXT` | No | — | ข้อความคำถาม |
| `type` | `QuestionType` | No | — | ประเภทคำถาม |
| `options` | `JSON` | **Yes** | — | ตัวเลือก (สำหรับ SINGLE/MULTI_CHOICE) |
| `order` | `INT` | No | — | ลำดับคำถาม |
| `required` | `BOOLEAN` | No | `true` | |
| `createdAt` | `TIMESTAMP` | No | `now()` | |

**Relations:**  
→ survey: Survey  
→ มี Response หลายรายการ  

---

### SurveyAssignment

การมอบหมายแบบสอบถามให้ผู้ใช้

| Column | Type | Nullable | Default | หมายเหตุ |
|--------|------|----------|---------|----------|
| `id` | `TEXT` | No | `uuid()` | Primary Key |
| `surveyId` | `TEXT` | No | — | FK → Survey.id |
| `userId` | `TEXT` | No | — | FK → User.id |
| `token` | `TEXT` | No | `uuid()` | Unique, ใช้เปิดแบบสอบถาม |
| `tokenExpiresAt` | `TIMESTAMP` | No | — | วันหมดอายุ token |
| `status` | `AssignmentStatus` | No | `PENDING` | |
| `assignedAt` | `TIMESTAMP` | No | `now()` | |
| `sentAt` | `TIMESTAMP` | **Yes** | — | วันที่ส่ง email |
| `openedAt` | `TIMESTAMP` | **Yes** | — | วันที่เปิดอ่าน |
| `completedAt` | `TIMESTAMP` | **Yes** | — | วันที่ตอบครบ |

**Relations:**  
→ survey: Survey  
→ user: User  
→ มี Response หลายรายการ  
→ มี EmailLog หลายรายการ  

---

### Response

คำตอบของผู้ใช้

| Column | Type | Nullable | Default | หมายเหตุ |
|--------|------|----------|---------|----------|
| `id` | `TEXT` | No | `uuid()` | Primary Key |
| `assignmentId` | `TEXT` | No | — | FK → SurveyAssignment.id |
| `questionId` | `TEXT` | No | — | FK → Question.id |
| `answer` | `JSON` | No | — | คำตอบ (รองรับทุกประเภทคำถาม) |
| `createdAt` | `TIMESTAMP` | No | `now()` | |

**Unique constraint:** `(assignmentId, questionId)` — ตอบได้ 1 ครั้งต่อคำถาม  

---

### Document

ไฟล์แนบ/เอกสาร

| Column | Type | Nullable | Default | หมายเหตุ |
|--------|------|----------|---------|----------|
| `id` | `TEXT` | No | `uuid()` | Primary Key |
| `name` | `TEXT` | No | — | ชื่อไฟล์ที่ใช้ระบบ |
| `originalName` | `TEXT` | No | — | ชื่อไฟล์ต้นฉบับ |
| `path` | `TEXT` | No | — | path บน server |
| `mimeType` | `TEXT` | No | — | เช่น `application/pdf` |
| `size` | `INT` | No | — | ขนาดไฟล์ (bytes) |
| `category` | `TEXT` | **Yes** | — | หมวดหมู่ |
| `surveyId` | `TEXT` | **Yes** | — | FK → Survey.id |
| `uploadedById` | `TEXT` | No | — | FK → User.id |
| `isDeleted` | `BOOLEAN` | No | `false` | Soft delete |
| `createdAt` | `TIMESTAMP` | No | `now()` | |
| `updatedAt` | `TIMESTAMP` | No | — | Auto-updated |

---

### EmailLog

บันทึกการส่ง email

| Column | Type | Nullable | Default | หมายเหตุ |
|--------|------|----------|---------|----------|
| `id` | `TEXT` | No | `uuid()` | Primary Key |
| `to` | `TEXT` | No | — | อีเมลผู้รับ |
| `subject` | `TEXT` | No | — | หัวข้อ email |
| `status` | `EmailStatus` | No | `QUEUED` | |
| `assignmentId` | `TEXT` | **Yes** | — | FK → SurveyAssignment.id |
| `errorMessage` | `TEXT` | **Yes** | — | ข้อความ error (กรณีส่งไม่สำเร็จ) |
| `sentAt` | `TIMESTAMP` | **Yes** | — | |
| `createdAt` | `TIMESTAMP` | No | `now()` | |

---

### AuditLog

บันทึก activity ทุก action ในระบบ

| Column | Type | Nullable | Default | หมายเหตุ |
|--------|------|----------|---------|----------|
| `id` | `TEXT` | No | `uuid()` | Primary Key |
| `userId` | `TEXT` | **Yes** | — | FK → User.id (SET NULL ถ้าลบ user) |
| `action` | `TEXT` | No | — | เช่น `LOGIN`, `CREATE_SURVEY` |
| `entity` | `TEXT` | No | — | เช่น `User`, `Survey` |
| `entityId` | `TEXT` | **Yes** | — | ID ของ entity ที่ถูก action |
| `metadata` | `JSON` | **Yes** | — | ข้อมูลเพิ่มเติม |
| `ipAddress` | `TEXT` | **Yes** | — | IP ผู้ใช้ |
| `userAgent` | `TEXT` | **Yes** | — | Browser/User-Agent |
| `createdAt` | `TIMESTAMP` | No | `now()` | |

---

### RefreshToken

JWT Refresh Token

| Column | Type | Nullable | Default | หมายเหตุ |
|--------|------|----------|---------|----------|
| `id` | `TEXT` | No | `uuid()` | Primary Key |
| `userId` | `TEXT` | No | — | FK → User.id (Cascade Delete) |
| `token` | `TEXT` | No | — | Unique |
| `expiresAt` | `TIMESTAMP` | No | — | |
| `createdAt` | `TIMESTAMP` | No | `now()` | |

---

## Entity Relationship Diagram

```
User ─────────────────────────────────────────────────────────────────
  │                          │                    │              │
  │ (createdById)            │ (userId)            │ (uploadedById)│ (userId)
  ▼                          ▼                     ▼              ▼
Survey ──────────── SurveyAssignment           Document      AuditLog
  │  (surveyId)        │  (assignmentId)
  │                    │
  ▼                    ▼
Question ──────── Response
  (questionId)
                    │ (assignmentId)
                    ▼
                EmailLog
```

---

## สถานะข้อมูลปัจจุบัน (May 7, 2026)

| ตาราง | จำนวน record |
|-------|-------------|
| User | 2 |
| Survey | 1 (PUBLISHED) |
| Question | 17 |
| SurveyAssignment | 0 |
| Response | 0 |
| Document | 0 |
| EmailLog | 0 |
| AuditLog | 21 |
| RefreshToken | — |

---

## ข้อมูลจริงในฐานข้อมูล

### User Records

| id | email | firstName | lastName | employeeId | department | role | isActive | lastLoginAt |
|----|-------|-----------|----------|-----------|-----------|------|----------|-------------|
| `c228d029-...` | `admin` | ผู้ดูแล | ระบบ | ADMIN-001 | Information Technology | ADMIN | true | 2026-05-07 01:58 |
| `7b69d39d-...` | `panupong.n@tenforward.co.th` | ภานุพงศ์ | นิจบุญ | TEN-040 | Technical Operation Division | ADMIN | true | — |

> **หมายเหตุ:** ทั้ง 2 user ยังไม่มี `ssoId` / `ssoProvider` (SSO login ยังไม่ได้ใช้งาน)

---

### Survey Record

| field | value |
|-------|-------|
| id | `e97df7f2-4380-46b4-ab6b-ffffacb131a3` |
| title | แบบสอบถามความพึงพอใจการใช้งานระบบสารสนเทศภายในบริษัท |
| status | `PUBLISHED` |
| version | 1 |
| createdById | `c228d029-...` (admin) |
| createdAt | 2026-05-07 03:38 |

---

## โครงสร้างฟอร์มประเมิน (Survey Form Structure)

**ชื่อ:** แบบสอบถามความพึงพอใจการใช้งานระบบสารสนเทศภายในบริษัท  
**คำอธิบาย:** IT Internal Service Satisfaction Survey  
**มาตรวัดคะแนน:** 1=น้อยที่สุด, 2=น้อย, 3=ปานกลาง, 4=มาก, 5=มากที่สุด  

---

### ส่วนที่ 1: ข้อมูลทั่วไปของผู้ตอบแบบสอบถาม (ข้อ 1–2)

| ข้อ | คำถาม | ประเภท | ตัวเลือก | บังคับ |
|-----|-------|--------|---------|--------|
| 1 | ฝ่าย/แผนก | TEXT | — | ✅ |
| 2 | ความถี่ในการใช้งานระบบ | SINGLE_CHOICE | ทุกวัน / รายสัปดาห์ / รายเดือน / นานๆ ครั้ง | ✅ |

---

### ส่วนที่ 2: ด้านคุณภาพและประสิทธิภาพของระบบ (ข้อ 3–7)

| ข้อ | คำถาม | ประเภท | บังคับ |
|-----|-------|--------|--------|
| 3 | ระบบมีความถูกต้อง ครบถ้วนของข้อมูล | RATING (1–5) | ✅ |
| 4 | ระบบมีความเสถียร ไม่ล่มบ่อย | RATING (1–5) | ✅ |
| 5 | ระบบมีความรวดเร็วในการประมวลผล | RATING (1–5) | ✅ |
| 6 | ข้อมูลเป็นปัจจุบันและทันสมัย | RATING (1–5) | ✅ |
| 7 | ระบบมีความปลอดภัยของข้อมูล | RATING (1–5) | ✅ |

---

### ส่วนที่ 2 (ต่อ): ด้านการใช้งาน — Usability (ข้อ 8–10)

| ข้อ | คำถาม | ประเภท | บังคับ |
|-----|-------|--------|--------|
| 8 | ระบบใช้งานง่าย ไม่ซับซ้อน | RATING (1–5) | ✅ |
| 9 | หน้าจอใช้งานสวยงาม ชัดเจน (User Interface) | RATING (1–5) | ✅ |
| 10 | ระบบช่วยเพิ่มประสิทธิภาพในการทำงาน | RATING (1–5) | ✅ |

---

### ส่วนที่ 2 (ต่อ): ด้านการให้บริการของเจ้าหน้าที่ IT — Helpdesk (ข้อ 11–13)

| ข้อ | คำถาม | ประเภท | บังคับ |
|-----|-------|--------|--------|
| 11 | เจ้าหน้าที่แก้ไขปัญหาได้อย่างรวดเร็ว | RATING (1–5) | ✅ |
| 12 | เจ้าหน้าที่ให้คำแนะนำได้อย่างชัดเจนและสุภาพ | RATING (1–5) | ✅ |
| 13 | เจ้าหน้าที่สามารถแก้ปัญหาได้จบในครั้งเดียว | RATING (1–5) | ✅ |

---

### ความพึงพอใจโดยรวม (ข้อ 14)

| ข้อ | คำถาม | ประเภท | บังคับ |
|-----|-------|--------|--------|
| 14 | ความพึงพอใจในภาพรวมต่อบริการ IT | RATING (1–5) | ✅ |

---

### ส่วนที่ 3: ความคิดเห็นและข้อเสนอแนะเพิ่มเติม (ข้อ 15–17)

| ข้อ | คำถาม | ประเภท | บังคับ |
|-----|-------|--------|--------|
| 15 | ปัญหาที่พบมากที่สุดในการใช้ระบบคืออะไร? | TEXT | ❌ |
| 16 | สิ่งที่ต้องการให้ปรับปรุงหรือพัฒนาเพิ่มเติม (เช่น ฟังก์ชันใหม่, ความเร็ว) | TEXT | ❌ |
| 17 | ข้อเสนอแนะอื่นๆ | TEXT | ❌ |

---

### สรุปโครงสร้างฟอร์ม

| ประเภทคำถาม | จำนวน | หมายเหตุ |
|------------|-------|---------|
| RATING | 12 ข้อ | คะแนน 1–5 |
| TEXT | 4 ข้อ | กรอกข้อความอิสระ |
| SINGLE_CHOICE | 1 ข้อ | เลือก 1 ตัวเลือก |
| **รวม** | **17 ข้อ** | |

| ประเภท | จำนวน |
|--------|-------|
| บังคับตอบ | 14 ข้อ |
| ไม่บังคับ | 3 ข้อ (ข้อ 15–17) |

---

## การ Seed ข้อมูลเริ่มต้น

เมื่อ deploy ระบบใหม่ รันคำสั่งต่อไปนี้เพื่อสร้างข้อมูลเริ่มต้น:

```bash
# เข้า container backend
docker exec -it iso_backend sh

# รัน seed
npx prisma db seed
```

**ผลลัพธ์:** สร้าง admin user (`admin` / `admin123`) + แบบสอบถาม 17 ข้อ (PUBLISHED)

> **⚠️ คำเตือน:** seed จะ **ลบแบบสอบถามทั้งหมด** ก่อนสร้างใหม่ทุกครั้ง แต่ไม่ลบ user
