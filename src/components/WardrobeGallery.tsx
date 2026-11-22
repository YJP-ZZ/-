import React, { useMemo, useRef, useState } from 'react';
import {
  Camera,
  ChevronDown,
  ChevronUp,
  FolderOpen,
  FolderSync,
  Images,
  Scissors,
  Search,
  ShieldCheck,
  Sparkles,
  Trash2,
  Unlink,
} from 'lucide-react';
import {
  GARMENT_CATEGORIES,
  GARMENT_COLORS,
  SEASON_LABELS,
  getCategoryLabel,
  getColorLabel,
  type BoundAlbum,
  type GarmentCategory,
  type GarmentColorId,
  type GarmentItem,
  type GarmentSeason,
} from '../types/wardrobe';
import { BlobImage } from '../hooks/useBlobUrl';
import { isDirectoryPickerSupported } from '../lib/albumSync';

interface WardrobeGalleryProps {
  garments: GarmentItem[];
  boundAlbums: BoundAlbum[];
  onCaptureOrPickSingle: (file: File) => void;
  onBatchUploadFiles: (files: FileList, category: GarmentCategory, autoCutout: boolean) => Promise<void>;
  onBindFolder: (defaultCategory: GarmentCategory) => Promise<void>;
  onSyncFolder: (album: BoundAlbum, autoCutout: boolean) => Promise<void>;
  onDeleteBoundAlbum: (id: string) => Promise<void>;
  onTryOnGarment: (garment: GarmentItem) => void;
  onEditGarment: (garment: GarmentItem) => void;
  onDeleteGarment: (id: string) => Promise<void>;
  onOpenBackupModal: () => void;
  syncStatusMessage: string | null;
}

