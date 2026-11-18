"use client";

import React, { useEffect, useRef, useState, useCallback, useId } from "react";
import type { CameraCapabilities, Html5Qrcode } from "html5-qrcode";
import { useEscapeKey } from "@/hooks/use-escape-key";
import { feedbackError, feedbackSuccess, playSuccessSound, prepareFeedbackAudio, setCameraScanActive } from "@/client/feedback";
import ScanFeedbackBanner, { type ScanFeedback } from "@/components/scanner/ScanFeedbackBanner";

/** Use nearly the full camera image so long barcodes fit inside the scan frame. */
export function cameraScanQrbox(viewfinderWidth: number, viewfinderHeight: number): { width: number; height: number } {
  return {
    width: Math.floor(viewfinderWidth * 0.94),
    height: Math.floor(viewfinderHeight * 0.86),
  };
}

/**
 * กรอบสแกนของโหมดกะทัดรัด — สัดส่วนตามขนาด viewfinder จริงที่ html5-qrcode
 * วัดจาก video.clientWidth/clientHeight (อย่าใช้กรอบคงที่ 200×72)
 *
 * html5-qrcode 2.3.8 บังคับด้านสั้นสุด 50px และจะไม่วาด #qr-shaded-region
 * (กรอบสแกน) ถ้ากรอบสูงหรือกว้างเท่าจอวิดีโอ
 */
export const HTML5_QRBOX_MIN_SIZE = 50;

/** Compact receive camera height: ~220–260px, capped so short viewports stay usable. */
export const COMPACT_SCAN_VIEWPORT_HEIGHT_CLASS = "h-[min(260px,34vh)]";

const DEFAULT_CAMERA_ASPECT_RATIO = 16 / 9;

/** Aspect ratio to request from the camera so the stream can match the visible box. */
export function cameraScanAspectRatio(viewfinderWidth: number, viewfinderHeight: number): number {
  if (viewfinderWidth <= 0 || viewfinderHeight <= 0) return DEFAULT_CAMERA_ASPECT_RATIO;
  return viewfinderWidth / viewfinderHeight;
}

/** Size a video so it fits inside a box without stretching (letterbox / pillarbox). */
export function containScanVideoSize(
  sourceWidth: number,
  sourceHeight: number,
  boxWidth: number,
  boxHeight: number,
): { width: number; height: number } {
  if (sourceWidth <= 0 || sourceHeight <= 0 || boxWidth <= 0 || boxHeight <= 0) {
    return { width: Math.max(0, Math.floor(boxWidth)), height: Math.max(0, Math.floor(boxHeight)) };
  }
  const scale = Math.min(boxWidth / sourceWidth, boxHeight / sourceHeight);
  return {
    width: Math.max(1, Math.floor(sourceWidth * scale)),
    height: Math.max(1, Math.floor(sourceHeight * scale)),
  };
}

/**
 * Fit the html5-qrcode root and <video> to the contained visible frame.
 * The library maps decode coords from video.clientWidth/clientHeight and paints
 * #qr-shaded-region on the root, so both must share the same rectangle.
 */
export function sizeCompactScanSurface(
  root: HTMLElement,
  video: HTMLVideoElement,
  viewport: HTMLElement,
): { width: number; height: number } | null {
  if (!video.videoWidth || !video.videoHeight) return null;
  const size = containScanVideoSize(
    video.videoWidth,
    video.videoHeight,
    viewport.clientWidth,
    viewport.clientHeight,
  );
  root.style.width = `${size.width}px`;
  root.style.height = `${size.height}px`;
  video.style.width = `${size.width}px`;
  video.style.height = `${size.height}px`;
  video.style.objectFit = "fill";
  return size;
}

/** Observe the scanner root and size the video before html5-qrcode measures on `playing`. */
export function attachCompactScanVideoFit(viewport: HTMLElement, root: HTMLElement): () => void {
  const bound = new WeakSet<HTMLVideoElement>();

  const apply = (video: HTMLVideoElement) => {
    sizeCompactScanSurface(root, video, viewport);
  };

  const bind = (video: HTMLVideoElement) => {
    if (bound.has(video)) {
      apply(video);
      return;
    }
    bound.add(video);
    if (video.videoWidth) apply(video);
    video.addEventListener("loadedmetadata", () => apply(video));
    video.addEventListener("playing", () => apply(video), true);
  };

  const existing = root.querySelector("video");
  if (existing) bind(existing);

  const observer = new MutationObserver(() => {
    const video = root.querySelector("video");
    if (video) bind(video);
  });
  observer.observe(root, { childList: true, subtree: true });

  return () => observer.disconnect();
}


