// ============================================================
// Unit Tests — ตัวกรองผู้ทำรายการของส่วน "กิจกรรมวันนี้"
// (_lib/today-activities.ts)
// - Dropdown มาจากรายชื่อผู้ทำกิจกรรมในวันนั้น ไม่ซ้ำรายชื่อ
// - เลือกบุคคล → แสดงเฉพาะกิจกรรมของคนนั้น
// ============================================================
import {
  ALL_ACTORS_VALUE,
  buildActorOptions,
  filterActivitiesByActor,
} from "@/app/(dashboard)/dashboard/_lib/today-activities";
import type { TodayActivity } from "@/types/models";

function activity(overrides: Partial<TodayActivity> & { id: string }): TodayActivity {
  return {
    actor_id: "user-1",
    actor_name: "สมชาย ใจดี",
    action_type: "RECEIVE",
    action_label: "รับสินค้า",
    quantity: 10,
    unit: "ชิ้น",
    created_at: "2026-09-08T03:00:00.000Z",
    ...overrides,
  };
}

const ACTIVITIES: TodayActivity[] = [
  activity({ id: "a1", actor_id: "user-2", actor_name: "สมหญิง ขยัน", quantity: 5 }),
  activity({ id: "a2", actor_id: "user-1", actor_name: "สมชาย ใจดี", quantity: 10 }),
  activity({ id: "a3", actor_id: "user-2", actor_name: "สมหญิง ขยัน", quantity: 7 }),
  activity({ id: "a4", actor_id: "user-1", actor_name: "สมชาย ใจดี", quantity: 2 }),
];

describe("buildActorOptions — ตัวเลือก dropdown ผู้ทำรายการ", () => {
  it("รายชื่อไม่ซ้ำตาม actor_id แม้ทำหลายกิจกรรม", () => {
    const options = buildActorOptions(ACTIVITIES);

    expect(options).toHaveLength(2);
    const ids = options.map((o) => o.id);
    expect(new Set(ids).size).toBe(2);
    expect(ids).toEqual(expect.arrayContaining(["user-1", "user-2"]));
  });

  it("แต่ละ option ใช้ user id เป็นค่าภายในและชื่อบุคคลเป็นข้อความแสดงผล", () => {
    const options = buildActorOptions(ACTIVITIES);

    for (const option of options) {
      expect(option.id).not.toMatch(/^[0-9a-f]{8}-/i); // ห้าม UUID เป็นข้อความแสดงผล
      expect(option.name.length).toBeGreaterThan(0);
      expect(option.name).not.toBe(option.id);
    }
  });

  it("actor_id ว่าง/ชื่อว่าง → รวมเป็นกลุ่มไม่ทราบผู้ทำรายการ ครั้งเดียว", () => {
    const options = buildActorOptions([
      activity({ id: "a1", actor_id: "", actor_name: "" }),
      activity({ id: "a2", actor_id: "   ", actor_name: "   " }),
    ]);

    expect(options).toHaveLength(1);
    expect(options[0].name).toBe("ไม่ทราบผู้ทำรายการ");
  });

  it("ไม่มีกิจกรรม → ไม่มีตัวเลือก (เหลือแค่ 'ทุกคน' ที่ UI ใส่ให้)", () => {
    expect(buildActorOptions([])).toHaveLength(0);
  });
});

describe("filterActivitiesByActor — กรองกิจกรรมตามผู้ทำรายการ", () => {
  it("ค่า 'ทุกคน' หรือค่าว่าง → แสดงทั้งหมดตามลำดับเดิม (ล่าสุดก่อนจาก server)", () => {
    expect(filterActivitiesByActor(ACTIVITIES, ALL_ACTORS_VALUE)).toEqual(ACTIVITIES);
    expect(filterActivitiesByActor(ACTIVITIES, "")).toEqual(ACTIVITIES);
  });

  it("เลือกบุคคล → แสดงเฉพาะกิจกรรมของคนนั้น", () => {
    const filtered = filterActivitiesByActor(ACTIVITIES, "user-2");

    expect(filtered.map((a) => a.id)).toEqual(["a1", "a3"]);
  });

  it("actor_id มีช่องว่างรอบข้างก็กรองได้ (normalize ก่อนเทียบ)", () => {
    const filtered = filterActivitiesByActor(
      [activity({ id: "a1", actor_id: " user-1 " })],
      "user-1"
    );

    expect(filtered).toHaveLength(1);
  });

  it("เลือกคนที่ไม่มีกิจกรรม → ลิสต์ว่าง (UI แสดง empty state ของตัวกรอง)", () => {
    expect(filterActivitiesByActor(ACTIVITIES, "user-99")).toHaveLength(0);
  });
});
