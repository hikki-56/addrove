/**
 * Standard Code 128 Encoding patterns (0..106)
 * Each pattern string represents widths of [bar, space, bar, space, bar, space]
 */
export const CODE128_PATTERNS: Record<number, string> = {
  0: "212222", 1: "222122", 2: "222221", 3: "121223", 4: "121322",
  5: "131222", 6: "122213", 7: "122312", 8: "132212", 9: "221213",
  10: "221312", 11: "231212", 12: "112232", 13: "122132", 14: "122231",
  15: "113222", 16: "123122", 17: "123221", 18: "223211", 19: "221132",
  20: "221231", 21: "213212", 22: "223112", 23: "312131", 24: "311222",
  25: "321122", 26: "321221", 27: "312212", 28: "322112", 29: "322211",
  30: "212123", 31: "212321", 32: "232121", 33: "111323", 34: "131123",
  35: "131321", 36: "112313", 37: "132113", 38: "132311", 39: "211313",
  40: "231113", 41: "231311", 42: "112133", 43: "112331", 44: "132131",
  45: "113123", 46: "113321", 47: "133121", 48: "313121", 49: "211331",
  50: "231131", 51: "213113", 52: "213311", 53: "213131", 54: "311123",
  55: "311321", 56: "331121", 57: "312113", 58: "312311", 59: "332111",
  60: "314111", 61: "221411", 62: "431111", 63: "111224", 64: "111422",
  65: "121124", 66: "121421", 67: "141122", 68: "141221", 69: "112214",
  70: "112412", 71: "142112", 72: "142211", 73: "241211", 74: "221114",
  75: "413111", 76: "241112", 77: "134111", 78: "111242", 79: "121142",
  80: "121241", 81: "114212", 82: "124112", 83: "124211", 84: "411212",
  85: "421112", 86: "421211", 87: "212141", 88: "214121", 89: "412121",
  90: "111143", 91: "111341", 92: "131141", 93: "114113", 94: "114311",
  95: "411113", 96: "411311", 97: "113141", 98: "114131", 99: "311141",
  100: "411131", 101: "211412", 102: "211214", 103: "211412",
  104: "211214", // Start B
  105: "211232", // Start C
  106: "2331112", // Stop
};

/**
 * Returns clean exact barcode string or SKU without modifying digits
 */
export function to8DigitBarcode(rawBarcode?: string, sku?: string, productName?: string): string {
  const isInvalid = (val?: string) => {
    if (!val) return true;
    const clean = val.trim().toLowerCase();
    return (
      clean === "" ||
      clean === "-" ||
      clean === "null" ||
      clean === "undefined" ||
      clean === "trf" ||
      clean === "trf-item" ||
      clean.startsWith("trf-") ||
      clean.startsWith("mov-") ||
      clean.startsWith("iss-")
    );
  };

  const code = (rawBarcode || "").trim();
  if (!isInvalid(code)) {
    return code;
  }
  const s = (sku || "").trim();
  if (!isInvalid(s)) {
    return s;
  }
  if (productName) {
    const match = productName.trim().match(/^(\d{3,18})/);
    if (match) {
      const numStr = match[1];
      if (numStr.length >= 7) return numStr;
      return "9000" + numStr.padStart(4, "0");
    }
  }
  return "";
}

/**
 * Encodes string to standard Code 128-B alternating bar/space modules.
 * Universally supported by 100% of handheld barcode guns and optical scanners.
 */
export function encodeCode128Modules(cleanValue: string): { isBar: boolean; width: number }[] {
  const codeValues: number[] = [104]; // Start Code B (104)
  let checksum = 104;

  for (let i = 0; i < cleanValue.length; i++) {
    const charCode = cleanValue.charCodeAt(i);
    let val = charCode - 32;
    if (val < 0 || val > 95) val = 0;
    codeValues.push(val);
    checksum += val * (i + 1);
  }

  const checksumVal = checksum % 103;
  codeValues.push(checksumVal);
  codeValues.push(106); // Stop symbol

  const modules: { isBar: boolean; width: number }[] = [];
  codeValues.forEach((code) => {
    const pattern = CODE128_PATTERNS[code] || "212222";
    let isBar = true;
    for (let j = 0; j < pattern.length; j++) {
      const w = parseInt(pattern[j], 10) || 1;
      modules.push({ isBar, width: w });
      isBar = !isBar;
    }
  });

  return modules;
}

/**
 * Generates a high-contrast PNG data URL for Code 128 Barcode on the client
 */
