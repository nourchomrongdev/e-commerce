"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import PublicIcon from "@/components/icons/PublicIcon";
import ProductPagination from "@/components/products/ProductPagination";
import { Badge } from "@/components/ui";

type ReviewReport = {
  id: number;
  reviewId: number;
  reason: "spam" | "offensive" | "false_information" | "other";
  details: string | null;
  status: "pending" | "dismissed" | "actioned";
  createdAt: string;
  decisionReason: string | null;
  rating: number;
  title: string | null;
  comment: string | null;
  reviewStatus: string;
  productName: string;
  reporterName: string;
  reporterEmail: string;
};

type ReportResponse = {
  reports: ReviewReport[];
  summary: { total: number; pending: number; actioned: number; dismissed: number };
  pagination: { page: number; pageSize: number; total: number; pages: number };
};

const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:5000/api";
const reasonLabels: Record<ReviewReport["reason"], string> = {
  spam: "Spam",
  offensive: "Offensive content",
  false_information: "False information",
  other: "Other",
};

export default function ReviewReportsDataPage() {
  const [token, setToken] = useState("");
  const [searchDraft, setSearchDraft] = useState("");
  const [search, setSearch] = useState("");
  const [statusDraft, setStatusDraft] = useState("pending");
  const [status, setStatus] = useState("pending");
  const [pageNumber, setPageNumber] = useState(1);
  const [result, setResult] = useState<ReportResponse | null>(null);
  const [reasonById, setReasonById] = useState<Record<number, string>>({});
  const [loading, setLoading] = useState(false);
  const [workingId, setWorkingId] = useState<number | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [refresh, setRefresh] = useState(0);

  useEffect(() => {
    const timer = window.setTimeout(() => setToken(window.localStorage.getItem("marketplace-token") ?? ""), 0);
    return () => window.clearTimeout(timer);
  }, []);

  const query = useMemo(() => {
    const params = new URLSearchParams({ page: String(pageNumber), pageSize: "10" });
    if (search) params.set("search", search);
    if (status) params.set("status", status);
    return params.toString();
  }, [pageNumber, search, status]);

  useEffect(() => {
    if (!token) return;
    const controller = new AbortController();
    const load = async () => {
      setLoading(true);
      setError("");
      try {
        const response = await fetch(`${apiUrl}/admin/review-reports?${query}`, {
          headers: { Authorization: `Bearer ${token}` },
          cache: "no-store",
          signal: controller.signal,
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Unable to load review reports.");
        setResult(data as ReportResponse);
      } catch (loadError) {
        if (loadError instanceof DOMException && loadError.name === "AbortError") return;
        setResult(null);
        setError(loadError instanceof Error ? loadError.message : "Unable to load review reports.");
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    };
    void load();
    return () => controller.abort();
  }, [query, refresh, token]);

  const applyFilters = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setPageNumber(1);
    setSearch(searchDraft.trim());
    setStatus(statusDraft);
  };

  const decide = async (report: ReviewReport, action: "dismiss" | "remove_review") => {
    setWorkingId(report.id);
    setError("");
    setNotice("");
    try {
      const response = await fetch(`${apiUrl}/admin/review-reports/${report.id}`, {
        method: "PATCH",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ action, reason: reasonById[report.id]?.trim() || "" }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Unable to update this report.");
      setNotice(action === "dismiss" ? `Report #${report.id} dismissed.` : `Review #${report.reviewId} removed.`);
      setRefresh((current) => current + 1);
    } catch (decisionError) {
      setError(decisionError instanceof Error ? decisionError.message : "Unable to update this report.");
    } finally {
      setWorkingId(null);
    }
  };

  return (
    <div className="mx-auto w-full max-w-[1400px]">
      <header className="mb-5">
        <p className="mb-1 text-[10px] font-bold uppercase tracking-[0.1em] text-primary">Reviews management</p>
        <h1 className="text-2xl font-bold tracking-tight text-heading sm:text-[28px]">Reported Reviews</h1>
        <p className="mt-1 text-sm text-muted">Review user-submitted reports and take action on published reviews.</p>
      </header>

      {result?.summary && (
        <section className="mb-5 grid gap-3 sm:grid-cols-3">
          {[
            ["Total reports", Number(result.summary.total).toLocaleString()],
            ["Pending", Number(result.summary.pending).toLocaleString()],
            ["Actioned / dismissed", (Number(result.summary.actioned) + Number(result.summary.dismissed)).toLocaleString()],
          ].map(([label, value]) => <article key={label} className="rounded-xl border border-border bg-white p-4 shadow-sm"><p className="text-[10px] font-semibold text-muted">{label}</p><p className="mt-2 text-2xl font-bold text-heading">{value}</p></article>)}
        </section>
      )}

      <form onSubmit={applyFilters} className="mb-4 flex flex-col gap-2 rounded-xl border border-border bg-white p-4 shadow-sm sm:flex-row">
        <label className="relative min-w-[12rem] flex-1">
          <span className="sr-only">Search reports</span>
          <PublicIcon name="search" className="absolute left-3 top-2.5 h-4 w-4 text-muted-faint" />
          <input value={searchDraft} onChange={(event) => setSearchDraft(event.target.value)} placeholder="Search reports, reviews, products, or reporters..." className="h-9 w-full rounded-lg border border-border-control pl-9 pr-3 text-xs outline-none focus:border-primary focus:ring-2 focus:ring-orange-100" />
        </label>
        <label>
          <span className="sr-only">Filter by report status</span>
          <select value={statusDraft} onChange={(event) => setStatusDraft(event.target.value)} className="h-9 min-w-40 rounded-lg border border-border-control bg-white px-3 text-xs text-body">
            <option value="">All statuses</option>
            <option value="pending">Pending</option>
            <option value="actioned">Actioned</option>
            <option value="dismissed">Dismissed</option>
          </select>
        </label>
        <button type="submit" className="h-9 rounded-lg bg-primary px-4 text-xs font-semibold text-white transition hover:bg-primary-hover">Apply</button>
      </form>

      {error && <p role="alert" className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}
      {notice && <p role="status" className="mb-4 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{notice}</p>}
      {token === "" && <p role="alert" className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">A reviewer or administrator session is required.</p>}

      <section className="overflow-hidden rounded-2xl border border-border bg-white shadow-sm">
        <div className="border-b border-divider px-5 py-3 text-xs text-muted">{result?.pagination ? `${result.pagination.total.toLocaleString()} reports` : "Database records"}</div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1120px] text-left text-xs">
            <thead className="bg-surface-muted text-[10px] text-muted"><tr><th className="px-5 py-3 font-medium">Review</th><th className="px-5 py-3 font-medium">Product</th><th className="px-5 py-3 font-medium">Report reason</th><th className="px-5 py-3 font-medium">Reported by</th><th className="px-5 py-3 font-medium">Status</th><th className="px-5 py-3 font-medium">Date</th><th className="px-5 py-3 text-right font-medium">Decision</th></tr></thead>
            <tbody>
              {result?.reports.map((report) => (
                <tr key={report.id} className="border-t border-divider text-body hover:bg-surface-hover">
                  <td className="max-w-[340px] px-5 py-4 align-top">
                    <p className="font-medium text-body-strong">{report.title || "Review"} · Review #{report.reviewId}</p>
                    <p className="mt-1 whitespace-pre-wrap text-[10px] leading-4 text-muted">{report.comment || "No review text."}</p>
                    <p className="mt-1 text-[9px] text-muted">Rating: <span className="tracking-wider text-primary">{"★".repeat(report.rating)}{"☆".repeat(5 - report.rating)}</span> · Review status: {report.reviewStatus}</p>
                    {report.decisionReason && <p className="mt-1 text-[9px] text-muted">Decision note: {report.decisionReason}</p>}
                  </td>
                  <td className="px-5 py-4 align-top text-[10px]">{report.productName}</td>
                  <td className="max-w-[220px] px-5 py-4 align-top"><p className="font-medium">{reasonLabels[report.reason] || report.reason}</p>{report.details && <p className="mt-1 whitespace-pre-wrap text-[10px] leading-4 text-muted">{report.details}</p>}</td>
                  <td className="px-5 py-4 align-top"><p className="font-medium">{report.reporterName || "Marketplace customer"}</p><p className="mt-1 text-[10px] text-muted">{report.reporterEmail}</p></td>
                  <td className="px-5 py-4 align-top"><Badge tone={report.status === "actioned" ? "success" : report.status === "pending" ? "warning" : "neutral"}>{report.status}</Badge></td>
                  <td className="px-5 py-4 align-top text-[10px] text-muted">{new Date(report.createdAt).toLocaleDateString()}</td>
                  <td className="px-5 py-4 align-top">
                    {report.status === "pending" ? <div className="min-w-[180px] space-y-2">
                      <label className="block text-[9px] font-medium text-muted">Decision note (optional)<textarea value={reasonById[report.id] ?? ""} onChange={(event) => setReasonById((current) => ({ ...current, [report.id]: event.target.value }))} maxLength={2000} rows={2} className="mt-1 w-full resize-y rounded-md border border-border-control p-2 text-[10px] outline-none focus:border-primary" /></label>
                      <div className="flex flex-wrap justify-end gap-1.5">
                        <button type="button" disabled={workingId === report.id} onClick={() => void decide(report, "dismiss")} className="rounded-md bg-surface-muted px-2 py-1.5 text-[9px] font-semibold text-body hover:bg-surface-hover disabled:opacity-50">Dismiss</button>
                        <button type="button" disabled={workingId === report.id} onClick={() => void decide(report, "remove_review")} className="rounded-md bg-status-danger-surface px-2 py-1.5 text-[9px] font-semibold text-status-danger hover:bg-red-100 disabled:opacity-50">{workingId === report.id ? "Saving..." : "Remove review"}</button>
                      </div>
                    </div> : <span className="block text-right text-[10px] text-muted">No available actions</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {loading && <p className="px-6 py-12 text-center text-sm text-muted">Loading review reports...</p>}
          {!loading && token && !error && result && !result.reports.length && <p className="px-6 py-12 text-center text-sm text-muted">No reports match these filters.</p>}
        </div>
        {result?.pagination && <ProductPagination count={result.reports.length} total={result.pagination.total} page={result.pagination.page} pages={result.pagination.pages} itemLabel="reports" onPageChange={setPageNumber} />}
      </section>
    </div>
  );
}
