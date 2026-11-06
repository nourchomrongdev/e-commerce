"use client";

import Link from "next/link";
import { useState } from "react";
import PublicIcon from "@/components/icons/PublicIcon";
import { Card } from "@/components/ui";
import { addToCart } from "@/lib/cart";
import {
  formatMarketplacePrice,
  type MarketplaceProduct,
} from "@/lib/marketplace";

export type Item = MarketplaceProduct;

export default function ProductCard({
  item,
}: {
  item: Item;
}) {
  const [added, setAdded] = useState(false);
  const productHref = `/marketplace/${encodeURIComponent(item.storeSlug)}/${encodeURIComponent(item.slug)}`;

  function handleAddToCart() {
    if (item.isFree) return;
    addToCart({
      id: String(item.id),
      name: item.name,
      type: item.productType,
      price: formatMarketplacePrice(item.price, item.currency),
      href: productHref,
    });
    setAdded(true);
    window.setTimeout(() => setAdded(false), 1600);
  }

  return (
    <Card className="group relative flex min-w-0 flex-col overflow-hidden rounded-xl p-0 transition duration-200 hover:-translate-y-1 hover:border-primary/35 hover:shadow-[0_12px_28px_rgba(17,27,64,0.12)]">
      <Link href={productHref} className="block min-w-0 flex-1 no-underline">
        <div className="relative aspect-video w-full overflow-hidden rounded-t-xl bg-slate-100">
          {item.thumbnailUrl ? (
            <img
              src={item.thumbnailUrl}
              alt={`${item.name} preview`}
              loading="lazy"
              decoding="async"
              className="h-full w-full object-cover"
            />
          ) : (
            <div className="grid h-full place-items-center text-[10px] text-slate-400">
              No preview available
            </div>
          )}
        </div>
        <div className="min-w-0 px-3 pt-2.5">
          <strong className="block truncate text-[11px] font-bold text-slate-900">
            {item.name}
          </strong>
          <span className="mt-0.5 flex items-center gap-1 truncate text-[8px] text-slate-500">
            <span>{item.categoryName}</span>
            {item.isFree && (
              <b className="rounded bg-accent-light px-1.5 py-0.5 text-[8px] font-semibold text-primary">
                Free
              </b>
            )}
          </span>
        </div>
      </Link>
      <div className="px-3">
        <Link
          href={`/marketplace/${encodeURIComponent(item.storeSlug)}`}
          className="mt-1 block truncate text-[9px] font-semibold text-primary no-underline hover:text-primary-hover"
        >
          by {item.storeName}
        </Link>
        <Link href={productHref} className="block no-underline">
          <div className="mt-2 flex items-end justify-between gap-2">
            <span>
              <b
                className={`block text-sm ${item.isFree ? "text-primary" : "text-slate-900"}`}
              >
                {item.isFree
                  ? "Free"
                  : formatMarketplacePrice(item.price, item.currency)}
              </b>
              <small className="mt-0.5 block text-[8px] text-amber-500">
                {item.rating === null
                  ? "No reviews"
                  : `★ ${item.rating.toFixed(1)} `}
                {item.rating !== null && (
                  <span className="text-slate-400">
                    ({item.reviewCount})
                  </span>
                )}
              </small>
            </span>
          </div>
        </Link>
      </div>
      <div className="mt-2.5 px-3 pb-3">
        {item.isFree ? (
          <Link
            href={productHref}
            aria-label={`View ${item.name}`}
            className="flex h-8 w-full items-center justify-center gap-1 rounded-md bg-primary text-[8px] font-semibold text-white no-underline transition hover:bg-primary-hover"
          >
            View Product
          </Link>
        ) : (
          <button
            type="button"
            aria-label={`Add ${item.name} to cart`}
            onClick={handleAddToCart}
            className={`flex h-8 w-full items-center justify-center gap-1 rounded-md text-[8px] font-semibold text-white shadow-sm transition ${added ? "bg-emerald-500" : "bg-primary hover:bg-primary-hover"}`}
          >
            <PublicIcon
              key={added ? "added" : "cart"}
              name={added ? "check" : "shopping-cart"}
              className={`h-3 w-3 ${added ? "animate-bounce" : ""}`}
            />
            {added ? "Added" : "Add to Cart"}
          </button>
        )}
      </div>
    </Card>
  );
}
