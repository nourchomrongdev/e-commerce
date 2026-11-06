import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import Navbar from "@/components/Navbar";
import PublicFooter from "@/components/PublicFooter";
import StorefrontCartButton from "@/components/StorefrontCartButton";
import ProductBreadcrumbs from "@/components/ProductBreadcrumbs";
import ProductPreviewGallery from "@/components/ProductPreviewGallery";
import { formatMarketplacePrice, getProduct } from "@/lib/marketplace";

type Props = {
  params: Promise<{ storefrontName: string; productSlug: string }>;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { storefrontName, productSlug } = await params;
  const data = await getProduct(storefrontName, productSlug);
  return {
    title: data?.product.name ?? "Product",
    description:
      data?.product.shortDescription ||
      data?.product.description ||
      "Digital product details.",
  };
}

export default async function ProductDetailPage({ params }: Props) {
  const { storefrontName, productSlug } = await params;
  const data = await getProduct(storefrontName, productSlug);
  if (!data) notFound();

  const product = data.product;
  const storefrontPath = `/marketplace/${encodeURIComponent(product.storeSlug)}`;
  const productPath = `${storefrontPath}/${encodeURIComponent(product.slug)}`;

  return (
    <div className="min-h-screen bg-[#f7f9fd] text-[#142b4d]">
      <Navbar active="products" />
      <main className="mx-auto max-w-[1280px] px-4 pb-16 sm:px-6 lg:px-8">
        <div className="border-b border-[#e5ebf4] py-3">
          <ProductBreadcrumbs
            productName={product.storeName}
            productPath={storefrontPath}
            current={product.name}
          />
        </div>
        <div className="grid gap-8 border-b border-[#e5ebf4] py-8 lg:grid-cols-[minmax(0,1fr)_270px]">
          <section className="min-w-0 overflow-hidden border border-border bg-white p-5 shadow-sm sm:p-6">
            <div className="p-3 sm:p-5">
              <div className="flex flex-wrap items-start gap-4">
                <div className="min-w-0 flex-1">
                  <p className="text-[9px] font-semibold uppercase tracking-[.16em] text-primary">
                    {product.categoryName} / {product.productType}
                  </p>
                  <h1 className="mt-1 text-[30px] font-extrabold leading-tight tracking-tight text-heading sm:text-4xl">
                    {product.name}
                  </h1>
                  <Link
                    href={storefrontPath}
                    className="mt-1 inline-flex text-xs font-semibold text-primary no-underline hover:text-primary-hover"
                  >
                    by {product.storeName}
                    {product.creatorVerified && (
                      <span className="ml-1" aria-label="Verified creator">
                        ✓
                      </span>
                    )}
                  </Link>
                </div>
                <div className="w-full sm:w-auto sm:text-right">
                  {product.rating === null ? (
                    <div className="text-xs text-muted">No reviews yet</div>
                  ) : (
                    <div className="text-sm text-amber-500">
                      ★★★★★{" "}
                      <span className="ml-1 text-xs font-semibold text-heading">
                        {product.rating.toFixed(1)}
                      </span>
                    </div>
                  )}
                  <small className="text-[10px] text-muted">
                    {product.reviewCount} reviews · {product.salesCount} sales
                  </small>
                </div>
              </div>

              {product.shortDescription && (
                <p className="mt-4 text-sm leading-6 text-slate-600">
                  {product.shortDescription}
                </p>
              )}
              <div className="mt-6 flex flex-wrap items-center gap-3 border-y border-divider py-4 text-[10px] text-muted">
                <span>Digital product</span>
                {product.currentVersion && (
                  <>
                    <span className="h-3 w-px bg-border" />
                    <span>Version {product.currentVersion}</span>
                  </>
                )}
              </div>
              <div className="mt-6 flex flex-wrap items-end justify-between gap-5">
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-[.14em] text-muted">
                    {product.isFree ? "Free product" : "Current version"}
                  </p>
                  <p className="mt-1 text-3xl font-extrabold leading-none text-heading">
                    {product.isFree
                      ? "Free"
                      : formatMarketplacePrice(product.price, product.currency)}
                    {product.currentVersion && (
                      <span className="ml-2 rounded bg-orange-50 px-2 py-1 align-middle text-[9px] font-bold text-primary">
                        {product.currentVersion}
                      </span>
                    )}
                  </p>
                </div>
                {!product.isFree && (
                  <div className="flex w-full max-w-[220px] flex-col gap-2 [&>button]:mt-0">
                    <StorefrontCartButton
                      id={String(product.id)}
                      name={product.name}
                      type={product.productType}
                      price={formatMarketplacePrice(
                        product.price,
                        product.currency,
                      )}
                      href={productPath}
                    />
                    <StorefrontCartButton
                      id={String(product.id)}
                      name={product.name}
                      type={product.productType}
                      price={formatMarketplacePrice(
                        product.price,
                        product.currency,
                      )}
                      href={productPath}
                      label="Buy Now"
                      redirectTo="/cart/payment"
                      iconName="shopping-cart-plus"
                      className="!border !border-primary !bg-white !text-primary hover:!bg-accent-light"
                    />
                  </div>
                )}
              </div>

              <ProductPreviewGallery
                key={product.id}
                productName={product.name}
                previews={product.previews}
              />

              <section className="mt-8 border-t border-divider pt-6">
                <h2 className="text-base font-bold text-heading">
                  About this product
                </h2>
                <div className="mt-3 whitespace-pre-wrap text-[11px] leading-6 text-muted">
                  {product.description || product.shortDescription || "No description provided."}
                </div>
              </section>

              <section className="mt-8 border-t border-divider pt-6">
                <h2 className="text-base font-bold text-heading">
                  Product details
                </h2>
                <dl className="mt-3 grid gap-4 sm:grid-cols-3">
                  <div className="border-b border-divider pb-3">
                    <dt className="text-[9px] uppercase text-muted">Category</dt>
                    <dd className="mt-1 text-xs text-heading">
                      {product.categoryName}
                    </dd>
                  </div>
                  <div className="border-b border-divider pb-3">
                    <dt className="text-[9px] uppercase text-muted">Type</dt>
                    <dd className="mt-1 text-xs text-heading">
                      {product.productType}
                    </dd>
                  </div>
                  <div className="border-b border-divider pb-3">
                    <dt className="text-[9px] uppercase text-muted">Latest version</dt>
                    <dd className="mt-1 text-xs text-heading">
                      {product.currentVersion || "Not specified"}
                    </dd>
                  </div>
                </dl>
              </section>

              {product.licenses.length > 0 && (
                <section className="mt-8 border-t border-divider pt-6">
                  <h2 className="text-base font-bold text-heading">
                    Available licenses
                  </h2>
                  <div className="mt-3 divide-y divide-divider border-y border-divider">
                    {product.licenses.map((license) => (
                      <div
                        key={license.id}
                        className="flex flex-wrap items-center justify-between gap-3 py-3 text-xs"
                      >
                        <div>
                          <b className="text-heading">{license.name}</b>
                          <p className="mt-1 text-[10px] text-muted">
                            {license.accessType}
                            {license.downloadLimit
                              ? ` · ${license.downloadLimit} downloads`
                              : ""}
                          </p>
                        </div>
                        <span className="font-semibold text-heading">
                          {product.isFree
                            ? "Free"
                            : formatMarketplacePrice(
                                license.price,
                                product.currency,
                              )}
                        </span>
                      </div>
                    ))}
                  </div>
                </section>
              )}

              <Link
                href={`${productPath}/versions`}
                className="mt-6 inline-flex items-center gap-2 text-xs font-semibold text-primary hover:text-primary-hover"
              >
                View all product versions <span>→</span>
              </Link>

              <section className="mt-8 border-t border-divider pt-6">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <h2 className="text-base font-bold text-heading">
                    Customer reviews
                  </h2>
                  {product.rating !== null && (
                    <span className="text-sm font-semibold text-heading">
                      {product.rating.toFixed(1)} / 5
                    </span>
                  )}
                </div>
                {product.reviews.length ? (
                  <div className="mt-3 divide-y divide-divider">
                    {product.reviews.map((review) => (
                      <article key={review.id} className="py-3">
                        <div className="flex items-center justify-between gap-3">
                          <span className="text-amber-500">
                            {"★".repeat(review.rating)}
                          </span>
                          <time
                            dateTime={review.createdAt}
                            className="text-[9px] text-muted"
                          >
                            {new Date(review.createdAt).toLocaleDateString()}
                          </time>
                        </div>
                        {review.title && (
                          <h3 className="mt-1 text-xs font-semibold text-heading">
                            {review.title}
                          </h3>
                        )}
                        {review.comment && (
                          <p className="mt-1 whitespace-pre-wrap text-[11px] leading-5 text-muted">
                            {review.comment}
                          </p>
                        )}
                        {review.verifiedPurchase && (
                          <span className="mt-2 inline-block text-[9px] font-semibold text-emerald-700">
                            Verified purchase
                          </span>
                        )}
                      </article>
                    ))}
                  </div>
                ) : (
                  <p className="mt-3 text-xs text-muted">
                    No approved reviews have been posted yet.
                  </p>
                )}
              </section>
            </div>
          </section>
          <aside className="hidden space-y-5 lg:sticky lg:top-5 lg:block lg:self-start">
            <section className="rounded-lg border border-border bg-white p-4 shadow-sm">
              <h2 className="border-l-2 border-primary pl-2 text-sm font-bold text-heading">
                Creator
              </h2>
              <p className="mt-4 text-sm font-semibold text-heading">
                {product.storeName}
              </p>
              <p className="mt-1 text-[10px] text-muted">
                {product.creatorName}
                {product.creatorVerified ? " · Verified" : ""}
              </p>
              <Link
                href={storefrontPath}
                className="mt-4 inline-block text-[10px] font-semibold text-primary"
              >
                Visit storefront
              </Link>
            </section>
            <section className="rounded-lg border border-border bg-white p-4 shadow-sm">
              <h2 className="border-l-2 border-primary pl-2 text-sm font-bold text-heading">
                Version history
              </h2>
              <p className="mt-3 text-[10px] leading-5 text-muted">
                Review release notes and file details for published versions.
              </p>
              <Link
                href={`${productPath}/versions`}
                className="mt-3 inline-block text-[10px] font-semibold text-primary"
              >
                Browse versions
              </Link>
            </section>
          </aside>
        </div>
      </main>
      <PublicFooter />
    </div>
  );
}
