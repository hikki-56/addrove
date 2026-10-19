// โลโก้กล่อง 3 ด้านของ Minimal UI v3b (สีคงที่ตาม mockup)
export function StockifyMark({ size = 32, className }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true" focusable="false" className={className}>
      <path d="M16 3 28 9.5v13L16 29 4 22.5v-13z" fill="#5BE49B" />
      <path d="M16 3 28 9.5 16 16 4 9.5z" fill="#00A76F" />
      <path d="M16 16v13l12-6.5v-13z" fill="#007867" />
    </svg>
  );
}

export function StockifyLogo({ className = "" }: { className?: string }) {
  return (
    <span className={`inline-flex items-center gap-2.5 font-m3-disp text-[18px] font-extrabold tracking-[-0.01em] text-m3-grey-800 ${className}`}>
      <StockifyMark />
      Stockify
    </span>
  );
}
