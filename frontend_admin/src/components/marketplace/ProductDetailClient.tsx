"use client";

import Link from "next/link";
import Image from "next/image";
import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import PublicIcon from "@/components/icons/PublicIcon";
import { useToast } from "@/components/ui/GlobalToastProvider";

type ProductReview = {
  id: number;
  rating: number;
  title: string;
  comment: string;
  verifiedPurchase: boolean;
  createdAt: string;
  creatorResponse: string | null;
  customerName: string;
  customerAvatarUrl: string | null;
};

type ProductDetail = {
  id: number;
  name: string;
  slug: string;
  storeName: string;
  storeSlug: string;
  productType: string;
  categoryName: string;
  shortDescription: string;
  description: string;
  isFree: boolean;
  price: number;
  currency: string;
  rating: number | null;
  reviewCount: number;
  salesCount: number;
  thumbnailUrl: string | null;
  previews: Array<{ url: string; title: string }>;
  ratingDistribution: Array<{ rating: number; count: number }>;
  reviews: ProductReview[];
};

type ReviewEligibility = { eligible: boolean; hasPurchased: boolean; hasReviewed: boolean; reviewStatus: string | null };
const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:5000/api";

const previews = [
  { label: "Cover", tone: "from-sky-950 via-blue-900 to-cyan-500" },
  { label: "Principles", tone: "from-orange-100 via-white to-orange-300" },
  { label: "Systems", tone: "from-violet-100 via-white to-indigo-300" },
  { label: "Toolkit", tone: "from-emerald-100 via-white to-sky-300" },
  { label: "Bonus", tone: "from-slate-900 via-slate-700 to-orange-400" },
];