export function generateCode128PngDataUrl(
  value: string,
  options?: {
    scale?: number;
    height?: number;
    showText?: boolean;
    label?: string;
    textPosition?: "top" | "bottom";
  }
): string {
  if (typeof document === "undefined") return "";

  const cleanValue = (to8DigitBarcode(value) || value || "").trim();
  if (!cleanValue) return "";

  const modules = encodeCode128Modules(cleanValue);
  const scale = options?.scale || 4;
  const height = options?.height || 100;
  const showText = options?.showText !== false;
  const textPosition = options?.textPosition || "top";
  const quietZone = 14;

  const totalUnits = modules.reduce((sum, m) => sum + m.width, 0);
  const fullUnits = totalUnits + quietZone * 2;
  const canvasWidth = fullUnits * scale;
  const textHeight = showText ? Math.max(32, Math.floor(scale * 9)) : 0;
  const canvasHeight = height + textHeight;

  const canvas = document.createElement("canvas");
  canvas.width = canvasWidth;
  canvas.height = canvasHeight;

  const ctx = canvas.getContext("2d");
  if (!ctx) return "";

  // 1. High contrast crisp white background
  ctx.fillStyle = "#FFFFFF";
  ctx.fillRect(0, 0, canvasWidth, canvasHeight);

  const displayText = options?.label || cleanValue;
  const fontSize = Math.max(16, Math.floor(scale * 6.5));

  // 2. Human readable text (Top or Bottom)
  if (showText && textPosition === "top") {
    ctx.font = `bold ${fontSize}px monospace, Courier, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = "#000000";
    ctx.fillText(displayText, canvasWidth / 2, Math.floor(textHeight / 2) + 2);
  }

  // 3. Barcode black bars
  const barsStartY = showText && textPosition === "top" ? textHeight : 10;
  const barsHeight = height - 10;

  let currentX = quietZone * scale;
  ctx.fillStyle = "#000000";
  for (const m of modules) {
    const barW = m.width * scale;
    if (m.isBar) {
      ctx.fillRect(currentX, barsStartY, barW, barsHeight);
    }
    currentX += barW;
  }

  // 4. Human readable text (Bottom)
  if (showText && textPosition === "bottom") {
    ctx.font = `bold ${fontSize}px monospace, Courier, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = "#000000";
    ctx.fillText(displayText, canvasWidth / 2, height + 14);
  }

  return canvas.toDataURL("image/png");
}

/**
 * Generates a high-resolution sticker label PNG matching card design with top title & boxed barcode
 */
export function generateShelfBarcodeStickerDataUrl(
  locationCode: string
): string {
  if (typeof document === "undefined") return "";

  const cleanCode = (to8DigitBarcode(locationCode) || locationCode || "").trim();
  if (!cleanCode) return "";

  const modules = encodeCode128Modules(cleanCode);
  const barUnitWidth = 3;
  const quietZoneUnits = 10;
  const totalUnits = modules.reduce((sum, m) => sum + m.width, 0);
  const barcodeCoreWidth = (totalUnits + quietZoneUnits * 2) * barUnitWidth;
  const barcodeHeight = 105;

  // Inner box dimensions (containing the barcode stripes)
  const innerBoxPaddingX = 24;
  const innerBoxPaddingY = 18;
  const innerBoxWidth = barcodeCoreWidth + innerBoxPaddingX * 2;
  const innerBoxHeight = barcodeHeight + innerBoxPaddingY * 2;

  // Outer card dimensions
  const outerPaddingX = 32;
  const outerPaddingTop = 28;
  const outerPaddingBottom = 28;
  const titleHeight = 72;
  const gap = 16;

  const cardWidth = Math.max(500, innerBoxWidth + outerPaddingX * 2);
  const cardHeight = outerPaddingTop + titleHeight + gap + innerBoxHeight + outerPaddingBottom;

  const canvas = document.createElement("canvas");
  canvas.width = cardWidth;
  canvas.height = cardHeight;

  const ctx = canvas.getContext("2d");
  if (!ctx) return "";

  const drawRoundRect = (
    x: number,
    y: number,
    w: number,
    h: number,
    radius: number,
    fillColor?: string,
    strokeColor?: string,
    lineWidth: number = 1
  ) => {
    ctx.beginPath();
    if (typeof (ctx as any).roundRect === "function") {
      (ctx as any).roundRect(x, y, w, h, radius);
    } else {
      ctx.rect(x, y, w, h);
    }
    if (fillColor) {
      ctx.fillStyle = fillColor;
      ctx.fill();
    }
    if (strokeColor) {
      ctx.strokeStyle = strokeColor;
      ctx.lineWidth = lineWidth;
      ctx.stroke();
    }
  };

  // 1. Draw Outer Card (Pure white background with rounded corners & soft border)
  drawRoundRect(2, 2, cardWidth - 4, cardHeight - 4, 28, "#FFFFFF", "#e2e8f0", 2.5);

  // 2. Draw Top Location Code Title - Extra Large with Direction Arrows on BOTH Sides (A -> Down, B -> Up)
  const arrowDir = getShelfArrowDirection(cleanCode);
  const textY = outerPaddingTop + Math.floor(titleHeight / 2);

  if (arrowDir) {
    ctx.font = '900 64px monospace, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
    const textWidth = ctx.measureText(cleanCode).width;
    const arrowW = 36;
    const arrowH = 46;
    const gapWidth = 20;

    const totalWidth = arrowW + gapWidth + textWidth + gapWidth + arrowW;
    const startX = (cardWidth - totalWidth) / 2;

    const drawArrow = (arrowX: number) => {
      ctx.fillStyle = "#16a34a";
      if (arrowDir === "down") {
        const stemW = 14;
        const stemH = 24;
        const stemX = arrowX + (arrowW - stemW) / 2;
        const stemY = textY - arrowH / 2;
        ctx.fillRect(stemX, stemY, stemW, stemH);

        ctx.beginPath();
        ctx.moveTo(arrowX, stemY + stemH);
        ctx.lineTo(arrowX + arrowW, stemY + stemH);
        ctx.lineTo(arrowX + arrowW / 2, textY + arrowH / 2);
        ctx.closePath();
        ctx.fill();
      } else {
        const stemW = 14;
        const stemH = 24;
        const stemX = arrowX + (arrowW - stemW) / 2;
        const stemY = textY - arrowH / 2 + (arrowH - stemH);
        ctx.fillRect(stemX, stemY, stemW, stemH);

        ctx.beginPath();
        ctx.moveTo(arrowX, stemY);
        ctx.lineTo(arrowX + arrowW, stemY);
        ctx.lineTo(arrowX + arrowW / 2, textY - arrowH / 2);
        ctx.closePath();
        ctx.fill();
      }
    };

    // Draw Left Arrow (Green #16a34a)
    drawArrow(startX);

    // Draw Location Code text (Dark Slate)
    ctx.fillStyle = "#0f172a";
    ctx.font = '900 64px monospace, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillText(cleanCode, startX + arrowW + gapWidth, textY);

    // Draw Right Arrow (Green #16a34a)
    drawArrow(startX + arrowW + gapWidth + textWidth + gapWidth);
  } else {
    ctx.fillStyle = "#0f172a";
    ctx.font = '900 68px monospace, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(cleanCode, cardWidth / 2, textY);
  }

  // 3. Draw Inner Barcode Box (Rounded box with gray outline)
  const innerBoxX = (cardWidth - innerBoxWidth) / 2;
  const innerBoxY = outerPaddingTop + titleHeight + gap;
  drawRoundRect(innerBoxX, innerBoxY, innerBoxWidth, innerBoxHeight, 18, "#FFFFFF", "#cbd5e1", 2);

  // 4. Draw Barcode Stripes inside Inner Box
  let currentX = innerBoxX + innerBoxPaddingX + quietZoneUnits * barUnitWidth;
  const barY = innerBoxY + innerBoxPaddingY;
  ctx.fillStyle = "#000000";

  for (const m of modules) {
    const barW = m.width * barUnitWidth;
    if (m.isBar) {
      ctx.fillRect(currentX, barY, barW, barcodeHeight);
    }
    currentX += barW;
  }

  return canvas.toDataURL("image/png");
}

