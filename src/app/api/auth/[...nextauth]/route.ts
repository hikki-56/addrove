import { handlers } from "@/server/auth";
import { withMaintenanceGuard } from "@/server/storage-transaction";
export const GET = handlers.GET;
export const POST = withMaintenanceGuard(handlers.POST);
