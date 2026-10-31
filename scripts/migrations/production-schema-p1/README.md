# Migration PRD-SCHEMA-P1 — ขั้นตอนปฏิบัติ (Runbook)

> ปลายทางใน repo: `scripts/migrations/production-schema-p1/` (ไฟล์นี้ = `README.md`)
> **ข้อตัดสินของ Backend Dev (8 ต.ค. 16:23 น.):** `ProductionJobs!AB` = `version` (lock token หลัก; `updated_at` เป็นการตรวจรอง), `source_job_no` เก็บใน `ProductionHistory!H` (detail JSON), คงเพดาน 30 คอลัมน์ ⇒ `SPEC` ของสคริปต์นี้ใช้ได้ตามเดิม (ดู `docs/production-schema-proposal.md` §19–§20)
> **migration นี้ = Phase 1** — ไม่ต้องแก้หรือ redeploy Apps Script web app; การเปลี่ยน Apps Script หลักอยู่ที่ `phase2/` (**PHASE 2: DO NOT APPLY OR DEPLOY WITHOUT USER APPROVAL**)
> เอกสารออกแบบ: `docs/production-schema-proposal.md` (สำเนาบน box: `/workspace/stockify/PRODUCTION_SCHEMA_PROPOSAL.md`)
> จัดทำ 8 ต.ค. 2026 (เวลาไทย) · ยังไม่เคยรันกับชีตจริง · ทดสอบแล้วเฉพาะบน mock (12/12 ผ่าน)

## ⚠️ ข้อห้าม / เงื่อนไขก่อนเริ่ม
- **ไม่มี dev/staging Google Sheet** — ทุกไฟล์ env (`.env.local`, `.env.vercel`, `sheet_sync/.env`) ชี้ชีตจริง `1tsndbJWnXPvY3_LQhtzVNPRMJxqjan3ScQXSvIUKPg4` ⇒ **ต้องรันกับ "สำเนา (COPY)" ของชีตก่อนเสมอ**
- **การรันกับชีตจริง (LIVE) ต้องได้รับอนุมัติจากผู้ใช้อย่างชัดแจ้งก่อน** — สคริปต์จะปฏิเสธเองถ้าไม่ได้ตั้ง `MIGRATION_ALLOW_LIVE`
- ห้ามรัน `scripts/backfill-warehouse-access.ts`, `scripts/migrate-plaintext-pins.ts`, `sheet_sync/fix_headers.py --apply` ในช่วงนี้ (มีบั๊ก off-by-one / เขียน header ทับ)
- ห้ามใช้ "Restore version" ทั้งไฟล์เพื่อย้อน ถ้ามีธุรกรรมใหม่หลังจุดสำรอง (จะลบธุรกรรมนั้น) — ใช้ `rollbackMigration()`
- ห้ามวาง secret (signing secret, API key, private key) ลงในแชต/เอกสาร/ไฟล์นี้

## ไฟล์
| ไฟล์ (บน box) | ปลายทางใน repo | หน้าที่ |
|---|---|---|
| `production-schema-p1.gs` | `scripts/migrations/production-schema-p1/production-schema-p1.gs` | สคริปต์ migration (Apps Script) — `dryRun()` / `applyMigration()` / `verifyMigration()` / `rollbackMigration()` |
| `test/run-mock-tests.js` | `scripts/migrations/production-schema-p1/test/run-mock-tests.js` | ชุดทดสอบออฟไลน์ (`node test/run-mock-tests.js`) |
| `test/print-dry-run.js` | `.../test/print-dry-run.js` | พิมพ์ผล dry run จาก fixture |
| `test/fixture-sample.json` | `.../test/fixture-sample.json` | fixture ข้อมูลปลอม โครงสร้างหัวคอลัมน์เหมือนชีตจริง (ไฟล์ export จริง `fixture-live-*.json` เก็บไว้ในเครื่องเท่านั้น ห้าม commit) |
| `test/sample-dry-run-output*.txt` | `.../test/` | ตัวอย่างผล dry run (ค่าเริ่มต้น / เปิด renumber) |
| `phase2/README.md`, `phase2/google-apps-script.phase2.patch`, `phase2/production-command.gs`, `phase2/test/run-phase2-tests.js` | `.../phase2/` | **PHASE 2: DO NOT APPLY OR DEPLOY WITHOUT USER APPROVAL** — action `productionCommand` สำหรับ Apps Script หลัก (ยังไม่ apply) |

