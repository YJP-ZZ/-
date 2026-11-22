import type { BoundAlbum, GarmentCategory, GarmentItem, GarmentSeason } from '../types/wardrobe';
import { generateId, getAllGarments, saveBoundAlbum, saveGarment } from './db';
import { autoCutoutBlob, extractDominantColorFromBlob, processUploadedImage } from './imageEngine';

interface DirectoryPickerWindow extends Window {
  showDirectoryPicker?: (options?: {
    id?: string;
    mode?: 'read' | 'readwrite';
  }) => Promise<FileSystemDirectoryHandle>;
}

interface PermissionDirectoryHandle extends FileSystemDirectoryHandle {
  queryPermission?: (descriptor?: { mode?: 'read' | 'readwrite' }) => Promise<PermissionState>;
  requestPermission?: (descriptor?: { mode?: 'read' | 'readwrite' }) => Promise<PermissionState>;
}

const IMAGE_EXTENSIONS = new Set(['jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp']);

export function isDirectoryPickerSupported(): boolean {
  return typeof window !== 'undefined' && typeof (window as DirectoryPickerWindow).showDirectoryPicker === 'function';
}

export async function ensureDirectoryReadPermission(handle: FileSystemDirectoryHandle): Promise<boolean> {
  const permHandle = handle as PermissionDirectoryHandle;
  if (typeof permHandle.queryPermission !== 'function') return true;
  const current = await permHandle.queryPermission({ mode: 'read' });
  if (current === 'granted') return true;
  if (typeof permHandle.requestPermission === 'function') {
    const requested = await permHandle.requestPermission({ mode: 'read' });
    return requested === 'granted';
  }
  return false;
}

export async function pickAndBindFolder(defaultCategory: GarmentCategory): Promise<BoundAlbum | null> {
  const win = window as DirectoryPickerWindow;
  if (!win.showDirectoryPicker) return null;

  const handle = await win.showDirectoryPicker({
    id: 'atelier-wardrobe-album',
    mode: 'read',
  });

  const album: BoundAlbum = {
    id: generateId('album'),
    label: handle.name || '我的手机相册',
    directoryHandle: handle,
    defaultCategory,
    lastSyncedAt: 0,
    importedCount: 0,
  };
  await saveBoundAlbum(album);
  return album;
}

async function collectImagesFromDirectory(
  dirHandle: FileSystemDirectoryHandle,
  prefix = ''
): Promise<Array<{ relativePath: string; file: File }>> {
  const permHandle = dirHandle as PermissionDirectoryHandle;
  const results: Array<{ relativePath: string; file: File }> = [];
  if (typeof permHandle.entries !== 'function') return results;

  for await (const [name, entry] of permHandle.entries()) {
    if (name.startsWith('.')) continue;
    const rel = prefix ? `${prefix}/${name}` : name;
    if (entry.kind === 'file') {
      const ext = name.split('.').pop()?.toLowerCase() ?? '';
      if (IMAGE_EXTENSIONS.has(ext)) {
        try {
          const file = await (entry as FileSystemFileHandle).getFile();
          results.push({ relativePath: rel, file });
        } catch {
          // Skip unreadable files gracefully
        }
      }
    } else if (entry.kind === 'directory' && prefix.split('/').length < 2) {
      const nested = await collectImagesFromDirectory(entry as FileSystemDirectoryHandle, rel);
      results.push(...nested);
    }
  }
  return results;
}

export interface SyncAlbumOptions {
  autoCutout: boolean;
  season: GarmentSeason;
  onProgress?: (done: number, total: number) => void;
}

export interface SyncAlbumResult {
  addedItems: GarmentItem[];
  skippedCount: number;
  totalFound: number;
}

export async function syncBoundAlbum(
  album: BoundAlbum,
  options: SyncAlbumOptions
): Promise<SyncAlbumResult> {
  const granted = await ensureDirectoryReadPermission(album.directoryHandle);
  if (!granted) {
    throw new Error('未获得文件夹读取权限，请在系统弹窗中允许访问该相册目录。');
  }

  const files = await collectImagesFromDirectory(album.directoryHandle);
  const existingGarments = await getAllGarments();
  const existingKeys = new Set(
    existingGarments.map((g) => g.sourceFileKey).filter((k): k is string => Boolean(k))
  );

  const newFiles = files.filter(({ relativePath, file }) => {
    const key = `${album.id}::${relativePath}::${file.size}::${file.lastModified}`;
    return !existingKeys.has(key);
  });

  const addedItems: GarmentItem[] = [];
  let done = 0;

  for (const { relativePath, file } of newFiles) {
    const sourceFileKey = `${album.id}::${relativePath}::${file.size}::${file.lastModified}`;
    const baseName = file.name.replace(/\.[^.]+$/, '') || '相册衣物';
    const isPng = file.type === 'image/png';
    const processed = await processUploadedImage(file, 1024, isPng);

    let cutoutBlob = processed.blob;
    let thumbnailBlob = processed.thumbnailBlob;
    let width = processed.width;
    let height = processed.height;
    let hasCutout = isPng;
    let color = undefined;
    let dominantHex = undefined;

    if (options.autoCutout && !isPng) {
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
      name: baseName,
      category: album.defaultCategory,
      season: options.season,
      color,
      dominantHex,
      sourceAlbumId: album.id,
      sourceFileKey,
      originalBlob: processed.blob,
      cutoutBlob,
      thumbnailBlob,
      hasCutout,
      width,
      height,
      notes: `同步自文件夹「${album.label}」`,
      createdAt: Date.now() + done,
    };

    await saveGarment(item);
    addedItems.push(item);
    done++;
    options.onProgress?.(done, newFiles.length);
  }

  await saveBoundAlbum({
    ...album,
    lastSyncedAt: Date.now(),
    importedCount: album.importedCount + addedItems.length,
  });

  return {
    addedItems,
    skippedCount: files.length - newFiles.length,
    totalFound: files.length,
  };
}
