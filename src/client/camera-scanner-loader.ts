let scannerModule: Promise<typeof import("html5-qrcode")> | null = null;

/** Share the decoder download across scanner instances and allow retry after failure. */
export function loadCameraScanner() {
  scannerModule ??= import("html5-qrcode").catch((error: unknown) => {
    scannerModule = null;
    throw error;
  });
  return scannerModule;
}
