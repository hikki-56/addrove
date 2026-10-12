# ผลแก้ความช้าของระบบพนักงาน

วันที่ 12 ตุลาคม 2026 — แก้และทดสอบในเครื่อง ยังไม่ได้ commit/push/deploy

ลดการโหลดสต็อกซ้ำขณะสแกน และตัดการรอ progress ก่อนส่งยืนยันเบิก โดยแยกข้อมูลขั้นตอนออกจากสถานะและรายละเอียดธุรกรรม ทดสอบด้วยข้อมูลจำลองเท่านั้น ไม่เปิดหรือแก้รายการเดิมในเว็บจริง

## สิ่งที่แก้

- การสแกนใช้ stock snapshot ร่วมกันภายใน hook ของงานนั้น อายุ 10 วินาที รวมคำขอที่เริ่มพร้อมกัน ใช้ cache แยกโกดัง และล้างเมื่อเปลี่ยนงาน/ผู้ใช้หรือยืนยันสำเร็จ เมื่อโหลดสต็อกไม่สำเร็จจะแสดงข้อผิดพลาดและไม่เพิ่มรายการหยิบ สามารถลองใหม่ได้
- ตัด `Promise.race` ที่รอ progress ได้ 8 วินาทีก่อน POST ยืนยันเบิก Progress ของ Google Sheets เขียนเฉพาะคอลัมน์ J; สถานะและ metadata ธุรกรรมยังเขียน A:I Reader รวม progress เข้ากับ note เฉพาะใบ TRANSFER ที่เป็น PENDING และใช้ note ธุรกรรมเมื่อออกจากสถานะนี้แล้ว
- ไม่มี fallback จาก progress ไปเขียนทั้งแถว หาก repository หรือ Apps Script ไม่รองรับจะปฏิเสธ progress เพื่อไม่ให้คำขอเก่าเขียนทับผลยืนยัน
- การลด initial load ที่ทำไว้ก่อนหน้ายังคงอยู่: หน้าเบิกไม่โหลด locations ที่ไม่ใช้ตอนเปิดหน้าและไม่โหลดรายชื่อพนักงานสำหรับฟอร์ม admin; dashboard แยกโหลดส่วน admin, เปิดหน้าเบิกตรง และลด polling ขณะหน้าซ่อน

Snapshot เป็นข้อมูลช่วยสแกน ไม่ใช่สิทธิ์อนุมัติยอดสต็อก การส่งเบิกยังได้ WAITING_APPROVAL ตาม flow เดิม และการตรวจ/บันทึกสต็อกฝั่งอนุมัติยังคงเดิม

## ผลเปรียบเทียบจากการจำลอง

ใช้ callback จากซอร์สจริงกับ HTTP/state จำลอง เวลานี้ไม่ใช่ความเร็วเว็บจริง ดู [ผลก่อนแก้](employee-performance-baseline.md) สำหรับข้อมูลรอบแรก

| งาน | ก่อนแก้ | หลังแก้ |
| --- | --- | --- |
| สแกน 10 ตำแหน่ง ปริมาณ 1 ชิ้น/ตำแหน่ง | 10 คำขอ / 159.74 ms | 1 คำขอ / 16.86 ms |
| สแกน 50 ตำแหน่ง | 50 คำขอ / 775.90 ms | 1 คำขอ / 20.99 ms |
| สแกน 100 ตำแหน่ง | 100 คำขอ / 1,531.10 ms | 1 คำขอ / 31.51 ms |
| Progress หน่วง 8,500 ms: รอก่อนเริ่ม POST ยืนยัน | 8,012.65 ms | 0.10 ms |
| กรณีเดียวกัน: เวลารวม callback ยืนยัน | 8,044.04 ms | 25.24 ms |

คำขอเดียวขณะสแกนหมายถึงการสแกนทั้งหมดอยู่ในช่วงอายุ snapshot 10 วินาที เมื่อหมดอายุจะโหลดใหม่ รอบ 100 ตำแหน่ง × 1,000 ชิ้นก็ใช้ 1 คำขอและ 31.65 ms

