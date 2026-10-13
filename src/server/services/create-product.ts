import { getRepository } from "@/server/repositories";
import { withStorageTransaction } from "@/server/storage-transaction";
import type { CreateProductInput } from "@/types/api";
import { todayBangkokIsoDate } from "@/lib/express-status-utils";

/** Master data and initial inventory must commit together. Staff stock awaits approval. */
export async function createProductWithStock(input: CreateProductInput, actor: { id: string; name: string; role: string }) {
    return withStorageTransaction(async () => {
        const repo = getRepository();
        const product = await repo.products.create(input);
        const qty = input.initial_quantity ?? 0;
        const warehouseId = input.warehouse_id || "wh-1";
        const defaultLocation = (await repo.locations.findAll(warehouseId)).find(location => location.active && location.location_code === "14A1");
        const locationId = defaultLocation?.location_id || "";
        if (qty > 0) {
            const approved = actor.role === "ADMIN";
            const doc = await repo.documents.create({
                document_type: approved ? "OPENING" : "RECEIVE",
                document_date: todayBangkokIsoDate(),
                reference_no: product.sku,
                status: approved ? "POSTED" : "PENDING",
                note: JSON.stringify({ warehouse_id: warehouseId, lines: [{ product_id: product.product_id, location_id: locationId, qty }] }),
                created_by: actor.id,
                created_by_name: actor.name,
            });
            if (approved) {
                await repo.movements.batchCreate([{ document_id: doc.document_id, product_id: product.product_id, warehouse_id: warehouseId, location_id: locationId, qty_change: qty, movement_type: "OPENING", idempotency_key: `opening-${doc.document_id}`, created_by: actor.id }]);
                await repo.stockSummary.applyChanges([{ productId: product.product_id, warehouseId, locationId, delta: qty }]);
            }
        } else if (actor.role === "ADMIN") {
            await repo.stockSummary.applyChanges([{ productId: product.product_id, warehouseId, locationId, delta: 0 }]);
        }
        return product;
    });
}
