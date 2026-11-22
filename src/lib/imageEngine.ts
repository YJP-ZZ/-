import { GARMENT_COLORS, type GarmentColorId, type OutfitLayer } from '../types/wardrobe';

export interface LoadedImageResult {
  blob: Blob;
  thumbnailBlob: Blob;
  width: number;
  height: number;
}

/**
 * Decode a File or Blob to an HTMLImageElement safely, respecting EXIF orientation in modern browsers.
 */
export function loadImageFromBlob(blob: Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = (err) => {
      URL.revokeObjectURL(url);
      reject(err);
    };
    img.src = url;
  });
}

function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality?: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) resolve(blob);
        else reject(new Error('Canvas export failed'));
      },
      type,
      quality
    );
  });
}

/**
 * Downscale large phone camera photos safely for offline IndexedDB storage without OOM.
 */
export async function processUploadedImage(
  sourceBlob: Blob,
  maxDimension = 1280,
  preserveAlpha = false
): Promise<LoadedImageResult> {
  const img = await loadImageFromBlob(sourceBlob);
  const scale = Math.min(1, maxDimension / Math.max(img.naturalWidth, img.naturalHeight));
  const width = Math.max(1, Math.round(img.naturalWidth * scale));
  const height = Math.max(1, Math.round(img.naturalHeight * scale));

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;
  if (!preserveAlpha) {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, width, height);
  }
  ctx.drawImage(img, 0, 0, width, height);

  const mime = preserveAlpha ? 'image/png' : 'image/jpeg';
  const blob = await canvasToBlob(canvas, mime, preserveAlpha ? undefined : 0.9);

  const thumbScale = Math.min(1, 360 / Math.max(width, height));
  const tw = Math.max(1, Math.round(width * thumbScale));
  const th = Math.max(1, Math.round(height * thumbScale));
  const thumbCanvas = document.createElement('canvas');
  thumbCanvas.width = tw;
  thumbCanvas.height = th;
  const tctx = thumbCanvas.getContext('2d')!;
  tctx.drawImage(canvas, 0, 0, tw, th);
  const thumbnailBlob = await canvasToBlob(thumbCanvas, preserveAlpha ? 'image/png' : 'image/webp', 0.84);

  return { blob, thumbnailBlob, width, height };
}

export async function createThumbnailFromBlob(sourceBlob: Blob, maxDimension = 360): Promise<Blob> {
  const img = await loadImageFromBlob(sourceBlob);
  const scale = Math.min(1, maxDimension / Math.max(img.naturalWidth, img.naturalHeight));
  const tw = Math.max(1, Math.round(img.naturalWidth * scale));
  const th = Math.max(1, Math.round(img.naturalHeight * scale));
  const canvas = document.createElement('canvas');
  canvas.width = tw;
  canvas.height = th;
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(img, 0, 0, tw, th);
  return canvasToBlob(canvas, 'image/png');
}

/**
 * Crop a Blob using normalized rectangle coordinates (0..1) before cutout.
 */
export async function cropBlobNormalized(
  sourceBlob: Blob,
  cropRect: { x: number; y: number; w: number; h: number }
): Promise<Blob> {
  const img = await loadImageFromBlob(sourceBlob);
  const sx = Math.max(0, Math.round(cropRect.x * img.naturalWidth));
  const sy = Math.max(0, Math.round(cropRect.y * img.naturalHeight));
  const sw = Math.max(16, Math.min(img.naturalWidth - sx, Math.round(cropRect.w * img.naturalWidth)));
  const sh = Math.max(16, Math.min(img.naturalHeight - sy, Math.round(cropRect.h * img.naturalHeight)));

  const canvas = document.createElement('canvas');
  canvas.width = sw;
  canvas.height = sh;
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);
  return canvasToBlob(canvas, 'image/png');
}