## สิ่งที่ migration ทำ (สรุป)
1. ตรวจหัวตารางแถว 1 ของ 4 แท็บผลิต ต้องตรงตามลำดับเดิมทุกคอลัมน์ — **ไม่ตรง/แถว 1 เป็นข้อมูล/มีหัวตาราง 2 แถว ⇒ ยกเลิกทั้งชุด (abort) ไม่เขียนอะไร**
2. เพิ่มคอลัมน์ใหม่ **ต่อท้ายเท่านั้น**: `ProductionJobs` AB–AD (`version`, `ทศนิยมที่อนุญาต`, `ลบร่างเมื่อ`), `ProductionHistory` I–L — และขยาย grid คอลัมน์ท้ายแท็บถ้าไม่พอ
3. สร้างแท็บที่ยังไม่มี: `ProductionReports` (28 คอลัมน์: A–Q ตามโค้ดเดิม + R–AB), `ProductionNotifications` (12: A–G เดิม + H–L), `ProductionCounters`, `ProductionUnitRules`
4. Backfill: `version=1`, `ทศนิยมที่อนุญาต=0` (ตามหน่วย), `ProductionHistory.job_id` (จับคู่ด้วย job_no + sku ใน JSON + เวลา), แปลง `ProductionJobs!C` จาก date serial เป็นข้อความ `YYYY-MM-DD` แล้วตั้ง format คอลัมน์ C เป็น Plain text, seed ตัวนับเลขใบ `PRD-YYYYMMDD`, seed หน่วย 11 หน่วยที่พบ (ทศนิยม 0, สถานะ `PENDING` รอผู้ใช้ยืนยัน)
5. Data validation แบบ **เตือน (warn-only)** — ไม่ใช้ "reject input" เป็นค่าเริ่มต้น เพราะ Apps Script `setValues` (ทางเขียนของแอป) อาจ throw เมื่อค่าถูกปฏิเสธ
6. ตัวเลือก (ปิดไว้): `renumberDuplicateJobNo` (แก้เลข PRD-20261007-000001 ที่ซ้ำ — งาน AS002CR ที่สร้างทีหลังจะได้ 000002 + บันทึกประวัติ RENUMBER), `applyProtection` (protect แท็บผลิตแบบเตือน)

**เข้ากันได้ย้อนหลังกับโค้ดปัจจุบัน**: โค้ด v2 อ่าน `A2:AA`/`A2:Q`/`A2:H`/`A2:G` และเขียนเฉพาะช่วงเดิม (`A{n}:AA{n}`, append 27/17/8/7 ค่า) ⇒ ไม่แตะคอลัมน์ใหม่; แถวใหม่ที่โค้ดเก่าเขียนจะมี AB–AD ว่าง ซึ่งโค้ดใหม่ต้องตีความว่า `version=1`, `decimals=0` · วันที่ผลิตที่โค้ดเขียนแบบ USER_ENTERED ลงคอลัมน์ C ที่เป็น Plain text จะคงเป็นข้อความ `YYYY-MM-DD` (ดีขึ้น)

## ลำดับที่แนะนำ (ภาพรวม)
```
[A] สร้างสำเนาชีต (ผู้ใช้ทำ)  →  [B] dryRun บนสำเนา  →  [C] apply บนสำเนา  →  [D] verify + ทดสอบ rollback + apply ซ้ำ
→ [E] (ทางเลือก) ผูกแอป dev เข้ากับสำเนา แล้วทดสอบ flow ผลิต  →  [F] ขออนุมัติผู้ใช้  →  [G] LIVE: freeze + backup + apply + verify
```

