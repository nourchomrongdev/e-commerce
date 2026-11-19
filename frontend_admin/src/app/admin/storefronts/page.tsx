import AdminSectionWithPagination from "@/components/dashboard/admin/AdminSectionWithPagination";
import StorefrontLimitSettings from "@/components/dashboard/admin/StorefrontLimitSettings";

export default function StorefrontsPage() {
  return (
    <>
      <StorefrontLimitSettings />
      <AdminSectionWithPagination section="storefronts" />
    </>
  );
}
