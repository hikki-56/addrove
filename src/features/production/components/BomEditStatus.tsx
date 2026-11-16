const editTimeFormat = new Intl.DateTimeFormat("th-TH", { dateStyle: "short", timeStyle: "short", timeZone: "Asia/Bangkok" });

export default function BomEditStatus({ editedAt }: { editedAt?: string | null }) {
  return <div className="flex flex-wrap items-center gap-2">
    <span className={`m3-label shrink-0 ${editedAt ? "m3-label-success" : "m3-label-warning"}`}>{editedAt ? "แก้ไขแล้ว" : "ยังไม่แก้ไข"}</span>
    {editedAt && <span className="text-xs text-m3-grey-500">แก้ไขล่าสุด <time dateTime={editedAt}>{editTimeFormat.format(new Date(editedAt))}</time></span>}
  </div>;
}
