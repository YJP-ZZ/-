import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { BoundAlbum, GarmentItem, ModelPortrait, OutfitLayer, SavedOutfit } from '../types/wardrobe';
import { autoCutoutBlob, extractDominantColorFromBlob, processUploadedImage } from './imageEngine';

import starterModelUrl from '../assets/images/model_editorial_one_1795355304831.jpg';
import starterTrenchUrl from '../assets/images/garment_trench_coat_1795355306284.jpg';
import starterBlouseUrl from '../assets/images/garment_silk_blouse_1795355305276.jpg';
import starterTrousersUrl from '../assets/images/garment_wool_trousers_1795355306108.jpg';
import starterLoafersUrl from '../assets/images/garment_leather_loafers_1795355306284.jpg';

interface AtelierDB extends DBSchema {
  models: {
    key: string;
    value: ModelPortrait;
    indexes: { 'by-created': number };
  };
  garments: {
    key: string;
    value: GarmentItem;
    indexes: { 'by-category': string; 'by-created': number };
  };
  outfits: {
    key: string;
    value: SavedOutfit;
    indexes: { 'by-created': number };
  };
  boundAlbums: {
    key: string;
    value: BoundAlbum;
  };
  meta: {
    key: string;
    value: { key: string; value: unknown };
  };
}

let dbPromise: Promise<IDBPDatabase<AtelierDB>> | null = null;

export function getDB(): Promise<IDBPDatabase<AtelierDB>> {
  if (!dbPromise) {
    dbPromise = openDB<AtelierDB>('atelier_mirror_db', 1, {
      upgrade(db) {
        if (!db.objectStoreNames.contains('models')) {
          const modelStore = db.createObjectStore('models', { keyPath: 'id' });
          modelStore.createIndex('by-created', 'createdAt');
        }
        if (!db.objectStoreNames.contains('garments')) {
          const garmentStore = db.createObjectStore('garments', { keyPath: 'id' });
          garmentStore.createIndex('by-category', 'category');
          garmentStore.createIndex('by-created', 'createdAt');
        }
        if (!db.objectStoreNames.contains('outfits')) {
          const outfitStore = db.createObjectStore('outfits', { keyPath: 'id' });
          outfitStore.createIndex('by-created', 'createdAt');
        }
        if (!db.objectStoreNames.contains('boundAlbums')) {
          db.createObjectStore('boundAlbums', { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains('meta')) {
          db.createObjectStore('meta', { keyPath: 'key' });
        }
      },
    });
  }
  return dbPromise;
}

export function generateId(prefix = 'item'): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `${prefix}_${crypto.randomUUID()}`;
  }
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

// --- Models ---
export async function getAllModels(): Promise<ModelPortrait[]> {
  const db = await getDB();
  const list = await db.getAll('models');
  return list.sort((a, b) => Number(b.isDefault) - Number(a.isDefault) || b.createdAt - a.createdAt);
}

export async function saveModel(model: ModelPortrait): Promise<void> {
  const db = await getDB();
  if (model.isDefault) {
    const existing = await db.getAll('models');
    const tx = db.transaction('models', 'readwrite');
    for (const m of existing) {
      if (m.id !== model.id && m.isDefault) {
        await tx.store.put({ ...m, isDefault: false });
      }
    }
    await tx.store.put(model);
    await tx.done;
    return;
  }
  await db.put('models', model);
}

export async function setDefaultModel(id: string): Promise<void> {
  const db = await getDB();
  const existing = await db.getAll('models');
  const tx = db.transaction('models', 'readwrite');
  for (const m of existing) {
    await tx.store.put({ ...m, isDefault: m.id === id });
  }
  await tx.done;
}

export async function deleteModel(id: string): Promise<void> {
  const db = await getDB();
  await db.delete('models', id);
}

// --- Garments ---
export async function getAllGarments(): Promise<GarmentItem[]> {
  const db = await getDB();
  const list = await db.getAll('garments');
  return list.sort((a, b) => b.createdAt - a.createdAt);
}

export async function saveGarment(item: GarmentItem): Promise<void> {
  const db = await getDB();
  await db.put('garments', item);
}

export async function deleteGarment(id: string): Promise<void> {
  const db = await getDB();
  await db.delete('garments', id);
}

// --- Outfits ---
export async function getAllOutfits(): Promise<SavedOutfit[]> {
  const db = await getDB();
  const list = await db.getAll('outfits');
  return list.sort((a, b) => b.createdAt - a.createdAt);
}

export async function saveOutfit(outfit: SavedOutfit): Promise<void> {
  const db = await getDB();
  await db.put('outfits', outfit);
}

export async function deleteOutfit(id: string): Promise<void> {
  const db = await getDB();
  await db.delete('outfits', id);
}

// --- Bound Albums ---
export async function getAllBoundAlbums(): Promise<BoundAlbum[]> {
  const db = await getDB();
  return db.getAll('boundAlbums');
}

export async function saveBoundAlbum(album: BoundAlbum): Promise<void> {
  const db = await getDB();
  await db.put('boundAlbums', album);
}

export async function deleteBoundAlbum(id: string): Promise<void> {
  const db = await getDB();
  await db.delete('boundAlbums', id);
}

// --- Studio Draft Auto-Recovery ---
export interface StudioDraft {
  modelId: string | null;
  layers: OutfitLayer[];
  updatedAt: number;
}

export async function saveStudioDraft(modelId: string | null, layers: OutfitLayer[]): Promise<void> {
  const db = await getDB();
  await db.put('meta', {
    key: 'studio_draft_v1',
    value: { modelId, layers, updatedAt: Date.now() } satisfies StudioDraft,
  });
}

export async function loadStudioDraft(): Promise<StudioDraft | null> {
  const db = await getDB();
  const rec = await db.get('meta', 'studio_draft_v1');
  if (!rec || !rec.value) return null;
  return rec.value as StudioDraft;
}

// --- Storage Persistence & Anti-Loss Backup / Restore ---
export async function requestBrowserPersistentStorage(): Promise<boolean> {
  try {
    if (typeof navigator !== 'undefined' && navigator.storage?.persist) {
      return await navigator.storage.persist();
    }
  } catch {
    // Ignore unsupported environments
  }
  return false;
}

export interface StorageSummary {
  isPersisted: boolean;
  usageBytes: number;
  quotaBytes: number;
  lastBackupAt: number | null;
}

export async function getStorageSummary(): Promise<StorageSummary> {
  let isPersisted = false;
  let usageBytes = 0;
  let quotaBytes = 0;

  try {
    if (navigator.storage?.persisted) {
      isPersisted = await navigator.storage.persisted();
    }
    if (navigator.storage?.estimate) {
      const est = await navigator.storage.estimate();
      usageBytes = est.usage ?? 0;
      quotaBytes = est.quota ?? 0;
    }
  } catch {
    // fallback
  }

  const db = await getDB();
  const backupMeta = await db.get('meta', 'last_backup_at');
  const lastBackupAt = typeof backupMeta?.value === 'number' ? backupMeta.value : null;

  return { isPersisted, usageBytes, quotaBytes, lastBackupAt };
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      if (typeof reader.result === 'string') resolve(reader.result);
      else reject(new Error('Failed to encode blob'));
    };
    reader.onerror = () => reject(reader.error ?? new Error('FileReader error'));
    reader.readAsDataURL(blob);
  });
}

