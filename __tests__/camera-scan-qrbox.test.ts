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


it("compact qrbox scales with the viewfinder, stays inside it, and never goes below html5-qrcode's 50px minimum", () => {
  const box = cameraScanQrboxCompact(358, 144);
  expect(box).toEqual({
    width: Math.floor(358 * 0.8),
    height: Math.floor(144 * 0.6),
  });
  expect(box.width).toBeLessThan(358);
  expect(box.height).toBeLessThan(144);
  expect(box.width).toBeGreaterThanOrEqual(50);
  expect(box.height).toBeGreaterThanOrEqual(50);
  expect(box).not.toEqual({ width: 200, height: 72 });
});

it("compact qrbox on a short viewfinder stays at least 50px and still leaves a visible shaded margin", () => {
  const tight = cameraScanQrboxCompact(140, 90);
  expect(tight.width).toBeGreaterThanOrEqual(50);
  expect(tight.height).toBeGreaterThanOrEqual(50);
  expect(tight.width).toBeLessThanOrEqual(138);
  expect(tight.height).toBeLessThanOrEqual(88);
});

it("compact qrbox stays within a tall portrait-like viewfinder so the shaded frame can be placed on-screen once the video is fitted", () => {
  const box = cameraScanQrboxCompact(358, 636);
  const x = (358 - box.width) / 2;
  const y = (636 - box.height) / 2;
  expect(box.width).toBe(Math.floor(358 * 0.8));
  expect(box.height).toBe(Math.floor(636 * 0.6));
  expect(x).toBeGreaterThanOrEqual(0);
  expect(y).toBeGreaterThanOrEqual(0);
  expect(x + box.width).toBeLessThanOrEqual(358);
  expect(y + box.height).toBeLessThanOrEqual(636);
});
