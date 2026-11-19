import CreatorReviewsManager from "@/components/dashboard/creator/CreatorReviewsManager";

export default async function CustomerReviewsPage({ params }: { params: Promise<{ storefront: string }> }) {
  const { storefront } = await params;
  return <CreatorReviewsManager view="reviews" storefrontName={decodeURIComponent(storefront)} />;
}
