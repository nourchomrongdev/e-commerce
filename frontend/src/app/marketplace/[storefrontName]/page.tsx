import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import Navbar from "@/components/Navbar";
import PublicFooter from "@/components/PublicFooter";
import ProductGrid from "@/components/ProductGrid";
import MarketplaceFilters from "@/components/MarketplaceFilters";
import MarketplaceSearchInput from "@/components/MarketplaceSearchInput";
import { getStorefront, type MarketplaceQuery } from "@/lib/marketplace";

type Props = {
  params: Promise<{ storefrontName: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

function firstParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function storePageHref(
  storeSlug: string,
  page: number,
  values: MarketplaceQuery,
) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) {
    if (key === "page" || key === "pageSize" || value === undefined) continue;
    if (Array.isArray(value)) {
      for (const item of value) {
        if (String(item).trim()) query.append(key, String(item));
      }
    } else if (String(value).trim() && !(key === "sort" && value === "popular")) {
      query.set(key, String(value));
    }
  }
  query.set("page", String(page));
  return `/marketplace/${encodeURIComponent(storeSlug)}?${query.toString()}`;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { storefrontName } = await params;
  const data = await getStorefront(storefrontName);
  return {
    title: data?.store.name ?? "Storefront",
    description: data?.store.description || "Browse products from this creator.",
  };
}

