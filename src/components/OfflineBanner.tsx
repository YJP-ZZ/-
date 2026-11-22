import React from 'react';
import { WifiOff } from 'lucide-react';
import { useOnlineStatus } from '../hooks/useOnlineStatus';

export const OfflineBanner: React.FC = () => {
  const isOnline = useOnlineStatus();

  if (isOnline) return null;

  return (
    <div
      role="status"
      className="flex items-center justify-center gap-2 border-b border-[#E6E1D8] bg-[#141414] px-4 py-1.5 text-xs text-[#FAF8F5]"
    >
      <WifiOff className="h-3.5 w-3.5 text-[#FAF8F5]" />
      <span>当前处于离线模式 · 试衣间与本地衣橱数据均可正常使用</span>
    </div>
  );
};
