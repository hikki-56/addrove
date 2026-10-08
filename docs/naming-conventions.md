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

---

## 4. โครงสร้างโฟลเดอร์ใน `src/` (Source Layout)

| โฟลเดอร์ | ใช้สำหรับ |
| :--- | :--- |
| `src/app/` | Route ของ Next.js เท่านั้น (`page.tsx`, `layout.tsx`, `route.ts`) + `_components`/`_lib` ที่ใช้เฉพาะ Route นั้น |
| `src/features/<feature>/` | โค้ด UI ของฟีเจอร์ที่ใช้ร่วมกันหลายหน้า แบ่งเป็น `components/`, `hooks/`, `utils.ts` (เช่น `features/receive`, `features/transfer`, `features/move`) |
| `src/components/` | React component ที่ใช้ร่วมกันทั้งแอป (`ui/`, `layout/` รวมถึง `layout/nav-items.tsx`) |
| `src/hooks/`, `src/context/` | React hook / Context ที่ใช้ร่วมกันทั้งแอป |
| `src/client/` | โมดูลที่รันบน Browser เท่านั้น (fetch client, offline queue, feedback, navigation) — ห้าม import จากฝั่ง server |
| `src/server/` | โค้ดฝั่ง server เท่านั้น (auth, Google Sheets, repositories, services, security, production ฯลฯ) — **ห้าม** import จาก Client Component (`"use client"`) หรือไฟล์ที่ Client Component import |
| `src/lib/` | Utility แบบ pure ที่ใช้ได้ทั้งสองฝั่ง (ไม่มี I/O ไม่มี secret) เช่น `sku.ts`, `id.ts`, `warehouse-utils.ts` |
| `src/types/` | Type/Interface ที่ใช้ร่วมกัน |

- Import ข้ามโฟลเดอร์ใช้ alias `@/` เสมอ (เช่น `@/server/services/...`, `@/features/receive/hooks/...`) ใช้ `./` เฉพาะไฟล์ในโฟลเดอร์เดียวกัน
- Type ฝั่ง client ที่ต้องตรงกับ type ฝั่ง server ให้ประกาศ mirror ไว้ฝั่ง client แทนการ import จาก `src/server`
