import type { IStockRepository } from "../repositories/interfaces";
import type { StockCount } from "@/types/models";
import type { CreateStockCountInput } from "@/types/api";

export class StockCountService {
  constructor(private readonly repo: IStockRepository) {}

  async createCount(
    input: CreateStockCountInput,
    userId: string
  ): Promise<StockCount> {
    // Get current system balance at this location
    const systemQty = await this.repo.movements.getBalance(
      input.product_id,
      input.warehouse_id,
      input.location_id
    );

    // Generate count number
    const countNo = await this.generateCountNo();

    const count = await this.repo.stockCounts.create({
      ...input,
      system_qty: systemQty,
      count_no: countNo,
    });

    return count;
  }

  async approveCount(
    countId: string,
    approvedBy: string
  ): Promise<StockCount | null> {
    const count = await this.repo.stockCounts.findById(countId);
    if (!count) return null;
    if (count.status !== "COUNTED") throw new Error("สามารถอนุมัติได้เฉพาะรายการที่นับแล้ว");

    // Create adjustment movement if there is a difference
    const diff = count.difference ?? 0;
    if (diff !== 0) {
      await this.repo.movements.batchCreate([
        {
          document_id: `COUNT-${countId}`,
          product_id: count.product_id,
          warehouse_id: count.warehouse_id,
          location_id: count.location_id,
          movement_type: "ADJUST",
          qty_change: diff,
          idempotency_key: `APPROVE-${countId}`,
          created_by: approvedBy,
        },
      ]);

      // Update stock summary
      await this.repo.stockSummary.applyChanges([
        {
          productId: count.product_id,
          warehouseId: count.warehouse_id,
          locationId: count.location_id,
          delta: diff,
        },
      ]);
    }

    return this.repo.stockCounts.update(countId, {
      status: "APPROVED",
      approved_by: approvedBy,
      approved_at: new Date().toISOString(),
    });
  }

  private async generateCountNo(): Promise<string> {
    const now = new Date();
    const ym = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}`;
    const seq = Math.floor(Math.random() * 9999) + 1;
    return `CNT-${ym}-${String(seq).padStart(4, "0")}`;
  }
}