function rgbToHex(r: number, g: number, b: number): string {
  const toHex = (n: number) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0');
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

function mapRgbToGarmentColorId(r: number, g: number, b: number): GarmentColorId {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  const d = max - min;
  const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));

  let h = 0;
  if (d !== 0) {
    if (max === rn) h = ((gn - bn) / d + (gn < bn ? 6 : 0)) * 60;
    else if (max === gn) h = ((bn - rn) / d + 2) * 60;
    else h = ((rn - gn) / d + 4) * 60;
  }

  // Neutral colors first
  if (l < 0.2) return 'black';
  if (l > 0.82 && s < 0.22) return 'white';
  if (s < 0.14) {
    if (l < 0.35) return 'black';
    if (l > 0.72) return 'beige';
    return 'gray';
  }

  // Warm earth tones (beige / brown)
  if (h >= 18 && h <= 52) {
    if (l > 0.68 && s < 0.48) return 'beige';
    if (l <= 0.68) return 'brown';
  }

  // Reds / pinks / pastels
  if (h < 18 || h >= 330) {
    if (l > 0.64) return 'pastel';
    return 'red';
  }
  if (h >= 275 && h < 330) return 'pastel';

  // Greens
  if (h > 52 && h <= 168) return 'green';

  // Blues / Navy
  if (h > 168 && h < 275) {
    if (l < 0.3) return 'navy';
    return 'blue';
  }

  // Fallback nearest swatch Euclidean distance
  let bestId: GarmentColorId = 'gray';
  let bestDist = Infinity;
  for (const c of GARMENT_COLORS) {
    const cr = parseInt(c.swatchHex.slice(1, 3), 16);
    const cg = parseInt(c.swatchHex.slice(3, 5), 16);
    const cb = parseInt(c.swatchHex.slice(5, 7), 16);
    const dist = (r - cr) ** 2 + (g - cg) ** 2 + (b - cb) ** 2;
    if (dist < bestDist) {
      bestDist = dist;
      bestId = c.id;
    }
  }
  return bestId;
}

/**
 * Compute the dominant garment color from opaque foreground pixels (ignoring transparent background).
 */
export function extractDominantColorFromImageData(
  imageData: ImageData,
  mask?: Uint8ClampedArray
): { color: GarmentColorId; dominantHex: string } {
  const { width, height, data } = imageData;
  const total = width * height;
  const step = Math.max(1, Math.floor(total / 4500));

  // Bucket colors by quantized 4-bit bins to find the dominant fabric tone rather than muddy average
  const buckets = new Map<number, { count: number; rSum: number; gSum: number; bSum: number }>();

  for (let i = 0; i < total; i += step) {
    const alpha = mask ? (data[i * 4 + 3] * mask[i]) / 255 : data[i * 4 + 3];
    if (alpha < 140) continue;
    const p = i * 4;
    const r = data[p];
    const g = data[p + 1];
    const b = data[p + 2];

    const key = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4);
    const entry = buckets.get(key);
    if (entry) {
      entry.count++;
      entry.rSum += r;
      entry.gSum += g;
      entry.bSum += b;
    } else {
      buckets.set(key, { count: 1, rSum: r, gSum: g, bSum: b });
    }
  }

  if (buckets.size === 0) {
    return { color: 'gray', dominantHex: '#8E8C87' };
  }

  let topBucket = { count: 0, rSum: 140, gSum: 140, bSum: 140 };
  for (const b of buckets.values()) {
    if (b.count > topBucket.count) {
      topBucket = b;
    }
  }

  const avgR = topBucket.rSum / topBucket.count;
  const avgG = topBucket.gSum / topBucket.count;
  const avgB = topBucket.bSum / topBucket.count;
  return {
    color: mapRgbToGarmentColorId(avgR, avgG, avgB),
    dominantHex: rgbToHex(avgR, avgG, avgB),
  };
}