## [A] สร้างสำเนาชีต (= dev DB ชั่วคราว) — ผู้ใช้/เจ้าของไฟล์ทำ
1. เปิดชีต "ไฟ" → **File → Make a copy** → ชื่อ `ไฟ — DEV COPY YYYYMMDD` → **ไม่ติ๊ก** "Share it with the same people" (ชีตจริงเปิด anyone-with-link = editor อยู่ และมี hash รหัสผ่าน/PIN ใน USERS — สำเนาต้องเป็นส่วนตัว)
2. จด spreadsheetId ของสำเนา (ส่วนยาวใน URL) — ID ไม่ใช่ความลับ
3. (สำเนาจะได้ Apps Script ที่ผูกกับไฟล์มาด้วย แต่ **deployment/Web App URL ไม่ถูกคัดลอก** — แอปยังไม่สามารถเขียนเข้าสำเนาได้จนกว่าจะทำขั้น [E])

## [B] Dry run บนสำเนา
1. ในสำเนา: **Extensions → Apps Script** → `+` → Script → ตั้งชื่อ `production-schema-p1` → วางเนื้อหา `production-schema-p1.gs` → Save
2. เลือกฟังก์ชัน `dryRun` → **Run** → อนุญาตสิทธิ์ (Spreadsheet; Drive จะถูกขอเมื่อ apply)
3. เปิด **Execution log** ตรวจ:
   - `ABORTS (0)` — ถ้าไม่ใช่ 0 ให้หยุดและส่ง log ให้ทีม (ห้ามแก้ชีตเองเพื่อให้ผ่าน)
   - `ACTIONS` ควรใกล้เคียง `test/sample-dry-run-output.txt` (≈31 รายการ)
   - `WARNINGS` จะแจ้งเลขใบซ้ำ `PRD-20261007-000001` (ปล่อยไว้ ถ้าไม่ได้เปิด renumber)
   - `FINDINGS` ไม่ควรมี duplicateJobId / invalidStatus / nonPositiveTarget

## [C] Apply บนสำเนา
1. Project Settings (⚙) → **Script Properties** → เพิ่ม
   - `MIGRATION_CONFIRM` = `PRD-SCHEMA-P1:<spreadsheetId ของสำเนา>`
   - (ทางเลือก) `MIGRATION_OPTIONS` = `{"renumberDuplicateJobNo":true}` — **เฉพาะเมื่อผู้ใช้ตัดสินใจเรื่องเลขซ้ำแล้ว**
2. Run `applyMigration` → อนุญาตสิทธิ์ Drive (ใช้สร้าง backup)
3. Log ต้องมี: `Backup copy: <id>`, `snapshot: <id>`, `Change log: <id>` และ `Post-apply re-plan: 0 action(s) remaining`
   - backup ทั้งหมดอยู่ในโฟลเดอร์ Drive `Stockify-migration-backups` (ของบัญชีที่รัน)

## [D] ตรวจผล + ทดสอบ rollback บนสำเนา
1. Run `verifyMigration` → ต้องได้ `VERIFY OK`
2. ตรวจด้วยตา: `ProductionJobs` หัวตาราง AB1:AD1, ข้อมูล A–AA ไม่เปลี่ยน (ยกเว้น C เป็นข้อความ `2026-10-07`), แท็บใหม่ 4 แท็บมีหัวตาราง 1 แถว
3. Run `rollbackMigration` → log ต้องเป็น `ROLLBACK OK` (conflicts = []) → ชีตกลับเหมือนก่อน apply (แท็บใหม่ถูกลบ คอลัมน์ใหม่ว่าง)
4. Run `applyMigration` อีกครั้ง → แล้ว `applyMigration` ซ้ำอีกรอบ → ครั้งที่สองต้องได้ "Nothing to do" (idempotent)

