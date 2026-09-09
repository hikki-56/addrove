"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function StockPage() {
  const router = useRouter();

  useEffect(() => {
    router.replace("/dashboard");
  }, [router]);

  return (
    <div className="flex items-center justify-center min-h-[50vh]">
      <div className="w-8 h-8 border-2 border-[#0F5C3F] border-t-transparent rounded-full animate-spin" />
    </div>
  );
}
