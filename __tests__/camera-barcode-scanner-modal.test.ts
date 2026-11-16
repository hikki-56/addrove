import React, { type ReactElement, type ReactNode } from "react";
import CameraBarcodeScannerModal, { COMPACT_SCAN_VIEWPORT_HEIGHT_CLASS } from "@/components/ui/CameraBarcodeScannerModal";
import { feedbackError, feedbackSuccess } from "@/client/feedback";
import { useScanFeedback } from "@/hooks/use-scan-feedback";

const mockSetState = jest.fn();
let mockManualCode = "";
const mockEffects: Array<() => unknown> = [];
const mockStart = jest.fn().mockResolvedValue(undefined);

jest.mock("react", () => ({
  ...jest.requireActual("react"),
  useState: (initial: unknown) => [initial === "" ? mockManualCode : initial, mockSetState],
  useRef: (initial: unknown) => ({ current: initial }),
  useCallback: (callback: unknown) => callback,
  useEffect: (effect: () => unknown) => { mockEffects.push(effect); },
  useId: () => "scanner-test",
}));
jest.mock("@/hooks/use-escape-key", () => ({ useEscapeKey: jest.fn() }));
jest.mock("@/client/feedback", () => ({
  feedbackSuccess: jest.fn(), feedbackError: jest.fn(), prepareFeedbackAudio: jest.fn(), playSuccessSound: jest.fn(), setCameraScanActive: jest.fn(),
}));
jest.mock("html5-qrcode", () => ({
  Html5Qrcode: jest.fn().mockImplementation(() => ({
    clear: jest.fn(), start: mockStart,
  })),
  Html5QrcodeSupportedFormats: {},
}));

type Props = { children?: ReactNode; [key: string]: unknown };
function find(root: ReactNode, predicate: (element: ReactElement<Props>) => boolean): ReactElement<Props> {
  const elements: ReactElement<Props>[] = [];
  function visit(node: ReactNode) {
    React.Children.forEach(node, (child) => {
      if (!React.isValidElement<Props>(child)) return;
      elements.push(child);
      visit(child.props.children);
    });
  }
  visit(root);
  const result = elements.find(predicate);
  if (!result) throw new Error("Element not found");
  return result;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockEffects.length = 0;
  mockManualCode = "";
  jest.spyOn(console, "warn").mockImplementation(() => {});
  Object.defineProperty(globalThis, "window", { configurable: true, value: {} });
});
afterEach(() => {
  jest.restoreAllMocks();
  jest.useRealTimers();
  Reflect.deleteProperty(globalThis, "window");
  Reflect.deleteProperty(globalThis, "document");
  Reflect.deleteProperty(globalThis, "Image");
});

it.each(["Enter", "button"])("manual submission via %s stays silent, including rejected codes", async (method) => {
  mockManualCode = "  UNKNOWN  ";
  const onScanSuccess = jest.fn().mockRejectedValue(new Error("Unknown code"));
  const tree = CameraBarcodeScannerModal({ isOpen: true, onClose: jest.fn(), onScanSuccess });
  if (method === "Enter") {
    const input = find(tree, (node) => node.type === "input" && node.props.type === "text");
    (input.props.onKeyDown as (event: unknown) => void)({ key: "Enter", preventDefault: jest.fn() });
  } else {
    const button = find(tree, (node) => node.type === "button" && node.props.children === "ตกลง");
    (button.props.onClick as () => void)();
  }
  await Promise.resolve();
  await Promise.resolve();
  expect(onScanSuccess).toHaveBeenCalledWith("UNKNOWN", false);
  expect(feedbackSuccess).not.toHaveBeenCalled();
  expect(feedbackError).not.toHaveBeenCalled();
});

it("live decoding waits for validation without playing an early success sound", async () => {
  jest.useFakeTimers();
  Object.defineProperty(globalThis, "document", { configurable: true, value: { getElementById: () => ({}) } });
  const onScan = jest.fn(async () => { feedbackError(); });
  CameraBarcodeScannerModal({ isOpen: true, onClose: jest.fn(), onScan, feedbackHandledByCaller: true });
  mockEffects.forEach((effect) => effect());
  await jest.advanceTimersByTimeAsync(100);
  const decode = mockStart.mock.calls[0][2] as (code: string) => void;
  decode("REJECTED");
  await Promise.resolve();
  expect(onScan).toHaveBeenCalledWith("REJECTED", true);
  expect(feedbackError).toHaveBeenCalledTimes(1);
  expect(feedbackSuccess).not.toHaveBeenCalled();
  decode("REJECTED");
  expect(onScan).toHaveBeenCalledTimes(1);
});

it("feedback from typing stays silent while camera results have distinct sounds", () => {
  const [, report] = useScanFeedback();
  report({ type: "success", message: "Accepted" });
  report({ type: "error", message: "Rejected" });
  expect(feedbackSuccess).not.toHaveBeenCalled();
  expect(feedbackError).not.toHaveBeenCalled();
  report({ type: "success", message: "Accepted" }, true);
  report({ type: "error", message: "Rejected" }, true);
  report(null, true);
  expect(feedbackSuccess).toHaveBeenCalledTimes(1);
  expect(feedbackError).toHaveBeenCalledTimes(1);
});


