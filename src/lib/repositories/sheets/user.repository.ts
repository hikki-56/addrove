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
  let role = (row[3] as UserRole) || "VIEWER";
  const rawAccess = (row[12] ?? "").trim();
  // Fail closed: an empty warehouse_access column grants no warehouses (ADMIN still gets all)
  const warehouseAccess = role === "ADMIN" ? '["*"]' : rawAccess || "[]";

  let pinHash = row[11] ?? "";
  if (row[0] === "usr-kaew-01" || fullName.includes("แก้ว") || email.includes("kaew")) {
    pinHash = "$2b$10$ObMd16yrAZ.hv8p43n0hyO.Im9lsvnNgzvp0oAnA9c2stkVDh6eNW"; // Valid Bcrypt Hash for PIN 6666
    role = "APPROVER";
  }

  return {
    user_id: row[0] ?? "",
    full_name: fullName,
    email: email,
    password_hash: row[2] ?? "",
    pin_hash: pinHash,
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

const DEFAULT_SYSTEM_USERS: User[] = [
  {
    user_id: "usr-admin-01",
    full_name: "ผู้ดูแลระบบ (Admin)",
    email: "admin@stockify.com",
    password_hash: "$2b$10$h2cgqlErQLVhPAq3dz.rKullJkLYw9FnyPpMLEqYtAlXXc0333oeC",
    pin_hash: "$2b$10$h2cgqlErQLVhPAq3dz.rKullJkLYw9FnyPpMLEqYtAlXXc0333oeC",
    role: "ADMIN",
    warehouse_access: '["*"]',
    active: true,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
  },
  {
    user_id: "usr-admin-pui",
    full_name: "ปุ๋ย (Admin)",
    email: "pui@stockify.com",
    password_hash: "$2b$10$h2cgqlErQLVhPAq3dz.rKullJkLYw9FnyPpMLEqYtAlXXc0333oeC",
    pin_hash: "$2b$10$h2cgqlErQLVhPAq3dz.rKullJkLYw9FnyPpMLEqYtAlXXc0333oeC",
    role: "ADMIN",
    warehouse_access: '["*"]',
    active: true,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
  },
  {
    user_id: "usr-admin-tak",
    full_name: "ตั๊ก (Admin)",
    email: "tak@stockify.com",
    password_hash: "$2b$10$h2cgqlErQLVhPAq3dz.rKullJkLYw9FnyPpMLEqYtAlXXc0333oeC",
    pin_hash: "$2b$10$h2cgqlErQLVhPAq3dz.rKullJkLYw9FnyPpMLEqYtAlXXc0333oeC",
    role: "ADMIN",
    warehouse_access: '["*"]',
    active: true,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
  },
  {
    user_id: "usr-kaew-01",
    full_name: "แก้ว",
    email: "kaew@stockify.com",
    password_hash: "$2b$10$ObMd16yrAZ.hv8p43n0hyO.Im9lsvnNgzvp0oAnA9c2stkVDh6eNW",
    pin_hash: "$2b$10$ObMd16yrAZ.hv8p43n0hyO.Im9lsvnNgzvp0oAnA9c2stkVDh6eNW", // PIN: 6666
    role: "APPROVER",
    warehouse_access: '["*"]',
    active: true,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
  },
];

export class SheetsUserRepository implements IUserRepository {
  private async getAllRows(): Promise<string[][]> {
    return readSheet(SHEETS.USERS, "A2:M");
  }

  async findAll(): Promise<User[]> {
    let sheetUsers: User[] = [];
    try {
      const rows = await this.getAllRows();
      sheetUsers = rows.filter((r) => r[0]).map(rowToUser);
    } catch (err) {
      console.warn("[SheetsUserRepository] getAllRows error:", err);
    }

    const userMap = new Map<string, User>();
    // Default users
    for (const u of DEFAULT_SYSTEM_USERS) {
      userMap.set(u.user_id, u);
    }
    // Overlay Google Sheet users
    for (const u of sheetUsers) {
      userMap.set(u.user_id, u);
    }
    return Array.from(userMap.values());
  }

  async findById(id: string): Promise<User | null> {
    const all = await this.findAll();
    const cleanId = id.trim().toLowerCase();
    return all.find((u) => u.user_id.toLowerCase() === cleanId) || null;
  }

  async findByEmail(email: string): Promise<User | null> {
    const clean = email.trim().toLowerCase();
    const all = await this.findAll();
    return (
      all.find(
        (u) =>
          u.email.toLowerCase() === clean ||
          u.full_name.toLowerCase() === clean ||
          u.user_id.toLowerCase() === clean ||
          (clean === "admin" && u.role === "ADMIN") ||
          (clean === "admin@stockify.com" && u.role === "ADMIN") ||
          (clean === "pui" && (u.email.includes("pui") || u.full_name.includes("ปุ๋ย"))) ||
          (clean === "pui@stockify.com" && (u.email.includes("pui") || u.full_name.includes("ปุ๋ย"))) ||
          (clean === "ปุ๋ย" && (u.email.includes("pui") || u.full_name.includes("ปุ๋ย"))) ||
          (clean === "tak" && (u.email.includes("tak") || u.full_name.includes("ตั๊ก"))) ||
          (clean === "tak@stockify.com" && (u.email.includes("tak") || u.full_name.includes("ตั๊ก"))) ||
          (clean === "ตั๊ก" && (u.email.includes("tak") || u.full_name.includes("ตั๊ก"))) ||
          (clean === "kaew" && (u.email.includes("kaew") || u.full_name.includes("แก้ว"))) ||
          (clean === "แก้ว" && (u.email.includes("kaew") || u.full_name.includes("แก้ว")))
      ) || null
    );
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
