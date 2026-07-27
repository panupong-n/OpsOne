# HR Raw Data Intake — Integration Guide

**Base URL:** `https://opsone.tenfw.com`

---

## แนวคิด

HR ส่งข้อมูลมาในรูปแบบใดก็ได้ → ระบบเก็บเป็น raw payload ใน `hr_raw_intake` ก่อน → Admin มาดู/ประมวลผลทีหลัง

```
HR System  ──POST──▶  /api/hr/intake  ──▶  hr_raw_intake (DB)
                                                  │
                                         Admin ดูและ process
```

---

## Endpoints

### 1. ส่งข้อมูลเข้า

```
POST https://opsone.tenfw.com/api/hr/intake
Content-Type: application/json
```

รับ JSON **รูปแบบใดก็ได้** ไม่มี schema บังคับ

**ตัวอย่าง — ส่งรายการลาพนักงาน:**

```json
{
  "employeeId": "EMP-001",
  "name": "Anirut Naknakorn",
  "type": "leave",
  "leaveType": "ลาป่วย",
  "startDate": "2026-04-28",
  "endDate": "2026-04-29",
  "days": 2,
  "reason": "ไข้หวัด",
  "approvedBy": "Manager Name"
}
```

**ตัวอย่าง — ส่งเป็น batch:**

```json
{
  "batch": [
    { "name": "Anirut Naknakorn", "leaveType": "ลาป่วย", "date": "2026-04-28" },
    { "name": "Boosarin Wanmuang", "leaveType": "ลากิจ", "date": "2026-04-28" }
  ],
  "sentAt": "2026-04-27T10:00:00Z",
  "system": "SAP-HR"
}
```

**Query param (optional):**

| Param | Default | คำอธิบาย |
|---|---|---|
| `source` | `hr_system` | ชื่อระบบต้นทาง เช่น `?source=sap` |

**Response 201:**

```json
{ "ok": true, "id": 1, "received_at": "2026-04-27T10:00:00.000Z" }
```

**Error responses:**

| Status | คำอธิบาย |
|---|---|
| `400` | Body ว่าง |
| `500` | Database error |

---

### 2. ดูข้อมูลที่รับเข้ามา

```
GET https://opsone.tenfw.com/api/hr/intake
```

**Query params:**

| Param | Default | คำอธิบาย |
|---|---|---|
| `status` | (ทั้งหมด) | `pending` / `processed` / `skipped` / `error` |
| `limit` | `100` | จำนวนแถวสูงสุด |
| `offset` | `0` | สำหรับ pagination |

**ตัวอย่าง:**

```
GET /api/hr/intake?status=pending
GET /api/hr/intake?status=processed&limit=50&offset=0
```

**Response:**

```json
{
  "total": 12,
  "rows": [
    {
      "id": 1,
      "source": "hr_system",
      "payload": { "...ข้อมูลดิบ..." },
      "status": "pending",
      "note": null,
      "processed_at": null,
      "created_at": "2026-04-27T10:00:00.000Z"
    }
  ]
}
```

---

### 3. Mark ว่าประมวลผลแล้ว

```
PATCH https://opsone.tenfw.com/api/hr/intake/:id
Content-Type: application/json
```

```json
{ "status": "processed", "note": "บันทึกลงระบบเรียบร้อย" }
```

| Status | ความหมาย |
|---|---|
| `pending` | รอดำเนินการ (default) |
| `processed` | ประมวลผลแล้ว |
| `skipped` | ข้ามไม่ประมวลผล |
| `error` | เกิดข้อผิดพลาด |

**Response:**

```json
{ "ok": true, "record": { ...updated record... } }
```

---

### 4. ลบ record

```
DELETE https://opsone.tenfw.com/api/hr/intake/:id
```

**Response 200:**

```json
{ "ok": true }
```

---

## โครงสร้าง Table `hr_raw_intake`

| Column | Type | คำอธิบาย |
|---|---|---|
| `id` | BIGSERIAL | Auto-increment ID |
| `source` | TEXT | ชื่อระบบต้นทาง (เช่น `hr_system`, `sap`) |
| `payload` | JSONB | ข้อมูลดิบทั้งหมดที่รับมา |
| `status` | TEXT | `pending` / `processed` / `skipped` / `error` |
| `note` | TEXT | บันทึกเพิ่มเติมจาก Admin |
| `processed_at` | TIMESTAMPTZ | เวลาที่ mark เป็น `processed` |
| `created_at` | TIMESTAMPTZ | เวลาที่รับข้อมูลเข้าระบบ |

---

## ตัวอย่าง cURL

```bash
# ส่งข้อมูลลา
curl -X POST https://opsone.tenfw.com/api/hr/intake \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Anirut Naknakorn",
    "leaveType": "ลาป่วย",
    "startDate": "2026-04-28",
    "endDate": "2026-04-28",
    "days": 1
  }'

# ดูรายการ pending
curl https://opsone.tenfw.com/api/hr/intake?status=pending

# Mark ว่าประมวลผลแล้ว
curl -X PATCH https://opsone.tenfw.com/api/hr/intake/1 \
  -H "Content-Type: application/json" \
  -d '{ "status": "processed", "note": "บันทึกลงระบบเรียบร้อย" }'
```

---

## ขั้นตอนต่อไป

เมื่อทดสอบรับข้อมูลได้แล้ว และทราบรูปแบบ payload จริงจาก HR จะเพิ่ม logic:

1. Auto-map `payload` → `attendance_log` (status = `leave`)
2. Webhook notification เมื่อรับข้อมูลใหม่
3. หน้า Admin UI ดู / approve raw records ในระบบ
