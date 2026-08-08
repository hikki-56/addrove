import { GET as healthCheck } from "../health/route";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET() {
  return healthCheck();
}
