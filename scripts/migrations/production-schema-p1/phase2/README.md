# PHASE 2: DO NOT APPLY OR DEPLOY WITHOUT USER APPROVAL

> ปลายทางใน repo: `scripts/migrations/production-schema-p1/phase2/README.md`
> จัดทำ 8 ต.ค. 2026 (เวลาไทย) · **ยังไม่ apply และยังไม่ deploy** · ทดสอบแล้วเฉพาะแบบออฟไลน์ (mock)
> เอกสารออกแบบ: `docs/production-schema-proposal.md` §8.3, §19, §20

## ทำไมต้องแยกเป็น Phase 2
การย้าย mutation ทุกอย่างของโมดูลผลิตให้เป็น "คำสั่งเดียวภายใต้ script lock" ต้อง **แก้และ redeploy Apps Script web app ของชีตจริง** ซึ่งกระทบทุกการเขียนของแอป ⇒ ต้องได้รับอนุมัติจากผู้ใช้โดยตรงก่อน (Backend Dev, 8 ต.ค. 16:23 น.)
`scripts/google-apps-script.gs` และ `src/server/google-sheets/script-signer.ts` ใน repo **ยังไม่ถูกแก้** — การเปลี่ยนแปลงอยู่ใน patch นี้เท่านั้น

## ไฟล์
| ไฟล์ | หน้าที่ |
|---|---|
| `google-apps-script.phase2.patch` | unified diff (base `refactor/structure` @ `15f92ff`, sha256 ของไฟล์ base อยู่ในหัว patch) แก้ 2 ไฟล์: `scripts/google-apps-script.gs` (เพิ่ม action `productionCommand`, ขยาย `PRODUCTION_SHEET_HEADERS` ให้ตรง migration, route ใน `doPost` ภายใต้ lock เดิม) และ `src/server/google-sheets/script-signer.ts` (allowlist + ตรวจรูปแบบ payload + ปฏิเสธเมื่อเป็น legacy/unsigned mode) |
| `production-command.gs` | source ของ `validateProductionCommand` / `doProductionCommand` ที่ทดสอบได้ — patch ฝังข้อความนี้ลงใน `.gs` หลักทุกตัวอักษร (deploy เป็นไฟล์เดียวตามวิธีเดิม) |
| `test/run-phase2-tests.js` | ทดสอบออฟไลน์กับ `.gs` ตัวจริง (ไม่มี network/Google API) |

## `productionCommand` ทำอะไร (สรุป)
- ตรรกะธุรกิจ (สิทธิ์ สถานะ จำนวน ทศนิยม เหตุผล ข้อความ) **อยู่ใน Next.js เหมือนเดิม** — Next.js ส่ง op ที่คำนวณแล้ว; Apps Script ทำเฉพาะส่วนที่ต้อง atomic ข้าม instance
- op: `requireRow` (CAS: `expectVersion` บังคับสำหรับ ProductionJobs + `expectUpdatedAt` เป็นการตรวจรอง + `expectStatusIn` + `requireNotDeleted`), `updateRow` (เฉพาะคอลัมน์ที่ส่ง; งานต้อง `bumpVersion` และห้ามเขียน A/AB), `appendUnique` (กันซ้ำด้วย Reports Q / History L / Notifications K / id), `addToJsonArray` (read_by ของแจ้งเตือน), `nextJobNo` (ProductionCounters + ข้ามเลขที่มีแล้ว)
- **ตรวจทุก op ก่อน แล้วค่อยเขียน** — เงื่อนไขไม่ผ่าน = `{success:false, code, current}` และชีตไม่เปลี่ยน
- Idempotency (ถ้าส่ง `idempotencyKey`): แถว `prdcmd:<command>:<key>` ในแท็บ `Idempotency` — COMPLETED → คืนผลเดิม (`replayed:true`), PROCESSING → `PRD_IDEMPOTENCY_IN_PROGRESS`, FAILED → `PRD_IDEMPOTENCY_FAILED`, payload ต่าง → `PRD_IDEMPOTENCY_KEY_REUSED`
- `ProductionCounters` **ไม่** ถูกเพิ่มใน `ALLOWED_SHEETS` (append/update ทั่วไปเขียนไม่ได้) — เข้าถึงได้ผ่าน `productionCommand` เท่านั้น
- ไม่เปลี่ยนพฤติกรรมของ `append` / `update` / `deleteRow` / `atomicStockOperation` ⇒ แอปปัจจุบันทำงานต่อได้ระหว่างเปลี่ยนผ่าน
- fail closed ถ้ายังไม่ได้รัน migration (ไม่มีคอลัมน์ AB) และถ้าแอปอยู่ใน `GOOGLE_SCRIPT_LEGACY_MODE`

