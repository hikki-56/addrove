import { useEffect, useRef, useState } from "react";
import { errorText, getCount, sendCount } from "@/app/(dashboard)/stock-counts/_lib/count-client";
import { readReferenceFile } from "@/app/(dashboard)/stock-counts/_lib/reference-file";
import type { CountReferenceFile } from "@/types/count-round";

export default function ReferenceUpload({ warehouse, name, onImported }: {
  warehouse: string; name: string; onImported: () => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<CountReferenceFile | null>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [loadError, setLoadError] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    const refresh = () => {
      if (document.hidden) return;
      getCount<CountReferenceFile | null>({ warehouse, reference: "1" }, controller.signal)
        .then(next => {
          setFile(current => current && current.id >= (next?.id ?? 0) ? current : next);
          setLoadError("");
        }).catch(e => { if (!controller.signal.aborted) setLoadError(errorText(e)); });
    };
    refresh();
    const timer = window.setInterval(refresh, 60000);
    document.addEventListener("visibilitychange", refresh);
    return () => { controller.abort(); clearInterval(timer); document.removeEventListener("visibilitychange", refresh); };
  }, [warehouse]);

  async function upload(selected: File) {
    setBusy(true); setError("");
    try {
      const rows = await readReferenceFile(selected);
      const saved = await sendCount<CountReferenceFile>({ action: "reference", warehouse, name: selected.name, rows });
      setFile(current => current && current.id > saved.id ? current : saved);
      setLoadError("");
      onImported();
    } catch (e) { setError(errorText(e)); } finally { setBusy(false); }
  }
  return <section className="m3-card space-y-2 p-4">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <h2 className="font-bold">ไฟล์เทียบยอด · {name}</h2>
      <button type="button" className="m3-btn m3-btn-outline min-h-11" disabled={busy} onClick={() => input.current?.click()}>
        {busy ? "กำลังนำเข้า…" : "นำเข้าไฟล์เทียบยอด"}
      </button>
      <input ref={input} type="file" className="hidden" accept=".xlsx,.csv" aria-label="ไฟล์เทียบยอด" onChange={e => {
        const selected = e.target.files?.[0];
        e.target.value = "";
        if (selected) void upload(selected);
      }} />
    </div>
    {file && <p className="break-all text-sm">กำลังใช้ {file.file_name} · {file.row_count.toLocaleString()} รายการ</p>}
    {!!file?.unmatched_count && <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">{file.unmatched_count.toLocaleString()} รายการไม่พบในระบบ จะจับคู่เมื่อสแกน</p>}
    {file === null && <p className="text-sm">ยังไม่มีไฟล์เทียบยอดสำหรับโกดังนี้</p>}
    <p className="text-sm text-m3-grey-600">นำเข้ารายงาน “สินค้าคงเหลือ แยกตามคลังสินค้า” หรือ Excel/CSV ที่มีรหัสสินค้าและจำนวน ระบบรวมยอดนับทุกชั้นของวันที่เลือก และเทียบกับไฟล์ล่าสุด ณ วันนั้น</p>
    {(error || loadError) && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">{error || loadError}</p>}
  </section>;
}