/**
 * Determines directional arrow for a shelf/location code:
 * - If code ends with 'A' or has sub-shelf 'A' (e.g. 1K14-1A, 1A, SH-A) -> 'down' (ลูกศรชี้ลง ↓)
 * - If code ends with 'B' or has sub-shelf 'B' (e.g. 1K14-1B, 1B, SH-B) -> 'up' (ลูกศรชี้ขึ้น ↑)
 */
export function getShelfArrowDirection(locationCode?: string): "down" | "up" | null {
  if (!locationCode) return null;
  const clean = locationCode.trim().toUpperCase();

  // 1. Exact ends with A or B (e.g. 1K14-1A, 1K14-1B, 1A, 1B, SH-A, SH-B)
  if (clean.endsWith("A") || /[-_. ]A$/i.test(clean)) {
    return "down";
  }
  if (clean.endsWith("B") || /[-_. ]B$/i.test(clean)) {
    return "up";
  }

  // 2. Suffix with separator before other trailing info
  const match = clean.match(/[-_.]([AB])(?:\D*$)/i);
  if (match && match[1]) {
    return match[1].toUpperCase() === "A" ? "down" : "up";
  }

  return null;
}

/**
 * Normalizes barcode string by trimming, converting to lowercase and removing spaces/special separators (#, -, _)
 */
export function normalizeBarcode(code?: string): string {
  if (!code) return "";
  return code.trim().toLowerCase().replace(/[\s\-_#]/g, "");
}

/**
 * Strict exact barcode matcher supporting full 13-digit EAN, 8-digit, SKU and Product IDs.
 */
export function areBarcodesMatching(
  scannedInput?: string,
  targetList?: Array<string | undefined>
): boolean {
  if (!scannedInput || !targetList || targetList.length === 0) return false;

  const scannedClean = normalizeBarcode(scannedInput);
  if (!scannedClean) return false;

  for (const rawTarget of targetList) {
    if (!rawTarget) continue;
    const targetClean = normalizeBarcode(rawTarget);
    if (!targetClean || targetClean === "trf" || targetClean.startsWith("trf")) continue;

    // 1. Direct exact clean match
    if (scannedClean === targetClean) return true;

    // 2. Direct SKU / Product ID match without 'prod' prefix
    if (scannedClean === targetClean.replace(/^prod/, "") || targetClean === scannedClean.replace(/^prod/, "")) return true;
  }

  return false;
}

