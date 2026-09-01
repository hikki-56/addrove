import { readSheet, updateRow, SHEETS } from "../src/lib/google-sheets/client";

/**
 * Backfill the warehouse_access column (M) in the USERS sheet so every active user
 * has an explicit value. Required before switching the app to fail-closed defaults:
 * after the code change, an empty column grants NO warehouse access.
 *
 * Values written (preserves today's effective permissions — narrow per person later
 * by editing the cell, e.g. ["wh-01","wh-03"]):
 *   ADMIN           -> ["*"]
 *   non-ADMIN       -> ["*"]
 *
 * Run with: npx tsx --env-file=.env.local scripts/backfill-warehouse-access.ts [--apply]
 */
async function main() {
  const isApply = process.argv.includes("--apply");

  console.log("====================================================");
  console.log(" Stockify warehouse_access Backfill Tool");
  console.log(` Mode: ${isApply ? "LIVE UPDATE (--apply)" : "DRY RUN (preview only)"}`);
  console.log("====================================================\n");

  const rows = await readSheet(SHEETS.USERS);
  if (!rows || rows.length <= 1) {
    console.log("No user rows found in Google Sheets.");
    return;
  }

  const [, ...dataRows] = rows;
  console.log(`Total users in sheet: ${dataRows.length}\n`);

  let emptyCount = 0;
  let filledCount = 0;

  for (let i = 0; i < dataRows.length; i++) {
    const rowNum = i + 2; // 1-based, row 1 is header
    const row = dataRows[i];
    const userId = row[0] || `Row-${rowNum}`;
    const username = row[1] || "";
    const role = (row[3] || "").trim();
    const rawAccess = (row[12] ?? "").trim();

    if (rawAccess) {
      filledCount++;
      console.log(`[OK]  ${userId} (${username}) role=${role} -> already set: ${rawAccess}`);
      continue;
    }

    emptyCount++;
    const planned = role === "ADMIN" ? '["*"]' : '["*"]';
    console.log(`[FILL] ${userId} (${username}) role=${role} -> will write: ${planned}`);

    if (isApply) {
      const updatedRow = [...row];
      while (updatedRow.length < 13) {
        updatedRow.push("");
      }
      updatedRow[12] = planned;
      await updateRow(SHEETS.USERS, rowNum, updatedRow);
      console.log(`   -> Written to row ${rowNum}`);
    }
  }

  console.log("\n================ Summary ================");
  console.log(`Already has value:      ${filledCount}`);
  console.log(`Empty (to be filled):   ${emptyCount}`);
  console.log("=========================================");

  if (emptyCount > 0 && !isApply) {
    console.log("\nTo write the values, run:");
    console.log("  npx tsx --env-file=.env.local scripts/backfill-warehouse-access.ts --apply");
  } else if (emptyCount === 0) {
    console.log("\nEvery user already has an explicit warehouse_access value!");
  }
}

main().catch((err) => {
  console.error("Backfill script failed:", err);
  process.exit(1);
});
