# คู่มือ Deploy, Approval และ Rollback สำหรับ Stockify บน Vercel

เอกสารนี้เป็น release gate สำหรับทั้ง Preview และ Production ระบบจะพร้อม promote เมื่อทุกข้อที่ระบุว่า “ต้องผ่าน” มีหลักฐานตรวจสอบได้ และผู้อนุมัติที่เกี่ยวข้องยืนยันแล้วเท่านั้น

## 1. หลักการแยก Environment

Preview และ Production ต้องแยกทรัพยากรต่อไปนี้ออกจากกันโดยเด็ดขาด:

| ทรัพยากร | Preview | Production |
| --- | --- | --- |
| Vercel environment scope | Preview เท่านั้น | Production เท่านั้น |
| Domain | Preview domain แบบ HTTPS ที่คงที่ | Canonical production domain แบบ HTTPS |
| Google Spreadsheet | ชีตทดสอบ ไม่มีข้อมูลลูกค้าจริง | ชีตใช้งานจริง |
| Apps Script deployment | ผูกกับ Preview spreadsheet | ผูกกับ Production spreadsheet |
| Service account | บัญชี/สิทธิ์สำหรับ Preview | บัญชี/สิทธิ์สำหรับ Production |
| Secrets | สุ่มใหม่สำหรับ Preview | สุ่มใหม่สำหรับ Production |

- ห้ามให้ Preview อ่านหรือเขียน Production spreadsheet
- ห้ามคัดลอกข้อมูลส่วนบุคคลจาก Production ไป Preview หากยังไม่ได้ทำ anonymization
- ห้ามใช้ `AUTH_SECRET`, `QR_TOKEN_SECRET` หรือ `GOOGLE_SCRIPT_SIGNING_SECRET` ซ้ำข้าม environment หรือซ้ำกันภายใน environment เดียว
- ผู้ที่ดูแล Vercel ต้องกำหนด scope ของตัวแปรทุกตัวให้ถูกต้องก่อน deploy

## 2. Environment Variables

ตั้งค่าที่ **Vercel Project → Settings → Environment Variables** แยกสองรอบสำหรับ Preview และ Production

| Variable | Required | Rule |
| --- | --- | --- |
| `AUTH_SECRET` | Yes | สุ่มอย่างน้อย 32 ตัวอักษรและไม่ซ้ำกับ secret อื่น |
| `QR_TOKEN_SECRET` | Yes | สุ่มอย่างน้อย 32 ตัวอักษรและไม่ซ้ำกับ `AUTH_SECRET` |
| `NEXT_PUBLIC_APP_URL` | Yes | HTTPS URL ของ environment นั้น ห้ามเป็น localhost |
| `NEXTAUTH_URL` | Optional | หากตั้ง ต้องเป็น HTTPS URL ของ environment นั้น |
| `GOOGLE_SHEET_ID` | Yes | Spreadsheet ID เฉพาะ environment |
| `GOOGLE_SERVICE_ACCOUNT_EMAIL` | Conditional | ต้องตั้งพร้อม `GOOGLE_PRIVATE_KEY` เมื่อใช้ service account writer |
| `GOOGLE_PRIVATE_KEY` | Conditional | เก็บ newline เป็น `\n`; ห้าม commit ลง Git |
| `GOOGLE_SCRIPT_URL` | Conditional | Apps Script deployment URL เฉพาะ environment |
| `GOOGLE_SCRIPT_SIGNING_SECRET` | Conditional | บังคับเมื่อมี `GOOGLE_SCRIPT_URL`; อย่างน้อย 32 ตัวอักษรและต้องไม่ซ้ำกับ auth/QR secret |
| `GOOGLE_API_KEY` | Optional | ใช้สำหรับ read fallback เท่านั้น; ห้ามทำให้ชีต `Users` เป็น public |

ต้องมี writer อย่างน้อยหนึ่งแบบ:

