import bcrypt from "bcryptjs";

async function main() {
  const passwordInputs = [
    ["Admin", process.env.SEED_ADMIN_PASSWORD],
    ["Staff", process.env.SEED_STAFF_PASSWORD],
    ["Viewer", process.env.SEED_VIEWER_PASSWORD],
    ["Manager", process.env.SEED_MANAGER_PASSWORD],
  ] as const;

  const missing = passwordInputs
    .filter(([role, password]) => role !== "Manager" && (!password || password.trim() === ""))
    .map(([role]) => `SEED_${role.toUpperCase()}_PASSWORD`);

  if (missing.length > 0) {
    console.error(`[Seed Users Error] Missing required environment variables: ${missing.join(", ")}`);
    console.error("Please supply valid passwords via environment variables before seeding user credentials.");
    process.exit(1);
  }

  console.log("=== Generated Seed Password Hashes ===");
  for (const [role, password] of passwordInputs) {
    if (password && password.trim() !== "") {
      console.log(`${role}:`);
      console.log(await bcrypt.hash(password.trim(), 12));
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
