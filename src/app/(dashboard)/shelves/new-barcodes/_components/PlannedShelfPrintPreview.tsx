"use client";

import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import BarcodeSvg from "@/components/ui/BarcodeSvg";
import { useEscapeKey } from "@/hooks/use-escape-key";
import { buildPlannedShelfPrintPages } from "@/lib/planned-locations";
import type { PlannedLocation } from "@/types/planned-location";

export default function PlannedShelfPrintPreview({ locations, onClose }: {
  locations: PlannedLocation[];
  onClose: () => void;
}) {
  const root = useRef<HTMLDivElement>(null);
  const close = useRef<HTMLButtonElement>(null);
  const pages = buildPlannedShelfPrintPages(locations);
  useEscapeKey(true, onClose);

  useEffect(() => {
    const previousFocus = document.activeElement as HTMLElement | null;
    document.body.classList.add("planned-shelf-print-open");
    document.documentElement.classList.add("planned-shelf-print-open");
    close.current?.focus();
    return () => {
      document.body.classList.remove("planned-shelf-print-open");
      document.documentElement.classList.remove("planned-shelf-print-open");
      if (previousFocus?.isConnected) previousFocus.focus();
    };
  }, []);

  return createPortal(
    <div id="planned-shelf-print-root" ref={root} role="dialog" aria-modal="true" aria-labelledby="planned-shelf-print-title"
      onKeyDown={(event) => {
        if (event.key !== "Tab") return;
        const buttons = root.current?.querySelectorAll<HTMLButtonElement>("button");
        if (!buttons?.length) return;
        if (event.shiftKey && document.activeElement === buttons[0]) {
          event.preventDefault(); buttons[buttons.length - 1].focus();
        } else if (!event.shiftKey && document.activeElement === buttons[buttons.length - 1]) {
          event.preventDefault(); buttons[0].focus();
        }
      }}>
      <div className="planned-shelf-print-toolbar">
        <div>
          <h2 id="planned-shelf-print-title">ตัวอย่างก่อนพิมพ์บาร์โค้ดชั้นวางใหม่</h2>
          <p>{locations.length.toLocaleString("th-TH")} ป้าย · {pages.length} หน้า · A4 แนวนอน · 9 ป้ายต่อหน้า</p>
        </div>
        <div className="planned-shelf-actions">
          <button type="button" ref={close} className="m3-btn m3-btn-outline" onClick={onClose}>ปิดตัวอย่าง</button>
          <button type="button" className="m3-btn m3-btn-primary" onClick={() => window.print()}>พิมพ์ป้าย</button>
        </div>
      </div>
      <div className="planned-shelf-print-pages">
        {pages.map((page, index) => (
          <div className="planned-shelf-print-page" key={index}>
            {page.map((location) => (
              <article className="planned-shelf-print-label" key={location.planned_location_id}>
                <strong>{location.location_code}</strong>
                <div className="planned-shelf-print-barcode">
                  <BarcodeSvg value={location.location_code} width={2} height={64} showText={false} disableZoom className="w-full border-0 bg-white p-0 shadow-none" />
                </div>
                <p>{location.warehouse_name}</p>
              </article>
            ))}
          </div>
        ))}
      </div>
    </div>, document.body
  );
}
