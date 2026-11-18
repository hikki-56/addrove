"use client";

import { useEffect, useState, type RefObject } from "react";

type Rect = Pick<DOMRectReadOnly, "left" | "top" | "right" | "bottom">;
type GuideBounds = { left: number; top: number; width: number; height: number };

/** Fit the guide inside the visible video, including clipping and letterboxing. */
export function cameraScanGuideBounds(viewport: Rect, video: Rect): GuideBounds | null {
  const left = Math.max(viewport.left, video.left);
  const top = Math.max(viewport.top, video.top);
  const width = Math.max(0, Math.min(viewport.right, video.right) - left);
  const height = Math.max(0, Math.min(viewport.bottom, video.bottom) - top);
  const shorterSide = Math.min(width, height);
  const padding = Math.max(12, Math.min(40, shorterSide * 0.18));
  const size = Math.floor(shorterSide - padding * 2);
  if (size < 24) return null;
  return {
    left: left - viewport.left + (width - size) / 2,
    top: top - viewport.top + (height - size) / 2,
    width: size,
    height: size,
  };
}

export default function CameraScanGuide({
  active,
  viewportRef,
}: {
  active: boolean;
  viewportRef: RefObject<HTMLDivElement | null>;
}) {
  const [bounds, setBounds] = useState<GuideBounds | null>(null);

  useEffect(() => {
    if (!active) return;
    const viewport = viewportRef.current;
    const video = viewport?.querySelector("video");
    if (!viewport || !video) return;
    const update = () => {
      const next = cameraScanGuideBounds(viewport.getBoundingClientRect(), video.getBoundingClientRect());
      setBounds((current) => current?.left === next?.left && current?.top === next?.top
        && current?.width === next?.width && current?.height === next?.height ? current : next);
    };
    const observer = new ResizeObserver(update);
    observer.observe(viewport);
    observer.observe(video);
    video.addEventListener("loadedmetadata", update);
    video.addEventListener("playing", update);
    window.addEventListener("resize", update);
    return () => {
      observer.disconnect();
      video.removeEventListener("loadedmetadata", update);
      video.removeEventListener("playing", update);
      window.removeEventListener("resize", update);
    };
  }, [active, viewportRef]);

  if (!active || !bounds) return null;
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      data-camera-scan-guide
      viewBox="0 0 200 200"
      style={{ ...bounds, position: "absolute", zIndex: 1, pointerEvents: "none", overflow: "visible", filter: "drop-shadow(0 1px 2px rgb(0 0 0 / 0.7))" }}
    >
      <path
        d="M32 4H4V32M168 4H196V32M4 168V196H32M168 196H196V168"
        fill="none"
        stroke="white"
        strokeWidth="3"
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}