export async function extractDominantColorFromBlob(
  blob: Blob
): Promise<{ color: GarmentColorId; dominantHex: string }> {
  const img = await loadImageFromBlob(blob);
  const scale = Math.min(1, 200 / Math.max(img.naturalWidth, img.naturalHeight));
  const w = Math.max(1, Math.round(img.naturalWidth * scale));
  const h = Math.max(1, Math.round(img.naturalHeight * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(img, 0, 0, w, h);
  const data = ctx.getImageData(0, 0, w, h);
  return extractDominantColorFromImageData(data);
}

export interface AutoCutoutOptions {
  tolerance: number; // 8..95
  feather: number;   // 0..3
  seedPoints?: Array<{ x: number; y: number }>;
}

/**
 * Pure offline flood-fill background removal with perceptual RGB distance & edge feathering.
 * Returns a Uint8ClampedArray alpha mask (0..255 per pixel).
 */
export function computeAutoBackgroundMask(
  imageData: ImageData,
  options: AutoCutoutOptions,
  existingMask?: Uint8ClampedArray
): Uint8ClampedArray {
  const { width, height, data } = imageData;
  const total = width * height;
  const mask = existingMask ? new Uint8ClampedArray(existingMask) : new Uint8ClampedArray(total).fill(255);
  const visited = new Uint8Array(total);

  const seeds: number[] = [];
  if (options.seedPoints && options.seedPoints.length > 0) {
    for (const pt of options.seedPoints) {
      const sx = Math.max(0, Math.min(width - 1, Math.round(pt.x)));
      const sy = Math.max(0, Math.min(height - 1, Math.round(pt.y)));
      seeds.push(sy * width + sx);
    }
  } else {
    const stepX = Math.max(1, Math.floor(width / 5));
    const stepY = Math.max(1, Math.floor(height / 5));
    for (let x = 0; x < width; x += stepX) {
      seeds.push(x);
      seeds.push((height - 1) * width + x);
    }
    for (let y = 0; y < height; y += stepY) {
      seeds.push(y * width);
      seeds.push(y * width + (width - 1));
    }
    seeds.push(0, width - 1, (height - 1) * width, width * height - 1);
  }

  const maxDist = options.tolerance * 2.15;
  const maxDistSq = maxDist * maxDist;

  const queue = new Int32Array(total);
  let head = 0;
  let tail = 0;

  const targetColors: Array<[number, number, number]> = [];
  for (const idx of seeds) {
    const p = idx * 4;
    if (data[p + 3] < 20) continue;
    const r = data[p];
    const g = data[p + 1];
    const b = data[p + 2];

    if (!options.seedPoints && targetColors.length > 0) {
      const matchesExisting = targetColors.some(([tr, tg, tb]) => {
        const dr = r - tr, dg = g - tg, db = b - tb;
        return dr * dr + dg * dg + db * db <= maxDistSq * 1.4;
      });
      if (!matchesExisting && targetColors.length >= 2) {
        const minC = Math.min(r, g, b);
        const maxC = Math.max(r, g, b);
        if (maxC - minC > 40 || minC < 160) continue;
      }
    }
    targetColors.push([r, g, b]);
    if (!visited[idx]) {
      visited[idx] = 1;
      queue[tail++] = idx;
    }
  }

  if (targetColors.length === 0) {
    targetColors.push([data[0], data[1], data[2]]);
    visited[0] = 1;
    queue[tail++] = 0;
  }

  while (head < tail) {
    const idx = queue[head++];
    mask[idx] = 0;

    const x = idx % width;
    const y = (idx - x) / width;

    const neighbors = [
      x > 0 ? idx - 1 : -1,
      x < width - 1 ? idx + 1 : -1,
      y > 0 ? idx - width : -1,
      y < height - 1 ? idx + width : -1,
    ];

    for (let i = 0; i < 4; i++) {
      const nIdx = neighbors[i];
      if (nIdx < 0 || visited[nIdx]) continue;
      const np = nIdx * 4;
      const nr = data[np];
      const ng = data[np + 1];
      const nb = data[np + 2];

      let withinTol = false;
      for (let c = 0; c < targetColors.length; c++) {
        const [tr, tg, tb] = targetColors[c];
        const dr = nr - tr;
        const dg = ng - tg;
        const db = nb - tb;
        const distSq = dr * dr * 0.3 + dg * dg * 0.59 + db * db * 0.11;
        if (distSq <= maxDistSq * 0.45) {
          withinTol = true;
          break;
        }
      }

      if (withinTol) {
        visited[nIdx] = 1;
        queue[tail++] = nIdx;
      }
    }
  }

  const featherRadius = Math.max(0, Math.min(3, Math.round(options.feather)));
  if (featherRadius > 0) {
    const smoothed = new Uint8ClampedArray(mask);
    for (let y = 1; y < height - 1; y++) {
      for (let x = 1; x < width - 1; x++) {
        const idx = y * width + x;
        if (mask[idx] === 255) {
          const hasTransparentNeighbor =
            mask[idx - 1] === 0 ||
            mask[idx + 1] === 0 ||
            mask[idx - width] === 0 ||
            mask[idx + width] === 0;
          if (hasTransparentNeighbor) {
            let sum = 0;
            let count = 0;
            for (let dy = -featherRadius; dy <= featherRadius; dy++) {
              const ny = y + dy;
              if (ny < 0 || ny >= height) continue;
              for (let dx = -featherRadius; dx <= featherRadius; dx++) {
                const nx = x + dx;
                if (nx < 0 || nx >= width) continue;
                sum += mask[ny * width + nx];
                count++;
              }
            }
            smoothed[idx] = Math.round(sum / count);
          }
        }
      }
    }
    return smoothed;
  }

  return mask;
}

/**
 * Paint onto an alpha mask along a brush stroke segment (erase or restore).
 */
export function applyMaskBrushStroke(
  mask: Uint8ClampedArray,
  width: number,
  height: number,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  radius: number,
  mode: 'erase' | 'restore'
): void {
  const targetVal = mode === 'erase' ? 0 : 255;
  const dist = Math.hypot(x1 - x0, y1 - y0);
  const steps = Math.max(1, Math.ceil(dist / Math.max(1, radius * 0.25)));
  const rSq = radius * radius;
  const innerRSq = (radius * 0.72) * (radius * 0.72);

  for (let s = 0; s <= steps; s++) {
    const t = s / steps;
    const cx = x0 + (x1 - x0) * t;
    const cy = y0 + (y1 - y0) * t;
    const minX = Math.max(0, Math.floor(cx - radius));
    const maxX = Math.min(width - 1, Math.ceil(cx + radius));
    const minY = Math.max(0, Math.floor(cy - radius));
    const maxY = Math.min(height - 1, Math.ceil(cy + radius));

    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        const dx = x - cx;
        const dy = y - cy;
        const dSq = dx * dx + dy * dy;
        if (dSq <= rSq) {
          const idx = y * width + x;
          if (dSq <= innerRSq) {
            mask[idx] = targetVal;
          } else {
            const edgeT = 1 - (Math.sqrt(dSq) - radius * 0.72) / Math.max(0.01, radius * 0.28);
            const current = mask[idx];
            mask[idx] = mode === 'erase'
              ? Math.min(current, Math.round(current * (1 - edgeT)))
              : Math.max(current, Math.round(current + (255 - current) * edgeT));
          }
        }
      }
    }
  }
}

