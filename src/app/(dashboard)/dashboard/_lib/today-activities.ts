// ตัวกรองและตัวเลือกผู้ทำรายการของส่วน "กิจกรรมวันนี้" — pure function
// ฝั่ง server ส่ง today_activities มาครบแล้ว ฝั่ง client มีหน้าที่แค่กรองตามผู้ทำรายการ
import type { TodayActivity } from "@/types/models";

export const ALL_ACTORS_VALUE = "all";

export interface ActivityActorOption {
  id: string;
  name: string;
}

// actor_id อาจเป็นช่องว่างได้ — รวมเป็นกลุ่ม "ไม่ทราบผู้ทำรายการ" กัน option ซ้ำ/ว่าง
function actorKey(activity: TodayActivity): string {
  return activity.actor_id?.trim() || "unknown";
}

export function buildActorOptions(activities: TodayActivity[]): ActivityActorOption[] {
  const byId = new Map<string, ActivityActorOption>();
  for (const activity of activities) {
    const id = actorKey(activity);
    if (!byId.has(id)) {
      byId.set(id, {
        id,
        name: activity.actor_name?.trim() || "ไม่ทราบผู้ทำรายการ",
      });
    }
  }
  return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name, "th"));
}

export function filterActivitiesByActor(
  activities: TodayActivity[],
  actorId: string
): TodayActivity[] {
  if (!actorId || actorId === ALL_ACTORS_VALUE) return activities;
  return activities.filter((activity) => actorKey(activity) === actorId);
}
