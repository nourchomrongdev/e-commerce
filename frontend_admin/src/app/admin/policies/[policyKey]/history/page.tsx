import AdminPolicyHistoryPage from "@/components/dashboard/admin/AdminPolicyHistoryPage";

export default async function AdminPolicyHistoryRoute({ params }: { params: Promise<{ policyKey: string }> }) {
  const { policyKey } = await params;
  return <AdminPolicyHistoryPage policyKey={policyKey} />;
}