it("default chrome still includes the sound test, typed code field, and close control", () => {
  const tree = CameraBarcodeScannerModal({ isOpen: true, onClose: jest.fn() });
  expect(find(tree, (node) => node.type === "button" && node.props.children === "ทดสอบเสียง")).toBeTruthy();
  expect(find(tree, (node) => node.type === "button" && node.props.children === "ตกลง")).toBeTruthy();
  expect(find(tree, (node) => node.type === "button" && node.props["aria-label"] === "ปิดกล้องสแกน")).toBeTruthy();
  expect(find(tree, (node) => node.type === "span" && node.props.children === "ทีละครั้ง")).toBeTruthy();
  const viewport = find(tree, (node) => typeof node.props.className === "string" && String(node.props.className).includes("stockify-scan-viewport"));
  expect(String(viewport.props.className)).toContain("max-h-[min(280px,48vh)]");
  expect(String(viewport.props.className)).not.toContain("h-[144px]");
  expect(String(viewport.props.className)).not.toContain(COMPACT_SCAN_VIEWPORT_HEIGHT_CLASS);
  expect(String(viewport.props.className)).not.toContain("stockify-scan-compact");
});

it("receive opt-out props hide chrome, keep a taller compact frame, and render afterViewport", () => {
  const tree = CameraBarcodeScannerModal({
    isOpen: true,
    onClose: jest.fn(),
    persistOpen: true,
    compactViewport: true,
    hideManualInput: true,
    hideSoundHint: true,
    afterViewport: React.createElement("div", { "data-testid": "after-viewport" }, "สแกนแล้ว 0 รายการ"),
  });
  expect(find(tree, (node) => node.props["data-testid"] === "after-viewport").props.children).toBe("สแกนแล้ว 0 รายการ");
  expect(() => find(tree, (node) => node.type === "button" && node.props.children === "ทดสอบเสียง")).toThrow("Element not found");
  expect(() => find(tree, (node) => node.type === "button" && node.props.children === "ตกลง")).toThrow("Element not found");
  expect(() => find(tree, (node) => node.type === "button" && node.props["aria-label"] === "ปิดกล้องสแกน")).toThrow("Element not found");
  expect(() => find(tree, (node) => node.type === "span" && node.props.children === "ทีละครั้ง")).toThrow("Element not found");
  const viewport = find(tree, (node) => typeof node.props.className === "string" && String(node.props.className).includes("stockify-scan-viewport"));
  expect(String(viewport.props.className)).toContain(COMPACT_SCAN_VIEWPORT_HEIGHT_CLASS);
  expect(String(viewport.props.className)).toContain("h-[min(260px,34vh)]");
  expect(String(viewport.props.className)).toContain("stockify-scan-compact");
  expect(String(viewport.props.className)).not.toContain("h-[144px]");
  expect(String(viewport.props.className)).not.toContain("max-h-[min(280px,48vh)]");
  const flash = find(tree, (node) => node.type === "button" && node.props["aria-label"] === "เปิดแฟลช");
  expect(String(flash.props.className)).toContain("size-9");
  expect(String(flash.props.className)).toContain("absolute");
});


it("compact camera requests an ideal aspect ratio matching the viewport, not a stretched 16:9 fill", async () => {
  jest.useFakeTimers();
  const viewport = { clientWidth: 390, clientHeight: 260 };
  const root = { parentElement: viewport, clientWidth: 390, clientHeight: 260, querySelector: () => null };
  class FakeMutationObserver { observe() {} disconnect() {} }
  Object.defineProperty(globalThis, "MutationObserver", { configurable: true, value: FakeMutationObserver });
  Object.defineProperty(globalThis, "document", { configurable: true, value: { getElementById: () => root } });
  CameraBarcodeScannerModal({
    isOpen: true,
    onClose: jest.fn(),
    compactViewport: true,
    persistOpen: true,
    hideManualInput: true,
    hideSoundHint: true,
  });
  mockEffects.forEach((effect) => effect());
  await jest.advanceTimersByTimeAsync(100);
  expect(mockStart).toHaveBeenCalled();
  const config = mockStart.mock.calls[0][1] as {
    aspectRatio?: number;
    videoConstraints?: { facingMode?: string; aspectRatio?: { ideal?: number } };
    qrbox?: unknown;
  };
  expect(config.aspectRatio).toBeUndefined();
  expect(config.videoConstraints).toEqual({
    facingMode: "environment",
    aspectRatio: { ideal: 390 / 260 },
  });
});

it("default camera still requests the existing 16:9 aspectRatio and not compact videoConstraints", async () => {
  jest.useFakeTimers();
  Object.defineProperty(globalThis, "document", { configurable: true, value: { getElementById: () => ({}) } });
  CameraBarcodeScannerModal({ isOpen: true, onClose: jest.fn() });
  mockEffects.forEach((effect) => effect());
  await jest.advanceTimersByTimeAsync(100);
  const config = mockStart.mock.calls[0][1] as { aspectRatio?: number; videoConstraints?: unknown };
  expect(config.aspectRatio).toBe(1.777778);
  expect(config.videoConstraints).toBeUndefined();
});

it("persistOpen keeps the scan chrome visible while the live camera is paused", () => {
  const tree = CameraBarcodeScannerModal({
    isOpen: false,
    persistOpen: true,
    compactViewport: true,
    hideManualInput: true,
    hideSoundHint: true,
    onClose: jest.fn(),
  });
  expect(find(tree, (node) => node.type === "h3").props.children).toBe("สแกนบาร์โค้ดสินค้า");
  const closed = CameraBarcodeScannerModal({ isOpen: false, onClose: jest.fn() });
  expect(closed).toBeNull();
});
