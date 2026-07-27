import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { getRepository } from "@/lib/repositories";
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

          const repo = getRepository();
          const user = await repo.users.findByEmail(
            credentials.email as string
          );

          if (!user || !user.active) {
            return null;
          }

          const isValid = await bcrypt.compare(
            credentials.password as string,
            user.password_hash
          );

          if (!isValid) {
            return null;
          }

          let warehouseAccess: string[];
          try {
            warehouseAccess = JSON.parse(user.warehouse_access);
          } catch {
            warehouseAccess = user.warehouse_access === "*" ? ["*"] : [];
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
  session: { strategy: "jwt" },
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id;
        token.role = user.role;
        token.warehouse_access = user.warehouse_access;
      }
      return token;
    },
    async session({ session, token }) {
      if (token) {
        session.user.id = token.id as string;
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
  secret: process.env.AUTH_SECRET || process.env.NEXTAUTH_SECRET || "stockify-secret-key-super-secure-2026",
});
