"use client";

import Link from "next/link";
import Image from "next/image";
import { useEffect, useState } from "react";
import PublicIcon from "@/components/icons/PublicIcon";
import { addToCart } from "@/lib/cart";
import { routes } from "@/lib/routeController";
import { beginBuyerDownload, failBuyerDownload, finishBuyerDownload, updateBuyerDownload } from "@/lib/buyerDownloads";
import useDebouncedValue from "@/hooks/useDebouncedValue";

type CollectionProduct = {
  id: number;
  orderItemId?: number;
  orderNumber?: string;
  name: string;
  slug: string;
  thumbnailUrl: string | null;
  storeName: string;
  storeSlug: string;
  status: string;
  purchasedAt?: string;
  purchasedVersion?: string | null;
  currentVersion?: string | null;
  updateAvailable?: boolean;
  licenseId?: number | string | null;
  fileCount?: number;
  wishlistId?: number;
  savedAt?: string;
  price?: number;
  currency?: string;
  isFree?: boolean;
  isAvailable?: boolean;
};

type ProductCollectionResponse = {
  products?: CollectionProduct[];
  pagination?: { page: number; totalPages: number; total: number };
};

type CollectionMode = "owned" | "wishlist";

const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:5000/api";

function currencyPrice(value: number, currency = "USD") {
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency }).format(value);
  } catch {
    return `${currency} ${value.toFixed(2)}`;
  }
}