### map รหัสผลลัพธ์ → api-contract
| productionCommand | HTTP / code ใน contract |
|---|---|
| `PRD_VERSION_CONFLICT` | 409 `VERSION_CONFLICT` (+ `data.current`) |
| `PRD_INVALID_TRANSITION`, `PRD_ROW_DELETED` | 409 `INVALID_TRANSITION` |
| `PRD_ROW_NOT_FOUND` | 404 `JOB_NOT_FOUND` |
| `PRD_IDEMPOTENCY_KEY_REUSED` | 409 `IDEMPOTENCY_KEY_REUSED` |
| `PRD_IDEMPOTENCY_IN_PROGRESS` | 409 `IDEMPOTENCY_IN_PROGRESS` |
| `PRD_DUPLICATE_KEY`, `PRD_CORRUPT_CELL`, `PRD_IDEMPOTENCY_FAILED` | 500 `INTERNAL_ERROR` (ต้องตรวจด้วยมือ) |

## เงื่อนไขก่อน apply (ต้องครบทุกข้อ ตามลำดับ)
1. ผู้ใช้อนุมัติให้แก้และ redeploy Apps Script web app ของชีตจริงอย่างชัดแจ้ง
2. migration `PRD-SCHEMA-P1` apply + verify แล้วบนชีตเป้าหมาย (สำเนาก่อน แล้วชีตจริงโดยได้รับอนุมัติแยก)
3. Next.js ของโมดูลผลิตเปลี่ยนมาใช้ `productionCommand` แล้ว และ deploy **พร้อมกัน** กับ Apps Script
4. ซ้อมบนสำเนาชีต: deployment ของสำเนาเอง + signing secret ของสำเนาเอง (ห้ามใช้ secret ของชีตจริง)

## ขั้นตอน (หลังได้รับอนุมัติเท่านั้น)
```
git apply --check scripts/migrations/production-schema-p1/phase2/google-apps-script.phase2.patch
git apply         scripts/migrations/production-schema-p1/phase2/google-apps-script.phase2.patch
node scripts/migrations/production-schema-p1/phase2/test/run-phase2-tests.js
PATCHED_GS=scripts/google-apps-script.gs node scripts/migrations/production-schema-p1/phase2/test/run-phase2-tests.js
```
จากนั้นวาง `scripts/google-apps-script.gs` ใน editor → **Deploy → Manage deployments → Edit → New version** (URL `/exec` เดิม) · Rollback: เลือก version ก่อนหน้าใน Manage deployments + `git apply -R` patch

## ผลทดสอบออฟไลน์ (8 ต.ค. 2026)
- `node test/run-phase2-tests.js` → 13/13 ผ่าน (กับ `scripts/google-apps-script.gs` @ 15f92ff ที่ยังไม่ patch)
- `PATCHED_GS=<.gs ที่ apply patch แล้ว>` → 14/14 ผ่าน (รวมเส้นทาง `doPost` + HMAC + nonce replay + validatePayload)
- `script-signer.ts` หลัง patch: `tsc --noEmit --strict` ผ่าน
- ข้อจำกัด: mock ไม่ใช่ Apps Script จริง — ต้องซ้อมบนสำเนาชีตก่อนเสมอ
