"use client";

import { useState } from "react";
import type { ProductPreview } from "@/lib/marketplace";

export default function ProductPreviewGallery({
  productName,
  previews,
}: {
  productName: string;
  previews: ProductPreview[];
}) {
  const firstImageIndex = previews.findIndex((preview) => preview.type === "image");
  const [activeIndex, setActiveIndex] = useState(
    firstImageIndex >= 0 ? firstImageIndex : 0,
  );
  const activePreview = previews[activeIndex];

  return (
    <>
      <div className="mt-7 overflow-hidden rounded border border-border bg-white">
        {activePreview?.type === "image" ? (
          <img
            src={activePreview.url}
            alt={activePreview.title || `${productName} preview`}
            fetchPriority="high"
            decoding="async"
            className="aspect-video max-h-[600px] w-full bg-slate-50 object-contain"
          />
        ) : activePreview?.type === "video" ? (
          <video
            key={activePreview.url}
            src={activePreview.url}
            controls
            playsInline
            preload="metadata"
            aria-label={activePreview.title || `${productName} video preview`}
            className="aspect-video w-full bg-black object-contain"
          />
        ) : activePreview ? (
          <div className="grid aspect-video place-items-center bg-slate-50 text-xs text-muted">
            <div className="text-center">
              <p>{activePreview.title || `${productName} · ${activePreview.type}`}</p>
              <a
                href={activePreview.url}
                target="_blank"
                rel="noreferrer"
                className="mt-2 inline-block font-semibold text-primary underline"
              >
                Open preview
              </a>
            </div>
          </div>
        ) : (
          <div className="grid aspect-video place-items-center bg-slate-50 text-xs text-muted">
            No preview assets are available.
          </div>
        )}
      </div>
      {previews.length > 0 && (
        <div className="mt-3 grid grid-cols-3 gap-3 sm:grid-cols-6">
          {previews.map((preview, index) => {
            const isActive = index === activeIndex;
            const label =
              preview.title || `${preview.type} preview ${index + 1}`;
            return (
              <button
                key={`${preview.url}-${index}`}
                type="button"
                onClick={() => setActiveIndex(index)}
                aria-label={`Show ${label}`}
                aria-pressed={isActive}
                className={`block overflow-hidden rounded border bg-slate-50 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${
                  isActive
                    ? "border-primary ring-2 ring-primary/20"
                    : "border-border hover:border-primary/60"
                }`}
              >
                {preview.type === "image" ? (
                  <img
                    src={preview.url}
                    alt={label}
                    loading="lazy"
                    decoding="async"
                    className="aspect-video w-full object-cover"
                  />
                ) : (
                  <span className="grid aspect-video place-items-center px-2 text-center text-[9px] text-primary">
                    {preview.title || preview.type}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}
    </>
  );
}
