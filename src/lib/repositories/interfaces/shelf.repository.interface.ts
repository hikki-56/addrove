import type { Shelf } from "@/types/models";
import type { CreateShelfInput, UpdateShelfInput } from "@/types/api";

export interface IShelfRepository {
  findAll(locationId?: string): Promise<Shelf[]>;
  findById(id: string): Promise<Shelf | null>;
  findByCode(code: string): Promise<Shelf | null>;
  create(input: CreateShelfInput): Promise<Shelf>;
  update(id: string, input: UpdateShelfInput): Promise<Shelf | null>;
}
