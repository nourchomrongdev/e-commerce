export type ProductStatus = "Published" | "Draft" | "Archived";
export type ProductApprovalStatus =
  | "draft"
  | "pending"
  | "changes_requested"
  | "approved"
  | "rejected";

export type Product = {
  id?: number;
  uuid?: string;
  name: string;
  description: string;
  currentVersion?: string | null;
  latestVersion?: string | null;
  price: string;
  discount: number;
  status: ProductStatus;
  approvalStatus?: ProductApprovalStatus;
  approvalReason?: string | null;
  rejectedAt?: string | null;
  deletionScheduledAt?: string | null;
  sales: number;
  createdAt: string;
  icon: string;
};

export type ProductFormValues = Pick<Product, "name" | "description" | "price" | "discount" | "status">;
