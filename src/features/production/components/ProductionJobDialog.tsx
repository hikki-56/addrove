"use client";

import { useCallback, useState } from "react";
import { useEscapeKey } from "@/hooks/use-escape-key";
import { M3Dialog, m3Cls } from "@/components/ui/m3";
import TableProductionResult from "./TableProductionResult";

export default function ProductionJobDialog({ jobNo, role, onClose, onBusyChange }: {
  jobNo: string; role?: string; onClose: () => void; onBusyChange: (busy: boolean) => void;
}) {
  const [busy, setBusy] = useState(false);
  const changeBusy = useCallback((pending: boolean) => { setBusy(pending); onBusyChange(pending); }, [onBusyChange]);
  useEscapeKey(!busy, onClose);
  return <M3Dialog title="งานผลิต" widthClass="sm:max-w-[600px]" onBackdrop={() => !busy && onClose()}
    footer={<button type="button" disabled={busy} onClick={onClose} className={m3Cls.btnCancel}>ปิด</button>}>
    <TableProductionResult key={jobNo} jobNo={jobNo} role={role} onBusyChange={changeBusy} />
  </M3Dialog>;
}
