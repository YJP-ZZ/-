import React, { useMemo, useState } from 'react';
import { Download, Layers, Trash2, X } from 'lucide-react';
import { getCategoryLabel, type GarmentItem, type SavedOutfit } from '../types/wardrobe';
import { BlobImage } from '../hooks/useBlobUrl';

interface LookbookArchiveProps {
  outfits: SavedOutfit[];
  garments: GarmentItem[];
  onReloadInStudio: (outfit: SavedOutfit) => void;
  onDeleteOutfit: (id: string) => Promise<void>;
  onGoToStudio: () => void;
}

export const LookbookArchive: React.FC<LookbookArchiveProps> = ({
  outfits,
  garments,
  onReloadInStudio,
  onDeleteOutfit,
  onGoToStudio,
}) => {
  const [selectedOutfit, setSelectedOutfit] = useState<SavedOutfit | null>(null);

  const garmentMap = useMemo(() => {
    const map = new Map<string, GarmentItem>();
    for (const g of garments) map.set(g.id, g);
    return map;
  }, [garments]);

  const handleDownloadComposite = (outfit: SavedOutfit) => {
    const url = URL.createObjectURL(outfit.compositeBlob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${outfit.title || 'atelier-look'}.png`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  return (
    <div className="w-full px-3.5 py-4">
      <div className="flex items-end justify-between border-b border-[#E6E1D8] pb-4">
        <div>
          <h2 className="font-display text-2xl font-semibold tracking-tight text-[#141414]">
            私人造型册 Lookbook
          </h2>
          <p className="mt-1 text-xs text-[#6E6A63] tabular-nums">
            已保存 {outfits.length} 套完整搭配 · 支持随时重回试衣间微调
          </p>
        </div>
      </div>

      {outfits.length === 0 ? (
        <div className="mt-6 border border-[#E6E1D8] bg-white py-14 px-4 text-center">
          <h3 className="font-display text-2xl font-semibold text-[#141414]">造型册尚空</h3>
          <p className="mt-2 text-xs text-[#6E6A63]">
            在试衣间将衣物叠穿在人像上并点击「保存造型」，即可在此生成您的专属搭配档案。
          </p>
          <button
            type="button"
            onClick={onGoToStudio}
            className="mt-5 min-h-[44px] bg-[#141414] px-6 text-xs font-medium text-[#FAF8F5]"
          >
            前往试衣间搭配
          </button>
        </div>
      ) : (
        <div className="mt-4 grid grid-cols-2 gap-3">
          {outfits.map((outfit) => (
            <article
              key={outfit.id}
              className="group flex flex-col border border-[#E6E1D8] bg-white transition-colors hover:border-[#141414]"
            >
              <button
                type="button"
                onClick={() => setSelectedOutfit(outfit)}
                className="aspect-[3/4] w-full overflow-hidden bg-[#F2EFE9]"
              >
                <BlobImage
                  blob={outfit.compositeBlob}
                  alt={outfit.title}
                  className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.02]"
                />
              </button>

              <div className="flex flex-1 flex-col justify-between border-t border-[#E6E1D8] p-2.5">
                <div>
                  <h3 className="truncate text-xs font-medium text-[#141414]">
                    {outfit.title}
                  </h3>
                  <p className="mt-0.5 text-[11px] text-[#6E6A63] tabular-nums">
                    {outfit.layers.length} 件 · {new Date(outfit.createdAt).toLocaleDateString('zh-CN')}
                  </p>
                </div>

                <div className="mt-2.5 flex items-center gap-1 border-t border-[#E6E1D8] pt-2">
                  <button
                    type="button"
                    onClick={() => onReloadInStudio(outfit)}
                    className="flex-1 min-h-[40px] bg-[#141414] px-2 text-xs font-medium text-[#FAF8F5] active:scale-[0.98]"
                  >
                    微调
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDownloadComposite(outfit)}
                    className="flex h-[40px] w-[40px] items-center justify-center border border-[#E6E1D8] text-[#141414] hover:bg-[#F2EFE9]"
                    title="保存成品图"
                    aria-label="保存成品图"
                  >
                    <Download className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => onDeleteOutfit(outfit.id)}
                    className="flex h-[40px] w-[40px] items-center justify-center border border-[#E6E1D8] text-[#6E6A63] hover:text-[#9A3B26]"
                    title="删除造型"
                    aria-label="删除造型"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </div>
            </article>
          ))}
        </div>
      )}

      {/* Lookbook Portrait Bottom Sheet */}
      {selectedOutfit && (
        <div
          onClick={() => setSelectedOutfit(null)}
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 backdrop-blur-xs"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="flex max-h-[92dvh] w-full max-w-[440px] flex-col overflow-hidden rounded-t-3xl bg-[#FAF8F5] border-t border-x border-[#E6E1D8] pb-safe"
          >
            <div className="mx-auto mt-2.5 h-1.5 w-10 rounded-full bg-[#D5CFC4]" />
            <header className="flex items-center justify-between border-b border-[#E6E1D8] px-4 py-3">
              <div className="min-w-0">
                <h3 className="font-display text-xl font-semibold truncate text-[#141414]">
                  {selectedOutfit.title}
                </h3>
                <p className="text-xs text-[#6E6A63] tabular-nums">
                  {new Date(selectedOutfit.createdAt).toLocaleString('zh-CN')} ·{' '}
                  {selectedOutfit.layers.length} 件单品
                </p>
              </div>
              <button
                type="button"
                onClick={() => setSelectedOutfit(null)}
                className="flex h-11 w-11 items-center justify-center text-[#6E6A63] hover:text-[#141414]"
                aria-label="关闭"
              >
                <X className="h-5 w-5" />
              </button>
            </header>

            <div className="flex flex-1 flex-col overflow-y-auto">
              <div className="bg-[#F2EFE9] p-3 flex items-center justify-center">
                <BlobImage
                  blob={selectedOutfit.compositeBlob}
                  alt={selectedOutfit.title}
                  className="max-h-[45dvh] w-auto object-contain shadow-sm"
                />
              </div>

              <div className="flex flex-col justify-between p-4 bg-white border-t border-[#E6E1D8]">
                <div>
                  {selectedOutfit.notes && (
                    <div className="mb-3 border-b border-[#E6E1D8] pb-2.5">
                      <div className="text-[11px] text-[#6E6A63]">穿搭笔记</div>
                      <p className="mt-1 text-sm text-[#141414] leading-relaxed">
                        {selectedOutfit.notes}
                      </p>
                    </div>
                  )}

                  <div className="text-xs font-medium text-[#141414] mb-2 flex items-center gap-1.5">
                    <Layers className="h-3.5 w-3.5" />
                    <span>本套包含单品</span>
                  </div>

                  <div className="space-y-2 max-h-[24dvh] overflow-y-auto">
                    {selectedOutfit.layers.map((layer) => {
                      const g = garmentMap.get(layer.garmentId);
                      if (!g) {
                        return (
                          <div
                            key={layer.instanceId}
                            className="border border-[#E6E1D8] p-2 text-xs text-[#6E6A63]"
                          >
                            已从衣橱移除的单品
                          </div>
                        );
                      }
                      return (
                        <div
                          key={layer.instanceId}
                          className="flex items-center gap-3 border border-[#E6E1D8] bg-[#FAF8F5] p-2"
                        >
                          <div className="h-11 w-9 shrink-0 bg-white p-0.5 flex items-center justify-center">
                            <BlobImage
                              blob={g.thumbnailBlob}
                              alt={g.name}
                              className="max-h-full max-w-full object-contain"
                            />
                          </div>
                          <div className="min-w-0">
                            <div className="truncate text-xs font-medium text-[#141414]">
                              {g.name}
                            </div>
                            <div className="text-[11px] text-[#6E6A63]">
                              {getCategoryLabel(g.category)}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                <div className="mt-4 flex flex-col gap-2 border-t border-[#E6E1D8] pt-3">
                  <button
                    type="button"
                    onClick={() => {
                      const target = selectedOutfit;
                      setSelectedOutfit(null);
                      onReloadInStudio(target);
                    }}
                    className="w-full min-h-[44px] bg-[#141414] text-xs font-medium text-[#FAF8F5]"
                  >
                    载入试衣间重新微调
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDownloadComposite(selectedOutfit)}
                    className="w-full min-h-[44px] border border-[#141414] bg-white text-xs font-medium text-[#141414]"
                  >
                    下载高清合成照片
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
