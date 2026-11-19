import CreatorStorefrontAnalytics from "@/components/dashboard/creator/CreatorStorefrontAnalytics";

export default async function StorefrontAnalyticsPage({
  params,
}: {
  params: Promise<{ storefront: string }>;
}) {
  const { storefront } = await params;
  return <CreatorStorefrontAnalytics storefront={decodeURIComponent(storefront)} />;
}
