import PublicIcon from "@/components/icons/PublicIcon";
import { Badge, Table, TableHeader, TableRow } from "@/components/ui";
import ProductPagination from "@/components/products/ProductPagination";

export type CustomerStatus = "Active" | "Inactive";

export type Customer = {
  name: string;
  email: string;
  orders: number;
  totalSpent: string;
  lastOrder: string;
  status: CustomerStatus;
  segment: "New" | "Returning";
};

const statusTone = {
  Active: "success",
  Inactive: "neutral",
} as const;

export default function CustomerTable({
  customers,
  total,
  page,
  pages,
  onPageChange,
}: {
  customers: Customer[];
  total: number;
  page: number;
  pages: number;
  onPageChange: (page: number) => void;
}) {
  return (
    <>
      <div className="customer-responsive-table">
        <Table className="min-w-[900px]">
        <TableHeader>
          <tr>
            <th className="px-6 py-3 font-medium">Customer</th>
            <th className="py-3 font-medium">Orders</th>
            <th className="py-3 font-medium">Total Spent</th>
            <th className="py-3 font-medium">Last Order</th>
            <th className="py-3 font-medium">Status</th>
            <th className="px-6 py-3 text-right font-medium">Actions</th>
          </tr>
        </TableHeader>
        <tbody>
          {customers.map((customer) => (
            <TableRow key={customer.email} className="text-body transition hover:bg-surface-hover">
              <td data-label="Customer" className="px-6 py-3">
                <div className="flex items-center gap-2">
                  <span className="grid h-8 w-8 place-items-center rounded-full bg-[#1f2433] text-[10px] font-semibold text-white">
                    {customer.name.charAt(0)}
                  </span>
                  <div>
                    <p className="text-[10px] font-semibold text-body-strong">{customer.name}</p>
                    <p className="text-[8px] text-muted-soft">{customer.email}</p>
                  </div>
                </div>
              </td>
              <td data-label="Orders" className="py-3 font-medium">{customer.orders}</td>
              <td data-label="Total Spent" className="py-3 font-medium text-body-strong">{customer.totalSpent}</td>
              <td data-label="Last Order" className="py-3 text-muted">{customer.lastOrder}</td>
              <td data-label="Status" className="py-3"><Badge tone={statusTone[customer.status]}>{customer.status}</Badge></td>
              <td data-label="Actions" className="px-6 py-3 text-right">
                <button
                  type="button"
                  aria-label={`More actions for ${customer.name}`}
                  className="inline-grid h-7 w-7 place-items-center rounded-md border border-border-action text-muted hover:border-primary hover:text-primary"
                >
                  <PublicIcon name="ellipsis-vertical" className="h-3.5 w-3.5" />
                </button>
              </td>
            </TableRow>
          ))}
        </tbody>
        </Table>
      </div>
      {customers.length === 0 && <p className="px-6 py-12 text-center text-sm text-muted">No customers match your filters.</p>}
      <ProductPagination
        count={customers.length}
        total={total}
        page={page}
        pages={pages}
        itemLabel="customers"
        onPageChange={onPageChange}
      />
    </>
  );
}
