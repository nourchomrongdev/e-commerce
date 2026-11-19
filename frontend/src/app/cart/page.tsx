"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import Navbar from "@/components/Navbar";
import PublicFooter from "@/components/PublicFooter";
import PublicIcon from "@/components/icons/PublicIcon";
import { getCartCount, readCart, removeFromCart, type CartItem } from "@/lib/cart";
import {
  formatLicenseName,
  formatMarketplacePrice,
  getProductsByIds,
  type MarketplaceProduct,
} from "@/lib/marketplace";

type CartDisplayItem = CartItem & { product: MarketplaceProduct | null };

export default function CartPage() {
  const [items, setItems] = useState<CartDisplayItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState("");

  useEffect(() => {
    let active = true;
    async function loadProducts() {
      const cart = readCart();
      if (!cart.length) {
        await Promise.resolve();
        if (active) setIsLoading(false);
        return;
      }

      try {
        const response = await getProductsByIds(cart.map((item) => Number(item.id)));
        if (!active) return;
        const products = new Map((response?.products || []).map((product) => [product.id, product]));
        setItems(cart.map((item) => ({ ...item, product: products.get(Number(item.id)) || null })));
      } catch (error: unknown) {
        if (active) setLoadError(error instanceof Error ? error.message : "Could not load product details.");
      } finally {
        if (active) setIsLoading(false);
      }
    }

    void loadProducts();

    return () => {
      active = false;
    };
  }, []);

  const total = items.reduce((sum, item) => sum + (item.licensePrice ?? item.product?.price ?? 0) * item.quantity, 0);
  const allProductsAvailable = !isLoading && !loadError && items.every((item) => item.product);
  const currencies = new Set(items.flatMap((item) => item.product?.currency ? [item.product.currency.toUpperCase()] : []));
  const hasMixedCurrencies = currencies.size > 1;

  return (
    <div className="min-h-screen bg-[#f7f9fd] text-[#142b4d]">
      <Navbar active="products" />
      <main className="mx-auto max-w-[1120px] px-4 pb-16 pt-8 sm:px-6 lg:px-8">
        <div className="flex items-center gap-2 text-[10px] text-muted">
          <Link href="/marketplace" className="text-primary">Marketplace</Link>
          <span className="text-storefront-blue">/</span>
          <span className="font-medium text-muted">Cart</span>
        </div>
        <div className="mt-5 flex items-end justify-between gap-4">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[.16em] text-primary">Your selection</p>
            <h1 className="mt-1 text-3xl font-extrabold tracking-tight text-heading">Shopping cart</h1>
          </div>
          <span className="text-xs text-muted">{getCartCount(items)} item{getCartCount(items) === 1 ? "" : "s"}</span>
        </div>

        {items.length === 0 ? (
          <section className="mt-6 border border-border bg-white p-10 text-center shadow-sm">
            <PublicIcon name="shopping-cart" className="mx-auto h-9 w-9 text-muted" />
            <h2 className="mt-4 text-lg font-bold text-heading">Your cart is empty</h2>
            <p className="mt-2 text-xs text-muted">Add a digital product to continue to payment.</p>
            <Link href="/marketplace" className="mt-5 inline-flex rounded-md bg-primary px-5 py-3 text-xs font-bold text-white hover:bg-primary-hover">Browse marketplace</Link>
          </section>
        ) : (
          <div className="mt-6 grid gap-5 lg:grid-cols-[minmax(0,1fr)_300px]">
            <section className="border border-border bg-white shadow-sm">
              <div className="border-b border-divider px-5 py-4 text-sm font-bold text-heading">Products</div>
              {isLoading && <p className="px-5 py-4 text-xs text-muted">Loading current product details...</p>}
              {loadError && <p className="px-5 py-4 text-xs text-red-600">{loadError}</p>}
              <div className="divide-y divide-divider">
                {items.map((item) => (
                  <article key={item.id} className="flex items-center gap-4 px-5 py-5">
                    {item.product?.thumbnailUrl ? (
                      <img src={item.product.thumbnailUrl} alt="" className="h-16 w-20 shrink-0 rounded-md object-cover" />
                    ) : (
                      <div className="grid h-16 w-20 shrink-0 place-items-center rounded-md bg-gradient-to-br from-orange-100 via-white to-blue-200 text-[9px] font-bold text-primary">Product</div>
                    )}
                    <div className="min-w-0 flex-1">
                      {item.product ? (
                        <Link href={`/marketplace/${encodeURIComponent(item.product.storeSlug)}/${encodeURIComponent(item.product.slug)}`} className="text-sm font-bold text-heading hover:text-primary">
                          {item.product.name}
                        </Link>
                      ) : (
                        <p className="text-sm font-bold text-heading">{isLoading ? "Loading product..." : "Product unavailable"}</p>
                      )}
                      <p className="mt-1 text-[10px] text-muted">
                        {item.product ? `${item.product.productType}${item.licenseName ? ` · ${formatLicenseName(item.licenseName)}` : ""} · Quantity ${item.quantity}` : "This item is no longer available in the marketplace."}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-bold text-heading">
                        {item.product ? formatMarketplacePrice((item.licensePrice ?? item.product.price) * item.quantity, item.product.currency) : "—"}
                      </p>
                      <button
                        type="button"
                        onClick={() => {
                          removeFromCart(item.id);
                          setItems((current) => current.filter((entry) => entry.id !== item.id));
                        }}
                        className="mt-1 text-[10px] font-semibold text-muted hover:text-primary"
                      >
                        Remove
                      </button>
                    </div>
                  </article>
                ))}
              </div>
            </section>
            <aside className="h-fit border border-border bg-white p-5 shadow-sm">
              <h2 className="text-sm font-bold text-heading">Order summary</h2>
              <div className="mt-5 flex items-center justify-between border-b border-divider pb-4 text-xs text-muted"><span>Subtotal</span><span>{formatMarketplacePrice(total, items.find((item) => item.product)?.product?.currency || "USD")}</span></div>
              <div className="mt-4 flex items-center justify-between text-base font-bold text-heading"><span>Total</span><span>{formatMarketplacePrice(total, items.find((item) => item.product)?.product?.currency || "USD")}</span></div>
              {hasMixedCurrencies && <p className="mt-3 text-[10px] text-red-600">Remove items until all products use the same currency to check out together.</p>}
              <Link aria-disabled={!allProductsAvailable || hasMixedCurrencies} href={allProductsAvailable && !hasMixedCurrencies ? "/cart/payment" : "#"} className={`mt-5 flex h-11 items-center justify-center rounded-md px-4 text-xs font-bold text-white ${allProductsAvailable && !hasMixedCurrencies ? "bg-primary hover:bg-primary-hover" : "cursor-not-allowed bg-slate-400"}`}>Proceed to payment</Link>
              <Link href="/marketplace" className="mt-3 block text-center text-[10px] font-semibold text-primary">Continue shopping</Link>
            </aside>
          </div>
        )}
      </main>
      <PublicFooter />
    </div>
  );
}
