import { withKeyedLock } from "@/lib/keyed-lock";

describe("withKeyedLock — re-entrancy", () => {
  it("การเรียกซ้อนด้วย key เดิมใน chain เดียวกันต้องผ่าน ไม่ deadlock", async () => {
    const result = await withKeyedLock("doc-x", async () => {
      const inner = await withKeyedLock("doc-x", async () => "inner done");
      return `outer got: ${inner}`;
    });
    expect(result).toBe("outer got: inner done");
  }, 5000);

  it("key ต่างกันยัง serialize ตามปกติ (รันตามลำดับ ไม่ทับกัน)", async () => {
    const order: string[] = [];
    const job = (name: string, ms: number) =>
      withKeyedLock("same-key", async () => {
        order.push(`start:${name}`);
        await new Promise((r) => setTimeout(r, ms));
        order.push(`end:${name}`);
      });
    await Promise.all([job("a", 30), job("b", 5)]);
    expect(order).toEqual(["start:a", "end:a", "start:b", "end:b"]);
  });

  it("context คนละสายงาน ไม่ถือ key ของกันและกัน (คนละสาย = ต้องต่อคิวจริง)", async () => {
    let concurrent = 0;
    let maxConcurrent = 0;
    const job = () =>
      withKeyedLock("k", async () => {
        concurrent += 1;
        maxConcurrent = Math.max(maxConcurrent, concurrent);
        await new Promise((r) => setTimeout(r, 20));
        concurrent -= 1;
      });
    await Promise.all([job(), job(), job()]);
    expect(maxConcurrent).toBe(1);
  });

  it("ปล่อย lock ครบแม้ operation โยน error", async () => {
    await expect(
      withKeyedLock("err-key", async () => {
        throw new Error("boom");
      })
    ).rejects.toThrow("boom");
    // ยืนยันว่า lock ว่างแล้ว — ใช้ต่อได้ทันที
    const after = await withKeyedLock("err-key", async () => "ok");
    expect(after).toBe("ok");
  });
});
