export type GarmentCategory =
  | 'tops'
  | 'bottoms'
  | 'dresses'
  | 'outerwear'
  | 'shoes'
  | 'accessories';

export type GarmentSeason = 'all' | 'spring_autumn' | 'summer' | 'winter';

export type GarmentColorId =
  | 'black'
  | 'white'
  | 'gray'
  | 'beige'
  | 'brown'
  | 'navy'
  | 'blue'
  | 'red'
  | 'green'
  | 'pastel';

export interface GarmentColorMeta {
  id: GarmentColorId;
  label: string;
  swatchHex: string;
}

export const GARMENT_COLORS: GarmentColorMeta[] = [
  { id: 'black', label: '炭黑', swatchHex: '#1C1C1C' },
  { id: 'white', label: '象牙白', swatchHex: '#F3F1EC' },
  { id: 'gray', label: '高级灰', swatchHex: '#8E8C87' },
  { id: 'beige', label: '燕麦米', swatchHex: '#D8CBB8' },
  { id: 'brown', label: '驼棕', swatchHex: '#9A7452' },
  { id: 'navy', label: '藏青', swatchHex: '#23334B' },
  { id: 'blue', label: '丹宁蓝', swatchHex: '#4B6E94' },
  { id: 'red', label: '酒红', swatchHex: '#8E2E2B' },
  { id: 'green', label: '橄榄绿', swatchHex: '#53634C' },
  { id: 'pastel', label: '柔粉紫', swatchHex: '#C9A7A7' },
];

export interface CategoryMeta {
  id: GarmentCategory;
  label: string;
  shortLabel: string;
  defaultScale: number;
  defaultY: number;
  defaultZ: number;
}

export const GARMENT_CATEGORIES: CategoryMeta[] = [
  { id: 'tops', label: '上衣', shortLabel: '上衣', defaultScale: 0.44, defaultY: 34, defaultZ: 20 },
  { id: 'bottoms', label: '下装', shortLabel: '下装', defaultScale: 0.48, defaultY: 59, defaultZ: 15 },
  { id: 'dresses', label: '连衣裙', shortLabel: '裙装', defaultScale: 0.56, defaultY: 46, defaultZ: 25 },
  { id: 'outerwear', label: '外套', shortLabel: '外套', defaultScale: 0.54, defaultY: 41, defaultZ: 35 },
  { id: 'shoes', label: '鞋履', shortLabel: '鞋履', defaultScale: 0.24, defaultY: 88, defaultZ: 18 },
  { id: 'accessories', label: '配饰', shortLabel: '配饰', defaultScale: 0.24, defaultY: 22, defaultZ: 45 },
];

export const SEASON_LABELS: Record<GarmentSeason, string> = {
  all: '四季',
  spring_autumn: '春秋',
  summer: '夏季',
  winter: '冬季',
};

export interface ModelPortrait {
  id: string;
  name: string;
  imageBlob: Blob;
  thumbnailBlob: Blob;
  width: number;
  height: number;
  isDefault: boolean;
  createdAt: number;
}

export interface GarmentItem {
  id: string;
  name: string;
  category: GarmentCategory;
  season: GarmentSeason;
  color?: GarmentColorId;
  dominantHex?: string;
  sourceAlbumId?: string;
  sourceFileKey?: string;
  originalBlob: Blob;
  cutoutBlob: Blob;
  thumbnailBlob: Blob;
  hasCutout: boolean;
  width: number;
  height: number;
  notes?: string;
  createdAt: number;
}

export interface OutfitLayer {
  instanceId: string;
  garmentId: string;
  x: number; // percentage of stage width (0..100)
  y: number; // percentage of stage height (0..100)
  scale: number; // relative to stage width
  rotation: number; // degrees
  flipX: boolean;
  opacity: number; // 0.35..1
  zIndex: number;
  locked: boolean;
  // Lighting & occlusion realism controls
  brightness?: number; // 0.65..1.35 (default 1)
  contrast?: number;   // 0.75..1.35 (default 1)
  warmth?: number;     // -40..40 (default 0)
  dropShadow?: boolean; // default true
  layerMaskBlob?: Blob; // per-instance occlusion mask PNG
}

export interface SavedOutfit {
  id: string;
  title: string;
  modelId: string;
  compositeBlob: Blob;
  layers: OutfitLayer[];
  notes?: string;
  createdAt: number;
}

export interface BoundAlbum {
  id: string;
  label: string;
  directoryHandle: FileSystemDirectoryHandle;
  defaultCategory: GarmentCategory;
  lastSyncedAt: number;
  importedCount: number;
}

export type AppTab = 'studio' | 'wardrobe' | 'lookbook' | 'models';

export function getCategoryLabel(category: GarmentCategory): string {
  return GARMENT_CATEGORIES.find((c) => c.id === category)?.label ?? category;
}

export function getColorLabel(colorId?: GarmentColorId): string {
  if (!colorId) return '';
  return GARMENT_COLORS.find((c) => c.id === colorId)?.label ?? '';
}
