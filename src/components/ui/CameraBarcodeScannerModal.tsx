"use client";

import React, { useEffect, useRef, useState, useCallback } from "react";
import type { Html5Qrcode } from "html5-qrcode";
import { useEscapeKey } from "@/hooks/use-escape-key";
import { feedbackError, feedbackSuccess, playSuccessSound, prepareFeedbackAudio, setCameraScanActive } from "@/client/feedback";
import ScanFeedbackBanner, { type ScanFeedback } from "@/components/scanner/ScanFeedbackBanner";

interface DetectedBarcode { rawValue: string }
type BarcodeDetectorConstructor = new (options: { formats: string[] }) => {
  detect: (image: HTMLImageElement) => Promise<DetectedBarcode[]>;
};

interface CameraBarcodeScannerModalProps {
  isOpen: boolean;
  onClose: () => void;
  onScan?: (code: string, playSound: boolean) => void | Promise<void>;
  onScanSuccess?: (code: string, playSound: boolean) => void | Promise<void>;
  /** Validation handlers already play the accepted/rejected result. */
  feedbackHandledByCaller?: boolean;
  feedback?: ScanFeedback | null;
}

export default function CameraBarcodeScannerModal({
  isOpen,
  onClose,
  onScan,
  onScanSuccess,
  feedbackHandledByCaller = false,
  feedback,
}: CameraBarcodeScannerModalProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const html5QrCodeRef = useRef<Html5Qrcode | null>(null);

  const [cameraError, setCameraError] = useState<string>("");
  const [manualCode, setManualCode] = useState<string>("");
  const [isScanningLive, setIsScanningLive] = useState<boolean>(false);
  const [isContinuous, setIsContinuous] = useState<boolean>(true);
  const [scanError, setScanError] = useState<ScanFeedback | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const processingRef = useRef(false);
  const fileScanRef = useRef(false);
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

  const isContinuousRef = useRef<boolean>(true);
  const lastScannedCodeRef = useRef<{ code: string; time: number }>({ code: "", time: 0 });

  useEffect(() => {
    isContinuousRef.current = isContinuous;
  }, [isContinuous]);

  // Stop camera helper
  const stopLiveCamera = async () => {
    if (html5QrCodeRef.current) {
      try {
        if (html5QrCodeRef.current.isScanning) {
          await html5QrCodeRef.current.stop();
        }
        html5QrCodeRef.current.clear();
      } catch (e) {
        console.warn("Stop camera error:", e);
      }
      html5QrCodeRef.current = null;
    }
    setIsScanningLive(false);
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
        if (!isSubscribed || !document.getElementById("html5qr-code-full-region")) return;

        const formatsToSupport = [
          Html5QrcodeSupportedFormats.EAN_13,
          Html5QrcodeSupportedFormats.CODE_128,
          Html5QrcodeSupportedFormats.EAN_8,
          Html5QrcodeSupportedFormats.QR_CODE,
          Html5QrcodeSupportedFormats.UPC_A,
          Html5QrcodeSupportedFormats.UPC_E,
          Html5QrcodeSupportedFormats.CODE_39,
        ];

        const scanner = new Html5Qrcode("html5qr-code-full-region", {
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
            if (isSubscribed && decodedText && !processingRef.current && !fileScanRef.current) {
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
        }
      } catch (err: unknown) {
        console.warn("Live camera start failed:", err);
        if (isSubscribed) {
          setCameraError(
            "ไม่สามารถเปิดวิดีโอกล้องสดบน HTTP หรือเบราว์เซอร์นี้ได้ โปรดใช้ปุ่ม '📷 ถ่ายรูปด้วยกล้องมือถือ' เพื่อถ่ายสแกนด่วน"
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
  }, [isOpen, submitScan]);

  // Decode barcode from captured photo file using Html5Qrcode scanFile
  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    const input = e.currentTarget;
    if (!file || processingRef.current || fileScanRef.current) return;
    prepareFeedbackAudio();
    fileScanRef.current = true;
    setIsProcessing(true);
    setScanError(null);
    let decodedText = "";
    let tempScanner: Html5Qrcode | null = null;

    try {
      const { Html5Qrcode } = await import("html5-qrcode");
      tempScanner = new Html5Qrcode("html5qr-temp-file-reader");
      decodedText = await tempScanner.scanFile(file, false);
    } catch (err) {
      console.warn("Html5Qrcode scanFile error:", err);
    } finally {
      try {
        tempScanner?.clear();
      } catch (err) {
        console.warn("Photo scanner cleanup error:", err);
      }
    }

    // Secondary fallback using BarcodeDetector API if available
    let objectUrl: string | undefined;
    try {
      const Detector = (window as unknown as { BarcodeDetector?: BarcodeDetectorConstructor }).BarcodeDetector;
      if (!decodedText && Detector) {
        const img = new Image();
        objectUrl = URL.createObjectURL(file);
        img.src = objectUrl;
        await img.decode();
        const formats = ["qr_code", "ean_13", "ean_8", "code_128", "code_39", "upc_a", "upc_e"];
        const detector = new Detector({ formats });
        const barcodes = await detector.detect(img);

        if (barcodes && barcodes.length > 0 && barcodes[0].rawValue) {
          decodedText = barcodes[0].rawValue;
        }
      }
    } catch (err) {
      console.warn("BarcodeDetector fallback error:", err);
    } finally {
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      input.value = "";
      fileScanRef.current = false;
      setIsProcessing(false);
    }

    if (decodedText) {
      await submitScan(decodedText, true);
    } else {
      feedbackError();
      setScanError({ type: "error", message: "สแกนไม่เข้า: ไม่พบบาร์โค้ดในรูป กรุณาถ่ายใหม่ให้รหัสสว่างและชัดเจน หรือพิมพ์รหัสด้านล่าง" });
    }
  };

  if (!isOpen) return null;

  return (
    <div onPointerDownCapture={prepareFeedbackAudio} onKeyDownCapture={prepareFeedbackAudio} className="fixed inset-0 z-[100000] flex items-center justify-center p-2.5 sm:p-4 bg-m3-grey-800/50 fade-in">
      {/* Hidden container required by Html5Qrcode.scanFile */}
      <div id="html5qr-temp-file-reader" className="hidden" />

      <div className="relative w-full max-w-lg bg-white border border-[rgba(145,158,171,0.2)] rounded-xl shadow-m3-dropdown overflow-hidden flex flex-col max-h-[90dvh]">
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
              <h3 className="text-xs sm:text-sm font-bold text-m3-grey-800 leading-tight truncate">สแกนบาร์โค้ดสินค้า</h3>
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
          <div id="html5qr-code-full-region" className="w-full h-full text-m3-grey-400 text-xs text-center" />

          {cameraError && (
            <div className="absolute inset-0 bg-white p-6 text-center space-y-4 flex flex-col items-center justify-center">
              <div className="w-14 h-14 rounded-full bg-[rgba(0,167,111,0.08)] border border-[rgba(0,167,111,0.24)] text-m3-primary-dark flex items-center justify-center mx-auto">
                <svg className="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
                </svg>
              </div>
              <p className="text-xs text-m3-grey-600 leading-relaxed font-medium max-w-xs">{cameraError}</p>

              {/* Native mobile camera capture button */}
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="w-full py-3 px-4 rounded-xl bg-m3-primary hover:bg-m3-primary-darker text-white font-bold text-sm shadow-md shadow-m3-primary/20 flex items-center justify-center gap-2 transition-all cursor-pointer active:scale-95"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
                </svg>
                <span>📷 ถ่ายรูปสแกนบาร์โค้ดด้วยกล้องมือถือ</span>
              </button>
            </div>
          )}
        </div>

        {/* Footer Actions */}
        <div className="p-4 border-t border-[rgba(145,158,171,0.2)] bg-m3-grey-100 space-y-3">
          <div className="flex items-center justify-between gap-2 text-xs text-m3-grey-600">
            <span>{isProcessing ? "กำลังตรวจสอบรหัส..." : isScanningLive ? "พร้อมสแกน • สำเร็จ: บี๊ปสั้น / ไม่สำเร็จ: เสียงต่ำ 2 ครั้ง" : "สำเร็จ: บี๊ปสั้น / ไม่สำเร็จ: เสียงต่ำ 2 ครั้ง"}</span>
            <button type="button" onClick={playSuccessSound} className="shrink-0 rounded-lg border border-[rgba(145,158,171,0.32)] bg-white px-2 py-1 font-bold text-m3-grey-800 cursor-pointer hover:bg-[rgba(145,158,171,0.08)]">ทดสอบเสียง</button>
          </div>
          <div role="status" aria-live="polite">
            <ScanFeedbackBanner feedback={scanError || feedback || null} />
          </div>
          {/* Native camera file input */}
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            capture="environment"
            disabled={isProcessing}
            onChange={handleFileUpload}
            className="hidden"
          />

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-white hover:bg-m3-grey-200 border border-[rgba(145,158,171,0.2)] text-xs font-bold text-m3-grey-700 cursor-pointer transition-all shadow-xs active:scale-95"
            >
              <svg className="w-4 h-4 text-m3-primary-dark" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
              </svg>
              <span>📷 ถ่ายรูปสแกนบาร์โค้ดด้วยกล้องมือถือ</span>
            </button>
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
