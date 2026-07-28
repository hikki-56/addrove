import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";

export default async function Home() {
  try {
    const session = await auth();
    if (session?.user) {
      redirect("/dashboard");
    }
  } catch {
    // Graceful fallback to login
  }
  redirect("/login");
}
