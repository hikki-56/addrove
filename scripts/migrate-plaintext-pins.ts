import bcrypt from "bcryptjs";
import { readSheet, updateRow, SHEETS } from "../src/lib/google-sheets/client";

/**
 * Script to detect and migrate plaintext PINs in Google Sheets (USERS tab)
 * Run with: npx tsx scripts/migrate-plaintext-pins.ts [--apply]
 */
async function main() {
  const isApply = process.argv.includes("--apply");

  console.log("==================================================");
  console.log(" Stockify PIN Security Migration Tool");
  console.log(` Mode: ${isApply ? "LIVE UPDATE (--apply)" : "DRY RUN (preview only)"}`);
  console.log("==================================================\n");

  const rows = await readSheet(SHEETS.USERS);
  if (!rows || rows.length <= 1) {
    console.log("No user rows found in Google Sheets.");
    return;
  }

  const [header, ...dataRows] = rows;
  console.log(`Total users in sheet: ${dataRows.length}`);

  let plaintextCount = 0;
  let alreadyHashedCount = 0;
  let emptyCount = 0;

  for (let i = 0; i < dataRows.length; i++) {
    const rowNum = i + 2; // 1-based index, row 1 is header
    const row = dataRows[i];
    const userId = row[0] || `Row-${rowNum}`;
    const username = row[1] || "";
    const rawPin = (row[11] || "").trim();

    if (!rawPin) {
      emptyCount++;
      continue;
    }

    if (rawPin.startsWith("$2b$") || rawPin.startsWith("$2a$") || rawPin.startsWith("$2y$")) {
      alreadyHashedCount++;
      continue;
    }

    // Found plaintext or non-bcrypt PIN
    plaintextCount++;
    console.log(`[Plaintext PIN Detected] User: ${userId} (${username}), Row: ${rowNum}`);

    if (isApply) {
      const hashedPin = await bcrypt.hash(rawPin, 10);
      const updatedRow = [...row];
      // Ensure row has at least 12 columns
      while (updatedRow.length < 12) {
        updatedRow.push("");
      }
      updatedRow[11] = hashedPin;
      await updateRow(SHEETS.USERS, rowNum, updatedRow);
      console.log(`  -> Successfully hashed and updated row ${rowNum}`);
    }
  }

  console.log("\n================ Summary ================");
  console.log(`Already securely hashed ($2b$): ${alreadyHashedCount}`);
  console.log(`Plaintext PINs found:           ${plaintextCount}`);
  console.log(`Empty/unset PINs:              ${emptyCount}`);
  console.log("=========================================");

  if (plaintextCount > 0 && !isApply) {
    console.log("\nTo apply the bcrypt hashes to Google Sheets, run:");
    console.log("  npx tsx scripts/migrate-plaintext-pins.ts --apply");
  } else if (plaintextCount === 0) {
    console.log("\nAll PINs in the sheet are already properly hashed!");
  }
}

main().catch((err) => {
  console.error("Migration script failed:", err);
  process.exit(1);
});
