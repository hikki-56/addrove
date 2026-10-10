export interface StockWorkflowTimingDetails {
  operation: string;
  warehouseId?: string;
  itemCount?: number;
}

export function finishStockWorkflowTiming<T extends Response>(
  response: T,
  startedAt: number,
  details: StockWorkflowTimingDetails
): T {
  const durationMs = Math.max(0, performance.now() - startedAt);
  const metricName = details.operation.toLowerCase().replace(/[^a-z0-9_-]/g, "-");
  response.headers.set("Server-Timing", `${metricName};dur=${durationMs.toFixed(1)}`);

  if (process.env.NODE_ENV !== "test") {
    console.info(
      "[StockWorkflowTiming]",
      JSON.stringify({
        ...details,
        status: response.status,
        outcome: response.ok ? "success" : "error",
        duration_ms: Number(durationMs.toFixed(1)),
      })
    );
  }

  return response;
}
