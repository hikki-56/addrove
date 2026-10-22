import { BOM_EDITOR_EMAIL, canEditBom, filterBomFormulas, validateBomDraft, type BomEditorInput } from "@/lib/bom-editor";

const base = (): BomEditorInput => ({
  bom_id: "BOM-1", revision: "r1", unit: "ชุด", base_qty: 1,
  items: [{ item_id: 1, sku: "RM-1", qty: 2, unit: "ชิ้น", waste_percentage: 0, is_primary: 1 }],
});

describe("canEditBom", () => {
  it("allows only the BOM editor account (case/space-insensitive)", () => {
    expect(BOM_EDITOR_EMAIL).toBe("ty@stockify.com");
    expect(canEditBom("ty@stockify.com")).toBe(true);
    expect(canEditBom("  TY@Stockify.com ")).toBe(true);
  });
  it("denies others and missing emails", () => {
    for (const e of ["milk@stockify.com", "ty@stockify.co", "ty", "", null, undefined]) expect(canEditBom(e)).toBe(false);
  });
});

describe("validateBomDraft", () => {
  it("accepts a valid draft", () => expect(validateBomDraft(base())).toEqual([]));
  it("rejects empty items, bad base qty and missing primary", () => {
    expect(validateBomDraft({ ...base(), items: [] })).toContain("สูตรต้องมีวัตถุดิบอย่างน้อย 1 รายการ");
    expect(validateBomDraft({ ...base(), base_qty: 0 }).length).toBe(1);
    expect(validateBomDraft({ ...base(), items: [{ ...base().items[0], is_primary: 0 }] })).toContain("สูตรต้องมีวัตถุดิบหลักอย่างน้อย 1 รายการ");
  });
  it("flags per-row problems", () => {
    const d = base();
    d.items.push({ sku: "rm-1", qty: NaN, unit: "", waste_percentage: 120, is_primary: 1 });
    const errs = validateBomDraft(d);
    expect(errs.some((e) => e.includes("ซ้ำ"))).toBe(true);
    expect(errs.some((e) => e.includes("จำนวนใช้"))).toBe(true);
    expect(errs.some((e) => e.includes("หน่วย"))).toBe(true);
    expect(errs.some((e) => e.includes("อัตราสูญเสีย"))).toBe(true);
    expect(validateBomDraft({ ...base(), items: [{ ...base().items[0], qty: 1.0005 }] }).length).toBe(1);
  });
});

describe("filterBomFormulas", () => {
  const list = [
    { bom_id: "A", sku: "FG-1", name: "โต๊ะ", items: [{ sku: "WOOD", name: "ไม้", qty: 1, unit: "ชิ้น", waste_percentage: 0, is_primary: 1 as const }] },
    { bom_id: "B", sku: "FG-2", name: "เก้าอี้", items: [] },
  ];
  it("matches formula and material fields", () => {
    expect(filterBomFormulas(list, "").length).toBe(2);
    expect(filterBomFormulas(list, "wood").map((f) => f.bom_id)).toEqual(["A"]);
    expect(filterBomFormulas(list, "เก้าอี้").map((f) => f.bom_id)).toEqual(["B"]);
  });
});
