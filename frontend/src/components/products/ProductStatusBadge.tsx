import type { ProductStatus } from "./productTypes";

export default function ProductStatusBadge({
  status,
  approvalStatus,
}: {
  status: ProductStatus;
  approvalStatus?: string;
}) {
  const pending = approvalStatus === "pending";
  const changesRequested = approvalStatus === "changes_requested";
  const rejected = approvalStatus === "rejected";
  const approvedDraft = approvalStatus === "approved" && status === "Draft";
  const label = pending
    ? "Pending review"
    : changesRequested
      ? "Changes requested"
      : rejected
        ? "Rejected"
        : approvedDraft
          ? "Approved · Draft"
          : status;
  const classes = pending || changesRequested
    ? "bg-amber-50 text-amber-700"
    : rejected
      ? "bg-status-danger-surface text-status-danger"
      : status === "Published" || approvedDraft
        ? "bg-status-success-surface text-status-success"
        : status === "Archived"
          ? "bg-slate-100 text-muted-soft"
          : "bg-slate-100 text-muted";

  return <span className={`rounded-md px-2.5 py-1.5 text-[9px] font-medium ${classes}`}>{label}</span>;
}
