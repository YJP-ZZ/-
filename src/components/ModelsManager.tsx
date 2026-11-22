import React, { useRef } from 'react';
import { Camera, Check, Sparkles, Trash2, Upload } from 'lucide-react';
import type { ModelPortrait } from '../types/wardrobe';
import { BlobImage } from '../hooks/useBlobUrl';

interface ModelsManagerProps {
  models: ModelPortrait[];
  activeModelId: string | null;
  onUploadModel: (file: File) => Promise<void>;
  onSelectForStudio: (id: string) => void;
  onSetDefault: (id: string) => Promise<void>;
  onDeleteModel: (id: string) => Promise<void>;
}

export const ModelsManager: React.FC<ModelsManagerProps> = ({
  models,
  activeModelId,
  onUploadModel,
  onSelectForStudio,
  onSetDefault,
  onDeleteModel,
}) => {
  const cameraRef = useRef<HTMLInputElement | null>(null);
  const uploadRef = useRef<HTMLInputElement | null>(null);

  return (
    <div className="w-full px-3.5 py-4">
      <div className="flex flex-col gap-3.5 border-b border-[#E6E1D8] pb-4">
        <div>
          <h2 className="font-display text-2xl font-semibold tracking-tight text-[#141414]">
            试衣人像底图库
          </h2>
          <p className="mt-1 text-xs text-[#6E6A63]">
            建议拍摄光线均匀、穿着贴身基础款的正面站姿全身照，叠穿更自然
          </p>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => cameraRef.current?.click()}
            className="min-h-[44px] inline-flex items-center justify-center gap-1.5 bg-[#141414] px-4 text-xs font-medium text-[#FAF8F5] active:scale-[0.98] whitespace-nowrap"
          >
            <Camera className="h-4 w-4" />
            <span>拍摄人像</span>
          </button>
          <button
            type="button"
            onClick={() => uploadRef.current?.click()}
            className="min-h-[44px] inline-flex items-center justify-center gap-1.5 border border-[#141414] bg-white px-4 text-xs font-medium text-[#141414] active:scale-[0.98] whitespace-nowrap"
          >
            <Upload className="h-4 w-4" />
            <span>从相册选取</span>
          </button>
        </div>
      </div>

      {models.length === 0 ? (
        <div className="mt-6 border border-[#E6E1D8] bg-white py-14 text-center">
          <p className="font-display text-2xl font-semibold text-[#141414]">暂无人像底图</p>
          <p className="mt-2 text-xs text-[#6E6A63]">拍摄或上传一张全身照即可开始离线试衣</p>
        </div>
      ) : (
        <div className="mt-4 grid grid-cols-2 gap-3">
          {models.map((m) => {
            const isCurrent = m.id === activeModelId;
            return (
              <article
                key={m.id}
                className={`flex flex-col border bg-white transition-colors ${
                  isCurrent ? 'border-[#141414] ring-1 ring-[#141414]' : 'border-[#E6E1D8]'
                }`}
              >
                <button
                  type="button"
                  onClick={() => onSelectForStudio(m.id)}
                  className="aspect-[3/4] w-full overflow-hidden bg-[#F2EFE9]"
                >
                  <BlobImage
                    blob={m.thumbnailBlob}
                    alt={m.name}
                    className="h-full w-full object-cover"
                  />
                </button>

                <div className="flex flex-1 flex-col justify-between border-t border-[#E6E1D8] p-2.5">
                  <div>
                    <h3 className="truncate text-xs font-medium text-[#141414]">
                      {m.name}
                    </h3>
                    <p className="mt-0.5 text-[11px] text-[#6E6A63] tabular-nums">
                      {m.width} × {m.height}
                      {m.isDefault ? ' · 默认' : ''}
                    </p>
                  </div>

                  <div className="mt-2.5 flex items-center gap-1 border-t border-[#E6E1D8] pt-2">
                    <button
                      type="button"
                      onClick={() => onSelectForStudio(m.id)}
                      className="flex-1 min-h-[40px] inline-flex items-center justify-center gap-1 bg-[#141414] px-2 text-xs font-medium text-[#FAF8F5] active:scale-[0.98]"
                    >
                      <Sparkles className="h-3.5 w-3.5" />
                      <span>试衣</span>
                    </button>
                    {!m.isDefault && (
                      <button
                        type="button"
                        onClick={() => onSetDefault(m.id)}
                        className="flex h-[40px] w-[40px] items-center justify-center border border-[#E6E1D8] text-[#141414] hover:bg-[#F2EFE9]"
                        title="设为默认"
                        aria-label="设为默认"
                      >
                        <Check className="h-4 w-4" />
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => onDeleteModel(m.id)}
                      className="flex h-[40px] w-[40px] items-center justify-center border border-[#E6E1D8] text-[#6E6A63] hover:text-[#9A3B26]"
                      title="删除人像"
                      aria-label="删除人像"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}

      <input
        ref={cameraRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={async (e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          if (file) await onUploadModel(file);
        }}
      />
      <input
        ref={uploadRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={async (e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          if (file) await onUploadModel(file);
        }}
      />
    </div>
  );
};
