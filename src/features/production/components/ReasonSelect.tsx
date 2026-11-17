"use client";

import { useState } from "react";
import { m3Cls } from "@/components/ui/m3";

interface Props { label: string; ariaLabel?: string; value: string; options: string[]; disabled: boolean; onChange: (value: string) => void }

export default function ReasonSelect({ label, ariaLabel = label, value, options, disabled, onChange }: Props) {
  const [custom, setCustom] = useState(false);
  const other = custom || (!!value && !options.includes(value));
  return <div className="space-y-2">
    <label className="block text-xs font-semibold">{label}
      <select aria-label={ariaLabel} disabled={disabled} value={other ? "__other" : value} onChange={e => {
        setCustom(e.target.value === "__other");
        onChange(e.target.value === "__other" ? "" : e.target.value);
      }} className={`mt-1 h-10 ${m3Cls.input}`}>
        <option value="">เลือกสาเหตุ</option>
        {options.map(option => <option key={option} value={option}>{option}</option>)}
        <option value="__other">อื่น ๆ</option>
      </select>
    </label>
    {other && <input aria-label={`${ariaLabel} อื่น ๆ`} placeholder="ระบุสั้น ๆ" disabled={disabled} value={value} onChange={e => onChange(e.target.value)} className={m3Cls.input} />}
  </div>;
}
