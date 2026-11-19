import PublicIcon from "@/components/icons/PublicIcon";
import ProductStatusBadge from "./ProductStatusBadge";
import type { Product } from "./productTypes";

type ProductTableProps = {
  products: Product[];
  discounts: Record<string, number>;
  isLoading?: boolean;
  onMore?: (product: Product) => void;
};

export default function ProductTable({ products, discounts, isLoading = false, onMore }: ProductTableProps) {
  return (
    <div className="overflow-x-auto product-responsive-table">
      <table className="w-full min-w-[900px] text-left text-xs">
        <thead className="bg-[#fcfcfe] text-[10px] text-[#66718e]">
          <tr>
            <th className="px-6 py-3 font-medium">Product</th>
            <th className="py-3 font-medium">Current Version</th>
            <th className="py-3 font-medium">Latest Version</th>
            <th className="py-3 font-medium">Price</th>
            <th className="py-3 font-medium">Discount</th>
            <th className="py-3 font-medium">Status</th>
            <th className="py-3 font-medium">Sales</th>
            <th className="py-3 font-medium">Created At</th>
            <th className="px-6 py-3 text-right font-medium">Actions</th>
          </tr>
        </thead>
        <tbody>
          {isLoading ? (
            <tr>
              <td colSpan={9} className="px-6 py-12 text-center text-sm text-[#66718e]">
                Loading products...
              </td>
            </tr>
          ) : products.map((product) => {
            const productKey = String(product.id ?? product.name);
            const discount = discounts[productKey] ?? 0;
            const price = Number(product.price.slice(1));

            return (
              <tr key={productKey} className="border-t border-[#edf0f5] text-[#283554] transition hover:bg-[#fffaf6]">
                <td data-label="Product" className="px-6 py-3">
                  <strong className="block truncate text-[11px] font-semibold text-[#172141]">{product.name}</strong>
                </td>
                <td data-label="Current Version" className="text-[10px] text-[#66718e]">
                  {product.currentVersion ? `v${product.currentVersion}` : "-"}
                </td>
                <td data-label="Latest Version" className="text-[10px] text-[#66718e]">
                  {product.latestVersion ? `v${product.latestVersion}` : "-"}
                </td>
                <td data-label="Price" className="font-medium text-[#172141]">
                  {discount > 0 ? <><span className="text-primary">${(price * (1 - discount / 100)).toFixed(2)}</span><span className="ml-2 text-[10px] text-[#9aa2b5] line-through">{product.price}</span></> : product.price}
                </td>
                <td data-label="Discount">{discount > 0 ? <span className="rounded-md bg-orange-50 px-2 py-1 text-[9px] font-semibold text-primary">-{discount}%</span> : <span className="text-[10px] font-medium text-[#8a93a8]">Add discount</span>}</td>
                <td data-label="Status"><ProductStatusBadge status={product.status} approvalStatus={product.approvalStatus} />{product.approvalReason && <p className="mt-1 max-w-48 text-[9px] leading-4 text-amber-800">Reason: {product.approvalReason}</p>}{product.deletionScheduledAt && <p className="mt-1 max-w-48 text-[9px] leading-4 text-red-700">Scheduled for deletion {new Date(product.deletionScheduledAt).toLocaleDateString()} unless purchase history must be retained.</p>}</td>
                <td data-label="Sales">{product.sales}</td>
                <td data-label="Created At" className="text-[#66718e]">{product.createdAt}</td>
                <td data-label="Actions" className="px-6">
                  <div className="flex justify-end gap-2">
                    <button type="button" aria-label={`More actions for ${product.name}`} onClick={() => onMore?.(product)} className="grid h-7 w-7 place-items-center rounded-md border border-[#e4e7ef] text-[#66718e] hover:border-primary hover:text-primary"><PublicIcon name="ellipsis-vertical" className="h-3.5 w-3.5" /></button>
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {!isLoading && products.length === 0 && <p className="px-6 py-12 text-center text-sm text-[#66718e]">No products match your search.</p>}
    </div>
  );
}
