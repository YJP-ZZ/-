import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Check,
  Crop,
  Eraser,
  Move,
  Paintbrush,
  Redo2,
  RotateCcw,
  Sparkles,
  Undo2,
  Wand2,
  X,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import {
  GARMENT_CATEGORIES,
  GARMENT_COLORS,
  SEASON_LABELS,
  getColorLabel,
  type GarmentCategory,
  type GarmentColorId,
  type GarmentItem,
  type GarmentSeason,
} from '../types/wardrobe';
import {
  applyMaskBrushStroke,
  computeAutoBackgroundMask,
  cropBlobNormalized,
  exportMaskedImageToPngBlob,
  extractDominantColorFromImageData,
  loadImageFromBlob,
} from '../lib/imageEngine';

type EditorTool = 'crop' | 'magic' | 'erase' | 'restore' | 'pan';

interface CropBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

type CropHandle = 'tl' | 'tr' | 'bl' | 'br' | 'move';

interface CutoutEditorModalProps {
  isOpen: boolean;
  mode: 'create' | 'edit';
  initialBlob: Blob;
  initialItem?: GarmentItem;
  defaultCategory?: GarmentCategory;
  onClose: () => void;
  onSave: (result: {
    name: string;
    category: GarmentCategory;
    season: GarmentSeason;
    color: GarmentColorId;
    dominantHex: string;
    cutoutBlob: Blob;
    thumbnailBlob: Blob;
    originalBlob: Blob;
    width: number;
    height: number;
    hasCutout: boolean;
    existingId?: string;
  }) => Promise<void>;
}

