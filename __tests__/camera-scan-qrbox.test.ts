import { cameraScanQrbox } from "@/components/ui/CameraBarcodeScannerModal";

describe("cameraScanQrbox", () => {
  it("shrinks the scan frame versus the previous 0.9 x 0.6 box", () => {
    const box = cameraScanQrbox(400, 260);
    const minEdge = 260;
    expect(box.width).toBe(Math.max(160, Math.floor(minEdge * 0.64)));
    expect(box.height).toBe(Math.max(100, Math.floor(minEdge * 0.4)));
    expect(box.width).toBeLessThan(Math.floor(minEdge * 0.9));
    expect(box.height).toBeLessThan(Math.floor(minEdge * 0.6));
  });

  it("keeps a usable minimum on a small viewfinder", () => {
    const box = cameraScanQrbox(120, 80);
    expect(box.width).toBe(160);
    expect(box.height).toBe(100);
  });
});
