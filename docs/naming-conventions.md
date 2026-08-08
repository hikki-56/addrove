# มาตรฐานการตั้งชื่อไฟล์และโฟลเดอร์ (Naming Conventions) - Stockify

เอกสารนี้ระบุข้อกำหนดและมาตรฐานการตั้งชื่อไฟล์ โฟลเดอร์ และโครงสร้างซอร์สโค้ดในโครงการ Stockify เพื่อให้มีความสม่ำเสมอและง่ายต่อการดูแลรักษา

---

## 1. กฎและมาตรฐานการตั้งชื่อ (Naming Rules)

| ประเภท (Type) | รูปแบบชื่อ (Convention) | ตัวอย่าง (Example) |
| :--- | :--- | :--- |
| **Route และโฟลเดอร์ทั่วไป** | `kebab-case` | `movements/transfer`, `login-logs` |
| **React Component / Context / Provider** | `PascalCase.tsx` | `BarcodeSvg.tsx`, `ThemeProvider.tsx`, `Navbar.tsx` |
| **Utility Helper** | `kebab-case.ts` | `auth-session.ts`, `barcode-utils.ts` |
| **Service** | `<domain>.service.ts` | `inventory.service.ts`, `login-log.service.ts` |
| **Repository** | `<domain>.repository.ts` | `stock-movement.repository.ts`, `product.repository.ts` |
| **Test** | `<source-name>.test.ts` หรือ `.test.tsx` | `inventory.service.test.ts` |
| **Asset & Data File** | `kebab-case` | `login-logs.json`, `warehouse-icon.png` |
| **Route-specific Component** | ไว้ในโฟลเดอร์ `_components` ของ Route | `dashboard/_components/AdminDashboard.tsx` |
| **Route-specific Library** | ไว้ในโฟลเดอร์ `_lib` ของ Route | `movements/transfer/_lib/helper.ts` |

---

## 2. ไฟล์พิเศษของ Next.js (Special Files - Do Not Rename)

ไฟล์ต่อไปนี้เป็นไฟล์สงวนเฉพาะของ Next.js App Router **ห้ามเปลี่ยนชื่อหรือแก้ไขรูปแบบตัวพิมพ์**:
- `page.tsx`
- `layout.tsx`
- `route.ts`
- `loading.tsx`
- `error.tsx`
- `not-found.tsx`
- `favicon.ico`
- `src/proxy.ts`

---

## 3. แผนรองรับย้อนหลังสำหรับ URL เดิม (Backward Compatibility)

หากมีการเปลี่ยนชื่อ Route ที่กระทบผู้ใช้งานหรือระบบภายนอก ให้ดำเนินการดังนี้:
1. **หน้าเว็บ (Web Page)**: สร้าง Route Handler Redirect (308 Permanent Redirect) จากเส้นทางเดิมไปยังเส้นทางใหม่
2. **API Endpoint**: คง API Handler หรือสร้าง Legacy Forwarder เพื่อส่งต่อคำขอไปยัง Handler ใหม่โดยไม่เปลี่ยนพฤติกรรมของ API
