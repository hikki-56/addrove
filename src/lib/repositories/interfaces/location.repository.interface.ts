import type { Location } from "@/types/models";
import type { CreateLocationInput, UpdateLocationInput } from "@/types/api";

export interface ILocationRepository {
  findAll(warehouseId?: string): Promise<Location[]>;
  findById(id: string): Promise<Location | null>;
  findByCode(code: string): Promise<Location | null>;
  create(input: CreateLocationInput): Promise<Location>;
  update(id: string, input: UpdateLocationInput): Promise<Location | null>;
}
