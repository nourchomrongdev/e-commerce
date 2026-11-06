import AdminPolicyVersionPage from "@/components/dashboard/admin/AdminPolicyVersionPage";

export default async function AdminPolicyVersionRoute({
  params,
}: {
  params: Promise<{ policyKey: string; versionId: string }>;
}) {
  const { policyKey, versionId } = await params;
  return <AdminPolicyVersionPage policyKey={policyKey} versionId={versionId} />;
}
