"use client";

import { useEffect, useState } from "react";
import PublicIcon from "@/components/icons/PublicIcon";
import ProductPagination from "@/components/products/ProductPagination";
import useDebouncedValue from "@/hooks/useDebouncedValue";

type ActivityView = "downloads" | "redownloads" | "refunds";
type Props = { view: ActivityView; storefrontName: string };
type CustomerCell = { name: string; email: string };
type ActivityRow = { id: string; cells: Array<string | CustomerCell>; status?: string };
type Pagination = { page: number; total: number; totalPages: number };
type ActivityResponse = {
  downloads?: Array<{
    id: number;
    downloadedAt: string;
    customerName: string | null;
    customerEmail: string | null;
    productName: string;
    fileName: string;
    downloadCount: number;
    ipAddress: string | null;
  }>;
  refunds?: Array<{
    id: number;
    refundReference: string | null;
    createdAt: string;
    customerName: string | null;
    customerEmail: string | null;
    productName: string;
    amount: number | string;
    currency: string;
    reason: string;
    status: string;
  }>;
  pagination: Pagination;
};

const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:5000/api";
const PAGE_SIZE = 10;

const config = {
  downloads: {
    title: "Download Activity",
    description: "Track downloads of files from your storefront.",
    search: "Search customer, product, file or order...",
    headers: ["Date", "Customer", "Product / File", "Downloads", "IP Address"],
  },
  redownloads: {
    title: "Re-download Requests",
    description: "Customer re-download requests are not available in the current app.",
    search: "",
    headers: [],
  },
  refunds: {
    title: "Refund History",
    description: "Refunds recorded for paid orders in this storefront.",
    search: "Search customer, product, order or refund reference...",
    headers: ["Refund Ref", "Date", "Customer", "Product", "Amount", "Provider Note", "Order Status"],
  },
} as const;

function formatDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function formatCurrency(value: number | string, currency: string) {
  return new Intl.NumberFormat(undefined, { style: "currency", currency }).format(Number(value) || 0);
}

