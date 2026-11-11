"use client";

import { useState } from "react";
import { SolarPrinter } from "@/components/icons";
import { buildShelfLetterLabels, type ShelfLetter } from "@/lib/planned-locations";
import PlannedShelfPrintPreview from "./PlannedShelfPrintPreview";

export default function ShelfLetterLabels() {
  const [letters, setLetters] = useState<ShelfLetter[]>(["A", "B", "C"]);
  const [copies, setCopies] = useState("3");
  const [textColor, setTextColor] = useState<"black" | "white">("black");
  const [printing, setPrinting] = useState<ShelfLetter[] | null>(null);
  const labels = buildShelfLetterLabels(letters, Number(copies));

  return (
    <section className="planned-shelf-panel planned-shelf-controls" aria-labelledby="shelf-letter-title">
      <div className="planned-shelf-heading">
        <div>
          <div className="planned-shelf-title"><h2 id="shelf-letter-title">ป้ายตัวอักษรชั้นวาง A / B / C</h2></div>
          <p>ตัวอักษรแยกใบ ขนาดใหญ่ สำหรับติดชั้นวาง · A4 แนวนอน 9 ป้ายต่อหน้า</p>
        </div>
        <div className="planned-shelf-actions">
          <button type="button" className="m3-btn m3-btn-primary" disabled={!labels.length} onClick={() => setPrinting(labels)}>
            <SolarPrinter size={18} />พิมพ์ป้ายตัวอักษร ({labels.length})
          </button>
        </div>
      </div>
      <div className="planned-shelf-letter-controls">
        <fieldset className="planned-shelf-letter-choices">
          <legend>เลือกตัวอักษร</legend>
          <div>{(["A", "B", "C"] as const).map((letter) => (
            <label key={letter}>
              <input type="checkbox" checked={letters.includes(letter)} onChange={() => setLetters((current) => current.includes(letter)
                ? current.filter((item) => item !== letter) : [...current, letter])} />
              <span>{letter}</span>
            </label>
          ))}</div>
        </fieldset>
        <label className="planned-shelf-letter-copies">จำนวนต่ออักษร (1–100)
          <input type="number" min={1} max={100} step={1} value={copies} onChange={(event) => setCopies(event.target.value)} />
        </label>
        <label className="planned-shelf-letter-copies">สีตัวอักษร
          <select value={textColor} onChange={(event) => setTextColor(event.target.value === "white" ? "white" : "black")}>
            <option value="black">สีดำ</option>
            <option value="white">สีขาว</option>
          </select>
        </label>
        <p className="planned-shelf-letter-total" role="status">รวม {labels.length} ป้าย</p>
      </div>
      {printing && <PlannedShelfPrintPreview letterLabels={printing} letterTextColor={textColor} onClose={() => setPrinting(null)} />}
    </section>
  );
}
