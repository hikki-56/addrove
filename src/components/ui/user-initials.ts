// อักษรย่อชื่อสำหรับอวาตาร์ (Minimal UI v3b) — ใช้ร่วมกันระหว่าง Navbar และกิจกรรมวันนี้บนแดชบอร์ด

// สระหน้า (เ แ โ ใ ไ) และวรรณยุกต์/สระบนล่างของไทย — ข้ามเมื่อหาตัวอักษรแรกของชื่อ
const THAI_NON_INITIAL = /[\u0E31\u0E33-\u0E3A\u0E40-\u0E44\u0E47-\u0E4E]/;

function firstLetter(word: string): string {
  return Array.from(word).find((ch) => !THAI_NON_INITIAL.test(ch)) ?? "";
}

/** อักษรย่อชื่อ (สูงสุด 2 ตัว) — ชื่อ 2 คำ = ตัวอักษรแรกของแต่ละคำ เช่น "สมชาย ใจดี" → "สจ" */
export function userInitials(name?: string | null): string {
  const parts = (name || "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "U";
  const initials = firstLetter(parts[0]) + (parts.length > 1 ? firstLetter(parts[1]) : "");
  return initials.toUpperCase() || "U";
}

// โทนสีอวาตาร์ (soft bg + สีตัวอักษรเข้ม) ตาม mockup D01 — เลือกจากชื่อแบบคงที่ ชื่อเดิมได้สีเดิมเสมอ
const AVATAR_TONES = [
  "bg-[rgba(0,184,217,0.16)] text-m3-info-dark",
  "bg-[rgba(142,51,255,0.16)] text-m3-secondary-dark",
  "bg-[rgba(255,171,0,0.16)] text-m3-warning-dark",
  "bg-[rgba(0,167,111,0.16)] text-m3-primary-dark",
  "bg-[rgba(255,86,48,0.16)] text-m3-error-dark",
] as const;

export function avatarToneClass(name?: string | null): string {
  let h = 0;
  for (const ch of name || "") h = (h * 31 + ch.codePointAt(0)!) >>> 0;
  return AVATAR_TONES[h % AVATAR_TONES.length];
}
