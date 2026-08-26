import {
  getWarehouseQrProductionOrigin,
  resolveWarehouseQrBaseUrl,
} from "@/app/(dashboard)/warehouses/qr/_lib/warehouse-qr-url";

describe("warehouse QR URL resolution", () => {
  const productionUrl = "https://addrove.vercel.app";

  test("replaces a Vercel preview URL with the production URL", () => {
    expect(
      resolveWarehouseQrBaseUrl(
        "https://addrove-4mjeeo7rz-tys-projects-afb98477.vercel.app",
        productionUrl
      )
    ).toBe(productionUrl);
  });

  test("keeps the canonical production URL", () => {
    expect(resolveWarehouseQrBaseUrl(productionUrl, productionUrl)).toBe(productionUrl);
  });

  test("keeps a local Wi-Fi URL for on-premise scanning", () => {
    expect(resolveWarehouseQrBaseUrl("http://192.168.1.54:3000", productionUrl)).toBe(
      "http://192.168.1.54:3000"
    );
  });

  test("falls back to production for an invalid URL", () => {
    expect(resolveWarehouseQrBaseUrl("not-a-url", productionUrl)).toBe(productionUrl);
  });

  test("rejects a preview URL configured as the production origin", () => {
    expect(
      getWarehouseQrProductionOrigin(
        "https://addrove-preview-tys-projects-afb98477.vercel.app"
      )
    ).toBe(productionUrl);
  });

  test("replaces localhost and 127.0.0.1 with production URL", () => {
    expect(resolveWarehouseQrBaseUrl("http://localhost:3000", productionUrl)).toBe(
      productionUrl
    );
    expect(resolveWarehouseQrBaseUrl("http://127.0.0.1:3000", productionUrl)).toBe(
      productionUrl
    );
    expect(
      getWarehouseQrProductionOrigin("http://localhost:3000")
    ).toBe(productionUrl);
  });
});
