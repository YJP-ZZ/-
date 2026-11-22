import React, { useState } from 'react';
import { Download, Share, PlusSquare, X } from 'lucide-react';
import { usePWAInstall } from '../hooks/usePWAInstall';

export const PWAInstallButton: React.FC = () => {
  const { isInstallable, isInstalled, isIOS, install } = usePWAInstall();
  const [showGuide, setShowGuide] = useState(false);

  if (isInstalled) {
    return null;
  }

  if (isInstallable) {
    return (
      <button
        type="button"
        onClick={install}
        className="inline-flex min-h-[40px] items-center gap-1.5 border border-[#141414] bg-[#141414] px-3 py-1.5 text-xs font-medium text-[#FAF8F5] transition-colors hover:bg-[#2c2c2c] whitespace-nowrap shrink-0"
      >
        <Download className="h-3.5 w-3.5" />
        <span>安装到桌面</span>
      </button>
    );
  }

  if (isIOS) {
    return (
      <>
        <button
          type="button"
          onClick={() => setShowGuide(true)}
          className="inline-flex min-h-[40px] items-center gap-1.5 border border-[#141414] bg-transparent px-3 py-1.5 text-xs font-medium text-[#141414] transition-colors hover:bg-[#F2EFE9] whitespace-nowrap shrink-0"
        >
          <Download className="h-3.5 w-3.5" />
          <span>添加到桌面</span>
        </button>

        {showGuide && (
          <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 backdrop-blur-xs">
            <div className="w-full max-w-[440px] rounded-t-3xl bg-[#FAF8F5] border-t border-x border-[#E6E1D8] p-6 pb-8">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h3 className="font-display text-2xl font-semibold text-[#141414]">
                    安装到 iPhone / iPad
                  </h3>
                  <p className="mt-1 text-xs text-[#6E6A63]">
                    离线独立运行，像原生应用一样打开试衣间
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setShowGuide(false)}
                  className="flex h-10 w-10 items-center justify-center text-[#6E6A63] hover:text-[#141414]"
                  aria-label="关闭"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>

              <div className="mt-5 space-y-4 border-t border-[#E6E1D8] pt-4 text-sm text-[#141414]">
                <div className="flex items-start gap-3">
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center border border-[#141414] text-xs font-medium tabular-nums">
                    1
                  </span>
                  <p className="leading-relaxed">
                    点击 Safari 底部或顶部的 <Share className="mx-1 inline h-4 w-4 text-[#9A3B26]" /> <strong>分享</strong> 按钮。
                  </p>
                </div>
                <div className="flex items-start gap-3">
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center border border-[#141414] text-xs font-medium tabular-nums">
                    2
                  </span>
                  <p className="leading-relaxed">
                    向下滑动菜单，轻点 <PlusSquare className="mx-1 inline h-4 w-4 text-[#9A3B26]" /> <strong>添加到主屏幕</strong> 并确认。
                  </p>
                </div>
              </div>

              <button
                type="button"
                onClick={() => setShowGuide(false)}
                className="mt-6 w-full min-h-[44px] bg-[#141414] text-sm font-medium text-[#FAF8F5] transition-colors hover:bg-[#2a2a2a]"
              >
                知道了
              </button>
            </div>
          </div>
        )}
      </>
    );
  }

  return null;
};
