"use client";

import { useEscapeKey } from "@/hooks/use-escape-key";
import { M3Banner, M3Dialog, m3Cls } from "@/components/ui/m3";
import { SolarDangerTriangle } from "@/components/icons";

interface PlanExitConfirmModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  lineCount: number;
  planNo: string;
}

// กันแตะ "ออกจากโหมดแผน" พลาด — ถ้ามีรายการที่สแกนอยู่ต้องยืนยันก่อนจึงจะล้างเซสชันได้
export default function PlanExitConfirmModal({ isOpen, onClose, onConfirm, lineCount, planNo }: PlanExitConfirmModalProps) {
  useEscapeKey(isOpen, onClose);

  if (!isOpen) return null;

  return (
    <M3Dialog
      title="ออกจากโหมดแผน?"
      icon={<SolarDangerTriangle size={28} />}
      iconTone="error"
      widthClass="sm:max-w-[440px]"
      footer={
        <>
          <button type="button" onClick={onClose} className={m3Cls.btnCancel}>
            ยกเลิก — สแกนต่อ
          </button>
          <button
            type="button"
            onClick={() => {
              onClose();
              onConfirm();
            }}
            className={m3Cls.btnDanger}
          >
            ออกและล้างรายการ
          </button>
        </>
      }
    >
      <M3Banner tone="error">ล้าง {lineCount} รายการที่ยังไม่บันทึกในแผน {planNo} — กู้คืนไม่ได้</M3Banner>
    </M3Dialog>
  );
}