function exportRows(view: Exclude<ActivityView, "redownloads">, headers: readonly string[], rows: ActivityRow[]) {
  const csvRows = [
    [...headers],
    ...rows.map((row) => row.cells.map((cell) =>
      typeof cell === "string" ? cell : `${cell.name} <${cell.email}>`,
    )),
  ];
  const csv = csvRows.map((row) => row.map((cell) => `"${cell.replaceAll('"', '""')}"`).join(",")).join("\r\n");
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `storefront-${view}.csv`;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function customerCell(name: string | null, email: string | null): CustomerCell {
  return { name: name || "Customer", email: email || "" };
}

export default function CreatorActivityManager({ view, storefrontName }: Props) {
  const pageConfig = config[view];
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebouncedValue(search.trim());
  const [rows, setRows] = useState<ActivityRow[]>([]);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(view !== "redownloads");
  const [error, setError] = useState("");

  useEffect(() => {
    if (view === "redownloads" || search.trim() !== debouncedSearch) return;

    const controller = new AbortController();
    const loadActivity = async () => {
      setLoading(true);
      setError("");
      try {
        const token = window.localStorage.getItem("marketplace-token");
        if (!token) throw new Error("Please sign in with your creator account.");

        const query = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE) });
        if (debouncedSearch) query.set("search", debouncedSearch);
        const endpoint = view === "downloads" ? "downloads" : "refunds";
        const response = await fetch(
          `${apiUrl}/creator/storefronts/${encodeURIComponent(storefrontName)}/${endpoint}?${query}`,
          {
            headers: { Authorization: `Bearer ${token}` },
            cache: "no-store",
            signal: controller.signal,
          },
        );
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || `Unable to load ${pageConfig.title.toLowerCase()}.`);

        const result = data as ActivityResponse;
        const nextRows: ActivityRow[] = view === "downloads"
          ? (result.downloads || []).map((item) => ({
            id: String(item.id),
            cells: [
              formatDate(item.downloadedAt),
              customerCell(item.customerName, item.customerEmail),
              `${item.productName} · ${item.fileName}`,
              String(item.downloadCount),
              item.ipAddress || "Not recorded",
            ],
          }))
          : (result.refunds || []).map((item) => ({
            id: String(item.id),
            cells: [
              item.refundReference || `#${item.id}`,
              formatDate(item.createdAt),
              customerCell(item.customerName, item.customerEmail),
              item.productName,
              formatCurrency(item.amount, item.currency),
              item.reason,
              item.status.replaceAll("_", " "),
            ],
            status: item.status,
          }));
        setRows(nextRows);
        setTotal(Number(result.pagination.total) || 0);
        setTotalPages(Math.max(1, Number(result.pagination.totalPages) || 1));
      } catch (loadError) {
        if (!controller.signal.aborted) {
          setError(loadError instanceof Error ? loadError.message : `Unable to load ${pageConfig.title.toLowerCase()}.`);
          setRows([]);
          setTotal(0);
          setTotalPages(1);
        }
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    };

    void loadActivity();
    return () => controller.abort();
  }, [debouncedSearch, page, pageConfig.title, search, storefrontName, view]);

  if (view === "redownloads") {
    return (
      <div className="mx-auto w-full max-w-[1400px]">
        <header>
          <h1 className="text-2xl font-bold tracking-tight text-heading sm:text-[28px]">{pageConfig.title}</h1>
          <p className="mt-1 text-sm text-muted">{pageConfig.description}</p>
        </header>
        <section className="mt-6 rounded-2xl border border-border bg-white px-6 py-12 text-center shadow-sm">
          <p className="text-sm font-semibold text-heading">No re-download requests are recorded</p>
          <p className="mt-2 text-sm text-muted">
            Customers cannot submit re-download requests yet, so there is no request history to display.
          </p>
        </section>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-[1400px]">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-heading sm:text-[28px]">{pageConfig.title}</h1>
          <p className="mt-1 text-sm text-muted">{pageConfig.description}</p>
        </div>
        <button
          type="button"
          disabled={loading || rows.length === 0}
          onClick={() => exportRows(view, pageConfig.headers, rows)}
          className="inline-flex items-center justify-center gap-2 rounded-lg border border-border-control bg-white px-3.5 py-2 text-xs font-semibold text-body hover:bg-surface-control disabled:cursor-not-allowed disabled:opacity-50"
        >
          <PublicIcon name="down" className="h-3.5 w-3.5 rotate-180" />
          Export current page
        </button>
      </header>

      <section className="mt-6 overflow-hidden rounded-2xl border border-border bg-white shadow-sm">
        <div className="flex flex-col gap-3 border-b border-divider px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <h2 className="text-sm font-bold text-heading">{pageConfig.title}</h2>
          <label className="relative sm:w-80">
            <span className="sr-only">{pageConfig.search}</span>
            <PublicIcon name="search" className="absolute left-3 top-2.5 h-4 w-4 text-muted-faint" />
            <input
              value={search}
              onChange={(event) => {
                setSearch(event.target.value);
                setPage(1);
              }}
              placeholder={pageConfig.search}
              className="h-9 w-full rounded-lg border border-border-control pl-9 pr-3 text-xs text-body outline-none placeholder:text-muted-faint focus:border-primary"
            />
          </label>
        </div>

        {error && <p role="alert" className="border-b border-divider px-5 py-3 text-xs text-status-danger">{error}</p>}
        {loading && <p className="px-6 py-3 text-center text-xs text-muted">Loading {pageConfig.title.toLowerCase()}...</p>}
        <div className="overflow-x-auto">
          <table className="w-full min-w-[900px] text-left text-xs">
            <thead className="bg-surface-muted text-[10px] text-muted">
              <tr>{pageConfig.headers.map((header) => <th key={header} className="px-5 py-3 font-medium">{header}</th>)}</tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className="border-t border-divider text-body transition hover:bg-surface-hover">
                  {row.cells.map((cell, index) => (
                    <td key={`${row.id}-${index}`} className="max-w-[260px] px-5 py-3 text-[10px]">
                      {typeof cell === "string"
                        ? row.status && index === row.cells.length - 1
                          ? <span className="capitalize">{cell}</span>
                          : cell
                        : (
                          <span>
                            <strong className="block font-semibold text-body-strong">{cell.name}</strong>
                            <span className="text-muted">{cell.email}</span>
                          </span>
                        )}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          {!loading && !error && rows.length === 0 && (
            <p className="px-6 py-12 text-center text-sm text-muted">
              {view === "downloads" ? "No download activity found." : "No recorded refunds found."}
            </p>
          )}
        </div>
        <ProductPagination
          count={rows.length}
          total={total}
          page={page}
          pages={totalPages}
          itemLabel={view === "downloads" ? "downloads" : "refunds"}
          onPageChange={setPage}
        />
      </section>
    </div>
  );
}
