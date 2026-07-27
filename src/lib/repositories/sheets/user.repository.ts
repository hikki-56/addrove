import { v4 as uuidv4 } from "uuid";
import {
  readSheet,
  appendRows,
  updateRow,
  SHEETS,
  parseBoolean,
  formatBoolean,
} from "@/lib/google-sheets/client";
import type { IUserRepository } from "../interfaces";
import type { User, UserRole } from "@/types/models";

// Columns: user_id, full_name, email, password_hash, role, warehouse_access, active, created_at, updated_at
function rowToUser(row: string[]): User {
  return {
    user_id: row[0] ?? "",
    full_name: row[1] ?? "",
    email: row[2] ?? "",
    password_hash: row[3] ?? "",
    role: (row[4] as UserRole) ?? "VIEWER",
    warehouse_access: row[5] ?? "[]",
    active: parseBoolean(row[6]),
    created_at: row[7] ?? "",
    updated_at: row[8] ?? "",
  };
}

function userToRow(u: User): (string | boolean)[] {
  return [
    u.user_id,
    u.full_name,
    u.email,
    u.password_hash,
    u.role,
    u.warehouse_access,
    formatBoolean(u.active),
    u.created_at,
    u.updated_at,
  ];
}

export class SheetsUserRepository implements IUserRepository {
  private async getAllRows(): Promise<string[][]> {
    return readSheet(SHEETS.USERS, "A2:I");
  }

  async findAll(): Promise<User[]> {
    const rows = await this.getAllRows();
    return rows.filter((r) => r[0]).map(rowToUser);
  }

  async findById(id: string): Promise<User | null> {
    const rows = await this.getAllRows();
    const row = rows.find((r) => r[0] === id);
    return row ? rowToUser(row) : null;
  }

  async findByEmail(email: string): Promise<User | null> {
    const rows = await this.getAllRows();
    const row = rows.find(
      (r) => r[2]?.toLowerCase() === email.toLowerCase()
    );
    return row ? rowToUser(row) : null;
  }

  async create(
    user: Omit<User, "user_id" | "created_at" | "updated_at">
  ): Promise<User> {
    const now = new Date().toISOString();
    const newUser: User = { ...user, user_id: uuidv4(), created_at: now, updated_at: now };
    await appendRows(SHEETS.USERS, [userToRow(newUser)]);
    return newUser;
  }

  async update(id: string, updates: Partial<User>): Promise<User | null> {
    const rows = await this.getAllRows();
    const idx = rows.findIndex((r) => r[0] === id);
    if (idx === -1) return null;
    const user = rowToUser(rows[idx]);
    const updated: User = {
      ...user,
      ...updates,
      user_id: user.user_id,
      updated_at: new Date().toISOString(),
    };
    await updateRow(SHEETS.USERS, idx + 2, userToRow(updated));
    return updated;
  }
}
