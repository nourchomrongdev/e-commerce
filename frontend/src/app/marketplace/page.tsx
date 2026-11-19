import Link from "next/link";
import Navbar from "@/components/Navbar";
import PublicFooter from "@/components/PublicFooter";
import ProductGrid from "@/components/ProductGrid";
import MarketplaceSearchInput from "@/components/MarketplaceSearchInput";
import MarketplaceFilters from "@/components/MarketplaceFilters";
import MarketplaceToolbar from "@/components/MarketplaceToolbar";
import type { Metadata } from "next";
import { getMarketplace, MarketplaceUnavailableError } from "@/lib/marketplace";
import MarketplaceUnavailable from "@/components/MarketplaceUnavailable";

export const metadata: Metadata = {
  title: "Digital Products",
  description:
    "Browse templates, e-books, courses and other downloadable digital products.",
};

type Props = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

function firstParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function pageHref(
  page: number,
  values: Record<string, string | string[] | undefined>,
) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) {
    if (key === "page" || value === undefined) continue;
    for (const item of Array.isArray(value) ? value : [value]) {
      if (item.trim()) params.append(key, item);
    }
  }
  params.set("page", String(page));
  return `/marketplace?${params.toString()}`;
}

function Shelf({
  title,
  items,
  viewHref,
}: {
  title: string;
  items: NonNullable<Awaited<ReturnType<typeof getMarketplace>>>["products"];
  viewHref: string;
}) {
  if (!items.length) return null;
  return (
    <section className="mt-5">
      <div className="mb-2 flex items-center justify-between">
        <h2 className="m-0 border-l-2 border-primary pl-2 text-[13px] font-bold text-slate-900 max-[800px]:text-[11px]">
          {title}
        </h2>
        <Link
          href={viewHref}
          className="text-[9px] font-semibold text-primary no-underline"
        >
          View all
        </Link>
      </div>
      <ProductGrid items={items} />
    </section>
  );
}

