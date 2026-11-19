"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import PublicIcon from "@/components/icons/PublicIcon";
import ProductPagination from "@/components/products/ProductPagination";
import { Badge } from "@/components/ui";
import AdminCommerceTable from "./AdminCommerceTable";
import AdminFinancePayouts from "./AdminFinancePayouts";
import useDebouncedValue from "@/hooks/useDebouncedValue";

export type AdminSection = string;

type DataRow = Record<string, unknown> & { id: string | number };
type DataResponse = {
  records: DataRow[];
  pagination: { page: number; pageSize: number; total: number; pages: number };
};
type PageConfig = {
  title: string;
  description: string;
  columns: { label: string; field: string }[];
  supportsStatus: boolean;
};

const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:5000/api";
const pageConfigs: Record<string, PageConfig> = {
  creators: {
    title: "Creators",
    description: "Review creator accounts and their storefront activity.",
    columns: [
      { label: "Creator", field: "name" },
      { label: "Email", field: "email" },
      { label: "Storefronts", field: "storefrontCount" },
      { label: "Status", field: "status" },
      { label: "Verification", field: "verified" },
      { label: "Joined", field: "createdAt" },
    ],
    supportsStatus: true,
  },
  storefronts: {
    title: "Storefronts",
    description: "View storefronts and their database-backed publishing status.",
    columns: [
      { label: "Storefront", field: "name" },
      { label: "Creator", field: "creatorName" },
      { label: "Products", field: "productCount" },
      { label: "Status", field: "status" },
      { label: "Created", field: "createdAt" },
    ],
    supportsStatus: true,
  },
  products: {
    title: "Products",
    description: "Review product listings, owners, categories, and current prices.",
    columns: [
      { label: "Product", field: "name" },
      { label: "Creator", field: "creatorName" },
      { label: "Category", field: "category" },
      { label: "Price", field: "price" },
      { label: "Status", field: "status" },
      { label: "Updated", field: "updatedAt" },
    ],
    supportsStatus: true,
  },
  files: {
    title: "Product Files",
    description: "Inspect product files and their version associations.",
    columns: [
      { label: "File", field: "name" },
      { label: "Product", field: "productName" },
      { label: "Version", field: "version" },
      { label: "Type", field: "mimeType" },
      { label: "Size", field: "fileSize" },
      { label: "Status", field: "active" },
      { label: "Uploaded", field: "createdAt" },
    ],
    supportsStatus: true,
  },
  versions: {
    title: "Product Versions",
    description: "Review product version history from the database.",
    columns: [
      { label: "Version", field: "version" },
      { label: "Product", field: "productName" },
      { label: "Release notes", field: "releaseNotes" },
      { label: "Status", field: "current" },
      { label: "Created", field: "createdAt" },
    ],
    supportsStatus: true,
  },
  "preview-assets": {
    title: "Preview Assets",
    description: "Inspect product preview assets and activation status.",
    columns: [
      { label: "Asset", field: "name" },
      { label: "Product", field: "productName" },
      { label: "Type", field: "type" },
      { label: "Status", field: "active" },
      { label: "Created", field: "createdAt" },
    ],
    supportsStatus: true,
  },
  downloads: {
    title: "Download Events",
    description: "Review recorded download activity and associated purchases.",
    columns: [
      { label: "Downloaded", field: "downloadedAt" },
      { label: "Buyer", field: "buyerName" },
      { label: "Product", field: "productName" },
      { label: "File", field: "fileName" },
      { label: "Downloads", field: "downloadCount" },
      { label: "IP address", field: "ipAddress" },
    ],
    supportsStatus: true,
  },
  "download-links": {
    title: "Download Access",
    description: "Review issued download access and expiration from the database.",
    columns: [
      { label: "Access ID", field: "id" },
      { label: "Buyer", field: "buyerName" },
      { label: "Product", field: "productName" },
      { label: "File", field: "fileName" },
      { label: "Downloads", field: "downloadCount" },
      { label: "Expires", field: "expiresAt" },
      { label: "Status", field: "status" },
    ],
    supportsStatus: true,
  },
  "content-rights": {
    title: "Content Rights",
    description: "View configured license rules and their storefront scope.",
    columns: [
      { label: "Rule", field: "name" },
      { label: "Applies to", field: "appliesTo" },
      { label: "Type", field: "type" },
      { label: "Storefront", field: "storeName" },
      { label: "Status", field: "active" },
      { label: "Created", field: "createdAt" },
    ],
    supportsStatus: true,
  },
  reviewers: {
    title: "Reviewers",
    description: "Review accounts assigned to content-reviewer roles.",
    columns: [
      { label: "Reviewer", field: "name" },
      { label: "Email", field: "email" },
      { label: "Role", field: "role" },
      { label: "Status", field: "status" },
      { label: "Joined", field: "createdAt" },
    ],
    supportsStatus: true,
  },
  verification: {
    title: "Creator Verification",
    description: "View creator verification status recorded on creator profiles.",
    columns: [
      { label: "Creator", field: "name" },
      { label: "Email", field: "email" },
      { label: "Verification", field: "status" },
      { label: "Account", field: "accountStatus" },
      { label: "Created", field: "createdAt" },
    ],
    supportsStatus: true,
  },
};

