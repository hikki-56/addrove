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

function generateUuid(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `id-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
}

// Matches exact columns in Google Sheets (UsersTable / USERS):
// A (0): user_id
// B (1): username
// C (2): password_hash
// D (3): role
// E (4): first_name
// F (5): last_name
// G (6): email
// H (7): phone
// I (8): active
// J (9): created_at
// K (10): updated_at
// L (11): รหัส PIN (pin_hash)
// M (12): warehouse_access (JSON array or specific warehouse list)

function rowToUser(row: string[]): User {
  const firstName = row[4] ?? "";
  const lastName = row[5] ?? "";
  const fullName = [firstName, lastName].filter(Boolean).join(" ") || row[1] || "";
  const email = row[6] || row[1] || ""; // email or username
  const role = (row[3] as UserRole) || "VIEWER";
  const rawAccess = row[12]?.trim();
  const warehouseAccess = rawAccess || (role === "ADMIN" ? '["*"]' : "[]");

  return {
    user_id: row[0] ?? "",
    full_name: fullName,
    email: email,
    password_hash: row[2] ?? "",
    pin_hash: row[11] ?? "", // Column L (รหัส PIN)
    role: role,
    warehouse_access: warehouseAccess,
    active: parseBoolean(row[8]),
    created_at: row[9] ?? "",
    updated_at: row[10] ?? "",
  };
}

function userToRow(u: User): (string | boolean)[] {
  const nameParts = (u.full_name || "").trim().split(/\s+/);
  const firstName = nameParts[0] || "";
  const lastName = nameParts.slice(1).join(" ") || "";
  const username = u.email ? u.email.split("@")[0] : u.user_id;

  return [
    u.user_id, // A: user_id
    username, // B: username
    u.password_hash, // C: password_hash
    u.role, // D: role
    firstName, // E: first_name
    lastName, // F: last_name
    u.email, // G: email
    "", // H: phone
    formatBoolean(u.active), // I: active
    u.created_at, // J: created_at
    u.updated_at, // K: updated_at
    u.pin_hash ?? "", // L: รหัส PIN
    u.warehouse_access ?? (u.role === "ADMIN" ? '["*"]' : "[]"), // M: warehouse_access
  ];
}

export class SheetsUserRepository implements IUserRepository {
  private async getAllRows(): Promise<string[][]> {
    return readSheet(SHEETS.USERS, "A2:M");
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
    const clean = email.trim().toLowerCase();
    // Search both email (col G/6) and username (col B/1)
    const row = rows.find(
      (r) =>
        r[6]?.trim().toLowerCase() === clean ||
        r[1]?.trim().toLowerCase() === clean
    );
    return row ? rowToUser(row) : null;
  }

  async create(
    user: Omit<User, "user_id" | "created_at" | "updated_at">
  ): Promise<User> {
    const now = new Date().toISOString();
    const newUser: User = {
      ...user,
      pin_hash: user.pin_hash ?? "",
      warehouse_access: user.warehouse_access ?? (user.role === "ADMIN" ? '["*"]' : "[]"),
      user_id: `usr-${generateUuid()}`,
      created_at: now,
      updated_at: now,
    };
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
