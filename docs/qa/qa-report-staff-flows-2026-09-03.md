# รายงานผลทดสอบระบบฝั่งพนักงาน (Staff Flows) — วันที่ 2026-09-03

> **สถานะการแก้ไข (อัปเดต 2026-09-03)**: แก้เสร็จ **28/29 ปัญหา** แล้ว (typecheck ผ่าน, lint 0 errors, เทสผ่าน 19 suites / 132 tests เท่า baseline) ยกเว้น **BUG-B4** (distributed lock ข้าม instance) ที่ประเมินแล้วไม่ implement ทันที เพราะฝั่ง Apps Script ไม่มี acquire/release lock API — ต้องแก้สคริปต์ภายนอกก่อน จึงจัดการเป็น TODO พร้อมทางเลือกใน `atomic-stock-executor.ts` และแก้ docblock ให้ตรงความจริง
>
> การเปลี่ยนนโยบายที่มาพร้อมการแก้: (1) WAREHOUSE_STAFF/STAFF ไม่มี `STOCK_TRANSFER_COMPLETE` แล้ว — ปิดงานเบิกผ่าน `/api/movements/transfer/[id]/complete` ได้เฉพาะ ADMIN/MANAGER/APPROVER (workflow UI ของพนักงานใช้ /submit ตามเดิม) (2) MANAGER/APPROVER อนุมัติใบย้ายที่ยัง PENDING (พนักงานยังไม่กดส่งงาน) ไม่ได้ (3) PIN ซ้ำข้ามพนักงานจะล็อกอินไม่ได้แล้ว (แจ้งเตือนให้ติดต่อผู้ดูแล)

ทีมเทสเตอร์ QA ทดสอบ 3 flow หลักของพนักงานคลัง (WAREHOUSE_STAFF) ตามลำดับเมนูในระบบ โดยเดินตามขั้นตอนจริงของผู้ใช้ผ่านโค้ดทีละ step (login → หน้าเมนู → ฟอร์ม → API → service → Google Sheets repository) ควบคู่กับการรันชุดทดสอบ Jest ที่มีอยู่

> **วิธีใช้รายงานนี้**: แต่ละปัญหามี "Prompt แก้ไข" ที่ copy ไปวางให้ coding agent แก้ได้ทันที โดยไม่ต้องอธิบายเพิ่ม เรียงตามความรุนแรง

---

## สรุปผู้บริหาร

| Flow | หน้าจอพนักงาน | ผู้ทดสอบ | จำนวนปัญหา |
|---|---|---|---|
| รับสินค้าเข้าโกดัง | `/staff/receive` | Tester A | 11 (บวก 1 ซ้ำกับ flow อื่น) |
| จัดตำแหน่งสินค้า | `/staff/move` | Tester B | 10 |
| เบิกสินค้า | `/staff/transfer` | Tester C | 9 |
| **รวม (ตัดตัวซ้ำ BUG-A6/BUG-B9 ออก 1 ตัว)** | | | **29 ปัญหา** |

**Baseline**: `npm test` ผ่านทั้งหมด **19 suites / 132 tests** — ปัญหาที่รายงานทั้งหมดอยู่**นอกขอบเขต**ของชุดทดสอบเดิม (ส่วนใหญ่เป็น race condition, validation ฝั่ง server, และสถานะ UI ที่เทส sequential จับไม่ได้)

### สถิติตามความรุนแรง

| ความรุนแรง | จำนวน | รหัส |
|---|---|---|
| 🔴 Critical | 2 | BUG-B1, BUG-C1 |
| 🟠 High | 9 | BUG-A1, A2, A3, A4, B2, B3, B4, C2, C3 |
| 🟡 Medium | 10 | BUG-A5, A6, A7, B5, B6, B7, C4, C5, C6, C7 |
| ⚪ Low | 8 | BUG-A8, A9, A10, A11, B8, B10, C8, C9 |

### ปัญหาที่ต้องแก้ก่อน (Top 5)

1. **BUG-C1** — Backdoor รหัสผ่าน admin hardcoded ใน `/api/auth/login` (`"1234"`, `"password"` ฯลฯ ผ่านกับทุก email ที่ขึ้นต้น "admin") + ยอมรับรหัสผ่าน plaintext ในชีต
2. **BUG-B1** — จัดตำแหน่งสินค้าไปตำแหน่งที่**ไม่มีอยู่จริง/เป็นของโกดังอื่น**ได้ ทั้งฝั่ง UI และ API (สต็อก "หาย" จากทุกชั้น)
3. **BUG-A2** — รับสินค้าเข้าไม่มี atomic lock เหมือน flow อื่น → ยิงพร้อมกันสอง request ได้เอกสารซ้ำ สต็อกเข้าเกิน 2 เท่า
4. **BUG-B2** — `getBalance` จับคู่ตำแหน่งแบบ fuzzy (`"14a1".includes("a1")`) + fallback ยอดรวมทั้งโกดัง → ย้ายเกินยอดจนติดลบได้
5. **BUG-A3** — `POST /api/movements/receive` ไม่เรียก `authorize()` เลย — VIEWER/พนักงานที่ไม่มีสิทธิ์โกดังสร้างเอกสารรับเข้าได้ทุกโกดัง

---

## ส่วนที่ 1: สรุปการเดิน flow ตามขั้นตอนเมนู

### Flow รับสินค้าเข้าโกดัง (`/staff/receive`) — Tester A

| Step | ผล | เหตุผล |
|---|---|---|
| 1. สแกน QR → `/employee-login` → PIN | ⚠️ | Login ใช้ได้ (bcrypt + rate limit) แต่ PIN-login ตีความ `warehouse_access="*"` ไม่ตรงกับ password-login (BUG-A6) และ PIN ซ้ำข้ามพนักงานเข้าเป็นคนแรกเสมอ (BUG-A10) |
| 2. เปิดเมนู → `/staff/receive` | ✅ | เลือกโกดังถูกต้อง, locations ถูก filter ตามโกดัง — แต่การกันสิทธิ์เป็น client-side เท่านั้น (BUG-A3) |
| 3. สแกนบาร์โค้ด/จำนวน/ตำแหน่ง/ยืนยันทีละบรรทัด | ⚠️ | สแกนซ้ำ, จำนวน 0/ติดลบ/ทศนิยม ถูก gate ที่ UI ถูกต้อง — แต่ลบบรรทัดแล้ว index ไม่ remap → สต็อกเข้าตำแหน่งผิดได้ (BUG-A1), ตำแหน่งแปลกปลอมถูกยอมรับเงียบ ๆ (BUG-A4, A9), draft ข้ามโกดัง (BUG-A11) |
| 4. ยืนยัน → `POST /api/movements/receive` | ⚠️ | ดับเบิลคลิกถูกกัน, มี idempotency_key — แต่ server ตรวจแบบ read-then-write ไม่มี lock → race ได้เอกสารซ้ำ (BUG-A2), ไม่เช็คสิทธิ์ (BUG-A3), error message ดิบ (BUG-A8) |
| 5. สถานะเอกสาร + อนุมัติฝั่ง admin | ⚠️ | สร้าง PENDING ถูกต้อง, สต็อกเข้าตอนอนุมัติ — แต่หน้า success บอก "สำเร็จ" โดยไม่บอกว่ารออนุมัติ (BUG-A7) และ approve ตั้งสถานะ POSTED ก่อนทำงานจริง → พังแล้วเอกสารหายจากคิว (BUG-A5) |

Jest: `receive-stock`, `atomic-stock-operations`, `idempotency` → ผ่าน 14/14 (sequential จึงไม่จับ race ของ BUG-A2)

### Flow จัดตำแหน่งสินค้า (`/staff/move`) — Tester B

| Step | ผล | เหตุผล |
|---|---|---|
| 1. ล็อกอินพนักงาน (PIN/QR) | ✅ | bcrypt + rate-limit + lockout ถูกต้อง, JWT cookie 2 ชม. (edge case `warehouse_access` เก่า → BUG-A6) |
| 2. เมนู "จัดตำแหน่งสินค้า" | ✅ | nav remap `/movements/move` → `/staff/move` ถูกต้อง, proxy บังคับ login ทุกหน้า |
| 3. เลือกสินค้า/จาก-ไป/จำนวน + ยืนยัน | ⚠️ | สแกนตำแหน่งที่ไม่มีจริง/โกดังอื่นขึ้น ✓ สำเร็จ (BUG-B1), fuzzy match สินค้าเสี่ยงเลือกผิด (BUG-B7), from=to ไม่มี guard (BUG-B8) |
| 4. API + service (move-stock, executor, lock) | ⚠️ | zod + authorize + idempotency + in-process lock ทำงาน แต่ไม่ validate ปลายทางฝั่ง server (BUG-B1), getBalance fuzzy เกินจริง (BUG-B2), syncMove เขียนทับทั้งแถว (BUG-B3), ไม่มี distributed lock จริง (BUG-B4) |
| 5. ประวัติ/สถานะหลังย้าย | ⚠️ | movement + summary บันทึกได้ แต่ sync ไปชีตกายภาพกลืน error เงียบ ๆ (BUG-B5), สแกน QR โกดังตอน step 2 ไม่ reset ฟอร์ม (BUG-B6) |

Jest: `move-stock`, `stock-locking`, `concurrency-and-durability` → ผ่าน 10/10

### Flow เบิกสินค้า (`/staff/transfer`) — Tester C

| Step | ผล | เหตุผล |
|---|---|---|
| 1. ล็อกอิน PIN/QR | ⚠️ | qr-login fail-closed ดี แต่ `/api/auth/login` มี backdoor รหัสผ่าน admin hardcoded + plaintext fallback → BUG-C1 (Critical) |
| 2. เมนู "เบิกสินค้า" → `/staff/transfer` | ✅ | reuse hook/component จาก movements/transfer ถูกต้อง ไม่มี logic ซ้ำ |
| 3. State machine ใบเบิก (PENDING → WAITING_APPROVAL → COMPLETED/CANCELLED/REJECTED) | ⚠️ | Guard ดีเกือบครบ (approve เอกสารยกเลิก = error, approve ซ้ำ = idempotent, cancel หลัง complete = error) แต่ `/complete` ไม่บังคับผ่าน WAITING_APPROVAL (BUG-C4), `/submit`+`/progress` ไม่เช็คสิทธิ์ (BUG-C5), race approve/cancel (BUG-C6) |
| 4. สิทธิ์ตาม role | ✅/⚠️ | APPROVER เห็นเฉพาะเมนูเบิก, staff กดอนุมัติบนหน้าจอไม่ได้ + API ซ้อน 403 — แต่มีช่อง /complete bypass (BUG-C4) |
| 5. ผลต่อ stock | ⚠️ | หักสต๊อกเฉพาะตอน approve/complete ตรง design, cancel หลัง complete ถูกบล็อก, reverse mirror ถูกต้อง — แต่ fallback `Math.max(ledger, snapshot)` ทำให้เบิกเกินจนติดลบ (BUG-C3), retry สร้างใบซ้ำได้ (BUG-C7) |

Jest: `transfer-stock`, `issue-stock`, `reverse-stock`, `atomic-stock-operations`, `security-authorization` → ผ่าน 43/43

---

## ส่วนที่ 2: รายการปัญหาทั้งหมด (เรียงตามความรุนแรง)

---

## 🔴 CRITICAL

#### BUG-C1: Backdoor รหัสผ่าน admin แบบ hardcoded ใน login API
- **ความรุนแรง**: Critical
- **จุดเกิด**: `src/app/api/auth/login/route.ts:44-73`
- **อาการ**: ใครก็ได้เข้าสู่ระบบเป็นบัญชี admin ด้วยรหัสผ่านจากลิสต์ hardcoded ("admin", "1234", "123456", "password" ฯลฯ) โดยไม่ต้องรู้รหัสผ่านจริง และบัญชีที่เก็บรหัสผ่านเป็น plaintext ในชีตก็ล็อกอินผ่านได้ทันที
- **สาเหตุ**: `verifyPassword()` มี 2 ช่องทางยอมรับรหัสผ่านนอกเหนือจาก bcrypt: บรรทัด 44 `if (cleanPass === cleanHash) return true;` (plaintext match) และบรรทัด 48-73 fallback admin โดยเงื่อนไข identifier เป็น `cleanEmail.startsWith("admin")` (ครอบคลุมทุก email ที่ขึ้นต้น "admin") แล้วเทียบกับ `allowedAdminPasswords = ["admin","admin1234","admin123","123456","1234","password","Stockify2026!","Stockify@2026"]`
- **วิธีเกิด**: เปิดหน้า /login → กรอก "admin@stockify.com" / รหัสผ่าน "1234" → ได้ session role ADMIN ทันที → เข้าเมนูเบิกสินค้า อนุมัติ/ยกเลิก/กลับยอดได้ทุกโกดัง
- **หลักฐาน**: อ่านโค้ด (jest `security-authorization.test.ts` ผ่านหมดเพราะไม่ได้ทดสอบ login route เลย)
- **Prompt แก้ไข**:
```
แก้ไขไฟล์ src/app/api/auth/login/route.ts ฟังก์ชัน verifyPassword() (บรรทัด 28-76):
1) ลบ fallback "plaintext match" ที่บรรทัด 44 (`if (cleanPass === cleanHash) return true;`) และลบบล็อก admin password fallback ทั้งหมด (บรรทัด 47-73 รวม allowedAdminPasswords)
2) ให้เหลือเฉพาะการเทียบ bcrypt ($2b$/$2a$/$2y$) เหมือนแนวทาง checkPinMatch ใน src/app/api/auth/qr-login/route.ts:23-36 ที่ fail-closed
3) ก่อนลบ ให้เขียน migration script เพื่อ re-hash รหัสผ่าน plaintext/รหัสผ่าน default admin ที่ยังใช้งานจริงเป็น bcrypt hash (อ้างแนวทาง scripts/migrate-plaintext-pins.ts)
เงื่อนไขที่ต้องไม่พัง: admin ที่มี bcrypt hash ถูกต้องต้องล็อกอินได้ตามปกติ, rate-limit และ recordLoginLog ต้องทำงานเหมือนเดิม, ห้ามกระทบ qr-login
หลังแก้: รัน `npm run typecheck` และ `npx jest __tests__/security-authorization.test.ts --config jest.config.js --runInBand` (และเพิ่ม test กรณี password "1234" ต้อง 401)
```

