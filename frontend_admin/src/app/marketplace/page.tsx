"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useState } from "react";
import Navbar from "@/components/Navbar";
import PublicFooter from "@/components/PublicFooter";
import PublicIcon from "@/components/icons/PublicIcon";
import { routes } from "@/lib/routeController";

type MarketplaceProduct = {
  id: number;
  name: string;
  slug: string;
  productType: string;
  categoryName: string;
  storeName: string;
  storeSlug: string;
  price: number;
  currency: string;
  isFree: boolean;
  rating: number | null;
  reviewCount: number;
  thumbnailUrl: string | null;
};

const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:5000/api";

const categories = [
  ["Templates", "245 items", "type", "bg-orange-50 text-primary"],
  ["eBooks", "312 items", "file-search-corner", "bg-blue-50 text-blue-600"],
  ["Courses", "156 items", "verified", "bg-emerald-50 text-emerald-600"],
  ["UI Kits", "189 items", "product", "bg-violet-50 text-violet-600"],
  ["Graphics", "278 items", "view", "bg-pink-50 text-pink-600"],
  ["Themes", "134 items", "store", "bg-teal-50 text-teal-600"],
];

function formatPrice(product: MarketplaceProduct) {
  if (product.isFree) return "Free";
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency: product.currency }).format(product.price);
  } catch {
    return `${product.currency} ${product.price.toFixed(2)}`;
  }
}

