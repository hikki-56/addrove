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

          // All users get access to all warehouses
          const warehouseAccess: string[] = ["*"];

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
  session: { strategy: "jwt" },
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