#### BUG-B1: ไม่มีการ validate ตำแหน่งปลายทาง — ย้ายไปตำแหน่งที่ไม่มีอยู่จริงหรือของโกดังอื่นได้
- **ความรุนแรง**: Critical
- **จุดเกิด**: `src/lib/services/stock/move-stock.ts:44-69`, `src/app/(dashboard)/movements/move/_hooks/use-move-movement.ts:262-276`, `src/lib/services/stock/stock-errors.ts:61`
- **อาการ**: พนักงานสแกน QR ชั้นวางผิด (เช่น ป้ายของโกดัง 2 ขณะ active เป็นโกดัง 1) หรือสแกนโค้ดใด ๆ ที่ไม่ใช่ตำแหน่ง → หน้าจอขึ้น "✓ ปลายทาง: ..." สีเขียว และกดย้ายสำเร็จ 201 — สต็อกถูกสร้างขึ้นที่ตำแหน่งที่ไม่มีอยู่จริงในชีต Stock_Summary (ของ "หาย" จากทุกชั้น) หรือถูกบันทึกที่ชั้นชื่อเดียวกันในโกดังผิด
- **สาเหตุ**: ฝั่ง hook ถ้าสแกนแล้วไม่เจอใน `locations` ของโกดังปัจจุบัน จะ "ยอมรับโค้ดดิบ" พร้อม feedback สำเร็จ:
  ```ts
  const targetCode = matchedLoc ? (...) : code.trim().toUpperCase();
  setValue("to_location_id", targetCode, { shouldValidate: true });
  setScanFeedback({ type: "success", message: `✓ ปลายทาง: ${targetCode}` });
  ```
  ฝั่ง service `moveStock` ตรวจแค่โกดัง (L52-56) และยอดต้นทาง (L58-69) — **ไม่มีการเรียก `repo.locations` เพื่อยืนยันว่า `to_location_id` มีอยู่และอยู่ใน `warehouse.warehouse_id` เดียวกันเลย** และมี error class `InvalidStockLocationError` (stock-errors.ts:61) แต่ไม่มีที่ไหนใช้ (grep เจอแค่ที่ประกาศ) ส่วน UI ตอนจับคู่ตำแหน่งยังใช้ `cleanLocStr` ตัด prefix `wh-0?N` ทิ้ง (use-move-movement.ts:20) ทำให้ QR ของโกดังอื่นที่รหัสชั้นซ้ำกัน (A1 มีได้ทุกโกดัง) จับคู่กับตำแหน่งของโกดังปัจจุบันแบบเงียบ ๆ
- **วิธีเกิด**: 1) พนักงานล็อกอิน → `/staff/move?wh=wh-01` 2) สแกนบาร์โค้ดสินค้า กดถัดไป 3) ที่ step 2 สแกนป้าย QR ชั้น `WH2-A1` (ของโกดัง 2) → จอขึ้น "✓ ปลายทาง: WH2-A1" 4) กด "ย้าย" → สำเร็จ สต็อกใน wh-01 โดนย้ายไปตำแหน่งที่ไม่มีใน wh-01 (หรือไปชั้น A1 ของ wh-01 ทั้งที่ของวางอยู่หน้าชั้นโกดัง 2)
- **หลักฐาน**: อ่านโค้ด — `move-stock.ts` ทั้งไฟล์ไม่มี `repo.locations`; grep `InvalidStockLocationError` เจอเฉพาะ stock-errors.ts:61; jest ผ่านหมดเพราะ `__tests__/move-stock.test.ts` ไม่มี case ตำแหน่งปลายทางไม่ถูกต้อง/ข้ามโกดังเลย
- **Prompt แก้ไข**:
```
แก้ flow MOVE ให้ validate ตำแหน่งปลายทางฝั่ง server:
1) ใน src/lib/services/stock/move-stock.ts หลังบล็อก "Warehouse existence check" (บรรทัด 52-56) เพิ่ม: โหลดตำแหน่งของโกดังด้วย repo.locations.findAll(warehouse.warehouse_id) แล้วหา to_location_id โดยเทียบทั้ง location_id/location_code แบบ trim+case-insensitive (ใช้ cleanLocCode จาก shared.ts ช่วย normalize) — ถ้าไม่เจอให้ throw new InvalidStockLocationError("ตำแหน่งปลายทาง <to_location_id> ไม่มีอยู่ในโกดังนี้") (class มีอยู่แล้วที่ src/lib/services/stock/stock-errors.ts:61, mapStockErrorToResponse จะส่ง 400 ให้เอง)
2) ใน src/app/(dashboard)/movements/move/_hooks/use-move-movement.ts บรรทัด 262-276: เมื่อ matchedLoc เป็น undefined ห้าม setValue + ห้ามแสดง success — ให้ setScanFeedback({type:"error", message:`✕ ไม่พบตำแหน่ง "${code.trim()}" ใน ${activeWhName}`}) และ return
เงื่อนไขที่ต้องไม่พัง: move ปกติระหว่างตำแหน่งที่มีอยู่ต้องผ่าน (รวมกรณี frontend ส่ง location_code สั้น เช่น "A1" แทน location_id "loc-A1" — normalize ด้วย cleanLocCode ทั้งสองฝั่งก่อนเทียบ), เทสเดิม __tests__/move-stock.test.ts ต้องผ่าน และเพิ่ม test case "rejects to_location_id ที่ไม่อยู่ในโกดัง"
หลังแก้: รัน npm run typecheck และ npx jest __tests__/move-stock.test.ts --config jest.config.js --runInBand
```

---

## 🟠 HIGH

#### BUG-A1: ลบบรรทัดรายการแล้ว confirmedLines/locationInputs ไม่ถูกจัด index ใหม่ → สต็อกเข้าตำแหน่งผิด
- **ความรุนแรง**: High
- **จุดเกิด**: `src/app/(dashboard)/movements/receive/_hooks/use-receive-movement.ts:58-59, 79, 489-491` และ `src/app/(dashboard)/movements/receive/_components/ReceiveLineItem.tsx:492-496`
- **อาการ**: พนักงานลบบรรทัดกลางรายการ (ปุ่ม "ลบรายการนี้") แล้ว badge "ยืนยันแล้ว" ไปติดที่บรรทัดที่ยังไม่เคยยืนยัน/ยังไม่มีตำแหน่ง และตอน submit ตำแหน่งที่เคยสแกนของบรรทัดที่ถูกลบไปใช้กับบรรทัดอื่นแทน → เอกสารระบุชั้นวางผิด สต็อกเข้าชั้นผิด
- **สาเหตุ**: state เก็บแบบ `Record<number, ...>` อิง index แต่ `remove` ของ useFieldArray ถูกส่งตรง ๆ โดยไม่ remap: hook บรรทัด 58-59 `const [locationInputs, setLocationInputs] = useState<Record<number, string>>({}); const [confirmedLines, setConfirmedLines] = useState<Record<number, boolean>>({});` และบรรทัด 79 `const { fields, append, insert, remove } = useFieldArray(...)` (ไม่มี wrapper ล้าง state) — `onSubmit` อ่านกลับด้วย index ปัจจุบัน: บรรทัด 490 `const manualLoc = locationInputs[idx];` ซึ่งค่าเก่า (ของบรรทัดที่ลบไป) มี priority ก่อน `l.location_id` จริงของบรรทัดนั้น ปุ่มลบใน ReceiveLineItem บรรทัด 494 `onClick={() => { setShowCancelModal(false); onRemove(index); }}` ก็ไม่เรียก cleanup ด้วย ผลคือ `isLocked={index > 0 && !confirmedLines[index - 1]}` (ReceiveLinesTable.tsx:120) และ `allConfirmed` คำนวณจาก index ที่เลื่อนแล้ว ทำให้บรรทัดที่ location ว่างถูกมองว่ายืนยันแล้ว และตอน submit ระบบ fallback ให้เอง: hook บรรทัด 487 `const defaultLoc = locations[0]?.location_id || 'loc-...'`
- **วิธีเกิด**: 1) พนักงานสแกนสินค้า 3 รายการ สแกนตำแหน่ง A1, B2, C3 และยืนยันครบ 2) พบว่ารายการแรกเกิน กด "ลบรายการนี้" ที่บรรทัด #1 3) บรรทัดที่เหลือถูกเลื่อนขึ้น แต่ `locationInputs[0]="A1"` ยังค้าง 4) กด "บันทึกรับสินค้า" → รายการที่ของจริงวาง B2 กลายเป็นถูกบันทึกเข้า A1 บนเอกสารที่ส่งไปอนุมัติ
- **หลักฐาน**: การอ่านโค้ด (ไฟล์และบรรทัดด้านบน) — ไม่มี unit test ครอบคลุมพฤติกรรม remove+rescan ของ hook นี้
- **Prompt แก้ไข**:
```
แก้ bug stale index ใน flow รับสินค้าเข้าคลังของโปรเจกต์ C:\Stockify\stockify-app

ไฟล์: src/app/(dashboard)/movements/receive/_hooks/use-receive-movement.ts
1) สร้าง wrapper ของ remove เช่น const removeLine = (index: number) => {
     remove(index);
     setLocationInputs(prev => { const next = {...prev}; delete next[index];
       return Object.fromEntries(Object.entries(next).map(([k,v]) => [Number(k) > index ? Number(k)-1 : Number(k), v])); });
     setConfirmedLines(prev => { /* remap แบบเดียวกัน */ });
   }; แล้วเปลี่ยนที่ return ของ hook (บรรทัด ~616) จาก `remove` เป็น `removeLine`
2) เพื่อกันพลาดซ้ำ: เปลี่ยน onSubmit (บรรทัด 489-491) ให้อ่านตำแหน่งจาก l.location_id ของบรรทัดนั้นเป็นหลัก แล้วค่อย fallback ไป locationInputs[idx] และห้ามใช้ defaultLoc กับบรรทัดที่ location ว่าง — ให้ block การ submit ด้วยข้อความไทยแทน

ไฟล์: src/app/(dashboard)/movements/receive/_components/ReceiveLinesTable.tsx
- เปลี่ยน prop onRemove ที่ส่งให้ ReceiveLineItem ให้ใช้ wrapper ใหม่ (ผ่าน page.tsx ของ staff/receive ด้วย)

เงื่อนไขที่ต้องไม่พัง: flow สแกนตำแหน่งปกติ (handleScanLocationForLine), ปุ่มยืนยันรายการ/บันทึกทั้งหมด, การ restore draft, และ schema ที่ส่งไป /api/movements/receive ต้องเหมือนเดิม
หลังแก้: รัน `npm run typecheck` และ `npx jest __tests__/receive-stock.test.ts --config jest.config.js --runInBand`
```

#### BUG-A2: ฝั่ง server ตรวจ idempotency แบบ read-then-write ไม่มี lock → กดยืนยันซ้ำ/ยิงพร้อมกันสร้างเอกสารรับซ้ำ สต็อกเข้าซ้ำเท่าตัว
- **ความรุนแรง**: High
- **จุดเกิด**: `src/lib/services/stock/receive-stock.ts:31-53` (เทียบ `src/lib/services/stock/issue-stock.ts:18,30` และ `src/app/api/movements/receive/route.ts:34`)
- **อาการ**: อินเทอร์เน็ตชลอด/timeout แล้ว staff กด "ยืนยันและสร้างเอกสาร" ซ้ำในอีกแท็บ (หรือ request สองอันแตะ server พร้อมกัน) → ได้เอกสาร PENDING สองใบ idempotency_key เดียวกัน → admin อนุมัติทั้งคู่ → สต็อกเข้าเกินจริง 2 เท่า
- **สาเหตุ**: `receiveStock` เช็คก่อนเขียนโดยไม่ถือ lock: บรรทัด 33-35 `(await repo.movements.existsByIdempotencyKey(input.idempotency_key)) || (await repo.movements.existsByIdempotencyKey(\`${input.idempotency_key}-0\`))` และบรรทัด 40-49 สแกน `repo.documents.findAll({ page: 1, limit: 9999 })` หา key ใน note — สอง request พร้อมกันต่างคนต่างเห็น "ยังไม่มี" แล้ว `repo.documents.create` ทั้งคู่ (บรรทัด 177) ระบบมี `executeAtomicOperation` (lock + claimIdempotencyKey + journal) ที่ issue/move/transfer/reverse ใช้หมด แต่ receive ไม่ได้ใช้
- **วิธีเกิด**: 1) staff เปิด /staff/receive สองแท็บ กรอกเสร็จ 2) กดยืนยันเกือบพร้อมกัน (หรือกดแล้วเน็ตหน่วง กดซ้ำอีกแท็บ) 3) ทั้งสอง request ผ่านเช็ค idempotency → เอกสาร 2 ใบ 4) admin เห็น 2 ใบหน้า /approvals กดอนุมัติทั้งคู่ → ยอดในโกดังเพิ่ม 2 เท่า
- **หลักฐาน**: การอ่านโค้ด + `__tests__/receive-stock.test.ts:206` มี test idempotency duplicate แต่เป็น sequential เท่านั้น (จึง pass ไม่จับ race)
- **Prompt แก้ไข**:
```
ทำให้ receive flow atomic เทียบเท่า issue/move ในโปรเจกต์ C:\Stockify\stockify-app

ไฟล์: src/lib/services/stock/receive-stock.ts
- ครอบ body ของ receiveStock ด้วย executeAtomicOperation จาก ./atomic-stock-executor (แบบเดียวกับ issue-stock.ts:30): กำหนด operationType "RECEIVE", idempotencyKey = input.idempotency_key, lockKeys = [formatStockLockKey(input.warehouse_id, "any", "any")] (import จาก @/lib/locking), actorId = input.user_id, และย้าย logic เดิม (idempotency scan เดิมให้คงไว้เป็น fast-path ได้ แต่ claimIdempotencyKey ต้องเป็นตัวตัดสิน) ไปอยู่ใน config.execute
- ห้ามเปลี่ยนรูปทรง Document ที่ return และห้ามเปลี่ยนข้อความ StockConflictError เดิม

ไฟล์: src/app/api/movements/receive/route.ts
- คงการเรียก receiveStock เดิม (executor จะจัดการ lock/idempotency เอง)

เงื่อนไขที่ต้องไม่พัง: __tests__/receive-stock.test.ts ทั้งไฟล์ (mock repo ใช้ IStockRepository — ถ้า executor เรียก repo.idempotency/journal ต้องยังทำงานกับ mock ได้ หากไม่ได้ให้อัปเดต mock ใน test ให้ครอบ), flow อนุมัติใน /api/approvals/[id]/approve ที่อ่าน idempotency_key จาก note ต้องยังอ่านได้
หลังแก้: รัน `npm run typecheck` และ `npx jest __tests__/receive-stock.test.ts __tests__/idempotency.test.ts __tests__/atomic-stock-operations.test.ts --config jest.config.js --runInBand`
```

#### BUG-A3: `POST /api/movements/receive` ไม่เรียก authorize เลย — VIEWER ยิงได้ และไม่เช็คสิทธิ์โกดัง (warehouse_access)
- **ความรุนแรง**: High
- **จุดเกิด**: `src/app/api/movements/receive/route.ts:14-16` (คอมเมนต์ `// 1. Auth check — get session (allow all roles)`) — เทียบ `src/app/api/movements/issue/route.ts:26` กับ `src/lib/security/authorize.ts:55-77` และ `src/lib/security/permissions.ts:79-88`
- **อาการ**: ผู้ใช้ role ใดก็ได้ที่ล็อกอิน (รวม VIEWER ซึ่งเมทริกซ์ให้สิทธิ์อ่านอย่างเดียว และ WAREHOUSE_STAFF ที่มีสิทธิ์แค่บางโกดัง) ยิง POST สร้างเอกสารรับเข้าโกดังใดก็ได้ รวมถึงโกดังที่ตนไม่มีสิทธิ์
- **สาเหตุ**: route มีแค่ `const session = await getAuthSession(req); if (!session) return unauthorizedResponse();` ไม่มี `createActorFromSession` + `authorize(actor, PERMISSIONS.STOCK_RECEIVE, parsed.data.warehouse_id)` ซึ่ง issue/move ใช้ทั้งคู่ (`PERMISSIONS.STOCK_RECEIVE` มีให้ WAREHOUSE_STAFF อยู่แล้วที่ permissions.ts:80, VIEWER ไม่มี)
- **วิธีเกิด**: 1) พนักงานที่ถูกกำหนดสิทธิ์เฉพาะ wh-01 ล็อกอินด้วย PIN 2) ยิง `POST /api/movements/receive` ด้วย `warehouse_id: "wh-05"` (curl/DevTools) 3) สำเร็จ 201 → เอกสารรออนุมัติเข้าโกดังที่ไม่มีสิทธิ์ หรือ user VIEWER ทำสิ่งที่ควรอ่านอย่างเดียว
- **หลักฐาน**: การอ่านโค้ดตามไฟล์:บรรทัดด้านบน (issue route บรรทัด 26 เรียก authorize, receive route ไม่มีเลยทั้งไฟล์)
- **Prompt แก้ไข**:
```
เพิ่มการตรวจสิทธิ์ให้ POST /api/movements/receive ใน C:\Stockify\stockify-app

ไฟล์: src/app/api/movements/receive/route.ts
- import { createActorFromSession, authorize, PERMISSIONS } from "@/lib/security" และ forbiddenResponse จาก @/lib/api-response
- หลัง getAuthSession: const actor = await createActorFromSession(req, session); if (!actor) return unauthorizedResponse();
- หลัง safeParse สำเร็จ: try { authorize(actor, PERMISSIONS.STOCK_RECEIVE, parsed.data.warehouse_id); } catch (authErr: any) { if (authErr?.statusCode === 401) return unauthorizedResponse(authErr.message); return forbiddenResponse(authErr.message ?? "คุณไม่มีสิทธิ์รับสินค้าโกดังนี้"); }
- เปลี่ยน user_id/role ที่ส่งให้ receiveStock ให้ใช้ actor.id / actor.role

เงื่อนไขที่ต้องไม่พัง: WAREHOUSE_STAFF/ADMIN ต้องยังส่งรับสินค้าได้ปกติ (พวกเขามี STOCK_RECEIVE ใน permissions.ts:80,35), โค้ด UI ปัจจุบันไม่ต้องแก้, ห้ามกระทบ route /history
หลังแก้: รัน `npm run typecheck` และ `npx jest __tests__/security-authorization.test.ts __tests__/receive-stock.test.ts --config jest.config.js --runInBand`
```