## [E] (ทางเลือก แต่แนะนำ) ให้แอปบนเครื่อง dev เขียนเข้าสำเนา
> ทำให้ Backend Dev ทดสอบได้โดยไม่แตะชีตจริง — ขั้นนี้เปลี่ยนไฟล์ `.env.local` บนเครื่องผู้ใช้ จึงให้ผู้ใช้/Backend Dev ทำเอง
1. ใน Apps Script ของสำเนา: อัปเดต `google-apps-script.gs` ให้ตรง repo (รวม `ALLOWED_SHEETS` ที่เพิ่ม `ProductionCounters`, `ProductionUnitRules` และ `MAX_COLS_PER_ROW` ถ้าจะเกิน 30) → ตั้ง Script Property ลับสำหรับ HMAC (ค่าใหม่ ไม่ใช้ค่าเดียวกับ production) → **Deploy → New deployment → Web app** (Execute as: Me, Who has access: Anyone)
2. บนเครื่อง dev: สำรอง `.env.local` แล้วตั้ง `GOOGLE_SHEET_ID=<id สำเนา>`, `GOOGLE_SCRIPT_URL=<URL ใหม่>`, `GOOGLE_SCRIPT_SIGNING_SECRET=<ค่าใหม่>` (`GOOGLE_API_KEY` ใช้ตัวเดิมได้ถ้าสำเนาอ่านได้ด้วย key — สำเนาส่วนตัว API key จะอ่านไม่ได้ ต้องใช้ service account หรือแชร์ view ให้ service account)
3. รัน `npm run dev` → ทดสอบ: สร้างงาน → ส่งงาน → เริ่ม → รายงานบางส่วน 2 รอบ → จบงานไม่ครบเป้า (ต้องบังคับเหตุผล) → ปรับปรุงยอด → ยกเลิก/เปิดใหม่ → กดยืนยันซ้ำ (ต้องไม่เกิดรายงาน/แจ้งเตือนซ้ำ) → ตรวจว่าแถวไปอยู่ในสำเนา **ไม่ใช่ชีตจริง**
4. คืนค่า `.env.local` เมื่อเสร็จ

## [F] ขออนุมัติผู้ใช้ก่อนแตะชีตจริง (บังคับ)
ส่งให้ผู้ใช้: ผล dry run บนชีตจริง (รัน `dryRun` ได้โดยไม่เขียนอะไร — แต่ต้องวางไฟล์สคริปต์ในโปรเจกต์ Apps Script ของชีตจริง ซึ่งก็ถือเป็นการแก้ไข ควรขออนุมัติพร้อมกัน), ผล [C]–[E], ตัวเลือกที่จะเปิด (renumber? protection?), ช่วงเวลา freeze
**ไม่มีการอนุมัติ = ไม่ทำ [G]**