export const CutoutEditorModal: React.FC<CutoutEditorModalProps> = ({
  isOpen,
  mode,
  initialBlob,
  initialItem,
  defaultCategory = 'tops',
  onClose,
  onSave,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const originalDataRef = useRef<ImageData | null>(null);
  const maskRef = useRef<Uint8ClampedArray | null>(null);
  const historyRef = useRef<Uint8ClampedArray[]>([]);
  const historyIndexRef = useRef<number>(-1);
  const lastPointRef = useRef<{ x: number; y: number } | null>(null);
  const isDrawingRef = useRef(false);
  const panStartRef = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null);
  const cropDragRef = useRef<{
    handle: CropHandle;
    startX: number;
    startY: number;
    startBox: CropBox;
  } | null>(null);

  const [workingBlob, setWorkingBlob] = useState<Blob>(initialBlob);
  const [tool, setTool] = useState<EditorTool>(mode === 'create' ? 'crop' : 'magic');
  const [mobileDeckTab, setMobileDeckTab] = useState<'cutout' | 'info'>('cutout');
  const [cropBox, setCropBox] = useState<CropBox>({ x: 0.06, y: 0.06, w: 0.88, h: 0.88 });
  const [isCroppingBusy, setIsCroppingBusy] = useState(false);

  const [tolerance, setTolerance] = useState(32);
  const [feather, setFeather] = useState(1);
  const [brushSize, setBrushSize] = useState(28);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [previewBg, setPreviewBg] = useState<'checker' | 'ivory' | 'ink'>('checker');

  const [name, setName] = useState(initialItem?.name ?? '新衣物单品');
  const [category, setCategory] = useState<GarmentCategory>(
    initialItem?.category ?? defaultCategory
  );
  const [season, setSeason] = useState<GarmentSeason>(initialItem?.season ?? 'all');
  const [detectedColor, setDetectedColor] = useState<GarmentColorId>(
    initialItem?.color ?? 'beige'
  );
  const [detectedHex, setDetectedHex] = useState<string>(
    initialItem?.dominantHex ?? '#D8CBB8'
  );
  const [colorManuallySet, setColorManuallySet] = useState(false);

  const [isReady, setIsReady] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);
  const [hasAppliedCutout, setHasAppliedCutout] = useState(initialItem?.hasCutout ?? false);

  useEffect(() => {
    setWorkingBlob(initialBlob);
    setCropBox({ x: 0.06, y: 0.06, w: 0.88, h: 0.88 });
    setTool(mode === 'create' ? 'crop' : 'magic');
    setMobileDeckTab('cutout');
    setColorManuallySet(false);
  }, [initialBlob, mode, isOpen]);

  const syncHistoryFlags = useCallback(() => {
    setCanUndo(historyIndexRef.current > 0);
    setCanRedo(historyIndexRef.current < historyRef.current.length - 1);
  }, []);

  const refreshAutoColor = useCallback(() => {
    if (colorManuallySet) return;
    const orig = originalDataRef.current;
    const mask = maskRef.current;
    if (!orig || !mask) return;
    const { color, dominantHex } = extractDominantColorFromImageData(orig, mask);
    setDetectedColor(color);
    setDetectedHex(dominantHex);
  }, [colorManuallySet]);

  const pushHistory = useCallback(
    (mask: Uint8ClampedArray) => {
      const next = historyRef.current.slice(0, historyIndexRef.current + 1);
      next.push(new Uint8ClampedArray(mask));
      if (next.length > 20) next.shift();
      historyRef.current = next;
      historyIndexRef.current = next.length - 1;
      syncHistoryFlags();
    },
    [syncHistoryFlags]
  );

  const drawCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    const orig = originalDataRef.current;
    const mask = maskRef.current;
    if (!canvas || !orig || !mask) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const out = ctx.createImageData(orig.width, orig.height);
    const src = orig.data;
    const dst = out.data;
    for (let i = 0; i < mask.length; i++) {
      const p = i * 4;
      dst[p] = src[p];
      dst[p + 1] = src[p + 1];
      dst[p + 2] = src[p + 2];
      dst[p + 3] = Math.round((src[p + 3] * mask[i]) / 255);
    }
    ctx.putImageData(out, 0, 0);
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;

    (async () => {
      setIsReady(false);
      const origImg = await loadImageFromBlob(workingBlob);
      if (cancelled) return;

      const w = origImg.naturalWidth;
      const h = origImg.naturalHeight;
      const offscreen = document.createElement('canvas');
      offscreen.width = w;
      offscreen.height = h;
      const ctx = offscreen.getContext('2d')!;
      ctx.drawImage(origImg, 0, 0, w, h);
      const origData = ctx.getImageData(0, 0, w, h);
      originalDataRef.current = origData;

      let initMask: Uint8ClampedArray = new Uint8ClampedArray(w * h).fill(255);
      if (mode === 'edit' && workingBlob === initialBlob && initialItem?.hasCutout) {
        let anyTransparent = false;
        for (let i = 0; i < w * h; i++) {
          if (origData.data[i * 4 + 3] < 245) {
            anyTransparent = true;
            initMask[i] = origData.data[i * 4 + 3];
          }
        }
        if (!anyTransparent) {
          initMask = computeAutoBackgroundMask(origData, { tolerance: 32, feather: 1 });
        }
      } else {
        for (let i = 0; i < w * h; i++) {
          if (origData.data[i * 4 + 3] < 250) {
            initMask[i] = origData.data[i * 4 + 3];
          }
        }
      }

      maskRef.current = initMask;
      historyRef.current = [new Uint8ClampedArray(initMask)];
      historyIndexRef.current = 0;
      syncHistoryFlags();

      const canvas = canvasRef.current;
      if (canvas) {
        canvas.width = w;
        canvas.height = h;
        drawCanvas();
      }
      if (!colorManuallySet) {
        const { color, dominantHex } = extractDominantColorFromImageData(origData, initMask);
        setDetectedColor(color);
        setDetectedHex(dominantHex);
      }
      setIsReady(true);
    })();

    return () => {
      cancelled = true;
    };
  }, [isOpen, workingBlob, initialBlob, initialItem, mode, drawCanvas, syncHistoryFlags, colorManuallySet]);

  const handleApplyCrop = async () => {
    setIsCroppingBusy(true);
    try {
      const cropped = await cropBlobNormalized(workingBlob, cropBox);
      setWorkingBlob(cropped);
      setCropBox({ x: 0.04, y: 0.04, w: 0.92, h: 0.92 });
      setZoom(1);
      setPan({ x: 0, y: 0 });
      setTool('magic');
    } finally {
      setIsCroppingBusy(false);
    }
  };

  const handleAutoRemoveBorder = () => {
    const orig = originalDataRef.current;
    if (!orig) return;
    const nextMask = computeAutoBackgroundMask(orig, { tolerance, feather });
    maskRef.current = nextMask;
    pushHistory(nextMask);
    setHasAppliedCutout(true);
    drawCanvas();
    refreshAutoColor();
  };

  const handleResetOriginal = () => {
    const orig = originalDataRef.current;
    if (!orig) return;
    const resetMask = new Uint8ClampedArray(orig.width * orig.height).fill(255);
    maskRef.current = resetMask;
    pushHistory(resetMask);
    setHasAppliedCutout(false);
    drawCanvas();
    refreshAutoColor();
  };

  const handleUndo = () => {
    if (historyIndexRef.current <= 0) return;
    historyIndexRef.current -= 1;
    maskRef.current = new Uint8ClampedArray(historyRef.current[historyIndexRef.current]);
    syncHistoryFlags();
    drawCanvas();
    refreshAutoColor();
  };

  const handleRedo = () => {
    if (historyIndexRef.current >= historyRef.current.length - 1) return;
    historyIndexRef.current += 1;
    maskRef.current = new Uint8ClampedArray(historyRef.current[historyIndexRef.current]);
    syncHistoryFlags();
    drawCanvas();
    refreshAutoColor();
  };

  const getCanvasCoords = (clientX: number, clientY: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return null;
    const x = ((clientX - rect.left) / rect.width) * canvas.width;
    const y = ((clientY - rect.top) / rect.height) * canvas.height;
    return { x, y };
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!isReady || tool === 'crop') return;
    e.currentTarget.setPointerCapture(e.pointerId);

    if (tool === 'pan') {
      panStartRef.current = { x: e.clientX, y: e.clientY, ox: pan.x, oy: pan.y };
      return;
    }

    const pt = getCanvasCoords(e.clientX, e.clientY);
    if (!pt) return;

    if (tool === 'magic') {
      const orig = originalDataRef.current;
      const mask = maskRef.current;
      if (!orig || !mask) return;
      const nextMask = computeAutoBackgroundMask(
        orig,
        { tolerance, feather, seedPoints: [pt] },
        mask
      );
      maskRef.current = nextMask;
      pushHistory(nextMask);
      setHasAppliedCutout(true);
      drawCanvas();
      refreshAutoColor();
      return;
    }

    isDrawingRef.current = true;
    lastPointRef.current = pt;
    const canvas = canvasRef.current;
    const mask = maskRef.current;
    if (canvas && mask) {
      const scaledRadius = (brushSize * canvas.width) / Math.max(240, canvas.getBoundingClientRect().width);
      applyMaskBrushStroke(
        mask,
        canvas.width,
        canvas.height,
        pt.x,
        pt.y,
        pt.x,
        pt.y,
        scaledRadius,
        tool
      );
      drawCanvas();
    }
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (tool === 'pan' && panStartRef.current) {
      setPan({
        x: panStartRef.current.ox + (e.clientX - panStartRef.current.x),
        y: panStartRef.current.oy + (e.clientY - panStartRef.current.y),
      });
      return;
    }

    if (!isDrawingRef.current || (tool !== 'erase' && tool !== 'restore')) return;
    const pt = getCanvasCoords(e.clientX, e.clientY);
    const last = lastPointRef.current;
    const canvas = canvasRef.current;
    const mask = maskRef.current;
    if (!pt || !last || !canvas || !mask) return;

    const scaledRadius = (brushSize * canvas.width) / Math.max(240, canvas.getBoundingClientRect().width);
    applyMaskBrushStroke(
      mask,
      canvas.width,
      canvas.height,
      last.x,
      last.y,
      pt.x,
      pt.y,
      scaledRadius,
      tool
    );
    lastPointRef.current = pt;
    drawCanvas();
  };

  const handlePointerUp = () => {
    if (tool === 'pan') {
      panStartRef.current = null;
      return;
    }
    if (isDrawingRef.current && maskRef.current) {
      isDrawingRef.current = false;
      lastPointRef.current = null;
      pushHistory(maskRef.current);
      setHasAppliedCutout(true);
      refreshAutoColor();
    }
  };

  const startCropDrag = (e: React.PointerEvent<HTMLElement>, handle: CropHandle) => {
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    cropDragRef.current = {
      handle,
      startX: e.clientX,
      startY: e.clientY,
      startBox: { ...cropBox },
    };
  };

  const moveCropDrag = (e: React.PointerEvent<HTMLElement>) => {
    const drag = cropDragRef.current;
    const canvas = canvasRef.current;
    if (!drag || !canvas) return;
    const rect = canvas.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;
    const dx = (e.clientX - drag.startX) / rect.width;
    const dy = (e.clientY - drag.startY) / rect.height;
    const b = drag.startBox;
    const minSize = 0.15;

    if (drag.handle === 'move') {
      setCropBox({
        ...b,
        x: Math.max(0, Math.min(1 - b.w, b.x + dx)),
        y: Math.max(0, Math.min(1 - b.h, b.y + dy)),
      });
      return;
    }

    let nx = b.x;
    let ny = b.y;
    let nw = b.w;
    let nh = b.h;

    if (drag.handle === 'tl' || drag.handle === 'bl') {
      const clampedX = Math.max(0, Math.min(b.x + b.w - minSize, b.x + dx));
      nw = b.w + (b.x - clampedX);
      nx = clampedX;
    }
    if (drag.handle === 'tr' || drag.handle === 'br') {
      nw = Math.max(minSize, Math.min(1 - b.x, b.w + dx));
    }
    if (drag.handle === 'tl' || drag.handle === 'tr') {
      const clampedY = Math.max(0, Math.min(b.y + b.h - minSize, b.y + dy));
      nh = b.h + (b.y - clampedY);
      ny = clampedY;
    }
    if (drag.handle === 'bl' || drag.handle === 'br') {
      nh = Math.max(minSize, Math.min(1 - b.y, b.h + dy));
    }
    setCropBox({ x: nx, y: ny, w: nw, h: nh });
  };

  const endCropDrag = () => {
    cropDragRef.current = null;
  };

  const handleSave = async () => {
    const orig = originalDataRef.current;
    const mask = maskRef.current;
    if (!orig || !mask) return;

    setIsSaving(true);
    try {
      const exported = await exportMaskedImageToPngBlob(orig, mask);
      await onSave({
        name: name.trim() || '未命名衣物',
        category,
        season,
        color: colorManuallySet ? detectedColor : exported.color,
        dominantHex: colorManuallySet ? detectedHex : exported.dominantHex,
        cutoutBlob: exported.blob,
        thumbnailBlob: exported.thumbnailBlob,
        originalBlob: workingBlob,
        width: exported.width,
        height: exported.height,
        hasCutout: hasAppliedCutout,
        existingId: initialItem?.id,
      });
    } finally {
      setIsSaving(false);
    }
  };

  if (!isOpen) return null;

  const previewBgClass =
    previewBg === 'checker'
      ? 'bg-checkerboard'
      : previewBg === 'ivory'
      ? 'bg-[#FAF8F5]'
      : 'bg-[#1A1A1A]';

  return (
    <div className="fixed inset-0 z-50 flex justify-center bg-black/45 backdrop-blur-xs">
      <div className="flex h-full w-full max-w-[440px] flex-col bg-[#FAF8F5] text-[#141414] sm:border-x sm:border-[#E6E1D8]">
        <header className="flex h-12 shrink-0 items-center justify-between border-b border-[#E6E1D8] px-3 pt-safe">
          <button
            type="button"
            onClick={onClose}
            className="flex min-h-[44px] items-center gap-1 text-sm text-[#6E6A63] hover:text-[#141414]"
          >
            <X className="h-5 w-5" />
            <span>取消</span>
          </button>

          <h2 className="font-display text-lg font-semibold tracking-tight text-[#141414]">
            裁切与去背
          </h2>

          <button
            type="button"
            onClick={handleSave}
            disabled={!isReady || isSaving}
            className="inline-flex min-h-[38px] items-center gap-1 bg-[#141414] px-3.5 text-xs font-medium text-[#FAF8F5] disabled:opacity-40"
          >
            <Check className="h-4 w-4" />
            <span>{isSaving ? '保存中...' : '保存'}</span>
          </button>
        </header>

        <div className="flex flex-1 min-h-0 flex-col overflow-hidden">
          {/* Canvas Viewport (Top half of vertical portrait editor) */}
          <div
            className={`relative flex flex-1 min-h-0 items-center justify-center overflow-hidden border-b border-[#E6E1D8] ${previewBgClass}`}
          >
            {!isReady && (
              <div className="text-sm text-[#6E6A63]">正在加载本地图像缓冲区...</div>
            )}

            <div
              className="relative flex h-full w-full items-center justify-center p-3"
              style={{
                transform: `translate(${pan.x}px, ${pan.y}px) scale(${tool === 'crop' ? 1 : zoom})`,
                transformOrigin: 'center center',
              }}
            >
              <div className="relative inline-flex max-h-full max-w-full items-center justify-center">
                <canvas
                  ref={canvasRef}
                  onPointerDown={handlePointerDown}
                  onPointerMove={handlePointerMove}
                  onPointerUp={handlePointerUp}
                  onPointerCancel={handlePointerUp}
                  className={`max-h-[46dvh] max-w-full object-contain touch-none select-none shadow-sm ${
                    tool === 'pan' ? 'cursor-grab active:cursor-grabbing' : 'cursor-crosshair'
                  }`}
                />

              {tool === 'crop' && isReady && (
                <div className="absolute inset-0 select-none touch-none">
                  <div
                    onPointerDown={(e) => startCropDrag(e, 'move')}
                    onPointerMove={moveCropDrag}
                    onPointerUp={endCropDrag}
                    onPointerCancel={endCropDrag}
                    style={{
                      left: `${cropBox.x * 100}%`,
                      top: `${cropBox.y * 100}%`,
                      width: `${cropBox.w * 100}%`,
                      height: `${cropBox.h * 100}%`,
                      boxShadow: '0 0 0 9999px rgba(20, 20, 20, 0.45)',
                    }}
                    className="absolute border-2 border-[#FAF8F5] cursor-move touch-none"
                  >
                    <div className="pointer-events-none absolute inset-x-0 top-1/3 border-t border-white/30" />
                    <div className="pointer-events-none absolute inset-x-0 top-2/3 border-t border-white/30" />
                    <div className="pointer-events-none absolute inset-y-0 left-1/3 border-l border-white/30" />
                    <div className="pointer-events-none absolute inset-y-0 left-2/3 border-l border-white/30" />

                    {(
                      [
                        { id: 'tl', cls: '-top-3 -left-3 cursor-nwse-resize' },
                        { id: 'tr', cls: '-top-3 -right-3 cursor-nesw-resize' },
                        { id: 'bl', cls: '-bottom-3 -left-3 cursor-nesw-resize' },
                        { id: 'br', cls: '-bottom-3 -right-3 cursor-nwse-resize' },
                      ] as const
                    ).map((h) => (
                      <div
                        key={h.id}
                        onPointerDown={(e) => startCropDrag(e, h.id)}
                        onPointerMove={moveCropDrag}
                        onPointerUp={endCropDrag}
                        onPointerCancel={endCropDrag}
                        className={`absolute h-6 w-6 border-2 border-[#141414] bg-[#FAF8F5] touch-none ${h.cls}`}
                      />
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>

          {tool !== 'crop' && (
            <div className="absolute top-2.5 right-2.5 flex items-center gap-0.5 bg-[#FAF8F5]/95 border border-[#E6E1D8] p-1 backdrop-blur-xs">
              <button
                type="button"
                onClick={handleUndo}
                disabled={!canUndo}
                className="flex h-9 w-9 items-center justify-center text-[#141414] disabled:opacity-30"
                aria-label="撤销"
              >
                <Undo2 className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={handleRedo}
                disabled={!canRedo}
                className="flex h-9 w-9 items-center justify-center text-[#141414] disabled:opacity-30"
                aria-label="重做"
              >
                <Redo2 className="h-4 w-4" />
              </button>
              <span className="h-4 w-px bg-[#E6E1D8]" />
              <button
                type="button"
                onClick={() => setZoom((z) => Math.max(0.75, +(z - 0.35).toFixed(2)))}
                className="flex h-9 w-9 items-center justify-center text-[#141414]"
                aria-label="缩小画布"
              >
                <ZoomOut className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={() => {
                  setZoom(1);
                  setPan({ x: 0, y: 0 });
                }}
                className="px-1 text-[11px] font-medium tabular-nums text-[#6E6A63]"
              >
                {Math.round(zoom * 100)}%
              </button>
              <button
                type="button"
                onClick={() => setZoom((z) => Math.min(3.5, +(z + 0.35).toFixed(2)))}
                className="flex h-9 w-9 items-center justify-center text-[#141414]"
                aria-label="放大画布"
              >
                <ZoomIn className="h-4 w-4" />
              </button>
            </div>
          )}

          <div className="absolute bottom-2.5 left-2.5 flex items-center gap-0.5 bg-[#FAF8F5]/95 border border-[#E6E1D8] p-1 text-[11px]">
            <button
              type="button"
              onClick={() => setPreviewBg('checker')}
              className={`px-2 py-1 ${previewBg === 'checker' ? 'bg-[#141414] text-[#FAF8F5]' : 'text-[#6E6A63]'}`}
            >
              网格
            </button>
            <button
              type="button"
              onClick={() => setPreviewBg('ivory')}
              className={`px-2 py-1 ${previewBg === 'ivory' ? 'bg-[#141414] text-[#FAF8F5]' : 'text-[#6E6A63]'}`}
            >
              白底
            </button>
            <button
              type="button"
              onClick={() => setPreviewBg('ink')}
              className={`px-2 py-1 ${previewBg === 'ink' ? 'bg-[#141414] text-[#FAF8F5]' : 'text-[#6E6A63]'}`}
            >
              深底
            </button>
          </div>
        </div>

        {/* Portrait 2-Step Deck Switcher */}
        <div className="grid grid-cols-2 border-b border-[#E6E1D8] bg-white shrink-0">
          <button
            type="button"
            onClick={() => setMobileDeckTab('cutout')}
            className={`min-h-[42px] text-xs font-medium border-b-2 transition-colors ${
              mobileDeckTab === 'cutout'
                ? 'border-[#141414] text-[#141414]'
                : 'border-transparent text-[#6E6A63]'
            }`}
          >
            1. 裁切与去背修边
          </button>
          <button
            type="button"
            onClick={() => setMobileDeckTab('info')}
            className={`min-h-[42px] text-xs font-medium border-b-2 transition-colors ${
              mobileDeckTab === 'info'
                ? 'border-[#141414] text-[#141414]'
                : 'border-transparent text-[#6E6A63]'
            }`}
          >
            2. 主色 · 分类与命名
          </button>
        </div>

        {/* Tool Controls & Metadata Drawer */}
        <div className="flex flex-col gap-4 overflow-y-auto bg-[#FAF8F5] p-3.5 pb-6 shrink-0 max-h-[42dvh] pb-safe">
          {/* Section 1: Cutout Tools */}
          <div className={`${mobileDeckTab === 'cutout' ? 'block' : 'hidden'} space-y-3`}>
            <div className="flex items-center justify-between gap-2">
              <button
                type="button"
                onClick={handleAutoRemoveBorder}
                className="flex-1 min-h-[42px] inline-flex items-center justify-center gap-1.5 bg-[#141414] px-3 text-xs font-medium text-[#FAF8F5] hover:bg-[#2a2a2a]"
              >
                <Sparkles className="h-4 w-4" />
                <span>一键智能去背</span>
              </button>
              <button
                type="button"
                onClick={handleResetOriginal}
                className="min-h-[42px] inline-flex items-center justify-center gap-1 border border-[#E6E1D8] bg-white px-3 text-xs font-medium text-[#6E6A63] hover:text-[#141414]"
              >
                <RotateCcw className="h-3.5 w-3.5" />
                <span>还原</span>
              </button>
            </div>

            <div className="grid grid-cols-5 gap-1.5">
              {(
                [
                  { id: 'crop', label: '裁切', Icon: Crop },
                  { id: 'magic', label: '去背', Icon: Wand2 },
                  { id: 'erase', label: '擦除', Icon: Eraser },
                  { id: 'restore', label: '还原', Icon: Paintbrush },
                  { id: 'pan', label: '移动', Icon: Move },
                ] as const
              ).map(({ id, label, Icon }) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => setTool(id)}
                  className={`min-h-[44px] flex flex-col items-center justify-center gap-0.5 border text-[11px] font-medium transition-colors ${
                    tool === id
                      ? 'border-[#141414] bg-[#141414] text-[#FAF8F5]'
                      : 'border-[#E6E1D8] bg-white text-[#141414] hover:bg-[#F2EFE9]'
                  }`}
                >
                  <Icon className="h-4 w-4" />
                  <span>{label}</span>
                </button>
              ))}
            </div>

            {tool === 'crop' ? (
              <div className="border border-[#E6E1D8] bg-white p-3 space-y-2.5">
                <p className="text-[11px] text-[#6E6A63] leading-relaxed">
                  拖动四角选框裁去周边杂物，点击确认裁切后再去背更精准。
                </p>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={handleApplyCrop}
                    disabled={isCroppingBusy}
                    className="flex-1 min-h-[40px] bg-[#141414] text-xs font-medium text-[#FAF8F5] disabled:opacity-40"
                  >
                    {isCroppingBusy ? '裁切中...' : '确认裁切'}
                  </button>
                  <button
                    type="button"
                    onClick={() => setTool('magic')}
                    className="min-h-[40px] border border-[#E6E1D8] px-3 text-xs text-[#6E6A63]"
                  >
                    跳过
                  </button>
                </div>
              </div>
            ) : tool === 'magic' ? (
              <div className="space-y-2.5 border border-[#E6E1D8] bg-white p-3">
                <div>
                  <div className="mb-1 flex justify-between text-xs">
                    <span className="text-[#6E6A63]">颜色容差（轻点画面去背）</span>
                    <span className="font-medium tabular-nums">{tolerance}</span>
                  </div>
                  <input
                    type="range"
                    min={8}
                    max={85}
                    value={tolerance}
                    onChange={(e) => setTolerance(Number(e.target.value))}
                    className="w-full accent-[#141414]"
                  />
                </div>
                <div>
                  <div className="mb-1 flex justify-between text-xs">
                    <span className="text-[#6E6A63]">边缘羽化平滑</span>
                    <span className="font-medium tabular-nums">{feather} px</span>
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={3}
                    step={1}
                    value={feather}
                    onChange={(e) => setFeather(Number(e.target.value))}
                    className="w-full accent-[#141414]"
                  />
                </div>
              </div>
            ) : tool === 'erase' || tool === 'restore' ? (
              <div className="border border-[#E6E1D8] bg-white p-3">
                <div className="mb-1 flex justify-between text-xs">
                  <span className="text-[#6E6A63]">画笔直径</span>
                  <span className="font-medium tabular-nums">{brushSize} px</span>
                </div>
                <input
                  type="range"
                  min={8}
                  max={64}
                  value={brushSize}
                  onChange={(e) => setBrushSize(Number(e.target.value))}
                  className="w-full accent-[#141414]"
                />
              </div>
            ) : null}
          </div>

          {/* Section 2: Classification & Dominant Color */}
          <div
            className={`${
              mobileDeckTab === 'info' ? 'block' : 'hidden'
            } space-y-3.5`}
          >
            <div>
              <label className="mb-1 block text-xs text-[#6E6A63]">单品名称</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="例如：米色羊绒开衫"
                className="w-full min-h-[42px] border border-[#E6E1D8] bg-white px-3 text-sm text-[#141414] focus:border-[#141414] focus:outline-none"
              />
            </div>

            <div>
              <div className="mb-1.5 flex items-center justify-between text-xs">
                <span className="text-[#6E6A63]">主色自动识别（可点选修正）</span>
                <span className="font-medium text-[#141414] flex items-center gap-1.5">
                  <span
                    className="inline-block h-3 w-3 rounded-full border border-[#E6E1D8]"
                    style={{ backgroundColor: detectedHex }}
                  />
                  {getColorLabel(detectedColor)}
                </span>
              </div>
              <div className="flex flex-wrap gap-2">
                {GARMENT_COLORS.map((c) => {
                  const active = detectedColor === c.id;
                  return (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => {
                        setDetectedColor(c.id);
                        setDetectedHex(c.swatchHex);
                        setColorManuallySet(true);
                      }}
                      title={c.label}
                      aria-label={c.label}
                      className={`h-7 w-7 rounded-full border transition-transform ${
                        active
                          ? 'scale-110 border-[#141414] ring-2 ring-[#141414] ring-offset-2 ring-offset-[#FAF8F5]'
                          : 'border-[#D5CFC4] hover:scale-105'
                      }`}
                      style={{ backgroundColor: c.swatchHex }}
                    />
                  );
                })}
              </div>
            </div>

            <div>
              <label className="mb-1.5 block text-xs text-[#6E6A63]">衣物归类</label>
              <div className="grid grid-cols-3 gap-1.5">
                {GARMENT_CATEGORIES.map((cat) => (
                  <button
                    key={cat.id}
                    type="button"
                    onClick={() => setCategory(cat.id)}
                    className={`min-h-[40px] border text-xs font-medium transition-colors ${
                      category === cat.id
                        ? 'border-[#141414] bg-[#141414] text-[#FAF8F5]'
                        : 'border-[#E6E1D8] bg-white text-[#141414] hover:bg-[#F2EFE9]'
                    }`}
                  >
                    {cat.label}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="mb-1.5 block text-xs text-[#6E6A63]">适用季节</label>
              <div className="grid grid-cols-4 gap-1.5">
                {(Object.keys(SEASON_LABELS) as GarmentSeason[]).map((sKey) => (
                  <button
                    key={sKey}
                    type="button"
                    onClick={() => setSeason(sKey)}
                    className={`min-h-[40px] border text-xs font-medium transition-colors ${
                      season === sKey
                        ? 'border-[#141414] bg-[#141414] text-[#FAF8F5]'
                        : 'border-[#E6E1D8] bg-white text-[#141414] hover:bg-[#F2EFE9]'
                    }`}
                  >
                    {SEASON_LABELS[sKey]}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
    </div>
  );
};
