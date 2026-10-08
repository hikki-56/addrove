export interface ProductSyncInfo {
  sku: string;
  barcode: string;
  product_name: string;
  category: string;
  base_unit: string;
  supplier: string;
}

export interface IWarehouseSyncRepository {
  syncDeduct(
    warehouseId: string,
    productId: string,
    qty: number,
    locationId?: string
  ): Promise<ProductSyncInfo | null>;

  syncAdd(
    warehouseId: string,
    product: ProductSyncInfo,
    qty: number,
    locationId?: string
  ): Promise<void>;

  syncMove(
    warehouseId: string,
    productId: string,
    qty: number,
    fromLocationId?: string,
    toLocationId?: string
  ): Promise<void>;
}
