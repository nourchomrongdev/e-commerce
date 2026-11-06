import AdminPolicyPage from "@/components/dashboard/admin/AdminPolicyPage";

export default async function AdminPolicyDetailPage({ params }: { params: Promise<{ policyKey: string }> }) {
  const { policyKey } = await params;
  return <AdminPolicyPage policyKey={policyKey} />;
}
