import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowDown,
  ArrowUp,
  BookmarkCheck,
  Camera,
  Check,
  Eraser,
  FlipHorizontal2,
  Lock,
  Paintbrush,
  Plus,
  RotateCcw,
  RotateCw,
  Scissors,
  SlidersHorizontal,
  SunMedium,
  Trash2,
  Unlock,
  Upload,
  User,
  X,
} from 'lucide-react';
import {
  GARMENT_CATEGORIES,
  type GarmentCategory,
  type GarmentItem,
  type ModelPortrait,
  type OutfitLayer,
} from '../types/wardrobe';
import { BlobImage, useBlobUrl } from '../hooks/useBlobUrl';
import { loadImageFromBlob, renderOutfitComposite } from '../lib/imageEngine';

interface TryOnStudioProps {
  models: ModelPortrait[];
  activeModelId: string | null;
  onSelectModel: (id: string) => void;
  onQuickUploadModel: (file: File) => Promise<void>;
  garments: GarmentItem[];
  layers: OutfitLayer[];
  selectedInstanceId: string | null;
  onSelectInstance: (id: string | null) => void;
  onLayersChange: React.Dispatch<React.SetStateAction<OutfitLayer[]>>;
  onRequestAddGarment: (garment: GarmentItem) => void;
  onEditGarmentCutout: (garment: GarmentItem) => void;
  onSaveLookbook: (payload: {
    title: string;
    notes: string;
    modelId: string;
    compositeBlob: Blob;
    layers: OutfitLayer[];
  }) => Promise<void>;
  onGoToWardrobe: () => void;
}

interface PointerPos {
  x: number;
  y: number;
}

const LayerImageWithMask: React.FC<{
  garmentBlob: Blob;
  maskBlob?: Blob;
  alt: string;
  filterCss: string;
  dropShadow: boolean;
}> = ({ garmentBlob, maskBlob, alt, filterCss, dropShadow }) => {
  const garmentUrl = useBlobUrl(garmentBlob);
  const maskUrl = useBlobUrl(maskBlob);

  if (!garmentUrl) {
    return <div className="aspect-[3/4] w-full bg-transparent" />;
  }

  return (
    <img
      src={garmentUrl}
      alt={alt}
      draggable={false}
      referrerPolicy="no-referrer"
      style={{
        filter: `${filterCss}${dropShadow ? ' drop-shadow(0 4px 10px rgba(0,0,0,0.14))' : ''}`,
        maskImage: maskUrl ? `url(${maskUrl})` : undefined,
        WebkitMaskImage: maskUrl ? `url(${maskUrl})` : undefined,
        maskSize: maskUrl ? '100% 100%' : undefined,
        WebkitMaskSize: maskUrl ? '100% 100%' : undefined,
        maskRepeat: 'no-repeat',
        WebkitMaskRepeat: 'no-repeat',
      }}
      className="h-auto w-full pointer-events-none select-none"
    />
  );
};