#### BUG-A4: ตำแหน่ง (location) ที่ไม่มีในระบบหรือไม่อยู่ในโกดังที่เลือก ถูกยอมรับเงียบ ๆ ทั้งฝั่ง client และ server
- **ความรุนแรง**: High
- **จุดเกิด**: client: `src/app/(dashboard)/movements/receive/_hooks/use-receive-movement.ts:211-226` และ `ReceiveLineItem.tsx:147-154` — server: `src/lib/services/stock/receive-stock.ts:122-135` + `src/types/api.ts:113`
- **อาการ**: พนักงานสแกน/พิมพ์ชั้นวางที่ยังไม่ได้สร้าง (หรือชั้นของโกดังอื่น) ระบบโชว์ "บันทึกตำแหน่งแล้ว" เขียว แล้วเอกสารถูกสร้างด้วยรหัสตำแหน่งที่ไม่มีจริง — ตอน admin อนุมัติ stock จะถูก apply เข้า location ลอย ๆ หายากเวลาตามหาของ
- **สาเหตุ**: ฝั่ง hook ถ้าไม่เจอ location จะสร้าง object ปลอมใส่ list แทนที่จะแจ้งเตือน: บรรทัด 211-223 `if (!matchedLoc) { const newLocObj: Location = { location_id: finalLocId, ... location_name: \`ตำแหน่ง ${finalLocCode}\` ...}; setLocations((prev) => [newLocObj, ...prev]); }` — ส่วน extra slot ใน ReceiveLineItem (บรรทัด 150-152) รับทุก string โดยไม่เช็คเลย `updated[extraIdx] = code.toUpperCase();` — ฝั่ง server ค้น location จากทุกโกดังไม่กรอง warehouse และถ้าไม่เจอก็ใช้ข้อความดิบต่อ: บรรทัด 123-128 `allLocations.find(...)` (ไม่มีเงื่อนไข warehouse) และบรรทัด 135 `: alloc.location_id || loc?.location_code || "ตำแหน่งเริ่มต้น"` — schema ก็ไม่ validate: api.ts:113 `location_id: z.string().default("loc-14A1")` และ zod ของ `ReceiveLineSchema` ไม่มีเช็คความมีอยู่จริง/สังกัดโกดัง
- **วิธีเกิด**: 1) staff สแกนชั้น "B99" ที่ยังไม่มีใน master (หรือชั้นของโกดัง 2 ขณะอยู่โกดัง 1) 2) ระบบตอบ "บันทึกตำแหน่งแล้ว [B99]" 3) ยืนยัน → เอกสาร PENDING ระบุ B99 4) admin กดอนุมัติ → movement ถูกสร้างที่ location "B99" และ stockSummary เพิ่มยอดที่ key ที่ไม่มีใน master location
- **หลักฐาน**: การอ่านโค้ดตามด้านบน; `__tests__/receive-stock.test.ts` ไม่มีเคส location ไม่พบ/ต่างโกดัง (ผ่าน jest ทุกตัวแม้พฤติกรรมนี้อยู่)
- **Prompt แก้ไข**:
```
บังคับ validate ตำแหน่งวางสินค้าใน flow รับเข้าของ C:\Stockify\stockify-app

1) ไฟล์ src/app/api/movements/receive/route.ts (หรือใน receive-stock.ts หลังโหลด allLocations):
   - หลัง resolve warehouse ให้ filter allLocations เฉพาะ warehouse ที่เลือก แล้วตรวจทุก allocation.location_id ว่าตรงกับ location_id/location_code/shelf_code ของโกดังนั้น (case-insensitive, normalize ด้วย cleanLocCode จาก ./shared ได้)
   - ถ้าไม่พบให้ throw StockValidationError ข้อความไทย เช่น `ไม่พบตำแหน่ง ${code} ใน${warehouseName} กรุณาตรวจสอบหรือเพิ่มตำแหน่งในระบบก่อน` (route มี mapStockErrorToResponse ให้ใช้แบบ issue route หรือจับที่ catch ให้กลับ 400)
2) ไฟล์ src/app/(dashboard)/movements/receive/_hooks/use-receive-movement.ts บรรทัด 211-226 และ 356-368:
   - ลบพฤติกรรมสร้าง Location object ปลอม — ถ้าไม่ match ให้ setScanFeedback({ type: "error", title: "ไม่พบตำแหน่งนี้ในโกดัง", message: `"${code}" ไม่อยู่ใน${activeWhName} — เช็ค QR ชั้นวางหรือเพิ่มตำแหน่งก่อน` }) และไม่ setValue location_id
3) ไฟล์ src/app/(dashboard)/movements/receive/_components/ReceiveLineItem.tsx บรรทัด 147-154:
   - handleExtraLocScanSubmit ต้อง validate กับ props.locations ก่อน setValue (แจ้ง error ถ้าไม่เจอ)
4) ไฟล์ src/types/api.ts บรรทัด 113: เปลี่ยน default ที่ hardcode `"loc-14A1"` เป็น `z.string().default("")` และให้ server validate ความว่างแทน (ค่า default ปัจจุบันทำให้ API เดาตำแหน่งแทนผู้ใช้)

เงื่อนไขที่ต้องไม่พัง: การสแกนด้วย shelf_code/location_code/location_id ที่ถูกต้องต้องยังผ่าน (รวมกรณี master โหลดช้า ที่ hook มี refetch /api/locations อยู่แล้วบรรทัด 178-201), __tests__/receive-stock.test.ts ที่ใช้ location ใน fixture ต้องยังผ่าน
หลังแก้: รัน `npm run typecheck` และ `npx jest __tests__/receive-stock.test.ts --config jest.config.js --runInBand`
```

#### BUG-B2: getBalance ใช้ fuzzy matching + Math.max + fallback ยอดรวมทั้งโกดัง → อนุญาตย้ายเกินยอดตำแหน่งต้นทางจนติดลบ
- **ความรุนแรง**: High
- **จุดเกิด**: `src/lib/repositories/sheets/stock-movement.repository.ts:265-266, 293, 319, 326-329`
- **อาการ**: พนักงานย้ายจากชั้น A1 จำนวน 100 ชิ้น (ของจริงบนชั้น A1 มี 0) ผ่านได้ เพราะระบบไปนับยอดของชั้น "14A1" / "2A1" หรือยอดรวมทั้งโกดังมาให้ → ยอดชั้น A1 ติดลบใน Stock_Summary ของหายจากชั้นอื่นโดยไม่มีใครแตะ
- **สาเหตุ**: ใน `getBalance` — ตรวจชีตกายภาพด้วย `rowLoc.includes(normTargetLoc) || normTargetLoc.includes(rowLoc)` (L265-266 → `"14a1".includes("a1") === true`) และตรวจ movements/summary ด้วย `rowLocId.endsWith(cleanLocId) || cleanLocId.endsWith(rowLocId)` (L293, L319) แล้วสรุปด้วย:
  ```ts
  const maxLocBalance = Math.max(sheetLocBal, movBalance, summaryBalance);
  if (maxLocBalance > 0) return maxLocBalance;
  if (sheetSkuTotal > 0) return sheetSkuTotal;   // ยอดรวมทั้งโกดังถ้าหายอดรายชั้นไม่เจอ
  return 0;
  ```
  คือ "เอาค่ามากที่สุดของ 3 แหล่งที่ fuzzy กันเอง" — แหล่งใดมียอดโป่งก็ชนะ และถ้ายอดรายชั้นเป็น 0 หมดแต่ SKU มีของที่ไหนสักแห่งในชีต จะคืน **ยอดรวมทั้งโกดังเป็นยอดของตำแหน่งนั้น**
- **วิธีเกิด**: 1) สินค้า SKU-A มีของ 100 ชิ้นที่ชั้น 14A1 และ 0 ชิ้นที่ชั้น A1 2) พนักงานสแกน SKU-A, ต้นทาง A1, จำนวน 100 3) หน้าจอผ่าน (ฝั่ง client ดู `product.quantity` รวมโกดัง = 100), ฝั่ง API getBalance("A1") fuzzy เจอ 14A1 → คืน 100 4) ย้ายสำเร็จ → A1 = -100, 14A1 ยังบวก 100 ใน summary (key ไม่ตรงกัน) — ของหายจากระบบ 100 ชิ้น
- **หลักฐาน**: อ่านโค้ด (บรรทัดด้านบน); `__tests__/move-stock.test.ts:133-135` mock `getBalance` เป็น lookup ตรงตัว จึงไม่มีเทสจับพฤติกรรม fuzzy ของ repo จริง
- **Prompt แก้ไข**:
```
แก้ src/lib/repositories/sheets/stock-movement.repository.ts ใน getBalance (บรรทัด 216-330):
1) เปลี่ยนการเทียบตำแหน่งทั้ง 3 แหล่งให้ strict: ผ่าน cleanLocCode() ทั้ง rowLoc/normTargetLoc แล้วเทียบด้วย === เท่านั้น (ลบ .includes/.endsWith ทั้งขา L265-266, L293-294, L319-320)
2) ลบ fallback `if (sheetSkuTotal > 0) return sheetSkuTotal;` (บรรทัด 328) — ถ้าหายอดรายชั้นไม่เจอต้องคืน 0
3) เปลี่ยน Math.max (บรรทัด 326) เป็นการเลือก source-of-truth เดียว เช่น ใช้ Stock_Summary เป็นหลัก และใช้อีก 2 แหล่งเฉพาะตอน summary ว่าง (ไม่ใช่ max)
เงื่อนไขที่ต้องไม่พัง: กรณีข้อมูลเก่าที่ location_id เก็บหลายรูปแบบ ("loc-A1" vs "A1") ต้องยังจับคู่ได้ผ่าน cleanLocCode — ให้เขียน test ครอบคลุมทั้ง "A1" vs "14A1" ต้องไม่จับคู่ และ "loc-A1" vs "A1" ต้องจับคู่; __tests__/move-stock.test.ts และ __tests__/concurrency-and-durability.test.ts ต้องผ่าน
หลังแก้: รัน npm run typecheck และ npx jest __tests__/move-stock.test.ts __tests__/stock-locking.test.ts __tests__/concurrency-and-durability.test.ts --config jest.config.js --runInBand
```

#### BUG-B3: ย้ายแบบไม่ระบุต้นทางผ่านทุกด่าน แล้ว syncMove เขียนทับตำแหน่งของ "ทั้งแถว" ไม่ตามจำนวนที่พนักงานกรอก
- **ความรุนแรง**: High
- **จุดเกิด**: `src/types/api.ts:165`, `src/lib/services/stock/move-stock.ts:58-69`, `src/lib/repositories/sheets/warehouse-sync.sheets-repository.ts:383-393`
- **อาการ**: พนักงานเลือกสินค้าที่ยังไม่มีตำแหน่ง (from ว่าง) กรอก "ย้าย 10 ชิ้น" ไปชั้น A2 → ระบบบันทึก "ย้าย 10 ชิ้น" แต่ในชีตกายภาพของโกดัง **แถวสินค้าที่มี 200 ชิ้นถูกย้าย location ทั้งแถวไป A2** — จำนวนบนกระดาษงานของจริงกับระบบไม่ตรงกันทันที
- **สาเหตุ**: schema อนุญาต from ว่าง `from_location_id: z.string().default("")` (api.ts:165) → `moveStock` ข้ามการเช็คยอด `if (input.from_location_id) {...}` (move-stock.ts:58) แล้วใน `syncMove`:
  ```ts
  const actualMoveQty = qty > 0 ? qty : totalSourceQty;          // L383
  if (!currentLoc || actualMoveQty >= totalSourceQty || totalSourceQty <= 0) {
    matchedRow[6] = cleanToLoc;   // L388 — เขียนทับ location ทั้งแถว ไม่แตะคอลัมน์จำนวน
  ```
  เงื่อนไข `!currentLoc` ทำให้แถวที่ไม่มีตำแหน่งถูกย้าย **ทั้งจำนวนในแถว** ทั้งที่ qty ที่ส่งมาแค่บางส่วน
- **วิธีเกิด**: 1) สแกนสินค้าที่คอลัมน์ location ว่าง (จอขึ้น "ตำแหน่งปัจจุบัน: ยังไม่ระบุ") 2) จำนวนอัตโนมัติ = ทั้งหมด/หรือพิมพ์ 10 3) สแกนชั้นปลายทาง กดย้าย 4) สำเร็จ — แต่เปิดชีตโกดังดู แถวสินค้าถูกย้ายพร้อมจำนวนเดิมทั้งหมดไปชั้นใหม่
- **หลักฐาน**: อ่านโค้ด (quote ด้านบน); ไม่มีเทสใดครอบ syncMove ของ move path (`__tests__/move-stock.test.ts` mock warehouseSync ไม่เรียก)
- **Prompt แก้ไข**:
```
แก้ 2 จุดให้สอดคล้องกัน:
1) src/lib/repositories/sheets/warehouse-sync.sheets-repository.ts บรรทัด 386-393: แยก case "!currentLoc" (แถวไม่มีตำแหน่ง) ออกจาก case "ย้ายทั้งหมด" — ถ้า !currentLoc และ actualMoveQty < totalSourceQty ให้ทำแบบ Case 2 (L396-410): ลดจำนวนแถวเดิมเหลือ totalSourceQty - actualMoveQty แล้ว syncAdd เฉพาะ actualMoveQty ไป cleanToLoc (หรือถ้า product นี้นับรวมทั้งแถวได้ตาม business จริง ให้ข้ามการบันทึก movement OUT/IN ฝั่ง move-stock แต่ห้ามทั้งสองฝั่งเห็นต่างกัน)
2) src/lib/services/stock/move-stock.ts บรรทัด 58: ตอนนี้ from ว่าง = ไม่เช็คยอดเลย ให้คงพฤติกรรม "จัดเข้าเชลฟ์จากของไม่มีตำแหน่ง" ไว้ได้ แต่ต้องส่งธง (เช่น isInitialPutaway) ไปบอก syncMove ให้ทำงานถูก case
เงื่อนไขที่ต้องไม่พัง: ย้ายทั้งหมด (qty = totalSourceQty) ยังต้อง update location แถวเดียวจบ, ย้ายบางส่วนจากตำแหน่งที่มีอยู่ยังต้อง split แถวถูกต้อง; รัน npm run typecheck และ npx jest __tests__/move-stock.test.ts --config jest.config.js --runInBand
```

