import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createFormControl } from "react-hook-form";
import PlanProgressPanel from "@/features/receive/components/PlanProgressPanel";
import type { ReceiveDocumentInput } from "@/types/api";
import type { ReceivingPlanView } from "@/features/receive/hooks/use-receiving-plans";

function fixture() {
  const plan: ReceivingPlanView = {
    document_id: "plan-1", document_no: "RP-1", status: "PROCESSING",
    warehouse_id: "wh-1", warehouse_name: "โกดัง 1", reference_no: "",
    expected_date: "", note: "", created_by: "test", created_by_name: "Test", created_at: "",
    lines: [
      { product_id: "prod-1", sku: "P1", barcode: "TEST1", product_name: "Product 1", base_unit: "ชิ้น", expected_qty: 50, received_qty: 0, fulfilled: false },
      { product_id: "prod-2", sku: "P2", barcode: "TEST2", product_name: "Product 2", base_unit: "หลอด", expected_qty: 30, received_qty: 10, fulfilled: false },
      { product_id: "prod-3", sku: "P3", barcode: "TEST3", product_name: "Checklist", base_unit: "ชิ้น", received_qty: 0, fulfilled: false },
    ],
    receipts: [],
    progress: { lines_total: 3, lines_with_target: 2, lines_fulfilled: 0, has_target: true, fully_received: false },
  };
  const form = createFormControl<ReceiveDocumentInput>({ defaultValues: { lines: [] } });
  const unsubscribe = form.subscribe({ formState: { values: true }, callback: () => {} });
  const render = () => renderToStaticMarkup(React.createElement(PlanProgressPanel, { plan, control: form.control }))
    .replace(/<[^>]+>/g, "");
  const line = (product_id: string, qty: number): ReceiveDocumentInput["lines"][number] => ({
    product_id, qty, boxes: 1, location_id: "", extra_locations: [], extra_qtys: [], location_allocations: [],
  });
  return { plan, form, render, line, unsubscribe };
}

test("scanned quantities and completed targets display before confirming a line or saving a receipt", () => {
  const { plan, form, render, line, unsubscribe } = fixture();
  try {
    expect(render()).toContain("ครบตามจำนวน 0/2");
    form.setValue("lines", [line("prod-1", 25)]);
    expect(render()).toContain("สแกนรอบนี้ 25 ชิ้น");
    expect(render()).toContain("25/50 ชิ้น");
    form.setValue("lines.0.qty", 50);
    expect(render()).toContain("50/50 ชิ้น");
    expect(render()).toContain("ครบตามจำนวน 1/2");
    expect(plan.progress.lines_fulfilled).toBe(0);
    expect(plan.receipts).toEqual([]);
    expect(form.getValues("lines.0.location_id")).toBe("");
  } finally { unsubscribe(); }
});

test("live totals include earlier receipts and react to quantity corrections and removal", () => {
  const { form, render, line, unsubscribe } = fixture();
  try {
    form.setValue("lines", [line("prod-2", 20)]);
    expect(render()).toContain("30/30 หลอด");
    expect(render()).toContain("ครบตามจำนวน 1/2");
    form.setValue("lines.0.qty", 25);
    expect(render()).toContain("35/30 หลอด");
    expect(render()).toContain("เกินเป้าที่คาดไว้ 30");
    form.setValue("lines.0.qty", 5);
    expect(render()).toContain("15/30 หลอด");
    expect(render()).toContain("ครบตามจำนวน 0/2");
    form.setValue("lines", []);
    expect(render()).toContain("10/30 หลอด");
    expect(render()).not.toContain("สแกนรอบนี้ 5 หลอด");
  } finally { unsubscribe(); }
});

test("split product rows add up once and checklist quantities do not inflate the target count", () => {
  const { form, render, line, unsubscribe } = fixture();
  try {
    form.setValue("lines", [line("prod-1", 20), line("prod-1", 30), line("prod-3", 100)]);
    expect(render()).toContain("50/50 ชิ้น");
    expect(render()).toContain("ครบตามจำนวน 1/2");
    expect(render()).toContain("สแกนรอบนี้ 100 ชิ้น");
    expect(render()).toContain("เช็คลิสต์ (ไม่ตั้งเป้า)");
  } finally { unsubscribe(); }
});