export const TryOnStudio: React.FC<TryOnStudioProps> = ({
  models,
  activeModelId,
  onSelectModel,
  onQuickUploadModel,
  garments,
  layers,
  selectedInstanceId,
  onSelectInstance,
  onLayersChange,
  onRequestAddGarment,
  onEditGarmentCutout,
  onSaveLookbook,
  onGoToWardrobe,
}) => {
  const stageRef = useRef<HTMLDivElement | null>(null);
  const pointersRef = useRef<Map<number, PointerPos>>(new Map());
  const gestureStartRef = useRef<{
    instanceId: string;
    mode: 'drag' | 'pinch' | 'handle';
    layerStart: OutfitLayer;
    p1Start: PointerPos;
    p2Start?: PointerPos;
    centerStart?: PointerPos;
    distStart?: number;
    angleStart?: number;
    handleAngleStart?: number;
    handleDistStart?: number;
  } | null>(null);

  const [showCenterGuide, setShowCenterGuide] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerCategory, setDrawerCategory] = useState<'all' | GarmentCategory>('all');
  const [showModelPicker, setShowModelPicker] = useState(false);
  const [showSaveModal, setShowSaveModal] = useState(false);
  const [lookTitle, setLookTitle] = useState('');
  const [lookNotes, setLookNotes] = useState('');
  const [isSavingLook, setIsSavingLook] = useState(false);

  const [showLightingPanel, setShowLightingPanel] = useState(false);
  const [occlusionMode, setOcclusionMode] = useState(false);
  const [occlusionBrushMode, setOcclusionBrushMode] = useState<'erase' | 'restore'>('erase');
  const [occlusionBrushSize, setOcclusionBrushSize] = useState(26);

  const occlusionCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const occlusionMaskCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const occlusionGarmentImgRef = useRef<HTMLImageElement | null>(null);
  const occlusionDrawingRef = useRef(false);
  const occlusionLastPtRef = useRef<{ x: number; y: number } | null>(null);

  const cameraInputRef = useRef<HTMLInputElement | null>(null);
  const albumInputRef = useRef<HTMLInputElement | null>(null);

  const activeModel = useMemo(
    () => models.find((m) => m.id === activeModelId) ?? models[0] ?? null,
    [models, activeModelId]
  );

  const garmentMap = useMemo(() => {
    const map = new Map<string, GarmentItem>();
    for (const g of garments) map.set(g.id, g);
    return map;
  }, [garments]);

  const sortedLayers = useMemo(
    () => [...layers].sort((a, b) => a.zIndex - b.zIndex),
    [layers]
  );

  const selectedLayer = useMemo(
    () => layers.find((l) => l.instanceId === selectedInstanceId) ?? null,
    [layers, selectedInstanceId]
  );

  const selectedGarment = selectedLayer ? garmentMap.get(selectedLayer.garmentId) ?? null : null;

  const filteredWardrobe = useMemo(() => {
    if (drawerCategory === 'all') return garments;
    return garments.filter((g) => g.category === drawerCategory);
  }, [garments, drawerCategory]);

  useEffect(() => {
    if (!selectedLayer) {
      setOcclusionMode(false);
      setShowLightingPanel(false);
    }
  }, [selectedLayer]);

  useEffect(() => {
    if (!occlusionMode || !selectedLayer || !selectedGarment) return;
    let cancelled = false;

    (async () => {
      const gImg = await loadImageFromBlob(selectedGarment.cutoutBlob);
      if (cancelled) return;
      occlusionGarmentImgRef.current = gImg;

      const maskCanvas = document.createElement('canvas');
      maskCanvas.width = gImg.naturalWidth;
      maskCanvas.height = gImg.naturalHeight;
      const mctx = maskCanvas.getContext('2d')!;
      if (selectedLayer.layerMaskBlob) {
        const existingMask = await loadImageFromBlob(selectedLayer.layerMaskBlob);
        if (cancelled) return;
        mctx.drawImage(existingMask, 0, 0, maskCanvas.width, maskCanvas.height);
      } else {
        mctx.fillStyle = '#ffffff';
        mctx.fillRect(0, 0, maskCanvas.width, maskCanvas.height);
      }
      occlusionMaskCanvasRef.current = maskCanvas;
      redrawOcclusionPreview();
    })();

    return () => {
      cancelled = true;
    };
  }, [occlusionMode, selectedLayer?.instanceId]);

  const redrawOcclusionPreview = () => {
    const display = occlusionCanvasRef.current;
    const maskCanvas = occlusionMaskCanvasRef.current;
    const gImg = occlusionGarmentImgRef.current;
    if (!display || !maskCanvas || !gImg) return;
    display.width = gImg.naturalWidth;
    display.height = gImg.naturalHeight;
    const ctx = display.getContext('2d')!;
    ctx.clearRect(0, 0, display.width, display.height);
    ctx.drawImage(gImg, 0, 0);
    ctx.save();
    ctx.globalCompositeOperation = 'destination-in';
    ctx.drawImage(maskCanvas, 0, 0);
    ctx.restore();
  };

  const mapStagePointToGarmentCoords = (
    clientX: number,
    clientY: number,
    layer: OutfitLayer,
    garmentW: number,
    garmentH: number
  ): { x: number; y: number } | null => {
    const stage = stageRef.current;
    if (!stage) return null;
    const rect = stage.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return null;

    const cx = (layer.x / 100) * rect.width;
    const cy = (layer.y / 100) * rect.height;
    const lw = layer.scale * rect.width;
    const lh = lw * (garmentH / Math.max(1, garmentW));

    const dx = clientX - rect.left - cx;
    const dy = clientY - rect.top - cy;
    const rad = (-layer.rotation * Math.PI) / 180;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);
    let rx = dx * cos - dy * sin;
    const ry = dx * sin + dy * cos;
    if (layer.flipX) rx = -rx;

    const u = rx / lw + 0.5;
    const v = ry / lh + 0.5;
    return { x: u * garmentW, y: v * garmentH };
  };

  const paintOcclusionSegment = (p0: { x: number; y: number }, p1: { x: number; y: number }) => {
    const maskCanvas = occlusionMaskCanvasRef.current;
    const stage = stageRef.current;
    if (!maskCanvas || !stage || !selectedLayer) return;
    const mctx = maskCanvas.getContext('2d')!;
    const rect = stage.getBoundingClientRect();
    const lw = Math.max(40, selectedLayer.scale * rect.width);
    const scaledRadius = (occlusionBrushSize * maskCanvas.width) / lw;

    mctx.save();
    mctx.lineCap = 'round';
    mctx.lineJoin = 'round';
    mctx.lineWidth = scaledRadius;
    if (occlusionBrushMode === 'erase') {
      mctx.globalCompositeOperation = 'destination-out';
      mctx.strokeStyle = 'rgba(0,0,0,1)';
    } else {
      mctx.globalCompositeOperation = 'source-over';
      mctx.strokeStyle = 'rgba(255,255,255,1)';
    }
    mctx.beginPath();
    mctx.moveTo(p0.x, p0.y);
    mctx.lineTo(p1.x, p1.y);
    mctx.stroke();
    mctx.restore();

    redrawOcclusionPreview();
  };

  const handleFinishOcclusion = async () => {
    const maskCanvas = occlusionMaskCanvasRef.current;
    if (!maskCanvas || !selectedLayer) {
      setOcclusionMode(false);
      return;
    }
    const blob = await new Promise<Blob | null>((resolve) =>
      maskCanvas.toBlob((b) => resolve(b), 'image/png')
    );
    if (blob) {
      updateSelectedLayer({ layerMaskBlob: blob });
    }
    setOcclusionMode(false);
  };

  const handleResetOcclusion = () => {
    const maskCanvas = occlusionMaskCanvasRef.current;
    if (maskCanvas) {
      const mctx = maskCanvas.getContext('2d')!;
      mctx.globalCompositeOperation = 'source-over';
      mctx.fillStyle = '#ffffff';
      mctx.fillRect(0, 0, maskCanvas.width, maskCanvas.height);
      redrawOcclusionPreview();
    }
    updateSelectedLayer({ layerMaskBlob: undefined });
  };

  const updateSelectedLayer = (patch: Partial<OutfitLayer>) => {
    if (!selectedInstanceId) return;
    onLayersChange((prev) =>
      prev.map((l) => (l.instanceId === selectedInstanceId ? { ...l, ...patch } : l))
    );
  };

  const shiftSelectedZIndex = (direction: 'up' | 'down') => {
    if (!selectedInstanceId) return;
    onLayersChange((prev) => {
      const sorted = [...prev].sort((a, b) => a.zIndex - b.zIndex);
      const idx = sorted.findIndex((l) => l.instanceId === selectedInstanceId);
      if (idx < 0) return prev;
      const swapIdx = direction === 'up' ? idx + 1 : idx - 1;
      if (swapIdx < 0 || swapIdx >= sorted.length) return prev;
      const currZ = sorted[idx].zIndex;
      const targetZ = sorted[swapIdx].zIndex;
      const nextCurrZ = currZ === targetZ ? (direction === 'up' ? targetZ + 1 : targetZ - 1) : targetZ;
      const nextTargetZ = currZ;
      return prev.map((l) => {
        if (l.instanceId === sorted[idx].instanceId) return { ...l, zIndex: nextCurrZ };
        if (l.instanceId === sorted[swapIdx].instanceId) return { ...l, zIndex: nextTargetZ };
        return l;
      });
    });
  };

  const removeSelectedLayer = () => {
    if (!selectedInstanceId) return;
    onLayersChange((prev) => prev.filter((l) => l.instanceId !== selectedInstanceId));
    onSelectInstance(null);
  };

  const beginLayerPointerDown = (
    e: React.PointerEvent<HTMLElement>,
    layer: OutfitLayer,
    forceHandle = false
  ) => {
    if (occlusionMode) return;
    e.stopPropagation();
    onSelectInstance(layer.instanceId);
    if (layer.locked) return;

    const stage = stageRef.current;
    if (!stage) return;
    stage.setPointerCapture(e.pointerId);
    pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });

    const pts = Array.from(pointersRef.current.values());
    if (pts.length === 1) {
      if (forceHandle) {
        const rect = stage.getBoundingClientRect();
        const cx = rect.left + (layer.x / 100) * rect.width;
        const cy = rect.top + (layer.y / 100) * rect.height;
        const dx = pts[0].x - cx;
        const dy = pts[0].y - cy;
        gestureStartRef.current = {
          instanceId: layer.instanceId,
          mode: 'handle',
          layerStart: { ...layer },
          p1Start: pts[0],
          handleDistStart: Math.max(12, Math.hypot(dx, dy)),
          handleAngleStart: (Math.atan2(dy, dx) * 180) / Math.PI,
        };
      } else {
        gestureStartRef.current = {
          instanceId: layer.instanceId,
          mode: 'drag',
          layerStart: { ...layer },
          p1Start: pts[0],
        };
      }
    } else if (pts.length >= 2) {
      const [p1, p2] = pts;
      const dist = Math.max(10, Math.hypot(p2.x - p1.x, p2.y - p1.y));
      const angle = (Math.atan2(p2.y - p1.y, p2.x - p1.x) * 180) / Math.PI;
      const center = { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 };
      gestureStartRef.current = {
        instanceId: layer.instanceId,
        mode: 'pinch',
        layerStart: { ...layer },
        p1Start: p1,
        p2Start: p2,
        centerStart: center,
        distStart: dist,
        angleStart: angle,
      };
    }
  };

  const handleStagePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    const stage = stageRef.current;
    if (!stage) return;

    if (occlusionMode && selectedLayer && selectedGarment) {
      stage.setPointerCapture(e.pointerId);
      const pt = mapStagePointToGarmentCoords(
        e.clientX,
        e.clientY,
        selectedLayer,
        selectedGarment.width,
        selectedGarment.height
      );
      if (pt) {
        occlusionDrawingRef.current = true;
        occlusionLastPtRef.current = pt;
        paintOcclusionSegment(pt, pt);
      }
      return;
    }

    if (pointersRef.current.size >= 1 && selectedLayer && !selectedLayer.locked) {
      stage.setPointerCapture(e.pointerId);
      pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
      const pts = Array.from(pointersRef.current.values());
      if (pts.length >= 2) {
        const [p1, p2] = pts;
        const dist = Math.max(10, Math.hypot(p2.x - p1.x, p2.y - p1.y));
        const angle = (Math.atan2(p2.y - p1.y, p2.x - p1.x) * 180) / Math.PI;
        gestureStartRef.current = {
          instanceId: selectedLayer.instanceId,
          mode: 'pinch',
          layerStart: { ...selectedLayer },
          p1Start: p1,
          p2Start: p2,
          centerStart: { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 },
          distStart: dist,
          angleStart: angle,
        };
      }
      return;
    }

    onSelectInstance(null);
  };

  const handleStagePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (occlusionMode && occlusionDrawingRef.current && selectedLayer && selectedGarment) {
      const pt = mapStagePointToGarmentCoords(
        e.clientX,
        e.clientY,
        selectedLayer,
        selectedGarment.width,
        selectedGarment.height
      );
      if (pt && occlusionLastPtRef.current) {
        paintOcclusionSegment(occlusionLastPtRef.current, pt);
        occlusionLastPtRef.current = pt;
      }
      return;
    }

    if (!pointersRef.current.has(e.pointerId)) return;
    pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });

    const g = gestureStartRef.current;
    const stage = stageRef.current;
    if (!g || !stage) return;
    const rect = stage.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;

    const pts = Array.from(pointersRef.current.values());
    if (g.mode === 'drag' && pts.length === 1) {
      const dxPct = ((pts[0].x - g.p1Start.x) / rect.width) * 100;
      const dyPct = ((pts[0].y - g.p1Start.y) / rect.height) * 100;
      let nextX = Math.max(0, Math.min(100, g.layerStart.x + dxPct));
      const nextY = Math.max(0, Math.min(100, g.layerStart.y + dyPct));
      if (Math.abs(nextX - 50) < 1.6) {
        nextX = 50;
        setShowCenterGuide(true);
      } else {
        setShowCenterGuide(false);
      }
      onLayersChange((prev) =>
        prev.map((l) => (l.instanceId === g.instanceId ? { ...l, x: nextX, y: nextY } : l))
      );
    } else if (
      g.mode === 'handle' &&
      pts.length === 1 &&
      g.handleDistStart &&
      g.handleAngleStart !== undefined
    ) {
      const cx = rect.left + (g.layerStart.x / 100) * rect.width;
      const cy = rect.top + (g.layerStart.y / 100) * rect.height;
      const dx = pts[0].x - cx;
      const dy = pts[0].y - cy;
      const nextDist = Math.max(12, Math.hypot(dx, dy));
      const nextAngle = (Math.atan2(dy, dx) * 180) / Math.PI;
      const scaleFactor = nextDist / g.handleDistStart;
      const angleDelta = nextAngle - g.handleAngleStart;

      onLayersChange((prev) =>
        prev.map((l) =>
          l.instanceId === g.instanceId
            ? {
                ...l,
                scale: Math.max(0.12, Math.min(1.4, g.layerStart.scale * scaleFactor)),
                rotation: g.layerStart.rotation + angleDelta,
              }
            : l
        )
      );
    } else if (
      g.mode === 'pinch' &&
      pts.length >= 2 &&
      g.distStart &&
      g.angleStart !== undefined &&
      g.centerStart
    ) {
      const [p1, p2] = pts;
      const nextDist = Math.max(10, Math.hypot(p2.x - p1.x, p2.y - p1.y));
      const nextAngle = (Math.atan2(p2.y - p1.y, p2.x - p1.x) * 180) / Math.PI;
      const nextCenter = { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 };

      const scaleFactor = nextDist / g.distStart;
      const angleDelta = nextAngle - g.angleStart;
      const dxPct = ((nextCenter.x - g.centerStart.x) / rect.width) * 100;
      const dyPct = ((nextCenter.y - g.centerStart.y) / rect.height) * 100;

      onLayersChange((prev) =>
        prev.map((l) =>
          l.instanceId === g.instanceId
            ? {
                ...l,
                x: Math.max(0, Math.min(100, g.layerStart.x + dxPct)),
                y: Math.max(0, Math.min(100, g.layerStart.y + dyPct)),
                scale: Math.max(0.12, Math.min(1.4, g.layerStart.scale * scaleFactor)),
                rotation: g.layerStart.rotation + angleDelta,
              }
            : l
        )
      );
    }
  };

  const handleStagePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (occlusionMode) {
      occlusionDrawingRef.current = false;
      occlusionLastPtRef.current = null;
      return;
    }

    pointersRef.current.delete(e.pointerId);
    if (pointersRef.current.size === 0) {
      gestureStartRef.current = null;
      setShowCenterGuide(false);
    } else if (pointersRef.current.size === 1 && gestureStartRef.current?.mode === 'pinch') {
      const remaining = Array.from(pointersRef.current.values())[0];
      const currentLayer = layers.find((l) => l.instanceId === gestureStartRef.current?.instanceId);
      if (currentLayer) {
        gestureStartRef.current = {
          instanceId: currentLayer.instanceId,
          mode: 'drag',
          layerStart: { ...currentLayer },
          p1Start: remaining,
        };
      }
    }
  };

  const handleStageWheel = (e: React.WheelEvent<HTMLDivElement>) => {
    if (!selectedLayer || selectedLayer.locked || occlusionMode) return;
    const delta = e.deltaY > 0 ? -0.03 : 0.03;
    updateSelectedLayer({
      scale: Math.max(0.12, Math.min(1.4, +(selectedLayer.scale + delta).toFixed(3))),
    });
  };

  const handleConfirmSaveLookbook = async () => {
    if (!activeModel || layers.length === 0) return;
    setIsSavingLook(true);
    try {
      const lookup = new Map<string, Blob>();
      for (const l of layers) {
        const g = garmentMap.get(l.garmentId);
        if (g) lookup.set(g.id, g.cutoutBlob);
      }
      const compositeBlob = await renderOutfitComposite(activeModel.imageBlob, layers, lookup);
      await onSaveLookbook({
        title: lookTitle.trim() || `今日搭配 ${new Date().toLocaleDateString('zh-CN')}`,
        notes: lookNotes.trim(),
        modelId: activeModel.id,
        compositeBlob,
        layers,
      });
      setLookTitle('');
      setLookNotes('');
      setShowSaveModal(false);
    } finally {
      setIsSavingLook(false);
    }
  };

  const handlePickGarment = (garment: GarmentItem) => {
    setDrawerOpen(false);
    onRequestAddGarment(garment);
  };

  return (
    <div className="relative flex w-full flex-1 flex-col h-[calc(100dvh-3rem-3.5rem)] overflow-hidden">
      {/* Inline SVG color-matrix filters for real-time warmth adjustments */}
      <svg className="sr-only" aria-hidden="true">
        <defs>
          {sortedLayers.map((layer) => {
            const wShift = ((layer.warmth ?? 0) * 0.85) / 255;
            const gShift = wShift * 0.18;
            return (
              <filter key={layer.instanceId} id={`warmth-${layer.instanceId}`}>
                <feColorMatrix
                  type="matrix"
                  values={`1 0 0 0 ${wShift}  0 1 0 0 ${gShift}  0 0 1 0 ${-wShift}  0 0 0 1 0`}
                />
              </filter>
            );
          })}
        </defs>
      </svg>

      {/* Portrait Fitting Stage + Bottom Thumb Dock */}
      <div className="relative flex flex-1 min-h-0 flex-col">
        {/* Compact Stage Top Strip */}
        <div className="flex h-11 shrink-0 items-center justify-between border-b border-[#E6E1D8] bg-[#FAF8F5] px-3">
          <div className="flex items-center gap-2 min-w-0">
            <button
              type="button"
              onClick={() => setShowModelPicker(true)}
              className="inline-flex min-h-[36px] items-center gap-1.5 border border-[#E6E1D8] bg-white px-2.5 text-xs font-medium text-[#141414] hover:bg-[#F2EFE9] truncate"
            >
              <User className="h-3.5 w-3.5 shrink-0" />
              <span className="truncate max-w-[130px]">
                {activeModel ? activeModel.name : '添加人像'}
              </span>
            </button>
            <span className="text-[11px] text-[#6E6A63] tabular-nums shrink-0">
              {layers.length} 件
            </span>
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            {layers.length > 0 && !occlusionMode && (
              <button
                type="button"
                onClick={() => {
                  onLayersChange([]);
                  onSelectInstance(null);
                }}
                className="min-h-[36px] px-2 text-xs text-[#6E6A63] hover:text-[#9A3B26]"
              >
                清空
              </button>
            )}
            <button
              type="button"
              onClick={() => setShowSaveModal(true)}
              disabled={!activeModel || layers.length === 0 || occlusionMode}
              className="inline-flex min-h-[36px] items-center gap-1.5 bg-[#141414] px-3 text-xs font-medium text-[#FAF8F5] disabled:opacity-35 hover:bg-[#2a2a2a] whitespace-nowrap"
            >
              <BookmarkCheck className="h-3.5 w-3.5" />
              <span>保存造型</span>
            </button>
          </div>
        </div>

        {/* Center Portrait Canvas (Auto-fits remaining vertical height cleanly) */}
        <div className="relative flex flex-1 min-h-0 items-center justify-center bg-[#F2EFE9]/60 p-2">
          {!activeModel ? (
            <div className="flex max-w-sm flex-col items-center border border-[#E6E1D8] bg-white p-6 text-center">
              <User className="h-8 w-8 text-[#6E6A63]" />
              <h3 className="mt-3 font-display text-2xl font-semibold text-[#141414]">
                先放置您的人像底图
              </h3>
              <p className="mt-1.5 text-xs leading-relaxed text-[#6E6A63]">
                拍一张正面全身照或从相册上传，所有照片仅保存在本机浏览器中。
              </p>
              <div className="mt-5 flex w-full gap-2">
                <button
                  type="button"
                  onClick={() => cameraInputRef.current?.click()}
                  className="flex-1 min-h-[44px] inline-flex items-center justify-center gap-1.5 bg-[#141414] px-3 text-xs font-medium text-[#FAF8F5]"
                >
                  <Camera className="h-4 w-4" />
                  <span>立即拍照</span>
                </button>
                <button
                  type="button"
                  onClick={() => albumInputRef.current?.click()}
                  className="flex-1 min-h-[44px] inline-flex items-center justify-center gap-1.5 border border-[#141414] bg-white px-3 text-xs font-medium text-[#141414]"
                >
                  <Upload className="h-4 w-4" />
                  <span>相册上传</span>
                </button>
              </div>
            </div>
          ) : (
            <div
              ref={stageRef}
              onPointerDown={handleStagePointerDown}
              onPointerMove={handleStagePointerMove}
              onPointerUp={handleStagePointerUp}
              onPointerCancel={handleStagePointerUp}
              onWheel={handleStageWheel}
              style={{
                aspectRatio: `${activeModel.width} / ${activeModel.height}`,
              }}
              className={`relative h-full max-h-full w-auto max-w-full overflow-hidden bg-white shadow-sm touch-none select-none ${
                occlusionMode ? 'cursor-crosshair ring-2 ring-[#9A3B26]' : ''
              }`}
            >
              <BlobImage
                blob={activeModel.imageBlob}
                alt={activeModel.name}
                className="h-full w-full object-cover pointer-events-none select-none"
              />

              {showCenterGuide && (
                <div className="pointer-events-none absolute inset-y-0 left-1/2 z-50 border-l border-dashed border-[#9A3B26]/70" />
              )}

              {sortedLayers.map((layer) => {
                const garment = garmentMap.get(layer.garmentId);
                if (!garment) return null;
                const isSelected = layer.instanceId === selectedInstanceId;
                const isBeingOccluded = occlusionMode && isSelected;

                const brightness = layer.brightness ?? 1;
                const contrast = layer.contrast ?? 1;
                const warmth = layer.warmth ?? 0;
                const filterCss = `${warmth !== 0 ? `url(#warmth-${layer.instanceId}) ` : ''}brightness(${brightness}) contrast(${contrast})`;

                return (
                  <div
                    key={layer.instanceId}
                    onPointerDown={(e) => beginLayerPointerDown(e, layer, false)}
                    style={{
                      left: `${layer.x}%`,
                      top: `${layer.y}%`,
                      width: `${layer.scale * 100}%`,
                      zIndex: layer.zIndex,
                      opacity: occlusionMode && !isSelected ? 0.55 : layer.opacity,
                      transform: `translate(-50%, -50%) rotate(${layer.rotation}deg) scaleX(${
                        layer.flipX ? -1 : 1
                      })`,
                    }}
                    className={`absolute touch-none select-none ${
                      occlusionMode ? 'pointer-events-none' : 'cursor-move'
                    } ${
                      isSelected && !occlusionMode
                        ? 'outline-1 outline-dashed outline-[#141414] ring-1 ring-white/70'
                        : ''
                    }`}
                  >
                    {isBeingOccluded ? (
                      <canvas
                        ref={occlusionCanvasRef}
                        style={{ filter: filterCss }}
                        className="h-auto w-full pointer-events-none select-none"
                      />
                    ) : (
                      <LayerImageWithMask
                        garmentBlob={garment.cutoutBlob}
                        maskBlob={layer.layerMaskBlob}
                        alt={garment.name}
                        filterCss={filterCss}
                        dropShadow={layer.dropShadow !== false}
                      />
                    )}

                    {isSelected && !layer.locked && !occlusionMode && (
                      <button
                        type="button"
                        onPointerDown={(e) => beginLayerPointerDown(e, layer, true)}
                        className="absolute -right-3.5 -bottom-3.5 flex h-8 w-8 items-center justify-center rounded-full border border-[#141414] bg-[#FAF8F5] text-[#141414] shadow-sm touch-none"
                        aria-label="拖拽缩放与旋转"
                        title="拖拽缩放与旋转"
                      >
                        <RotateCw className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                );
              })}

              {layers.length === 0 && (
                <div className="pointer-events-none absolute inset-x-3 bottom-3 bg-[#FAF8F5]/90 border border-[#E6E1D8] px-3 py-1.5 text-center text-[11px] text-[#6E6A63] backdrop-blur-xs">
                  下方点选单品上身 · 支持双指捏合缩放与旋转
                </div>
              )}
            </div>
          )}

          {/* Floating Lighting / Opacity Sheet (overlays bottom of stage cleanly without shrinking portrait) */}
          {showLightingPanel && !occlusionMode && selectedLayer && selectedGarment && (
            <div className="absolute inset-x-2 bottom-2 z-30 border border-[#E6E1D8] bg-[#FAF8F5]/95 p-3 shadow-md backdrop-blur-md">
              <div className="mb-2 flex items-center justify-between border-b border-[#E6E1D8] pb-1.5">
                <span className="text-xs font-semibold text-[#141414]">
                  光影与融合度 · {selectedGarment.name}
                </span>
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={() =>
                      updateSelectedLayer({
                        brightness: 1,
                        contrast: 1,
                        warmth: 0,
                        opacity: 1,
                        dropShadow: true,
                      })
                    }
                    className="text-[11px] text-[#6E6A63] underline"
                  >
                    重置
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowLightingPanel(false)}
                    className="text-xs font-medium text-[#141414]"
                  >
                    完成
                  </button>
                </div>
              </div>

              <div className="grid gap-2 text-[11px] text-[#6E6A63]">
                <div className="flex items-center gap-2">
                  <span className="w-11 shrink-0">亮度</span>
                  <input
                    type="range"
                    min={0.65}
                    max={1.35}
                    step={0.05}
                    value={selectedLayer.brightness ?? 1}
                    onChange={(e) => updateSelectedLayer({ brightness: Number(e.target.value) })}
                    className="w-full accent-[#141414]"
                  />
                  <span className="w-9 text-right tabular-nums">
                    {Math.round((selectedLayer.brightness ?? 1) * 100)}%
                  </span>
                </div>

                <div className="flex items-center gap-2">
                  <span className="w-11 shrink-0">对比度</span>
                  <input
                    type="range"
                    min={0.75}
                    max={1.35}
                    step={0.05}
                    value={selectedLayer.contrast ?? 1}
                    onChange={(e) => updateSelectedLayer({ contrast: Number(e.target.value) })}
                    className="w-full accent-[#141414]"
                  />
                  <span className="w-9 text-right tabular-nums">
                    {Math.round((selectedLayer.contrast ?? 1) * 100)}%
                  </span>
                </div>

                <div className="flex items-center gap-2">
                  <span className="w-11 shrink-0">色温</span>
                  <input
                    type="range"
                    min={-40}
                    max={40}
                    step={2}
                    value={selectedLayer.warmth ?? 0}
                    onChange={(e) => updateSelectedLayer({ warmth: Number(e.target.value) })}
                    className="w-full accent-[#141414]"
                  />
                  <span className="w-9 text-right tabular-nums">
                    {(selectedLayer.warmth ?? 0) > 0 ? `+${selectedLayer.warmth}` : selectedLayer.warmth ?? 0}
                  </span>
                </div>

                <div className="flex items-center gap-2">
                  <span className="w-11 shrink-0">透明度</span>
                  <input
                    type="range"
                    min={0.35}
                    max={1}
                    step={0.05}
                    value={selectedLayer.opacity}
                    onChange={(e) => updateSelectedLayer({ opacity: Number(e.target.value) })}
                    className="w-full accent-[#141414]"
                  />
                  <span className="w-9 text-right tabular-nums">
                    {Math.round(selectedLayer.opacity * 100)}%
                  </span>
                </div>
              </div>

              <label className="mt-2 inline-flex items-center gap-1.5 cursor-pointer text-[11px] text-[#141414]">
                <input
                  type="checkbox"
                  checked={selectedLayer.dropShadow !== false}
                  onChange={(e) => updateSelectedLayer({ dropShadow: e.target.checked })}
                  className="accent-[#141414]"
                />
                <span>开启衣物自然贴合投影</span>
              </label>
            </div>
          )}
        </div>

        {/* Bottom Thumb-Zone Dock (Zero occlusion over portrait feet!) */}
        <div className="shrink-0 border-t border-[#E6E1D8] bg-white">
          {/* Layer Quick-Select Strip when wearing clothes */}
          {sortedLayers.length > 0 && !occlusionMode && (
            <div className="flex items-center gap-1.5 overflow-x-auto border-b border-[#E6E1D8] px-3 py-1.5 no-scrollbar">
              <span className="text-[11px] text-[#6E6A63] shrink-0">已穿：</span>
              {sortedLayers.map((layer) => {
                const g = garmentMap.get(layer.garmentId);
                if (!g) return null;
                const active = layer.instanceId === selectedInstanceId;
                return (
                  <button
                    key={layer.instanceId}
                    type="button"
                    onClick={() => onSelectInstance(active ? null : layer.instanceId)}
                    className={`min-h-[30px] max-w-[116px] truncate border px-2.5 text-[11px] font-medium shrink-0 transition-colors ${
                      active
                        ? 'border-[#141414] bg-[#141414] text-[#FAF8F5]'
                        : 'border-[#E6E1D8] bg-[#FAF8F5] text-[#141414]'
                    }`}
                  >
                    {g.name}
                  </button>
                );
              })}
            </div>
          )}

          {/* Dock Mode 1: Occlusion Brush Controls */}
          {occlusionMode && selectedLayer && selectedGarment ? (
            <div className="p-2.5 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-semibold text-[#141414] truncate">
                  擦除遮挡 · {selectedGarment.name}
                </span>
                <button
                  type="button"
                  onClick={handleFinishOcclusion}
                  className="min-h-[38px] inline-flex items-center gap-1 bg-[#141414] px-3.5 text-xs font-medium text-[#FAF8F5] shrink-0"
                >
                  <Check className="h-3.5 w-3.5" />
                  <span>完成</span>
                </button>
              </div>

              <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar">
                <button
                  type="button"
                  onClick={() => setOcclusionBrushMode('erase')}
                  className={`min-h-[38px] inline-flex items-center gap-1 border px-2.5 text-xs font-medium shrink-0 ${
                    occlusionBrushMode === 'erase'
                      ? 'border-[#141414] bg-[#141414] text-[#FAF8F5]'
                      : 'border-[#E6E1D8] bg-[#FAF8F5] text-[#141414]'
                  }`}
                >
                  <Eraser className="h-3.5 w-3.5" />
                  <span>擦除</span>
                </button>
                <button
                  type="button"
                  onClick={() => setOcclusionBrushMode('restore')}
                  className={`min-h-[38px] inline-flex items-center gap-1 border px-2.5 text-xs font-medium shrink-0 ${
                    occlusionBrushMode === 'restore'
                      ? 'border-[#141414] bg-[#141414] text-[#FAF8F5]'
                      : 'border-[#E6E1D8] bg-[#FAF8F5] text-[#141414]'
                  }`}
                >
                  <Paintbrush className="h-3.5 w-3.5" />
                  <span>还原</span>
                </button>
                <button
                  type="button"
                  onClick={handleResetOcclusion}
                  className="min-h-[38px] inline-flex items-center gap-1 border border-[#E6E1D8] px-2 text-xs text-[#6E6A63] shrink-0"
                >
                  <RotateCcw className="h-3.5 w-3.5" />
                  <span>重置</span>
                </button>
                <div className="flex flex-1 min-w-[100px] items-center gap-1.5 pl-1 text-[11px] text-[#6E6A63]">
                  <input
                    type="range"
                    min={8}
                    max={64}
                    value={occlusionBrushSize}
                    onChange={(e) => setOcclusionBrushSize(Number(e.target.value))}
                    className="w-full accent-[#141414]"
                  />
                  <span className="w-6 text-right tabular-nums">{occlusionBrushSize}</span>
                </div>
              </div>
            </div>
          ) : selectedLayer && selectedGarment ? (
            /* Dock Mode 2: Active Layer Thumb Controls */
            <div className="flex items-center gap-1.5 overflow-x-auto px-3 py-2 no-scrollbar">
              <button
                type="button"
                onClick={() => setDrawerOpen(true)}
                className="min-h-[42px] inline-flex items-center gap-1 bg-[#141414] px-3 text-xs font-medium text-[#FAF8F5] shrink-0"
              >
                <Plus className="h-3.5 w-3.5" />
                <span>添衣</span>
              </button>
              <button
                type="button"
                onClick={() => setShowLightingPanel((v) => !v)}
                className={`min-h-[42px] inline-flex items-center gap-1 border px-2.5 text-xs shrink-0 ${
                  showLightingPanel
                    ? 'border-[#141414] bg-[#141414] text-[#FAF8F5]'
                    : 'border-[#E6E1D8] bg-white text-[#141414]'
                }`}
              >
                <SunMedium className="h-3.5 w-3.5" />
                <span>光影</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowLightingPanel(false);
                  setOcclusionMode(true);
                }}
                className={`min-h-[42px] inline-flex items-center gap-1 border px-2.5 text-xs shrink-0 ${
                  selectedLayer.layerMaskBlob
                    ? 'border-[#141414] bg-[#F2EFE9] text-[#141414] font-medium'
                    : 'border-[#E6E1D8] bg-white text-[#141414]'
                }`}
              >
                <Eraser className="h-3.5 w-3.5" />
                <span>遮挡</span>
              </button>
              <button
                type="button"
                onClick={() => shiftSelectedZIndex('up')}
                className="min-h-[42px] min-w-[42px] flex items-center justify-center border border-[#E6E1D8] text-[#141414] shrink-0"
                title="上移一层"
                aria-label="上移一层"
              >
                <ArrowUp className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={() => shiftSelectedZIndex('down')}
                className="min-h-[42px] min-w-[42px] flex items-center justify-center border border-[#E6E1D8] text-[#141414] shrink-0"
                title="下移一层"
                aria-label="下移一层"
              >
                <ArrowDown className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={() => updateSelectedLayer({ flipX: !selectedLayer.flipX })}
                className={`min-h-[42px] min-w-[42px] flex items-center justify-center border border-[#E6E1D8] shrink-0 ${
                  selectedLayer.flipX ? 'bg-[#141414] text-[#FAF8F5]' : 'text-[#141414]'
                }`}
                title="水平镜像"
                aria-label="水平镜像"
              >
                <FlipHorizontal2 className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={() => updateSelectedLayer({ locked: !selectedLayer.locked })}
                className={`min-h-[42px] min-w-[42px] flex items-center justify-center border border-[#E6E1D8] shrink-0 ${
                  selectedLayer.locked ? 'bg-[#141414] text-[#FAF8F5]' : 'text-[#141414]'
                }`}
                title={selectedLayer.locked ? '解锁' : '锁定'}
                aria-label="锁定或解锁"
              >
                {selectedLayer.locked ? <Lock className="h-4 w-4" /> : <Unlock className="h-4 w-4" />}
              </button>
              <button
                type="button"
                onClick={() => onEditGarmentCutout(selectedGarment)}
                className="min-h-[42px] min-w-[42px] flex items-center justify-center border border-[#E6E1D8] text-[#141414] shrink-0"
                title="精修抠图"
                aria-label="精修抠图"
              >
                <Scissors className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={removeSelectedLayer}
                className="min-h-[42px] min-w-[42px] flex items-center justify-center border border-[#E6E1D8] text-[#9A3B26] shrink-0"
                title="移除"
                aria-label="移除"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          ) : (
            /* Dock Mode 3: Portrait Quick Wardrobe Strip + Open Drawer Button */
            <div className="flex items-center gap-2 px-3 py-2">
              <button
                type="button"
                onClick={() => setDrawerOpen(true)}
                className="min-h-[48px] inline-flex flex-col items-center justify-center gap-0.5 bg-[#141414] px-3.5 text-[11px] font-medium text-[#FAF8F5] shrink-0"
              >
                <Plus className="h-4 w-4" />
                <span>选衣库</span>
              </button>
              <div className="flex flex-1 items-center gap-2 overflow-x-auto no-scrollbar">
                {garments.slice(0, 10).map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => handlePickGarment(item)}
                    className="h-12 w-10 shrink-0 border border-[#E6E1D8] bg-[#FAF8F5] p-0.5 flex items-center justify-center active:scale-95"
                    title={item.name}
                  >
                    <BlobImage
                      blob={item.thumbnailBlob}
                      alt={item.name}
                      className="max-h-full max-w-full object-contain"
                    />
                  </button>
                ))}
              </div>
              {layers.length > 0 && (
                <button
                  type="button"
                  onClick={() => onSelectInstance(sortedLayers[sortedLayers.length - 1].instanceId)}
                  className="min-h-[48px] inline-flex items-center justify-center border border-[#E6E1D8] px-2.5 text-[11px] text-[#141414] shrink-0"
                  title="调节顶层衣物"
                >
                  <SlidersHorizontal className="h-4 w-4" />
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Portrait Bottom Sheet Wardrobe Drawer */}
      {drawerOpen && (
        <div
          onClick={() => setDrawerOpen(false)}
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/45 backdrop-blur-xs"
        >
          <div
            className="flex max-h-[78dvh] w-full max-w-[440px] flex-col rounded-t-3xl bg-[#FAF8F5] border-t border-x border-[#E6E1D8] pb-safe"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mx-auto my-2.5 h-1.5 w-10 rounded-full bg-[#D5CFC4]" />
            <div className="flex items-center justify-between px-4 pb-2.5 border-b border-[#E6E1D8]">
              <h3 className="font-display text-xl font-semibold">选择衣橱单品叠穿</h3>
              <button
                type="button"
                onClick={() => setDrawerOpen(false)}
                className="flex h-10 w-10 items-center justify-center text-[#6E6A63]"
                aria-label="关闭"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="flex items-center gap-1 overflow-x-auto border-b border-[#E6E1D8] px-4 py-2 no-scrollbar">
              <button
                type="button"
                onClick={() => setDrawerCategory('all')}
                className={`min-h-[38px] px-3 text-xs font-medium whitespace-nowrap shrink-0 ${
                  drawerCategory === 'all' ? 'bg-[#141414] text-[#FAF8F5]' : 'text-[#6E6A63]'
                }`}
              >
                全部
              </button>
              {GARMENT_CATEGORIES.map((cat) => (
                <button
                  key={cat.id}
                  type="button"
                  onClick={() => setDrawerCategory(cat.id)}
                  className={`min-h-[38px] px-3 text-xs font-medium whitespace-nowrap shrink-0 ${
                    drawerCategory === cat.id ? 'bg-[#141414] text-[#FAF8F5]' : 'text-[#6E6A63]'
                  }`}
                >
                  {cat.label}
                </button>
              ))}
            </div>

            <div className="flex-1 overflow-y-auto p-3.5">
              {filteredWardrobe.length === 0 ? (
                <div className="py-10 text-center">
                  <p className="text-xs text-[#6E6A63]">该分类下暂无单品</p>
                  <button
                    type="button"
                    onClick={() => {
                      setDrawerOpen(false);
                      onGoToWardrobe();
                    }}
                    className="mt-3 min-h-[44px] border border-[#141414] px-5 text-xs font-medium"
                  >
                    前往衣橱导入
                  </button>
                </div>
              ) : (
                <div className="grid grid-cols-3 gap-2.5">
                  {filteredWardrobe.map((item) => {
                    const alreadyOnStage = layers.some((l) => l.garmentId === item.id);
                    return (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => handlePickGarment(item)}
                        className={`flex flex-col border bg-white p-1.5 text-left active:scale-[0.98] ${
                          alreadyOnStage ? 'border-[#141414]' : 'border-[#E6E1D8]'
                        }`}
                      >
                        <div className="aspect-[3/4] w-full flex items-center justify-center bg-[#FAF8F5] p-1">
                          <BlobImage
                            blob={item.thumbnailBlob}
                            alt={item.name}
                            className="max-h-full max-w-full object-contain"
                          />
                        </div>
                        <span className="mt-1.5 truncate text-[11px] font-medium text-[#141414] w-full">
                          {item.name}
                        </span>
                        {alreadyOnStage && (
                          <span className="text-[10px] text-[#9A3B26]">已上身</span>
                        )}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Model Switcher Modal */}
      {showModelPicker && (
        <div
          onClick={() => setShowModelPicker(false)}
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/45 backdrop-blur-xs"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-[440px] rounded-t-3xl bg-[#FAF8F5] border-t border-x border-[#E6E1D8] p-5 pb-8 pb-safe"
          >
            <div className="mx-auto mb-3 h-1.5 w-10 rounded-full bg-[#D5CFC4]" />
            <div className="flex items-center justify-between pb-3 border-b border-[#E6E1D8]">
              <h3 className="font-display text-2xl font-semibold">切换试衣人像</h3>
              <button
                type="button"
                onClick={() => setShowModelPicker(false)}
                className="flex h-10 w-10 items-center justify-center text-[#6E6A63]"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="mt-4 grid grid-cols-3 gap-2.5 max-h-[45dvh] overflow-y-auto">
              {models.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => {
                    onSelectModel(m.id);
                    setShowModelPicker(false);
                  }}
                  className={`flex flex-col border p-1.5 text-left ${
                    activeModel?.id === m.id
                      ? 'border-[#141414] bg-white ring-1 ring-[#141414]'
                      : 'border-[#E6E1D8] bg-white'
                  }`}
                >
                  <div className="aspect-[3/4] w-full overflow-hidden bg-[#F2EFE9]">
                    <BlobImage blob={m.thumbnailBlob} alt={m.name} className="h-full w-full object-cover" />
                  </div>
                  <span className="mt-1.5 truncate text-[11px] font-medium text-[#141414] w-full">
                    {m.name}
                  </span>
                </button>
              ))}
            </div>

            <div className="mt-4 flex gap-2 border-t border-[#E6E1D8] pt-4">
              <button
                type="button"
                onClick={() => cameraInputRef.current?.click()}
                className="flex-1 min-h-[44px] inline-flex items-center justify-center gap-1.5 bg-[#141414] text-xs font-medium text-[#FAF8F5]"
              >
                <Camera className="h-4 w-4" />
                <span>拍全身照</span>
              </button>
              <button
                type="button"
                onClick={() => albumInputRef.current?.click()}
                className="flex-1 min-h-[44px] inline-flex items-center justify-center gap-1.5 border border-[#141414] bg-white text-xs font-medium text-[#141414]"
              >
                <Upload className="h-4 w-4" />
                <span>上传人像</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Save Lookbook Modal */}
      {showSaveModal && (
        <div
          onClick={() => setShowSaveModal(false)}
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/45 backdrop-blur-xs"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-[440px] rounded-t-3xl bg-[#FAF8F5] border-t border-x border-[#E6E1D8] p-5 pb-8 pb-safe"
          >
            <div className="mx-auto mb-3 h-1.5 w-10 rounded-full bg-[#D5CFC4]" />
            <div className="flex items-center justify-between pb-3 border-b border-[#E6E1D8]">
              <h3 className="font-display text-2xl font-semibold">保存至造型册</h3>
              <button
                type="button"
                onClick={() => setShowSaveModal(false)}
                className="flex h-10 w-10 items-center justify-center text-[#6E6A63]"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="mt-4 space-y-4">
              <div>
                <label className="mb-1.5 block text-xs text-[#6E6A63]">造型名称</label>
                <input
                  type="text"
                  value={lookTitle}
                  onChange={(e) => setLookTitle(e.target.value)}
                  placeholder="例如：深秋驼色风衣通勤造型"
                  className="w-full min-h-[44px] border border-[#E6E1D8] bg-white px-3 text-sm focus:border-[#141414] focus:outline-none"
                />
              </div>
              <div>
                <label className="mb-1.5 block text-xs text-[#6E6A63]">穿搭笔记（选填）</label>
                <textarea
                  rows={2}
                  value={lookNotes}
                  onChange={(e) => setLookNotes(e.target.value)}
                  placeholder="记录场合、温度或配色灵感..."
                  className="w-full border border-[#E6E1D8] bg-white p-3 text-sm focus:border-[#141414] focus:outline-none"
                />
              </div>
              <p className="text-xs text-[#6E6A63] tabular-nums">
                将合成本地高清造型图，并保留 {layers.length} 件单品的位置、光影与局部遮挡设置。
              </p>
            </div>

            <div className="mt-5 flex gap-2">
              <button
                type="button"
                onClick={() => setShowSaveModal(false)}
                className="flex-1 min-h-[44px] border border-[#E6E1D8] bg-white text-xs font-medium text-[#141414]"
              >
                取消
              </button>
              <button
                type="button"
                onClick={handleConfirmSaveLookbook}
                disabled={isSavingLook}
                className="flex-1 min-h-[44px] bg-[#141414] text-xs font-medium text-[#FAF8F5] disabled:opacity-40"
              >
                {isSavingLook ? '正在合成保存...' : '确认保存'}
              </button>
            </div>
          </div>
        </div>
      )}

      <input
        ref={cameraInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={async (e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          if (file) {
            await onQuickUploadModel(file);
            setShowModelPicker(false);
          }
        }}
      />
      <input
        ref={albumInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={async (e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          if (file) {
            await onQuickUploadModel(file);
            setShowModelPicker(false);
          }
        }}
      />
    </div>
  );
};
