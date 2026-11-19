"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import PublicIcon, { type PublicIconName } from "@/components/icons/PublicIcon";
import ProductPagination from "@/components/products/ProductPagination";
import { Badge, MetricTile } from "@/components/ui";
import useDebouncedValue from "@/hooks/useDebouncedValue";

type CommerceSection = "orders" | "payments" | "refunds" | "analytics";
type Metric = { label: string; value: string; icon: PublicIconName };
type CommerceRow = {
  id?: number;
  orderNumber?: string;
  buyerName?: string;
  buyerEmail?: string;
  creators?: string;
  provider?: string;
  transactionId?: string;
  currency?: string;
  amount?: number | string;
  platformFees?: number | string;
  creatorEarnings?: number | string;
  totalAmount?: number | string;
  status?: string;
  createdAt?: string;
  updatedAt?: string;
  paidAt?: string | null;
  [key: string]: unknown;
};

const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:5000/api";
const statusOptions = [
  "pending",
  "processing",
  "completed",
  "paid",
  "failed",
  "cancelled",
  "expired",
  "refunded",
  "partially_refunded",
];
const currencyFormat = (amount: number | string | undefined, currency = "USD") => {
  const value = Number(amount ?? 0);
  return Number.isFinite(value)
    ? new Intl.NumberFormat("en-US", { style: "currency", currency }).format(value)
    : "—";
};
const dateFormat = (value: string | undefined) =>
  value ? new Date(value).toLocaleString() : "—";
const statusLabel = (value: string | undefined) =>
  (value ?? "unknown").replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
const statusTone = (value: string | undefined): "success" | "warning" | "danger" | "neutral" => {
  if (["completed", "paid"].includes(value ?? "")) return "success";
  if (["pending", "processing"].includes(value ?? "")) return "warning";
  if (["failed", "cancelled", "expired", "refunded", "partially_refunded"].includes(value ?? "")) return "danger";
  return "neutral";
};

const sectionConfig: Record<CommerceSection, { title: string; description: string; endpoint: string }> = {
  orders: {
    title: "Orders",
    description: "Search and review marketplace orders and their verified payment status.",
    endpoint: "/admin/orders",
  },
  payments: {
    title: "Payment Transactions",
    description: "Monitor provider transactions, outcomes, and payment timestamps.",
    endpoint: "/admin/payments",
  },
  refunds: {
    title: "Refund & Dispute Monitoring",
    description: "Monitor payment records marked refunded or partially refunded. Processing refunds requires a provider workflow that is not configured.",
    endpoint: "/admin/refunds",
  },
  analytics: {
    title: "Revenue Reports",
    description: "Review successful order revenue, platform fees, creator earnings, and payment status totals by currency.",
    endpoint: "/admin/revenue",
  },
};

