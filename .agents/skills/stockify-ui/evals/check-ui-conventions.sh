#!/usr/bin/env bash
# ตรวจไฟล์ .tsx ว่าทำตามกติกาใน stockify-ui หรือยัง
#
#   bash .claude/skills/stockify-ui/evals/check-ui-conventions.sh <ไฟล์...>
#   bash .claude/skills/stockify-ui/evals/check-ui-conventions.sh $(git diff --name-only | grep '\.tsx$')
#
# ตัวตรวจพวกนี้จับได้แค่สิ่งที่ grep เห็น — ผ่านครบไม่ได้แปลว่า UI ดี
# แต่ถ้าไม่ผ่าน แปลว่ามีของที่ขัดกับหน้าอื่นในแอปแน่ ๆ

set -uo pipefail
[ $# -eq 0 ] && { echo "ใช้: $0 <ไฟล์.tsx ...>"; exit 2; }

fail=0
for f in "$@"; do
  [ -f "$f" ] || { echo "ข้าม (ไม่พบไฟล์): $f"; continue; }
  echo "── $f"

  report() { # ชื่อ  เงื่อนไขที่ "ผ่าน"
    if eval "$2"; then printf '   ✅ %s\n' "$1"; else printf '   ❌ %s\n' "$1"; fail=1; fi
  }

  # breakpoint: โปรเจคใช้ sm: เป็นหลัก md:/lg: ที่ไม่มี sm: คู่ มักเป็นความเคยชินที่หลุดมา
  report "ไม่ใช้ md:/lg: โดยไม่มี sm:" \
    "! grep -qE '\b(md|lg):' '$f' || grep -q 'sm:' '$f'"

  # เศษธีมมืดบนพื้นขาว = ผู้ใช้มองไม่เห็นตัวหนังสือ
  report "ไม่มีเศษธีมมืด (bg-white/5, bg-[#0a0a0f], text-gray-300)" \
    "! grep -qE 'bg-white/5|bg-\\[#0[0-9a-f]{5}\\]|text-gray-300' '$f'"

  # token layer ตายแล้ว — ของใหม่ต้องเป็น utility
  report "ไม่ใช้ var(--...) หรือคลาส .admin-*/.badge-low ที่ตายแล้ว" \
    "! grep -qE 'var\(--|admin-button-|admin-tab|badge-low|badge-negative' '$f'"

  # ไม่มี icon library เป็น dependency ในโปรเจคนี้
  report "ไม่ import icon library" \
    "! grep -qE \"from ['\\\"](lucide-react|@heroicons|react-icons)\" '$f'"

  # จำนวนของจริงในคลัง — อ่านผิดหลักคือของหาย
  report "ถ้ามี qty/quantity แสดงผล ต้องผ่าน toLocaleString()" \
    "! grep -qE '\{[a-zA-Z_.]*(qty|quantity|Qty)[a-zA-Z_.]*\}' '$f' || grep -q 'toLocaleString' '$f'"

  # ปุ่มบนมือถือต้องรู้สึกว่ากดติด และกดซ้ำไม่ได้ตอนกำลังส่ง
  report "ปุ่มมี cursor-pointer" \
    "! grep -q '<button' '$f' || grep -q 'cursor-pointer' '$f'"

  # vh คำนวณผิดบนเบราว์เซอร์มือถือจนปุ่มล่างถูกบัง
  report "modal ใช้ dvh ไม่ใช่ vh" \
    "! grep -q 'fixed inset-0' '$f' || ! grep -qE '\[[0-9]+vh\]' '$f'"

  # ข้อความ validation ของโปรเจคขึ้นต้นด้วย 'กรุณา'
  report "ข้อความ validation ขึ้นต้นด้วย 'กรุณา'" \
    "! grep -q 'setError(\"[ก-๙]' '$f' || grep -q 'setError(\"กรุณา' '$f'"
done

echo
[ $fail -eq 0 ] && echo "ผ่านทั้งหมด" || echo "มีข้อที่ไม่ผ่าน — ดู references/patterns.md สำหรับสูตรที่ถูกต้อง"
exit $fail