function displayValue(field: string, value: unknown, row: DataRow) {
  if (value === null || value === undefined || value === "") return "—";
  if (field === "price") {
    const amount = Number(value);
    const currency = String(row.currency ?? "USD");
    try {
      return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(amount);
    } catch {
      return `${currency} ${amount.toFixed(2)}`;
    }
  }
  if (field === "fileSize") {
    const bytes = Number(value);
    if (!Number.isFinite(bytes)) return String(value);
    if (!bytes) return "0 B";
    const units = ["B", "KB", "MB", "GB", "TB"];
    const unitIndex = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
    return `${(bytes / 1024 ** unitIndex).toFixed(unitIndex ? 1 : 0)} ${units[unitIndex]}`;
  }
  if (field.toLowerCase().includes("at") && typeof value === "string") {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
  }
  if (typeof value === "boolean") {
    if (field === "verified") return value ? "Verified" : "Unverified";
    if (field === "current") return value ? "Current" : "Archived";
    return value ? "Active" : "Inactive";
  }
  return String(value);
}

function statusTone(value: string): "success" | "warning" | "danger" | "neutral" {
  const normalized = value.toLowerCase();
  if (["active", "published", "verified", "current", "completed"].includes(normalized)) return "success";
  if (["pending", "draft", "issued"].includes(normalized)) return "warning";
  if (["inactive", "suspended", "revoked", "rejected", "expired", "archived", "unverified"].includes(normalized)) return "danger";
  return "neutral";
}

