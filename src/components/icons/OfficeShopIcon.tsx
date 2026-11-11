import React from "react";
import type { SolarIconProps } from "./solar";

export function OfficeShopIcon({ size = 22, ...props }: SolarIconProps) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true" {...props}><path fill="currentColor" opacity=".4" d="M4 9h16v10a3 3 0 0 1-3 3H7a3 3 0 0 1-3-3V9Z" /><path fill="currentColor" d="M8 2H5.5a2 2 0 0 0-1.94 1.52L2.1 9.36A3 3 0 0 0 8 10V2Zm8 0h2.5a2 2 0 0 1 1.94 1.52l1.46 5.84A3 3 0 0 1 16 10V2ZM10 16h4v6h-4z" /><path fill="currentColor" opacity=".7" d="M8 2h8v8a4 4 0 0 1-8 0V2Z" /></svg>;
}
