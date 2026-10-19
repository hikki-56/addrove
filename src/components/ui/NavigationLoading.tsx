// สถานะโหลดระหว่างเปลี่ยนหน้า (D52 / M51) — วงแหวนเขียว + "กำลังเปิดหน้า…"
export default function NavigationLoading() {
  return (
    <div
      role="status"
      className="flex min-h-[50vh] flex-col items-center justify-center gap-3 text-m3-primary-dark"
    >
      <span
        aria-hidden="true"
        className="size-8 animate-spin rounded-full border-[3px] border-m3-primary border-r-transparent"
      />
      <p className="text-[14px] font-semibold">กำลังเปิดหน้า…</p>
    </div>
  );
}
