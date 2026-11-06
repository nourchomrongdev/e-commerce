import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import Navbar from "@/components/Navbar";
import PublicFooter from "@/components/PublicFooter";
import ProductBreadcrumbs from "@/components/ProductBreadcrumbs";
import {
  formatMarketplacePrice,
  getProduct,
  getProductVersions,
} from "@/lib/marketplace";

type Props = { params: Promise<{ storefrontName: string; productSlug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { storefrontName, productSlug } = await params;
  const data = await getProduct(storefrontName, productSlug);
  return {
    title: data ? `${data.product.name} versions` : "Product versions",
    description: data
      ? `Release history for ${data.product.name}.`
      : "Browse published product releases.",
  };
}

export default async function ProductVersionsPage({ params }: Props) {
  const { storefrontName, productSlug } = await params;
  const [productData, versionData] = await Promise.all([
    getProduct(storefrontName, productSlug),
    getProductVersions(storefrontName, productSlug),
  ]);
  if (!productData || !versionData) notFound();

  const product = productData.product;
  const productPath = `/marketplace/${encodeURIComponent(product.storeSlug)}/${encodeURIComponent(product.slug)}`;

  return (
    <div className="min-h-screen bg-[#f7f9fd] text-[#142b4d]">
      <Navbar active="products" />
      <main className="mx-auto max-w-[960px] px-4 pb-16 pt-6 sm:px-6 lg:px-8">
        <ProductBreadcrumbs
          productName={product.name}
          productPath={productPath}
          current="Versions"
        />
        <section className="mt-6 border border-border bg-white p-6 shadow-sm sm:p-8">
          <p className="text-[10px] font-semibold uppercase tracking-[.16em] text-primary">
            {product.storeName} · Product history
          </p>
          <h1 className="mt-2 text-3xl font-extrabold tracking-tight text-heading">
            {product.name} versions
          </h1>
          <p className="mt-2 max-w-xl text-sm leading-6 text-muted">
            Published releases and release notes for this product.
          </p>
          <div className="mt-6 divide-y divide-divider border-y border-divider">
            {versionData.versions.map((version) => (
              <article
                key={version.id}
                className="flex flex-wrap items-start justify-between gap-4 py-4"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="text-sm font-bold text-heading">
                      {version.version}
                    </h2>
                    {version.isCurrent && (
                      <span className="rounded bg-accent-light px-2 py-1 text-[9px] font-semibold text-primary">
                        Current
                      </span>
                    )}
                    {version.isFree && (
                      <span className="rounded bg-emerald-50 px-2 py-1 text-[9px] font-semibold text-emerald-700">
                        Free version
                      </span>
                    )}
                  </div>
                  <p className="mt-1 text-[10px] text-muted">
                    Released{" "}
                    {new Date(version.releasedAt).toLocaleDateString()}
                  </p>
                  {version.releaseNotes && (
                    <p className="mt-2 whitespace-pre-wrap text-[11px] leading-5 text-slate-600">
                      {version.releaseNotes}
                    </p>
                  )}
                  {!version.isFree && (
                    <p className="mt-2 text-[9px] text-muted">
                      <b className="font-semibold text-heading">Price:</b>{" "}
                      {formatMarketplacePrice(version.price, product.currency)}
                    </p>
                  )}
                </div>
              </article>
            ))}
            {!versionData.versions.length && (
              <p className="py-5 text-xs text-muted">
                No published versions are available for this product.
              </p>
            )}
          </div>
          <p className="mt-5 text-[10px] leading-5 text-muted">
            This page lists public release metadata. Download access and
            version-upgrade eligibility are not available through the current
            marketplace API.
          </p>
          <Link
            href={productPath}
            className="mt-6 inline-block text-xs font-semibold text-primary"
          >
            ← Back to product
          </Link>
        </section>
      </main>
      <PublicFooter />
    </div>
  );
}
