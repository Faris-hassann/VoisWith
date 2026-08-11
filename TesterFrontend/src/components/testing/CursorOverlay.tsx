"use client";

import { useEffect, useRef, useState } from "react";
import type { RunProgressEvent } from "@/lib/api/types";

interface ImageRect {
  width: number;
  height: number;
  offsetX: number;
  offsetY: number;
}

export function CursorOverlay({
  frameSrc,
  cursor,
}: {
  frameSrc: string;
  cursor?: RunProgressEvent["liveCursor"];
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const imageRef = useRef<HTMLImageElement>(null);
  const [imageRect, setImageRect] = useState<ImageRect>();

  useEffect(() => {
    const container = containerRef.current;
    const image = imageRef.current;
    if (!container || !image) return;

    const updateRect = () => {
      const naturalWidth = image.naturalWidth;
      const naturalHeight = image.naturalHeight;
      const containerWidth = container.clientWidth;
      const containerHeight = container.clientHeight;
      if (!naturalWidth || !naturalHeight || !containerWidth || !containerHeight) {
        setImageRect(undefined);
        return;
      }
      const scale = Math.min(containerWidth / naturalWidth, containerHeight / naturalHeight);
      const width = naturalWidth * scale;
      const height = naturalHeight * scale;
      setImageRect({
        width,
        height,
        offsetX: (containerWidth - width) / 2,
        offsetY: (containerHeight - height) / 2,
      });
    };

    updateRect();
    const observer = new ResizeObserver(updateRect);
    observer.observe(container);
    image.addEventListener("load", updateRect);
    return () => {
      observer.disconnect();
      image.removeEventListener("load", updateRect);
    };
  }, [frameSrc]);

  const cursorLeft = imageRect && cursor ? imageRect.offsetX + (cursor.x / Math.max(imageRef.current?.naturalWidth ?? 1, 1)) * imageRect.width : undefined;
  const cursorTop = imageRect && cursor ? imageRect.offsetY + (cursor.y / Math.max(imageRef.current?.naturalHeight ?? 1, 1)) * imageRect.height : undefined;

  return (
    <div ref={containerRef} className="relative h-full w-full">
      <img ref={imageRef} src={frameSrc} alt="Live browser frame" className="h-full w-full object-contain" />
      {cursor && imageRect && cursorLeft !== undefined && cursorTop !== undefined ? (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0"
          data-action={cursor.action}
        >
          <div
            data-testid="cursor-dot"
            className="absolute h-5 w-5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-slate-900/90 shadow-[0_0_0_2px_rgba(14,165,233,0.85),0_8px_18px_rgba(15,23,42,0.35)] transition-transform duration-100 ease-out data-[action=click]:scale-110"
            data-action={cursor.action}
            style={{ left: cursorLeft, top: cursorTop }}
          />
          <div
            data-testid="cursor-pulse"
            className="absolute h-8 w-8 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-sky-400/90 opacity-0 transition-all duration-200 ease-out data-[action=click]:scale-110 data-[action=click]:opacity-100 data-[action=scroll]:border-dashed data-[action=scroll]:opacity-100 data-[action=scroll]:scale-110"
            data-action={cursor.action}
            style={{ left: cursorLeft, top: cursorTop }}
          />
        </div>
      ) : null}
    </div>
  );
}
