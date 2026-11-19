"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import PublicIcon from "@/components/icons/PublicIcon";
import ProductPagination from "@/components/products/ProductPagination";
import { Badge } from "@/components/ui";
import useDebouncedValue from "@/hooks/useDebouncedValue";

type ProductApproval = {
  id: number;
  name: string;
  slug: string;
  shortDescription: string;
  description: string;
  productType: string;
  price: number;
  currency: string;
  status: string;
  approvalStatus: string;
  createdAt: string;
  updatedAt: string;
  storeName: string;
  creatorName: string;
  categoryName: string | null;
};
type QueueResponse = {
  products: ProductApproval[];
  pagination: { page: number; pageSize: number; total: number; pages: number };
};

const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:5000/api";
const statuses = ["pending", "changes_requested", "approved", "rejected", "draft"];

function statusTone(status: string): "success" | "warning" | "danger" | "neutral" {
  if (status === "approved") return "success";
  if (status === "pending") return "warning";
  if (status === "rejected") return "danger";
  return "neutral";
}

function formatPrice(price: number, currency: string) {
  const amount = Number(price || 0);
  const currencyCode = currency || "USD";
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency: currencyCode }).format(amount);
  } catch {
    return `${currencyCode} ${amount.toFixed(2)}`;
  }
}

export default function ProductApprovalQueue() {
  const [token, setToken] = useState("");
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("pending");
  const debouncedSearch = useDebouncedValue(search.trim());
  const debouncedStatus = useDebouncedValue(status);
  const [page, setPage] = useState(1);
  const [result, setResult] = useState<QueueResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const timer = window.setTimeout(() => setToken(window.localStorage.getItem("marketplace-token") ?? ""), 0);
    return () => window.clearTimeout(timer);
  }, []);

  const query = useMemo(() => {
    const params = new URLSearchParams({ page: String(page), pageSize: "10", status: debouncedStatus });
    if (debouncedSearch) params.set("search", debouncedSearch);
    return params.toString();
  }, [debouncedSearch, debouncedStatus, page]);

  useEffect(() => {
    if (!token || search.trim() !== debouncedSearch || status !== debouncedStatus) return;
    const controller = new AbortController();
    const load = async () => {
      setLoading(true);
      setError("");
      try {
        const response = await fetch(`${apiUrl}/admin/product-approvals?${query}`, {
          headers: { Authorization: `Bearer ${token}` },
          cache: "no-store",
          signal: controller.signal,
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Unable to load product approvals.");
        setResult(data as QueueResponse);
      } catch (loadError) {
        if (loadError instanceof DOMException && loadError.name === "AbortError") return;
        setResult(null);
        setError(loadError instanceof Error ? loadError.message : "Unable to load product approvals.");
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    };
    void load();
    return () => controller.abort();
  }, [debouncedSearch, debouncedStatus, query, search, status, token]);

  return (
    <div className="mx-auto w-full max-w-[1400px]">
      <header className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="mb-1 text-[10px] font-bold uppercase tracking-[0.1em] text-primary">Product management</p>
          <h1 className="text-2xl font-bold tracking-tight text-heading sm:text-[28px]">Product Approval</h1>
          <p className="mt-1 text-sm text-muted">Review creator-submitted products before they can be published.</p>
        </div>
        <Link href="/admin/products/new" className="inline-flex h-9 items-center gap-2 rounded-lg bg-primary px-4 text-xs font-semibold text-white no-underline transition hover:bg-primary-hover"><PublicIcon name="add" className="h-3.5 w-3.5" />Add product</Link>
      </header>

      <div className="mb-4 flex flex-col gap-2 rounded-xl border border-border bg-white p-4 shadow-sm sm:flex-row">
        <label className="relative min-w-[12rem] flex-1">
          <span className="sr-only">Search products</span>
          <PublicIcon name="search" className="absolute left-3 top-2.5 h-4 w-4 text-muted-faint" />
          <input value={search} onChange={(event) => { setSearch(event.target.value); setPage(1); }} placeholder="Search products, creators, or stores..." className="h-9 w-full rounded-lg border border-border-control pl-9 pr-3 text-xs outline-none focus:border-primary focus:ring-2 focus:ring-orange-100" />
        </label>
        <label><span className="sr-only">Filter by approval status</span><select value={status} onChange={(event) => { setStatus(event.target.value); setPage(1); }} className="h-9 min-w-44 rounded-lg border border-border-control bg-white px-3 text-xs text-body"><option value="all">All statuses</option>{statuses.map((item) => <option key={item} value={item}>{item.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase())}</option>)}</select></label>
      </div>

      {error && <p role="alert" className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}
      {token === "" && <p role="alert" className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">An administrator session is required.</p>}

      <section className="overflow-hidden rounded-xl border border-border bg-white shadow-sm">
        <div className="border-b border-divider px-5 py-3 text-xs text-muted">{result?.pagination ? `${result.pagination.total.toLocaleString()} products` : "Database records"}</div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1000px] text-left text-xs">
            <thead className="bg-surface-muted text-[10px] uppercase tracking-wide text-muted"><tr><th className="px-4 py-3 font-medium">Product</th><th className="px-4 py-3 font-medium">Creator / Store</th><th className="px-4 py-3 font-medium">Price</th><th className="px-4 py-3 font-medium">Submitted</th><th className="px-4 py-3 font-medium">Status</th><th className="px-4 py-3 text-right font-medium">Review</th></tr></thead>
            <tbody>{result?.products.map((product) => <tr key={product.id} className="border-t border-divider text-body hover:bg-surface-hover">
              <td className="px-4 py-4 align-top">
                <p className="font-semibold text-body-strong">{product.name}</p>
                <p className="mt-1 text-[10px] text-muted">{product.categoryName || "Uncategorized"} · {product.productType}</p>
              </td>
              <td className="px-4 py-4 align-top"><p className="font-medium">{product.creatorName}</p><p className="mt-1 text-[10px] text-muted">{product.storeName}</p></td>
              <td className="px-4 py-4 align-top text-[10px]">{formatPrice(product.price, product.currency)}</td>
              <td className="px-4 py-4 align-top text-[10px] text-muted">{new Date(product.updatedAt || product.createdAt).toLocaleString()}</td>
              <td className="px-4 py-4 align-top"><Badge tone={statusTone(product.approvalStatus)}>{product.approvalStatus.replaceAll("_", " ")}</Badge></td>
              <td className="px-4 py-4 text-right align-top">
                <Link href={`/admin/products/approval/${product.id}`} aria-label={`Review ${product.name}`} className="ml-auto inline-flex items-center gap-1.5 rounded-lg border border-border-control px-3 py-2 text-[10px] font-semibold text-body no-underline transition hover:border-primary hover:bg-accent-light hover:text-primary"><PublicIcon name="view" className="h-3.5 w-3.5" />Review</Link>
              </td>
            </tr>)}</tbody>
          </table>
          {loading && <p className="px-6 py-12 text-center text-sm text-muted">Loading product approvals...</p>}
          {!loading && token && !error && result && !result.products.length && <p className="px-6 py-12 text-center text-sm text-muted">{debouncedStatus === "pending" ? "No products are waiting for approval. Creator-submitted products will appear here." : "No products match these filters."}</p>}
        </div>
        {result?.pagination && <ProductPagination count={result.products.length} total={result.pagination.total} page={result.pagination.page} pages={result.pagination.pages} itemLabel="products" onPageChange={setPage} />}
      </section>
    </div>
  );
}
