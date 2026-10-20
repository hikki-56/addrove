"use client";

import { useCallback, useState } from "react";
import type { ScanFeedback } from "@/components/scanner/ScanFeedbackBanner";
import { feedbackError, feedbackSuccess } from "@/client/feedback";

/** Camera scans opt into sound after validation; typed codes stay silent. */
export function useScanFeedback() {
  const [feedback, setFeedback] = useState<ScanFeedback | null>(null);
  const reportFeedback = useCallback((result: ScanFeedback | null, playSound = false) => {
    setFeedback(result);
    if (playSound && result?.type === "success") feedbackSuccess();
    if (playSound && result?.type === "error") feedbackError();
  }, []);

  return [feedback, reportFeedback] as const;
}
