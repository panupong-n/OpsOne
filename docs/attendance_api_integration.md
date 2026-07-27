# เอกสารสรุประบบ Attendance & การ Integration กับทีม R&D

> **วันที่จัดทำ:** 17 มีนาคม 2569  
> **จัดทำโดย:** OpsOne Platform Team  
> **วัตถุประสงค์:** ให้ทีม R&D เข้าใจการทำงานของระบบและรูปแบบ API ที่ต้องส่งมาเพื่อซิงค์ข้อมูลการลางาน

---

## 1. ภาพรวมระบบ

ระบบ OpsOne ติดตามสถานะของพนักงานในแต่ละวันผ่านตาราง `attendance_log` โดยแต่ละคนในแต่ละวันมีสถานะได้ **1 อย่างเท่านั้น**:

| สถานะ | ค่าในฐานข้อมูล | ความหมาย |
|---|---|---|
| อยู่ Office | `office` | มาทำงานที่สำนักงาน |
| ออก Site | `travel` | ออกไปทำงานนอกสถานที่ |
| ลางาน | `leave` | ลาป่วย / ลากิจ / ลาพักร้อน |
| ไม่มีข้อมูล | *(ไม่มี record)* | ถือว่าอยู่ Office โดยปริยาย |

> **หมายเหตุ:** `(employee_id, date)` เป็น Unique Constraint — 1 คน ต่อ 1 วัน มีได้แค่ 1 record เท่านั้น หากส่งซ้ำวันเดิมจะ **overwrite** ค่าเดิมทันที (UPSERT)

---

## 2. โครงสร้างตาราง `attendance_log`

```sql
CREATE TABLE attendance_log (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    employee_id TEXT NOT NULL,          -- OAuth sub claim ของพนักงาน
    date        DATE NOT NULL,          -- วันที่ (YYYY-MM-DD)
    status      TEXT NOT NULL           -- 'office' | 'travel' | 'leave'
                CHECK (status IN ('office','travel','leave')),
    check_in    TIME,                   -- เวลาเข้างาน (optional)
    check_out   TIME,                   -- เวลาออกงาน (optional)
    note        TEXT,                   -- หมายเหตุ เช่น "ลาป่วย", "ลากิจ"
    location    TEXT,                   -- สถานที่ (optional)
    product     TEXT,                   -- ชื่อสินค้า/โปรเจกต์ที่เกี่ยวข้อง (optional)
    customer    TEXT,                   -- ชื่อลูกค้า (optional)
    created_at  TIMESTAMPTZ DEFAULT now(),
    UNIQUE (employee_id, date)
);
```

---

## 3. Flow การทำงานปัจจุบัน

```
การกระทำของ User                          ผลต่อ Database
──────────────────────────────────────────────────────────────────────
1. กด "Assign Task Visit" (ออก Site)   → INSERT task_visits
                                        → AUTO-SYNC: attendance_log.status = 'travel'

2. กด "ลา" (Manual ในหน้า Attendance)  → POST /api/attendance
                                        → INSERT/UPDATE attendance_log (status='leave')

3. ลบ task_visit                        → DELETE task_visits
                                        → ถ้าไม่มี visit เหลือในวันนั้น
                                          → ลบ attendance_log record ออก
                                          → (ไม่ได้กลับเป็น 'office' อัตโนมัติ)

4. ไม่มี record ใน attendance_log      → ระบบแสดงสถานะ "Office" โดย default
```

---

## 4. API ที่มีในระบบปัจจุบัน (สำหรับอ้างอิง)

### 4.1 GET — ดึงข้อมูล Attendance

```http
GET /api/attendance?year=2026&month=3
GET /api/attendance?employee_id=<sub>&date=2026-03-17
GET /api/attendance/daily?date=2026-03-17
```

Response ของ `/daily` จะ join ข้อมูล user ทั้งหมดและแสดงใน Daily Preview Page:
```json
[
  {
    "id": "sub-xxxxxxxx",
    "name": "สมชาย ใจดี",
    "email": "somchai@example.com",
    "attendance": {
      "status": "leave",
      "note": "ลาป่วย",
      "date": "2026-03-17"
    },
    "task_visits": []
  }
]
```

### 4.2 POST — บันทึก / อัพเดท Attendance (UPSERT)

```http
POST /api/attendance
Content-Type: application/json
```

### 4.3 DELETE — ยกเลิก record

```http
DELETE /api/attendance?employee_id=<sub>&date=2026-03-17
```

---

## 5. สิ่งที่ทีม R&D ต้องส่งมา

### 5.1 เมื่อมีพนักงานอนุมัติการลา

ส่ง **1 request ต่อ 1 วัน ต่อ 1 คน** มายัง:

```http
POST https://opsone.tenfw.com/api/attendance
Content-Type: application/json
```

**Request Body:**
```json
{
  "employee_id": "sub-xxxxxxxxxxxxxxxxxxxxxxxx",
  "date": "2026-03-18",
  "status": "leave",
  "note": "ลาป่วย"
}
```