#### BUG-B4: ไม่มี distributed lock จริงแม้ docblock อ้างว่ามี → race ย้ายพร้อมกันข้าม instance (Vercel multi-instance) ทำสต็อกติดลบได้
- **ความรุนแรง**: High (ขึ้นกับ deployment เป็น multi-instance)
- **จุดเกิด**: `src/lib/services/stock/atomic-stock-executor.ts:1, 23-32`, `src/lib/locking/lock-provider.ts`
- **อาการ**: พนักงานสองคน (สองเครื่อง/serverless instance คนละตัว) ย้ายสินค้าตำแหน่งเดียวกันพร้อมกันจำนวนรวมเกินยอด → ทั้งสองรายการผ่านเช็คยอดและบันทึกสำเร็จ → ยอดติดลบ / ของหาย
- **สาเหตุ**: docblock บอกว่ามี 3 ชั้นล็อก
  ```
  * 1. Local in-memory lock ... 2. Distributed Apps Script lock (correctness across instances)
  ```
  แต่ implement จริงคือ `return withStockLocks(config.lockKeys, async () => {` (L32) ซึ่งเป็น `InMemoryLockProvider` เท่านั้น — import `executeAtomicStockOperation` (ตัวที่ยิงไป Apps Script ให้ LockService ล็อกข้าม instance อยู่ที่ `src/lib/google-sheets/atomic-operations.ts:60`) **ถูก import ไว้ที่ L1 แต่ไม่เคยถูกเรียก** ส่วน idempotency กันแค่ "key เดียวกัน" ไม่ได้กันสองคนกดคนละ key แย่งยอดเดียวกัน และ Sheets เขียนแบบ read-modify-write ไม่มี CAS
- **วิธีเกิด**: 1) ยอดชั้น A1 มี 50 2) พนักงาน A เครื่องหนึ่งย้าย 30, พนักงาน B อีกเครื่องย้าย 30 ภายในเสี้ยววินาทีเดียวกัน 3) request ไปลง instance คนละตัว 4) ทั้งคู่อ่านยอด 50 ก่อนเขียน → ผ่านทั้งคู่ → summary A1 = -10
- **หลักฐาน**: อ่านโค้ด — grep `executeAtomicStockOperation` เจอแค่ประกาศ + import ที่ไม่ได้ใช้; `lock-provider.ts` หมายเหตุเองว่า "guarantees mutual exclusion ... SAME Node.js process"; เทสล็อกทั้งหมด (`__tests__/stock-locking.test.ts`, `__tests__/concurrency-and-durability.test.ts`) รัน in-process เท่านั้น
- **Prompt แก้ไข**:
```
เพิ่ม mutual exclusion ข้าม instance ให้ executeAtomicOperation:
ที่ src/lib/services/stock/atomic-stock-executor.ts — ก่อนบรรทัด 32 (withStockLocks) ให้ครอบด้วย distributed lock ผ่าน Apps Script LockService เช่น ขอ lock id จาก sortedKeys.join("|") ด้วย sendSignedAppsScriptRequest action "acquireLock/releaseLock" (มีโครงสร้างพร้อมใน src/lib/google-sheets/atomic-operations.ts) หรือถ้าไม่แก้ Apps Script ให้ใช้การ claim idempotency แบบ atomic ที่ชีต (สร้างแถว PROCESSING ด้วย append-only + ตรวจ duplicate หลังเขียน) เป็น inter-instance gate แทน
อย่าลืมลบ/ใช้งาน import ที่ค้างอยู่บรรทัด 1 ให้ถูกต้อง (ปัจจุบัน unused จะโดน lint)
เงื่อนไขที่ต้องไม่พัง: single-instance ต้องเร็วเท่าเดิม (เก็บ in-process lock ไว้เป็น fast path), lock ต้อง release ใน finally ทุก error path, __tests__/stock-locking.test.ts และ __tests__/concurrency-and-durability.test.ts ต้องผ่าน (mock provider ที่ inject ได้ต้องยัง inject ได้)
หลังแก้: รัน npm run typecheck และ npx jest __tests__/stock-locking.test.ts __tests__/concurrency-and-durability.test.ts __tests__/atomic-stock-operations.test.ts --config jest.config.js --runInBand
```

#### BUG-C2: อนุมัติไม่สำเร็จแล้วเอกสารหายจากคิวอนุมัติถาวร (optimistic UI rollback ไม่ครบ)
- **ความรุนแรง**: High
- **จุดเกิด**: `src/app/(dashboard)/movements/transfer/_hooks/use-transfer-movement.ts:512` คู่กับ `src/lib/transfer-notification-utils.ts:536-561`
- **อาการ**: ผู้อนุมัติกด "อนุมัติการเบิก" แล้ว server ตอบ error (เช่น 500, สต๊อกไม่พอ, ตำแหน่ง inactive) → alert error ขึ้นมา แต่เอกสารจะ "หาย" จากแท็บ "รออนุมัติ" ตลอดไป ทั้งที่สถานะจริงบน server ยัง WAITING_APPROVAL → งานค้าง สต๊อกไม่ถูกบันทึก ไม่มีใครกดอนุมัติซ้ำได้จากหน้าจอ
- **สาเหตุ**: `handleApproveTransfer` เรียก `markTransferCompleted(t.id)` แบบ optimistic ก่อนยิง fetch (use-transfer-movement.ts:512 แล้ว fetch ที่ 574) ซึ่งบันทึก id ลง `stockify_completed_transfers` (COMPLETED_KEY) ใน localStorage เมื่อ server fail แล้ว rollback กลับมาแค่ `setWaitingApprovalTasks(...)` (บรรทัด 587) แต่**ไม่มีฟังก์ชันลบ id ออกจาก COMPLETED_KEY** ผลคือทุกครั้งที่ sync (`getTransferNotifications`:288, `syncServerTransferNotifications`:822 `if (isTransferCompleted(item.id)) return false;`) จะ force status เป็น COMPLETED (บรรทัด 292) และกรองทิ้ง — จึงต้องเคลียร์ localStorage ถึงจะกลับมา
- **วิธีเกิด**: ผู้อนุมัติเปิดแท็บ "รออนุมัติ" → กด "อนุมัติการเบิก" ขณะ server/ชีตมีปัญหา → alert "อนุมัติไม่สำเร็จ" → ปิด alert → รายการหายจากทุกแท็บ (เหลือแต่ประวัติแบบ read-only ของ ADMIN) → พนักงานเห็นสถานะ "รออนุมัติ" ค้างตลอด
- **หลักฐาน**: อ่านโค้ด (จำลองตาม code path — jest ไม่ครอบคลุมฝั่ง UI)
- **Prompt แก้ไข**:
```
แก้ไข 2 ไฟล์:
1) src/lib/transfer-notification-utils.ts — เพิ่ม export function unmarkTransferCompleted(id: string) ที่ลบ id (normalized toLowerCase/trim) ออกจาก localStorage COMPLETED_KEY ("stockify_completed_transfers") และเปลี่ยน status ใน STORAGE_KEY กลับเป็น "WAITING_APPROVAL" แล้ว broadcastTransferChange()
2) src/app/(dashboard)/movements/transfer/_hooks/use-transfer-movement.ts — ใน handleApproveTransfer (บรรทัด 583-598) ทั้ง branch `!json.success` และ catch network error ต้องเรียก unmarkTransferCompleted(t.id) ก่อน/หลัง setWaitingApprovalTasks rollback; ทำแบบเดียวกันกับ handleCancelTransfer (495-505) และ handleRejectTransfer (629-640) ด้วย markTransferCancelled
เงื่อนไขที่ต้องไม่พัง: กรณีอนุมัติสำเร็จ ต้องยัง markTransferCompleted ตามเดิม, syncServerTransferNotifications ต้องไม่เพิ่มรายการที่ server บอก COMPLETED กลับเข้าคิว (เงื่อนไข isDone บรรทัด 732-741 คงไว้)
หลังแก้: รัน `npm run typecheck`
```

#### BUG-C3: เบิกเกินสต๊อกจริงได้จนยอดใน ledger ติดลบ (fallback ใช้ snapshot สินค้า)
- **ความรุนแรง**: High
- **จุดเกิด**: `src/lib/services/stock/transfer-stock.ts:151-152` (create) และ `655-656` + `629-634` (complete)
- **อาการ**: พนักงาน/ผู้อนุมัติสามารถย้าย/เบิกจำนวนมากกว่ายอดเคลื่อนไหวจริงในคลัง (ledger) ได้ ทำให้ยอดคงเหลือติดลบในระบบและชีตจริง ถ้า PRODUCTS snapshot ค้างสภาพเก่า (เช่น เคยมี 100 แต่ถูกเบิกไปจนเหลือ 5 ใน ledger)
- **สาเหตุ**: ทั้ง create และ complete ใช้ `const prodSnapshotQty = Number(prod.quantity ?? prod.total_quantity ?? 0); const effectiveBalance = Math.max(currentWarehouseBalance, prodSnapshotQty);` — เอาค่ามากกว่าระหว่าง ledger กับ snapshot มาเช็ค แล้ว complete ยังเช็ค allocation รายตำแหน่งด้วย fallback เป็น **ยอดรวมทั้งโกดัง** (`if (bal < allocQty) { const whBal = await repo.movements.getWarehouseBalance(...); if (whBal >= allocQty) bal = whBal; }` บรรทัด 629-634) → แต่ละ allocation ผ่านเฉพาะตัว แต่รวมกันเกินยอดรวมโกดังได้ แล้ว `applyChanges` (บรรทัด 710-717) หักตรง ๆ โดยไม่ clamp
- **วิธีเกิด**: Admin สร้างใบเบิก qty 100 (ผ่านเพราะ snapshot บอก 100 แต่ ledger จริงเหลือ 5) → พนักงานสแกนเบิก → ผู้อนุมัติกดอนุมัติ → completeTransfer ผ่านเช็คเพราะ `Math.max(5, 100) = 100 >= 100` → หัก -100 จากโกดังต้นทาง → ยอดติดลบ -95
- **หลักฐาน**: อ่านโค้ด; jest `transfer-stock.test.ts` ไม่มี case snapshot มากกว่า ledger (43 tests ผ่านหมด)
- **Prompt แก้ไข**:
```
แก้ไข src/lib/services/stock/transfer-stock.ts:
1) createTransfer บรรทัด 151-158: เปลี่ยนเงื่อนไขเป็นใช้ currentWarehouseBalance (ledger) เป็นตัวตัดสินเท่านั้น หรือถ้าต้องการเผื่อช่องว่างข้อมูล ให้ fallback เฉพาะเมื่อ getWarehouseBalance ใช้ไม่ได้ (function missing) ไม่ใช่ Math.max
2) completeTransfer บรรทัด 655-656: ลบ effectiveSourceBal = Math.max(currentSourceBalance, prodSnapshotQty) → เช็คกับ currentSourceBalance จริง
3) completeTransfer บรรทัด 621-640 (allocation loop): หลัง fallback เป็น warehouse balance ให้ตรวจรวมว่า sum(allocations) <= getWarehouseBalance ก่อนอนุมัติ (กันผ่านรายตำแหน่งแต่รวมเกิน)
เงื่อนไขที่ต้องไม่พัง: case ที่สินค้ามีสต๊อกในชีต warehouse จริงแต่ยังไม่มี movement record (repo.movements.getBalance = 0) ต้องยังย้ายได้ — ถ้าต้องการรักษา case นี้ ให้เพิ่ม config/flag เฉพาะ หรือให้ createTransfer sync เป็น movement เริ่มต้นก่อน; jest transfer-stock.test.ts ทั้ง 5 test เดิมต้องผ่าน
หลังแก้: รัน `npm run typecheck` และ `npx jest __tests__/transfer-stock.test.ts __tests__/atomic-stock-operations.test.ts --config jest.config.js --runInBand`
```

---

## 🟡 MEDIUM

#### BUG-A5: ปุ่มอนุมัติ (รับเข้า) ตั้งสถานะ POSTED ใน memory ก่อนทำงานจริง → ถ้า approve ล้มเหลว เอกสารหายจากคิวอนุมัติทั้งที่สต็อกไม่เข้า
- **ความรุนแรง**: Medium
- **จุดเกิด**: `src/app/api/approvals/[id]/approve/route.ts:43` (`setDocumentStatus(decodedId, "POSTED");`) ก่อนบรรทัด 91-101 (เช็ค doc ไม่เจอ/สถานะ conflict) และก่อนงานเขียนจริงบรรทัด 185-204; ผู้อ่านสถานะ: `src/app/api/approvals/route.ts:78-79` และ `src/app/api/movements/receive/history/route.ts:119-120`
- **อาการ**: admin กดอนุมัติแล้ว API error (เช่น `เอกสารนี้ไม่มีรายการสินค้าที่อนุมัติได้` จากบรรทัด 186 หรือ Sheets เขียนล้ม) → แต่ in-memory store ค้าง POSTED → เอกสารนี้โชว์เป็น "เสร็จสิ้น/COMPLETED" ในหน้า /approvals และประวัติรับเข้า หลุดจากคิวรออนุมัติ ทั้งที่ stock ไม่เคยถูกบันทึก (สถานะจริงในชีตยัง PENDING, memory store ก็หายเมื่อ restart)
- **สาเหตุ**: บรรทัด 43 `setDocumentStatus(decodedId, "POSTED")` ถูกเรียกทันทีหลัง authorize ก่อนที่จะรู้ว่า doc มีจริง/ตรวจสถานะ/เขียน movement สำเร็จ — ผลลัพธ์ override ทั้ง approvals route (บรรทัด 78 `const overrideStatus = getDocumentStatus(...)`) และ history route
- **วิธีเกิด**: 1) staff ส่งเอกสารที่ note มี lines ว่าง/เสียหาย 2) admin กดอนุมัติ → throw ที่บรรทัด 186 3) admin รีเฟรชหน้า /approvals → เอกสารหายจากแท็บรออนุมัติ (override เป็น POSTED) แต่ในชีตยัง PENDING และไม่มี movement เกิดขึ้น 4) แก้ข้อมูลไม่ได้เพราะ UI คิดว่าเสร็จแล้ว
- **หลักฐาน**: การอ่านโค้ด approve route + ผู้อ่าน override ทั้งสองไฟล์ตามด้านบน
- **Prompt แก้ไข**:
```
แก้ลำดับการ set สถานะ in-memory ใน approve route ของ C:\Stockify\stockify-app

ไฟล์: src/app/api/approvals/[id]/approve/route.ts
- ลบ `setDocumentStatus(decodedId, "POSTED");` ที่บรรทัด 43 ออก (เก็บไว้เฉพาะจุดที่ยืนยันความสำเร็จแล้วเท่านั้น)
- เรียก setDocumentStatus(doc.document_id, "POSTED") + setDocumentStatus(doc.document_no, "POSTED") เฉพาะ (ก) สาขา reconciliation ที่บรรทัด 128-129 (มีอยู่แล้ว) และ (ข) หลัง `repo.documents.updateStatus(doc.document_id, "POSTED")` สำเร็จที่บรรทัด ~204
- ห้ามแตะ logic reconciliation บรรทัด 121-149, การ lock, และการ sync warehouseSync

เงื่อนไขที่ต้องไม่พัง: กดอนุมัติซ้ำต้องยังได้ conflict "เอกสารนี้ถูกอนุมัติไปแล้ว", หน้า /approvals กับ /movements/receive/history ต้องยังอ่านสถานะอัปเดตทันทีหลังอนุมัติสำเร็จ
หลังแก้: รัน `npm run typecheck` และ `npx jest __tests__/idempotency.test.ts __tests__/recovery-journal.test.ts --config jest.config.js --runInBand` (และทดสอบมือ: approve → 500 → เอกสารต้องยังอยู่แท็บ PENDING)
```
- **หมายเหตุจาก lead**: อาการคล้ายกัน (approve fail แล้วรายการหายจากคิว) พบซ้ำในฝั่ง transfer ที่ BUG-C2 — แนะนำแก้ทั้งคู่พร้อมกันเพื่อให้พฤติกรรม "อนุมัติล้มเหลว = รายการกลับมาคิว" สอดคล้องทั้งระบบ