export default function MarketplacePage() {
  const [products, setProducts] = useState<MarketplaceProduct[]>([]);
  const [loadingProducts, setLoadingProducts] = useState(true);
  const [productsError, setProductsError] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    const loadProducts = async () => {
      try {
        const response = await fetch(`${apiUrl}/marketplace?sort=best_selling&pageSize=6`, {
          cache: "no-store",
          signal: controller.signal,
        });
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error || "Unable to load marketplace products.");
        setProducts(Array.isArray(payload.products) ? payload.products : []);
      } catch (error) {
        if (controller.signal.aborted) return;
        setProductsError(error instanceof Error ? error.message : "Unable to load marketplace products.");
      } finally {
        if (!controller.signal.aborted) setLoadingProducts(false);
      }
    };
    void loadProducts();
    return () => controller.abort();
  }, []);

  return <div className="min-h-screen bg-[#f8faff]">
    <Navbar active="products" />
    <main className="mx-auto max-w-[1560px] px-4 pb-10 pt-4 sm:px-6 lg:px-8">
      <section className="relative overflow-hidden rounded-2xl border border-orange-100 bg-[radial-gradient(circle_at_76%_40%,#ffbd76_0,transparent_19%),linear-gradient(110deg,#fffdfb_0%,#fff2e7_55%,#ffe2c5_100%)] px-6 py-8 shadow-sm sm:px-10 md:min-h-[300px] md:py-12">
        <div className="relative z-10 max-w-xl">
          <span className="inline-flex items-center gap-1 rounded-full bg-orange-100 px-3 py-1 text-[10px] font-bold text-primary"><PublicIcon name="product" className="h-3.5 w-3.5" />Digital Products Marketplace</span>
          <h1 className="mt-4 text-3xl font-extrabold leading-tight tracking-tight text-heading sm:text-4xl">Discover, Create &amp; Grow<br />with <span className="text-primary">Digital Products</span></h1>
          <p className="mt-3 max-w-md text-sm leading-6 text-muted">Premium templates, eBooks, courses, graphics and more — all in one place. Start your journey today.</p>
          <div className="mt-5 flex flex-wrap gap-3"><a href="#best-sellers" className="inline-flex items-center gap-2 rounded-lg bg-primary px-5 py-3 text-xs font-bold text-white shadow-[0_8px_18px_rgba(245,126,31,.24)] hover:bg-primary-hover">Explore Products <PublicIcon name="arrow-right" className="h-3.5 w-3.5" /></a><Link href={routes.programs.creatorProgram()} className="rounded-lg border border-orange-300 bg-white/80 px-5 py-3 text-xs font-bold text-primary hover:bg-white">Become a Creator</Link></div>
        </div>
        <div aria-hidden="true" className="absolute bottom-0 right-5 hidden h-full w-[47%] min-[800px]:block">
          <div className="absolute bottom-8 right-[25%] h-36 w-56 -rotate-3 rounded-xl border-[7px] border-slate-800 bg-gradient-to-br from-slate-700 to-slate-950 shadow-2xl"><div className="m-5 text-center text-lg font-extrabold tracking-wider text-primary">K</div><div className="mx-5 h-1.5 rounded bg-white/30" /></div>
          <div className="absolute bottom-2 right-[12%] h-14 w-60 rounded-b-3xl bg-slate-400 shadow-xl" />
          {["Ps", "P", "</>", "X"].map((tile, index) => <span key={tile} className={`absolute grid h-14 w-14 place-items-center rounded-xl text-base font-bold text-white shadow-lg ${["right-[55%] top-10 -rotate-6 bg-blue-700", "right-[30%] top-7 rotate-6 bg-orange-500", "right-[7%] top-10 rotate-3 bg-violet-600", "right-[1%] top-[44%] -rotate-6 bg-emerald-600"][index]}`}>{tile}</span>)}
          <div className="absolute bottom-7 right-[1%] h-24 w-28 rotate-6 rounded bg-[#5a261b] shadow-lg" /><div className="absolute bottom-16 right-[4%] h-3 w-36 rotate-6 bg-white/80" />
        </div>
        <div className="relative z-10 mt-7 grid gap-3 border-t border-white/70 pt-4 sm:grid-cols-3 sm:gap-0 sm:pt-3"><Benefit icon="download" title="Instant Download" detail="Get your files right away" /><Benefit icon="lock" title="Secure & Safe" detail="DRM protected purchases" /><Benefit icon="verified" title="Fair & Trusted" detail="Verified creators & reviews" /></div>
      </section>

      <SectionHead title="Categories" link="View all" />
      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">{categories.map(([name, count, icon, style]) => <Link href="#best-sellers" key={name} className="flex items-center gap-3 rounded-xl border border-border bg-white p-3.5 shadow-sm transition hover:-translate-y-0.5 hover:border-orange-200 hover:shadow-md"><span className={`grid h-11 w-11 place-items-center rounded-xl ${style}`}><PublicIcon name={icon} className="h-5 w-5" /></span><span><b className="block text-xs text-heading">{name}</b><small className="mt-1 block text-[10px] text-muted">{count}</small></span><PublicIcon name="right" className="ml-auto h-4 w-4 text-primary" /></Link>)}</section>

      <SectionHead title="Best Sellers" link="View all" />
      <section id="best-sellers" className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        {loadingProducts && Array.from({ length: 6 }, (_, index) => <div key={index} className="h-56 animate-pulse rounded-xl border border-border bg-white" />)}
        {!loadingProducts && productsError && <p role="alert" className="col-span-full rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-xs text-status-danger">{productsError}</p>}
        {!loadingProducts && !productsError && products.map((product) => <Link href={`/marketplace/${encodeURIComponent(product.storeSlug)}/${encodeURIComponent(product.slug)}`} key={product.id} className="group rounded-xl border border-border bg-white p-3 shadow-sm transition hover:-translate-y-1 hover:border-orange-200 hover:shadow-lg">
          <div className="relative aspect-[1.78/1] overflow-hidden rounded-[5px] bg-slate-100">
            {product.thumbnailUrl ? <Image src={product.thumbnailUrl} alt={`${product.name} preview`} fill unoptimized sizes="(max-width: 640px) 100vw, (max-width: 1280px) 50vw, 16vw" className="object-cover" /> : <div className="grid h-full place-items-center text-[10px] text-muted-soft">No preview available</div>}
          </div>
          <span className="mt-3 inline-block rounded-full bg-orange-50 px-2 py-0.5 text-[9px] font-semibold text-primary">{product.categoryName || product.productType}</span>
          <h2 className="mt-1 truncate text-xs font-bold text-heading">{product.name}</h2>
          <p className="mt-1 truncate text-[10px] text-muted">by <span className="font-medium text-primary">{product.storeName}</span></p>
          <div className="mt-2 flex items-end justify-between"><span><b className="text-sm text-heading">{formatPrice(product)}</b><small className="mt-1 block text-[10px] text-amber-500">{product.rating === null ? "No reviews" : <>★ {product.rating.toFixed(1)} <span className="text-muted">({product.reviewCount})</span></>}</small></span><span className="grid h-7 w-7 place-items-center rounded-lg bg-primary text-white"><PublicIcon name="shopping-cart" className="h-3.5 w-3.5" /></span></div>
        </Link>)}
        {!loadingProducts && !productsError && products.length === 0 && <p className="col-span-full py-8 text-center text-xs text-muted">No products are available right now.</p>}
      </section>
    </main>
    <PublicFooter />
  </div>;
}

function Benefit({ icon, title, detail }: { icon: string; title: string; detail: string }) { return <div className="flex items-center gap-3 rounded-lg bg-white/55 px-3 py-2 sm:rounded-none sm:border-r sm:border-orange-100 last:border-0"><span className="grid h-8 w-8 place-items-center rounded-full bg-white text-primary shadow-sm"><PublicIcon name={icon} className="h-4 w-4" /></span><span><b className="block text-[10px] text-heading">{title}</b><small className="block text-[9px] text-muted">{detail}</small></span></div>; }
function SectionHead({ title, link }: { title: string; link: string }) { return <div className="mt-7 mb-3 flex items-center justify-between"><h2 className="border-l-[3px] border-primary pl-2 text-base font-bold text-heading">{title}</h2><a href="#best-sellers" className="inline-flex items-center gap-1 text-[10px] font-bold text-primary">{link}<PublicIcon name="arrow-right" className="h-3 w-3" /></a></div>; }