/**
 * Apply an alpha mask onto original ImageData and export a trimmed transparent PNG Blob + dominant color.
 */
export async function exportMaskedImageToPngBlob(
  originalImageData: ImageData,
  mask: Uint8ClampedArray
): Promise<{
  blob: Blob;
  thumbnailBlob: Blob;
  width: number;
  height: number;
  color: GarmentColorId;
  dominantHex: string;
}> {
  const { width, height, data } = originalImageData;
  const outCanvas = document.createElement('canvas');
  outCanvas.width = width;
  outCanvas.height = height;
  const outCtx = outCanvas.getContext('2d')!;
  const outImage = outCtx.createImageData(width, height);

  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;

  for (let i = 0; i < width * height; i++) {
    const p = i * 4;
    const alpha = Math.round((data[p + 3] * mask[i]) / 255);
    outImage.data[p] = data[p];
    outImage.data[p + 1] = data[p + 1];
    outImage.data[p + 2] = data[p + 2];
    outImage.data[p + 3] = alpha;

    if (alpha > 12) {
      const x = i % width;
      const y = (i - x) / width;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  outCtx.putImageData(outImage, 0, 0);

  const { color, dominantHex } = extractDominantColorFromImageData(originalImageData, mask);

  let finalCanvas = outCanvas;
  if (maxX > minX && maxY > minY) {
    const pad = 10;
    const cx = Math.max(0, minX - pad);
    const cy = Math.max(0, minY - pad);
    const cw = Math.min(width - cx, maxX - minX + 1 + pad * 2);
    const ch = Math.min(height - cy, maxY - minY + 1 + pad * 2);
    const cropped = document.createElement('canvas');
    cropped.width = cw;
    cropped.height = ch;
    const cctx = cropped.getContext('2d')!;
    cctx.drawImage(outCanvas, cx, cy, cw, ch, 0, 0, cw, ch);
    finalCanvas = cropped;
  }

  const blob = await canvasToBlob(finalCanvas, 'image/png');
  const thumbnailBlob = await createThumbnailFromBlob(blob, 360);
  return { blob, thumbnailBlob, width: finalCanvas.width, height: finalCanvas.height, color, dominantHex };
}

/**
 * Convenience helper for auto-cutting a clean white-background photo into a transparent PNG + color tag.
 */
export async function autoCutoutBlob(
  sourceBlob: Blob,
  tolerance = 36,
  feather = 1
): Promise<{
  cutoutBlob: Blob;
  thumbnailBlob: Blob;
  width: number;
  height: number;
  color: GarmentColorId;
  dominantHex: string;
}> {
  const img = await loadImageFromBlob(sourceBlob);
  const canvas = document.createElement('canvas');
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(img, 0, 0);
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const mask = computeAutoBackgroundMask(imageData, { tolerance, feather });
  const exported = await exportMaskedImageToPngBlob(imageData, mask);
  return {
    cutoutBlob: exported.blob,
    thumbnailBlob: exported.thumbnailBlob,
    width: exported.width,
    height: exported.height,
    color: exported.color,
    dominantHex: exported.dominantHex,
  };
}

/**
 * Apply pixel-accurate brightness, contrast, warmth, and optional occlusion mask onto an offscreen garment canvas.
 */
async function prepareStyledLayerCanvas(
  gImg: HTMLImageElement,
  layer: OutfitLayer
): Promise<HTMLCanvasElement> {
  const w = gImg.naturalWidth;
  const h = gImg.naturalHeight;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(gImg, 0, 0, w, h);

  if (layer.layerMaskBlob) {
    const maskImg = await loadImageFromBlob(layer.layerMaskBlob);
    ctx.save();
    ctx.globalCompositeOperation = 'destination-in';
    ctx.drawImage(maskImg, 0, 0, w, h);
    ctx.restore();
  }

  const brightness = layer.brightness ?? 1;
  const contrast = layer.contrast ?? 1;
  const warmth = layer.warmth ?? 0;

  if (brightness !== 1 || contrast !== 1 || warmth !== 0) {
    const imgData = ctx.getImageData(0, 0, w, h);
    const d = imgData.data;
    const warmShift = warmth * 0.85;
    for (let i = 0; i < d.length; i += 4) {
      if (d[i + 3] === 0) continue;
      let r = d[i] * brightness;
      let g = d[i + 1] * brightness;
      let b = d[i + 2] * brightness;

      if (contrast !== 1) {
        r = (r - 128) * contrast + 128;
        g = (g - 128) * contrast + 128;
        b = (b - 128) * contrast + 128;
      }

      if (warmShift !== 0) {
        r += warmShift;
        g += warmShift * 0.18;
        b -= warmShift;
      }

      d[i] = Math.max(0, Math.min(255, Math.round(r)));
      d[i + 1] = Math.max(0, Math.min(255, Math.round(g)));
      d[i + 2] = Math.max(0, Math.min(255, Math.round(b)));
    }
    ctx.putImageData(imgData, 0, 0);
  }

  return canvas;
}

/**
 * Composite the active portrait and all ordered garment layers (with lighting, warmth, shadows & occlusion masks) into PNG.
 */
export async function renderOutfitComposite(
  modelBlob: Blob,
  layers: OutfitLayer[],
  garmentBlobLookup: Map<string, Blob>
): Promise<Blob> {
  const modelImg = await loadImageFromBlob(modelBlob);
  const width = modelImg.naturalWidth;
  const height = modelImg.naturalHeight;

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(modelImg, 0, 0, width, height);

  const sortedLayers = [...layers].sort((a, b) => a.zIndex - b.zIndex);
  for (const layer of sortedLayers) {
    const gBlob = garmentBlobLookup.get(layer.garmentId);
    if (!gBlob) continue;
    const gImg = await loadImageFromBlob(gBlob);
    const styledCanvas = await prepareStyledLayerCanvas(gImg, layer);

    const targetW = width * layer.scale;
    const targetH = targetW * (gImg.naturalHeight / Math.max(1, gImg.naturalWidth));
    const centerX = (layer.x / 100) * width;
    const centerY = (layer.y / 100) * height;

    ctx.save();
    ctx.globalAlpha = layer.opacity;
    if (layer.dropShadow !== false) {
      ctx.shadowColor = 'rgba(20, 20, 20, 0.16)';
      ctx.shadowBlur = Math.max(4, width * 0.012);
      ctx.shadowOffsetY = Math.max(2, width * 0.006);
    }
    ctx.translate(centerX, centerY);
    ctx.rotate((layer.rotation * Math.PI) / 180);
    if (layer.flipX) {
      ctx.scale(-1, 1);
    }
    ctx.drawImage(styledCanvas, -targetW / 2, -targetH / 2, targetW, targetH);
    ctx.restore();
  }

  return canvasToBlob(canvas, 'image/png');
}