1. `GOOGLE_SERVICE_ACCOUNT_EMAIL` + `GOOGLE_PRIVATE_KEY` หรือ
2. `GOOGLE_SCRIPT_URL` + `GOOGLE_SCRIPT_SIGNING_SECRET`

หากตั้ง writer ทั้งสองแบบ ระบบจะเลือก service account เป็นหลัก ต้องบันทึกเหตุผลและทดสอบเส้นทางที่เลือกจริงก่อนอนุมัติ

### การสร้างและหมุนเวียน Secret

- สร้างค่าด้วย secret generator ที่เชื่อถือได้ เช่น `openssl rand -hex 32`
- ห้ามวางค่าจริงใน issue, PR, chat, screenshot, log หรือเอกสารนี้
- เมื่อสงสัยว่า secret รั่ว ให้ rotate ค่าใน Vercel และ Apps Script พร้อมกัน แล้ว redeploy
- การเปลี่ยน auth secret จะทำให้ session เดิมใช้ไม่ได้ ต้องแจ้งผู้ใช้ล่วงหน้า

## 3. Google Sheets และ Apps Script

### 3.1 Tabs ที่ต้องมี

`Warehouses`, `Locations`, `Shelves`, `PRODUCTS`, `Documents`, `StockMovements`, `StockSummary`, `StockCounts`, `Users`, `ประวัติการเข้าระบบ`, `Idempotency`, `AuditLogs` และ `OperationJournal`

ตรวจ header และชนิดข้อมูลของทุก tab ใน Preview ก่อน Production ห้ามให้ Apps Script สร้าง tab ที่สะกดผิดโดยไม่ตรวจสอบ

### 3.2 Service account writer (แนะนำ)

1. สร้าง service account แยก Preview/Production
2. แชร์ spreadsheet ให้ service account เฉพาะสิทธิ์ที่จำเป็น
3. ตั้ง email/private key ใน Vercel scope ที่ตรงกัน
4. ห้ามตั้ง spreadsheet เป็น public เพื่อให้ API key อ่านข้อมูลผู้ใช้

### 3.3 Apps Script writer

1. ใช้โค้ดจาก `scripts/google-apps-script.gs` และสร้าง deployment แยก Preview/Production
2. ตั้ง Script Property ชื่อ `SIGNING_SECRET` ให้ตรงกับ `GOOGLE_SCRIPT_SIGNING_SECRET` ของ environment นั้น
3. Web app อาจต้องเปิด `Who has access: Anyone` เพื่อรับคำขอจาก Vercel แต่ HMAC verification ต้องทำงานและ fail closed ทุกครั้ง
4. ห้าม deploy script รุ่นที่ยอมรับ mutation แบบ unsigned
5. การตรวจ read-only ที่ `/api/system/health` ไม่ได้ยืนยัน writer ให้ทดสอบ signed `ping` แยกต่างหากก่อน mutation test
6. ตรวจว่า unsigned, secret ผิด, timestamp เก่า และ nonce ซ้ำถูกปฏิเสธทั้งหมด

## 4. Pre-deployment Gates

### Gate A — Release owner

- Working tree สะอาด และ commit ที่จะ deploy ถูก push แล้ว
- `package.json` และ `package-lock.json` ตรงกัน
- Node engine เป็น `>=20.9.0` และทดสอบด้วย supported LTS runtime
- รัน `npm ci` แล้ว `npm run verify` ผ่านบน commit เดียวกับที่จะ deploy
- รัน `npm audit --omit=dev --audit-level=high` และบันทึกข้อยกเว้นที่อนุมัติแล้ว
- ตรวจ `.gitignore` และ `.vercelignore`; ไม่มี `.env*`, private key, `data/*.json`, log หรือไฟล์ชั่วคราวใน deployment manifest

### Gate B — Application/security owner

