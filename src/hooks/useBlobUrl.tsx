import { useEffect, useState } from 'react';

export function useBlobUrl(blob: Blob | null | undefined): string | null {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!blob) {
      setUrl(null);
      return;
    }
    const objectUrl = URL.createObjectURL(blob);
    setUrl(objectUrl);
    return () => {
      URL.revokeObjectURL(objectUrl);
    };
  }, [blob]);

  return url;
}

export function BlobImage({
  blob,
  alt,
  className,
  draggable = false,
}: {
  blob: Blob | null | undefined;
  alt: string;
  className?: string;
  draggable?: boolean;
}) {
  const url = useBlobUrl(blob);
  if (!url) {
    return (
      <div
        className={`flex items-center justify-center bg-[#F2EFE9] text-[#6E6A63] text-xs ${className ?? ''}`}
        aria-label={alt}
      >
        加载中
      </div>
    );
  }
  return (
    <img
      src={url}
      alt={alt}
      className={className}
      draggable={draggable}
      referrerPolicy="no-referrer"
    />
  );
}