| Field | ชนิด | Required | ค่าที่รับได้ | หมายเหตุ |
|---|---|---|---|---|
| `employee_id` | string | ✅ | OAuth `sub` claim | ดูจาก GET /api/users |
| `date` | string | ✅ | `YYYY-MM-DD` | วันที่ลา |
| `status` | string | ✅ | `"leave"` | ต้องเป็น `leave` เสมอสำหรับการลา |
| `note` | string | ☑️ Optional | ข้อความอิสระ | เช่น "ลาป่วย", "ลากิจ", "ลาพักร้อน" |

**ตัวอย่าง Response สำเร็จ (HTTP 201):**
```json
{
  "id": "a1b2c3d4-...",
  "employee_id": "sub-xxxxxxxx",
  "date": "2026-03-18",
  "status": "leave",
  "note": "ลาป่วย",
  "created_at": "2026-03-17T10:30:00.000Z"
}
```

---

### 5.2 เมื่อมีการยกเลิกการลา (Reject / Cancel)

```http
DELETE https://opsone.tenfw.com/api/attendance?employee_id=sub-xxxxxxxx&date=2026-03-18
```

**Response สำเร็จ: HTTP 204 (No Content)**

---

### 5.3 กรณีลาหลายวันติดต่อกัน

ต้องส่งทีละวัน (1 request ต่อ 1 วัน):

```json
// วันที่ 1
{ "employee_id": "sub-xxx", "date": "2026-03-18", "status": "leave", "note": "ลาพักร้อน" }

// วันที่ 2
{ "employee_id": "sub-xxx", "date": "2026-03-19", "status": "leave", "note": "ลาพักร้อน" }

// วันที่ 3
{ "employee_id": "sub-xxx", "date": "2026-03-20", "status": "leave", "note": "ลาพักร้อน" }
```

---

## 6. วิธีหา employee_id

`employee_id` คือ **OAuth `sub` claim** ของแต่ละ user ดึงได้จาก:

```http
GET https://opsone.tenfw.com/api/users
```

Response:
```json
[
  {
    "sub": "sub-xxxxxxxxxxxxxxxxxxxxxxxx",   ← ← นี่คือ employee_id ที่ต้องใช้
    "email": "somchai@example.com",
    "name": "สมชาย ใจดี",
    "role": "engineer"
  }
]
```

---

## 7. พฤติกรรมของระบบเมื่อได้รับข้อมูล

| สถานการณ์ | ผลลัพธ์ |
|---|---|
| ส่ง `leave` มา ไม่มี record เดิม | สร้าง record ใหม่ → หน้า Daily Preview แสดง "ลา" ทันที |
| ส่ง `leave` มา แต่ record เดิมเป็น `office` | Overwrite → เปลี่ยนเป็น "ลา" ทันที |
| ส่ง `leave` มา แต่ record เดิมเป็น `travel` | Overwrite → เปลี่ยนเป็น "ลา" (travel ถูก override) |
| DELETE record | ลบออก → กลับเป็น "Office" โดย default |
| ส่งซ้ำวันเดิม | Overwrite ค่าใหม่ ไม่ error |

---

## 8. สิ่งที่ยังไม่มีในระบบ (แจ้งให้ R&D ทราบ)

| รายการ | สถานะ | หมายเหตุ |
|---|---|---|
| `leave_type` field (ลาป่วย/ลากิจ/ลาพักร้อน) | ❌ ยังไม่มี | ตอนนี้ใส่ใน `note` แทน |
| Authentication บน API | ❌ ยังไม่มี | endpoint ออกแบบมาสำหรับ internal เท่านั้น หากเรียกจากภายนอกต้องเพิ่ม API Key |
| Webhook แจ้งเตือนกลับ | ❌ ยังไม่มี | ระบบยังไม่มีการแจ้งเตือนกลับไปยัง R&D |

> ⚠️ **สำคัญ:** หาก R&D ต้องการเรียก API จากระบบลาภายนอกโดยตรง กรุณาแจ้งทีม OpsOne เพื่อเพิ่ม API Key authentication ก่อนเปิดใช้งาน Production

---

## 9. สรุป Checklist สำหรับทีม R&D

- [ ] ได้รับ `sub` ของพนักงานทุกคน (จาก GET /api/users)
- [ ] เมื่ออนุมัติการลา → POST /api/attendance พร้อม `status: "leave"`
- [ ] เมื่อยกเลิก/ปฏิเสธการลา → DELETE /api/attendance
- [ ] ลาหลายวัน → loop ส่งทีละวัน
- [ ] ระบบ OpsOne จะ refresh ข้อมูลอัตโนมัติทุก 30 วินาที ไม่ต้องทำอะไรเพิ่ม

---

*เอกสารนี้จัดทำเพื่อประกอบการ Integration ระหว่างระบบ HR Leave ของทีม R&D และ OpsOne Platform*
