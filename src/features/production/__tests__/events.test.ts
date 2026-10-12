import { __testing } from "@/features/production/lib/events";

describe("production broadcast messages", () => {
  const { TAB_ID, isUpdateFromOtherTab } = __testing;

  it("accepts update messages from other tabs only", () => {
    expect(isUpdateFromOtherTab({ type: "updated", source: "other-tab" })).toBe(true);
    expect(isUpdateFromOtherTab({ type: "updated", source: TAB_ID })).toBe(false);
  });

  it("ignores unrelated payloads", () => {
    for (const d of [null, undefined, "updated", 1, {}, { type: "other", source: "x" }]) {
      expect(isUpdateFromOtherTab(d)).toBe(false);
    }
  });
});
