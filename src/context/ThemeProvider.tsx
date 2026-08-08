"use client";
import { useEffect } from "react";

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    document.documentElement.setAttribute("data-theme", "light");
    document.documentElement.classList.add("light");
    document.documentElement.classList.remove("dark");
  }, []);

  return <>{children}</>;
}
