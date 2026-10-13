import { loadEnvConfig } from "@next/env";
import { google } from "googleapis";
import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
async function main() {
    loadEnvConfig(process.cwd());
    const sourceId = process.env.GOOGLE_SHEET_ID?.replace(/^["']|["']$/g, "").trim();
    if (!sourceId)
        throw new Error("GOOGLE_SHEET_ID is missing");
    const { getSheetsClient } = await import("@/server/google-sheets/client");
    const serviceAccount = Boolean(process.env.GOOGLE_PRIVATE_KEY && (process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || process.env.GOOGLE_CLIENT_EMAIL));
    const sheets = serviceAccount ? getSheetsClient() : google.sheets({ version: "v4", auth: process.env.GOOGLE_API_KEY });
    const output = path.resolve(process.argv[2] || "data/migrations/sheets-snapshot.json");
    try {
        const metadata = await sheets.spreadsheets.get({ spreadsheetId: sourceId, fields: "sheets.properties" });
        const titles = (metadata.data.sheets || []).map(sheet => sheet.properties?.title).filter((title): title is string => Boolean(title));
        if (!titles.length)
            throw new Error("Source spreadsheet has no tabs");
        const tabs: {
            name: string;
            values: string[][];
            formulas: string[][];
        }[] = [];
        // Batches stay below API quota; both values and original formulas are backed up.
        for (let i = 0; i < titles.length; i += 10) {
            const names = titles.slice(i, i + 10);
            const ranges = names.map(name => `'${name.replace(/'/g, "''")}'`);
            const [values, formulas] = await Promise.all([
                sheets.spreadsheets.values.batchGet({ spreadsheetId: sourceId, ranges, valueRenderOption: "FORMATTED_VALUE" }),
                sheets.spreadsheets.values.batchGet({ spreadsheetId: sourceId, ranges, valueRenderOption: "FORMULA" }),
            ]);
            names.forEach((name, j) => tabs.push({ name, values: (values.data.valueRanges?.[j]?.values || []).map(row => row.map(String)), formulas: (formulas.data.valueRanges?.[j]?.values || []).map(row => row.map(String)) }));
        }
        const body = { sourceId, capturedAt: new Date().toISOString(), tabs };
        const checksum = createHash("sha256").update(JSON.stringify(body)).digest("hex");
        await mkdir(path.dirname(output), { recursive: true });
        await writeFile(output, JSON.stringify({ ...body, checksum }), { flag: "wx", mode: 0o600 });
        console.log(JSON.stringify({ status: "EXPORTED", tabs: tabs.map(t => ({ name: t.name, rows: Math.max(0, t.values.length - 1) })), checksum }));
    }
    catch (error) {
        // Google API errors can contain request URLs/keys. Do not print the error object.
        console.error("Source export failed:", error instanceof Error ? error.name : "UnknownError");
        process.exitCode = 1;
    }
}
void main().catch(error => { console.error("Export setup failed:", error instanceof Error ? error.name : "UnknownError"); process.exitCode = 1; });