async function dataUrlToBlob(dataUrl: string): Promise<Blob> {
  const res = await fetch(dataUrl);
  return res.blob();
}

interface SerializedModel extends Omit<ModelPortrait, 'imageBlob' | 'thumbnailBlob'> {
  imageDataUrl: string;
  thumbnailDataUrl: string;
}

interface SerializedGarment extends Omit<GarmentItem, 'originalBlob' | 'cutoutBlob' | 'thumbnailBlob'> {
  originalDataUrl: string;
  cutoutDataUrl: string;
  thumbnailDataUrl: string;
}

interface SerializedLayer extends Omit<OutfitLayer, 'layerMaskBlob'> {
  layerMaskDataUrl?: string;
}

interface SerializedOutfit extends Omit<SavedOutfit, 'compositeBlob' | 'layers'> {
  compositeDataUrl: string;
  layers: SerializedLayer[];
}

export interface AtelierBackupArchive {
  schema: 'atelier-mirror-backup';
  version: 1;
  exportedAt: number;
  models: SerializedModel[];
  garments: SerializedGarment[];
  outfits: SerializedOutfit[];
}

export async function exportFullBackupBlob(): Promise<{ blob: Blob; filename: string }> {
  const [models, garments, outfits] = await Promise.all([
    getAllModels(),
    getAllGarments(),
    getAllOutfits(),
  ]);

  const serializedModels: SerializedModel[] = await Promise.all(
    models.map(async (m) => ({
      id: m.id,
      name: m.name,
      width: m.width,
      height: m.height,
      isDefault: m.isDefault,
      createdAt: m.createdAt,
      imageDataUrl: await blobToDataUrl(m.imageBlob),
      thumbnailDataUrl: await blobToDataUrl(m.thumbnailBlob),
    }))
  );

  const serializedGarments: SerializedGarment[] = await Promise.all(
    garments.map(async (g) => ({
      id: g.id,
      name: g.name,
      category: g.category,
      season: g.season,
      color: g.color,
      dominantHex: g.dominantHex,
      sourceAlbumId: g.sourceAlbumId,
      sourceFileKey: g.sourceFileKey,
      hasCutout: g.hasCutout,
      width: g.width,
      height: g.height,
      notes: g.notes,
      createdAt: g.createdAt,
      originalDataUrl: await blobToDataUrl(g.originalBlob),
      cutoutDataUrl: await blobToDataUrl(g.cutoutBlob),
      thumbnailDataUrl: await blobToDataUrl(g.thumbnailBlob),
    }))
  );

  const serializedOutfits: SerializedOutfit[] = await Promise.all(
    outfits.map(async (o) => ({
      id: o.id,
      title: o.title,
      modelId: o.modelId,
      notes: o.notes,
      createdAt: o.createdAt,
      compositeDataUrl: await blobToDataUrl(o.compositeBlob),
      layers: await Promise.all(
        o.layers.map(async (l) => {
          const { layerMaskBlob, ...rest } = l;
          return {
            ...rest,
            layerMaskDataUrl: layerMaskBlob ? await blobToDataUrl(layerMaskBlob) : undefined,
          };
        })
      ),
    }))
  );

  const now = Date.now();
  const archive: AtelierBackupArchive = {
    schema: 'atelier-mirror-backup',
    version: 1,
    exportedAt: now,
    models: serializedModels,
    garments: serializedGarments,
    outfits: serializedOutfits,
  };

  const db = await getDB();
  await db.put('meta', { key: 'last_backup_at', value: now });

  const dateTag = new Date(now).toISOString().slice(0, 10);
  return {
    blob: new Blob([JSON.stringify(archive)], { type: 'application/json' }),
    filename: `atelier-wardrobe-backup-${dateTag}.atelier.json`,
  };
}