export default function ProductDetailClient({ storefront, productSlug }: { storefront: string; productSlug: string }) {
  const router = useRouter();
  const toast = useToast();
  const [selectedPreview, setSelectedPreview] = useState(0);
  const [quantity, setQuantity] = useState(1);
  const [wishlisted, setWishlisted] = useState(false);
  const [activeTab, setActiveTab] = useState("Description");
  const [notice, setNotice] = useState("");
  const [review, setReview] = useState("");
  const [product, setProduct] = useState<ProductDetail | null>(null);
  const [loadError, setLoadError] = useState("");
  const [eligibility, setEligibility] = useState<ReviewEligibility | null>(null);
  const [reviewTitle, setReviewTitle] = useState("");
  const [rating, setRating] = useState(5);
  const [reviewBusy, setReviewBusy] = useState(false);
  const [freeAccessBusy, setFreeAccessBusy] = useState(false);
  const isFree = product?.isFree ?? false;
  const title = product?.name || productSlug.split("-").map((word) => word[0]?.toUpperCase() + word.slice(1)).join(" ");
  const currentPreviews = product?.previews.length ? product.previews.slice(0, 5) : previews.map((preview) => ({ title: preview.label, url: "" }));
  const selectedProductPreview = currentPreviews[selectedPreview] || currentPreviews[0];
  const selectedPreviewLabel = selectedProductPreview?.title || "Preview";

  useEffect(() => {
    const controller = new AbortController();
    const loadProduct = async () => {
      try {
        const response = await fetch(`${apiUrl}/marketplace/${encodeURIComponent(storefront)}/${encodeURIComponent(productSlug)}`, {
          cache: "no-store",
          signal: controller.signal,
        });
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error || "Unable to load this product.");
        setProduct(payload.product as ProductDetail);
        setLoadError("");
      } catch (error) {
        if (controller.signal.aborted) return;
        setLoadError(error instanceof Error ? error.message : "Unable to load this product.");
      }
    };
    void loadProduct();
    return () => controller.abort();
  }, [productSlug, storefront]);

  useEffect(() => {
    if (!product || !window.localStorage.getItem("marketplace-token")) return;
    const controller = new AbortController();
    const loadEligibility = async () => {
      try {
        const token = window.localStorage.getItem("marketplace-token") || "";
        const response = await fetch(`${apiUrl}/buyer/products/${product.id}/review-eligibility`, {
          headers: { Authorization: `Bearer ${token}` },
          cache: "no-store",
          signal: controller.signal,
        });
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error || "Unable to check review eligibility.");
        setEligibility(payload as ReviewEligibility);
      } catch (error) {
        if (!controller.signal.aborted) toast.error(error instanceof Error ? error.message : "Unable to check review eligibility.");
      }
    };
    void loadEligibility();
    return () => controller.abort();
  }, [product, toast]);

  function showNotice(message: string) {
    setNotice(message);
    window.setTimeout(() => setNotice(""), 2200);
  }

  function addToCart() {
    showNotice(`${quantity} item${quantity === 1 ? "" : "s"} added to cart`);
  }

  async function submitReview(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!product || !eligibility?.eligible || !review.trim() || reviewBusy) return;
    setReviewBusy(true);
    try {
      const token = window.localStorage.getItem("marketplace-token") || "";
      const response = await fetch(`${apiUrl}/buyer/reviews`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ productId: product.id, rating, title: reviewTitle.trim(), comment: review.trim() }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Unable to submit your review.");
      setEligibility({ eligible: false, hasPurchased: true, hasReviewed: true, reviewStatus: "pending" });
      setReviewTitle("");
      setReview("");
      toast.success("Your review was submitted for moderation.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to submit your review.");
    } finally {
      setReviewBusy(false);
    }
  }

  async function getFreeAccess() {
    if (!product || freeAccessBusy) return;
    const token = window.localStorage.getItem("marketplace-token");
    if (!token) {
      router.push("/login");
      return;
    }
    setFreeAccessBusy(true);
    try {
      const response = await fetch(`${apiUrl}/orders/free`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ productId: product.id }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Unable to get free access.");
      router.push("/buyer/downloads");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to get free access.");
    } finally {
      setFreeAccessBusy(false);
    }
  }

  async function copyLink() {
    try {
      await navigator.clipboard?.writeText(window.location.href);
      showNotice("Product link copied");
    } catch {
      showNotice("Unable to copy the product link");
    }
  }

  if (loadError) return <main className="mx-auto max-w-[1560px] px-4 py-10 text-sm text-status-danger" role="alert">{loadError}</main>;
  if (!product) return <main className="mx-auto max-w-[1560px] px-4 py-10 text-sm text-muted" role="status">Loading product…</main>;

  return (
    <main className="mx-auto max-w-[1560px] px-4 pb-12 pt-5 sm:px-6 lg:px-8">
      <div className="flex flex-wrap items-center gap-2 text-[10px] text-muted">
        <Link href="/marketplace" className="text-primary hover:underline">Marketplace</Link><span className="text-storefront-blue">/</span>
        <Link href={`/marketplace/${encodeURIComponent(product.storeSlug)}`} className="text-primary hover:underline">{product.storeName}</Link><span className="text-storefront-blue">/</span>
        <span className="font-medium text-muted" aria-current="page">{title}</span>
      </div>

      <div className="mt-5 grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(320px,380px)]">
        <section className="order-2 min-w-0 lg:col-span-2">
          <div className="rounded-xl border border-border bg-white p-3 shadow-sm">
            <div className={`relative grid aspect-[1.65/1] place-items-center overflow-hidden rounded-lg bg-gradient-to-br ${previews[selectedPreview % previews.length].tone} p-6 sm:p-10`}>
              <div className="absolute -right-10 -top-12 h-44 w-44 rounded-full bg-white/20" />
              <div className="relative aspect-[1.4/1] w-[74%] max-w-[500px] rotate-[-2deg] overflow-hidden rounded-md bg-white shadow-2xl">
                {(selectedProductPreview?.url || product.thumbnailUrl) ? <Image src={selectedProductPreview?.url || product.thumbnailUrl || ""} alt={`${product.name} preview`} fill unoptimized className="object-cover" /> : <div className="grid h-full place-items-center p-5 text-center sm:p-8"><div><span className="text-[10px] font-bold tracking-[.18em] text-primary">{product.storeName}</span><h1 className="mt-5 text-3xl font-extrabold leading-none text-heading sm:text-5xl">{product.name}</h1><p className="mt-4 line-clamp-4 text-[10px] leading-5 text-muted sm:text-xs">{product.shortDescription || product.description}</p></div></div>}
              </div>
              <span className="absolute bottom-5 left-5 rounded bg-white/85 px-2 py-1 text-[9px] font-semibold text-heading shadow-sm">{selectedPreviewLabel} preview</span>
            </div>
            <div className="mt-3 grid grid-cols-5 gap-2">
              {currentPreviews.map((preview, index) => <button type="button" key={`${preview.title}-${index}`} onClick={() => setSelectedPreview(index)} aria-label={`Show ${preview.title || "product"} preview`} className={`relative grid aspect-[1.35/1] place-items-center overflow-hidden rounded-md bg-gradient-to-br ${previews[index % previews.length].tone} ${selectedPreview === index ? "ring-2 ring-primary ring-offset-1" : "opacity-75 hover:opacity-100"}`}>{preview.url ? <Image src={preview.url} alt="" fill unoptimized className="object-cover" /> : <span className="text-[8px] font-bold text-heading">{preview.title}</span>}</button>)}
            </div>
          </div>

          <section className="mt-5 rounded-xl border border-border bg-white p-5 shadow-sm">
            <div className="flex flex-wrap gap-5 border-b border-divider text-xs font-semibold">
              {["Description", `Reviews (${product.reviewCount})`].map((tab) => <button type="button" key={tab} onClick={() => setActiveTab(tab.startsWith("Reviews") ? "Reviews" : tab)} className={`pb-3 ${(activeTab === "Reviews" ? tab.startsWith("Reviews") : activeTab === tab) ? "border-b-2 border-primary text-primary" : "text-muted hover:text-primary"}`}>{tab}</button>)}
            </div>
            {activeTab === "Description" && <div className="mt-5"><h2 className="text-sm font-bold text-heading">About this product</h2><p className="mt-3 whitespace-pre-wrap text-xs leading-6 text-muted">{product.description || product.shortDescription || "No description provided."}</p></div>}
            {activeTab === "Reviews" && <div className="mt-5 space-y-3">
              {product.reviews.length ? product.reviews.map((item) => <article key={item.id} className="rounded-lg bg-surface-muted p-4">
                <div className="flex items-center gap-2">
                  <span className="grid h-8 w-8 shrink-0 place-items-center overflow-hidden rounded-full bg-primary/10 text-[10px] font-bold text-primary">
                    {item.customerAvatarUrl ? <Image src={item.customerAvatarUrl} alt="" width={32} height={32} unoptimized className="h-full w-full object-cover" /> : item.customerName.split(/\s+/).map((part) => part[0]).slice(0, 2).join("").toUpperCase()}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-[10px] font-semibold text-heading">{item.customerName}</span>
                  <span className="text-[10px] text-amber-500" aria-label={`${item.rating} out of 5 stars`}>{"★".repeat(item.rating)}{"☆".repeat(5 - item.rating)}</span>
                </div>
                {item.title && <h3 className="mt-2 text-xs font-semibold text-heading">{item.title}</h3>}
                <p className="mt-1 whitespace-pre-wrap text-xs leading-5 text-muted">{item.comment}</p>
                {item.creatorResponse && <div className="mt-3 rounded-md bg-white p-3"><p className="text-[9px] font-semibold text-heading">Creator response</p><p className="mt-1 whitespace-pre-wrap text-[10px] leading-4 text-muted">{item.creatorResponse}</p></div>}
                <small className="mt-2 block text-[9px] text-muted">{item.verifiedPurchase ? "Verified purchase · " : ""}{new Date(item.createdAt).toLocaleDateString()}</small>
              </article>) : <p className="rounded-lg bg-surface-muted p-4 text-xs text-muted">No approved reviews yet.</p>}
            </div>}
          </section>

          <section className="mt-5 flex items-center justify-between rounded-lg border border-border bg-white p-4"><h2 className="text-xs font-bold text-heading">More from {product.storeName}</h2><Link href={`/marketplace/${encodeURIComponent(product.storeSlug)}`} className="text-[10px] font-semibold text-primary">View store &rarr;</Link></section>

          <section className="mt-6 rounded-xl border border-border bg-white p-5 shadow-sm">
            <div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="text-sm font-bold text-heading">Customer reviews</h2><p className="mt-1 text-[10px] text-muted">What buyers say about this product</p></div><span className="text-lg text-amber-500">{product.rating === null ? "No reviews" : <><span aria-label={`${Math.round(product.rating)} out of 5 stars`}>{"★".repeat(Math.round(product.rating))}{"☆".repeat(5 - Math.round(product.rating))}</span> <b className="ml-1 text-xs text-heading">{product.rating.toFixed(1)}</b></>}</span></div>
            <div className="mt-5 grid gap-4 border-y border-divider py-4 sm:grid-cols-[150px_1fr]"><div className="text-center"><b className="block text-3xl text-heading">{product.rating === null ? "—" : product.rating.toFixed(1)}</b><span className="text-sm text-amber-500">{product.rating === null ? "☆☆☆☆☆" : "★".repeat(Math.round(product.rating)) + "☆".repeat(5 - Math.round(product.rating))}</span><small className="mt-1 block text-[9px] text-muted">{product.reviewCount} approved reviews</small></div><div className="space-y-2 text-[9px] text-muted">{[5, 4, 3, 2, 1].map((stars) => { const count = product.ratingDistribution.find((entry) => entry.rating === stars)?.count ?? 0; const width = product.reviewCount ? Math.round(count / product.reviewCount * 100) : 0; return <div className="flex items-center gap-2" key={stars}><span>{stars} star</span><span className="h-1.5 flex-1 rounded-full bg-surface-control"><span className="block h-full rounded-full bg-amber-400" style={{ width: `${width}%` }} /></span><span>{count}</span></div> })}</div></div>
            {eligibility?.eligible ? <form onSubmit={(event) => void submitReview(event)} className="mt-4 space-y-2">
              <p className="text-[10px] font-semibold text-emerald-700">Verified purchase confirmed</p>
              <div className="flex items-center gap-1" role="radiogroup" aria-label="Review rating">{[1, 2, 3, 4, 5].map((value) => <button key={value} type="button" role="radio" aria-checked={rating === value} aria-label={`${value} star${value === 1 ? "" : "s"}`} onClick={() => setRating(value)} className={`text-xl ${value <= rating ? "text-amber-500" : "text-slate-300"}`}>★</button>)}</div>
              <input value={reviewTitle} onChange={(event) => setReviewTitle(event.target.value)} maxLength={255} placeholder="Review title (optional)" className="w-full rounded-lg border border-border px-3 py-2 text-xs outline-none focus:border-primary" />
              <textarea required value={review} onChange={(event) => setReview(event.target.value)} maxLength={5000} rows={4} placeholder="Share what you liked and how the product worked for you." className="w-full rounded-lg border border-border px-3 py-2 text-xs outline-none focus:border-primary" />
              <div className="flex items-center justify-between gap-3"><span className="text-[9px] text-muted">{review.length.toLocaleString()} / 5,000</span><button type="submit" disabled={reviewBusy || !review.trim()} className="rounded-lg bg-primary px-4 py-2 text-xs font-semibold text-white disabled:opacity-50">{reviewBusy ? "Submitting…" : "Post review"}</button></div>
            </form> : eligibility?.hasReviewed ? <p className="mt-4 text-[10px] text-muted">You have already reviewed this product. Current review status: <b className="capitalize text-heading">{eligibility.reviewStatus || "submitted"}</b>.</p> : <p className="mt-4 text-[10px] text-muted">Sign in and purchase this product to submit a verified review.</p>}
          </section>
        </section>

        <aside className="order-1 min-w-0 lg:col-span-2 xl:pt-2">
          <div className="flex items-start justify-between gap-3"><div><span className="rounded-full bg-accent-light px-3 py-1 text-[10px] font-semibold text-primary">{product.categoryName || product.productType}</span><h2 className="mt-4 text-3xl font-extrabold tracking-tight text-heading">{title}</h2></div><button type="button" aria-label={wishlisted ? "Remove from wishlist" : "Add to wishlist"} onClick={() => setWishlisted(!wishlisted)} className={`grid h-10 w-10 shrink-0 place-items-center rounded-lg border border-border bg-white text-xl ${wishlisted ? "text-primary" : "text-muted"}`}>{wishlisted ? "♥" : "♡"}</button></div>
          <p className="mt-3 text-sm leading-6 text-muted">{product.shortDescription || product.description}</p>
          <p className="mt-4 text-sm text-amber-500">{product.rating === null ? "☆☆☆☆☆" : "★".repeat(Math.round(product.rating)) + "☆".repeat(5 - Math.round(product.rating))} <b className="ml-2 text-heading">{product.rating === null ? "No rating" : product.rating.toFixed(1)}</b> <span className="text-muted">({product.reviewCount} reviews) | {product.salesCount} sold</span></p>
          <div className="mt-5 flex items-center gap-3"><b className="text-4xl text-heading">{isFree ? "Free" : new Intl.NumberFormat(undefined, { style: "currency", currency: product.currency }).format(product.price)}</b></div>
          <div className="mt-5 flex flex-wrap gap-2"><span className="rounded-full bg-surface-control px-3 py-2 text-[10px] text-muted">{product.productType}</span><span className="rounded-full bg-surface-control px-3 py-2 text-[10px] text-muted">{product.categoryName}</span></div>
          {!isFree && <><p className="mt-6 text-xs font-bold text-heading">Quantity</p><div className="mt-2 flex w-32 overflow-hidden rounded-lg border border-border bg-white"><button type="button" aria-label="Decrease quantity" onClick={() => setQuantity(Math.max(1, quantity - 1))} className="w-10 border-r border-border py-2 text-muted hover:text-primary">-</button><span className="flex-1 py-2 text-center text-xs font-bold text-heading">{quantity}</span><button type="button" aria-label="Increase quantity" onClick={() => setQuantity(quantity + 1)} className="w-10 border-l border-border py-2 text-muted hover:text-primary">+</button></div></>}
          {isFree ? <><button type="button" disabled={freeAccessBusy || eligibility?.hasPurchased} onClick={() => void getFreeAccess()} className="mt-5 flex w-full items-center justify-center gap-2 rounded-lg bg-primary px-4 py-3.5 text-xs font-bold text-white shadow-sm hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-60"><PublicIcon name={eligibility?.hasPurchased ? "check" : "download"} className="h-4 w-4" />{eligibility?.hasPurchased ? "Already owned" : freeAccessBusy ? "Getting access…" : "Free Download"}</button>{eligibility?.hasPurchased && <p className="mt-2 text-center text-[10px] text-muted">You already have this product. <Link href="/buyer/downloads" className="font-semibold text-primary">Go to My Downloads</Link></p>}</> : <div className="mt-5 grid gap-3 sm:grid-cols-2"><button type="button" onClick={addToCart} className="flex items-center justify-center gap-2 rounded-lg bg-primary px-4 py-3.5 text-xs font-bold text-white shadow-sm hover:bg-primary-hover"><PublicIcon name="shopping-cart" className="h-4 w-4" />Add to Cart</button><button type="button" onClick={() => showNotice("Checkout is ready to start")} className="rounded-lg border border-orange-300 px-4 py-3.5 text-xs font-bold text-primary hover:bg-accent-light">Buy Now</button></div>}
          <div className="mt-5 grid grid-cols-3 gap-2 border-t border-divider pt-5 text-center"><TrustItem icon="download" title="Instant Download" /><TrustItem icon="credit-card" title="Secure Payment" /><TrustItem icon="help" title="24/7 Support" /></div>
          <div className="mt-5 rounded-lg bg-accent-light p-3 text-[10px] text-muted"><b className="text-primary">Digital product</b><p className="mt-1">Your files are available immediately after a successful payment.</p></div>
          <button type="button" onClick={copyLink} className="mt-4 flex items-center gap-2 text-[10px] font-semibold text-muted hover:text-primary"><PublicIcon name="link" className="h-3 w-3" />Share this product</button>
        </aside>

        <aside className="hidden"><div className="rounded-xl border border-border bg-white p-3 shadow-sm"><h2 className="border-l-2 border-primary pl-2 text-xs font-bold text-heading">Trending products</h2></div></aside>
      </div>
      {notice && <div role="status" className="fixed bottom-5 left-1/2 z-50 -translate-x-1/2 rounded-lg bg-heading px-4 py-3 text-xs font-semibold text-white shadow-lg">{notice}</div>}
    </main>
  );
}

function TrustItem({ icon, title }: { icon: string; title: string }) { return <div><PublicIcon name={icon} className="mx-auto h-4 w-4 text-primary" /><b className="mt-1 block text-[9px] text-heading">{title}</b><small className="text-[8px] text-muted">Available anytime</small></div>; }
