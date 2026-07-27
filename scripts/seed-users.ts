import bcrypt from "bcryptjs";

async function main() {
  const adminPass = await bcrypt.hash("Admin1234!", 10);
  const staffPass = await bcrypt.hash("Staff1234!", 10);
  const viewerPass = await bcrypt.hash("Viewer1234!", 10);

  console.log("=== Seed Password Hashes ===");
  console.log("Admin (admin@stockify.com / Admin1234!):");
  console.log(adminPass);
  console.log("\nStaff (staff@stockify.com / Staff1234!):");
  console.log(staffPass);
  console.log("\nViewer (viewer@stockify.com / Viewer1234!):");
  console.log(viewerPass);
}

main().catch(console.error);