export function cameraScanQrboxCompact(viewfinderWidth: number, viewfinderHeight: number): { width: number; height: number } {
  const margin = 2;
  const maxWidth = Math.max(0, viewfinderWidth - margin);
  const maxHeight = Math.max(0, viewfinderHeight - margin);
  return {
    width: Math.min(Math.max(HTML5_QRBOX_MIN_SIZE, Math.floor(viewfinderWidth * 0.8)), maxWidth),
    height: Math.min(Math.max(HTML5_QRBOX_MIN_SIZE, Math.floor(viewfinderHeight * 0.6)), maxHeight),
  };
}

interface CameraBarcodeScannerModalProps {
  isOpen: boolean;
  onClose: () => void;
  onScan?: (code: string, playSound: boolean) => void | Promise<void>;
  onScanSuccess?: (code: string, playSound: boolean) => void | Promise<void>;
  /** Validation handlers already play the accepted/rejected result. */
  feedbackHandledByCaller?: boolean;
  feedback?: ScanFeedback | null;
  presentation?: "modal" | "inline";
  /** Optional slot rendered under the camera frame (e.g. receiving summary strip). */
  afterViewport?: React.ReactNode;
  /** Taller compact viewfinder (min(260px, 34vh)) with the flash as a 36px icon in the bottom-left. */
  compactViewport?: boolean;
  /** Keep the camera open after a successful scan; hide close and single/continuous controls. */
  persistOpen?: boolean;
  /** Hide the typed barcode field and the ตกลง button. */
  hideManualInput?: boolean;
  /** Hide the ทดสอบเสียง button and the sound-hint text. */
  hideSoundHint?: boolean;
}

