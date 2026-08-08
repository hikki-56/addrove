# คู่มือและรายการตรวจสอบการ Deploy และ Rollback สำหรับ Vercel Production (Stockify)

เอกสารนี้รวบรวมข้อกำหนด ขั้นตอนการตั้งค่า Environment Variables การตรวจสอบ Google Sheets / Apps Script และขั้นตอนการ Rollback เมื่อเกิดเหตุฉุกเฉิน

---

## 1. รายการตรวจสอบก่อน Deploy (Pre-deployment Checklist)

1. **Validation & Verification Scripts**:
   - รัน `npm run verify` (ทำงานตามลำดับ: `lint` -> `typecheck` -> `test` -> `build`) ทุกขั้นตอนต้องผ่าน 100%
   - รัน `npm audit --omit=dev --audit-level=high` ตรวจสอบว่าไม่มีช่องโหว่ระดับ High หรือ Critical
2. **Secrets & Security**:
   - ตรวจสอบว่าไม่มี Secret จริงหรือ Private Key อยู่ในซอร์สโค้ด หรือ Git history
   - ตรวจสอบ `.vercelignore` เพื่อป้องกันไม่ให้ไฟล์ `.env*`, `data/*.json`, `__tests__`, หรือ temporary files หลุดขึ้น production bundle
   - ตรวจสอบว่าไม่มี Server Secret หลุดผ่านตัวแปร `NEXT_PUBLIC_*`
3. **Node Engine**:
   - ตรวจสอบ Node version ใน `package.json` เป็น `>=20.9.0` ตามมาตรฐาน Next.js 16

---

## 2. การตั้งค่า Environment Variables บน Vercel

เข้าสู่ **Vercel Project Dashboard** -> **Settings** -> **Environment Variables** และกำหนดตัวแปรต่อไปนี้สำหรับ Environment **Production**:

| Variable Name | Required | Description | Example / Rule |
| :--- | :--- | :--- | :--- |
| `AUTH_SECRET` | **Yes** | รหัสสุ่มสำหรับเข้ารหัส Session Token | สุ่มความยาว $\ge 32$ ตัวอักษร เช่น `openssl rand -base64 32` |
| `QR_TOKEN_SECRET` | **Yes** | รหัสสุ่มเฉพาะสำหรับ QR Code Token (ห้ามซ้ำกับ AUTH_SECRET) | สุ่มความยาว $\ge 32$ ตัวอักษร |
| `NEXT_PUBLIC_APP_URL` | **Yes** | Production Domain ของระบบบน Vercel (HTTPS เท่านั้น) | `https://stockify.example.com` (ห้ามเป็น localhost) |
| `GOOGLE_SHEET_ID` | **Yes** | ID ของ Google Spreadsheet สต็อกหลัก | ตัวอย่าง: `1tsndbJWnXPvY3_...` |
| `GOOGLE_SERVICE_ACCOUNT_EMAIL` | Optional* | Email ของ Service Account สำหรับเขียน Google Sheets | `stockify-bot@project.iam.gserviceaccount.com` |
| `GOOGLE_PRIVATE_KEY` | Optional* | Private Key ของ Service Account | `"-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"` |
| `GOOGLE_SCRIPT_URL` | Optional* | Webhook URL ของ Google Apps Script ที่มี LockService | `https://script.google.com/macros/s/.../exec` |
| `GOOGLE_API_KEY` | Optional | Google API Key สำหรับอ่านข้อมูลแบบ Fast Cache | `AIzaSy...` |

*\*หมายเหตุ: ต้องมี Service Account Credentials (`GOOGLE_SERVICE_ACCOUNT_EMAIL` + `GOOGLE_PRIVATE_KEY`) หรือ `GOOGLE_SCRIPT_URL` อย่างน้อยหนึ่งชุดเพื่อใช้ในการบันทึกข้อมูล (Write)*

---

## 3. การตรวจสอบ Google Sheets Tabs, Permissions และ Apps Script

### 3.1 รายการ Sheet Tabs ที่ต้องมีใน Spreadsheet:
1. `Warehouses` — โกดังสินค้า
2. `Locations` — ตำแหน่งจัดเก็บ
3. `Shelves` — ชั้นวาง
4. `PRODUCTS` — ข้อมูลสินค้าหลัก
5. `Documents` — เอกสารการเคลื่อนไหวสต็อก
6. `StockMovements` — รายการเคลื่อนไหวรายชิ้น/ตำแหน่ง
7. `StockSummary` — ยอดสรุปคงเหลือ
8. `StockCounts` — รายการตรวจนับสต็อก
9. `Users` — ผู้ใช้งานระบบ
10. `ประวัติการเข้าระบบ` (`LoginLogs`) — ประวัติการเข้าสู่ระบบ
11. `Idempotency` — บันทึก Idempotency Keys ป้องกันการทำรายการซ้ำ
12. `AuditLogs` — บันทึก Audit Trail สำหรับความปลอดภัย
13. `OperationJournal` — บันทึก Recovery Journal และขั้นตอนชดเชยข้อมูล

### 3.2 การติดตั้งและ Deploy Google Apps Script:
1. เปิด Google Spreadsheet แล้วไปที่เมนู **Extensions** -> **Apps Script**
2. นำโค้ดจากไฟล์ `scripts/google-apps-script.gs` ในโปรเจกต์ไปวางใน `Code.gs`
3. บันทึกและคลิก **Deploy** -> **New deployment**
4. เลือกประเภท: **Web app**
   - **Execute as**: `Me` (บัญชีเจ้าของ Sheet)
   - **Who has access**: `Anyone`
5. นำ URL ที่ได้มาใส่ในตัวแปร `GOOGLE_SCRIPT_URL` บน Vercel

---

## 4. การตรวจสอบ Smoke Check / Health Check หลัง Deploy

1. **System Health Check (Read-Only)**:
   - เรียกดู `GET https://your-production-domain.com/api/system/health`
   - ตรวจสอบว่าสถานะตอบกลับเป็น `200 OK` พร้อม `status: "HEALTHY"` และ `storage.status: "CONNECTED"`
2. **Login Pages Smoke Test**:
   - เปิดหน้า `/` และ `/login` และ `/employee-login` เพื่อตรวจความพร้อมของ UI
3. **Audit Log Verification**:
   - ตรวจสอบว่าไม่มี Error log ใน Vercel Function Logs

---

## 5. แผนการย้อนกลับเมื่อเกิดเหตุฉุกเฉิน (Rollback Procedure)

หากพบข้อผิดพลาดร้ายแรงบน Production ให้ดำเนินการดังนี้:

1. **Instant Vercel Rollback**:
   - เข้าสู่ Vercel Dashboard -> **Deployments**
   - ค้นหา Deployment ล่าสุดที่ทำงานปกติก่อนหน้า
   - คลิกเมนู `...` -> **Promote to Production** หรือ **Rollback to this Deployment**
   - Vercel จะสลับ Traffic ไปยัง Deployment ที่เสถียรทันทีภายในไม่กี่วินาที
2. **Data Consistency Check**:
   - ตรวจสอบ Sheet `Documents`, `StockMovements`, `Idempotency`, `OperationJournal`
   - หากมี Transaction ค้างในสถานะ `IN_PROGRESS` หรือ `COMPENSATING` ให้ Admin ตรวจสอบ Operation Journal