export const WardrobeGallery: React.FC<WardrobeGalleryProps> = ({
  garments,
  boundAlbums,
  onCaptureOrPickSingle,
  onBatchUploadFiles,
  onBindFolder,
  onSyncFolder,
  onDeleteBoundAlbum,
  onTryOnGarment,
  onEditGarment,
  onDeleteGarment,
  onOpenBackupModal,
  syncStatusMessage,
}) => {
  const [selectedCategory, setSelectedCategory] = useState<'all' | GarmentCategory>('all');
  const [selectedSeason, setSelectedSeason] = useState<'all_filter' | GarmentSeason>('all_filter');
  const [selectedColor, setSelectedColor] = useState<'all' | GarmentColorId>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [importCategory, setImportCategory] = useState<GarmentCategory>('tops');
  const [autoCutoutOnImport, setAutoCutoutOnImport] = useState(true);
  const [showAlbumPanel, setShowAlbumPanel] = useState(false);
  const [isBusy, setIsBusy] = useState(false);

  const cameraRef = useRef<HTMLInputElement | null>(null);
  const singleUploadRef = useRef<HTMLInputElement | null>(null);
  const batchUploadRef = useRef<HTMLInputElement | null>(null);

  const folderPickerSupported = isDirectoryPickerSupported();

  const categoryCounts = useMemo(() => {
    const counts: Record<string, number> = { all: garments.length };
    for (const c of GARMENT_CATEGORIES) counts[c.id] = 0;
    for (const g of garments) {
      counts[g.category] = (counts[g.category] ?? 0) + 1;
    }
    return counts;
  }, [garments]);

  const filteredGarments = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return garments.filter((item) => {
      if (selectedCategory !== 'all' && item.category !== selectedCategory) return false;
      if (selectedSeason !== 'all_filter' && item.season !== selectedSeason) return false;
      if (selectedColor !== 'all' && item.color !== selectedColor) return false;
      if (q && !item.name.toLowerCase().includes(q) && !(item.notes ?? '').toLowerCase().includes(q)) {
        return false;
      }
      return true;
    });
  }, [garments, selectedCategory, selectedSeason, selectedColor, searchQuery]);

  const handleBindClick = async () => {
    setIsBusy(true);
    try {
      await onBindFolder(importCategory);
    } finally {
      setIsBusy(false);
    }
  };

  const handleSyncClick = async (album: BoundAlbum) => {
    setIsBusy(true);
    try {
      await onSyncFolder(album, autoCutoutOnImport);
    } finally {
      setIsBusy(false);
    }
  };

  return (
    <div className="w-full px-3.5 py-4">
      {/* Compact Header + Portrait 2x2 Action Grid */}
      <div className="flex flex-col gap-3.5 border-b border-[#E6E1D8] pb-4">
        <div>
          <h2 className="font-display text-2xl font-semibold tracking-tight text-[#141414]">
            私人衣橱与相册
          </h2>
          <p className="mt-1 text-xs text-[#6E6A63]">
            拍照录入、批量选图或绑定本地文件夹 · 自动识别主色并离线保存
          </p>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => cameraRef.current?.click()}
            className="min-h-[44px] inline-flex items-center justify-center gap-1.5 bg-[#141414] px-3.5 text-xs font-medium text-[#FAF8F5] active:scale-[0.98] whitespace-nowrap"
          >
            <Camera className="h-4 w-4" />
            <span>拍照添衣</span>
          </button>
          <button
            type="button"
            onClick={() => singleUploadRef.current?.click()}
            className="min-h-[44px] inline-flex items-center justify-center gap-1.5 border border-[#141414] bg-white px-3.5 text-xs font-medium text-[#141414] active:scale-[0.98] whitespace-nowrap"
          >
            <Scissors className="h-4 w-4" />
            <span>裁切抠图</span>
          </button>
          <button
            type="button"
            onClick={() => batchUploadRef.current?.click()}
            className="min-h-[44px] inline-flex items-center justify-center gap-1.5 border border-[#E6E1D8] bg-white px-3.5 text-xs font-medium text-[#141414] hover:border-[#141414] whitespace-nowrap"
          >
            <Images className="h-4 w-4" />
            <span>相册多选</span>
          </button>
          <button
            type="button"
            onClick={onOpenBackupModal}
            className="min-h-[44px] inline-flex items-center justify-center gap-1.5 border border-[#E6E1D8] bg-white px-3.5 text-xs font-medium text-[#141414] hover:border-[#141414] whitespace-nowrap"
          >
            <ShieldCheck className="h-4 w-4" />
            <span>备份防丢</span>
          </button>
        </div>
      </div>

      {/* Collapsible Bound Phone Folder Panel (Keeps garment grid above the fold on mobile!) */}
      <section className="mt-4 border border-[#E6E1D8] bg-white">
        <button
          type="button"
          onClick={() => setShowAlbumPanel((v) => !v)}
          className="flex w-full min-h-[46px] items-center justify-between gap-2 px-3.5 py-2.5 text-left"
        >
          <div className="flex items-center gap-2 min-w-0">
            <FolderOpen className="h-4 w-4 shrink-0 text-[#141414]" />
            <span className="text-xs sm:text-sm font-medium text-[#141414] truncate">
              指定相册文件夹绑定
            </span>
            <span className="text-[11px] text-[#6E6A63] tabular-nums shrink-0">
              {boundAlbums.length > 0 ? `已绑 ${boundAlbums.length} 个` : '点击展开'}
            </span>
          </div>
          {showAlbumPanel ? (
            <ChevronUp className="h-4 w-4 shrink-0 text-[#6E6A63]" />
          ) : (
            <ChevronDown className="h-4 w-4 shrink-0 text-[#6E6A63]" />
          )}
        </button>

        {(showAlbumPanel || syncStatusMessage) && (
          <div className="border-t border-[#E6E1D8] p-3.5 sm:p-4 space-y-3">
            <p className="text-xs leading-relaxed text-[#6E6A63]">
              {folderPickerSupported
                ? '授权绑定手机或电脑上的指定衣物文件夹后，每次点击「同步」即可自动增量导入新照片。'
                : '当前浏览器（如 iOS Safari）受系统沙盒限制不支持持久化文件夹句柄，请使用上方「相册多选」批量导入。'}
            </p>

            <div className="flex flex-wrap items-center gap-2">
              <select
                value={importCategory}
                onChange={(e) => setImportCategory(e.target.value as GarmentCategory)}
                className="min-h-[40px] border border-[#E6E1D8] bg-[#FAF8F5] px-2.5 text-xs text-[#141414]"
                aria-label="导入默认分类"
              >
                {GARMENT_CATEGORIES.map((c) => (
                  <option key={c.id} value={c.id}>
                    导入归入：{c.label}
                  </option>
                ))}
              </select>

              <label className="inline-flex min-h-[40px] cursor-pointer items-center gap-1.5 border border-[#E6E1D8] bg-[#FAF8F5] px-3 text-xs text-[#141414]">
                <input
                  type="checkbox"
                  checked={autoCutoutOnImport}
                  onChange={(e) => setAutoCutoutOnImport(e.target.checked)}
                  className="accent-[#141414]"
                />
                <span>批量自动去纯色底</span>
              </label>

              {folderPickerSupported && (
                <button
                  type="button"
                  onClick={handleBindClick}
                  disabled={isBusy}
                  className="min-h-[40px] inline-flex items-center gap-1.5 bg-[#141414] px-3.5 text-xs font-medium text-[#FAF8F5] disabled:opacity-40 whitespace-nowrap"
                >
                  <FolderOpen className="h-3.5 w-3.5" />
                  <span>绑定新文件夹</span>
                </button>
              )}
            </div>

            {syncStatusMessage && (
              <div className="border border-[#E6E1D8] bg-[#FAF8F5] px-3 py-2 text-xs text-[#141414]">
                {syncStatusMessage}
              </div>
            )}

            {boundAlbums.length > 0 && (
              <div className="grid gap-2">
                {boundAlbums.map((album) => (
                  <div
                    key={album.id}
                    className="flex items-center justify-between gap-2.5 border border-[#E6E1D8] bg-[#FAF8F5] p-2.5"
                  >
                    <div className="min-w-0">
                      <div className="truncate text-xs font-medium text-[#141414]">
                        {album.label}
                      </div>
                      <div className="mt-0.5 text-[11px] text-[#6E6A63] tabular-nums">
                        {getCategoryLabel(album.defaultCategory)} · {album.importedCount} 件
                      </div>
                    </div>

                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        type="button"
                        onClick={() => handleSyncClick(album)}
                        disabled={isBusy}
                        className="inline-flex min-h-[38px] items-center gap-1 border border-[#141414] bg-white px-2.5 text-xs font-medium text-[#141414] disabled:opacity-40"
                      >
                        <FolderSync className="h-3.5 w-3.5" />
                        <span>同步</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => onDeleteBoundAlbum(album.id)}
                        className="flex h-[38px] w-[38px] items-center justify-center text-[#6E6A63] hover:text-[#9A3B26]"
                        aria-label="解除绑定"
                      >
                        <Unlink className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </section>

      {/* Filter & Search Toolbar */}
      <div className="mt-4 flex flex-col gap-2.5">
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1 no-scrollbar">
          <button
            type="button"
            onClick={() => setSelectedCategory('all')}
            className={`min-h-[38px] px-3 text-xs font-medium whitespace-nowrap shrink-0 tabular-nums transition-colors ${
              selectedCategory === 'all'
                ? 'bg-[#141414] text-[#FAF8F5]'
                : 'border border-[#E6E1D8] bg-white text-[#6E6A63] hover:text-[#141414]'
            }`}
          >
            全部 ({categoryCounts.all})
          </button>
          {GARMENT_CATEGORIES.map((cat) => (
            <button
              key={cat.id}
              type="button"
              onClick={() => setSelectedCategory(cat.id)}
              className={`min-h-[38px] px-3 text-xs font-medium whitespace-nowrap shrink-0 tabular-nums transition-colors ${
                selectedCategory === cat.id
                  ? 'bg-[#141414] text-[#FAF8F5]'
                  : 'border border-[#E6E1D8] bg-white text-[#6E6A63] hover:text-[#141414]'
              }`}
            >
              {cat.label} ({categoryCounts[cat.id] ?? 0})
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2">
          <select
            value={selectedSeason}
            onChange={(e) => setSelectedSeason(e.target.value as 'all_filter' | GarmentSeason)}
            className="min-h-[38px] border border-[#E6E1D8] bg-white px-2.5 text-xs text-[#141414]"
            aria-label="按季节筛选"
          >
            <option value="all_filter">全部季节</option>
            {(Object.keys(SEASON_LABELS) as GarmentSeason[]).map((sKey) => (
              <option key={sKey} value={sKey}>
                {SEASON_LABELS[sKey]}
              </option>
            ))}
          </select>

          <div className="relative flex-1">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 h-3.5 w-3.5 -translate-y-1/2 text-[#6E6A63]" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="搜索衣物..."
              className="w-full min-h-[38px] border border-[#E6E1D8] bg-white pr-3 pl-8 text-xs text-[#141414] focus:border-[#141414] focus:outline-none"
            />
          </div>
        </div>
      </div>

      {/* Dominant Color Swatch Filter Bar */}
      <div className="mt-2.5 flex items-center gap-2 overflow-x-auto py-1 no-scrollbar">
        <span className="text-[11px] text-[#6E6A63] shrink-0">色系：</span>
        <button
          type="button"
          onClick={() => setSelectedColor('all')}
          className={`px-2.5 py-1 text-[11px] font-medium whitespace-nowrap shrink-0 border ${
            selectedColor === 'all'
              ? 'border-[#141414] bg-[#141414] text-[#FAF8F5]'
              : 'border-[#E6E1D8] bg-white text-[#6E6A63]'
          }`}
        >
          全部
        </button>
        {GARMENT_COLORS.map((c) => {
          const active = selectedColor === c.id;
          return (
            <button
              key={c.id}
              type="button"
              onClick={() => setSelectedColor(active ? 'all' : c.id)}
              title={c.label}
              aria-label={`筛选${c.label}`}
              className={`h-6 w-6 shrink-0 rounded-full border transition-transform ${
                active
                  ? 'scale-110 border-[#141414] ring-2 ring-[#141414] ring-offset-2 ring-offset-[#FAF8F5]'
                  : 'border-[#D5CFC4] hover:scale-105'
              }`}
              style={{ backgroundColor: c.swatchHex }}
            />
          );
        })}
      </div>

      {/* Garments Grid */}
      {filteredGarments.length === 0 ? (
        <div className="mt-6 border border-[#E6E1D8] bg-white py-14 text-center">
          <p className="font-display text-2xl font-semibold text-[#141414]">当前筛选下暂无衣物</p>
          <p className="mt-2 text-xs text-[#6E6A63]">
            点击上方拍照、裁切抠图或从相册批量导入您的日常单品
          </p>
        </div>
      ) : (
        <div className="mt-4 grid grid-cols-2 gap-3">
          {filteredGarments.map((item) => (
            <article
              key={item.id}
              className="group flex flex-col border border-[#E6E1D8] bg-white transition-colors hover:border-[#141414]"
            >
              <button
                type="button"
                onClick={() => onTryOnGarment(item)}
                className="relative aspect-[3/4] w-full overflow-hidden bg-[#FAF8F5] p-2.5 text-left"
              >
                <BlobImage
                  blob={item.thumbnailBlob}
                  alt={item.name}
                  className="h-full w-full object-contain transition-transform duration-200 group-hover:scale-[1.03]"
                />
              </button>

              <div className="flex flex-1 flex-col justify-between border-t border-[#E6E1D8] p-2.5">
                <div>
                  <h4 className="truncate text-xs font-medium text-[#141414]">
                    {item.name}
                  </h4>
                  <p className="mt-0.5 flex items-center gap-1.5 text-[11px] text-[#6E6A63]">
                    {item.dominantHex && (
                      <span
                        className="inline-block h-2.5 w-2.5 shrink-0 rounded-full border border-[#E6E1D8]"
                        style={{ backgroundColor: item.dominantHex }}
                      />
                    )}
                    <span className="truncate">
                      {getCategoryLabel(item.category)} · {SEASON_LABELS[item.season]}
                      {item.color ? ` · ${getColorLabel(item.color)}` : ''}
                    </span>
                  </p>
                </div>

                <div className="mt-2.5 flex items-center gap-1 border-t border-[#E6E1D8] pt-2">
                  <button
                    type="button"
                    onClick={() => onTryOnGarment(item)}
                    className="flex-1 min-h-[40px] inline-flex items-center justify-center gap-1 bg-[#141414] px-2 text-xs font-medium text-[#FAF8F5] active:scale-[0.98]"
                  >
                    <Sparkles className="h-3.5 w-3.5" />
                    <span>试穿</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => onEditGarment(item)}
                    className="flex h-[40px] w-[40px] items-center justify-center border border-[#E6E1D8] text-[#141414] hover:bg-[#F2EFE9]"
                    title="裁切抠图与分类编辑"
                    aria-label="裁切抠图与分类编辑"
                  >
                    <Scissors className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => onDeleteGarment(item.id)}
                    className="flex h-[40px] w-[40px] items-center justify-center border border-[#E6E1D8] text-[#6E6A63] hover:text-[#9A3B26]"
                    title="删除单品"
                    aria-label="删除单品"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </div>
            </article>
          ))}
        </div>
      )}

      <input
        ref={cameraRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          if (file) onCaptureOrPickSingle(file);
        }}
      />
      <input
        ref={singleUploadRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          if (file) onCaptureOrPickSingle(file);
        }}
      />
      <input
        ref={batchUploadRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={async (e) => {
          const files = e.target.files;
          if (files && files.length > 0) {
            setIsBusy(true);
            try {
              await onBatchUploadFiles(files, importCategory, autoCutoutOnImport);
            } finally {
              setIsBusy(false);
            }
          }
          e.target.value = '';
        }}
      />
    </div>
  );
};
