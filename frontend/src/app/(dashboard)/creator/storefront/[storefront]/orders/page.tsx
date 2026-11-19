"use client";

import Link from "next/link";
import Image from "next/image";
import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import PublicIcon from "@/components/icons/PublicIcon";
import ProductPagination from "@/components/products/ProductPagination";
import { Badge, Button, InputText, MetricTile, Table, TableHeader, TableRow } from "@/components/ui";
import useDebouncedValue from "@/hooks/useDebouncedValue";

type OrderStatus = "pending" | "processing" | "paid" | "completed" | "failed" | "expired" | "cancelled" | "refunded" | "partially_refunded";
type CreatorOrder = {
  id: number;
  orderNumber: string;
  buyerName: string;
  buyerEmail: string;
  buyerAvatarUrl?: string | null;
  products: string[];
  productPreviewUrl?: string | null;
  salesAmount: number | string;
  currency: string;
  status: OrderStatus;
  createdAt: string;
};
type EarningsSummary = {
  currency: string;
  totalOrders: number;
  successfulOrders: number;
  pendingOrders: number;
  failedOrders: number;
  grossSales: number | string;
};

const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:5000/api";
const PAGE_SIZE = 10;
const statusTabs = ["pending", "processing", "paid", "completed", "failed", "expired", "cancelled", "refunded", "partially_refunded"] as const;
const statusTone: Record<OrderStatus, "success" | "primary" | "warning" | "danger"> = {
  pending: "warning",
  processing: "primary",
  paid: "success",
  completed: "success",
  failed: "danger",
  expired: "danger",
  cancelled: "danger",
  refunded: "danger",
  partially_refunded: "warning",
};

