import { FilesetResolver, PoseLandmarker } from '@mediapipe/tasks-vision';
import {
  GARMENT_CATEGORIES,
  type BodyLandmarks,
  type BodyPoint,
  type GarmentCategory,
} from '../types/wardrobe';
import { loadImageFromBlob } from './imageEngine';

let landmarkerPromise: Promise<PoseLandmarker> | null = null;

async function getPoseLandmarker(): Promise<PoseLandmarker> {
  if (!landmarkerPromise) {
    landmarkerPromise = (async () => {
      const vision = await FilesetResolver.forVisionTasks('/mediapipe/wasm');
      return PoseLandmarker.createFromOptions(vision, {
        baseOptions: {
          modelAssetPath: '/mediapipe/pose_landmarker_lite.task',
          delegate: 'CPU',
        },
        runningMode: 'IMAGE',
        numPoses: 1,
      });
    })().catch((err) => {
      landmarkerPromise = null;
      throw err;
    });
  }
  return landmarkerPromise;
}

export function getDefaultBodyLandmarks(): BodyLandmarks {
  return {
    leftShoulder: { x: 0.41, y: 0.25 },
    rightShoulder: { x: 0.59, y: 0.25 },
    leftHip: { x: 0.43, y: 0.49 },
    rightHip: { x: 0.57, y: 0.49 },
    leftKnee: { x: 0.44, y: 0.69 },
    rightKnee: { x: 0.56, y: 0.69 },
    leftAnkle: { x: 0.45, y: 0.88 },
    rightAnkle: { x: 0.55, y: 0.88 },
    source: 'default',
    confidence: 0,
    updatedAt: Date.now(),
  };
}

function clamp01(v: number, min = 0.02, max = 0.98): number {
  return Math.max(min, Math.min(max, v));
}

function sortPairByX(a: BodyPoint, b: BodyPoint): [BodyPoint, BodyPoint] {
  return a.x <= b.x ? [a, b] : [b, a];
}

/**
 * Offline MediaPipe PoseLandmarker detection on a portrait Blob.
 * Falls back gracefully to anthropometric defaults if no person pose is detected.
 */
export async function detectBodyLandmarks(modelBlob: Blob): Promise<BodyLandmarks> {
  try {
    const img = await loadImageFromBlob(modelBlob);
    const maxDim = 640;
    const scale = Math.min(1, maxDim / Math.max(img.naturalWidth, img.naturalHeight));
    const w = Math.max(64, Math.round(img.naturalWidth * scale));
    const h = Math.max(64, Math.round(img.naturalHeight * scale));

    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) return getDefaultBodyLandmarks();
    ctx.drawImage(img, 0, 0, w, h);

    const landmarker = await getPoseLandmarker();
    const result = landmarker.detect(canvas);
    const lms = result.landmarks?.[0];
    if (!lms || lms.length < 29) {
      return getDefaultBodyLandmarks();
    }

    const p11 = lms[11];
    const p12 = lms[12];
    const shoulderVis = Math.min(p11.visibility ?? 1, p12.visibility ?? 1);
    if (shoulderVis < 0.3) {
      return getDefaultBodyLandmarks();
    }

    const [leftShoulder, rightShoulder] = sortPairByX(
      { x: clamp01(p11.x), y: clamp01(p11.y) },
      { x: clamp01(p12.x), y: clamp01(p12.y) }
    );

    const shoulderWidth = Math.max(0.08, rightShoulder.x - leftShoulder.x);
    const shoulderMidX = (leftShoulder.x + rightShoulder.x) / 2;
    const shoulderMidY = (leftShoulder.y + rightShoulder.y) / 2;

    const p23 = lms[23];
    const p24 = lms[24];
    const hipVis = Math.min(p23.visibility ?? 1, p24.visibility ?? 1);

    let leftHip: BodyPoint;
    let rightHip: BodyPoint;
    if (hipVis >= 0.3 && p23.y > shoulderMidY + 0.05 && p24.y > shoulderMidY + 0.05) {
      [leftHip, rightHip] = sortPairByX(
        { x: clamp01(p23.x), y: clamp01(p23.y) },
        { x: clamp01(p24.x), y: clamp01(p24.y) }
      );
    } else {
      const estHipY = clamp01(shoulderMidY + shoulderWidth * (w / h) * 1.45, 0.25, 0.92);
      leftHip = { x: clamp01(shoulderMidX - shoulderWidth * 0.42), y: estHipY };
      rightHip = { x: clamp01(shoulderMidX + shoulderWidth * 0.42), y: estHipY };
    }

    const hipMidX = (leftHip.x + rightHip.x) / 2;
    const hipMidY = (leftHip.y + rightHip.y) / 2;
    const torsoH = Math.max(0.1, hipMidY - shoulderMidY);

    const p25 = lms[25];
    const p26 = lms[26];
    const kneeVis = Math.min(p25.visibility ?? 1, p26.visibility ?? 1);
    let leftKnee: BodyPoint;
    let rightKnee: BodyPoint;
    if (kneeVis >= 0.28 && p25.y > hipMidY + 0.04 && p26.y > hipMidY + 0.04) {
      [leftKnee, rightKnee] = sortPairByX(
        { x: clamp01(p25.x), y: clamp01(p25.y) },
        { x: clamp01(p26.x), y: clamp01(p26.y) }
      );
    } else {
      const estKneeY = clamp01(hipMidY + torsoH * 0.8, 0.4, 0.94);
      leftKnee = { x: clamp01(hipMidX - shoulderWidth * 0.34), y: estKneeY };
      rightKnee = { x: clamp01(hipMidX + shoulderWidth * 0.34), y: estKneeY };
    }

    const p27 = lms[27];
    const p28 = lms[28];
    const ankleVis = Math.min(p27.visibility ?? 1, p28.visibility ?? 1);
    let leftAnkle: BodyPoint;
    let rightAnkle: BodyPoint;
    if (ankleVis >= 0.25 && p27.y > leftKnee.y + 0.04 && p28.y > rightKnee.y + 0.04) {
      [leftAnkle, rightAnkle] = sortPairByX(
        { x: clamp01(p27.x), y: clamp01(p27.y) },
        { x: clamp01(p28.x), y: clamp01(p28.y) }
      );
    } else {
      const estAnkleY = clamp01(hipMidY + torsoH * 1.55, 0.5, 0.96);
      leftAnkle = { x: clamp01(hipMidX - shoulderWidth * 0.3), y: estAnkleY };
      rightAnkle = { x: clamp01(hipMidX + shoulderWidth * 0.3), y: estAnkleY };
    }

    return {
      leftShoulder,
      rightShoulder,
      leftHip,
      rightHip,
      leftKnee,
      rightKnee,
      leftAnkle,
      rightAnkle,
      source: 'auto',
      confidence: Number(Math.min(shoulderVis, Math.max(hipVis, 0.5)).toFixed(2)),
      updatedAt: Date.now(),
    };
  } catch (err) {
    console.warn('Pose detection unavailable, using anthropometric default:', err);
    return getDefaultBodyLandmarks();
  }
}

