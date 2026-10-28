import React, { type ReactElement, type ReactNode } from "react";
import CameraBarcodeScannerModal from "@/components/ui/CameraBarcodeScannerModal";
import { feedbackError, feedbackSuccess } from "@/client/feedback";
import { useScanFeedback } from "@/hooks/use-scan-feedback";

const mockSetState = jest.fn();
let mockManualCode = "";
const mockEffects: Array<() => unknown> = [];
const mockScanFile = jest.fn();
const mockStart = jest.fn().mockResolvedValue(undefined);

jest.mock("react", () => ({
  ...jest.requireActual("react"),
  useState: (initial: unknown) => [initial === "" ? mockManualCode : initial, mockSetState],
  useRef: (initial: unknown) => ({ current: initial }),
  useCallback: (callback: unknown) => callback,
  useEffect: (effect: () => unknown) => { mockEffects.push(effect); },
}));
jest.mock("@/hooks/use-escape-key", () => ({ useEscapeKey: jest.fn() }));
jest.mock("@/client/feedback", () => ({
  feedbackSuccess: jest.fn(), feedbackError: jest.fn(), prepareFeedbackAudio: jest.fn(), playSuccessSound: jest.fn(), setCameraScanActive: jest.fn(),
}));
jest.mock("html5-qrcode", () => ({
  Html5Qrcode: jest.fn().mockImplementation(() => ({
    scanFile: mockScanFile, clear: jest.fn(), start: mockStart,
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

function upload(tree: ReactNode) {
  const input = { files: [{}], value: "photo.png" };
  const element = find(tree, (node) => node.type === "input" && node.props.type === "file");
  const onChange = element.props.onChange as (event: unknown) => Promise<void>;
  return { input, run: () => onChange({ target: input, currentTarget: input }) };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockEffects.length = 0;
  mockManualCode = "";
  mockScanFile.mockReset();
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

it("photo scans notify the onScanSuccess callback and enable result sound", async () => {
  mockScanFile.mockResolvedValue("123456");
  const onScanSuccess = jest.fn();
  const onClose = jest.fn();
  const tree = CameraBarcodeScannerModal({ isOpen: true, onClose, onScanSuccess, feedbackHandledByCaller: true });
  const photo = upload(tree);
  await photo.run();
  expect(onScanSuccess).toHaveBeenCalledWith("123456", true);
  expect(onClose).toHaveBeenCalledTimes(1);
  expect(photo.input.value).toBe("");
  expect(feedbackSuccess).not.toHaveBeenCalled(); // Result handler owns the sound.
});

it("unreadable photos play only the failure sound and keep the scanner open", async () => {
  mockScanFile.mockRejectedValue(new Error("No barcode"));
  const onScan = jest.fn();
  const onClose = jest.fn();
  await upload(CameraBarcodeScannerModal({ isOpen: true, onClose, onScan })).run();
  expect(feedbackError).toHaveBeenCalledTimes(1);
  expect(feedbackSuccess).not.toHaveBeenCalled();
  expect(onScan).not.toHaveBeenCalled();
  expect(onClose).not.toHaveBeenCalled();
});

it("photo fallback retains the file and releases its object URL", async () => {
  mockScanFile.mockRejectedValue(new Error("Try native detector"));
  const detect = jest.fn().mockResolvedValue([{ rawValue: "FALLBACK" }]);
  Object.defineProperty(window, "BarcodeDetector", { value: jest.fn().mockImplementation(() => ({ detect })) });
  Object.defineProperty(globalThis, "Image", { configurable: true, value: class { decode = jest.fn().mockResolvedValue(undefined); } });
  const createUrl = jest.spyOn(URL, "createObjectURL").mockReturnValue("blob:scan-photo");
  const revokeUrl = jest.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
  const onScanSuccess = jest.fn();
  const photo = upload(CameraBarcodeScannerModal({ isOpen: true, onClose: jest.fn(), onScanSuccess }));
  await photo.run();
  expect(createUrl).toHaveBeenCalledWith(photo.input.files[0]);
  expect(onScanSuccess).toHaveBeenCalledWith("FALLBACK", true);
  expect(feedbackSuccess).toHaveBeenCalledTimes(1);
  expect(feedbackError).not.toHaveBeenCalled();
  expect(revokeUrl).toHaveBeenCalledWith("blob:scan-photo");
  expect(photo.input.value).toBe("");
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