function formatStatus(status: string) {
  return status.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function formatMoney(value: number | string, currency: string) {
  return new Intl.NumberFormat(undefined, { style: "currency", currency }).format(Number(value) || 0);
}

function imageSource(url: string) {
  if (/^(https?:\/\/|data:)/i.test(url)) return url;
  const apiOrigin = apiUrl.replace(/\/api\/?$/, "");
  return `${apiOrigin}${url.startsWith("/") ? url : `/${url}`}`;
}

function exportOrders(orders: CreatorOrder[]) {
  const rows = [
    ["Order Number", "Buyer", "Email", "Products", "Amount", "Currency", "Status", "Date"],
    ...orders.map((order) => [order.orderNumber, order.buyerName, order.buyerEmail, order.products.join("; "), String(order.salesAmount), order.currency, order.status, order.createdAt]),
  ];
  const csv = rows.map((row) => row.map((cell) => `"${cell.replaceAll('"', '""')}"`).join(",")).join("\r\n");
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = "creator-orders.csv";
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function FilterSelects({
  products,
  product,
  status,
  setProduct,
  setStatus,
}: {
  products: string[];
  product: string;
  status: string;
  setProduct: (value: string) => void;
  setStatus: (value: string) => void;
}) {
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      <select aria-label="Product filter" value={product} onChange={(event) => setProduct(event.target.value)} className="h-9 rounded-lg border border-border-control bg-white px-3 text-xs text-body outline-none focus:border-primary">
        <option value="">All Products</option>
        {products.map((item) => <option key={item}>{item}</option>)}
      </select>
      <select aria-label="Status filter" value={status} onChange={(event) => setStatus(event.target.value)} className="h-9 rounded-lg border border-border-control bg-white px-3 text-xs text-body outline-none focus:border-primary">
        <option value="">All Status</option>
        {statusTabs.map((item) => <option key={item} value={item}>{formatStatus(item)}</option>)}
      </select>
    </div>
  );
}

export default function CreatorOrdersPage() {
  const params = useParams<{ storefront: string }>();
  const storefrontName = String(params.storefront || "");
  const [activeTab, setActiveTab] = useState("");
  const [search, setSearch] = useState("");
  const [productFilter, setProductFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const debouncedSearch = useDebouncedValue(search.trim());
  const debouncedProductFilter = useDebouncedValue(productFilter);
  const debouncedStatusFilter = useDebouncedValue(statusFilter);
  const debouncedActiveTab = useDebouncedValue(activeTab);
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false);
  const [orders, setOrders] = useState<CreatorOrder[]>([]);
  const [summaries, setSummaries] = useState<EarningsSummary[]>([]);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const products = useMemo(() => Array.from(new Set(orders.flatMap((order) => order.products))), [orders]);

  useEffect(() => {
    if (search.trim() !== debouncedSearch || productFilter !== debouncedProductFilter
      || statusFilter !== debouncedStatusFilter || activeTab !== debouncedActiveTab) return;
    const controller = new AbortController();
    const load = async () => {
      setLoading(true);
      setError("");
      try {
        const token = window.localStorage.getItem("marketplace-token");
        if (!token) throw new Error("Please sign in with your creator account.");
        const headers = { Authorization: `Bearer ${token}` };
        const query = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE) });
        const selectedStatus = debouncedActiveTab || debouncedStatusFilter;
        if (selectedStatus) query.set("status", selectedStatus);
        if (debouncedSearch) query.set("search", debouncedSearch);
        if (debouncedProductFilter) query.set("product", debouncedProductFilter);
        const base = `${apiUrl}/creator/storefronts/${encodeURIComponent(storefrontName)}`;
        const [ordersResponse, earningsResponse] = await Promise.all([
          fetch(`${base}/orders?${query}`, { headers, cache: "no-store", signal: controller.signal }),
          fetch(`${base}/earnings`, { headers, cache: "no-store", signal: controller.signal }),
        ]);
        const [ordersData, earningsData] = await Promise.all([ordersResponse.json(), earningsResponse.json()]);
        if (!ordersResponse.ok) throw new Error(ordersData.error || "Unable to load sales orders.");
        if (!earningsResponse.ok) throw new Error(earningsData.error || "Unable to load earnings.");
        setOrders(ordersData.orders || []);
        setTotal(Number(ordersData.pagination?.total || 0));
        setTotalPages(Number(ordersData.pagination?.totalPages || 1));
        setSummaries(Array.isArray(earningsData.summary) ? earningsData.summary : []);
      } catch (loadError) {
        if (!controller.signal.aborted) {
          setError(loadError instanceof Error ? loadError.message : "Unable to load sales orders.");
          setOrders([]);
          setSummaries([]);
        }
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    };
    void load();
    return () => controller.abort();
  }, [activeTab, debouncedActiveTab, debouncedProductFilter, debouncedSearch, debouncedStatusFilter, page, productFilter, search, statusFilter, storefrontName]);

  const currency = orders[0]?.currency || "USD";
  const summary = summaries.find((item) => item.currency === currency) || summaries[0] || null;
  const shownOrders = orders;
  const summaryCards = [
    ["Total Orders", String(summary?.totalOrders ?? "—"), "All storefront orders", "shopping-cart"],
    ["Gross Sales", summary ? formatMoney(summary.grossSales, currency) : "—", "Paid and completed orders", "dollar"],
    ["Successful Orders", String(summary?.successfulOrders ?? "—"), "Paid or completed", "verified"],
    ["Pending Orders", String(summary?.pendingOrders ?? "—"), "Awaiting payment", "notification"],
    ["Failed Orders", String(summary?.failedOrders ?? "—"), "Failed or cancelled", "delete"],
  ] as const;

  return <div className="mx-auto w-full max-w-[1400px]">
    <header className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
      <div><h1 className="text-2xl font-bold tracking-tight text-heading sm:text-[28px]">Orders</h1><p className="mt-1 text-sm text-muted">Manage your customer orders and digital product deliveries.</p></div>
      <Button size="sm" variant="secondary" disabled={loading || orders.length === 0} onClick={() => exportOrders(orders)}><PublicIcon name="down" className="h-4 w-4 rotate-180" />Export current page</Button>
    </header>
    <section className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
      {summaryCards.map(([label, value, detail, icon]) => <MetricTile key={label} label={label} value={value} change={detail} icon={<PublicIcon name={icon} className="h-5 w-5" />} iconClassName="text-primary" />)}
    </section>
    <section className="mt-5 overflow-hidden rounded-2xl border border-border bg-white shadow-sm">
      <div className="border-b border-divider px-5 pt-4 sm:px-6">
        <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
          <nav className="flex shrink-0 gap-5 overflow-x-auto" aria-label="Order status filters">
            {["", ...statusTabs].map((tab) => <button key={tab || "all"} type="button" onClick={() => { setActiveTab(tab); setPage(1); }} className={`relative whitespace-nowrap pb-3 text-[10px] font-semibold ${activeTab === tab ? "text-primary" : "text-tab-muted hover:text-body"}`}>{tab ? formatStatus(tab) : "All Orders"}{activeTab === tab && <span className="absolute inset-x-0 bottom-0 h-0.5 rounded-full bg-primary" />}</button>)}
          </nav>
          <div className="flex min-w-0 flex-1 gap-2 pb-4 xl:max-w-[900px]">
            <label className="relative min-w-0 flex-1"><span className="sr-only">Search orders</span><PublicIcon name="search" className="absolute left-3 top-2.5 h-4 w-4 text-muted-faint" /><InputText value={search} onChange={(event) => { setSearch(event.target.value); setPage(1); }} placeholder="Search order ID, customer, product or transaction..." className="h-9 pl-9 pr-3 text-xs" /></label>
            <div className="hidden min-w-0 flex-1 xl:block"><FilterSelects products={products} product={productFilter} status={statusFilter} setProduct={(value) => { setProductFilter(value); setPage(1); }} setStatus={(value) => { setStatusFilter(value); setActiveTab(""); setPage(1); }} /></div>
            <Button size="sm" variant="secondary" className="shrink-0 xl:hidden" onClick={() => setMobileFiltersOpen((open) => !open)}><PublicIcon name="settings" className="h-3.5 w-3.5" />Filters</Button>
            <Button size="sm" variant="secondary" className="hidden shrink-0 xl:inline-flex" onClick={() => setMobileFiltersOpen((open) => !open)}><PublicIcon name="settings" className="h-3.5 w-3.5" />Filters</Button>
          </div>
        </div>
        <div className={`${mobileFiltersOpen ? "block" : "hidden"} border-t border-divider py-3 xl:hidden`}><FilterSelects products={products} product={productFilter} status={statusFilter} setProduct={(value) => { setProductFilter(value); setPage(1); }} setStatus={(value) => { setStatusFilter(value); setActiveTab(""); setPage(1); }} /></div>
      </div>
      {error && <p role="alert" className="border-b border-divider px-5 py-3 text-xs text-status-danger">{error}</p>}
      {loading ? <p className="px-6 py-10 text-center text-sm text-muted">Loading storefront orders...</p> : <Table className="min-w-[980px]">
        <TableHeader><tr><th className="px-6 py-3 font-medium">Order ID</th><th className="py-3 font-medium">Customer</th><th className="py-3 font-medium">Product</th><th className="py-3 font-medium">Amount</th><th className="py-3 font-medium">Status</th><th className="py-3 font-medium">Date</th><th className="px-6 py-3 text-right font-medium">Actions</th></tr></TableHeader>
        <tbody>{shownOrders.map((order) => <TableRow key={order.id} className="text-body transition hover:bg-surface-hover">
          <td className="px-6 py-3 text-[10px] font-medium text-body-strong">{order.orderNumber}</td>
          <td className="py-3"><div className="flex items-center gap-2"><span className="relative grid h-8 w-8 shrink-0 place-items-center overflow-hidden rounded-full bg-primary text-[10px] font-semibold text-white"><span aria-hidden="true">{order.buyerName?.charAt(0) || "B"}</span>{order.buyerAvatarUrl && <Image src={imageSource(order.buyerAvatarUrl)} alt={`${order.buyerName || "Buyer"}'s profile`} width={32} height={32} unoptimized className="absolute inset-0 h-full w-full object-cover" onError={(event) => { event.currentTarget.style.display = "none"; }} />}</span><span><strong className="block text-[10px] text-body-strong">{order.buyerName || "Buyer"}</strong><span className="block text-[8px] text-muted-soft">{order.buyerEmail}</span></span></div></td>
          <td className="py-3"><div className="flex items-center gap-2"><span className="relative grid h-9 w-9 shrink-0 place-items-center overflow-hidden rounded-md bg-accent-light text-[10px] text-primary"><PublicIcon name="product" className="h-4 w-4" />{order.productPreviewUrl && <Image src={imageSource(order.productPreviewUrl)} alt={`${order.products[0] || "Product"} preview`} width={36} height={36} unoptimized className="absolute inset-0 h-full w-full object-cover" onError={(event) => { event.currentTarget.style.display = "none"; }} />}</span><strong className="max-w-[200px] truncate text-[10px] text-body-strong">{order.products.join(", ")}</strong></div></td>
          <td className="py-3 font-semibold text-primary">{formatMoney(order.salesAmount, order.currency)}</td>
          <td className="py-3"><Badge tone={statusTone[order.status] || "warning"}>{formatStatus(order.status)}</Badge></td>
          <td className="py-3 whitespace-nowrap text-muted"><span className="block">{new Date(order.createdAt).toLocaleDateString()}</span><span className="text-[8px]">{new Date(order.createdAt).toLocaleTimeString()}</span></td>
          <td className="px-6 py-3 text-right"><Link href={`/creator/storefront/${encodeURIComponent(storefrontName)}/orders/${order.id}`} aria-label={`View ${order.orderNumber}`} className="inline-grid h-7 w-7 place-items-center rounded-md border border-border-action text-muted hover:border-primary hover:text-primary"><PublicIcon name="view" className="h-3.5 w-3.5" /></Link></td>
        </TableRow>)}</tbody>
      </Table>}
      {!loading && !error && shownOrders.length === 0 && <p className="px-6 py-12 text-center text-sm text-muted">No orders match your filters.</p>}
      <ProductPagination count={shownOrders.length} total={total} page={page} pages={totalPages} itemLabel="orders" onPageChange={setPage} />
    </section>
  </div>;
}
