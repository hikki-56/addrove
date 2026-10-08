import type { User } from "@/types/models";

export interface IUserRepository {
  findAll(): Promise<User[]>;
  findById(id: string): Promise<User | null>;
  findByEmail(email: string): Promise<User | null>;
  create(user: Omit<User, "user_id" | "created_at" | "updated_at">): Promise<User>;
  update(id: string, updates: Partial<User>): Promise<User | null>;
}