export default function CameraBarcodeScannerModal({
  isOpen,
  onClose,
  onScan,
  onScanSuccess,
  feedbackHandledByCaller = false,
  feedback,
  presentation = "modal",
  afterViewport,
  compactViewport = false,
  persistOpen = false,
  hideManualInput = false,
  hideSoundHint = false,
}: CameraBarcodeScannerModalProps) {
  const scannerId = useId();
  const titleId = `${scannerId}-title`;
  const html5QrCodeRef = useRef<Html5Qrcode | null>(null);
  const torchRef = useRef<ReturnType<CameraCapabilities["torchFeature"]> | null>(null);
  const torchBusyRef = useRef(false);
  const cameraStopRef = useRef<Promise<void>>(Promise.resolve());
  const compactFitCleanupRef = useRef<(() => void) | null>(null);
  const persistOpenRef = useRef(persistOpen);

  const [cameraError, setCameraError] = useState<string>("");
  const [manualCode, setManualCode] = useState<string>("");
  const [isScanningLive, setIsScanningLive] = useState<boolean>(false);
  const [isTorchSupported, setIsTorchSupported] = useState(false);
  const [isTorchOn, setIsTorchOn] = useState(false);
  const [isTorchChanging, setIsTorchChanging] = useState(false);
  const [torchError, setTorchError] = useState("");
  const [isContinuous, setIsContinuous] = useState<boolean>(persistOpen);
  const [scanError, setScanError] = useState<ScanFeedback | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const processingRef = useRef(false);
  const callbacksRef = useRef({ onScan, onScanSuccess, onClose, feedbackHandledByCaller });

  useEffect(() => {
    persistOpenRef.current = persistOpen;
  }, [persistOpen]);

  useEffect(() => {
    callbacksRef.current = { onScan, onScanSuccess, onClose, feedbackHandledByCaller };
  }, [onScan, onScanSuccess, onClose, feedbackHandledByCaller]);

  useEscapeKey(isOpen && !persistOpen, onClose);

  // ป้ายเด้ง "สแกนสำเร็จ/ไม่สำเร็จ" ขวาบน ทำงานเฉพาะตอนเปิดกล้อง
  useEffect(() => {
    if (!isOpen) return;
    setCameraScanActive(true);
    return () => setCameraScanActive(false);
  }, [isOpen]);

  const isContinuousRef = useRef<boolean>(isContinuous);
  const lastScannedCodeRef = useRef<{ code: string; time: number }>({ code: "", time: 0 });

  useEffect(() => {
    isContinuousRef.current = isContinuous;
  }, [isContinuous]);

  // Stop camera helper
  const stopLiveCamera = async () => {
    compactFitCleanupRef.current?.();
    compactFitCleanupRef.current = null;
    const scanner = html5QrCodeRef.current;
    html5QrCodeRef.current = null;
    const torch = torchRef.current;
    torchRef.current = null;
    torchBusyRef.current = false;
    setIsTorchSupported(false);
    setIsTorchOn(false);
    setIsTorchChanging(false);
    setTorchError("");
    const stopped = cameraStopRef.current.then(async () => {
      if (!scanner) return;
      try {
        if (scanner.isScanning) {
          // Release the light before stopping the video track. Stopping the
          // track also releases it when a device rejects the off constraint.
          try {
            if (torch?.value()) await torch.apply(false);
          } catch { /* Stopping the track releases unsupported/busy torches. */ }
          await scanner.stop();
        }
        scanner.clear();
      } catch (e) {
        console.warn("Stop camera error:", e);
      }
    });
    cameraStopRef.current = stopped;
    await stopped;
    setIsScanningLive(false);
  };

  const toggleTorch = async () => {
    const torch = torchRef.current;
    if (!torch || torchBusyRef.current) return;
    const next = !isTorchOn;
    torchBusyRef.current = true;
    setIsTorchChanging(true);
    setTorchError("");
    try {
      await torch.apply(next);
      if (torchRef.current !== torch) return;
      const actual = torch.value();
      if (actual !== null && actual !== next) throw new Error("Torch did not change");
      setIsTorchOn(next);
    } catch {
      if (torchRef.current === torch) {
        setTorchError("เปลี่ยนสถานะแฟลชไม่สำเร็จ กรุณาลองอีกครั้ง");
      }
    } finally {
      if (torchRef.current === torch) {
        torchBusyRef.current = false;
        setIsTorchChanging(false);
      }
    }
  };

  const submitScan = useCallback(async (rawCode: string, closeAfterScan = false, playSound = true) => {
    const code = rawCode.trim();
    if (!code || processingRef.current) return;
    processingRef.current = true;
    setIsProcessing(true);
    setScanError(null);
    const callbacks = callbacksRef.current;
    try {
      await callbacks.onScan?.(code, playSound);
      await callbacks.onScanSuccess?.(code, playSound);
      if (playSound && !callbacks.feedbackHandledByCaller) feedbackSuccess();
      if (!persistOpenRef.current && (closeAfterScan || !isContinuousRef.current)) callbacks.onClose();
    } catch {
      if (playSound) feedbackError();
      setScanError({ type: "error", message: "สแกนไม่สำเร็จ กรุณาลองอีกครั้ง" });
    } finally {
      processingRef.current = false;
      setIsProcessing(false);
    }
  }, []);

  useEffect(() => {
    if (!isOpen) {
      void stopLiveCamera();
      return;
    }

    let isSubscribed = true;
    setCameraError("");
    setScanError(null);
    lastScannedCodeRef.current = { code: "", time: 0 };

    async function initLiveScanner() {
      await stopLiveCamera();

      try {
        // โหลด decoder เมื่อเปิดกล้องเท่านั้น เพื่อไม่ให้ทุกหน้าใช้งานต้องรอไลบรารีนี้
        const { Html5Qrcode, Html5QrcodeSupportedFormats } = await import("html5-qrcode");
        // ผู้ใช้อาจปิดกล้องระหว่างดาวน์โหลด — อย่าเริ่มกล้องหลัง modal ถูกปิด
        if (!isSubscribed || !document.getElementById(scannerId)) return;

        const formatsToSupport = [
          Html5QrcodeSupportedFormats.EAN_13,
          Html5QrcodeSupportedFormats.CODE_128,
          Html5QrcodeSupportedFormats.EAN_8,
          Html5QrcodeSupportedFormats.QR_CODE,
          Html5QrcodeSupportedFormats.UPC_A,
          Html5QrcodeSupportedFormats.UPC_E,
          Html5QrcodeSupportedFormats.CODE_39,
        ];

        const scanner = new Html5Qrcode(scannerId, {
          formatsToSupport,
          verbose: false,
        });
        html5QrCodeRef.current = scanner;

        const root = document.getElementById(scannerId);
        const viewport = root?.parentElement;
        if (compactViewport && root && viewport) {
          compactFitCleanupRef.current?.();
          compactFitCleanupRef.current = attachCompactScanVideoFit(viewport, root);
        }

        const aspectRatio = compactViewport && viewport
          ? cameraScanAspectRatio(viewport.clientWidth, viewport.clientHeight)
          : 1.777778;

        await scanner.start(
          { facingMode: "environment" },
          compactViewport
            ? {
                fps: 25,
                qrbox: cameraScanQrboxCompact,
                // ideal (not exact) so a device that cannot match the box still starts
                videoConstraints: {
                  facingMode: "environment",
                  aspectRatio: { ideal: aspectRatio },
                },
              }
            : {
                fps: 25,
                qrbox: cameraScanQrbox,
                aspectRatio: 1.777778,
              },
          (decodedText) => {
            if (isSubscribed && decodedText && !processingRef.current) {
              const now = Date.now();
              // Prevent duplicate camera triggers for same code within 1.5 seconds in continuous mode
              if (
                decodedText === lastScannedCodeRef.current.code &&
                now - lastScannedCodeRef.current.time < 1500
              ) {
                return;
              }
              lastScannedCodeRef.current = { code: decodedText, time: now };

              void submitScan(decodedText);
            }
          },
          () => {
            // Frame error ignored
          }
        );

        if (isSubscribed) {
          setIsScanningLive(true);
          try {
            const capabilities = scanner.getRunningTrackCapabilities() as MediaTrackCapabilities & { torch?: boolean };
            const torch = scanner.getRunningTrackCameraCapabilities().torchFeature();
            const supported = capabilities.torch === true && torch.isSupported();
            torchRef.current = supported ? torch : null;
            setIsTorchSupported(supported);
            setIsTorchOn(supported && torch.value() === true);
          } catch {
            // Camera scanning still works when torch capabilities are absent.
            setIsTorchSupported(false);
          }
        } else if (scanner.isScanning) {
          // The user may close the modal while camera permission is pending.
          await scanner.stop();
        }
      } catch (err: unknown) {
        console.warn("Live camera start failed:", err);
        if (isSubscribed) {
          setCameraError(
            "ไม่สามารถเปิดวิดีโอกล้องสดบน HTTP หรือเบราว์เซอร์นี้ได้ โปรดพิมพ์รหัสบาร์โค้ดด้านล่าง หรือลองเปิดกล้องอีกครั้ง"
          );
        }
      }
    }

    const timer = setTimeout(() => {
      void initLiveScanner();
    }, 100);

    return () => {
      isSubscribed = false;
      clearTimeout(timer);
      void stopLiveCamera();
    };
  }, [isOpen, submitScan, scannerId, compactViewport]);

  if (!isOpen && !persistOpen) return null;

  const flashButton = (
    <button
      type="button"
      aria-pressed={isTorchOn}
      aria-busy={isTorchChanging}
      aria-label={isTorchOn ? "ปิดแฟลช" : "เปิดแฟลช"}
      disabled={!isScanningLive || !isTorchSupported || isTorchChanging}
      onClick={() => void toggleTorch()}
      title={!isScanningLive ? "รอกล้องพร้อมใช้งาน" : !isTorchSupported ? "กล้องหรือเบราว์เซอร์นี้ไม่รองรับแฟลช" : undefined}
      className={
        compactViewport
          ? `absolute left-2 bottom-2 z-10 flex size-9 items-center justify-center rounded-full border border-white/20 text-white transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${isTorchOn ? "bg-m3-primary" : "bg-[rgba(28,37,46,0.55)]"}`
          : `flex shrink-0 items-center gap-2 rounded-xl border px-3 py-2 text-xs font-bold transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${isTorchOn ? "border-m3-primary bg-m3-primary text-white" : "border-[rgba(145,158,171,0.32)] bg-white text-m3-grey-800 hover:bg-m3-grey-100"}`
      }
    >
      <svg aria-hidden="true" className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round"><path d="m13 2-9 12h7l-1 8 10-12h-7l1-8Z" /></svg>
      {compactViewport ? null : isTorchChanging ? "กำลังเปลี่ยนแฟลช..." : isTorchOn ? "ปิดแฟลช" : "เปิดแฟลช"}
    </button>
  );

  const showFooter = !compactViewport || !hideManualInput || !hideSoundHint;

  return (
    <div onPointerDownCapture={prepareFeedbackAudio} onKeyDownCapture={prepareFeedbackAudio} className={presentation === "inline" ? "w-full" : "fixed inset-0 z-[100000] flex items-center justify-center p-2.5 sm:p-4 bg-m3-grey-800/50 fade-in"}>

      <div
        role={presentation === "inline" ? "region" : "dialog"}
        aria-modal={presentation === "modal" ? true : undefined}
        aria-labelledby={titleId}
        className={`relative flex w-full flex-col overflow-hidden rounded-xl border border-[rgba(145,158,171,0.2)] bg-white ${presentation === "inline" ? "shadow-m3-card" : "max-w-lg max-h-[90dvh] shadow-m3-dropdown"}`}
      >
        {/* Header */}
        <div className={`flex items-center justify-between gap-2 border-b border-[rgba(145,158,171,0.16)] bg-white ${compactViewport || persistOpen ? "h-8 px-3" : "bg-m3-grey-100 px-3 py-2.5 sm:px-5 sm:py-3.5"}`}>
          <div className="flex items-center gap-2 sm:gap-2.5 min-w-0 flex-1">
            <div className={`flex items-center justify-center bg-[rgba(0,167,111,0.08)] text-m3-primary-dark shrink-0 ${compactViewport || persistOpen ? "size-[22px] rounded-md" : "h-7 w-7 rounded-lg border border-[rgba(0,167,111,0.24)] sm:h-8 sm:w-8"}`}>
              <svg className={compactViewport || persistOpen ? "h-3.5 w-3.5" : "h-4 w-4 sm:h-5 sm:w-5"} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
            </div>
            <div className="min-w-0 flex-1">
              <h3 id={titleId} className={`font-bold text-m3-grey-800 leading-tight truncate ${compactViewport || persistOpen ? "text-[12.5px]" : "text-xs sm:text-sm"}`}>สแกนบาร์โค้ดสินค้า</h3>
            </div>
          </div>

          {persistOpen ? (
            <div className="flex shrink-0 items-center gap-1.5 text-[11px] font-bold text-m3-primary-dark">
              <span className={`size-1.5 rounded-full ${isScanningLive ? "bg-m3-primary shadow-[0_0_0_3px_rgba(0,167,111,0.16)]" : "bg-m3-grey-400"}`} />
              <span>{isScanningLive ? "พร้อมสแกน" : isProcessing ? "กำลังตรวจสอบรหัส..." : cameraError ? "" : "กำลังเปิดกล้อง"}</span>
            </div>
          ) : (
          <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
            <button
              type="button"
              onClick={() => setIsContinuous(!isContinuous)}
              className={`px-2 sm:px-2.5 py-1 sm:py-1.5 rounded-xl text-xs sm:text-xs font-bold flex items-center gap-1 sm:gap-1.5 transition-all border cursor-pointer ${
                isContinuous
                  ? "bg-[rgba(0,167,111,0.08)] text-m3-primary-darker border-[rgba(0,167,111,0.24)] shadow-2xs"
                  : "bg-white text-m3-grey-600 border-[rgba(145,158,171,0.2)] hover:bg-m3-grey-100"
              }`}
              title={isContinuous ? "โหมดสแกนต่อเนื่อง (สแกนหลายๆ บาร์โค้ดได้โดยไม่ต้องปิดกล้อง)" : "โหมดสแกนทีละครั้ง"}
            >
              <span className={`w-1.5 h-1.5 sm:w-2 sm:h-2 rounded-full ${isContinuous ? "bg-m3-primary animate-pulse" : "bg-m3-grey-500"}`} />
              <span>{isContinuous ? "⚡ ต่อเนื่อง" : "ทีละครั้ง"}</span>
            </button>

            <button
              type="button"
              aria-label="ปิดกล้องสแกน"
              onClick={onClose}
              className="p-1 sm:p-1.5 rounded-lg text-m3-grey-500 hover:text-m3-grey-700 hover:bg-m3-grey-300/60 transition-colors cursor-pointer"
            >
              <svg className="w-4 h-4 sm:w-5 sm:h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
          )}
        </div>

        {/* Video Camera Viewport */}
        <div className={`stockify-scan-viewport relative bg-[#151B22] flex items-center justify-center overflow-hidden ${compactViewport ? `stockify-scan-compact ${COMPACT_SCAN_VIEWPORT_HEIGHT_CLASS} flex-none p-0` : "bg-m3-grey-800 flex-1 min-h-[200px] max-h-[min(280px,48vh)] sm:min-h-[260px] sm:max-h-[360px] p-2"}`}>
          <div id={scannerId} className="h-full w-full text-center text-xs text-m3-grey-400" />

          {cameraError && (
            <div className="absolute inset-0 bg-white p-6 text-center space-y-4 flex flex-col items-center justify-center">
              <div className="w-14 h-14 rounded-full bg-[rgba(0,167,111,0.08)] border border-[rgba(0,167,111,0.24)] text-m3-primary-dark flex items-center justify-center mx-auto">
                <svg className="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
                </svg>
              </div>
              <p className="text-xs text-m3-grey-600 leading-relaxed font-medium max-w-xs">{cameraError}</p>

            </div>
          )}

          {compactViewport && !cameraError && flashButton}
          {compactViewport && torchError && (
            <p role="alert" className="absolute inset-x-2 bottom-11 z-10 rounded-md bg-black/55 px-2 py-1 text-center text-[11px] font-semibold text-white">{torchError}</p>
          )}
        </div>

        {afterViewport}

        {showFooter && (
        <div className="p-4 border-t border-[rgba(145,158,171,0.2)] bg-m3-grey-100 space-y-3">
          {!compactViewport && (
            <>
              <div className="flex items-center gap-3">
                {flashButton}
                {isScanningLive && !isTorchSupported && <span className="text-xs text-m3-grey-600">กล้องนี้ไม่รองรับแฟลช</span>}
              </div>
              {torchError && <p role="alert" className="text-xs font-semibold text-m3-error-dark">{torchError}</p>}
            </>
          )}
          {!hideSoundHint && (
          <div className="flex items-center justify-between gap-2 text-xs text-m3-grey-600">
            <span>{isProcessing ? "กำลังตรวจสอบรหัส..." : isScanningLive ? "พร้อมสแกน • สำเร็จ: บี๊ปสั้น / ไม่สำเร็จ: เสียงต่ำ 2 ครั้ง" : "สำเร็จ: บี๊ปสั้น / ไม่สำเร็จ: เสียงต่ำ 2 ครั้ง"}</span>
            <button type="button" onClick={playSuccessSound} className="shrink-0 rounded-lg border border-[rgba(145,158,171,0.32)] bg-white px-2 py-1 font-bold text-m3-grey-800 cursor-pointer hover:bg-[rgba(145,158,171,0.08)]">ทดสอบเสียง</button>
          </div>
          )}
          <div role="status" aria-live="polite">
            <ScanFeedbackBanner feedback={scanError || feedback || null} />
          </div>
          {/* Manual Input Fallback */}
          {!hideManualInput && (
          <div className="flex gap-2">
            <input
              type="text"
              value={manualCode}
              onChange={(e) => setManualCode(e.target.value)}
              disabled={isProcessing}
              onKeyDown={(e) => {
                if (e.key === "Enter" && manualCode.trim()) {
                  e.preventDefault();
                  void submitScan(manualCode, true, false);
                }
              }}
              placeholder="หรือพิมพ์รหัสบาร์โค้ดตรงนี้..."
              className="flex-1 px-3.5 py-2 rounded-xl bg-white border border-[rgba(145,158,171,0.2)] text-m3-grey-800 placeholder-m3-grey-500 text-xs tabular-nums focus:outline-none focus:border-m3-grey-800 focus:ring-2 focus:ring-m3-primary/20"
            />
            <button
              type="button"
              disabled={isProcessing || !manualCode.trim()}
              onClick={() => {
                if (manualCode.trim()) {
                  void submitScan(manualCode, true, false);
                }
              }}
              className="px-4 py-2 rounded-xl bg-m3-primary hover:bg-m3-primary-darker text-white text-xs font-bold shadow-xs transition-all cursor-pointer active:scale-95"
            >
              ตกลง
            </button>
          </div>
          )}
        </div>
        )}
      </div>
    </div>
  );
}
