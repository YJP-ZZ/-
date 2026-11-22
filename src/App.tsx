import { useCallback, useEffect, useState } from 'react';
import { BookMarked, ShieldCheck, Shirt, Sparkles, User } from 'lucide-react';
import {
  GARMENT_CATEGORIES,
  getCategoryLabel,
  type AppTab,
  type BodyLandmarks,
  type BoundAlbum,
  type GarmentCategory,
  type GarmentColorId,
  type GarmentItem,
  type GarmentSeason,
  type ModelPortrait,
  type OutfitLayer,
  type SavedOutfit,
} from './types/wardrobe';
import {
  deleteBoundAlbum,
  deleteGarment,
  deleteModel,
  deleteOutfit,
  generateId,
  getAllBoundAlbums,
  getAllGarments,
  getAllModels,
  getAllOutfits,
  loadStudioDraft,
  requestBrowserPersistentStorage,
  saveGarment,
  saveModel,
  saveOutfit,
  saveStudioDraft,
  seedInitialEditorialAssets,
  setDefaultModel,
} from './lib/db';
import {
  autoCutoutBlob,
  extractDominantColorFromBlob,
  processUploadedImage,
} from './lib/imageEngine';
import { computeAutoFitTransform, detectBodyLandmarks } from './lib/poseFit';
import { generateRandomOutfitLayers } from './lib/randomOutfit';
import { pickAndBindFolder, syncBoundAlbum } from './lib/albumSync';
import { PWAInstallButton } from './components/PWAInstallButton';
import { OfflineBanner } from './components/OfflineBanner';
import { TryOnStudio } from './components/TryOnStudio';
import { WardrobeGallery } from './components/WardrobeGallery';
import { LookbookArchive } from './components/LookbookArchive';
import { ModelsManager } from './components/ModelsManager';
import { CutoutEditorModal } from './components/CutoutEditorModal';
import { BackupModal } from './components/BackupModal';
import { BlobImage } from './hooks/useBlobUrl';

interface CutoutEditorState {
  isOpen: boolean;
  mode: 'create' | 'edit';
  initialBlob: Blob;
  initialItem?: GarmentItem;
  defaultCategory?: GarmentCategory;
}

