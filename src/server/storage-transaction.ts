import { getStorageDriver } from "@/server/repositories/storage-driver";
function maintenanceResponse(): Response | null {
    if (!["1", "true"].includes(process.env.STORAGE_MAINTENANCE?.trim().toLowerCase() || ""))
        return null;
    return Response.json({ success: false, message: "ระบบอยู่ระหว่างปรับปรุง กรุณาลองอีกครั้งในอีกสักครู่" }, { status: 503, headers: { "Retry-After": "60" } });
}
export function withMaintenanceGuard<Args extends unknown[]>(handler: (...args: Args) => Promise<Response>): (...args: Args) => Promise<Response> {
    return async (...args: Args) => maintenanceResponse() ?? handler(...args);
}
export async function withStorageTransaction<T>(action: () => Promise<T>): Promise<T> {
    if (getStorageDriver() !== "postgres")
        return action();
    const { withDatabaseTransaction } = await import("@/server/repositories/postgres/database");
    return withDatabaseTransaction(action);
}
class RollbackResponse extends Error {
    constructor(readonly response: Response) { super("Request failed; database changes rolled back"); }
}
/** Even handlers that catch domain errors must roll back before returning 4xx/5xx. */
export function withStorageRequest<Args extends unknown[]>(handler: (...args: Args) => Promise<Response>): (...args: Args) => Promise<Response> {
    return async (...args: Args) => {
        const unavailable = maintenanceResponse();
        if (unavailable)
            return unavailable;
        if (getStorageDriver() !== "postgres")
            return handler(...args);
        try {
            return await withStorageTransaction(async () => {
                const response = await handler(...args);
                if (!response.ok)
                    throw new RollbackResponse(response);
                return response;
            });
        }
        catch (error) {
            if (error instanceof RollbackResponse)
                return error.response;
            console.error("[Storage] Request rolled back", error instanceof Error ? error.name : "UnknownError");
            return Response.json({
                success: false,
                message: "ระบบฐานข้อมูลไม่พร้อมใช้งานชั่วคราว กรุณาลองใหม่อีกครั้ง",
                error: "บันทึกข้อมูลไม่สำเร็จ กรุณาลองใหม่",
            }, { status: 503 });
        }
    };
}
