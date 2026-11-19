import ProductApprovalDetail from "@/components/dashboard/admin/ProductApprovalDetail";

export default async function ProductApprovalDetailPage({
  params,
}: {
  params: Promise<{ productId: string }>;
}) {
  const { productId } = await params;
  return <ProductApprovalDetail productId={productId} />;
}