export async function importFullBackupFile(
  file: File,
  mode: 'merge' | 'replace'
): Promise<{ modelsCount: number; garmentsCount: number; outfitsCount: number }> {
  const rawText = await file.text();
  const parsed = JSON.parse(rawText) as Partial<AtelierBackupArchive>;
  if (
    parsed.schema !== 'atelier-mirror-backup' ||
    !Array.isArray(parsed.models) ||
    !Array.isArray(parsed.garments) ||
    !Array.isArray(parsed.outfits)
  ) {
    throw new Error('备份文件格式无效，请选择 Atelier 镜橱导出的 .atelier.json 文件。');
  }

  const decodedModels: ModelPortrait[] = await Promise.all(
    parsed.models.map(async (m) => ({
      id: m.id,
      name: m.name,
      width: m.width,
      height: m.height,
      isDefault: m.isDefault,
      createdAt: m.createdAt,
      imageBlob: await dataUrlToBlob(m.imageDataUrl),
      thumbnailBlob: await dataUrlToBlob(m.thumbnailDataUrl),
    }))
  );

  const decodedGarments: GarmentItem[] = await Promise.all(
    parsed.garments.map(async (g) => ({
      id: g.id,
      name: g.name,
      category: g.category,
      season: g.season,
      color: g.color,
      dominantHex: g.dominantHex,
      sourceAlbumId: g.sourceAlbumId,
      sourceFileKey: g.sourceFileKey,
      hasCutout: g.hasCutout,
      width: g.width,
      height: g.height,
      notes: g.notes,
      createdAt: g.createdAt,
      originalBlob: await dataUrlToBlob(g.originalDataUrl),
      cutoutBlob: await dataUrlToBlob(g.cutoutDataUrl),
      thumbnailBlob: await dataUrlToBlob(g.thumbnailDataUrl),
    }))
  );

  const decodedOutfits: SavedOutfit[] = await Promise.all(
    parsed.outfits.map(async (o) => ({
      id: o.id,
      title: o.title,
      modelId: o.modelId,
      notes: o.notes,
      createdAt: o.createdAt,
      compositeBlob: await dataUrlToBlob(o.compositeDataUrl),
      layers: await Promise.all(
        o.layers.map(async (l) => {
          const { layerMaskDataUrl, ...rest } = l;
          return {
            ...rest,
            layerMaskBlob: layerMaskDataUrl ? await dataUrlToBlob(layerMaskDataUrl) : undefined,
          };
        })
      ),
    }))
  );

  const db = await getDB();
  const tx = db.transaction(['models', 'garments', 'outfits', 'meta'], 'readwrite');
  if (mode === 'replace') {
    await tx.objectStore('models').clear();
    await tx.objectStore('garments').clear();
    await tx.objectStore('outfits').clear();
  }

  for (const m of decodedModels) await tx.objectStore('models').put(m);
  for (const g of decodedGarments) await tx.objectStore('garments').put(g);
  for (const o of decodedOutfits) await tx.objectStore('outfits').put(o);
  await tx.objectStore('meta').put({ key: 'editorial_seeded_v1', value: true });
  await tx.done;

  return {
    modelsCount: decodedModels.length,
    garmentsCount: decodedGarments.length,
    outfitsCount: decodedOutfits.length,
  };
}

