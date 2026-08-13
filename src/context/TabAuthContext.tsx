"use client";

import React, { createContext, useContext, useEffect, useState, useCallback } from "react";
import type { UserRole } from "@/types/models";
import { useRouter } from "next/navigation";

export interface TabUser {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  warehouse_access: string[];
}

export interface TabSession {
  user: TabUser;
  token: string;
  expires_at?: number;
}

interface TabAuthContextType {
  user: TabUser | null;
  token: string | null;
  status: "loading" | "authenticated" | "unauthenticated";
  login: (user: TabUser, token: string, expires_at?: number) => void;
  logout: () => Promise<void>;
  syncTabCookie: () => void;
}

const TAB_SESSION_KEY = "stockify_tab_session";

const TabAuthContext = createContext<TabAuthContextType>({
  user: null,
  token: null,
  status: "loading",
  login: () => {},
  logout: async () => {},
  syncTabCookie: () => {},
});

export function TabAuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<TabUser | null>(() => {
    if (typeof window === "undefined") return null;
    try {
      const stored = sessionStorage.getItem(TAB_SESSION_KEY);
      if (stored) {
        const parsed: TabSession = JSON.parse(stored);
        if (parsed.expires_at && Date.now() < parsed.expires_at && parsed.user) {
          return parsed.user;
        }
      }
    } catch {}
    return null;
  });

  const [token, setToken] = useState<string | null>(() => {
    if (typeof window === "undefined") return null;
    try {
      const stored = sessionStorage.getItem(TAB_SESSION_KEY);
      if (stored) {
        const parsed: TabSession = JSON.parse(stored);
        if (parsed.expires_at && Date.now() < parsed.expires_at && parsed.token) {
          return parsed.token;
        }
      }
    } catch {}
    return null;
  });

  const [status, setStatus] = useState<"loading" | "authenticated" | "unauthenticated">(() => {
    if (typeof window === "undefined") return "loading";
    try {
      const stored = sessionStorage.getItem(TAB_SESSION_KEY);
      if (stored) {
        const parsed: TabSession = JSON.parse(stored);
        if (parsed.expires_at && Date.now() < parsed.expires_at && parsed.user) {
          return "authenticated";
        }
      }
    } catch {}
    return "unauthenticated";
  });
  const router = useRouter();

  const handleExpiredSession = useCallback(() => {
    try {
      sessionStorage.removeItem(TAB_SESSION_KEY);
      // Remove sessions written by older versions. New sessions are tab-scoped only.
      localStorage.removeItem(TAB_SESSION_KEY);
    } catch {}
    setUser(null);
    setToken(null);
    setStatus("unauthenticated");
    if (typeof window !== "undefined") {
      window.location.href = "/employee-login?expired=true";
    }
  }, []);

  const syncTabCookie = useCallback(() => {
    if (typeof window === "undefined") return;
    try {
      const stored = sessionStorage.getItem(TAB_SESSION_KEY);
      if (stored) {
        const parsed: TabSession = JSON.parse(stored);
        if (parsed.expires_at && Date.now() >= parsed.expires_at) {
          handleExpiredSession();
          return;
        }
      }
    } catch (e) {
      console.error("[TabAuth] Sync cookie failed", e);
    }
  }, [handleExpiredSession]);

  // Load the employee session only from this browser tab.
  useEffect(() => {
    if (typeof window === "undefined") return;

    const loadSession = () => {
      try {
        localStorage.removeItem(TAB_SESSION_KEY);
        const stored = sessionStorage.getItem(TAB_SESSION_KEY);
        if (stored) {
          const parsed: TabSession = JSON.parse(stored);

          // Check if token is expired
          if (parsed.expires_at && Date.now() >= parsed.expires_at) {
            console.warn("[TabAuth] Employee token has expired");
            handleExpiredSession();
            return;
          }

          if (parsed.user && parsed.token) {
            try { sessionStorage.setItem(TAB_SESSION_KEY, stored); } catch {}
            setUser(parsed.user);
            setToken(parsed.token);
            setStatus("authenticated");
            return;
          }
        }
      } catch (e) {
        console.error("[TabAuth] Failed to load tab session", e);
      }
      setUser(null);
      setToken(null);
      setStatus("unauthenticated");
    };

    loadSession();

    // Re-sync cookie whenever user switches focus to this tab
    const handleFocus = () => {
      syncTabCookie();
    };

    window.addEventListener("focus", handleFocus);
    return () => {
      window.removeEventListener("focus", handleFocus);
    };
  }, [syncTabCookie, handleExpiredSession]);

  // Patch window.fetch to automatically include tab token header and check token expiry
  useEffect(() => {
    if (typeof window === "undefined") return;

    const originalFetch = window.fetch;
    window.fetch = async (input: RequestInfo | URL, init: RequestInit = {}) => {
      try {
        const stored = sessionStorage.getItem(TAB_SESSION_KEY);
        if (stored) {
          const parsed: TabSession = JSON.parse(stored);

          // If session expired, intercept fetch and redirect to login
          if (parsed.expires_at && Date.now() >= parsed.expires_at) {
            handleExpiredSession();
            return new Response(JSON.stringify({ success: false, message: "โทเคนหมดอายุ" }), { status: 401 });
          }

          if (parsed.token) {
            const headers = new Headers(init.headers || {});
            if (!headers.has("Authorization")) {
              headers.set("Authorization", `Bearer ${parsed.token}`);
            }
            if (!headers.has("X-Tab-Token")) {
              headers.set("X-Tab-Token", parsed.token);
            }
            init.headers = headers;
          }
        }
      } catch (e) {
        console.error("[TabAuth] Patch fetch error", e);
      }
      return originalFetch(input, init);
    };

    return () => {
      window.fetch = originalFetch;
    };
  }, [handleExpiredSession]);

  const login = useCallback((newUser: TabUser, newToken: string, expires_at?: number) => {
    try {
      // Default expiration: 24 Hours for ADMIN, 2 Hours for employee QR
      const defaultTtl = newUser.role === "ADMIN" ? 24 * 3600 * 1000 : 2 * 3600 * 1000;
      const sessionExpiry = expires_at || (Date.now() + defaultTtl);
      const sessionData: TabSession = { user: newUser, token: newToken, expires_at: sessionExpiry };
      const serialized = JSON.stringify(sessionData);
      sessionStorage.setItem(TAB_SESSION_KEY, serialized);
      localStorage.removeItem(TAB_SESSION_KEY);
      setUser(newUser);
      setToken(newToken);
      setStatus("authenticated");
    } catch (e) {
      console.error("[TabAuth] Save login session error", e);
    }
  }, []);

  const logout = useCallback(async () => {
    try {
      sessionStorage.removeItem(TAB_SESSION_KEY);
      localStorage.removeItem(TAB_SESSION_KEY);
    } catch (e) {
      console.error("[TabAuth] Logout error", e);
    }
    setUser(null);
    setToken(null);
    setStatus("unauthenticated");
    await fetch("/api/auth/logout", { method: "POST" }).catch(() => {});
    if (typeof window !== "undefined") {
      window.location.href = "/warehouses/qr";
    } else {
      router.push("/warehouses/qr");
    }
  }, [router]);

  return (
    <TabAuthContext.Provider
      value={{
        user,
        token,
        status,
        login,
        logout,
        syncTabCookie,
      }}
    >
      {children}
    </TabAuthContext.Provider>
  );
}

export function useTabAuth() {
  return useContext(TabAuthContext);
}
