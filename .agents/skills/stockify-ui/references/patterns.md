# สูตรคลาสที่ใช้จริงใน Stockify

ทุกสูตรในไฟล์นี้สกัดมาจากโค้ดที่รันอยู่จริง ไม่ใช่ของที่แต่งขึ้น ใช้เป็นจุดตั้งต้นแล้วปรับ
padding/ขนาดตามบริบทได้ แต่พยายามอย่าเปลี่ยน "รูปทรง" (radius, น้ำหนักตัวอักษร, สี)
เพราะนั่นคือสิ่งที่ทำให้หน้าจอดูเป็นชุดเดียวกัน

## สารบัญ

1. [การ์ด](#การ์ด)
2. [ปุ่ม](#ปุ่ม)
3. [ช่องกรอก](#ช่องกรอก)
4. [ตาราง](#ตาราง)
5. [Modal](#modal)
6. [Badge สถานะ](#badge-สถานะ)
7. [Empty state](#empty-state)
8. [Loading](#loading)
9. [ฟอร์ม](#ฟอร์ม)
10. [ตัวเลขและบาร์โค้ด](#ตัวเลขและบาร์โค้ด)

---

## การ์ด

พื้นฐานที่ใช้บ่อยที่สุด (12 จุดในโปรเจค):

```tsx
<div className="bg-white rounded-2xl p-3.5 border border-slate-200 shadow-xs space-y-0.5">
```

การ์ดเนื้อหาที่มีหลายส่วน:

```tsx
<div className="bg-white rounded-2xl p-4 sm:p-5 border border-slate-200 shadow-xs space-y-4">
```

การ์ดที่ห่อตาราง (ต้องมี `overflow-hidden` ไม่งั้นมุมโค้งจะโดนตารางทับ):

```tsx
<div className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden">
```

การ์ดสถิติแนวนอน (ไอคอนซ้าย ตัวเลขขวา):

```tsx
<div className="bg-white rounded-2xl p-4 border border-slate-200/80 shadow-2xs flex items-center gap-3.5">
```

**หมายเหตุ** `rounded-2xl` คือค่ามาตรฐานของการ์ด (184 จุด) ส่วน `rounded-xl` สงวนไว้ให้
ปุ่มกับช่องกรอก (272 จุด) การสลับสองอันนี้เป็นความเพี้ยนที่สังเกตเห็นได้ทันที

> ถ้าเจอ `.glass-card` (ยังใช้อยู่ 15 จุด) ให้รู้ไว้ว่าบนจอ ≤640px มันถูกบังคับ
> `padding: 1rem !important` และ `border-radius: 1rem !important` จาก `globals.css:235`
> ดังนั้น padding ที่ใส่เป็น utility จะไม่มีผลบนมือถือ — อีกเหตุผลที่ของใหม่ควรใช้สูตรข้างบนแทน

---

## ปุ่ม

### ปุ่มยืนยันหลัก (เต็มความกว้าง — ใช้ในฟอร์มและ modal บนมือถือ)

```tsx
<button className="w-full py-3 sm:py-3.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs sm:text-sm shadow-lg shadow-indigo-600/20 flex items-center justify-center gap-2 transition-all cursor-pointer active:scale-95 disabled:opacity-50">
```

`active:scale-95` สำคัญบนมือถือ — เป็น feedback ทางสายตาเดียวที่บอกว่ากดติดแล้ว
ในสภาพที่ผู้ใช้ไม่ได้จ้องจอ

### ปุ่มในแถบเครื่องมือ (ไม่เต็มความกว้าง)

```tsx
<button className="px-4 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-semibold text-xs flex items-center gap-2 transition-colors cursor-pointer shadow-lg shadow-indigo-600/20">
```

### ปุ่มรอง

```tsx
<button className="px-4 py-2.5 rounded-xl bg-white border border-slate-200 text-slate-700 font-semibold text-xs hover:bg-slate-50 transition-colors cursor-pointer">
```

### ปุ่มทำลาย (ยกเลิก / ลบ / ปฏิเสธ)

```tsx
<button className="px-4 py-2 rounded-xl bg-rose-600 hover:bg-rose-700 text-white font-bold text-xs flex items-center gap-2 shadow-xs transition-all cursor-pointer">
```

### ปุ่มบันทึกในหน้ารับ/เบิกของ (emerald = แตะสต็อกจริง)

```tsx
<button className="w-full py-3 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-sm shadow-lg shadow-emerald-600/20 flex items-center justify-center gap-2 transition-all cursor-pointer active:scale-95">
```

**อย่าลืม `cursor-pointer`** — ใช้อยู่ 243 จุดในโปรเจค ปุ่มที่ไม่มีจะรู้สึกตายเมื่อเปิดบนเดสก์ท็อป

---

## ช่องกรอก

มาตรฐาน:

```tsx
<input className="w-full px-3.5 py-2.5 rounded-xl bg-slate-50 border border-slate-200 text-slate-900 focus:outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 text-xs sm:text-sm" />
```

ช่องที่ต้องอ่านค่าให้ชัด (บาร์โค้ด, SKU, จำนวน):

```tsx
<input className="w-full px-3.5 py-2.5 rounded-xl bg-slate-50 border border-slate-200 text-slate-900 focus:outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 text-xs sm:text-sm font-mono font-bold" />
```

ช่องขนาดใหญ่สำหรับหน้าจอที่ใช้มือเดียว (เลือกโกดัง, เลือกสินค้า):

```tsx
<select className="w-full px-4 sm:px-5 py-3.5 sm:py-4 rounded-2xl bg-white border-2 border-slate-300 text-slate-900 text-base sm:text-lg font-bold focus:outline-none focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/20 shadow-sm transition-all cursor-pointer appearance-none pr-10" />
```

> **จุดที่โปรเจคยังไม่นิ่ง** ช่องกรอกบางที่ใช้ focus สี emerald บางที่ indigo ตอนเขียนใหม่ให้ใช้
> **indigo** เพราะเป็นสีของ "การกระทำ" ตามตารางสีใน SKILL.md — emerald สงวนไว้สื่อสถานะสต็อก
> ถ้าแก้ไฟล์ที่ใช้ emerald อยู่แล้วทั้งไฟล์ ให้คงของเดิมไว้ อย่าทำให้ไฟล์เดียวมีสองสไตล์

---

## ตาราง

ตารางบนมือถืออ่านยากเสมอ ถ้าคอลัมน์เกิน 4 ให้ทำเป็นการ์ดต่อแถวบนมือถือ
แล้วค่อยเป็นตารางที่ `sm:` ขึ้นไป

```tsx
<div className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden">
  <div className="overflow-x-auto">
    <table className="w-full">
      <thead>
        <tr>
          <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">
            สินค้า
          </th>
        </tr>
      </thead>
      <tbody className="divide-y divide-slate-100 text-sm">
        <tr>
          <td className="px-5 py-3 text-slate-700">…</td>
        </tr>
      </tbody>
    </table>
  </div>
</div>
```

`overflow-x-auto` ที่ครอบตารางจำเป็นเสมอ — ไม่งั้นทั้งหน้าจะเลื่อนแนวนอนบนมือถือ
และ `body` ของแอปนี้ตั้ง `overflow-x: hidden` ไว้ ทำให้คอลัมน์ที่ล้นหายไปเงียบ ๆ แทนที่จะเลื่อนดูได้

`divide-y divide-white/[0.04]` ที่เจอในบางไฟล์คือเศษธีมมืด (มองไม่เห็นบนพื้นขาว) → เปลี่ยนเป็น
`divide-slate-100`

> **อย่าใส่ `hover:bg-*` ที่ `<tr>`** — `globals.css:127` มี `table tbody tr:hover` ที่ตั้งพื้นหลัง
> เป็นสีอินดิโก้จาง ๆ พร้อม `!important` ไว้แล้ว utility ที่ใส่เพิ่มจะถูกทับเงียบ ๆ ทำให้เสียเวลา
> ไล่หาว่าทำไมไม่มีผล (แถวตารางจึง hover เป็นสีอินดิโก้เหมือนกันทั้งแอปโดยอัตโนมัติ)

---

## Modal

```tsx
<div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-xs">
  <div className="bg-white rounded-2xl border border-slate-200 shadow-xl w-full max-w-lg max-h-[90dvh] overflow-y-auto scale-in">
    …
  </div>
</div>
```

- ใช้ `dvh` ไม่ใช่ `vh` — แถบ URL ของเบราว์เซอร์มือถือทำให้ `vh` คำนวณผิดจนปุ่มล่างถูกบัง
- `p-4` ที่ตัวคลุมกันไม่ให้ modal ชนขอบจอ
- `.scale-in` เป็นอนิเมชันที่มีอยู่แล้วใน globals.css และยังใช้งานได้ (ต่างจากคลาสที่ตายแล้ว)
- z-index ในโปรเจคนี้กระจัดกระจาย (`z-50` ถึง `z-[99999]`) ถ้าไม่ได้ซ้อนกับ modal อื่นให้ใช้ `z-50`

---

## Badge สถานะ

**อย่าใช้** `.badge-normal` / `.badge-low` / `.badge-out` จาก globals.css — สีของมันออกแบบมา
สำหรับพื้นหลังมืด (`#34d399` บนขาว = อ่านยาก) และสองในสี่ตัวไม่มีใครเรียกใช้แล้ว ใช้แบบนี้แทน:

```tsx
// ปกติ
<span className="px-2 py-0.5 rounded-full text-xs font-bold bg-emerald-100 text-emerald-700">ปกติ</span>

// ต่ำกว่าขั้นต่ำ
<span className="px-2 py-0.5 rounded-full text-xs font-bold bg-amber-100 text-amber-700">ใกล้หมด</span>

// หมด
<span className="px-2 py-0.5 rounded-full text-xs font-bold bg-rose-100 text-rose-700">หมด</span>

// ติดลบ (ข้อมูลผิดปกติ ต้องตรวจสอบ)
<span className="px-2 py-0.5 rounded-full text-xs font-bold bg-purple-100 text-purple-700">ติดลบ</span>

// กลาง ๆ / ข้อมูลทั่วไป
<span className="px-2 py-0.5 rounded-full text-xs font-bold bg-slate-100 text-slate-600">ร่าง</span>
```

คู่ `bg-{สี}-100` + `text-{สี}-700` ให้ contrast ที่อ่านออกบนพื้นขาวทุกสี ใช้สูตรนี้กับสีใหม่ได้เลย

---

## Empty state

```tsx
<div className="rounded-2xl p-16 text-center border border-slate-200 bg-white shadow-sm">
  <p className="text-slate-500 text-sm">ยังไม่มีรายการในช่วงเวลานี้</p>
  <p className="text-slate-400 text-xs mt-1">ลองเปลี่ยนตัวกรองวันที่หรือโกดัง</p>
</div>
```

บรรทัดที่สองสำคัญ — บอกทางออกให้ผู้ใช้ ไม่ใช่แค่แจ้งว่าว่าง

---

## Loading

```tsx
<div className="flex items-center justify-center py-16">
  <div className="w-8 h-8 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
</div>
```

ในปุ่มขณะกำลังส่ง:

```tsx
<svg className="animate-spin h-4 w-4 text-white" viewBox="0 0 24 24">…</svg>
```

ปุ่มที่กำลังทำงานต้อง `disabled` ด้วยเสมอ — ระบบนี้ยิง mutation ไป Google Sheets ซึ่งช้าพอ
ที่ผู้ใช้จะกดซ้ำได้ง่าย (มี idempotency key กันไว้ชั้นหนึ่งแล้ว แต่ UI ไม่ควรชวนให้กดซ้ำตั้งแต่แรก)

---

## ฟอร์ม

ใช้ `react-hook-form` + `zod` ผ่าน `@hookform/resolvers` ตามที่โปรเจคทำอยู่

```tsx
<div className="space-y-1.5">
  <label className="block text-xs font-semibold text-slate-700">จำนวน</label>
  <input {...register("qty", { valueAsNumber: true })} className="…" />
  {errors.qty && (
    <p className="text-xs text-rose-600 font-medium">{errors.qty.message}</p>
  )}
</div>
```

ข้อความ error อยู่ใต้ช่อง ไม่ใช่ลอยอยู่บนสุดของฟอร์ม — บนมือถือ ผู้ใช้เลื่อนหน้าจอแล้ว
จะไม่เห็น error ที่อยู่นอกจอ

สรุป error รวมของทั้งฟอร์ม (เช่นจาก API):

```tsx
<div className="rounded-xl bg-rose-50 border border-rose-200 px-3.5 py-2.5">
  <p className="text-xs font-semibold text-rose-700">{error}</p>
</div>
```

---

## ตัวเลขและบาร์โค้ด

```tsx
// จำนวน — คั่นหลักพันเสมอ
<span className="font-mono font-bold text-slate-900">{qty.toLocaleString()}</span>

// SKU / เลขที่เอกสาร
<span className="font-mono text-xs text-slate-500">{doc.document_no}</span>

// บาร์โค้ดที่สแกนได้จริง
import BarcodeSvg from "@/components/ui/BarcodeSvg";
import { to8DigitBarcode } from "@/lib/barcode-utils";

<BarcodeSvg value={to8DigitBarcode(product.barcode, product.sku)} showText />
```

`BarcodeSvg` รองรับ `width`, `height`, `showText`, `fontSize`, `textPosition`, `disableZoom`
โดยค่าเริ่มต้นกดแล้วขยายเต็มจอได้ ซึ่งจำเป็นเวลาต้องยิงสแกนเนอร์เข้าหน้าจอมือถือ —
**อย่าใส่ `disableZoom` เว้นแต่บาร์โค้ดนั้นอยู่ในใบพิมพ์**