export default function App() {
  const [activeTab, setActiveTab] = useState<AppTab>('studio');
  const [isInitializing, setIsInitializing] = useState(true);

  const [models, setModels] = useState<ModelPortrait[]>([]);
  const [activeModelId, setActiveModelId] = useState<string | null>(null);
  const [garments, setGarments] = useState<GarmentItem[]>([]);
  const [outfits, setOutfits] = useState<SavedOutfit[]>([]);
  const [boundAlbums, setBoundAlbums] = useState<BoundAlbum[]>([]);

  const [studioLayers, setStudioLayers] = useState<OutfitLayer[]>([]);
  const [selectedInstanceId, setSelectedInstanceId] = useState<string | null>(null);
  const [duplicateConfirmGarment, setDuplicateConfirmGarment] = useState<GarmentItem | null>(null);
  const [isAutoFitting, setIsAutoFitting] = useState(false);

  const [cutoutEditor, setCutoutEditor] = useState<CutoutEditorState | null>(null);
  const [showBackupModal, setShowBackupModal] = useState(false);
  const [syncStatusMessage, setSyncStatusMessage] = useState<string | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const showToast = useCallback((msg: string) => {
    setToastMessage(msg);
    window.setTimeout(() => {
      setToastMessage((prev) => (prev === msg ? null : prev));
    }, 3200);
  }, []);

  const refreshAllData = useCallback(async () => {
    const [nextModels, nextGarments, nextOutfits, nextAlbums] = await Promise.all([
      getAllModels(),
      getAllGarments(),
      getAllOutfits(),
      getAllBoundAlbums(),
    ]);
    setModels(nextModels);
    setGarments(nextGarments);
    setOutfits(nextOutfits);
    setBoundAlbums(nextAlbums);
    setActiveModelId((prev) => {
      if (prev && nextModels.some((m) => m.id === prev)) return prev;
      return nextModels.find((m) => m.isDefault)?.id ?? nextModels[0]?.id ?? null;
    });
  }, []);

  useEffect(() => {
    (async () => {
      await requestBrowserPersistentStorage();
      await seedInitialEditorialAssets();
      await refreshAllData();

      // Restore unsaved Try-On Studio draft if present
      const draft = await loadStudioDraft();
      if (draft) {
        if (draft.modelId) setActiveModelId(draft.modelId);
        if (Array.isArray(draft.layers) && draft.layers.length > 0) {
          setStudioLayers(draft.layers);
        }
      }
      setIsInitializing(false);
    })();
  }, [refreshAllData]);

  // Auto-save studio draft continuously to prevent data loss on refresh/background kill
  useEffect(() => {
    if (isInitializing) return;
    const timer = window.setTimeout(() => {
      saveStudioDraft(activeModelId, studioLayers).catch(() => {});
    }, 350);
    return () => window.clearTimeout(timer);
  }, [activeModelId, studioLayers, isInitializing]);

  const ensureModelLandmarks = useCallback(async (model: ModelPortrait): Promise<BodyLandmarks> => {
    if (model.poseLandmarks) return model.poseLandmarks;
    const detected = await detectBodyLandmarks(model.imageBlob);
    const updated: ModelPortrait = { ...model, poseLandmarks: detected };
    await saveModel(updated);
    setModels((prev) => prev.map((m) => (m.id === model.id ? { ...m, poseLandmarks: detected } : m)));
    return detected;
  }, []);

  // Automatically analyze active model's body pose offline in background if missing
  useEffect(() => {
    if (isInitializing || !activeModelId) return;
    const target = models.find((m) => m.id === activeModelId);
    if (!target || target.poseLandmarks) return;
    let cancelled = false;
    (async () => {
      const detected = await detectBodyLandmarks(target.imageBlob);
      if (cancelled) return;
      await saveModel({ ...target, poseLandmarks: detected });
      setModels((prev) => prev.map((m) => (m.id === target.id ? { ...m, poseLandmarks: detected } : m)));
    })();
    return () => {
      cancelled = true;
    };
  }, [activeModelId, models, isInitializing]);

  const handleUpdateModelLandmarks = useCallback(async (modelId: string, landmarks: BodyLandmarks) => {
    const target = models.find((m) => m.id === modelId);
    if (!target) return;
    const updated: ModelPortrait = { ...target, poseLandmarks: landmarks };
    await saveModel(updated);
    setModels((prev) => prev.map((m) => (m.id === modelId ? updated : m)));
  }, [models]);

  const handleRedetectModelLandmarks = useCallback(
    async (modelId: string): Promise<BodyLandmarks | null> => {
      const target = models.find((m) => m.id === modelId);
      if (!target) return null;
      setIsAutoFitting(true);
      try {
        const detected = await detectBodyLandmarks(target.imageBlob);
        const updated: ModelPortrait = { ...target, poseLandmarks: detected };
        await saveModel(updated);
        setModels((prev) => prev.map((m) => (m.id === modelId ? updated : m)));
        showToast(
          detected.source === 'auto'
            ? '已自动识别模特肩腰腿身形锚点'
            : '未检测到清晰全身姿态，已载入标准比例锚点'
        );
        return detected;
      } finally {
        setIsAutoFitting(false);
      }
    },
    [models, showToast]
  );

  // --- Model Handlers ---
  const handleUploadModel = async (file: File) => {
    const processed = await processUploadedImage(file, 1280, false);
    const name = file.name.replace(/\.[^.]+$/, '') || '我的人像照';
    const newModel: ModelPortrait = {
      id: generateId('model'),
      name,
      imageBlob: processed.blob,
      thumbnailBlob: processed.thumbnailBlob,
      width: processed.width,
      height: processed.height,
      isDefault: models.length === 0,
      createdAt: Date.now(),
    };
    await saveModel(newModel);
    await refreshAllData();
    setActiveModelId(newModel.id);
    showToast('已添加新试衣人像，正在自动识别身形...');
    const detected = await detectBodyLandmarks(newModel.imageBlob);
    await saveModel({ ...newModel, poseLandmarks: detected });
    setModels((prev) => prev.map((m) => (m.id === newModel.id ? { ...m, poseLandmarks: detected } : m)));
  };

  const handleSetDefaultModel = async (id: string) => {
    await setDefaultModel(id);
    await refreshAllData();
    setActiveModelId(id);
    showToast('已设为默认试衣人像');
  };

  const handleDeleteModel = async (id: string) => {
    await deleteModel(id);
    await refreshAllData();
    showToast('已移除人像');
  };

  // --- Garment Capture / Single Cutout / Batch Import ---
  const handleCaptureOrPickSingle = async (file: File) => {
    const isPng = file.type === 'image/png';
    const processed = await processUploadedImage(file, 1024, isPng);
    const baseName = file.name.replace(/\.[^.]+$/, '') || '新添单品';
    setCutoutEditor({
      isOpen: true,
      mode: 'create',
      initialBlob: processed.blob,
      initialItem: {
        id: '',
        name: baseName,
        category: 'tops',
        season: 'all',
        originalBlob: processed.blob,
        cutoutBlob: processed.blob,
        thumbnailBlob: processed.thumbnailBlob,
        hasCutout: isPng,
        width: processed.width,
        height: processed.height,
        createdAt: Date.now(),
      },
      defaultCategory: 'tops',
    });
  };

  const handleBatchUploadFiles = async (
    files: FileList,
    category: GarmentCategory,
    autoCutout: boolean
  ) => {
    const total = files.length;
    setSyncStatusMessage(`正在离线处理并导入 0 / ${total} 件衣物...`);
    let count = 0;
    for (let i = 0; i < total; i++) {
      const file = files[i];
      if (!file.type.startsWith('image/')) continue;
      const isPng = file.type === 'image/png';
      const processed = await processUploadedImage(file, 1024, isPng);

      let cutoutBlob = processed.blob;
      let thumbnailBlob = processed.thumbnailBlob;
      let width = processed.width;
      let height = processed.height;
      let hasCutout = isPng;
      let color: GarmentColorId | undefined;
      let dominantHex: string | undefined;

      if (autoCutout && !isPng) {
        try {
          const auto = await autoCutoutBlob(processed.blob, 30, 1);
          cutoutBlob = auto.cutoutBlob;
          thumbnailBlob = auto.thumbnailBlob;
          width = auto.width;
          height = auto.height;
          color = auto.color;
          dominantHex = auto.dominantHex;
          hasCutout = true;
        } catch {
          hasCutout = false;
        }
      }

      if (!color) {
        const detected = await extractDominantColorFromBlob(cutoutBlob);
        color = detected.color;
        dominantHex = detected.dominantHex;
      }

      const item: GarmentItem = {
        id: generateId('garment'),
        name: file.name.replace(/\.[^.]+$/, '') || `单品 ${i + 1}`,
        category,
        season: 'all',
        color,
        dominantHex,
        originalBlob: processed.blob,
        cutoutBlob,
        thumbnailBlob,
        hasCutout,
        width,
        height,
        createdAt: Date.now() + i,
      };
      await saveGarment(item);
      count++;
      setSyncStatusMessage(`正在离线处理并导入 ${count} / ${total} 件衣物...`);
    }
    await refreshAllData();
    setSyncStatusMessage(`批量导入完成：共新增 ${count} 件衣物至本地衣橱。`);
    showToast(`已导入 ${count} 件衣物`);
  };

  // --- Bound Folder Sync ---
  const handleBindFolder = async (defaultCategory: GarmentCategory) => {
    try {
      const album = await pickAndBindFolder(defaultCategory);
      if (!album) return;
      await refreshAllData();
      setSyncStatusMessage(`已绑定文件夹「${album.label}」，正在首次扫描导入...`);
      const res = await syncBoundAlbum(album, {
        autoCutout: true,
        season: 'all',
        onProgress: (done, total) => {
          setSyncStatusMessage(`正在扫描「${album.label}」：${done} / ${total}...`);
        },
      });
      await refreshAllData();
      setSyncStatusMessage(
        `文件夹「${album.label}」同步完成：新增 ${res.addedItems.length} 件，跳过已存在 ${res.skippedCount} 张。`
      );
      showToast(`已同步 ${res.addedItems.length} 件新衣物`);
    } catch (err) {
      if ((err as Error).name !== 'AbortError') {
        setSyncStatusMessage((err as Error).message || '绑定文件夹失败，请检查浏览器权限。');
      }
    }
  };

  const handleSyncFolder = async (album: BoundAlbum, autoCutout: boolean) => {
    try {
      setSyncStatusMessage(`正在扫描「${album.label}」中的新照片...`);
      const res = await syncBoundAlbum(album, {
        autoCutout,
        season: 'all',
        onProgress: (done, total) => {
          setSyncStatusMessage(`正在处理新照片：${done} / ${total}...`);
        },
      });
      await refreshAllData();
      setSyncStatusMessage(
        res.addedItems.length > 0
          ? `「${album.label}」同步完成：新增 ${res.addedItems.length} 件。`
          : `「${album.label}」已是最新（扫描 ${res.totalFound} 张，无新增）。`
      );
      showToast(
        res.addedItems.length > 0 ? `已同步 ${res.addedItems.length} 件新衣物` : '相册已是最新'
      );
    } catch (err) {
      setSyncStatusMessage((err as Error).message || '文件夹读取失败');
    }
  };

  const handleDeleteBoundAlbum = async (id: string) => {
    await deleteBoundAlbum(id);
    await refreshAllData();
    showToast('已解除文件夹绑定');
  };

  // --- Cutout Save ---
  const handleSaveCutout = async (result: {
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
  }) => {
    const existing = result.existingId
      ? garments.find((g) => g.id === result.existingId)
      : undefined;

    const item: GarmentItem = {
      id: existing?.id || generateId('garment'),
      name: result.name,
      category: result.category,
      season: result.season,
      color: result.color,
      dominantHex: result.dominantHex,
      sourceAlbumId: existing?.sourceAlbumId,
      sourceFileKey: existing?.sourceFileKey,
      originalBlob: result.originalBlob,
      cutoutBlob: result.cutoutBlob,
      thumbnailBlob: result.thumbnailBlob,
      hasCutout: result.hasCutout,
      width: result.width,
      height: result.height,
      notes: existing?.notes,
      createdAt: existing?.createdAt ?? Date.now(),
    };
    await saveGarment(item);
    await refreshAllData();
    setCutoutEditor(null);
    showToast(existing ? '已更新单品裁切、主色与分类' : '已保存新衣物至衣橱');
  };

  const handleDeleteGarment = async (id: string) => {
    await deleteGarment(id);
    setStudioLayers((prev) => prev.filter((l) => l.garmentId !== id));
    await refreshAllData();
    showToast('已删除单品');
  };

  // --- Try-On Layer Addition with Offline Pose Auto-Fit & Duplicate Confirmation ---
  const appendGarmentLayerToStudio = useCallback(
    async (garment: GarmentItem) => {
      const meta = GARMENT_CATEGORIES.find((c) => c.id === garment.category);
      const maxZ = studioLayers.reduce((acc, l) => Math.max(acc, l.zIndex), 10);
      const instanceId = `layer_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

      let x = 50;
      let y = meta?.defaultY ?? 45;
      let scale = meta?.defaultScale ?? 0.45;
      let rotation = 0;

      const activeModel = models.find((m) => m.id === activeModelId) ?? models[0] ?? null;
      if (activeModel) {
        setIsAutoFitting(true);
        try {
          const landmarks = await ensureModelLandmarks(activeModel);
          const fit = await computeAutoFitTransform(
            activeModel.width,
            activeModel.height,
            landmarks,
            garment.category,
            garment.cutoutBlob
          );
          x = fit.x;
          y = fit.y;
          scale = fit.scale;
          rotation = fit.rotation;
        } catch {
          // Fall back to category defaults
        } finally {
          setIsAutoFitting(false);
        }
      }

      const newLayer: OutfitLayer = {
        instanceId,
        garmentId: garment.id,
        x,
        y,
        scale,
        rotation,
        flipX: false,
        opacity: 1,
        brightness: 1,
        contrast: 1,
        warmth: 0,
        dropShadow: true,
        zIndex: Math.max(maxZ + 1, meta?.defaultZ ?? 20),
        locked: false,
      };
      setStudioLayers((prev) => [...prev, newLayer]);
      setSelectedInstanceId(instanceId);
      setActiveTab('studio');
      showToast(`已自动贴合穿上「${garment.name}」`);
    },
    [studioLayers, models, activeModelId, ensureModelLandmarks, showToast]
  );

  const handleAutoFitLayers = useCallback(
    async (
      targetInstanceId?: string,
      overrideModelId?: string,
      overrideLandmarks?: BodyLandmarks
    ) => {
      const modelId = overrideModelId ?? activeModelId;
      const targetModel = models.find((m) => m.id === modelId) ?? models[0] ?? null;
      if (!targetModel) return;

      setIsAutoFitting(true);
      try {
        const landmarks = overrideLandmarks ?? (await ensureModelLandmarks(targetModel));
        const garmentLookup = new Map(garments.map((g) => [g.id, g]));
        const nextTransforms = new Map<string, { x: number; y: number; scale: number; rotation: number }>();

        for (const layer of studioLayers) {
          if (targetInstanceId && layer.instanceId !== targetInstanceId) continue;
          if (!targetInstanceId && layer.locked) continue;
          const g = garmentLookup.get(layer.garmentId);
          if (!g) continue;
          const fit = await computeAutoFitTransform(
            targetModel.width,
            targetModel.height,
            landmarks,
            g.category,
            g.cutoutBlob
          );
          nextTransforms.set(layer.instanceId, fit);
        }

        if (nextTransforms.size > 0) {
          setStudioLayers((prev) =>
            prev.map((l) => {
              const fit = nextTransforms.get(l.instanceId);
              return fit ? { ...l, ...fit } : l;
            })
          );
          showToast(
            targetInstanceId ? '已自动贴合当前单品到模特身形' : '已将全套衣物自动贴合模特身形'
          );
        }
      } finally {
        setIsAutoFitting(false);
      }
    },
    [activeModelId, models, garments, studioLayers, ensureModelLandmarks, showToast]
  );

  const handleRequestAddGarment = useCallback(
    (garment: GarmentItem) => {
      const existing = studioLayers.find((l) => l.garmentId === garment.id);
      if (existing) {
        setDuplicateConfirmGarment(garment);
        return;
      }
      void appendGarmentLayerToStudio(garment);
    },
    [studioLayers, appendGarmentLayerToStudio]
  );

  const handleRandomOutfit = useCallback(async () => {
    if (garments.length === 0) {
      showToast('衣橱中暂无单品，请先添加衣物');
      return;
    }
    const targetModel = models.find((m) => m.id === activeModelId) ?? models[0] ?? null;
    setIsAutoFitting(true);
    try {
      const landmarks = targetModel ? await ensureModelLandmarks(targetModel) : undefined;
      const result = await generateRandomOutfitLayers(
        garments,
        studioLayers,
        targetModel,
        landmarks
      );
      setStudioLayers(result.layers);
      setSelectedInstanceId(null);
      setActiveTab('studio');
      if (result.keptLockedCount > 0) {
        showToast(
          `已保留 ${result.keptLockedCount} 件锁定单品，并随机搭配 ${result.pickedItems.length} 件新单品`
        );
      } else {
        showToast(`已随机搭配 ${result.pickedItems.length} 件单品并自动贴合身形`);
      }
    } finally {
      setIsAutoFitting(false);
    }
  }, [garments, models, activeModelId, studioLayers, ensureModelLandmarks, showToast]);

  // --- Lookbook Save / Reload / Delete ---
  const handleSaveLookbook = async (payload: {
    title: string;
    notes: string;
    modelId: string;
    compositeBlob: Blob;
    layers: OutfitLayer[];
  }) => {
    const outfit: SavedOutfit = {
      id: generateId('look'),
      title: payload.title,
      notes: payload.notes,
      modelId: payload.modelId,
      compositeBlob: payload.compositeBlob,
      layers: payload.layers,
      createdAt: Date.now(),
    };
    await saveOutfit(outfit);
    await refreshAllData();
    showToast('造型已保存至私人造型册');
  };

  const handleReloadOutfitInStudio = (outfit: SavedOutfit) => {
    if (models.some((m) => m.id === outfit.modelId)) {
      setActiveModelId(outfit.modelId);
    }
    const clonedLayers = outfit.layers.map((l) => ({ ...l }));
    setStudioLayers(clonedLayers);
    setSelectedInstanceId(clonedLayers[0]?.instanceId ?? null);
    setActiveTab('studio');
    showToast(`已载入造型「${outfit.title}」`);
  };

  const handleDeleteOutfit = async (id: string) => {
    await deleteOutfit(id);
    await refreshAllData();
    showToast('已删除造型记录');
  };

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-[440px] flex-col bg-[#FAF8F5] text-[#141414] sm:border-x sm:border-[#E6E1D8] sm:shadow-[0_0_48px_rgba(20,20,20,0.06)]">
      <OfflineBanner />

      {/* Top Editorial Header (Portrait Mobile Shell) */}
      <header className="sticky top-0 z-30 flex h-12 shrink-0 items-center justify-between gap-3 border-b border-[#E6E1D8] bg-[#FAF8F5]/95 px-4 backdrop-blur-md pt-safe">
        <button
          type="button"
          onClick={() => setActiveTab('studio')}
          className="font-display text-xl font-semibold tracking-tight text-[#141414] whitespace-nowrap shrink-0"
        >
          Atelier 镜橱
        </button>

        <div className="flex items-center gap-2 shrink-0">
          <PWAInstallButton />
          <button
            type="button"
            onClick={() => setShowBackupModal(true)}
            className="inline-flex min-h-[36px] items-center gap-1.5 border border-[#E6E1D8] bg-white px-2.5 text-xs font-medium text-[#141414] hover:border-[#141414] whitespace-nowrap shrink-0"
            title="离线备份与防丢失"
          >
            <ShieldCheck className="h-3.5 w-3.5" />
            <span>备份防丢</span>
          </button>
        </div>
      </header>

      {/* Main Content Workspace */}
      <main className="flex flex-1 flex-col pb-[calc(3.5rem+env(safe-area-inset-bottom,0px))]">
        {isInitializing ? (
          <div className="flex flex-1 items-center justify-center p-8 text-sm text-[#6E6A63]">
            正在准备离线试衣间与本地衣橱...
          </div>
        ) : activeTab === 'studio' ? (
          <TryOnStudio
            models={models}
            activeModelId={activeModelId}
            onSelectModel={(id) => {
              setActiveModelId(id);
              if (studioLayers.length > 0) {
                void handleAutoFitLayers(undefined, id);
              }
            }}
            onQuickUploadModel={handleUploadModel}
            garments={garments}
            layers={studioLayers}
            selectedInstanceId={selectedInstanceId}
            onSelectInstance={setSelectedInstanceId}
            onLayersChange={setStudioLayers}
            onRequestAddGarment={handleRequestAddGarment}
            onEditGarmentCutout={(g) =>
              setCutoutEditor({
                isOpen: true,
                mode: 'edit',
                initialBlob: g.originalBlob,
                initialItem: g,
              })
            }
            onUpdateModelLandmarks={handleUpdateModelLandmarks}
            onRedetectModelLandmarks={handleRedetectModelLandmarks}
            onAutoFitLayers={(instanceId, overrideLandmarks) =>
              handleAutoFitLayers(instanceId, undefined, overrideLandmarks)
            }
            onRandomOutfit={handleRandomOutfit}
            isAutoFitting={isAutoFitting}
            onSaveLookbook={handleSaveLookbook}
            onGoToWardrobe={() => setActiveTab('wardrobe')}
          />
        ) : activeTab === 'wardrobe' ? (
          <WardrobeGallery
            garments={garments}
            boundAlbums={boundAlbums}
            onCaptureOrPickSingle={handleCaptureOrPickSingle}
            onBatchUploadFiles={handleBatchUploadFiles}
            onBindFolder={handleBindFolder}
            onSyncFolder={handleSyncFolder}
            onDeleteBoundAlbum={handleDeleteBoundAlbum}
            onTryOnGarment={handleRequestAddGarment}
            onEditGarment={(g) =>
              setCutoutEditor({
                isOpen: true,
                mode: 'edit',
                initialBlob: g.originalBlob,
                initialItem: g,
              })
            }
            onDeleteGarment={handleDeleteGarment}
            onOpenBackupModal={() => setShowBackupModal(true)}
            syncStatusMessage={syncStatusMessage}
          />
        ) : activeTab === 'lookbook' ? (
          <LookbookArchive
            outfits={outfits}
            garments={garments}
            onReloadInStudio={handleReloadOutfitInStudio}
            onDeleteOutfit={handleDeleteOutfit}
            onGoToStudio={() => setActiveTab('studio')}
          />
        ) : (
          <ModelsManager
            models={models}
            activeModelId={activeModelId}
            onUploadModel={handleUploadModel}
            onSelectForStudio={(id) => {
              setActiveModelId(id);
              setActiveTab('studio');
            }}
            onSetDefault={handleSetDefaultModel}
            onDeleteModel={handleDeleteModel}
          />
        )}
      </main>

      {/* Portrait Fixed Bottom Thumb-Zone Navigation Bar */}
      <nav
        aria-label="主导航"
        className="fixed bottom-0 left-1/2 z-40 grid h-14 w-full max-w-[440px] -translate-x-1/2 grid-cols-4 items-center border-t border-x border-[#E6E1D8] bg-[#FAF8F5]/95 backdrop-blur-md pb-safe"
      >
        {(
          [
            { id: 'studio', label: '试衣间', Icon: Sparkles },
            { id: 'wardrobe', label: '衣橱', Icon: Shirt },
            { id: 'lookbook', label: '造型册', Icon: BookMarked },
            { id: 'models', label: '人像', Icon: User },
          ] as const
        ).map(({ id, label, Icon }) => {
          const active = activeTab === id;
          return (
            <button
              key={id}
              type="button"
              onClick={() => setActiveTab(id)}
              className={`flex h-full min-h-[44px] flex-col items-center justify-center gap-0.5 transition-colors ${
                active ? 'text-[#141414]' : 'text-[#6E6A63]'
              }`}
            >
              <Icon className={`h-5 w-5 ${active ? 'stroke-[2.2]' : 'stroke-[1.6]'}`} />
              <span className={`text-[10px] tracking-tight ${active ? 'font-semibold' : 'font-medium'}`}>
                {label}
              </span>
            </button>
          );
        })}
      </nav>

      {/* Duplicate Garment Confirmation Modal */}
      {duplicateConfirmGarment && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 backdrop-blur-xs">
          <div className="w-full max-w-[440px] rounded-t-3xl bg-[#FAF8F5] border-t border-x border-[#E6E1D8] p-5 pb-8 pb-safe">
            <div className="mx-auto mb-3 h-1.5 w-10 rounded-full bg-[#D5CFC4]" />
            <h3 className="font-display text-2xl font-semibold text-[#141414]">
              该单品已在试衣间中
            </h3>
            <div className="mt-4 flex items-center gap-3 border border-[#E6E1D8] bg-white p-3">
              <div className="h-14 w-12 shrink-0 bg-[#FAF8F5] flex items-center justify-center p-1">
                <BlobImage
                  blob={duplicateConfirmGarment.thumbnailBlob}
                  alt={duplicateConfirmGarment.name}
                  className="max-h-full max-w-full object-contain"
                />
              </div>
              <div className="min-w-0">
                <div className="truncate text-sm font-medium text-[#141414]">
                  {duplicateConfirmGarment.name}
                </div>
                <div className="text-xs text-[#6E6A63]">
                  {getCategoryLabel(duplicateConfirmGarment.category)} · 当前人像已穿戴此件
                </div>
              </div>
            </div>
            <p className="mt-3 text-xs leading-relaxed text-[#6E6A63]">
              是否需要再重复叠穿一件，或直接定位到画布中已有的那件？
            </p>
            <div className="mt-5 flex flex-col gap-2">
              <button
                type="button"
                onClick={() => {
                  const g = duplicateConfirmGarment;
                  setDuplicateConfirmGarment(null);
                  appendGarmentLayerToStudio(g);
                }}
                className="w-full min-h-[44px] bg-[#141414] text-xs font-medium text-[#FAF8F5]"
              >
                确认再添一件
              </button>
              <button
                type="button"
                onClick={() => {
                  const existing = studioLayers.find(
                    (l) => l.garmentId === duplicateConfirmGarment.id
                  );
                  setDuplicateConfirmGarment(null);
                  if (existing) {
                    setSelectedInstanceId(existing.instanceId);
                    setActiveTab('studio');
                  }
                }}
                className="w-full min-h-[44px] border border-[#141414] bg-white text-xs font-medium text-[#141414]"
              >
                定位到已穿的那件
              </button>
              <button
                type="button"
                onClick={() => setDuplicateConfirmGarment(null)}
                className="w-full min-h-[40px] text-xs text-[#6E6A63] hover:text-[#141414]"
              >
                取消
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Anti-Loss Backup & Restore Modal */}
      <BackupModal
        isOpen={showBackupModal}
        modelsCount={models.length}
        garmentsCount={garments.length}
        outfitsCount={outfits.length}
        onClose={() => setShowBackupModal(false)}
        onRestoreComplete={async (msg) => {
          await refreshAllData();
          showToast(msg);
        }}
      />

      {/* Fullscreen Cutout Editor Modal */}
      {cutoutEditor && (
        <CutoutEditorModal
          isOpen={cutoutEditor.isOpen}
          mode={cutoutEditor.mode}
          initialBlob={cutoutEditor.initialBlob}
          initialItem={cutoutEditor.initialItem}
          defaultCategory={cutoutEditor.defaultCategory}
          onClose={() => setCutoutEditor(null)}
          onSave={handleSaveCutout}
        />
      )}

      {/* Subtle Editorial Toast Feedback */}
      {toastMessage && (
        <div
          role="status"
          className="fixed bottom-16 left-1/2 z-50 max-w-[390px] -translate-x-1/2 bg-[#141414] px-4 py-2 text-xs font-medium text-[#FAF8F5] shadow-lg whitespace-nowrap"
        >
          {toastMessage}
        </div>
      )}
    </div>
  );
}