function LiveDataPage({ section, config }: { section: string; config: PageConfig }) {
  const [token, setToken] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const debouncedSearch = useDebouncedValue(search.trim());
  const debouncedStatus = useDebouncedValue(status);
  const [page, setPage] = useState(1);
  const [result, setResult] = useState<DataResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const timer = window.setTimeout(() => setToken(window.localStorage.getItem("marketplace-token") ?? ""), 0);
    return () => window.clearTimeout(timer);
  }, []);

  const query = useMemo(() => {
    const params = new URLSearchParams({ page: String(page), pageSize: "10" });
    if (debouncedSearch) params.set("search", debouncedSearch);
    if (debouncedStatus) params.set("status", debouncedStatus);
    return params.toString();
  }, [debouncedSearch, debouncedStatus, page]);

  useEffect(() => {
    if (!token || search.trim() !== debouncedSearch || status !== debouncedStatus) return;
    const controller = new AbortController();
    const load = async () => {
      setLoading(true);
      setError("");
      try {
        const response = await fetch(`${apiUrl}/admin/data/${encodeURIComponent(section)}?${query}`, {
          headers: { Authorization: `Bearer ${token}` },
          signal: controller.signal,
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error ?? `Unable to load ${config.title.toLowerCase()}.`);
        setResult(data as DataResponse);
      } catch (loadError) {
        if (loadError instanceof DOMException && loadError.name === "AbortError") return;
        setResult(null);
        setError(loadError instanceof Error ? loadError.message : `Unable to load ${config.title.toLowerCase()}.`);
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    };
    void load();
    return () => controller.abort();
  }, [config.title, debouncedSearch, debouncedStatus, query, search, section, status, token]);

  const records = result?.records ?? [];
  const pagination = result?.pagination;

  return (
    <div className="mx-auto w-full max-w-[1400px]">
      <header className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="mb-1 text-[10px] font-bold uppercase tracking-[0.1em] text-primary">Administration</p>
          <h1 className="text-2xl font-bold tracking-tight text-heading sm:text-[28px]">{config.title}</h1>
          <p className="mt-1 text-sm text-muted">{config.description}</p>
        </div>
        {section === "products" && <Link href="/admin/products/new" className="inline-flex h-9 items-center gap-2 rounded-lg bg-primary px-4 text-xs font-semibold text-white transition hover:bg-primary-hover"><PublicIcon name="add" className="h-3.5 w-3.5" />Add product</Link>}
      </header>

      <div className="mb-4 flex flex-col gap-2 rounded-xl border border-border bg-white p-4 shadow-sm sm:flex-row">
        <label className="relative min-w-[12rem] flex-1">
          <span className="sr-only">Search {config.title}</span>
          <PublicIcon name="search" className="absolute left-3 top-2.5 h-4 w-4 text-muted-faint" />
          <input value={search} onChange={(event) => { setSearch(event.target.value); setPage(1); }} placeholder={`Search ${config.title.toLowerCase()}...`} className="h-9 w-full rounded-lg border border-border-control pl-9 pr-3 text-xs outline-none focus:border-primary focus:ring-2 focus:ring-orange-100" />
        </label>
        {config.supportsStatus && <label><span className="sr-only">Filter by status</span><select value={status} onChange={(event) => { setStatus(event.target.value); setPage(1); }} className="h-9 min-w-36 rounded-lg border border-border-control bg-white px-3 text-xs text-body"><option value="">All statuses</option>{["active", "inactive", "published", "draft", "pending", "verified", "unverified", "current", "archived", "expired", "revoked", "completed", "issued", "available", "used"].map((item) => <option key={item} value={item}>{item.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase())}</option>)}</select></label>}
      </div>

      {error && <p role="alert" className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}
      {token === "" && <p role="alert" className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">An administrator session is required to load these records.</p>}

      <section className="overflow-hidden rounded-xl border border-border bg-white shadow-sm">
        <div className="border-b border-divider px-5 py-3 text-xs text-muted">{pagination ? `${pagination.total.toLocaleString()} records` : "Database records"}</div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-left text-xs">
            <thead className="bg-surface-muted text-[10px] uppercase tracking-wide text-muted"><tr>{config.columns.map((column) => <th key={column.field} className="px-4 py-3 font-medium">{column.label}</th>)}</tr></thead>
            <tbody>{records.map((row) => <tr key={row.id} className="border-t border-divider text-body hover:bg-surface-hover">{config.columns.map((column, index) => {
              const value = displayValue(column.field, row[column.field], row);
              return <td key={column.field} className={`px-4 py-3 ${index === 0 ? "font-medium text-body-strong" : "text-[11px]"}`}>{column.field === "status" || column.field === "active" || column.field === "verified" || column.field === "current" || column.field === "accountStatus" ? <Badge tone={statusTone(value)}>{value}</Badge> : value}</td>;
            })}</tr>)}</tbody>
          </table>
          {loading && <p className="px-6 py-12 text-center text-sm text-muted">Loading database records...</p>}
          {!loading && !error && token && result && !records.length && <p className="px-6 py-12 text-center text-sm text-muted">No records match these filters.</p>}
        </div>
        {pagination && <ProductPagination count={records.length} total={pagination.total} page={pagination.page} pages={pagination.pages} itemLabel="records" onPageChange={setPage} />}
      </section>
    </div>
  );
}

export default function AdminTablePage({ section }: { section: AdminSection }) {
  if (section === "payouts") return <AdminFinancePayouts />;
  if (["orders", "payments", "refunds", "analytics"].includes(section)) {
    return <AdminCommerceTable section={section as "orders" | "payments" | "refunds" | "analytics"} />;
  }
  const config = pageConfigs[section];
  if (!config) {
    return (
      <div className="mx-auto w-full max-w-[1400px]">
        <header className="mb-6"><p className="mb-1 text-[10px] font-bold uppercase tracking-[0.1em] text-primary">Administration</p><h1 className="text-2xl font-bold tracking-tight text-heading sm:text-[28px]">{section.split("-").map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join(" ")}</h1></header>
        <section role="alert" className="rounded-xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-900">No database-backed admin view is configured for this module yet. No sample records are displayed.</section>
      </div>
    );
  }
  return <LiveDataPage key={section} section={section} config={config} />;
}