- ตรวจ Preview `/api/system/health` ได้ `200`, `status: "HEALTHY"`, `environment.valid: true` และ `storage.status: "CONNECTED"`
- ตรวจ signed Apps Script ping สำเร็จ และ negative cases ทั้งหมดถูกปฏิเสธ
- ทดสอบ login, authorization ตาม role/warehouse, rate limit และ logout ใน Preview
- ทดสอบ mutation ด้วยข้อมูลสังเคราะห์ใน Preview และยืนยัน `Documents`, `StockMovements`, `StockSummary`, `Idempotency`, `AuditLogs` และ `OperationJournal`
- ไม่มี secret หรือรายละเอียด credential ใน browser bundle และ function logs

### Gate C — Data owner

- ยืนยันว่า Preview และ Production ชี้คนละ spreadsheet/deployment
- สร้าง timestamped backup/copy ของ Production spreadsheet ก่อน promote
- ตรวจว่า backup เปิดอ่านได้และระบุผู้รับผิดชอบการ restore
- ยืนยันว่าไม่มี transaction Production ค้างใน `IN_PROGRESS` หรือ `COMPENSATING`

### Gate D — Production approver

- ตรวจหลักฐาน Gate A–C และอนุมัติ deployment ID ที่ระบุชัดเจน
- Promote deployment ที่ผ่าน Preview เท่านั้น ห้าม deploy working tree ที่ยังไม่ commit ตรงเข้า Production
- กำหนดช่วง deploy และผู้รับผิดชอบ rollback ก่อนเริ่ม

## 5. Staged Deployment

1. Deploy commit ไป Preview
2. ผ่าน Gate A–C โดยใช้ Preview resources เท่านั้น
3. สร้าง Production backup และบันทึก deployment ID เดิม
4. ให้ Production approver อนุมัติ deployment ID ใหม่
5. Promote ไป Production
6. ทำ read-only checks ก่อน: health, login pages และรายการอ่านข้อมูล
7. เมื่อ read-only ผ่าน ให้ทำ synthetic mutation ขนาดเล็กหนึ่งรายการที่กำหนดไว้ล่วงหน้า
8. ตรวจผลใน movement, summary, idempotency, audit และ journal แล้วลบ/กลับรายการด้วย workflow ที่รองรับ
9. เฝ้าดู Vercel Function Logs และ Google writer errors ตลอดช่วง observation window

หยุด rollout ทันทีเมื่อ health เป็น `DEGRADED`, signed writer ล้มเหลว, พบยอดสต็อกไม่ตรง, audit/idempotency หาย หรือมี error เพิ่มต่อเนื่อง

## 6. Rollback และ Data Recovery

1. ปิดหรือจำกัด mutation ชั่วคราวเพื่อหยุดความเสียหายเพิ่ม
2. ใน Vercel เลือก deployment ที่ผ่านล่าสุดแล้วใช้ **Promote to Production/Rollback**
3. การ rollback โค้ดไม่ rollback ข้อมูล Google Sheets อัตโนมัติ ห้าม restore spreadsheet ทันทีโดยไม่ตรวจ transaction หลังจุด backup
4. ตรวจ `Documents`, `StockMovements`, `StockSummary`, `Idempotency` และ `OperationJournal`
5. ให้ application owner และ data owner ตัดสินใจว่าจะ compensate, แก้เฉพาะรายการ หรือ restore backup
6. หาก restore ให้เก็บสำเนาสภาพปัจจุบันก่อน และบันทึกช่วงข้อมูลที่อาจต้อง replay
7. Rotate signing/auth secrets หากเหตุการณ์เกี่ยวข้องกับ credential หรือ webhook abuse
8. เปิด mutation อีกครั้งเมื่อ health, writer และ reconciliation ผ่าน พร้อมบันทึก incident summary

## 7. หลักฐานที่ต้องเก็บต่อ Release

- Git commit SHA และ Vercel deployment ID
- ผล `npm run verify` และ dependency audit
- รายการ env scope ที่ตรวจแล้วโดยไม่บันทึกค่าจริง
- Preview health/signed-ping/smoke-test results
- Production backup identifier
- ชื่อผู้อนุมัติ Gate A–D และเวลาอนุมัติ
- ผล post-deploy checks หรือ rollback/incident record
