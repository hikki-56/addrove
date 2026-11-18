import { cameraScanGuideBounds } from "@/components/ui/CameraScanGuide";

function rect(left: number, top: number, width: number, height: number) {
  return { left, top, right: left + width, bottom: top + height };
}

it.each([
  ["portrait video cropped by a short mobile viewport", rect(20, 100, 320, 200), rect(20, -84, 320, 568)],
  ["landscape video letterboxed on mobile", rect(20, 100, 360, 260), rect(20, 128.75, 360, 202.5)],
  ["portrait video contained in a wide viewport", rect(20, 100, 390, 260), rect(141.875, 100, 146.25, 260)],
  ["short landscape phone viewport", rect(20, 100, 428, 120), rect(20, 39.625, 428, 240.75)],
] as const)("keeps all corners inside the visible image with equal padding: %s", (_name, viewport, video) => {
  const guide = cameraScanGuideBounds(viewport, video);
  expect(guide).not.toBeNull();
  if (!guide) return;
  const visible = {
    left: Math.max(viewport.left, video.left),
    top: Math.max(viewport.top, video.top),
    right: Math.min(viewport.right, video.right),
    bottom: Math.min(viewport.bottom, video.bottom),
  };
  const left = viewport.left + guide.left - visible.left;
  const top = viewport.top + guide.top - visible.top;
  const right = visible.right - (viewport.left + guide.left + guide.width);
  const bottom = visible.bottom - (viewport.top + guide.top + guide.height);
  expect(guide.width).toBe(guide.height);
  expect(left).toBeCloseTo(right);
  expect(top).toBeCloseTo(bottom);
  expect(Math.min(left, top, right, bottom)).toBeGreaterThanOrEqual(12);
  expect(guide.height).toBeLessThan((visible.bottom - visible.top) * 0.8);
});

it("does not draw a guide until a visible video area is measurable", () => {
  expect(cameraScanGuideBounds(rect(0, 0, 320, 200), rect(0, 0, 0, 0))).toBeNull();
  expect(cameraScanGuideBounds(rect(0, 0, 320, 200), rect(400, 0, 100, 100))).toBeNull();
  expect(cameraScanGuideBounds(rect(0, 0, 20, 20), rect(0, 0, 20, 20))).toBeNull();
});