หลังแก้ initial load ข้อมูล 1,000 แถว เมื่อจำลอง locations หน่วง 150 ms: รูปแบบรับเข้า/ย้ายที่ต้องใช้ locations ใช้ 3 คำขอและ median 161.37 ms; หน้าเบิกที่ไม่โหลด locations ใช้ 2 คำขอและ 23.48 ms

การส่งรับเข้า 1 / 10 / 50 / 100 รายการ × ปริมาณ 1 / 1,000 ชิ้นต่อรายการ ยังส่ง POST ครั้งเดียวทุกกรณี มี refresh หลังส่งสำเร็จตามเดิม

## การตรวจที่ผ่าน

ชุดหลักผ่านครบ 135 profiles (โหลดข้อมูล 12, client callbacks 19, business services 104) พร้อมตรวจข้อผิดพลาด/ยกเลิกคำขอและความถูกต้องของเอกสาร ส่งซ้ำไม่สร้างซ้ำ รับตามแผน สต็อกไม่พอ และงานพร้อมกัน

เพิ่ม regression 8 กลุ่ม โดยใช้โค้ดจริงของ snapshot, progress route, Sheets repository, submit service, Google API transport, signer และ Apps Script helpers กับ boundary จำลอง:

1. 100 คำขอ stock พร้อมกันใช้ fetch เดียว แยกโกดัง หมดอายุ ล้าง cache และลองใหม่หลังผิดพลาดได้
2. Progress route เลือกการเขียนแยกเซลล์ และ reader แสดงขั้นตอนของ PENDING โดยไม่เปลี่ยน business note
3. จำลอง progress อ่านข้อมูลเก่าและค้างก่อนเขียน จากนั้น submit เสร็จก่อน ปล่อย progress เขียนทีหลัง: WAITING_APPROVAL, step 4, SKU, allocations และ metadata เดิมยังครบ
4. ใบที่รออนุมัติ/เสร็จ/ยกเลิก/ปฏิเสธไม่ใช้ progress เก่า; คอลัมน์ J ที่มีข้อมูลอื่นถูกปฏิเสธโดยไม่เขียนทับ
5. Repository ที่ไม่รองรับ progress แยกถูกปฏิเสธ ไม่เรียกการเขียนทั้งแถว
6. Google API transport ใช้ RAW และเขียนเฉพาะ J2 ใน fixture
7. Apps Script request ของ action ใหม่มีลายเซ็นเสมอ แม้ตั้ง legacy mode; backend เก่าที่ปฏิเสธไม่ fallback ไปเขียนทั้งแถว
8. Apps Script helpers จริงเขียนเฉพาะคอลัมน์ J และปฏิเสธชีตอื่น แถว header ข้อมูลเดิมในเซลล์ และขั้นตอนที่ไม่ถูกต้อง

เพิ่มตรวจ callback สแกนจริงกรณี API 503: ไม่เพิ่มรายการหยิบ และลองใหม่สำเร็จได้ Syntax scripts และ `git diff --check` ผ่าน ตรวจ TypeScript ไม่พบ diagnostics ในไฟล์หลักใหม่/แก้ที่ตรวจ แต่ทั้งโครงการยังมี 34 diagnostics จากปัญหาเดิม/dependencies ที่ไม่ครบ จึงยังไม่ถือว่า typecheck/Jest/lint ทั้งโครงการผ่าน

## เงื่อนไขเมื่อนำขึ้นระบบจริง

- ชีต Documents ต้องมีคอลัมน์ J ว่างสำหรับ `transfer_progress_json` หรือเป็น progress ของระบบนี้อยู่แล้ว โค้ดอ่านแถวเก่า A:I ได้โดยไม่ต้องย้ายข้อมูล และปฏิเสธการเขียนถ้าเซลล์ J ของแถวนั้นมีข้อมูลอื่น ไม่ได้แก้หัวตารางหรือชีตจริงในงานนี้
- ถ้าเขียนผ่าน Google Apps Script ให้อัปเดต action `updateDocumentProgress` จาก `scripts/google-apps-script.gs` ใน deployment ที่ใช้งาน **ก่อนนำเว็บรุ่นนี้ขึ้น** Action ใหม่นี้ต้องมี SIGNING_SECRET/GOOGLE_SCRIPT_SIGNING_SECRET ตรงกัน แม้ใช้ legacy mode กับ action เดิม
- สำหรับ deployment ที่รวมงาน production schema ซึ่งยังไม่ได้ขึ้นตามที่ผู้ใช้แจ้ง ให้รวม action ใหม่นี้กับ Apps Script เวอร์ชันที่จะใช้งานจริง รักษา action และ schema อื่นไว้ ไม่แทนสคริปต์จริงด้วยไฟล์นี้โดยไม่ตรวจงานที่รอ deploy ร่วมกัน
- ถ้าเขียนผ่าน service account โดยตรง helper ใหม่ใช้ Google API เขียนเฉพาะ J; ถ้า fallback ไป Apps Script ก็ต้องรองรับ action ใหม่เช่นกัน
- Backend เก่าไม่รองรับ action ใหม่จะทำให้ progress sync ถูกปฏิเสธ; การแสดงขั้นตอนให้คนอื่นจึงไม่อัปเดต การส่งยืนยันแยกต่างหากและไม่มี whole-row fallback ของ progress

