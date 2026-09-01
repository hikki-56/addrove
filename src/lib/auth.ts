import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { getRepository } from "@/lib/repositories";
import { getAuthSecret } from "@/lib/server-secrets";
import type { UserRole } from "@/types/models";

export const { handlers, signIn, signOut, auth } = NextAuth({
  trustHost: true,
  providers: [
    Credentials({
      name: "credentials",
      credentials: {
        email: { label: "อีเมล", type: "email" },
        password: { label: "รหัสผ่าน", type: "password" },
      },
      async authorize(credentials) {
        try {
          if (!credentials?.email || !credentials?.password) {
            return null;
          }

          const cleanEmail = (credentials.email as string).trim().toLowerCase();
          const cleanPass = credentials.password as string;

          const repo = getRepository();
          const user = await repo.users.findByEmail(cleanEmail);

          // Fail closed: User must exist, be active, and have a password hash
          if (!user || !user.active || !user.password_hash) {
            return null;
          }

          // Strict bcrypt comparison only — no fallback to plaintext or hardcoded values
          const isValid = await bcrypt.compare(cleanPass, user.password_hash).catch(() => false);
          if (!isValid) {
            return null;
          }

          // Fail closed: no warehouse_access value = no warehouses. ADMIN gets all.
          let warehouseAccess: string[] = [];
          if (user.role === "ADMIN") {
            warehouseAccess = ["*"];
          } else if (Array.isArray(user.warehouse_access)) {
            warehouseAccess = user.warehouse_access.filter(
              (v): v is string => typeof v === "string" && v.trim() !== ""
            );
          } else if (typeof user.warehouse_access === "string" && user.warehouse_access.trim() !== "") {
            try {
              const parsed = JSON.parse(user.warehouse_access);
              if (Array.isArray(parsed)) {
                warehouseAccess = parsed.filter((v): v is string => typeof v === "string" && v.trim() !== "");
              } else if (parsed === "*") {
                warehouseAccess = ["*"];
              } else if (typeof parsed === "string" && parsed.trim() !== "") {
                warehouseAccess = [parsed.trim()];
              }
            } catch {
              // Non-JSON text: treat as a comma-separated warehouse list
              warehouseAccess = user.warehouse_access
                .split(",")
                .map((s) => s.trim())
                .filter(Boolean);
            }
          }

          return {
            id: user.user_id,
            email: user.email,
            name: user.full_name,
            role: user.role as UserRole,
            warehouse_access: warehouseAccess,
          };
        } catch (e) {
          console.error("[Auth authorize error]", e);
          return null;
        }
      },
    }),
  ],
  session: {
    strategy: "jwt",
    maxAge: 24 * 60 * 60, // 24 hours (86,400 seconds)
  },
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id;
        token.name = user.name;
        token.role = user.role;
        token.warehouse_access = user.warehouse_access;
      }
      return token;
    },
    async session({ session, token }) {
      if (token) {
        session.user.id = token.id as string;
        session.user.name = token.name as string;
        session.user.role = token.role as UserRole;
        session.user.warehouse_access = token.warehouse_access as string[];
      }
      return session;
    },
  },
  pages: {
    signIn: "/login",
    error: "/login",
  },
  secret: getAuthSecret(),
});
