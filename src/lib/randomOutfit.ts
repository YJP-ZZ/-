import {
  GARMENT_CATEGORIES,
  type BodyLandmarks,
  type GarmentCategory,
  type GarmentColorId,
  type GarmentItem,
  type GarmentSeason,
  type ModelPortrait,
  type OutfitLayer,
} from '../types/wardrobe';
import { computeAutoFitTransform } from './poseFit';

const NEUTRAL_COLORS = new Set<GarmentColorId>(['black', 'white', 'gray', 'beige', 'navy', 'brown']);

function pickRandomItem<T>(
  candidates: T[],
  avoidIds?: Set<string>,
  getId?: (item: T) => string
): T | null {
  if (candidates.length === 0) return null;
  if (avoidIds && getId && candidates.length > 1) {
    const fresh = candidates.filter((c) => !avoidIds.has(getId(c)));
    if (fresh.length > 0) {
      return fresh[Math.floor(Math.random() * fresh.length)];
    }
  }
  return candidates[Math.floor(Math.random() * candidates.length)];
}

function filterPoolBySeason(pool: GarmentItem[], targetSeason: GarmentSeason): GarmentItem[] {
  if (targetSeason === 'all') return pool;
  const seasonal = pool.filter((g) => g.season === targetSeason || g.season === 'all');
  return seasonal.length > 0 ? seasonal : pool;
}

export interface RandomOutfitOptions {
  season?: GarmentSeason;
}

export interface RandomOutfitResult {
  layers: OutfitLayer[];
  pickedItems: GarmentItem[];
  keptLockedCount: number;
  seasonUsed: GarmentSeason;
}

/**
 * Generates a cohesive random outfit from the local wardrobe, respecting any locked layers
 * on stage, avoiding immediate repeats when alternatives exist, and auto-fitting every piece
 * to the active model's body pose landmarks.
 */
