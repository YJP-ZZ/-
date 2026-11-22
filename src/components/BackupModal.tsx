import React, { useEffect, useRef, useState } from 'react';
import { Download, HardDrive, ShieldCheck, Upload, X } from 'lucide-react';
import {
  exportFullBackupBlob,
  getStorageSummary,
  importFullBackupFile,
  requestBrowserPersistentStorage,
  type StorageSummary,
} from '../lib/db';

interface BackupModalProps {
  isOpen: boolean;
  modelsCount: number;
  garmentsCount: number;
  outfitsCount: number;
  onClose: () => void;
  onRestoreComplete: (summaryText: string) => Promise<void>;
}

function formatBytes(bytes: number): string {
  if (!bytes || bytes <= 0) return '0 MB';
  const mb = bytes / (1024 * 1024);
  if (mb < 1) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${mb.toFixed(1)} MB`;
}

export const BackupModal: React.FC<BackupModalProps> = ({
  isOpen,
  modelsCount,
  garmentsCount,
  outfitsCount,
  onClose,
  onRestoreComplete,
}) => {
  const [summary, setSummary] = useState<StorageSummary | null>(null);
  const [restoreMode, setRestoreMode] = useState<'merge' | 'replace'>('merge');
  const [isExporting, setIsExporting] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const refreshSummary = async () => {
    const s = await getStorageSummary();
    setSummary(s);
  };

  useEffect(() => {
    if (isOpen) {
      setStatusMessage(null);
      refreshSummary();
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleRequestPersist = async () => {
    const granted = await requestBrowserPersistentStorage();
    await refreshSummary();
    setStatusMessage(
      granted
        ? '已开启浏览器持久化存储保护，系统不会轻易自动清理本应用数据。'
        : '当前浏览器由系统策略自动管理存储空间，建议定期导出离线备份包。'
    );
  };

  const handleExport = async () => {
    setIsExporting(true);
    setStatusMessage(null);
    try {
      const { blob, filename } = await exportFullBackupBlob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 1500);
      await refreshSummary();
      setStatusMessage(`已导出完整衣橱备份文件（${formatBytes(blob.size)}），请妥善保存在手机文件中。`);
    } catch (err) {
      setStatusMessage((err as Error).message || '导出备份失败');
    } finally {
      setIsExporting(false);
    }
  };

  const handleFileSelected = async (file: File) => {
    setIsImporting(true);
    setStatusMessage(null);
    try {
      const res = await importFullBackupFile(file, restoreMode);
      await refreshSummary();
      await onRestoreComplete(
        `恢复完成：${res.modelsCount} 个人像、${res.garmentsCount} 件衣物、${res.outfitsCount} 套造型`
      );
      onClose();
    } catch (err) {
      setStatusMessage((err as Error).message || '备份文件读取失败');
    } finally {
      setIsImporting(false);
    }
  };

  return (
    <div
      onClick={onClose}
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 backdrop-blur-xs"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-[440px] rounded-t-3xl bg-[#FAF8F5] border-t border-x border-[#E6E1D8] p-5 pb-8 max-h-[90dvh] overflow-y-auto pb-safe"
      >
        <div className="mx-auto mb-3 h-1.5 w-10 rounded-full bg-[#D5CFC4]" />
        <header className="flex items-start justify-between gap-4 border-b border-[#E6E1D8] pb-4">
          <div>
            <h3 className="font-display text-2xl font-semibold text-[#141414]">
              数据防丢失与离线备份
            </h3>
            <p className="mt-1 text-xs text-[#6E6A63]">
              防止清理缓存或更换手机导致衣橱丢失 · 试衣草稿已自动实时防丢保存
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-10 w-10 items-center justify-center text-[#6E6A63] hover:text-[#141414]"
            aria-label="关闭"
          >
            <X className="h-5 w-5" />
          </button>
        </header>

        {/* Storage Status Overview */}
        <section className="mt-4 border border-[#E6E1D8] bg-white p-4 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-sm font-medium text-[#141414]">
              <HardDrive className="h-4 w-4" />
              <span>本机离线存储状态</span>
            </div>
            <span className="text-xs text-[#6E6A63] tabular-nums">
              已用 {formatBytes(summary?.usageBytes ?? 0)}
            </span>
          </div>

          <p className="text-xs text-[#6E6A63] tabular-nums">
            当前库存：{modelsCount} 个人像 · {garmentsCount} 件衣物 · {outfitsCount} 套造型
          </p>

          <div className="flex items-center justify-between gap-3 border-t border-[#E6E1D8] pt-3">
            <div className="flex items-center gap-2 text-xs">
              <ShieldCheck
                className={`h-4 w-4 ${summary?.isPersisted ? 'text-[#141414]' : 'text-[#6E6A63]'}`}
              />
              <span className="text-[#141414]">
                {summary?.isPersisted ? '持久化存储保护已开启' : '未锁定持久化存储保护'}
              </span>
            </div>
            {!summary?.isPersisted && (
              <button
                type="button"
                onClick={handleRequestPersist}
                className="min-h-[34px] border border-[#141414] px-3 text-xs font-medium text-[#141414] hover:bg-[#F2EFE9]"
              >
                申请保护
              </button>
            )}
          </div>
        </section>

        {/* Export Backup */}
        <section className="mt-4 border border-[#E6E1D8] bg-white p-4">
          <h4 className="text-sm font-semibold text-[#141414]">1. 导出离线完整备份包</h4>
          <p className="mt-1 text-xs leading-relaxed text-[#6E6A63]">
            将所有人像照片、去背透明衣物与造型册打包为单个 `.atelier.json` 文件保存到手机本地或网盘。
            {summary?.lastBackupAt
              ? ` 上次备份：${new Date(summary.lastBackupAt).toLocaleString('zh-CN')}`
              : ' 建议首次导入衣物后备份一次。'}
          </p>
          <button
            type="button"
            onClick={handleExport}
            disabled={isExporting}
            className="mt-3 w-full min-h-[44px] inline-flex items-center justify-center gap-2 bg-[#141414] text-xs font-medium text-[#FAF8F5] disabled:opacity-40"
          >
            <Download className="h-4 w-4" />
            <span>{isExporting ? '正在打包备份...' : '立即导出离线备份文件'}</span>
          </button>
        </section>

        {/* Restore Backup */}
        <section className="mt-4 border border-[#E6E1D8] bg-white p-4">
          <h4 className="text-sm font-semibold text-[#141414]">2. 从备份文件恢复衣橱</h4>
          <div className="mt-2.5 grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => setRestoreMode('merge')}
              className={`min-h-[38px] border text-xs font-medium ${
                restoreMode === 'merge'
                  ? 'border-[#141414] bg-[#141414] text-[#FAF8F5]'
                  : 'border-[#E6E1D8] bg-[#FAF8F5] text-[#141414]'
              }`}
            >
              合并导入（保留现有）
            </button>
            <button
              type="button"
              onClick={() => setRestoreMode('replace')}
              className={`min-h-[38px] border text-xs font-medium ${
                restoreMode === 'replace'
                  ? 'border-[#9A3B26] bg-[#9A3B26] text-[#FAF8F5]'
                  : 'border-[#E6E1D8] bg-[#FAF8F5] text-[#141414]'
              }`}
            >
              完全覆盖恢复
            </button>
          </div>
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={isImporting}
            className="mt-3 w-full min-h-[44px] inline-flex items-center justify-center gap-2 border border-[#141414] bg-white text-xs font-medium text-[#141414] hover:bg-[#F2EFE9] disabled:opacity-40"
          >
            <Upload className="h-4 w-4" />
            <span>{isImporting ? '正在恢复数据...' : '选择 .atelier.json 备份文件'}</span>
          </button>
        </section>

        {statusMessage && (
          <div className="mt-4 border border-[#E6E1D8] bg-white px-3.5 py-2.5 text-xs text-[#141414]">
            {statusMessage}
          </div>
        )}

        <input
          ref={fileInputRef}
          type="file"
          accept=".json,.atelier.json,application/json"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = '';
            if (file) handleFileSelected(file);
          }}
        />
      </div>
    </div>
  );
};