export default async function DigitalProductsPage({ searchParams }: Props) {
  const params = await searchParams;
  const search = firstParam(params.search)?.trim() || "";
  let data: Awaited<ReturnType<typeof getMarketplace>>;
  try {
    data = await getMarketplace(params as Record<string, string | string[]>);
  } catch (error) {
    if (error instanceof MarketplaceUnavailableError) {
      return (
        <main className="min-h-screen bg-background">
          <Navbar active="products" />
          <MarketplaceUnavailable />
          <PublicFooter />
        </main>
      );
    }
    throw error;
  }
  if (!data) throw new Error("Marketplace data was not found.");

  const hasFilters = Object.entries(params).some(
    ([key, value]) =>
      key !== "page" &&
      key !== "pageSize" &&
      (Array.isArray(value) ? value.some(Boolean) : Boolean(value)) &&
      !(key === "sort" && value === "popular"),
  );
  const pageCount = Math.ceil(data.total / data.pageSize);

  return (
    <main className="flex min-h-screen w-full flex-col overflow-x-clip bg-background">
      <Navbar active="products" />
      <div className="mx-auto w-full max-w-[1440px] flex-1 px-3 pb-10 sm:px-6">
        <MarketplaceToolbar initiallyExpanded={Boolean(search || hasFilters)}>
          <form action="/marketplace" className="grid gap-2.5 sm:gap-3">
            {Object.entries(params).flatMap(([key, value]) =>
              key === "search" || key === "page" || key === "pageSize"
                ? []
                : (Array.isArray(value) ? value : [value]).map((item, index) => (
                    <input
                      key={`${key}-${index}`}
                      type="hidden"
                      name={key}
                      value={item}
                    />
                  )),
            )}
            <div className="flex min-w-0 items-center overflow-visible rounded-xl border-2 border-primary bg-white shadow-sm focus-within:ring-2 focus-within:ring-primary/20">
              <MarketplaceSearchInput
                key={search}
                defaultValue={search}
              />
              <button
                type="submit"
                className="h-11 shrink-0 rounded-r-[9px] bg-primary px-4 text-xs font-semibold text-white transition hover:bg-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-white sm:h-12 sm:px-9 sm:text-sm"
              >
                Search
              </button>
            </div>
          </form>
          <MarketplaceFilters
            key={JSON.stringify(params)}
            categories={data.categories.map((item) => ({
              value: item.slug,
              label: item.name,
            }))}
            subcategories={data.subcategories.map((item) => ({
              value: item.value,
              label: item.label,
              parentId: item.parentId,
              parentSlug: item.parentSlug,
              productCount: item.productCount,
            }))}
            productTypes={data.filters.productTypes}
            licenses={data.filters.licenseTypes.map((license) => ({
              value: String(license.id),
              label: license.name,
            }))}
            search={search}
            resultCount={data.total}
          />
        </MarketplaceToolbar>

        {hasFilters ? (
          <section className="mt-6">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-bold text-heading">
                Search results
              </h2>
              <span className="text-[10px] text-muted">
                {data.total} products
              </span>
            </div>
            {data.products.length ? (
              <ProductGrid items={data.products} />
            ) : (
              <p className="rounded-lg border border-border bg-white p-5 text-xs text-muted">
                No products match these filters.
              </p>
            )}
          </section>
        ) : (
          <>
            <Shelf
              title="Best Sellers"
              items={data.bestSellers}
              viewHref="/marketplace?sort=popular"
            />
            <Shelf
              title="Trending"
              items={data.trending}
              viewHref="/marketplace?sort=popular"
            />
            <Shelf
              title="New Arrivals"
              items={data.newArrivals}
              viewHref="/marketplace?sort=newest"
            />
            <Shelf
              title="Recently Updated"
              items={data.recentlyUpdated}
              viewHref="/marketplace?sort=updated"
            />
            {data.creators.length > 0 && (
              <section className="mt-7">
                <h2 className="mb-3 border-l-2 border-primary pl-2 text-[13px] font-bold text-slate-900">
                  Creators
                </h2>
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {data.creators.map((creator) => (
                    <Link
                      key={creator.slug}
                      href={`/marketplace/${encodeURIComponent(creator.slug)}`}
                      className="flex min-w-0 items-center gap-3 rounded-lg border border-border bg-white p-3 no-underline shadow-sm transition hover:border-primary/40"
                    >
                      {creator.logoUrl ? (
                        <img
                          src={creator.logoUrl}
                          alt=""
                          loading="lazy"
                          decoding="async"
                          className="h-11 w-11 rounded-full object-cover"
                        />
                      ) : (
                        <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-accent-light text-sm font-bold text-primary">
                          {creator.name.slice(0, 1).toUpperCase()}
                        </span>
                      )}
                      <span className="min-w-0">
                        <b className="block truncate text-xs text-heading">
                          {creator.name}
                        </b>
                        <small className="mt-1 block text-[9px] text-muted">
                          {creator.productCount} published products
                          {creator.verified ? " · Verified creator" : ""}
                        </small>
                      </span>
                    </Link>
                  ))}
                </div>
              </section>
            )}
            <section className="mt-7">
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-sm font-bold text-heading">
                  All Products
                </h2>
                <span className="text-[10px] text-muted">
                  {data.total} products
                </span>
              </div>
              {data.products.length ? (
                <ProductGrid items={data.products} />
              ) : (
                <p className="rounded-lg border border-border bg-white p-5 text-xs text-muted">
                  No published products are available yet.
                </p>
              )}
            </section>
          </>
        )}

        {pageCount > 1 && (
          <nav
            aria-label="Marketplace pagination"
            className="mt-6 flex items-center justify-center gap-4 text-xs"
          >
            {data.page > 1 ? (
              <Link
                href={pageHref(data.page - 1, params)}
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
                href={pageHref(data.page + 1, params)}
                className="font-semibold text-primary"
              >
                Next
              </Link>
            ) : (
              <span className="text-muted">Next</span>
            )}
          </nav>
        )}
      </div>
      <PublicFooter />
    </main>
  );
}
