import "next-auth";
import type { UserRole } from "./models";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      email: string;
      name: string;
      role: UserRole;
      warehouse_access: string[];
    };
  }

  interface User {
    id: string;
    email: string;
    name: string;
    role: UserRole;
    warehouse_access: string[];
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    id: string;
    role: UserRole;
    warehouse_access: string[];
  }
}
