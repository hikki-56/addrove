export default function NavigationLoading() {
  return (
    <div
      role="status"
      className="flex min-h-[50vh] flex-col items-center justify-center gap-3 text-[#06402B]"
    >
      <span
        aria-hidden="true"
        className="h-8 w-8 animate-spin rounded-full border-2 border-[#06402B] border-t-transparent"
      />
      <p className="text-sm font-semibold">กำลังเปิดหน้า…</p>
    </div>
  );
}
