"use client";

import { useTabAuth } from "@/context/TabAuthContext";
import StockCountWorkspace from "./_components/StockCountWorkspace";

export default function StockCountsPage() {
  const { user } = useTabAuth();
  return user && <StockCountWorkspace key={user.id} />;
}