export async function generateRandomOutfitLayers(
  garments: GarmentItem[],
  currentLayers: OutfitLayer[],
  activeModel: ModelPortrait | null,
  landmarks: BodyLandmarks | undefined,
  options?: RandomOutfitOptions
): Promise<RandomOutfitResult> {
  const lockedLayers = currentLayers.filter((l) => l.locked);
  const lockedGarmentIds = new Set(lockedLayers.map((l) => l.garmentId));
  const previousGarmentIds = new Set(currentLayers.map((l) => l.garmentId));

  const garmentById = new Map(garments.map((g) => [g.id, g]));
  const occupiedCategories = new Set<GarmentCategory>();
  for (const layer of lockedLayers) {
    const g = garmentById.get(layer.garmentId);
    if (g) occupiedCategories.add(g.category);
  }

  const seasonChoices: GarmentSeason[] = ['spring_autumn', 'summer', 'winter', 'all'];
  const seasonUsed: GarmentSeason =
    options?.season && options.season !== 'all'
      ? options.season
      : seasonChoices[Math.floor(Math.random() * seasonChoices.length)];

  const byCategory = (cat: GarmentCategory): GarmentItem[] => {
    const allInCat = garments.filter((g) => g.category === cat && !lockedGarmentIds.has(g.id));
    return filterPoolBySeason(allInCat, seasonUsed);
  };

  const pickedItems: GarmentItem[] = [];
  const topsPool = byCategory('tops');
  const bottomsPool = byCategory('bottoms');
  const dressesPool = byCategory('dresses');
  const outerwearPool = byCategory('outerwear');
  const shoesPool = byCategory('shoes');
  const accessoriesPool = byCategory('accessories');

  const hasLockedTopOrBottom =
    occupiedCategories.has('tops') || occupiedCategories.has('bottoms');
  const hasLockedDress = occupiedCategories.has('dresses');

  const canDoSeparates =
    !hasLockedDress &&
    ((topsPool.length > 0 || occupiedCategories.has('tops')) &&
      (bottomsPool.length > 0 || occupiedCategories.has('bottoms')));
  const canDoDress = !hasLockedTopOrBottom && (dressesPool.length > 0 || occupiedCategories.has('dresses'));

  const chooseDress =
    hasLockedDress ||
    (canDoDress && (!canDoSeparates || Math.random() < 0.3));

  if (chooseDress) {
    if (!occupiedCategories.has('dresses')) {
      const dress = pickRandomItem(dressesPool, previousGarmentIds, (g) => g.id);
      if (dress) pickedItems.push(dress);
    }
  } else {
    let pickedTop: GarmentItem | null = null;
    if (!occupiedCategories.has('tops')) {
      pickedTop = pickRandomItem(topsPool, previousGarmentIds, (g) => g.id);
      if (pickedTop) pickedItems.push(pickedTop);
    }
    if (!occupiedCategories.has('bottoms') && bottomsPool.length > 0) {
      // Soft color-harmony preference: if top is vivid, boost neutral bottoms slightly
      const topIsNeutral = !pickedTop?.color || NEUTRAL_COLORS.has(pickedTop.color);
      let candidateBottoms = bottomsPool;
      if (!topIsNeutral) {
        const neutralBottoms = bottomsPool.filter((b) => !b.color || NEUTRAL_COLORS.has(b.color));
        if (neutralBottoms.length > 0 && Math.random() < 0.72) {
          candidateBottoms = neutralBottoms;
        }
      }
      const bottom = pickRandomItem(candidateBottoms, previousGarmentIds, (g) => g.id);
      if (bottom) pickedItems.push(bottom);
    }
  }

  // Optional outerwear (~55% chance when available, higher in winter/spring_autumn)
  const outerChance = seasonUsed === 'summer' ? 0.2 : seasonUsed === 'winter' ? 0.85 : 0.55;
  if (!occupiedCategories.has('outerwear') && outerwearPool.length > 0 && Math.random() < outerChance) {
    const outer = pickRandomItem(outerwearPool, previousGarmentIds, (g) => g.id);
    if (outer) pickedItems.push(outer);
  }

  // Shoes (~90% chance when available)
  if (!occupiedCategories.has('shoes') && shoesPool.length > 0 && Math.random() < 0.9) {
    const shoe = pickRandomItem(shoesPool, previousGarmentIds, (g) => g.id);
    if (shoe) pickedItems.push(shoe);
  }

  // Accessories (~45% chance when available)
  if (!occupiedCategories.has('accessories') && accessoriesPool.length > 0 && Math.random() < 0.45) {
    const acc = pickRandomItem(accessoriesPool, previousGarmentIds, (g) => g.id);
    if (acc) pickedItems.push(acc);
  }

  // Fallback: if nothing could be matched with category rules, pick any 1-2 non-locked items
  if (pickedItems.length === 0 && garments.length > 0) {
    const remaining = garments.filter((g) => !lockedGarmentIds.has(g.id));
    const single = pickRandomItem(remaining, previousGarmentIds, (g) => g.id);
    if (single) pickedItems.push(single);
  }

  const newLayers: OutfitLayer[] = [];
  for (let i = 0; i < pickedItems.length; i++) {
    const g = pickedItems[i];
    const meta = GARMENT_CATEGORIES.find((c) => c.id === g.category);
    let x = 50;
    let y = meta?.defaultY ?? 45;
    let scale = meta?.defaultScale ?? 0.45;
    let rotation = 0;

    if (activeModel) {
      try {
        const fit = await computeAutoFitTransform(
          activeModel.width,
          activeModel.height,
          landmarks,
          g.category,
          g.cutoutBlob
        );
        x = fit.x;
        y = fit.y;
        scale = fit.scale;
        rotation = fit.rotation;
      } catch {
        // fallback to category defaults
      }
    }

    newLayers.push({
      instanceId: `layer_${Date.now()}_${i}_${Math.random().toString(36).slice(2, 6)}`,
      garmentId: g.id,
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
      zIndex: meta?.defaultZ ?? 20 + i,
      locked: false,
    });
  }

  return {
    layers: [...lockedLayers, ...newLayers],
    pickedItems,
    keptLockedCount: lockedLayers.length,
    seasonUsed,
  };
}
