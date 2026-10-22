import { groupLocationsByWarehouse } from "@/components/products/ProductLocationBreakdown";

describe("groupLocationsByWarehouse", () => {
  it("groups by warehouse, merges duplicate locations, sorts qty desc with unknown location last", () => {
    const groups = groupLocationsByWarehouse([
      { warehouse_id: "wh-1", warehouse_name: "โกดัง 1", location: "A-01", quantity: 100 },
      { warehouse_id: "wh-1", warehouse_name: "โกดัง 1", location: "-", quantity: 500 },
      { warehouse_id: "wh-1", warehouse_name: "โกดัง 1", location: "B-02", quantity: 300 },
      { warehouse_id: "wh-2", warehouse_name: "โกดัง 2", location: "2A-05", quantity: 50 },
      { warehouse_id: "wh-1", warehouse_name: "โกดัง 1", location: "A-01", quantity: 25 },
    ]);
    expect(groups.map((g) => [g.name, g.qty])).toEqual([["โกดัง 1", 925], ["โกดัง 2", 50]]);
    expect(groups[0].locations).toEqual([
      { code: "B-02", qty: 300 },
      { code: "A-01", qty: 125 },
      { code: "", qty: 500 },
    ]);
  });

  it("returns [] for missing breakdown", () => {
    expect(groupLocationsByWarehouse(undefined)).toEqual([]);
  });
});
