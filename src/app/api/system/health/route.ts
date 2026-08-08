import { NextResponse } from "next/server";
import { validateEnvironment } from "@/lib/server-secrets";
import { readSheet, SHEETS } from "@/lib/google-sheets/client";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET() {
  const envCheck = validateEnvironment();
  let storageStatus = "UNCHECKED";
  let storageError: string | null = null;
  let appsScriptStatus = "UNCHECKED";
  let appsScriptError: string | null = null;

  // 1. Google Sheets read check
  try {
    const rows = await readSheet(SHEETS.WAREHOUSES, "A1:B2");
    storageStatus = Array.isArray(rows) ? "CONNECTED" : "UNREACHABLE";
  } catch (err: unknown) {
    storageStatus = "ERROR";
    storageError = err instanceof Error ? err.message : String(err);
  }

  // 2. Apps Script signed ping check (if configured)
  if (process.env.GOOGLE_SCRIPT_URL) {
    try {
      // Dynamic import to avoid bundling crypto in client code
      const { sendSignedAppsScriptRequest } = await import(
        "@/lib/google-sheets/script-signer"
      );
      const response = await sendSignedAppsScriptRequest({ action: "ping" });
      const text = await response.text();

      if (!response.ok) {
        appsScriptStatus = "ERROR";
        appsScriptError = `HTTP ${response.status}`;
      } else {
        try {
          const json = JSON.parse(text) as {
            success?: boolean;
            message?: string;
            error?: string;
          };
          if (json.success && json.message === "pong") {
            appsScriptStatus = "CONNECTED";
          } else {
            appsScriptStatus = "ERROR";
            appsScriptError = json.error || "Unexpected response";
          }
        } catch {
          appsScriptStatus = "ERROR";
          appsScriptError = "Invalid JSON response";
        }
      }
    } catch (err: unknown) {
      appsScriptStatus = "ERROR";
      appsScriptError = err instanceof Error ? err.message : String(err);
    }
  } else if (process.env.NODE_ENV === "production") {
    appsScriptStatus = "NOT_CONFIGURED";
    appsScriptError = "GOOGLE_SCRIPT_URL not set";
  } else {
    appsScriptStatus = "SKIPPED";
  }

  // Determine health status
  const storageOk =
    storageStatus === "CONNECTED" ||
    (process.env.NODE_ENV !== "production" && storageStatus !== "ERROR");

  const appsScriptOk =
    appsScriptStatus === "CONNECTED" ||
    appsScriptStatus === "SKIPPED" ||
    (process.env.NODE_ENV !== "production" &&
      appsScriptStatus !== "ERROR");

  const isHealthy = envCheck.valid && storageOk && appsScriptOk;

  // Build response — NEVER expose URLs, secrets, keys, or attackable details
  return NextResponse.json(
    {
      status: isHealthy ? "HEALTHY" : "DEGRADED",
      timestamp: new Date().toISOString(),
      environment: {
        nodeEnv: process.env.NODE_ENV || "development",
        valid: envCheck.valid,
        // Only report error COUNT, not detailed messages in production
        errorCount: envCheck.errors.length,
        ...(process.env.NODE_ENV !== "production" && {
          errors: envCheck.errors,
        }),
      },
      storage: {
        status: storageStatus,
        // Only include error detail in non-production
        ...(process.env.NODE_ENV !== "production" &&
          storageError && { error: storageError }),
      },
      appsScript: {
        status: appsScriptStatus,
        ...(process.env.NODE_ENV !== "production" &&
          appsScriptError && { error: appsScriptError }),
      },
      version: "0.1.0",
    },
    { status: isHealthy ? 200 : 503 }
  );
}
