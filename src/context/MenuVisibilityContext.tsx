"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { useTabAuth } from "@/context/TabAuthContext";
import { usePollingWhenVisible } from "@/hooks/use-visibility-polling";
import type { MyMenuSettings } from "@/types/menu-settings";

const MenuVisibilityContext = createContext<MyMenuSettings>({ menu_hrefs: [], can_manage: false });

export function MenuVisibilityProvider({ children }: { children: React.ReactNode }) {
  const { user, token } = useTabAuth();
  const userId = user?.id;
  const [settings, setSettings] = useState<(MyMenuSettings & { userId: string; token: string }) | null>(null);
  const refresh = useCallback(async () => {
    if (!userId || !token) return;
    try {
      const res = await fetch("/api/menu-settings/me", {
        cache: "no-store",
        headers: { Authorization: `Bearer ${token}` },
      });
      const json = await res.json();
      if (res.ok && json.success) setSettings({ ...json.data, userId, token });
    } catch {
      // Keep the last known settings; the next visible poll retries.
    }
  }, [userId, token]);

  usePollingWhenVisible(refresh, 60000);
  useEffect(() => {
    const onRefresh = () => { void refresh(); };
    window.addEventListener("stockify-menu-settings-updated", onRefresh);
    window.addEventListener("focus", onRefresh);
    return () => {
      window.removeEventListener("stockify-menu-settings-updated", onRefresh);
      window.removeEventListener("focus", onRefresh);
    };
  }, [refresh]);

  const value = settings?.userId === user?.id && settings?.token === token
    ? settings : { menu_hrefs: [], can_manage: false };
  return <MenuVisibilityContext.Provider value={value}>{children}</MenuVisibilityContext.Provider>;
}

export function useMenuVisibility() {
  return useContext(MenuVisibilityContext);
}