#### BUG-A6: PIN-login ตีความ `warehouse_access` รูปแบบเก่า (`"*"` / comma-string) ไม่ได้ → พนักงานโดน 403 ทุกโกดัง ต่างจาก password-login
- **ความรุนแรง**: Medium
- **จุดเกิด**: `src/app/api/auth/qr-login/route.ts:115-125` — เทียบ `src/lib/auth.ts:68-84` (password login), `src/lib/api-response.ts:62-98` (`getAccessibleWarehouseIds`), `src/app/(dashboard)/users/page.tsx:114` (หลักฐานว่ารูปแบบ `"*"` มีอยู่จริง)
- **อาการ**: พนักงานที่ช่อง warehouse_access ในชีตเก็บค่า `*` หรือ `WH01,WH02` จะล็อกอินด้วย PIN แล้วได้ `warehouse_access: []` ว่างเปล่า → เจอ 403 "คุณไม่มีสิทธิ์เข้าถึง...โกดัง" ทุกโกดังบน endpoint ที่เช็คสิทธิ์ (issue/move) แต่ถ้าล็อกอินด้วยอีเมล/พาสเวิร์ดด้วยบัญชีเดียวกันกลับได้สิทธิ์ถูกต้อง — พฤติกรรมต่างกันตามวิธีล็อกอิน
- **สาเหตุ**: ใน qr-login บรรทัด 117 `const parsed = JSON.parse(targetUser.warehouse_access);` — `JSON.parse("*")` และ `JSON.parse("WH01,WH02")` throw SyntaxError เสมอ จึงตกไป catch บรรทัด 123-124 `warehouseAccess = targetUser.role === "ADMIN" ? ["*"] : [];` ส่วนเงื่อนไข `else if (parsed === "*")` บรรทัด 120 คือ dead code (ไม่มีทางถึง) — ขณะที่ auth.ts บรรทัด 78-83 ใน catch ใช้ fallback `split(",")` ทำให้รูปแบบเก่ายังทำงาน และฝั่ง authorize จริง (`getAccessibleWarehouseIds`) รองรับทั้ง `"*"`, `'["*"]'`, JSON array และ comma-string — login เท่านั้นที่แคบกว่า
- **วิธีเกิด**: 1) ผู้ดูแลตั้ง warehouse_access ของพนักงานเป็น `*` หรือ `WH01,WH02` 2) พนักงานสแกน QR หน้าโกดัง กรอก PIN 3) session ที่ได้มี warehouse_access ว่าง 4) เรียก flow ที่ authorize ตามโกดัง → 403 ทั้งที่ควรมีสิทธิ์
- **หลักฐาน**: การอ่านโค้ดหลายไฟล์ตามด้านบน (สอง path login ให้ผลต่างกันกับ input เดียวกัน)
- **Prompt แก้ไข**:
```
ปรับ parse warehouse_access ของ PIN login ให้ใช้ helper เดียวกับระบบสิทธิ์

ไฟล์: src/app/api/auth/qr-login/route.ts บรรทัด 115-125
- แทน JSON.parse + catch เดิมด้วยการเรียก getAccessibleWarehouseIds(targetUser.warehouse_access) จาก src/lib/api-response.ts (รองรับ "*", '["*"]', JSON array และ comma-separated อยู่แล้ว) — ถ้า result เป็น null ให้ตั้ง warehouseAccess = ["*"] สำหรับ role ที่อนุญาต และ [] เมื่อไม่มีสิทธิ์ เพื่อให้ความหมายตรงกับ password login (auth.ts บรรทัด 64-84) และตรงกับ hasWarehouseAccess ตอน authorize
- ห้ามแตะ checkPinMatch, rate limit, หรือการออก token

เงื่อนไขที่ต้องไม่พัง: ผู้ใช้ที่ warehouse_access เป็น array JSON ปกติ (เช่น ["wh-01"]) ต้องได้ผลเหมือนเดิม, ADMIN ยังได้ ["*"], auth-session.ts decode ต้องยังอ่าน token ได้
หลังแก้: รัน `npm run typecheck` และ `npx jest __tests__/apps-script-auth.test.ts __tests__/security.test.ts --config jest.config.js --runInBand`
```
- **หมายเหตุ**: รวมรายงานเดิม BUG-A6 (จาก Tester A) และ BUG-B9 (จาก Tester B) ซึ่งเป็นปัญหาเดียวกัน

#### BUG-A7: หน้า success บอกพนักงานว่า "รับสินค้าสำเร็จ" ทั้งที่เอกสารยัง PENDING และสต็อกยังไม่เข้าโกดัง
- **ความรุนแรง**: Medium
- **จุดเกิด**: `src/app/(dashboard)/movements/receive/_components/ReceiveSuccessCard.tsx:22-25` กับ `src/app/(dashboard)/movements/receive/_hooks/use-receive-movement.ts:529-536` (เทียบข้อความจริงจาก API ที่ `src/app/api/movements/receive/route.ts:45`)
- **อาการ**: พนักงานกดยืนยันแล้วเห็นการ์ดใหญ่ "รับสินค้าสำเร็จ / เอกสารรับสินค้าถูกบันทึกเรียบร้อยแล้ว" — ไม่มีคำว่า "รออนุมัติ" พนักงานจึงเข้าใจว่าของเข้าระบบแล้ว (ทั้งที่ต้องรอ admin กดอนุมัติก่อน stock ถึงจะเข้า และอาจถูก reject)
- **สาเหตุ**: hook บรรทัด 530-536 แค่ `if (json.success) { ... setSubmitted(true); setConfirmModalOpen(false); }` — ทิ้ง `json.message` ที่ API ส่งมา ("ส่งรายการรับสินค้าไปรออนุมัติสำเร็จ (สถานะ: รอดำเนินการ)") แล้วไป render ReceiveSuccessCard ที่ hardcode ข้อความ "รับสินค้าสำเร็จ"
- **วิธีเกิด**: staff รับของจบรอบ → เห็นการ์ดสำเร็จ → แจ้งหัวหน้า/ฝ่ายขายว่า "ของเข้าแล้ว" → ตามไปดู stock ยังไม่ขึ้น งงว่าระบบหาย
- **หลักฐาน**: การอ่านโค้ดตามด้านบน
- **Prompt แก้ไข**:
```
แก้ข้อความหน้าสำเร็จของ flow รับเข้าให้สื่อสถานะรออนุมัติ

ไฟล์: src/app/(dashboard)/movements/receive/_hooks/use-receive-movement.ts
- เพิ่ม state เช่น const [successMessage, setSuccessMessage] = useState<string>(""); แล้วใน onSubmit สาขา json.success (บรรทัด ~530) ให้ setSuccessMessage(json.message || "ส่งรายการรับสินค้าไปรออนุมัติแล้ว") ก่อน setSubmitted(true)
- เพิ่ม successMessage ใน props ของ ReceiveSuccessCard และใน return ของ hook

ไฟล์: src/app/(dashboard)/staff/receive/page.tsx บรรทัด 70-72
- ส่ง successMessage ให้ <ReceiveSuccessCard ... />

ไฟล์: src/app/(dashboard)/movements/receive/_components/ReceiveSuccessCard.tsx
- เปลี่ยน h2 "รับสินค้าสำเร็จ" เป็น "ส่งรายการรับสินค้าแล้ว" และเพิ่มแถบเตือนเหลือง/ฟ้า: "เอกสารอยู่สถานะ รออนุมัติ — ยอดสต็อกจะเข้าโกดังหลังผู้ดูแลอนุมัติ" (แสดง successMessage ที่ส่งมาด้วยถ้ามี)

เงื่อนไขที่ต้องไม่พัง: ปุ่ม "เริ่มรับรายการใหม่" (resetForm), การลบ draft ใน localStorage, การใช้งานจากหน้า /movements/receive เดิม
หลังแก้: รัน `npm run typecheck`
```

#### BUG-B5: syncMove / applyChanges กลืนทุก error แบบเงียบ → API ตอบ "สำเร็จ" แต่ข้อมูลจริงไม่ถูกซิงก์
- **ความรุนแรง**: Medium
- **จุดเกิด**: `src/lib/repositories/sheets/warehouse-sync.sheets-repository.ts:412-415`, `src/lib/repositories/sheets/stock-summary.repository.ts:113-118, 120-122`
- **อาการ**: พนักงานเห็น "จัดตำแหน่งสินค้าสำเร็จ!" แต่ชีตกายภาพ (sheet ของโกดัง) หรือ Stock_Summary ไม่ถูกอัปเดต — ยอดหน้าจอ/รายงานเพี้ยนจนกว่าจะ rebuild และไม่มี log ใดถึงผู้ใช้
- **สาเหตุ**: syncMove จบด้วย `catch (e) { console.error("[SheetsWarehouseSync] syncMove error:", e); }` (กลืนหมด) และ applyChanges มี `batchUpdateRows(...).catch(() => {})` / `appendRows(...).catch(() => {})` บวก catch นอกสุดแค่ `console.warn` — failure ไม่กระจายกลับไปให้ executor ทำ `failIdempotencyKey` หรือ rollback
- **วิธีเกิด**: quota Sheets ชั่วคราว/timeout ระหว่างพนักงานกดยืนยัน → movements ถูก append แต่ summary/ชีตโกดังพลาด → response 201 ปกติ
- **หลักฐาน**: อ่านโค้ด (quote ข้างบน); `__tests__/concurrency-and-durability.test.ts` test#5 ใช้ mock repo ที่ throw จริงจึงไม่เห็นพฤติกรรมกลืน error ของ Sheets repo ตัวจริง
- **Prompt แก้ไข**:
```
แก้การกลืน error:
1) src/lib/repositories/sheets/stock-summary.repository.ts บรรทัด 113-118: ลบ .catch(() => {}) ทั้งสองจุด และบรรทัด 120-122 เปลี่ยนจาก console.warn เป็น throw (ให้ caller จัดการ)
2) src/lib/repositories/sheets/warehouse-sync.sheets-repository.ts บรรทัด 412-415: อย่ากลืน — ให้ syncMove คืน boolean/throw แล้วที่ src/lib/services/stock/move-stock.ts บรรทัด 122-131 บันทึกผลลง journal/audit เป็น outcome "SYNC_FAILED" และแนบ warning ใน response (หรือถ้าต้องการให้ move ยังสำเร็จ ให้บันทึก recovery task แทน console.error เฉย ๆ)
เงื่อนไขที่ต้องไม่พัง: ทรานแซกชันปกติต้องสำเร็จเหมือนเดิม, idempotency/journal ต้องยังทำงาน (failIdempotencyKey ต้องได้รับ error จริงเมื่อ persistence ล้มเหลว), __tests__/concurrency-and-durability.test.ts test#5 ต้องผ่าน
หลังแก้: รัน npm run typecheck และ npx jest __tests__/concurrency-and-durability.test.ts __tests__/recovery-journal.test.ts --config jest.config.js --runInBand
```

#### BUG-B6: สแกน QR โกดังตอน step 2 สลับโกดังทันที แต่ไม่ reset สินค้า/ต้นทาง/จำนวนของโกดังเดิม
- **ความรุนแรง**: Medium
- **จุดเกิด**: `src/app/(dashboard)/movements/move/_hooks/use-move-movement.ts:159-171` (detect ก่อนเช็ค step), `77-81` (useEffect แค่อัปเดต warehouse_id)
- **อาการ**: พนักงานอยู่ step 2 (เลือกสินค้า/จำนวนของโกดัง 1 ค้างไว้) แล้วสแกน QR โกดัง (เช่นป้าย "โกดัง2" หรือ URL `/w/wh-02`) → ระบบสลับเป็นโกดัง 2 พร้อมข้อความ "✓ สลับโกดัง" แต่ product_id, from_location_id, qty ยังเป็นของโกดัง 1 → กดย้ายต่อ = ย้ายของในโกดัง 2 ด้วยข้อมูลหลอก (ถ้า SKU ชื่อเดียวกันมีในโกดัง 2 และ getBalance fuzzy ผ่าน จะย้ายของโกดัง 2 ได้จริง)
- **สาเหตุ**: ใน `handleScanBarcode` บล็อก detectWarehouseCode ทำงานก่อนเช็ค `step` (L159-171 มาก่อน L176/L239) และไม่มี effect ใด reset form (`product_id/from_location_id/to_location_id/qty/step`) เมื่อ `activeWhId` เปลี่ยน — useEffect ที่ L77-81 set แค่ค่า warehouse_id ในฟอร์ม
- **วิธีเกิด**: 1) step 2 ค้างอยู่ 2) สแกน QR ป้ายโกดังที่ติดอยู่แถวนั้น 3) จอบอกสลับโกดังสำเร็จ 4) สแกนชั้นปลายทางของโกดังใหม่ กดย้าย → document สร้างในโกดังใหม่ด้วยสินค้า/ต้นทางของโกดังเก่า
- **หลักฐาน**: อ่านโค้ด — ลำดับบรรทัดด้านบน; ไม่มี `useEffect` ใด reset ฟอร์มตาม activeWhId ในไฟล์เดียวกัน
- **Prompt แก้ไข**:
```
ที่ src/app/(dashboard)/movements/move/_hooks/use-move-movement.ts:
1) เพิ่ม useEffect ติดตาม activeWhId: เมื่อค่าเปลี่ยน ให้ reset สถานะ flow กลับ step 1 และ setValue เป็นค่าว่าง (product_id:"", from_location_id:"", to_location_id:"", qty:"") พร้อม setScanFeedback แจ้ง "สลับโกดังแล้ว กรุณาสแกนสินค้าใหม่"
2) หรืออย่างน้อยใน handleScanBarcode บรรทัด 160-171: ถ้า detectedWh !== activeWhId และ watchProduct มีค่า ให้ reset ก่อน setActiveWhId
เงื่อนไขที่ต้องไม่พัง: การสแกน QR โกดังตอน step 1 (ยังไม่เลือกสินค้า) ต้องสลับได้ลื่นเหมือนเดิม, staff/move รับ wh จาก URL ครั้งแรกต้องไม่โดน reset เป็นข้อความเตือน, รัน npm run typecheck
```