export interface GarmentMetrics {
  aspectRatio: number; // height / width
  contentMinX: number;
  contentMaxX: number;
  contentMinY: number;
  contentMaxY: number;
  shoulderBandWidthRatio: number; // opaque span in upper torso band relative to full image width
  waistBandWidthRatio: number; // opaque span in waistband band relative to full image width
  contentWidthRatio: number;
  contentHeightRatio: number;
}

export async function measureGarmentMetrics(garmentBlob: Blob): Promise<GarmentMetrics> {
  const img = await loadImageFromBlob(garmentBlob);
  const maxDim = 180;
  const scale = Math.min(1, maxDim / Math.max(img.naturalWidth, img.naturalHeight));
  const w = Math.max(16, Math.round(img.naturalWidth * scale));
  const h = Math.max(16, Math.round(img.naturalHeight * scale));

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(img, 0, 0, w, h);
  const { data } = ctx.getImageData(0, 0, w, h);

  let minX = w;
  let maxX = -1;
  let minY = h;
  let maxY = -1;

  const rowMinX = new Int32Array(h).fill(w);
  const rowMaxX = new Int32Array(h).fill(-1);

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const a = data[(y * w + x) * 4 + 3];
      if (a > 24) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
        if (x < rowMinX[y]) rowMinX[y] = x;
        if (x > rowMaxX[y]) rowMaxX[y] = x;
      }
    }
  }

  if (maxX <= minX || maxY <= minY) {
    return {
      aspectRatio: img.naturalHeight / Math.max(1, img.naturalWidth),
      contentMinX: 0.05,
      contentMaxX: 0.95,
      contentMinY: 0.05,
      contentMaxY: 0.95,
      shoulderBandWidthRatio: 0.72,
      waistBandWidthRatio: 0.64,
      contentWidthRatio: 0.9,
      contentHeightRatio: 0.9,
    };
  }

  const contentH = maxY - minY;
  const sampleBandWidth = (startFrac: number, endFrac: number, fallback: number): number => {
    const y0 = Math.max(0, Math.round(minY + contentH * startFrac));
    const y1 = Math.min(h - 1, Math.round(minY + contentH * endFrac));
    let sum = 0;
    let count = 0;
    for (let y = y0; y <= y1; y++) {
      if (rowMaxX[y] > rowMinX[y]) {
        sum += (rowMaxX[y] - rowMinX[y]) / w;
        count++;
      }
    }
    return count > 0 ? Math.max(0.25, sum / count) : fallback;
  };

  const contentW = (maxX - minX) / w;
  return {
    aspectRatio: img.naturalHeight / Math.max(1, img.naturalWidth),
    contentMinX: minX / w,
    contentMaxX: maxX / w,
    contentMinY: minY / h,
    contentMaxY: maxY / h,
    shoulderBandWidthRatio: sampleBandWidth(0.16, 0.34, contentW * 0.78),
    waistBandWidthRatio: sampleBandWidth(0.05, 0.18, contentW * 0.68),
    contentWidthRatio: Math.max(0.25, contentW),
    contentHeightRatio: Math.max(0.25, contentH / h),
  };
}