export default async function StorefrontPage({ params, searchParams }: Props) {
  const [{ storefrontName }, query] = await Promise.all([params, searchParams]);
  const search = firstParam(query.search)?.trim() || "";
  const filters: MarketplaceQuery = {
    search,
    category: query.category,
    subcategory: query.subcategory,
    productType: query.productType,
    license: query.license,
    minPrice: firstParam(query.minPrice),
    maxPrice: firstParam(query.maxPrice),
    rating: firstParam(query.rating),
    availability: firstParam(query.availability),
    discounted: firstParam(query.discounted),
    sort: firstParam(query.sort) || "popular",
    page: firstParam(query.page) || "1",
    pageSize: 24,
  };
  const data = await getStorefront(storefrontName, filters);
  if (!data) notFound();

  const { store, products } = data;
  const basePath = `/marketplace/${encodeURIComponent(store.slug)}`;
  const pageCount = Math.ceil(data.total / data.pageSize);

  return (
    <main className="min-h-screen bg-[#f7f9fd] text-[#142b4d]">
      <Navbar active="products" />
      <div className="mx-auto max-w-[1280px] px-4 pb-12 pt-5 sm:px-6 lg:px-8">
        <nav
          aria-label="Breadcrumb"
          className="flex items-center gap-2 text-[10px] text-slate-500"
        >
          <Link href="/marketplace" className="text-primary">
            Marketplace
          </Link>
          <span className="text-storefront-blue">/</span>
          <span aria-current="page" className="font-medium text-muted">
            {store.name}
          </span>
        </nav>

        <section className="mt-5 min-w-0">
          <form
            action={basePath}
            className="mx-auto mb-4 grid w-full max-w-3xl gap-2.5 sm:gap-3"
          >
            {Object.entries(filters).flatMap(([key, value]) =>
              key === "search" || key === "page" || key === "pageSize" || value === undefined
                ? []
                : (Array.isArray(value) ? value : [value]).map((item, index) => (
                    <input
                      key={`${key}-${index}`}
                      type="hidden"
                      name={key}
                      value={String(item)}
                    />
                  )),
            )}
            <div className="flex min-w-0 items-center overflow-visible rounded-xl border-2 border-primary bg-white shadow-sm focus-within:ring-2 focus-within:ring-primary/20">
              <MarketplaceSearchInput
                key={`${store.slug}-${search}`}
                defaultValue={search}
                recommendations={data.products}
                storeSlug={store.slug}
              />
              <button
                type="submit"
                className="h-11 shrink-0 rounded-r-[9px] bg-primary px-4 text-xs font-semibold text-white transition hover:bg-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-white sm:h-12 sm:px-9 sm:text-sm"
              >
                Search
              </button>
            </div>
          </form>
          <div className="mx-auto w-full max-w-3xl">
            <MarketplaceFilters
              key={JSON.stringify(filters)}
              categories={store.categories.map((item) => ({
                value: item.slug,
                label: item.name,
              }))}
              subcategories={[]}
              productTypes={data.filters.productTypes}
              licenses={data.filters.licenseTypes.map((license) => ({
                value: String(license.id),
                label: license.name,
              }))}
              search={search}
              resultCount={data.total}
              basePath={basePath}
            />
          </div>
        </section>

        <section className="relative mt-4 overflow-hidden rounded-md border border-storefront-orange bg-storefront-orange px-6 py-7 text-white shadow-sm sm:px-8">
          {store.bannerUrl && (
            <img
              src={store.bannerUrl}
              alt=""
              fetchPriority="high"
              decoding="async"
              className="absolute inset-0 h-full w-full object-cover opacity-25"
            />
          )}
          <div className="absolute right-0 top-0 h-full w-1/2 bg-white/10" />
          <div className="relative z-10 flex flex-wrap items-center gap-5">
            {store.logoUrl ? (
              <img
                src={store.logoUrl}
                alt={`${store.name} logo`}
                fetchPriority="high"
                decoding="async"
                className="h-20 w-20 shrink-0 rounded-full border-4 border-white/30 object-cover shadow-lg"
              />
            ) : (
              <div className="grid h-20 w-20 shrink-0 place-items-center rounded-full border-4 border-white/30 bg-white/15 text-4xl font-semibold text-white shadow-lg">
                {store.name.slice(0, 1).toUpperCase()}
              </div>
            )}
            <div className="min-w-0">
              <h1 className="text-2xl font-extrabold tracking-tight sm:text-3xl">
                {store.name}
                {store.verified && (
                  <span className="ml-2 text-sm text-white/80" aria-label="Verified creator">
                    ●
                  </span>
                )}
              </h1>
              <p className="mt-1 text-sm text-white/90">
                {store.creatorName}
              </p>
              {store.description && (
                <p className="mt-2 max-w-xl text-xs leading-5 text-white/85">
                  {store.description}
                </p>
              )}
              <div className="mt-3 flex flex-wrap gap-4 text-[10px] text-white/90">
                <span>{store.productCount} Products</span>
                <span>
                  {store.rating === null
                    ? "No reviews"
                    : `★ ${store.rating.toFixed(1)} (${store.reviewCount} reviews)`}
                </span>
                {store.websiteUrl && (
                  <a
                    href={store.websiteUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="text-white underline"
                  >
                    Website
                  </a>
                )}
              </div>
            </div>
          </div>
        </section>

        {store.categories.length > 0 && (
          <nav
            aria-label="Store categories"
            className="mt-5 flex flex-wrap gap-2"
          >
            {store.categories.map((category) => (
              <span
                key={category.slug}
                className="rounded-full border border-[#dce4f0] bg-white px-3 py-1.5 text-[10px] text-slate-600"
              >
                {category.name} · {category.productCount}
              </span>
            ))}
          </nav>
        )}

        <section className="mt-5 min-w-0">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-base font-bold">
              Products <span className="text-slate-500">({data.total})</span>
            </h2>
          </div>
          {products.length ? (
            <ProductGrid
              items={products}
              className="grid grid-cols-2 gap-3 sm:grid-cols-2 xl:grid-cols-4"
            />
          ) : (
            <p className="rounded-xl border border-[#e5ebf4] bg-white p-5 text-xs text-slate-500">
              {store.productCount === 0
                ? "This storefront has no published products yet."
                : "No products match these filters."}
            </p>
          )}
          {pageCount > 1 && (
            <nav
              aria-label="Storefront product pagination"
              className="mt-5 flex items-center justify-center gap-4 text-xs"
            >
              {data.page > 1 ? (
                <Link
                  href={storePageHref(store.slug, data.page - 1, {
                    ...filters,
                  })}
                  className="font-semibold text-primary"
                >
                  Previous
                </Link>
              ) : (
                <span className="text-muted">Previous</span>
              )}
              <span className="text-muted">
                Page {data.page} of {pageCount}
              </span>
              {data.page < pageCount ? (
                <Link
                  href={storePageHref(store.slug, data.page + 1, {
                    ...filters,
                  })}
                  className="font-semibold text-primary"
                >
                  Next
                </Link>
              ) : (
                <span className="text-muted">Next</span>
              )}
            </nav>
          )}
          <div className="mt-3 rounded-xl border border-[#e5ebf4] bg-white p-4 shadow-sm">
            <h2 className="text-xs font-bold">About This Store</h2>
            <p className="mt-2 text-[10px] leading-5 text-slate-500">
              {store.description || "No store description has been provided."}
            </p>
          </div>
          <Link
            href={basePath}
            className="mt-4 inline-block text-[10px] font-semibold text-primary"
          >
            Back to storefront
          </Link>
        </section>
      </div>
      <PublicFooter />
    </main>
  );
}