#### BUG-B7: fuzzy product match (includes + API fallback หยิบตัวแรก) เสี่ยงย้าย "สินค้าผิด" โดยไม่มีการยืนยัน
- **ความรุนแรง**: Medium
- **จุดเกิด**: `src/app/(dashboard)/movements/move/_hooks/use-move-movement.ts:93-99 (fallback includes), 194-207 (API fallback list[0]), 389 (ส่ง selectedProduct ไป API)`
- **อาการ**: พนักงานสแกนบาร์โค้ดสินค้าที่ยังไม่ลงทะเบียน/สแกนพลาด → ระบบไปจับคู่แบบ "มีคำใดซ้อนอยู่ใน SKU/ชื่อ/บาร์โค้ดของสินค้าอื่น" หรือหยิบผลค้นหาตัวแรกจาก API มาเป็นสินค้าที่เลือก แล้วอัตโนมัติใส่ from/qty ของสินค้านั้น → กดย้ายได้เลย โดยจอแสดงเป็นชื่อสินค้าที่ผิดอย่างเดียวโดยไม่มี step ยืนยันตัวตนสินค้า
- **สาเหตุ**:
  ```ts
  (products || []).find(
    (p) =>
      (p.barcode && p.barcode.trim().toLowerCase().includes(cleanSearchVal)) || ...
  ) || null;   // L93-99
  ```
  และใน handleScanBarcode L196-202: `matched = list[0];` จาก `/api/products?search=...` — บาร์โค้ดสั้น/ซ้ำบางส่วน (เช่น 88500 อยู่ใน 8850001) จับคู่สินค้าแรกที่เจอ
- **วิธีเกิด**: 1) สแกนสินค้าใหม่ที่ยังไม่มีในระบบ (ขึ้น "ไม่พบสินค้า" ถ้าไม่ fuzzy เจอ) หรือสแกนบาร์โค้ดที่เป็น substring ของสินค้าอื่น 2) ระบบจับคู่ให้เองแบบเงียบ แสดง ✓ สแกนสำเร็จ (สินค้าผิด) 3) พนักงานไม่อ่านชื่อ — กดถัดไป ย้ายจริง
- **หลักฐาน**: อ่านโค้ด (quote ด้านบน); ไม่มีเทสฝั่ง UI
- **Prompt แก้ไข**:
```
ที่ src/app/(dashboard)/movements/move/_hooks/use-move-movement.ts:
1) บรรทัด 93-99: ตัด fallback includes สำหรับ "บาร์โค้ด/SKU" ออก (เก็บไว้เฉพาะ product_name เพื่อค้นหาด้วยมือ) หรือบังคับความยาวขั้นต่ำของ cleanSearchVal (เช่น >= 6 ตัวอักษร) ก่อนอนุญาต substring match
2) บรรทัด 194-207: ถ้า list.length > 1 ห้ามหยิบ list[0] เงียบ ๆ — ให้แสดง scanFeedback แบบ warning "พบหลายรายการ กรุณาเลือกเอง" และไม่ setValue product_id
เงื่อนไขที่ต้องไม่พัง: การสแกนบาร์โค้ดตรงตัว (exact) ต้องทำงานเหมือนเดิมรวมกรณี API คืน 1 รายการ, ProductSearchInput ที่พิมพ์ค้นหาต้องยังใช้ได้, รัน npm run typecheck
```

#### BUG-C4: พนักงานเบิกสินค้า (WAREHOUSE_STAFF) ปิดงานเองได้โดยข้ามการอนุมัติผ่าน endpoint /complete
- **ความรุนแรง**: Medium
- **จุดเกิด**: `src/lib/security/permissions.ts:84` (WAREHOUSE_STAFF มี `STOCK_TRANSFER_COMPLETE`), `src/app/api/movements/transfer/[id]/complete/route.ts:44-49` (ไม่มี role gate นอกจาก authorize), `src/lib/services/stock/transfer-stock.ts:313-320` (ยอม complete จาก PENDING ได้)
- **อาการ**: พนักงานที่ถูกมอบหมาย (หรือผู้ที่ทำตัวเป็น assignee) ยิง POST `/api/movements/transfer/{id}/complete` ตรง ๆ ได้เลย สต๊อกถูกหัก/ย้ายทันทีโดยที่ผู้อนุมัติ (APPROVER/ADMIN) ไม่ได้เห็นหรือกดอนุมัติเลย — เอกสาร PENDING ก็ complete ได้
- **สาเหตุ**: ระบบสิทธิ์ให้ WAREHOUSE_STAFF มี `PERMISSIONS.STOCK_TRANSFER_COMPLETE`; route /complete ไม่ได้กำหนดว่าต้องเป็น ADMIN/MANAGER/APPROVER (ต่างจาก /approve ที่มี role gate ที่บรรทัด 22-24); และ `completeTransfer` มีเฉพาะ guard "COMPLETED → return, CANCELLED/REJECTED → throw" แต่ไม่เคย require สถานะ WAITING_APPROVAL (PENDING ผ่านหมด)
- **วิธีเกิด**: พนักงานล็อกอิน PIN → เปิด devtools/Postman → POST `/api/movements/transfer/{docId}/complete` พร้อม cookie session ตัวเอง → 200 OK, สต๊อกหักทันที, เอกสาร COMPLETED → ผู้อนุมัติไม่เคยเห็นงานนี้ในคิว
- **หลักฐาน**: อ่านโค้ด; jest มี test "staff ต้องมี access โกดังปลายทางถึง complete ได้" (transfer-stock.test.ts test 2-3) ยืนยันว่า staff complete เองได้เมื่อมี access — ไม่มี test กัน "complete ก่อนอนุมัติ"
- **Prompt แก้ไข**:
```
ตัดสินใจเชิงนโยบายให้ชัดแล้วแก้ตาม: ถ้า flow มาตรฐานต้องผ่านอนุมัติเสมอ —
1) src/lib/security/permissions.ts:79-88: ถอด PERMISSIONS.STOCK_TRANSFER_COMPLETE ออกจากบทบาท WAREHOUSE_STAFF และ STAFF
2) src/app/api/movements/transfer/[id]/complete/route.ts: เพิ่ม role gate เหมือน /approve (บรรทัด 22-24) — อนุญาตเฉพาะ ADMIN/MANAGER/APPROVER
3) src/lib/services/stock/transfer-stock.ts completeTransfer (บรรทัด 313-320): เพิ่ม guard ว่าสถานะต้องเป็น WAITING_APPROVAL เท่านั้น (PENDING → throw InvalidTransferStateError ข้อความไทย "กรุณารอพนักงานยืนยันการย้ายก่อนอนุมัติ") ยกเว้นผู้เรียกเป็น ADMIN
เงื่อนไขที่ต้องไม่พัง: flow express ถ้ายังต้องการให้ staff complete ได้ ให้สร้าง permission แยก เช่น STOCK_TRANSFER_COMPLETE_SELF พร้อม flag ในเอกสาร; jest transfer-stock.test.ts test 3 ("Destination staff can complete...") จะต้องปรับตามนโยบายใหม่
หลังแก้: รัน `npm run typecheck` และ `npx jest __tests__/transfer-stock.test.ts __tests__/security-authorization.test.ts --config jest.config.js --runInBand`
```

#### BUG-C5: endpoint /submit และ /progress ไม่ตรวจสิทธิ์ role เลย — ใครก็ได้ (แม้แต่ VIEWER) ส่งงาน/แย่งงาน/แก้ step ได้
- **ความรุนแรง**: Medium
- **จุดเกิด**: `src/app/api/movements/transfer/[id]/submit/route.ts:16-19`, `src/app/api/movements/transfer/[id]/progress/route.ts:17-19`, `src/lib/services/stock/transfer-stock.ts:258-259`
- **อาการ**: (a) user ที่ล็อกอินด้วย role ใดก็ได้ (รวม VIEWER ที่ควรอ่านอย่างเดียว) เรียก `/submit` เพื่อส่งใบย้ายเข้าคิวอนุมัติ และ `submitTransferMove` จะ**เขียนทับ `assigned_to_user_id` เป็นคนกด submit** (transfer-stock.ts:259 `meta.assigned_to_user_id = input.userId || "";`) ทำให้แย่งงานของพนักงานคนอื่นได้ (b) เรียก `/progress` แก้ `current_step` ของใบงานใครก็ได้ และถ้า note เดิมเป็น plain text (legacy) progress route จะ parse ไม่ได้ → `meta = {}` → `updateNote(JSON.stringify(meta))` **ทับ note เดิมหายทั้งหมด** (progress/route.ts:33-45)
- **สาเหตุ**: ทั้งสอง route มีแค่ `createActorFromSession` + `if (!actor) unauthorized` — ไม่มี `authorize()` หรือเช็ค role ต่อ; VIEWER ไม่มี permission ใดกันไว้เพราะไม่มีการเรียก authorize เลย
- **วิธีเกิด**: VIEWER ล็อกอิน → POST `/api/movements/transfer/{id}/submit` → งานของพนักงาน A ถูกเปลี่ยนเป็นของ VIEWER และสถานะเด้ง WAITING_APPROVAL ทั้งที่ไม่มีใครย้ายของจริง → ผู้อนุมัติกดอนุมัติ → หักสต๊อกตาม meta เดิมโดยไม่มีใครตรวจของ
- **หลักฐาน**: อ่านโค้ด (security-authorization.test.ts ทดสอบแค่ authorize() ที่ layer ตัวเอง ไม่ได้ทดสอบ route นี้)
- **Prompt แก้ไข**:
```
1) src/app/api/movements/transfer/[id]/submit/route.ts: หลังบรรทัด 19 เพิ่มกัน role ที่ไม่ควรทำงานภาคสนาม เช่น `if (actor.role === "VIEWER") return forbiddenResponse("ผู้ใช้งานแบบดูอย่างเดียวไม่สามารถส่งงานย้ายสินค้าได้");` และใน submitTransferMove (transfer-stock.ts:250-259) ให้เขียนทับ assigned_to_user_id เฉพาะเมื่อเอกสารยังไม่มีผู้รับมอบหมาย หรือผู้เรียกเป็น assignee เดิม/ADMIN (อย่าให้ user อื่นแย่งโดย default)
2) src/app/api/movements/transfer/[id]/progress/route.ts: เพิ่ม guard บล็อก VIEWER และก่อน updateNote ให้เก็บ original_note ไว้เมื่อ note เดิมไม่ใช่ JSON (อย่าทับด้วย object เปล่า — เช่น `if (!doc.note.trim().startsWith("{")) meta.original_note = doc.note;`)
เงื่อนไขที่ต้องไม่พัง: staff ปกติ submit/อัปเดต step ได้ตามเดิม, UI (updateTransferTaskProgress) ต้องยัง sync ได้
หลังแก้: รัน `npm run typecheck`
```

#### BUG-C6: race approve vs cancel/reverse — lock key ไม่ normalize และเช็ค "alreadyReversed" อยู่นอก lock
- **ความรุนแรง**: Medium
- **จุดเกิด**: `src/lib/locking/stock-lock.ts:11-14`, `src/lib/services/stock/transfer-stock.ts:864,881-884` (cancel) เทียบกับ `:371,572-573` (complete), `src/lib/services/stock/reverse-stock.ts:40-48`
- **อาการ**: กรณีข้อมูลใน meta ใช้รูปแบบ id ไม่ตรงกัน (เช่น `wh-1` กับ `wh-01`, หรือ `from_location_id` ที่ UI ส่งมาต่างจาก meta) approve กับ cancel ที่ยิงพร้อมกันจะได้ lock key ต่างกัน (`warehouse:wh-1:...` vs `warehouse:wh-01:...`) จึงไม่ exclude กัน → ทั้งสองทำงานสำเร็จพร้อมกัน สถานะสุดท้ายอาจเป็น CANCELLED ทั้งที่สต๊อกเพิ่งถูกย้าย+คืน (หรือ COMPLETED ทั้งที่ reverse ทำงานไปแล้ว) และแถว Express sheets ถูก append ไปแล้ว ส่วน reverseStock ตรง ๆ ก็เช็ค `alreadyReversed` **ก่อน**เข้า `executeAtomicOperation` (reverse-stock.ts:41-48 vs 62) สอง request คนละ idempotency_key ที่ยิงพร้อมกันจะผ่านเช็คพร้อมกันแล้วกลับยอดซ้ำสองรอบ
- **สาเหตุ**: `formatStockLockKey` แค่ `trim().toLowerCase()` (stock-lock.ts:11-14) ไม่เรียก `normalizeWarehouseId` ขณะที่ `completeTransfer` normalize (transfer-stock.ts:371-372) แต่ `cancelTransfer` ใช้ meta ดิบ `const fromWh = meta.from_warehouse_id || "wh-01";` (transfer-stock.ts:864)
- **วิธีเกิด**: Admin เปิดสองแท็บ: แท็บ A กด "อนุมัติ" (approve), แท็บ B กด "ปฏิเสธ/ยกเลิก" (cancel) เกือบพร้อมกันบนใบงานที่ meta เก็บ `wh-1` → ทั้งคู่สำเร็จ → เอกสารจบสถานะ CANCELLED แต่มีการ append แถว Express และสต๊อกวิ่งไป-กลับ
- **หลักฐาน**: อ่านโค้ด (jest ไม่มี concurrency test ข้าม approve/cancel)
- **Prompt แก้ไข**:
```
1) src/lib/locking/stock-lock.ts formatStockLockKey (บรรทัด 11-14): normalize warehouseId ด้วย normalizeWarehouseId (จาก @/lib/warehouse-utils) ก่อนสร้าง key เพื่อให้ wh-1 === wh-01
2) src/lib/services/stock/transfer-stock.ts cancelTransfer บรรทัด 864-865 + lockKeys 881-884: normalize fromWh/toWh และตำแหน่งด้วยกลไกเดียวกับ completeTransfer (ใช้ normalizeWarehouseId + logic เลือก location แบบเดียวกับ finalFromLocId บรรทัด 499)
3) src/lib/services/stock/reverse-stock.ts: ย้ายการเช็ค alreadyReversed (บรรทัด 40-48) ให้ทำซ้ำภายใน execute callback (หลังได้ lock, บรรทัด 73) ด้วย
เงื่อนไขที่ต้องไม่พัง: jest transfer-stock/reverse-stock/atomic-stock-operations ทั้งหมดต้องผ่าน, กัน deadlock — withStockLocks มี sortLockKeys ให้แล้ว อย่าเปลี่ยนลำดับ acquire เอง
หลังแก้: รัน `npm run typecheck` และ `npx jest __tests__/transfer-stock.test.ts __tests__/reverse-stock.test.ts __tests__/atomic-stock-operations.test.ts --config jest.config.js --runInBand`
```