export interface AutoFitTransform {
  x: number; // percentage 0..100
  y: number; // percentage 0..100
  scale: number; // relative to stage width
  rotation: number; // degrees
}

/**
 * Compute optimal garment layer placement, scale & tilt from model pose landmarks & garment silhouette.
 */
export async function computeAutoFitTransform(
  modelWidth: number,
  modelHeight: number,
  landmarks: BodyLandmarks | undefined,
  category: GarmentCategory,
  garmentBlob: Blob
): Promise<AutoFitTransform> {
  const pose = landmarks ?? getDefaultBodyLandmarks();
  const metrics = await measureGarmentMetrics(garmentBlob);
  const portraitAspect = modelWidth / Math.max(1, modelHeight); // e.g. 0.75 for 3:4

  const sL = pose.leftShoulder;
  const sR = pose.rightShoulder;
  const hL = pose.leftHip;
  const hR = pose.rightHip;
  const kL = pose.leftKnee ?? { x: hL.x, y: Math.min(0.92, hL.y + 0.2) };
  const kR = pose.rightKnee ?? { x: hR.x, y: Math.min(0.92, hR.y + 0.2) };
  const aL = pose.leftAnkle ?? { x: hL.x, y: Math.min(0.96, hL.y + 0.38) };
  const aR = pose.rightAnkle ?? { x: hR.x, y: Math.min(0.96, hR.y + 0.38) };

  const shoulderMid = { x: (sL.x + sR.x) / 2, y: (sL.y + sR.y) / 2 };
  const hipMid = { x: (hL.x + hR.x) / 2, y: (hL.y + hR.y) / 2 };
  const kneeMid = { x: (kL.x + kR.x) / 2, y: (kL.y + kR.y) / 2 };
  const ankleMid = { x: (aL.x + aR.x) / 2, y: (aL.y + aR.y) / 2 };

  const shoulderDxPx = (sR.x - sL.x) * modelWidth;
  const shoulderDyPx = (sR.y - sL.y) * modelHeight;
  const shoulderWidthNorm = Math.max(0.11, Math.hypot(shoulderDxPx, shoulderDyPx) / modelWidth);
  const shoulderTiltDeg = Math.max(
    -18,
    Math.min(18, (Math.atan2(shoulderDyPx, Math.max(1, shoulderDxPx)) * 180) / Math.PI)
  );

  const hipDxPx = (hR.x - hL.x) * modelWidth;
  const hipDyPx = (hR.y - hL.y) * modelHeight;
  const hipWidthNorm = Math.max(0.1, Math.hypot(hipDxPx, hipDyPx) / modelWidth);
  const hipTiltDeg = Math.max(
    -14,
    Math.min(14, (Math.atan2(hipDyPx, Math.max(1, hipDxPx)) * 180) / Math.PI)
  );

  const torsoHeightNorm = Math.max(0.14, hipMid.y - shoulderMid.y);
  const legHeightNorm = Math.max(0.22, ankleMid.y - hipMid.y);
  const clampScale = (s: number) => Math.max(0.14, Math.min(0.98, +s.toFixed(3)));
  const clampPct = (p: number) => Math.max(4, Math.min(96, +p.toFixed(2)));

  if (category === 'tops') {
    const targetShoulderSpan = shoulderWidthNorm * 1.42;
    const widthBasedScale = targetShoulderSpan / Math.max(0.32, metrics.shoulderBandWidthRatio);
    const targetHeightNorm = torsoHeightNorm * 1.24;
    const heightBasedScale =
      (targetHeightNorm / portraitAspect) / Math.max(0.25, metrics.aspectRatio * metrics.contentHeightRatio);
    const scale = clampScale(widthBasedScale * 0.65 + heightBasedScale * 0.35);

    const topEdge = shoulderMid.y - torsoHeightNorm * 0.14;
    const bottomEdge = hipMid.y + torsoHeightNorm * 0.16;
    const centerY = (topEdge + bottomEdge) / 2;

    return {
      x: clampPct(((shoulderMid.x * 0.72 + hipMid.x * 0.28) * 100)),
      y: clampPct(centerY * 100),
      scale,
      rotation: +(shoulderTiltDeg * 0.7).toFixed(1),
    };
  }

  if (category === 'outerwear') {
    const targetShoulderSpan = shoulderWidthNorm * 1.56;
    const widthBasedScale = targetShoulderSpan / Math.max(0.32, metrics.shoulderBandWidthRatio);
    const targetHeightNorm = torsoHeightNorm + legHeightNorm * 0.42;
    const heightBasedScale =
      (targetHeightNorm / portraitAspect) / Math.max(0.25, metrics.aspectRatio * metrics.contentHeightRatio);
    const scale = clampScale(widthBasedScale * 0.55 + heightBasedScale * 0.45);

    const renderedHNorm = scale * portraitAspect * metrics.aspectRatio;
    const collarY = shoulderMid.y - torsoHeightNorm * 0.16;
    const centerY = collarY + renderedHNorm * (0.5 - metrics.contentMinY * 0.5);

    return {
      x: clampPct(((shoulderMid.x * 0.68 + hipMid.x * 0.32) * 100)),
      y: clampPct(centerY * 100),
      scale,
      rotation: +(shoulderTiltDeg * 0.65).toFixed(1),
    };
  }

  if (category === 'bottoms') {
    const targetWaistSpan = Math.max(hipWidthNorm * 1.48, shoulderWidthNorm * 0.92);
    const widthBasedScale = targetWaistSpan / Math.max(0.3, metrics.waistBandWidthRatio);
    const targetHeightNorm = legHeightNorm * 1.06 + torsoHeightNorm * 0.12;
    const heightBasedScale =
      (targetHeightNorm / portraitAspect) / Math.max(0.25, metrics.aspectRatio * metrics.contentHeightRatio);
    const scale = clampScale(widthBasedScale * 0.48 + heightBasedScale * 0.52);

    const waistY = hipMid.y - torsoHeightNorm * 0.14;
    const renderedHNorm = scale * portraitAspect * metrics.aspectRatio;
    const centerY = waistY + renderedHNorm * (0.5 - metrics.contentMinY * 0.5);

    return {
      x: clampPct(((hipMid.x * 0.65 + ankleMid.x * 0.35) * 100)),
      y: clampPct(centerY * 100),
      scale,
      rotation: +(hipTiltDeg * 0.65).toFixed(1),
    };
  }

  if (category === 'dresses') {
    const targetShoulderSpan = shoulderWidthNorm * 1.42;
    const widthBasedScale = targetShoulderSpan / Math.max(0.32, metrics.shoulderBandWidthRatio);
    const targetHeightNorm = Math.max(torsoHeightNorm + legHeightNorm * 0.62, kneeMid.y - shoulderMid.y + 0.12);
    const heightBasedScale =
      (targetHeightNorm / portraitAspect) / Math.max(0.25, metrics.aspectRatio * metrics.contentHeightRatio);
    const scale = clampScale(widthBasedScale * 0.45 + heightBasedScale * 0.55);

    const collarY = shoulderMid.y - torsoHeightNorm * 0.14;
    const renderedHNorm = scale * portraitAspect * metrics.aspectRatio;
    const centerY = collarY + renderedHNorm * (0.5 - metrics.contentMinY * 0.5);

    return {
      x: clampPct(((shoulderMid.x * 0.55 + hipMid.x * 0.45) * 100)),
      y: clampPct(centerY * 100),
      scale,
      rotation: +(shoulderTiltDeg * 0.65).toFixed(1),
    };
  }

  if (category === 'shoes') {
    const ankleSpanNorm = Math.hypot((aR.x - aL.x) * modelWidth, (aR.y - aL.y) * modelHeight) / modelWidth;
    const targetFootSpan = Math.max(hipWidthNorm * 1.05, ankleSpanNorm * 1.45, 0.16);
    const scale = clampScale(targetFootSpan / Math.max(0.45, metrics.contentWidthRatio));
    return {
      x: clampPct(ankleMid.x * 100),
      y: clampPct((ankleMid.y + 0.015) * 100),
      scale,
      rotation: 0,
    };
  }

  // Accessories fallback aligned relative to upper torso / collarbone
  const meta = GARMENT_CATEGORIES.find((c) => c.id === category);
  return {
    x: clampPct(shoulderMid.x * 100),
    y: clampPct(Math.max(0.08, shoulderMid.y - torsoHeightNorm * 0.25) * 100),
    scale: clampScale(Math.max(meta?.defaultScale ?? 0.24, shoulderWidthNorm * 0.9)),
    rotation: 0,
  };
}