export default function AdminCommerceTable({ section }: { section: CommerceSection }) {
  const config = sectionConfig[section];
  const [rows, setRows] = useState<CommerceRow[]>([]);
  const [metrics, setMetrics] = useState<Metric[]>([]);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [provider, setProvider] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const debouncedSearch = useDebouncedValue(search.trim());
  const debouncedStatus = useDebouncedValue(status);
  const debouncedProvider = useDebouncedValue(provider);
  const debouncedFrom = useDebouncedValue(from);
  const debouncedTo = useDebouncedValue(to);
  const [page, setPage] = useState(1);
  const pageSize = 10;
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const query = useMemo(() => {
    const params = new URLSearchParams();
    if (section !== "analytics") {
      params.set("page", String(page));
      params.set("pageSize", String(pageSize));
      if (debouncedSearch) params.set("search", debouncedSearch);
      if (debouncedStatus) params.set("status", debouncedStatus);
      if (debouncedProvider && section === "payments") params.set("provider", debouncedProvider);
    }
    if (debouncedFrom) params.set("from", debouncedFrom);
    if (debouncedTo) params.set("to", debouncedTo);
    return params.toString();
  }, [debouncedFrom, debouncedProvider, debouncedSearch, debouncedStatus, debouncedTo, page, pageSize, section]);

  useEffect(() => {
    if (search.trim() !== debouncedSearch || status !== debouncedStatus || provider !== debouncedProvider
      || from !== debouncedFrom || to !== debouncedTo) return;
    const controller = new AbortController();
    const load = async () => {
      setLoading(true);
      setError("");
      try {
        const token = window.localStorage.getItem("marketplace-token");
        if (!token) throw new Error("An administrator session is required to load commerce records.");
        const response = await fetch(`${apiUrl}${config.endpoint}${query ? `?${query}` : ""}`, {
          headers: { Authorization: `Bearer ${token}` },
          signal: controller.signal,
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error ?? `Unable to load ${config.title.toLowerCase()}.`);

        if (section === "orders") {
          const summary = data.summary ?? {};
          setRows(data.orders ?? []);
          setTotal(data.pagination?.total ?? 0);
          setMetrics([
            { label: "Total Orders", value: String(summary.totalOrders ?? 0), icon: "receipt" },
            { label: "Successful", value: String(summary.successfulOrders ?? 0), icon: "check" },
            { label: "Processing", value: String(summary.processingOrders ?? 0), icon: "clock-9" },
            { label: "Refunded", value: String(summary.refundedOrders ?? 0), icon: "rotate-ccw" },
          ]);
        } else if (section === "payments") {
          const paymentSummary = (data.summary ?? []) as { status: string; count: number }[];
          const countFor = (values: string[]) =>
            paymentSummary.reduce((sum, item) => sum + (values.includes(item.status) ? Number(item.count) : 0), 0);
          setRows(data.payments ?? []);
          setTotal(data.pagination?.total ?? 0);
          setMetrics([
            { label: "Transactions", value: String(paymentSummary.reduce((sum, item) => sum + Number(item.count), 0)), icon: "receipt" },
            { label: "Successful", value: String(countFor(["paid", "completed"])), icon: "check" },
            { label: "Pending", value: String(countFor(["pending", "processing"])), icon: "clock-9" },
            { label: "Failed / Cancelled", value: String(countFor(["failed", "cancelled", "expired"])), icon: "x" },
          ]);
        } else if (section === "refunds") {
          setRows(data.refunds ?? []);
          setTotal(data.pagination?.total ?? 0);
          setMetrics([
            { label: "Matching Records", value: String(data.pagination?.total ?? 0), icon: "receipt" },
          ]);
        } else {
          const currencies = (data.currencies ?? []) as {
            currency: string;
            orders: number;
            revenue: number | string;
            platformFees: number | string;
            creatorEarnings: number | string;
          }[];
          const summary = Array.isArray(data.summary) ? data.summary[0] : data.summary;
          setRows(currencies.map((item) => ({
            currency: item.currency,
            amount: item.revenue,
            platformFees: item.platformFees,
            creatorEarnings: item.creatorEarnings,
            status: `${item.orders} successful orders`,
          })));
          setTotal(currencies.length);
          setMetrics([
            { label: "Successful Orders", value: String(summary?.successfulOrders ?? 0), icon: "check" },
            ...currencies.flatMap((item) => [
              { label: `${item.currency} Total Sales`, value: currencyFormat(item.revenue, item.currency), icon: "receipt" as const },
              { label: `${item.currency} Platform Fees`, value: currencyFormat(item.platformFees, item.currency), icon: "dollar" as const },
              { label: `${item.currency} Creator Earnings`, value: currencyFormat(item.creatorEarnings, item.currency), icon: "user" as const },
            ]),
          ]);
        }
      } catch (loadError) {
        if (loadError instanceof DOMException && loadError.name === "AbortError") return;
        setRows([]);
        setMetrics([]);
        setTotal(0);
        setError(loadError instanceof Error ? loadError.message : `Unable to load ${config.title.toLowerCase()}.`);
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    };
    void load();
    return () => controller.abort();
  }, [config.endpoint, config.title, debouncedFrom, debouncedProvider, debouncedSearch, debouncedStatus, debouncedTo, from, page, provider, query, search, section, status, to]);

  const providers = [...new Set(rows.map((row) => row.provider).filter((value): value is string => Boolean(value)))];
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const columns = section === "orders"
    ? ["Order", "Customer", "Creators", "Amount", "Status", "Ordered At", "Actions"]
    : section === "payments"
      ? ["Order", "Customer", "Provider", "Transaction ID", "Amount", "Status", "Created At", "Actions"]
      : section === "refunds"
        ? ["Order", "Customer", "Provider", "Transaction ID", "Amount", "Status", "Updated At", "Actions"]
        : ["Currency", "Total Sales", "Platform Fee", "Creator Earnings", "Successful Orders"];

  const exportCsv = () => {
    const values = section === "analytics"
      ? rows.map((row) => [
        row.currency ?? "",
        currencyFormat(row.amount, row.currency),
        currencyFormat(row.platformFees, row.currency),
        currencyFormat(row.creatorEarnings, row.currency),
        row.status ?? "",
      ])
      : rows.map((row) => section === "orders"
        ? [row.orderNumber ?? "", row.buyerName ?? "", row.creators ?? "", currencyFormat(row.totalAmount, row.currency), row.status ?? "", dateFormat(row.createdAt), ""]
        : [row.orderNumber ?? "", row.buyerName ?? "", row.provider ?? "", row.transactionId ?? "", currencyFormat(row.amount, row.currency), row.status ?? "", dateFormat(section === "refunds" ? row.updatedAt : row.createdAt), ""]);
    const csv = [columns, ...values]
      .map((record) => record.map((value) => `"${String(value).replaceAll('"', '""')}"`).join(","))
      .join("\r\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${section}-page-${page}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="mx-auto w-full max-w-[1400px]">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="mb-1 text-[10px] font-bold uppercase tracking-[0.1em] text-primary">Administration</p>
          <h1 className="text-2xl font-bold tracking-tight text-heading sm:text-[28px]">{config.title}</h1>
          <p className="mt-1 text-sm text-muted">{config.description}</p>
        </div>
        <button type="button" onClick={exportCsv} disabled={loading || rows.length === 0} className="inline-flex items-center gap-2 self-start rounded-lg border border-border-control px-3 py-2 text-xs font-semibold text-body transition hover:border-primary hover:text-primary disabled:cursor-not-allowed disabled:opacity-50">
          <PublicIcon name="download" className="h-3.5 w-3.5" /> Export current page
        </button>
      </header>

      {metrics.length > 0 && <div className="mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {metrics.map((metric) => <MetricTile key={metric.label} label={metric.label} value={metric.value} icon={<PublicIcon name={metric.icon} className="h-5 w-5" />} />)}
      </div>}

      <section className={`${metrics.length > 0 ? "mt-5" : "mt-6"} overflow-visible rounded-2xl border border-border bg-white shadow-sm`}>
        <div className="flex flex-col gap-2 border-b border-divider px-4 py-3 sm:px-5">
          <div className="flex flex-wrap gap-2">
            {section !== "analytics" && <>
              <label className="relative min-w-[12rem] flex-1 sm:max-w-[18rem]">
                <span className="sr-only">Search {config.title}</span>
                <PublicIcon name="search" className="absolute left-3 top-2.5 h-4 w-4 text-muted-faint" />
                <input value={search} onChange={(event) => { setSearch(event.target.value); setPage(1); }} placeholder={`Search ${config.title.toLowerCase()}...`} className="h-9 w-full rounded-lg border border-border-control pl-9 pr-3 text-xs text-body outline-none placeholder:text-muted-faint focus:border-primary focus:ring-2 focus:ring-orange-100" />
              </label>
              <select aria-label="Filter by status" value={status} onChange={(event) => { setStatus(event.target.value); setPage(1); }} className="select-chevron h-9 rounded-lg border border-border-control bg-white px-3 pr-8 text-xs text-body outline-none focus:border-primary">
                <option value="">All statuses</option>
                {statusOptions.map((option) => <option key={option} value={option}>{statusLabel(option)}</option>)}
              </select>
              {section === "payments" && <select aria-label="Filter by provider" value={provider} onChange={(event) => { setProvider(event.target.value); setPage(1); }} className="select-chevron h-9 rounded-lg border border-border-control bg-white px-3 pr-8 text-xs text-body outline-none focus:border-primary">
                <option value="">All providers</option>
                {providers.map((option) => <option key={option} value={option}>{option}</option>)}
              </select>}
            </>}
            <label className="flex items-center gap-2 text-[10px] text-muted">From <input aria-label="From date" type="date" value={from} onChange={(event) => { setFrom(event.target.value); setPage(1); }} className="h-9 rounded-lg border border-border-control px-2 text-xs text-body" /></label>
            <label className="flex items-center gap-2 text-[10px] text-muted">To <input aria-label="To date" type="date" value={to} onChange={(event) => { setTo(event.target.value); setPage(1); }} className="h-9 rounded-lg border border-border-control px-2 text-xs text-body" /></label>
          </div>
          {error && <p role="alert" className="text-xs text-status-danger">{error}</p>}
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-left text-xs">
            <thead className="bg-surface-muted text-[10px] font-medium uppercase tracking-[0.08em] text-muted">
              <tr>{columns.map((column) => <th key={column} className="px-4 py-3 font-medium">{column}</th>)}</tr>
            </thead>
            <tbody>
              {section === "orders" && rows.map((row, index) => <tr key={row.id ?? index} className="border-t border-divider text-body hover:bg-surface-hover">
                <td className="px-4 py-3 font-medium"><Link href={`/admin/orders/${encodeURIComponent(row.orderNumber ?? "")}`} className="text-primary hover:underline">{row.orderNumber}</Link></td>
                <td className="px-4 py-3">{row.buyerName}<span className="block text-[10px] text-muted">{row.buyerEmail}</span></td>
                <td className="px-4 py-3">{row.creators || "—"}</td>
                <td className="px-4 py-3">{currencyFormat(row.totalAmount, row.currency)}</td>
                <td className="px-4 py-3"><Badge tone={statusTone(row.status)}>{statusLabel(row.status)}</Badge></td>
                <td className="px-4 py-3">{dateFormat(row.createdAt)}</td>
                <td className="px-4 py-3"><Link href={`/admin/orders/${encodeURIComponent(row.orderNumber ?? "")}`} className="text-primary hover:underline">Details</Link></td>
              </tr>)}
              {(section === "payments" || section === "refunds") && rows.map((row, index) => <tr key={row.id ?? index} className="border-t border-divider text-body hover:bg-surface-hover">
                <td className="px-4 py-3 font-medium"><Link href={`/admin/orders/${encodeURIComponent(row.orderNumber ?? "")}`} className="text-primary hover:underline">{row.orderNumber}</Link></td>
                <td className="px-4 py-3">{row.buyerName}<span className="block text-[10px] text-muted">{row.buyerEmail}</span></td>
                <td className="px-4 py-3">{row.provider || "—"}</td>
                <td className="px-4 py-3">{row.transactionId || "—"}</td>
                <td className="px-4 py-3">{currencyFormat(row.amount, row.currency)}</td>
                <td className="px-4 py-3"><Badge tone={statusTone(row.status)}>{statusLabel(row.status)}</Badge></td>
                <td className="px-4 py-3">{dateFormat(section === "refunds" ? row.updatedAt : row.createdAt)}</td>
                <td className="px-4 py-3"><Link href={`/admin/orders/${encodeURIComponent(row.orderNumber ?? "")}`} className="text-primary hover:underline">Details</Link></td>
              </tr>)}
              {section === "analytics" && rows.map((row, index) => <tr key={`${row.currency}-${index}`} className="border-t border-divider text-body">
                <td className="px-4 py-3 font-medium">{row.currency}</td>
                <td className="px-4 py-3">{currencyFormat(row.amount, row.currency)}</td>
                <td className="px-4 py-3">{currencyFormat(row.platformFees, row.currency)}</td>
                <td className="px-4 py-3">{currencyFormat(row.creatorEarnings, row.currency)}</td>
                <td className="px-4 py-3">{row.status}</td>
              </tr>)}
            </tbody>
          </table>
          {loading && <p className="px-6 py-10 text-center text-sm text-muted">Loading records…</p>}
          {!loading && !error && rows.length === 0 && <p className="px-6 py-10 text-center text-sm text-muted">No matching records.</p>}
        </div>
        {section !== "analytics" && <ProductPagination count={rows.length} total={total} page={page} pages={pageCount} itemLabel="records" onPageChange={setPage} />}
      </section>
    </div>
  );
}
