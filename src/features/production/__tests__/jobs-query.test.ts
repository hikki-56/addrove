import { buildJobsQueryString } from "@/features/production/lib/jobs-query";

describe("buildJobsQueryString", () => {
  it("returns empty string without filters", () => {
    expect(buildJobsQueryString({})).toBe("");
    expect(buildJobsQueryString({ date_from: "", date_to: "", table_no: "ALL", status: "ALL" })).toBe("");
  });

  it("includes date range, table and status", () => {
    expect(
      buildJobsQueryString({ date_from: "2026-10-01", date_to: "2026-10-08", table_no: 3, status: "IN_PROGRESS" })
    ).toBe("?date_from=2026-10-01&date_to=2026-10-08&table_no=3&status=IN_PROGRESS");
  });

  it("supports a single day", () => {
    expect(buildJobsQueryString({ date_from: "2026-10-08", date_to: "2026-10-08" })).toBe(
      "?date_from=2026-10-08&date_to=2026-10-08"
    );
  });

  it("skips malformed values", () => {
    expect(buildJobsQueryString({ date_from: "08/10/2026", table_no: 0 })).toBe("");
    expect(buildJobsQueryString({ table_no: 2.5 })).toBe("");
  });

  it("encodes status safely", () => {
    expect(buildJobsQueryString({ status: "A&B" })).toBe("?status=A%26B");
  });
});
