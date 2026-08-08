"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { Html5Qrcode, Html5QrcodeSupportedFormats } from "html5-qrcode";

interface CameraBarcodeScannerModalProps {
  isOpen: boolean;
  onClose: () => void;
  onScan?: (code: string) => void;
  onScanSuccess?: (code: string) => void;
}

export default function CameraBarcodeScannerModal({
  isOpen,
  onClose,
  onScan,
  onScanSuccess,
}: CameraBarcodeScannerModalProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const html5QrCodeRef = useRef<Html5Qrcode | null>(null);

  const [cameraError, setCameraError] = useState<string>("");
  const [manualCode, setManualCode] = useState<string>("");
  const [isScanningLive, setIsScanningLive] = useState<boolean>(false);

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

  const playSuccessBeep = useCallback(() => {
    try {
      if (typeof window !== "undefined" && "AudioContext" in window) {
        const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = "sine";
        osc.frequency.value = 1000;
        gain.gain.value = 0.15;
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start();
        osc.stop(ctx.currentTime + 0.18);
      }
      if (typeof navigator !== "undefined" && navigator.vibrate) {
        navigator.vibrate(120);
      }
    } catch {
      // Audio fallback
    }
  }, []);

  useEffect(() => {
    if (!isOpen) {
      void stopLiveCamera();
      return;
    }

    let isSubscribed = true;

    async function initLiveScanner() {
      await stopLiveCamera();

      // Check if container element exists
      const region = document.getElementById("html5qr-code-full-region");
      if (!region) return;

      try {
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
            if (isSubscribed && decodedText) {
              playSuccessBeep();
              if (onScan) onScan(decodedText);
              if (onScanSuccess) onScanSuccess(decodedText);
              onClose();
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
  }, [isOpen, onScan, onScanSuccess, onClose, playSuccessBeep]);

  // Decode barcode from captured photo file using Html5Qrcode scanFile
  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      // Create temporary Html5Qrcode instance for photo scanning
      const tempScanner = new Html5Qrcode("html5qr-temp-file-reader");
      const decodedText = await tempScanner.scanFile(file, false);

      if (decodedText) {
        playSuccessBeep();
        onScan?.(decodedText);
        onClose();
        return;
      }
    } catch (err) {
      console.warn("Html5Qrcode scanFile error:", err);
    } finally {
      e.target.value = "";
    }

    // Secondary fallback using BarcodeDetector API if available
    try {
      const file = e.target.files?.[0];
      if (file && typeof window !== "undefined" && "BarcodeDetector" in window) {
        const img = new Image();
        img.src = URL.createObjectURL(file);
        await img.decode();
        const formats = ["qr_code", "ean_13", "ean_8", "code_128", "code_39", "upc_a", "upc_e"];
        const detector = new (window as any).BarcodeDetector({ formats });
        const barcodes = await detector.detect(img);

        if (barcodes && barcodes.length > 0 && barcodes[0].rawValue) {
          playSuccessBeep();
          onScan?.(barcodes[0].rawValue);
          onClose();
          return;
        }
      }
    } catch (err) {
      console.warn("BarcodeDetector fallback error:", err);
    }

    alert("ไม่พบรหัสบาร์โค้ดในรูปภาพที่ถ่าย โปรดลองถ่ายใหม่อีกครั้งโดยวางรูปบาร์โค้ดให้สว่างและชัดเจน หรือพิมพ์รหัสในช่องด้านล่าง");
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-black/85 backdrop-blur-md fade-in">
      {/* Hidden container required by Html5Qrcode.scanFile */}
      <div id="html5qr-temp-file-reader" className="hidden" />

      <div className="relative w-full max-w-lg bg-[#111118] border border-white/[0.12] rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[92vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-white/[0.08] bg-white/[0.02]">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-indigo-500/20 border border-indigo-500/30 flex items-center justify-center text-indigo-400">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0118.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
            </div>
            <div>
              <h3 className="text-sm font-bold text-white leading-tight">สแกนบาร์โค้ดสินค้า (Html5 QR Code Barcode Engine)</h3>
              <p className="text-[11px] text-slate-400">สแกนกล้องสด หรือ ถ่ายรูปบาร์โค้ดด่วน</p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-white/[0.08] transition-colors cursor-pointer"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Video Camera Viewport */}
        <div className="relative bg-black flex-1 min-h-[260px] sm:min-h-[300px] flex items-center justify-center overflow-hidden p-2">
          <div id="html5qr-code-full-region" className="w-full h-full text-slate-300 text-xs text-center" />

          {cameraError && (
            <div className="absolute inset-0 bg-[#111118] p-6 text-center space-y-4 flex flex-col items-center justify-center">
              <div className="w-14 h-14 rounded-full bg-indigo-500/10 border border-indigo-500/20 text-indigo-400 flex items-center justify-center mx-auto">
                <svg className="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
                </svg>
              </div>
              <p className="text-xs text-slate-300 leading-relaxed font-medium max-w-xs">{cameraError}</p>

              {/* Native mobile camera capture button */}
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="w-full py-3 px-4 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-sm shadow-lg shadow-indigo-600/30 flex items-center justify-center gap-2 transition-all cursor-pointer"
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
        <div className="p-4 border-t border-white/[0.08] bg-[#111118] space-y-3">
          {/* Native camera file input */}
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            capture="environment"
            onChange={handleFileUpload}
            className="hidden"
          />

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-indigo-500/20 hover:bg-indigo-500/30 border border-indigo-500/40 text-xs font-bold text-indigo-200 cursor-pointer transition-all shadow-md"
            >
              <svg className="w-4.5 h-4.5 text-indigo-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
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
              onKeyDown={(e) => {
                if (e.key === "Enter" && manualCode.trim()) {
                  e.preventDefault();
                  onScan?.(manualCode.trim());
                  onClose();
                }
              }}
              placeholder="หรือพิมพ์รหัสบาร์โค้ดตรงนี้..."
              className="flex-1 px-3.5 py-2 rounded-xl bg-white/[0.04] border border-white/[0.08] text-white placeholder-slate-500 text-xs font-mono focus:outline-none focus:border-indigo-500"
            />
            <button
              type="button"
              onClick={() => {
                if (manualCode.trim()) {
                  onScan?.(manualCode.trim());
                  onClose();
                }
              }}
              className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold transition-all cursor-pointer"
            >
              ตกลง
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