#### BUG-C7: UI สร้าง idempotency_key ใหม่ทุกครั้งที่กดสร้างใบเบิก — ป้องกันใบซ้ำไม่ได้เมื่อ retry
- **ความรุนแรง**: Medium
- **จุดเกิด**: `src/app/(dashboard)/movements/transfer/_hooks/use-transfer-movement.ts:1195-1205`
- **อาการ**: Admin กด "สร้างใบเบิกสินค้า" แล้ว network หมดเวลา/ช้า → กดซ้ำ → ได้ใบเบิกซ้ำ 2 ใบสำหรับสินค้าเดียวกัน (request แรกสำเร็จจริงบน server แต่ response ไม่มาถึง) เพราะแต่ละ attempt ใช้ key ใหม่เสมอ
- **สาเหตุ**: โค้ด comment ไว้ชัด `// Always generate a fresh unique idempotency base key on every submission attempt to prevent key conflict` → `const baseIdemKey = uuidv4();` และต่อ item `const itemKey = \`trf-${baseIdemKey}-${i}-${Date.now()}\`;` — ทำให้กลไก idempotency ฝั่ง server (`claimIdempotencyKey`) ไม่มีทางเจอ key เดิมใน retry
- **วิธีเกิด**: Admin กรอกใบเบิก 10 ชิ้น → กดบันทึก → internet กระตุก → alert/กดซ้ำ → ตรวจ "ประวัติเบิกสินค้า" เจอใบ TRF สองใบ qty 10 ชิ้นเหมือนกัน
- **หลักฐาน**: อ่านโค้ด
- **Prompt แก้ไข**:
```
src/app/(dashboard)/movements/transfer/_hooks/use-transfer-movement.ts ฟังก์ชัน onSubmit (บรรทัด 1195-1205):
1) สร้าง baseIdemKey ครั้งเดียวต่อ "ชุดข้อมูลที่กำลังส่ง" (เช่น เก็บใน useRef แล้ว regenerate เฉพาะเมื่อผู้ใช้แก้รายการ/กด reset ผ่าน resetForm) ไม่ใช่ต่อ attempt และตัด `-${Date.now()}` ออกจาก itemKey
2) เมื่อ request fail ด้วย IdempotencyConflictError/IdempotencyInProgressError (ข้อความจาก src/lib/idempotency/idempotency.service.ts:55-65) ให้แจ้งผู้ใช้ว่า "รายการถูกบันทึกไปแล้วหรือกำลังประมวลผล" แทนการสร้าง key ใหม่
เงื่อนไขที่ต้องไม่พัง: การสร้างหลาย items ในครั้งเดียว (Promise.all) ต้องยังได้ key ต่อ item ไม่ซ้ำกัน; server-side zod มี default key ให้อยู่แล้ว (types/api.ts:198) ต้องไม่พัง
หลังแก้: รัน `npm run typecheck`
```

---

## ⚪ LOW

#### BUG-A8: ข้อความ error ที่ผู้ใช้เห็นเป็น technical/raw — เช่น "lines.0.qty: จำนวนต้องมากกว่า 0" หรือ "Failed to fetch"
- **ความรุนแรง**: Low
- **จุดเกิด**: `src/app/api/movements/receive/route.ts:22-24` + `src/app/(dashboard)/movements/receive/_hooks/use-receive-movement.ts:537-542`
- **อาการ**: กล่อง error สีแดงบนหน้า /staff/receive แสดงข้อความแบบ `lines.0.qty: จำนวนต้องมากกว่า 0` (path ของ zod ต่อท้าย) หรือถ้าเน็ตหลุดแสดง raw `err.message` ภาษาอังกฤษ เช่น "Failed to fetch" ทั้งที่ทั้งหน้าเป็นภาษาไทย
- **สาเหตุ**: route บรรทัด 23 `const msg = issues.map((i) => \`${i.path.join(".")}: ${i.message}\`).join(", ");` เอา zod path มาโชว์ตรง ๆ (ระบบมี `stock-error-mapper.ts` แต่ route นี้ไม่ได้ใช้ ต่างจาก issue route ที่ใช้ `mapStockErrorToResponse`) — ส่วน hook บรรทัด 541 `const msg = err instanceof Error ? err.message : ...` โชว์ message ดิบของ browser
- **วิธีเกิด**: 1) staff ยิงผ่านกรณีที่ client gate พลาด (เช่น BUG-A1 ทำ qty/location คลาดเคลื่อน) หรือเน็ตหลุดกลางทาง 2) กล่องแดงโชว์ technical message 3) พนักงานไม่เข้าใจว่าต้องแก้อะไร
- **หลักฐาน**: การอ่านโค้ดตามด้านบน
- **Prompt แก้ไข**:
```
ทำข้อความ error ของ receive API ให้เป็นมิตรภาษาไทย

1) ไฟล์ src/app/api/movements/receive/route.ts บรรทัด 20-25:
   - แทนการ join zod path ตรง ๆ ด้วยการ map เป็นข้อความไทยโดยไม่มี prefix path เช่น ใช้ first issue: const first = issues[0]; แล้วแปลง path เป็นคำอ่านไทย (lines → รายการที่ N, qty → จำนวน, warehouse_id → โกดัง) หรือใช้ mapStockErrorToResponse จาก @/lib/services/stock แบบ issue route ถ้าครอบ ValidationError ได้
2) ไฟล์ src/app/(dashboard)/movements/receive/_hooks/use-receive-movement.ts บรรทัด 540-543:
   - ใน catch: ถ้า err instanceof TypeError หรือ message เป็นภาษาอังกฤษเชิงเทคนิค ("Failed to fetch", "NetworkError") ให้ setError("เน็ตขัดข้อง กรุณาตรวจสอบอินเทอร์เน็ตแล้วกดยืนยันอีกครั้ง — รายการเดิมยังอยู่ครบ") ห้ามโชว์ err.message ดิบ

เงื่อนไขที่ต้องไม่พัง: การ retry หลัง error ต้องยังใช้ idempotency_key เดิม, ข้อความจาก API ฝั่ง server (เช่น idempotency ซ้ำ) ต้องยังแสดงตรงตามเดิม
หลังแก้: รัน `npm run typecheck` และ `npx jest __tests__/receive-stock.test.ts --config jest.config.js --runInBand`
```

#### BUG-A9: heuristic ตัดสิน "รหัสตำแหน่ง" ด้วย regex กว้างเกิน → บาร์โค้ดสินค้าที่ไม่รู้จักบางรูปแบบถูกตีเป็นตำแหน่งแล้วเขียนทับ/เผื่อตำแหน่งให้บรรทัดอื่น
- **ความรุนแรง**: Low
- **จุดเกิด**: `src/app/(dashboard)/movements/receive/_hooks/use-receive-movement.ts:335-341`
- **อาการ**: staff สแกนบาร์โค้ดสินค้าที่ยังไม่มีในระบบที่รูปแบบคล้ายรหัสชั้น (เช่น `12ab`, `a12`, `ab-123`) → ระบบไม่ได้บอก "ไม่พบในระบบ" แต่ตอบ "บันทึกตำแหน่งแล้ว [12AB]" แล้วเขียนลงบรรทัดแรกที่ยังไม่มีตำแหน่ง ทำให้ของถูกผูกตำแหน่งผิดโดยไม่รู้ตัว
- **สาเหตุ**: บรรทัด 337-341 `isExplicitLocationPattern` ใช้ regex เช่น `/^[0-9]{1,2}[a-z]{1,4}[-_]?[0-9a-z\-_]*$/i` และ `/^[a-z]{1,4}[-_]?[0-9]{1,4}[a-z0-9\-_]*$/i` ซึ่ง match รหัสสินค้าทั่วไปได้ แล้วเข้าสาขา 343-421 ที่สร้าง location ปลอม + assign ให้บรรทัด
- **วิธีเกิด**: 1) รับของ SKU ใหม่ที่ยังไม่ได้ลง master บาร์โค้ด "a12" 2) สแกน → feedback เขียว "บันทึกตำแหน่งแล้ว [A12]" 3) staff ไม่ทันสังเกต ป้ายว่าเป็นตำแหน่ง ระบบก็ set location ให้บรรทัดที่ยังว่าง 4) เอกสารที่ส่งอนุมัติผูกสินค้าผิดกับตำแหน่ง
- **หลักฐาน**: การอ่านโค้ดตามด้านบน (รวมกับ BUG-A4 ที่ยอมรับ location ไม่รู้จัก)
- **Prompt แก้ไข**:
```
เข้มงวดการตีความบาร์โค้ดตำแหน่งใน use-receive-movement.ts ของ C:\Stockify\stockify-app

ไฟล์: src/app/(dashboard)/movements/receive/_hooks/use-receive-movement.ts บรรทัด 335-341
- ลด isExplicitLocationPattern ให้เหลือเฉพาะ (1) matchedLoc จาก master จริง และ (2) regex ที่ชัดเจนเชิงโครงสร้างขององค์กร เช่น /^(loc|shelf|rack|bin|slf)[-_/]/i เท่านั้น (ตัด generic /^[0-9]{1,2}[a-z].../ และ /^[a-z]{1,4}[-_]?[0-9].../ ออก)
- รหัสที่ไม่เข้าเงื่อนไขให้ fallback ไปสาขา "ไม่พบในระบบ" (บรรทัด 424-433) เสมอ

เงื่อนไขที่ต้องไม่พัง: การสแกน QR ชั้นวางจริงที่มี shelf_code/location_code ใน master (matchedLoc path บรรทัด 343-354 ต้องยังทำงาน), ฟังก์ชัน handleScanLocationForLine (ช่องสแกนเฉพาะตำแหน่ง) ไม่เกี่ยวกับ regex นี้และต้องยังเดิม
หลังแก้: รัน `npm run typecheck` และ `npx jest __tests__/barcode-utils.test.ts --config jest.config.js --runInBand`
```

#### BUG-A10: PIN พนักงานไม่ถูกบังคับให้ unique — PIN ซ้ำข้ามบัญชีจะล็อกอินเป็น "คนแรกที่เจอ" เสมอ
- **ความรุนแรง**: Low
- **จุดเกิด**: `src/app/api/auth/qr-login/route.ts:82-97` (เทียบ `src/types/api.ts:16` ที่ validate แค่รูปแบบ)
- **อาการ**: ถ้าพนักงานสองคนตั้ง PIN 4 หลักเดียวกัน (ชีตไม่มีการ enforce) คนที่สแกน QR จะเข้าสู่ระบบเป็นบัญชีแรกในลำดับชีตเสมอ — เอกสารรับเข้าถูกบันทึก `created_by` เป็นคนผิด รายงาน/audit เพี้ยน โดยไม่มีเตือนให้ผู้ดูแล
- **สาเหตุ**: บรรทัด 87-96 ลูปเก็บ `matchedUsers` ทั้งหมด แล้ว `if (uniqueMatchedUsers.length >= 1) targetUser = uniqueMatchedUsers[0];` — เช็คแค่ "มีอย่างน้อย 1" ไม่ได้เตือน/ปฏิเสธเมื่อซ้ำ (คอมเมนต์บรรทัด 81 อ้างว่า "identify by unique PIN" แต่ไม่มีการตรวจ uniqueness ทั้งใน CreateUser/UpdateUser ซึ่ง zod ตรวจแค่ `/^\d{4}$/`)
- **วิธีเกิด**: 1) ผู้ดูแลสร้างพนักงาน A และ B ตั้ง PIN 1111 ทั้งคู่ (ระบบไม่ block) 2) B สแกน QR หน้าโกดังกรอก 1111 3) ระบบพาเข้าเป็น A เงียบ ๆ 4) เอกสารรับทั้งหมดถูกโชว์เป็นของ A
- **หลักฐาน**: การอ่านโค้ดตามด้านบน
- **Prompt แก้ไข**:
```
กัน PIN ซ้ำในระบบพนักงานของ C:\Stockify\stockify-app

1) ไฟล์ src/app/api/auth/qr-login/route.ts บรรทัด 92-96:
   - ถ้า uniqueMatchedUsers.length > 1 ให้ return 400 ข้อความไทย "พบ PIN นี้ถูกใช้โดยพนักงานหลายคน กรุณาติดต่อผู้ดูแลระบบเพื่อแก้ไข PIN" (อย่าล็อกอินเป็นคนแรก)
2) ไฟล์ API สร้าง/แก้ผู้ใช้ (หา route ที่ใช้ CreateUserSchema/UpdateUserSchema เช่น src/app/api/auth/employees หรือ users): ก่อนบันทึก bcrypt hash ให้ตรวจว่าไม่มีพนักงาน active คนอื่นใช้ PIN เดียวกัน (เทียบ bcrypt.compareSync กับ pin_hash ของทุกคน หรือเก็บ column ช่วย) — ถ้าซ้ำให้ 400 ข้อความไทย
เงื่อนไขที่ต้องไม่พัง: ผู้ใช้ที่ PIN ไม่ซ้ำต้องล็อกอินได้ปกติ, การล็อกอินด้วย token ที่ระบุ employee_id ตรง ๆ (บรรทัด 71-79) ต้องยังทำงาน, rate limit เดิมคงอยู่
หลังแก้: รัน `npm run typecheck` และ `npx jest __tests__/apps-script-auth.test.ts --config jest.config.js --runInBand`
```

#### BUG-A11: draft ใน localStorage กลับมาจากโกดังอื่น — บรรทัดเก่าถูก restore ทับโกดังปัจจุบันโดยไม่เตือน
- **ความรุนแรง**: Low
- **จุดเกิด**: `src/app/(dashboard)/movements/receive/_hooks/use-receive-movement.ts:90-105` (restore) เทียบ `:118-125` (save พร้อม `warehouse_id: activeWhId`)
- **อาการ**: พนักงานค้างฟอร์มไว้ที่โกดัง 1 แล้ววันรุ่งขึ้นสแกน QR เข้าที่โกดัง 3 → เปิด /staff/receive แล้วรายการสินค้า/ตำแหน่งของโกดัง 1 โผล่มาในฟอร์มของโกดัง 3 โดยไม่มีคำเตือนว่า draft นี้เป็นของโกดังอื่น (ตัวแปร `parsed.warehouse_id` ถูก save แต่ไม่เคยถูกเทียบ/ใช้ตอน restore)
- **สาเหตุ**: บรรทัด 94-101 restore ตรวจแค่ `parsed.lines.length > 0` แล้ว `setValue("lines", ...)` ทันที — ไม่มีเงื่อนไข `parsed.warehouse_id === activeWhId`
- **วิธีเกิด**: 1) ร่างเอกสารไว้ครึ่งทางที่โกดัง 1 ปิดแท็บ 2) วันถัดไปล็อกอินเข้าทำงานโกดัง 3 3) เปิดหน้ารับสินค้า → เจอรายการเก่าของโกดัง 1 ปนในฟอร์ม 4) กดยืนยัน → เอกสารรับเข้าโกดัง 3 แต่มีรายการ/ตำแหน่งจากโกดัง 1 (server ไม่ validate ตำแหน่งเทียบโกดัง — ดู BUG-A4)
- **หลักฐาน**: การอ่านโค้ดตามด้านบน
- **Prompt แก้ไข**:
```
เพิ่มการเทียบโกดังตอน restore draft ใน use-receive-movement.ts ของ C:\Stockify\stockify-app

ไฟล์: src/app/(dashboard)/movements/receive/_hooks/use-receive-movement.ts บรรทัด 90-105
- ใน useEffect restore: เทียบ parsed.warehouse_id กับ activeWhId (normalize ด้วย normalizeWarehouseId จาก @/lib/warehouse-utils) — ถ้าไม่ตรงกันให้ localStorage.removeItem(RECEIVE_DRAFT_KEY) และไม่ restore (หรือ setScanFeedback แจ้ง "พบแบบร่างเดิมของโกดังอื่น ระบบล้างให้แล้ว")
- เพิ่ม activeWhId ใน dependency array ของ useEffect นี้

เงื่อนไขที่ต้องไม่พัง: การ restore draft ของโกดังเดียวกันต้องยังทำงาน, การ save draft (บรรทัด 108-129) ไม่ต้องแก้
หลังแก้: รัน `npm run typecheck`
```

