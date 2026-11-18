import {
  cameraScanQrbox,
  cameraScanQrboxCompact,
  cameraScanAspectRatio,
  containScanVideoSize,
  sizeCompactScanSurface,
  COMPACT_SCAN_VIEWPORT_HEIGHT_CLASS,
} from "@/components/ui/CameraBarcodeScannerModal";

describe("cameraScanQrbox", () => {
  it("uses nearly the full viewfinder for long barcodes", () => {
    const box = cameraScanQrbox(400, 260);
    expect(box).toEqual({ width: 376, height: 223 });
    expect(box.width).toBeLessThan(400);
    expect(box.height).toBeLessThan(260);
  });

  it("stays within a small viewfinder while meeting the decoder minimum", () => {
    const box = cameraScanQrbox(120, 80);
    expect(box.width).toBeGreaterThanOrEqual(50);
    expect(box.height).toBeGreaterThanOrEqual(50);
    expect(box.width).toBeLessThan(120);
    expect(box.height).toBeLessThan(80);
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


describe("compact viewport aspect and contain sizing", () => {
  it("exports a taller compact height capped by 34vh", () => {
    expect(COMPACT_SCAN_VIEWPORT_HEIGHT_CLASS).toBe("h-[min(260px,34vh)]");
  });

  it("uses the viewport aspect when both sides are known, otherwise 16:9", () => {
    expect(cameraScanAspectRatio(390, 260)).toBeCloseTo(390 / 260);
    expect(cameraScanAspectRatio(0, 260)).toBeCloseTo(16 / 9);
    expect(cameraScanAspectRatio(390, 0)).toBeCloseTo(16 / 9);
  });

  it("contains a 16:9 stream inside a 390×260 box without stretching", () => {
    const size = containScanVideoSize(1920, 1080, 390, 260);
    expect(size).toEqual({ width: 390, height: Math.floor(1080 * (390 / 1920)) });
    expect(size.height).toBe(219);
    expect(size.width / size.height).toBeCloseTo(1920 / 1080, 2);
    expect(size.height).toBeLessThan(260);
  });

  it("contains a portrait stream as a letterboxed column so the qrbox stays on-screen", () => {
    const size = containScanVideoSize(1080, 1920, 390, 260);
    expect(size).toEqual({ width: Math.floor(1080 * (260 / 1920)), height: 260 });
    expect(size.width).toBe(146);
    expect(size.width).toBeLessThan(390);
    expect(size.height / size.width).toBeCloseTo(1920 / 1080, 2);
  });

  it("fills the box when the stream already matches the viewport", () => {
    expect(containScanVideoSize(390, 260, 390, 260)).toEqual({ width: 390, height: 260 });
  });

  it("sizes the html5-qrcode root and video to the same contained rectangle", () => {
    const viewport = { clientWidth: 390, clientHeight: 260 } as HTMLElement;
    const root = { style: {} as CSSStyleDeclaration } as HTMLElement;
    const video = { videoWidth: 1920, videoHeight: 1080, style: {} as CSSStyleDeclaration } as HTMLVideoElement;
    expect(sizeCompactScanSurface(root, video, viewport)).toEqual({ width: 390, height: 219 });
    expect(root.style.width).toBe("390px");
    expect(root.style.height).toBe("219px");
    expect(video.style.width).toBe("390px");
    expect(video.style.height).toBe("219px");
    expect(video.style.objectFit).toBe("fill");
  });
});
