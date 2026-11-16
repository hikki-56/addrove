import { cameraScanQrbox, cameraScanQrboxCompact } from "@/components/ui/CameraBarcodeScannerModal";

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


it("compact viewfinder stays near 200x72 and below the default minimum", () => {
  const box = cameraScanQrboxCompact(358, 144);
  expect(box.width).toBe(200);
  expect(box.height).toBe(72);
  const tight = cameraScanQrboxCompact(140, 90);
  expect(tight.width).toBe(120);
  expect(tight.height).toBe(48);
  expect(box.height).toBeLessThan(cameraScanQrbox(358, 144).height);
});
