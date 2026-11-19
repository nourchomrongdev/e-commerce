import { AdminActivityDetail } from "@/components/dashboard/admin/AdminActivityLog";

export default async function ActivityDetailPage({
  params,
}: {
  params: Promise<{ activityId: string }>;
}) {
  const { activityId } = await params;
  return <AdminActivityDetail activityId={activityId} />;
}
