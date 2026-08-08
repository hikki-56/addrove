import type { Warehouse } from "@/types/models";
import type { CreateWarehouseInput } from "@/types/api";

export interface IWarehouseRepository {
  findAll(): Promise<Warehouse[]>;
  findById(id: string): Promise<Warehouse | null>;
  findByCode(code: string): Promise<Warehouse | null>;
  create(input: CreateWarehouseInput): Promise<Warehouse>;
}