export default function BuyerProductCollection({ mode }: { mode: CollectionMode }) {
  const [products, setProducts] = useState<CollectionProduct[]>([]);
  const [query, setQuery] = useState("");
  const debouncedQuery = useDebouncedValue(query.trim());
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [busyProduct, setBusyProduct] = useState<number | null>(null);
  const [downloadingProduct, setDownloadingProduct] = useState<number | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const isWishlist = mode === "wishlist";
  const title = isWishlist ? "Wishlist" : "My Purchases";

  useEffect(() => {
    if (query.trim() !== debouncedQuery) return;
    const controller = new AbortController();
    const load = async () => {
      setLoading(true);
      setError("");
      try {
        const token = window.localStorage.getItem("marketplace-token") || "";
        const endpoint = isWishlist ? "wishlist" : "products";
        const params = new URLSearchParams({ page: String(page), pageSize: "12" });
        if (debouncedQuery) params.set("search", debouncedQuery);
        const response = await fetch(`${apiUrl}/buyer/${endpoint}?${params}`, {
          headers: { Authorization: `Bearer ${token}` },
          cache: "no-store",
          signal: controller.signal,
        });
        const data = (await response.json()) as ProductCollectionResponse & { error?: string };
        if (!response.ok) throw new Error(data.error || `Unable to load ${title.toLowerCase()}.`);
        setProducts(Array.isArray(data.products) ? data.products : []);
        setTotal(Number(data.pagination?.total || 0));
        setTotalPages(Math.max(1, Number(data.pagination?.totalPages || 1)));
      } catch (requestError) {
        if (controller.signal.aborted) return;
        setError(requestError instanceof Error ? requestError.message : `Unable to load ${title.toLowerCase()}.`);
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    };
    void load();
    return () => {
      controller.abort();
    };
  }, [debouncedQuery, isWishlist, page, query, title]);

  const removeFromWishlist = async (product: CollectionProduct) => {
    if (!window.confirm(`Remove ${product.name} from your wishlist?`)) return;
    setBusyProduct(product.id);
    setError("");
    setNotice("");
    try {
      const token = window.localStorage.getItem("marketplace-token") || "";
      const response = await fetch(`${apiUrl}/buyer/wishlist/${product.id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(data.error || "Unable to remove this wishlist item.");
      const nextProducts = products.filter((item) => item.id !== product.id);
      setProducts(nextProducts);
      setTotal((value) => Math.max(0, value - 1));
      setNotice("Product removed from your wishlist.");
      if (nextProducts.length === 0 && page > 1) setPage((value) => value - 1);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Unable to remove this wishlist item.");
    } finally {
      setBusyProduct(null);
    }
  };

  const downloadProductFiles = async (product: CollectionProduct) => {
    const purchaseKey = product.orderItemId ?? product.id;
    if (!product.licenseId) {
      setError("A license is not available for this purchase yet. Refresh the page or contact support.");
      return;
    }
    setDownloadingProduct(purchaseKey);
    setError("");
    setNotice("");
    const fileName = `${product.name}.zip`;
    const downloadId = beginBuyerDownload(fileName);
    let received = 0;
    try {
      const token = window.localStorage.getItem("marketplace-token") || "";
      if (!token) throw new Error("Please sign in to download this product.");
      const response = await fetch(`${apiUrl}/buyer/licenses/${encodeURIComponent(String(product.licenseId))}/downloads.zip`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || "Unable to download this product.");
      }

      const totalBytes = Number(response.headers.get("Content-Length") || 0);
      const reader = response.body?.getReader();
      if (!reader) {
        throw new Error("The browser could not stream this zip file.");
      }

      const chunks: Uint8Array[] = [];
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        received += value.byteLength;
        updateBuyerDownload(downloadId, fileName, received, totalBytes > 0 ? totalBytes : null);
      }

      const blob = new Blob(chunks, { type: response.headers.get("Content-Type") || "application/zip" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `${product.name.replace(/[\\/:*?"<>|]/g, "-")}.zip`;
      anchor.rel = "noopener";
      anchor.style.display = "none";
      document.body.appendChild(anchor);
      anchor.click();
      document.body.removeChild(anchor);
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      finishBuyerDownload(downloadId, fileName, received);
      setNotice(`${product.name} files are downloading as a ZIP archive.`);
    } catch (downloadError) {
      const message = downloadError instanceof Error ? downloadError.message : "Unable to download this product.";
      failBuyerDownload(downloadId, fileName, received, message);
      setError(message);
    } finally {
      setDownloadingProduct(null);
    }
  };

  return (
    <div className="mx-auto w-full max-w-[1400px]">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-heading sm:text-[28px]">{title}</h1>
          <p className="mt-1 text-sm text-muted">
            {isWishlist
              ? "Keep track of products you may want to purchase."
              : "Browse the digital products you own and see available updates."}
          </p>
        </div>
        <label className="relative w-full sm:max-w-xs">
          <span className="sr-only">Search {title.toLowerCase()}</span>
          <PublicIcon name="search" className="absolute left-3 top-2.5 h-4 w-4 text-muted-soft" />
          <input
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setPage(1);
            }}
            placeholder={`Search ${isWishlist ? "wishlist" : "purchases"}...`}
            className="h-10 w-full rounded-lg border border-border-control bg-white pl-9 pr-3 text-xs outline-none focus:border-primary focus:ring-2 focus:ring-primary/15"
          />
        </label>
      </header>

      {error && <p role="alert" className="mt-4 rounded-lg border border-red-100 bg-red-50 px-4 py-3 text-xs text-status-danger">{error}</p>}
      {notice && <p role="status" className="mt-4 rounded-lg border border-emerald-100 bg-emerald-50 px-4 py-3 text-xs text-status-success">{notice}</p>}
      <div className="mt-4 flex items-center justify-between text-xs text-muted">
        <span>{total} {isWishlist ? "saved products" : "purchases"}</span>
        {isWishlist && <Link href={routes.marketplace()} className="font-semibold text-primary no-underline hover:text-primary-hover">Browse marketplace</Link>}
      </div>

      {loading ? (
        <div className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 6 }, (_, index) => <div key={index} className="h-64 animate-pulse rounded-xl border border-divider bg-white"><div className="h-36 rounded-t-xl bg-slate-100" /><div className="space-y-3 p-4"><div className="h-3 w-2/3 rounded bg-slate-100" /><div className="h-3 w-1/3 rounded bg-slate-100" /></div></div>)}
        </div>
      ) : products.length === 0 ? (
        <div className="mt-5 rounded-xl border border-divider bg-white px-5 py-12 text-center shadow-sm">
          <span className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-orange-50 text-primary"><PublicIcon name={isWishlist ? "heart-plus" : "shopping-cart"} className="h-5 w-5" /></span>
          <h2 className="mt-4 text-base font-semibold text-heading">{isWishlist ? "Your wishlist is empty" : "No purchased products yet"}</h2>
          <p className="mx-auto mt-1 max-w-md text-xs text-muted">
            {isWishlist ? "Save products from the marketplace and they will appear here." : "Products appear here after a payment is verified."}
          </p>
          <Link href={routes.marketplace()} className="mt-4 inline-flex rounded-lg bg-primary px-4 py-2.5 text-xs font-semibold text-white no-underline hover:bg-primary-hover">Browse marketplace</Link>
        </div>
      ) : (
        <>
          <div className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {products.map((product) => {
              const productHref = `/marketplace/${encodeURIComponent(product.storeSlug)}/${encodeURIComponent(product.slug)}`;
              return (
                <article key={product.orderItemId ?? product.id} className="overflow-hidden rounded-xl border border-divider bg-white shadow-sm transition hover:border-primary/30 hover:shadow-md">
                  <Link href={productHref} className="relative block aspect-[16/9] bg-slate-100 no-underline">
                    {product.thumbnailUrl
                      ? <Image src={product.thumbnailUrl} alt={`${product.name} preview`} fill sizes="(max-width: 640px) 100vw, (max-width: 1280px) 50vw, 33vw" unoptimized className="object-cover" />
                      : <span className="grid h-full place-items-center text-xs text-muted-soft">No preview available</span>}
                    {product.updateAvailable && <span className="absolute left-3 top-3 rounded-full bg-emerald-600 px-2.5 py-1 text-[10px] font-semibold text-white">Update available</span>}
                    {isWishlist && !product.isAvailable && <span className="absolute left-3 top-3 rounded-full bg-slate-700 px-2.5 py-1 text-[10px] font-semibold text-white">Unavailable</span>}
                  </Link>
                  <div className="p-4">
                    <Link href={productHref} className="block truncate text-sm font-bold text-heading no-underline hover:text-primary">{product.name}</Link>
                    <Link href={`/marketplace/${encodeURIComponent(product.storeSlug)}`} className="mt-1 block truncate text-xs text-primary no-underline hover:text-primary-hover">by {product.storeName}</Link>
                    {isWishlist ? (
                      <p className="mt-3 text-sm font-semibold text-heading">
                        {product.isAvailable ? product.isFree ? "Free" : currencyPrice(Number(product.price || 0), product.currency) : "Currently unavailable"}
                      </p>
                    ) : (
                      <div className="mt-3 space-y-1 text-[11px] text-muted">
                        <p>Purchased {product.purchasedAt ? new Date(product.purchasedAt).toLocaleDateString() : "date unavailable"}</p>
                        {product.orderNumber && <p>Order {product.orderNumber}</p>}
                        <p>Owned version: {product.purchasedVersion || "Legacy version"}{product.currentVersion ? ` · Latest: ${product.currentVersion}` : ""}</p>
                        <p>{product.fileCount || 0} downloadable file{product.fileCount === 1 ? "" : "s"} in this version</p>
                      </div>
                    )}
                    <div className="mt-4 flex flex-wrap gap-2">
                      {isWishlist ? (
                        <>
                          {product.isAvailable && product.isFree ? (
                            <Link href={productHref} className="inline-flex items-center gap-1 rounded-lg bg-primary px-3 py-2 text-[11px] font-semibold text-white no-underline hover:bg-primary-hover">View product</Link>
                          ) : product.isAvailable ? (
                            <button type="button" onClick={() => { addToCart(String(product.id)); setNotice(`${product.name} added to your cart.`); }} className="inline-flex items-center gap-1 rounded-lg bg-primary px-3 py-2 text-[11px] font-semibold text-white hover:bg-primary-hover"><PublicIcon name="shopping-cart" className="h-3.5 w-3.5" />Add to cart</button>
                          ) : null}
                          <button type="button" disabled={busyProduct === product.id} onClick={() => void removeFromWishlist(product)} className="rounded-lg border border-border-control px-3 py-2 text-[11px] font-semibold text-body hover:border-status-danger hover:text-status-danger disabled:opacity-50">Remove</button>
                        </>
                      ) : (
                        <>
                          {product.fileCount ? (
                            <button
                              type="button"
                              disabled={downloadingProduct === (product.orderItemId ?? product.id)}
                              onClick={() => void downloadProductFiles(product)}
                              className="inline-flex items-center gap-1 rounded-lg bg-primary px-3 py-2 text-[11px] font-semibold text-white hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-50"
                            >
                              <PublicIcon name="download" className="h-3.5 w-3.5" />{downloadingProduct === (product.orderItemId ?? product.id) ? "Preparing ZIP..." : "Download ZIP"}
                            </button>
                          ) : <span className="rounded-lg border border-border-control px-3 py-2 text-[11px] text-muted">No files available</span>}
                          {!product.licenseId && Boolean(product.fileCount) && <p className="w-full text-[10px] text-amber-700">Download access is being restored. Refresh this page in a moment.</p>}
                          {product.updateAvailable && <Link href={routes.buyer.licenses()} className="rounded-lg border border-border-control px-3 py-2 text-[11px] font-semibold text-body no-underline hover:border-primary hover:text-primary">Download update</Link>}
                        </>
                      )}
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
          {totalPages > 1 && <nav aria-label={`${title} pages`} className="mt-5 flex items-center justify-between rounded-xl border border-divider bg-white px-4 py-3 text-xs">
            <span className="text-muted">Page {page} of {totalPages}</span>
            <div className="flex gap-2">
              <button type="button" disabled={page <= 1} onClick={() => setPage((value) => value - 1)} className="rounded-md border border-border-control px-3 py-1.5 font-medium text-body disabled:opacity-40">Previous</button>
              <button type="button" disabled={page >= totalPages} onClick={() => setPage((value) => value + 1)} className="rounded-md border border-border-control px-3 py-1.5 font-medium text-body disabled:opacity-40">Next</button>
            </div>
          </nav>}
        </>
      )}
    </div>
  );
}