#### BUG-B8: ไม่มี guard "ต้นทาง = ปลายทาง" ทั้ง UI และ API — ย้ายไปตำแหน่งเดิมสำเร็จและสร้างรายการขยะ
- **ความรุนแรง**: Low
- **จุดเกิด**: `src/app/(dashboard)/movements/move/_hooks/use-move-movement.ts:367-375` (onSubmit ไม่เทียบ from/to), `src/lib/services/stock/move-stock.ts:24-30, 82-107`
- **อาการ**: พนักงานสแกนชั้นเดิมซ้ำเป็นปลายทาง (เผลอสแกนป้ายเดิม) → ระบบยอมรับ สร้างเอกสาร MOVE + movement MOVE_OUT/MOVE_IN คู่ที่ตำแหน่งเดียวกัน และ syncMove split/เขียนแถวในชีตโดยไม่จำเป็น — ประวัติรก, เสี่ยงชีตแตกแถวจาก Case 2 ของ syncMove
- **สาเหตุ**: ไม่มี validation ใดเทียบ `from_location_id` กับ `to_location_id` ทั้งฝั่ง hook (onSubmit เช็คแค่ `!rawTo`) และฝั่ง moveStock สร้าง movement 2 รายการที่ `location_id` เดียวกันได้ทันที (`fromLoc` L24 กับ `input.to_location_id` L101 ไม่เคยถูกเทียบ)
- **วิธีเกิด**: 1) เลือกสินค้า จำนวน 2) step 2 สแกนป้ายชั้นเดิมที่หยิบของมา 3) กดย้าย → สำเร็จ ประวัติมีรายการ "ย้าย A1 → A1"
- **หลักฐาน**: อ่านโค้ด; `__tests__/move-stock.test.ts` ไม่มี case from==to
- **Prompt แก้ไข**:
```
เพิ่ม guard from == to สองจุด:
1) src/lib/services/stock/move-stock.ts หลังบรรทัด 24: ถ้า fromLoc && cleanLocCode(fromLoc) === cleanLocCode(toLoc) ให้ throw StockValidationError("ตำแหน่งต้นทางและปลายทางต้องไม่เหมือนกัน") (import จาก stock-errors.ts)
2) src/app/(dashboard)/movements/move/_hooks/use-move-movement.ts onSubmit (บรรทัด 372-375): ก่อน fetch เทียบ selectedFromLoc/selectedToLoc ด้วย cleanLocStr แล้ว setError("ตำแหน่งต้นทางและปลายทางเหมือนกัน กรุณาสแกนปลายทางใหม่") กลับไป step 2
เงื่อนไขที่ต้องไม่พัง: move ปกติระหว่างต่างตำแหน่งต้องผ่าน, กรณี from ว่าง (จัดเข้าเชลฟ์) ต้องยังผ่าน, เพิ่ม test ใน __tests__/move-stock.test.ts ว่า from==to ต้อง reject, รัน npm run typecheck และ npx jest __tests__/move-stock.test.ts --config jest.config.js --runInBand
```

#### BUG-B10: error จากระบบภายนอก/ทศนิยม ส่งข้อความดิบภาษาอังกฤษถึงหน้าจอพนักงาน + บันทึกจำนวนทศนิยมได้
- **ความรุนแรง**: Low
- **จุดเกิด**: `src/lib/services/stock/stock-error-mapper.ts:52-56`, `src/types/api.ts:167` (qty ไม่บังคับจำนวนเต็ม), `src/app/(dashboard)/movements/move/_hooks/use-move-movement.ts:405-409`
- **อาการ**: 1) ถ้า Sheets/Apps Script พัง พนักงานเห็นข้อความ raw อังกฤษ เช่น `GoogleJsonResponseException: API error ...` (mapper fallback ส่ง `error.message` ตรง ๆ) 2) พิมพ์จำนวนทศนิยมเช่น `0.5` ผ่านทั้ง UI (`handleNextStep1` เช็คแค่ > 0) และ zod (`z.number().positive()` ไม่มี `.int()`) → ระบบบันทึกสต็อก 0.5 ชิ้น
- **สาเหตุ**: mapper บล็อกสุดท้าย `const message = error instanceof Error ? error.message : "เกิดข้อผิดพลาดภายในระบบ..."` — error ของไลบรารีภายนอกเป็น Error จึงโชว์ข้อความดิบ; ส่วน schema `qty: z.number().positive("จำนวนต้องมากกว่า 0")` (api.ts:167) และ input ใน MoveForm.tsx:174-193 ไม่มีการบังคับ integer
- **วิธีเกิด**: 1) (ข้อความ) quota Sheets เกิน/โดน throttle ระหว่างยืนยัน → alert สีแดงแสดง stack/ข้อความอังกฤษ 2) (ทศนิยม) พิมพ์ 1.5 ในช่องจำนวน → ยืนยันผ่าน → summary เป็นทศนิยม
- **หลักฐาน**: อ่านโค้ด (quote ด้านบน); เทสไม่ครอบทั้งสองกรณี
- **Prompt แก้ไข**:
```
แก้ 2 จุด:
1) src/lib/services/stock/stock-error-mapper.ts บรรทัด 52-56: อย่าส่ง error.message ดิบถึงผู้ใช้ — คง raw message ไว้แค่ใน console/server log และคืนข้อความไทยกลาง เช่น "ไม่สามารถบันทึกข้อมูลลงระบบได้ กรุณาลองอีกครั้ง" (คง message ไทยของ StockError/ZodError/StockLockTimeoutError ตามเดิม)
2) src/types/api.ts บรรทัด 167: เปลี่ยนเป็น z.number().int("จำนวนต้องเป็นจำนวนเต็ม").positive("จำนวนต้องมากกว่า 0") — ตรวจก่อนว่าทุก caller ส่งจำนวนเต็มอยู่แล้ว (use-move-movement.ts:392 ส่ง Number(data.qty), MoveForm ใช้ type=number) และเพิ่ม step="1" ที่ input qty ใน MoveForm.tsx บรรทัด 176
เงื่อนไขที่ต้องไม่พัง: happy path ทุก flow (receive/issue/move/transfer/reverse) ต้องผ่าน, ข้อความ validation ไทยเดิมต้องแสดงครบ, รัน npm run typecheck และ npx jest __tests__/move-stock.test.ts __tests__/receive-stock.test.ts __tests__/issue-stock.test.ts --config jest.config.js --runInBand
```

#### BUG-C8: ปุ่มอนุมัติ/ปฏิเสธ/ยกเลิกไม่มีสถานะกำลังโหลด (approvingId/cancellingId ไม่เคยถูก set)
- **ความรุนแรง**: Low
- **จุดเกิด**: `src/app/(dashboard)/movements/transfer/_hooks/use-transfer-movement.ts:152-153, 453, 508, 639`
- **อาการ**: UI มี spinner "กำลังบันทึก..."/"กำลังปฏิเสธ..." และ disabled เตรียมไว้ (TransferNotificationList.tsx:404-431) แต่ไม่มีวันที่ทำงาน เพราะ hook ไม่เคยเรียก `setApprovingId(t.id)`/`setCancellingId(t.id)` (มีแค่ `setCancellingId(null)` ตอน finally บรรทัด 639)
- **สาเหตุ**: state ประกาศไว้แต่ handler `handleApproveTransfer`/`handleCancelTransfer`/`handleRejectTransfer` ไม่ set ค่า
- **วิธีเกิด**: ผู้อนุมัติกด "อนุมัติการเบิก" ขณะชีตช้า → ปุ่มยังกดได้ซ้ำ ๆ ไม่มี feedback (mitigate ด้วย optimistic UI ที่ลบแถวออกทันที จึงกระทบน้อย)
- **หลักฐาน**: อ่านโค้ด
- **Prompt แก้ไข**:
```
src/app/(dashboard)/movements/transfer/_hooks/use-transfer-movement.ts: ใน handleCancelTransfer (เริ่มบรรทัด 453), handleApproveTransfer (508), handleRejectTransfer (601) — เพิ่ม setCancellingId(t.id)/setApprovingId(t.id) ก่อน fetch และ setCancellingId(null)/setApprovingId(null) ใน finally ทุก path
เงื่อนไขที่ต้องไม่พัง: optimistic UI (ลบแถวก่อน) คงเดิมได้ แต่ถ้าลบแถวทันที spinner จะมองไม่เห็น — ให้เลือกทำอย่างใดอย่างหนึ่งให้สม่ำเสมอ
หลังแก้: รัน `npm run typecheck`
```

#### BUG-C9: ข้อความ validation บางช่องเด้งเป็นภาษาอังกฤษ (zod default message)
- **ความรุนแรง**: Low
- **จุดเกิด**: `src/types/api.ts:195` (`reference_no: z.string().max(100)`), `:197` (`note: z.string().max(500)`) และ `src/app/(dashboard)/movements/transfer/_hooks/use-transfer-movement.ts:34-35`
- **อาการ**: ผู้ใช้กรอกหมายเหตุ/อ้างอิงยาวเกิน 100/500 ตัวอักษรแล้วกดสร้างใบเบิก → ข้อความ error ที่ alert ขึ้นเป็น default อังกฤษของ zod เช่น "Too big: expected string to have <=100 characters" ไม่ใช่ภาษาไทย
- **สาเหตุ**: ไม่ได้กำหนด message ไทยให้ `.max()` ต่างจาก field อื่นที่ใส่ไทยครบ
- **วิธีเกิด**: สร้างใบเบิกโดยวาง note ยาว >500 ตัวอักษร → error อังกฤษโชว์บนหน้าจอพนักงาน
- **หลักฐาน**: อ่านโค้ด + mapStockErrorToResponse (stock-error-mapper.ts:25-26) ใช้ issue.message แรกตรง ๆ
- **Prompt แก้ไข**:
```
src/types/api.ts ใน TransferDocumentSchema: เพิ่ม message ไทย `reference_no: z.string().max(100, "รหัสอ้างอิงต้องไม่เกิน 100 ตัวอักษร")`, `note: z.string().max(500, "หมายเหตุต้องไม่เกิน 500 ตัวอักษร")` และตรวจ schema อื่นในไฟล์เดียวกัน (IssueDocumentSchema บรรทัด 149-151, ReceiveDocumentSchema 126-128) ที่ยังไม่มี message ไทยให้ครบ
เงื่อนไขที่ต้องไม่พัง: validation logic ต้องเหมือนเดิมทุกอย่าง เปลี่ยนแค่ข้อความ
หลังแก้: รัน `npm run typecheck` และ `npx jest __tests__/transfer-stock.test.ts __tests__/issue-stock.test.ts --config jest.config.js --runInBand`
```

---

## ส่วนที่ 3: จุดที่ตรวจแล้ว "ไม่พบปัญหา"

### Flow รับสินค้าเข้าโกดัง (Tester A)
- **สแกนซ้ำสินค้าเดิม**: เพิ่ม 1 กล่องต่อสแกนตามดีไซน์ (`use-receive-movement.ts:283-291`) — ถูกต้อง ไม่สร้างบรรทัดซ้ำ
- **จำนวน 0 / ติดลบ / ทศนิยม / Infinity**: UI clamp + `parseInt` (ReceiveLineItem.tsx:99, 281) และปุ่มยืนยัน disable กรณี qty<=0 (ReceiveLineItem.tsx:435, ReceiveLinesTable.tsx:47-48); zod v4 ปฏิเสธ NaN/Infinity (ทดลอง safeParse จริงแล้ว fail ถูกต้อง)
- **กดยืนยัน 2 ครั้งในแท็บเดียว**: `isSubmitting` ปิดปุ่มใน modal (ReceiveConfirmModal.tsx:174-177) และ `isProcessingRef` กัน scan ซ้อน (hook:233)
- **สแกนรหัสโกดังเพื่อสลับโกดัง**: `detectWarehouseCode` ทำงานถูก (hook:241-253)
- **สิทธิ์ขั้นอนุมัติ**: staff กดอนุมัติเองไม่ได้ (`PERMISSIONS.DOCUMENT_APPROVE` ไม่มีให้ WAREHOUSE_STAFF), reconciliation กันอนุมัติซ้ำด้วย existingMovements + lock (approve route:121-149) ทำงานได้

### Flow จัดตำแหน่งสินค้า (Tester B)
- **กดยืนยันซ้ำ/2 tab (instance เดียว)**: `isSubmitting` + idempotency_key คงที่ + in-process `withStockLocks` + เช็ค balance ซ้ำใน lock — ถูกต้อง (concurrency test#1 ยืนยัน)
- **สิทธิ์ move**: VIEWER/APPROVER ไม่มี `STOCK_MOVE` → 403 พร้อมข้อความไทย; ผ่านเทส security-authorization
- **จำนวน 0 / ติดลบ**: zod `.positive()` ข้อความไทย + UI gate (use-move-movement.ts:349-353)
- **ยอดเกิน (case ตรงไปตรงมา)**: throw `InsufficientStockError` ข้อความไทย (move-stock.ts:58-69) — แต่การวัดยอดเองมีรู (BUG-B2)

### Flow เบิกสินค้า (Tester C)
- **Transition guards หลัก**: อนุมัติเอกสาร CANCELLED/REJECTED → throw ไทย (transfer-stock.ts:318-320), approve ซ้ำ → idempotent ผ่าน key `complete-transfer-{id}-{hash}` (:586) + re-check หลัง lock, cancel หลัง complete → throw (:844-845, 896-897) — **สต๊อกไม่คืนซ้ำ**
- **เบิกจากหลายตำแหน่ง**: sum(allocations) ต้องเท่า qty พอดี (:613-618) + เช็ครายตำแหน่งใน lock; จำนวน 0/ติดลบถูก zod กัน (ยกเว้นช่องโหว่ snapshot ใน BUG-C3)
- **reverse-stock คืนผิดตำแหน่ง**: mirror movement ต้นฉบับถูกต้อง (reverse-stock.ts:108-118) และกันลบยอดปลายทางติดลบ (:82-95)
- **stale ASSIGNED/cleanup**: `DELETE /cleanup` disabled ถาวร (cleanup/route.ts:8-30) สอดคล้องกับ UI ที่เคลียร์เฉพาะ localStorage
- **สิทธิ์ APPROVER ฝั่งอื่น**: APPROVER เรียก receive/move ได้ 403; staff เรียก /approve, /reject, PATCH /cancel ได้ 403
- **ข้อความ error ภาษาไทย**: ข้อความจาก service/stock-errors เป็นไทยหมด (ยกเว้นกรณี BUG-C9, BUG-B10)

---

## ภาคผนวก: ข้อสังเกตเชิงระบบจากทีมเทส

1. **ช่องโหว่เชิงโครงสร้างที่พบซ้ำหลาย flow**: การ "ยอมรับค่าที่ไม่รู้จักเงียบ ๆ" (ตำแหน่งปลอมใน receive, โค้ดดิบใน move, fuzzy match สินค้า, snapshot fallback ใน transfer) — ควรตั้งหลักการกลาง: **ทุก id ที่ผู้ใช้ป้อน (location/product/warehouse) ต้องถูก validate กับ master ฝั่ง server เสมอ ห้ามเดา/ห้าม fallback**
2. **ชุดทดสอบเดิมผ่านหมด 132/132 แต่จับไม่เจอปัญหาใดในรายงานนี้** เพราะ sequential และ mock ตรงตัว — ควรเพิ่ม (ก) เทส race (Promise.all สอง request), (ข) เทส invalid location/cross-warehouse, (ค) เทส stale state (ลบบรรทัด/สลับโกดัง), (ง) เทส route จริงทุก endpoint (authorize ต่อ route) ตาม prompt แก้ไขที่แนบในแต่ละบั๊ก
3. **ลำดับการแก้ที่แนะนำ**: กลุ่มความปลอดภัยก่อน (C1, A3, C4, C5) → กลุ่มความถูกต้องของสต็อก (B1, B2, A2, C3, B4, C6) → กลุ่ม UX/สถานะค้าง (A1, A5, C2, C7, B3, B5, B6, B7) → กลุ่มข้อความ/คุณภาพ (ที่เหลือ)