## [G] LIVE (เฉพาะหลังได้รับอนุมัติ)
1. แจ้งทีม เลือกช่วงคนใช้น้อย; หยุดสคริปต์ Python/ops ทั้งหมด (`sheet_sync`), งดรับเข้า/โอน/ผลิต 15–30 นาที
2. **Version history → Name current version** `ก่อน PRD-SCHEMA-P1 YYYY-MM-DD` + `python sheet_sync/backup.py` (xlsx) — สคริปต์จะทำ Drive copy + snapshot ให้อีกชั้น
3. วาง `production-schema-p1.gs` ในโปรเจกต์ Apps Script ของชีตจริง (โปรเจกต์ที่ผูกกับไฟล์ = โปรเจกต์เดียวกับ Web App) — การเพิ่มไฟล์ใน HEAD ไม่เปลี่ยน deployment ที่ใช้งานอยู่; และเพราะอยู่โปรเจกต์เดียวกัน `LockService.getScriptLock()` จะบล็อก `doPost` ของแอประหว่าง migration (กันชนกัน) — **ห้ามกด Deploy / New version / แก้ deployment** (web app ที่ deploy อยู่ผูกกับ version เดิม การรันฟังก์ชันจาก editor ไม่กระทบ; การ redeploy คือ Phase 2 ซึ่งต้องได้รับอนุมัติแยก)
4. Run `dryRun` → ต้อง `ABORTS (0)` และ actions ตรงกับที่อนุมัติ
5. Script Properties: `MIGRATION_CONFIRM` = `PRD-SCHEMA-P1:1tsndbJWnXPvY3_LQhtzVNPRMJxqjan3ScQXSvIUKPg4` และ `MIGRATION_ALLOW_LIVE` = `USER-APPROVED:PRD-SCHEMA-P1:1tsndbJWnXPvY3_LQhtzVNPRMJxqjan3ScQXSvIUKPg4` (+ `MIGRATION_OPTIONS` ตามที่อนุมัติ)
6. Run `applyMigration` → `verifyMigration` → ตรวจแอป: หน้า /production โหลดได้, งานทั้ง 2 แสดง, สร้างงานทดสอบ 1 งานแล้วยกเลิก
7. ลบ Script Property `MIGRATION_ALLOW_LIVE` ทันที และลบไฟล์ `production-schema-p1.gs` ออกจากโปรเจกต์ (กัน deploy ติดไป)
8. เก็บ id ของ backup copy / snapshot / change log ไว้ในบันทึกงาน

## Rollback
| สถานการณ์ | วิธี |
|---|---|
| apply แล้วพบปัญหา (ยังไม่มีข้อมูลใหม่ในคอลัมน์/แท็บใหม่) | Run `rollbackMigration` (ต้องมี `MIGRATION_CONFIRM` [+ `MIGRATION_ALLOW_LIVE` ถ้า live]) — คืนค่าทีละเซลล์จาก change log, ลบหัวคอลัมน์ใหม่, ลบแท็บใหม่, ลบแถว RENUMBER, ถอด validation/protection ที่ migration ใส่ |
| แอปเขียนข้อมูลลงคอลัมน์/แท็บใหม่ไปแล้ว | rollback จะ **ไม่ลบ** ส่วนนั้นและรายงานใน `conflicts` — ตัดสินใจรายกรณี; บังคับได้ด้วย `MIGRATION_OPTIONS={"force":true}` (ข้อมูลใหม่หาย — ต้องขออนุมัติ) |
| apply ล้มกลางทาง | change log ถูกบันทึกเสมอ (status FAILED) → `rollbackMigration` ย้อนเฉพาะที่เขียนไปแล้ว หรือแก้สาเหตุแล้ว `applyMigration` ซ้ำ (จะทำต่อเฉพาะที่ขาด) |
| เลวร้ายสุด | ใช้ Drive backup copy / snapshot JSON เทียบและซ่อมเฉพาะแถว (อย่า restore ทั้งไฟล์ถ้ามีธุรกรรมใหม่) |
| ไม่ย้อน | grid คอลัมน์ว่างที่ขยายเพิ่มท้ายแท็บ (ไม่มีผลต่อแอป) |

## ทดสอบออฟไลน์
```bash
cd scripts/migrations/production-schema-p1
node test/run-mock-tests.js          # 12 tests: dry-run ไม่เขียน, guard COPY/LIVE, append-only, idempotent, rollback ตรงเดิม, abort กรณีหัวตารางผิด/ไม่มี/ซ้ำ, renumber
node test/print-dry-run.js           # ตัวอย่าง log (RENUMBER=1 เพื่อดูแบบเปิด renumber)
```
ข้อจำกัดของ mock: จำลอง API ของ Apps Script เท่าที่สคริปต์ใช้; ไม่จำลองการ throw ของ data validation, quota, หรือสิทธิ์ Drive — ต้องยืนยันบนสำเนาจริงในขั้น [C]–[D]
