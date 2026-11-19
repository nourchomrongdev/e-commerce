"use client";

import Link from "next/link";
import Image from "next/image";
import { useState } from "react";
import { useRouter } from "next/navigation";
import PublicIcon from "@/components/icons/PublicIcon";
import { Card } from "@/components/ui";
import { addToCart, removeFromCart, setCartItem } from "@/lib/cart";
import { useCartMembership } from "@/hooks/useCartMembership";
import { usePurchaseEligibility } from "@/hooks/usePurchaseEligibility";
import ProductOwnerNotice from "@/components/ProductOwnerNotice";
import WishlistButton from "@/components/WishlistButton";
import ProductLicenseDialog from "@/components/ProductLicenseDialog";
import {
  formatLicenseName,
  formatMarketplacePrice,
  getProduct,
  type ProductDetails,
  type ProductLicense,
  type MarketplaceProduct,
} from "@/lib/marketplace";

export type Item = MarketplaceProduct;

export default function ProductCard({
  item,
}: {
  item: Item;
}) {
  const productId = String(item.id);
  const inCart = useCartMembership(productId);
  const eligibility = usePurchaseEligibility(productId);
  const router = useRouter();
  const [dialogProduct, setDialogProduct] = useState<ProductDetails | null>(null);
  const [loadingDetails, setLoadingDetails] = useState(false);
  const [detailsError, setDetailsError] = useState("");
  const productHref = `/marketplace/${encodeURIComponent(item.storeSlug)}/${encodeURIComponent(item.slug)}`;
  const isOwner = eligibility === "blocked";

  async function handleAddToCart() {
    if (item.isFree) return;
    if (inCart) {
      removeFromCart(productId);
      return;
    }
    if (loadingDetails) return;

    setLoadingDetails(true);
    setDetailsError("");
    try {
      const result = await getProduct(item.storeSlug, item.slug);
      if (!result) throw new Error("This product is no longer available.");
      const { product } = result;
      const licenses = product.licenses.map((license) => {
        const price = license.price > 0
          ? product.discountType === "percentage"
            ? Math.max(license.price * (1 - product.discountAmount / 100), 0)
            : product.discountType === "fixed"
              ? Math.max(license.price - product.discountAmount, 0)
              : license.price
          : product.price;

        return {
          ...license,
          name: formatLicenseName(license.name),
          price: product.isFree ? 0 : price,
        };
      });
      setDialogProduct({ ...product, licenses });
    } catch (error) {
      setDetailsError(
        error instanceof Error ? error.message : "Unable to load product details.",
      );
    } finally {
      setLoadingDetails(false);
    }
  }

  const addSelectedLicense = (license: ProductLicense | null) => {
    addToCart(productId, license, eligibility === "purchased");
    setDialogProduct(null);
  };

  const buySelectedLicense = (license: ProductLicense | null) => {
    setCartItem(productId, license, eligibility === "purchased");
    setDialogProduct(null);
    router.push("/cart/payment");
  };

  return (
    <>
      <Card className="group relative flex min-w-0 flex-col overflow-hidden rounded-xl p-0 transition duration-200 hover:-translate-y-1 hover:border-primary/35 hover:shadow-[0_12px_28px_rgba(17,27,64,0.12)]">
      <div className="absolute right-2 top-2 z-10">
        <WishlistButton productId={productId} productName={item.name} />
      </div>
      <Link href={productHref} className="block min-w-0 flex-1 no-underline">
        <div className="relative aspect-video w-full overflow-hidden rounded-t-xl bg-slate-100">
          {item.thumbnailUrl ? (
            <Image
              src={item.thumbnailUrl}
              alt={`${item.name} preview`}
              fill
              sizes="(max-width: 640px) 100vw, (max-width: 1280px) 50vw, 33vw"
              unoptimized
              className="object-cover"
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
        {isOwner ? (
          <ProductOwnerNotice compact />
        ) : item.isFree ? (
          <Link
            href={productHref}
            aria-label={`View ${item.name}`}
            className="flex h-8 w-full items-center justify-center gap-1 rounded-md bg-primary text-[8px] font-semibold text-white no-underline transition hover:bg-primary-hover"
          >
            View Product
          </Link>
        ) : (
          <>
            <button
              type="button"
              aria-label={
                loadingDetails
                  ? `Loading details for ${item.name}`
                  : inCart
                    ? `Remove ${item.name} from cart`
                    : `${eligibility === "purchased" ? "Buy" : "Add"} ${item.name} ${eligibility === "purchased" ? "again" : "to cart"}`
              }
              aria-busy={loadingDetails}
              disabled={loadingDetails}
              onClick={() => void handleAddToCart()}
              className={`flex h-8 w-full flex-none items-center justify-center gap-1 whitespace-nowrap rounded-md text-[8px] font-semibold text-white shadow-sm transition disabled:cursor-wait disabled:opacity-80 ${inCart ? "bg-emerald-600 hover:bg-red-600" : "bg-primary hover:bg-primary-hover"}`}
            >
              <PublicIcon
                name={loadingDetails ? "clock-9" : inCart ? "x" : "shopping-cart"}
                className="h-3 w-3"
              />
              {loadingDetails
                ? "Loading…"
                : inCart
                  ? "Remove from Cart"
                  : eligibility === "purchased"
                    ? "Buy Again"
                    : "Add to Cart"}
            </button>
            {detailsError && (
              <p role="alert" className="mt-1 text-[9px] text-status-danger">
                {detailsError}
              </p>
            )}
          </>
        )}
      </div>
      </Card>
      {dialogProduct && (
        <ProductLicenseDialog
          id={productId}
          name={dialogProduct.name}
          type={dialogProduct.productType}
          currency={dialogProduct.currency}
          thumbnailUrl={dialogProduct.thumbnailUrl}
          description={dialogProduct.shortDescription || dialogProduct.description}
          version={dialogProduct.currentVersion}
          isPurchased={eligibility === "purchased"}
          licenses={dialogProduct.licenses}
          onClose={() => setDialogProduct(null)}
          onAddToCart={addSelectedLicense}
          onBuyNow={buySelectedLicense}
        />
      )}
    </>
  );
}