ไม่มีการส่งรับ/เบิกหรือเปลี่ยนรายการเดิมจากการทดสอบครั้งนี้ ยังไม่ได้ commit/push Git อัปเดตระบบจริงวันที่ 12 ตุลาคม 2026: Apps Script เวอร์ชัน 6 และ Vercel deployment `dpl_8faU98f4FKT6Uo5noXNxtWwY35bm` ผ่าน cloud build/TypeScript และ promote แล้ว ตรวจ `addrove.vercel.app` ชี้ deployment นี้สถานะ Ready ซอร์สแยกจาก production commit เดิมและรวมเฉพาะ performance 13 ไฟล์ รายละเอียด/ไฟล์ครบอยู่ที่ `artifacts/releases/employee-performance-2026-10-12/README.md`

## ข้อจำกัดของผลวัด

ตัวเลขใช้ HTTP/repository ในหน่วยความจำ ไม่รวม Google Sheets จริง, browser/React render, auth/proxy, cold start, เครือข่าย, retry หรือเวลาของคน/เครื่องสแกน จึงยืนยันได้ว่าลดจำนวนคำขอและลำดับรอในโค้ด แต่ยังยืนยันความเร็วบน Vercel ไม่ได้

หน้าโหลดข้อมูลเก็บ 3 samples ต่อ profile, callback เก็บ 1 sample หลัง warm-up และ workflow 2 samples OS timer อาจหน่วงเกินค่าที่ตั้ง ไม่ใช่ production percentile/SLA เวลา refresh หลังรับเข้าและการรอ progress cleanup หลังวัด callback ไม่รวมใน callback timing

การตัด client wait ไม่ได้ตัดเวลาที่ backend ต้องบันทึกหรือรอ lock ของ Apps Script ความเร็วธุรกรรมจริงยังขึ้นกับระบบจัดเก็บ ชุด regression ตรวจการแยกคอลัมน์ด้วย runtime จำลอง และไม่ได้ยืนยัน concurrency/throughput จริงของ Google

เว็บออนไลน์อัปเดตแล้วและตรวจ Dashboard บัญชีพนักงานโหลดสำเร็จ ผล HTTP อ่านหน้า login ในรายงานก่อนแก้ไม่ใช่เวลาของ Dashboard/API ที่ยืนยันตัวตนแล้ว ยังไม่ได้วัด percentile ของธุรกรรมรับ/เบิกบน production เนื่องจากคงรายการจริงไว้ตามที่ผู้ใช้กำหนด

## รันซ้ำ

```sh
npm run test:employee-performance
npm run test:employee-performance -- --quick
```

คำสั่งหลักไม่มี network หรือธุรกรรมจริง แบบ quick ลด samples และข้าม profile progress หน่วง 8.5 วินาที ผล JSON จะถูกเขียนทับ:

- `artifacts/performance/employee-page-load-benchmark.json`
- `artifacts/performance/employee-client-action-benchmark.json`
- `artifacts/performance/employee-workflow-benchmark.json`
- `artifacts/performance/employee-performance-regressions.json`

`employee-live-read-benchmark.mjs` เป็นคำสั่ง GET สาธารณะแยกต่างหาก ไม่อยู่ใน npm runner และไม่ใช่ส่วนของการทดสอบรับเข้า/เบิก