// --- Initial Editorial Starter Seeding ---
export async function seedInitialEditorialAssets(): Promise<void> {
  const db = await getDB();
  const seededFlag = await db.get('meta', 'editorial_seeded_v1');
  if (seededFlag?.value === true) {
    // Backfill dominant colors on any pre-existing garments missing color tags
    const existing = await db.getAll('garments');
    for (const g of existing) {
      if (!g.color || !g.dominantHex) {
        try {
          const detected = await extractDominantColorFromBlob(g.cutoutBlob);
          await db.put('garments', { ...g, color: detected.color, dominantHex: detected.dominantHex });
        } catch {
          // ignore
        }
      }
    }
    return;
  }

  try {
    const modelRes = await fetch(starterModelUrl);
    if (modelRes.ok) {
      const rawModelBlob = await modelRes.blob();
      const processedModel = await processUploadedImage(rawModelBlob, 1280, false);
      await saveModel({
        id: 'model_starter_editorial',
        name: '基础试衣模特 · 站姿',
        imageBlob: processedModel.blob,
        thumbnailBlob: processedModel.thumbnailBlob,
        width: processedModel.width,
        height: processedModel.height,
        isDefault: true,
        createdAt: Date.now() - 10000,
      });
    }

    const starterSpecs = [
      {
        id: 'garment_starter_blouse',
        name: '象牙白桑蚕丝衬衫',
        category: 'tops' as const,
        season: 'spring_autumn' as const,
        url: starterBlouseUrl,
        offsetMs: 4000,
      },
      {
        id: 'garment_starter_trousers',
        name: '炭灰褶裥羊毛阔腿裤',
        category: 'bottoms' as const,
        season: 'spring_autumn' as const,
        url: starterTrousersUrl,
        offsetMs: 3000,
      },
      {
        id: 'garment_starter_trench',
        name: '驼色双排扣风衣外套',
        category: 'outerwear' as const,
        season: 'spring_autumn' as const,
        url: starterTrenchUrl,
        offsetMs: 2000,
      },
      {
        id: 'garment_starter_loafers',
        name: '黑色小牛皮乐福鞋',
        category: 'shoes' as const,
        season: 'all' as const,
        url: starterLoafersUrl,
        offsetMs: 1000,
      },
    ];

    for (const spec of starterSpecs) {
      const res = await fetch(spec.url);
      if (!res.ok) continue;
      const rawBlob = await res.blob();
      const processed = await processUploadedImage(rawBlob, 1024, false);
      const cutout = await autoCutoutBlob(processed.blob, 26, 1);
      await saveGarment({
        id: spec.id,
        name: spec.name,
        category: spec.category,
        season: spec.season,
        color: cutout.color,
        dominantHex: cutout.dominantHex,
        originalBlob: processed.blob,
        cutoutBlob: cutout.cutoutBlob,
        thumbnailBlob: cutout.thumbnailBlob,
        hasCutout: true,
        width: cutout.width,
        height: cutout.height,
        notes: '杂志编辑精选基础单品',
        createdAt: Date.now() - spec.offsetMs,
      });
    }

    await db.put('meta', { key: 'editorial_seeded_v1', value: true });
  } catch (err) {
    console.warn('Starter editorial seed failed:', err);
  }
}
