"use client";

import React, { useEffect, useRef, useState, useCallback, useId } from "react";
import type { CameraCapabilities, Html5Qrcode } from "html5-qrcode";
import { useEscapeKey } from "@/hooks/use-escape-key";
import { feedbackError, feedbackSuccess, playSuccessSound, prepareFeedbackAudio, setCameraScanActive } from "@/client/feedback";
import ScanFeedbackBanner, { type ScanFeedback } from "@/components/scanner/ScanFeedbackBanner";

interface CameraBarcodeScannerModalProps {
  isOpen: boolean;
  onClose: () => void;
  onScan?: (code: string, playSound: boolean) => void | Promise<void>;
  onScanSuccess?: (code: string, playSound: boolean) => void | Promise<void>;
  /** Validation handlers already play the accepted/rejected result. */
  feedbackHandledByCaller?: boolean;
  feedback?: ScanFeedback | null;
  presentation?: "modal" | "inline";
}

export default function CameraBarcodeScannerModal({
  isOpen,
  onClose,
  onScan,
  onScanSuccess,
  feedbackHandledByCaller = false,
  feedback,
  presentation = "modal",
}: CameraBarcodeScannerModalProps) {
  const scannerId = useId();
  const titleId = `${scannerId}-title`;
  const html5QrCodeRef = useRef<Html5Qrcode | null>(null);
  const torchRef = useRef<ReturnType<CameraCapabilities["torchFeature"]> | null>(null);
  const torchBusyRef = useRef(false);
  const cameraStopRef = useRef<Promise<void>>(Promise.resolve());

  const [cameraError, setCameraError] = useState<string>("");
  const [manualCode, setManualCode] = useState<string>("");
  const [isScanningLive, setIsScanningLive] = useState<boolean>(false);
  const [isTorchSupported, setIsTorchSupported] = useState(false);
  const [isTorchOn, setIsTorchOn] = useState(false);
  const [isTorchChanging, setIsTorchChanging] = useState(false);
  const [torchError, setTorchError] = useState("");
  const [isContinuous, setIsContinuous] = useState<boolean>(false);
  const [scanError, setScanError] = useState<ScanFeedback | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const processingRef = useRef(false);
  const callbacksRef = useRef({ onScan, onScanSuccess, onClose, feedbackHandledByCaller });

  useEffect(() => {
    callbacksRef.current = { onScan, onScanSuccess, onClose, feedbackHandledByCaller };
  }, [onScan, onScanSuccess, onClose, feedbackHandledByCaller]);

  useEscapeKey(isOpen, onClose);

  // ป้ายเด้ง "สแกนสำเร็จ/ไม่สำเร็จ" ขวาบน ทำงานเฉพาะตอนเปิดกล้อง
  useEffect(() => {
    if (!isOpen) return;
    setCameraScanActive(true);
    return () => setCameraScanActive(false);
  }, [isOpen]);

  const isContinuousRef = useRef<boolean>(false);
  const lastScannedCodeRef = useRef<{ code: string; time: number }>({ code: "", time: 0 });

  useEffect(() => {
    isContinuousRef.current = isContinuous;
  }, [isContinuous]);

  // Stop camera helper
  const stopLiveCamera = async () => {
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
      if (closeAfterScan || !isContinuousRef.current) callbacks.onClose();
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

        await scanner.start(
          { facingMode: "environment" },
          {
            fps: 25,
            qrbox: (viewfinderWidth, viewfinderHeight) => {
              const minEdge = Math.min(viewfinderWidth, viewfinderHeight);
              return {
                width: Math.floor(minEdge * 0.9),
                height: Math.floor(minEdge * 0.6),
              };
            },
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
  }, [isOpen, submitScan, scannerId]);

  if (!isOpen) return null;

  return (
    <div onPointerDownCapture={prepareFeedbackAudio} onKeyDownCapture={prepareFeedbackAudio} className={presentation === "inline" ? "w-full" : "fixed inset-0 z-[100000] flex items-center justify-center p-2.5 sm:p-4 bg-m3-grey-800/50 fade-in"}>

      <div
        role={presentation === "inline" ? "region" : "dialog"}
        aria-modal={presentation === "modal" ? true : undefined}
        aria-labelledby={titleId}
        className={`relative flex w-full flex-col overflow-hidden rounded-xl border border-[rgba(145,158,171,0.2)] bg-white ${presentation === "inline" ? "shadow-m3-card" : "max-w-lg max-h-[90dvh] shadow-m3-dropdown"}`}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-3 sm:px-5 py-2.5 sm:py-3.5 border-b border-[rgba(145,158,171,0.2)] bg-m3-grey-100 gap-2">
          <div className="flex items-center gap-2 sm:gap-2.5 min-w-0 flex-1">
            <div className="w-7 h-7 sm:w-8 sm:h-8 rounded-lg bg-[rgba(0,167,111,0.08)] border border-[rgba(0,167,111,0.24)] flex items-center justify-center text-m3-primary-dark shrink-0">
              <svg className="w-4 h-4 sm:w-5 sm:h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
            </div>
            <div className="min-w-0 flex-1">
              <h3 id={titleId} className="text-xs sm:text-sm font-bold text-m3-grey-800 leading-tight truncate">สแกนบาร์โค้ดสินค้า</h3>
            </div>
          </div>

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
        </div>

        {/* Video Camera Viewport */}
        <div className="relative bg-m3-grey-800 flex-1 min-h-[260px] sm:min-h-[300px] flex items-center justify-center overflow-hidden p-2">
          <div id={scannerId} className="w-full h-full text-m3-grey-400 text-xs text-center" />

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
        </div>

        {/* Footer Actions */}
        <div className="p-4 border-t border-[rgba(145,158,171,0.2)] bg-m3-grey-100 space-y-3">
          <div className="flex items-center gap-3">
            <button
              type="button"
              aria-pressed={isTorchOn}
              aria-busy={isTorchChanging}
              aria-label={isTorchOn ? "ปิดแฟลช" : "เปิดแฟลช"}
              disabled={!isScanningLive || !isTorchSupported || isTorchChanging}
              onClick={() => void toggleTorch()}
              title={!isScanningLive ? "รอกล้องพร้อมใช้งาน" : !isTorchSupported ? "กล้องหรือเบราว์เซอร์นี้ไม่รองรับแฟลช" : undefined}
              className={`flex shrink-0 items-center gap-2 rounded-xl border px-3 py-2 text-xs font-bold transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${isTorchOn ? "border-m3-primary bg-m3-primary text-white" : "border-[rgba(145,158,171,0.32)] bg-white text-m3-grey-800 hover:bg-m3-grey-100"}`}
            >
              <svg aria-hidden="true" className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round"><path d="m13 2-9 12h7l-1 8 10-12h-7l1-8Z" /></svg>
              {isTorchChanging ? "กำลังเปลี่ยนแฟลช..." : isTorchOn ? "ปิดแฟลช" : "เปิดแฟลช"}
            </button>
            {isScanningLive && !isTorchSupported && <span className="text-xs text-m3-grey-600">กล้องนี้ไม่รองรับแฟลช</span>}
          </div>
          {torchError && <p role="alert" className="text-xs font-semibold text-m3-error-dark">{torchError}</p>}
          <div className="flex items-center justify-between gap-2 text-xs text-m3-grey-600">
            <span>{isProcessing ? "กำลังตรวจสอบรหัส..." : isScanningLive ? "พร้อมสแกน • สำเร็จ: บี๊ปสั้น / ไม่สำเร็จ: เสียงต่ำ 2 ครั้ง" : "สำเร็จ: บี๊ปสั้น / ไม่สำเร็จ: เสียงต่ำ 2 ครั้ง"}</span>
            <button type="button" onClick={playSuccessSound} className="shrink-0 rounded-lg border border-[rgba(145,158,171,0.32)] bg-white px-2 py-1 font-bold text-m3-grey-800 cursor-pointer hover:bg-[rgba(145,158,171,0.08)]">ทดสอบเสียง</button>
          </div>
          <div role="status" aria-live="polite">
            <ScanFeedbackBanner feedback={scanError || feedback || null} />
          </div>
          {/* Manual Input Fallback */}
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
        </div>
      </div>
    </div>
  );
}
