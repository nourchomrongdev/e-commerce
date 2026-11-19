import ProductDetailClient from "@/components/marketplace/ProductDetailClient";

export default async function StorefrontProductPage({
  params,
}: {
  params: Promise<{ storefront: string; productSlug: string }>;
}) {
  const { storefront, productSlug } = await params;
  return <ProductDetailClient storefront={storefront} productSlug={productSlug} />;
}
