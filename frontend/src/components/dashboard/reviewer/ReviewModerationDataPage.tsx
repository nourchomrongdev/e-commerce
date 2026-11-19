"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import PublicIcon from "@/components/icons/PublicIcon";
import ProductPagination from "@/components/products/ProductPagination";
import { Badge } from "@/components/ui";

type ReviewPage = "customer-reviews" | "reported-reviews" | "review-moderation";
type ReviewRecord = {
  id: number;
  rating: number;
  title: string | null;
  comment: string | null;
  status: string;
  createdAt: string;
  productName: string;
  customerName: string;
  customerEmail: string;
  storeName: string;
  verifiedPurchase: boolean;
};
type ReviewResponse = {
  reviews: ReviewRecord[];
  summary: { total: number; averageRating: number; approved: number; pending: number };
  pagination: { page: number; pageSize: number; total: number; pages: number };
};

const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:5000/api";

function actionsFor(status: string) {
  if (status === "pending") return [
    { status: "approved", label: "Approve", needsReason: false },
    { status: "rejected", label: "Reject", needsReason: true },
    { status: "flagged", label: "Flag", needsReason: true },
  ];
  if (status === "flagged") return [
    { status: "approved", label: "Approve", needsReason: false },
    { status: "rejected", label: "Reject", needsReason: true },
    { status: "removed", label: "Remove", needsReason: true },
  ];
  if (status === "approved") return [
    { status: "hidden", label: "Hide", needsReason: true },
    { status: "flagged", label: "Flag", needsReason: true },
    { status: "removed", label: "Remove", needsReason: true },
  ];
  if (status === "hidden") return [
    { status: "approved", label: "Restore", needsReason: false },
    { status: "removed", label: "Remove", needsReason: true },
  ];
  if (status === "rejected") return [{ status: "pending", label: "Reopen", needsReason: false }];
  return [];
}

function badgeTone(status: string): "success" | "warning" | "danger" | "neutral" {
  if (status === "approved") return "success";
  if (status === "pending" || status === "flagged") return "warning";
  if (status === "rejected" || status === "hidden" || status === "removed") return "danger";
  return "neutral";
}

export default function ReviewModerationDataPage({ page }: { page: ReviewPage }) {
  const defaultStatus = page === "review-moderation" ? "pending" : page === "reported-reviews" ? "flagged" : "";
  const title = page === "customer-reviews" ? "Customer Reviews" : page === "reported-reviews" ? "Flagged Reviews" : "Review Moderation";
  const description = page === "customer-reviews"
    ? "View customer reviews and current moderation status."
    : page === "reported-reviews"
      ? "Review ratings flagged for moderation."
      : "Moderate pending reviews before they are displayed in the marketplace.";
  const [token, setToken] = useState("");
  const [searchDraft, setSearchDraft] = useState("");
  const [search, setSearch] = useState("");
  const [statusDraft, setStatusDraft] = useState(defaultStatus);
  const [status, setStatus] = useState(defaultStatus);
  const [pageNumber, setPageNumber] = useState(1);
  const [result, setResult] = useState<ReviewResponse | null>(null);
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
        const response = await fetch(`${apiUrl}/admin/reviews?${query}`, {
          headers: { Authorization: `Bearer ${token}` },
          cache: "no-store",
          signal: controller.signal,
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Unable to load reviews.");
        setResult(data as ReviewResponse);
      } catch (loadError) {
        if (loadError instanceof DOMException && loadError.name === "AbortError") return;
        setResult(null);
        setError(loadError instanceof Error ? loadError.message : "Unable to load reviews.");
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

  const moderate = async (review: ReviewRecord, nextStatus: string, needsReason: boolean) => {
    const reason = reasonById[review.id]?.trim() || "";
    if (needsReason && !reason) {
      setError("Enter a moderation reason before applying this decision.");
      return;
    }
    setWorkingId(review.id);
    setError("");
    setNotice("");
    try {
      const response = await fetch(`${apiUrl}/admin/reviews/${review.id}/moderation`, {
        method: "PATCH",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ status: nextStatus, reason }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Unable to update review status.");
      setNotice(`Review #${review.id} marked ${nextStatus.replaceAll("_", " ")}.`);
      setRefresh((current) => current + 1);
    } catch (moderationError) {
      setError(moderationError instanceof Error ? moderationError.message : "Unable to update review status.");
    } finally {
      setWorkingId(null);
    }
  };

  return (
    <div className="mx-auto w-full max-w-[1400px]">
      <header className="mb-5">
        <p className="mb-1 text-[10px] font-bold uppercase tracking-[0.1em] text-primary">Reviews management</p>
        <h1 className="text-2xl font-bold tracking-tight text-heading sm:text-[28px]">{title}</h1>
        <p className="mt-1 text-sm text-muted">{description}</p>
      </header>

      {page === "customer-reviews" && result?.summary && (
        <section className="mb-5 grid gap-3 sm:grid-cols-3">
          {[
            ["Average rating", Number(result.summary.averageRating).toFixed(2)],
            ["Total reviews", Number(result.summary.total).toLocaleString()],
            ["Pending review", Number(result.summary.pending).toLocaleString()],
          ].map(([label, value]) => <article key={label} className="rounded-xl border border-border bg-white p-4 shadow-sm"><p className="text-[10px] font-semibold text-muted">{label}</p><p className="mt-2 text-2xl font-bold text-heading">{value}</p></article>)}
        </section>
      )}

      <form onSubmit={applyFilters} className="mb-4 flex flex-col gap-2 rounded-xl border border-border bg-white p-4 shadow-sm sm:flex-row">
        <label className="relative min-w-[12rem] flex-1">
          <span className="sr-only">Search reviews</span>
          <PublicIcon name="search" className="absolute left-3 top-2.5 h-4 w-4 text-muted-faint" />
          <input value={searchDraft} onChange={(event) => setSearchDraft(event.target.value)} placeholder="Search reviews, products, or customers..." className="h-9 w-full rounded-lg border border-border-control pl-9 pr-3 text-xs outline-none focus:border-primary focus:ring-2 focus:ring-orange-100" />
        </label>
        <label>
          <span className="sr-only">Filter by review status</span>
          <select value={statusDraft} onChange={(event) => setStatusDraft(event.target.value)} className="h-9 min-w-40 rounded-lg border border-border-control bg-white px-3 text-xs text-body">
            <option value="">All statuses</option>
            {["pending", "approved", "rejected", "hidden", "flagged", "removed"].map((item) => <option key={item} value={item}>{item.charAt(0).toUpperCase() + item.slice(1)}</option>)}
          </select>
        </label>
        <button type="submit" className="h-9 rounded-lg bg-primary px-4 text-xs font-semibold text-white transition hover:bg-primary-hover">Apply</button>
      </form>

      {error && <p role="alert" className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}
      {notice && <p role="status" className="mb-4 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{notice}</p>}
      {token === "" && <p role="alert" className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">A reviewer or administrator session is required.</p>}

      <section className="overflow-hidden rounded-2xl border border-border bg-white shadow-sm">
        <div className="border-b border-divider px-5 py-3 text-xs text-muted">{result?.pagination ? `${result.pagination.total.toLocaleString()} reviews` : "Database records"}</div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1040px] text-left text-xs">
            <thead className="bg-surface-muted text-[10px] text-muted"><tr><th className="px-5 py-3 font-medium">Customer</th><th className="px-5 py-3 font-medium">Product / Store</th><th className="px-5 py-3 font-medium">Rating</th><th className="px-5 py-3 font-medium">Review</th><th className="px-5 py-3 font-medium">Status</th><th className="px-5 py-3 font-medium">Date</th><th className="px-5 py-3 text-right font-medium">Decision</th></tr></thead>
            <tbody>
              {result?.reviews.map((review) => {
                const actions = actionsFor(review.status);
                return <tr key={review.id} className="border-t border-divider text-body hover:bg-surface-hover">
                  <td className="px-5 py-4 align-top"><p className="font-medium text-body-strong">{review.customerName || "Marketplace customer"}</p><p className="mt-1 text-[10px] text-muted">{review.customerEmail}</p>{review.verifiedPurchase && <span className="mt-1 inline-block text-[9px] font-semibold text-status-success">Verified purchase</span>}</td>
                  <td className="px-5 py-4 align-top"><p className="font-medium">{review.productName}</p><p className="mt-1 text-[10px] text-muted">{review.storeName}</p></td>
                  <td className="px-5 py-4 align-top whitespace-nowrap"><span className="tracking-wider text-primary">{"★".repeat(review.rating)}{"☆".repeat(5 - review.rating)}</span></td>
                  <td className="max-w-[320px] px-5 py-4 align-top">{review.title && <p className="font-semibold">{review.title}</p>}<p className="mt-1 whitespace-pre-wrap text-[10px] leading-4 text-muted">{review.comment || "—"}</p><p className="mt-1 text-[9px] text-muted">Review #{review.id}</p></td>
                  <td className="px-5 py-4 align-top"><Badge tone={badgeTone(review.status)}>{review.status}</Badge></td>
                  <td className="px-5 py-4 align-top text-[10px] text-muted">{new Date(review.createdAt).toLocaleDateString()}</td>
                  <td className="px-5 py-4 align-top">
                    {actions.length > 0 && <div className="min-w-[220px] space-y-2">
                      <label className="block text-[9px] font-medium text-muted">Reason (required for restrictive decisions)<textarea value={reasonById[review.id] ?? ""} onChange={(event) => setReasonById((current) => ({ ...current, [review.id]: event.target.value }))} maxLength={2000} rows={2} className="mt-1 w-full resize-y rounded-md border border-border-control p-2 text-[10px] outline-none focus:border-primary" /></label>
                      <div className="flex flex-wrap justify-end gap-1.5">{actions.map((action) => <button key={action.status} type="button" disabled={workingId === review.id} onClick={() => void moderate(review, action.status, action.needsReason)} className={`rounded-md px-2 py-1.5 text-[9px] font-semibold disabled:opacity-50 ${action.status === "approved" || action.status === "pending" ? "bg-status-success-surface text-status-success hover:bg-emerald-100" : action.status === "rejected" || action.status === "removed" || action.status === "hidden" ? "bg-status-danger-surface text-status-danger hover:bg-red-100" : "bg-amber-50 text-amber-700 hover:bg-amber-100"}`}>{workingId === review.id ? "Saving..." : action.label}</button>)}</div>
                    </div>}
                    {!actions.length && <span className="block text-right text-[10px] text-muted">No available actions</span>}
                  </td>
                </tr>;
              })}
            </tbody>
          </table>
          {loading && <p className="px-6 py-12 text-center text-sm text-muted">Loading review records...</p>}
          {!loading && token && !error && result && !result.reviews.length && <p className="px-6 py-12 text-center text-sm text-muted">No reviews match these filters.</p>}
        </div>
        {result?.pagination && <ProductPagination count={result.reviews.length} total={result.pagination.total} page={result.pagination.page} pages={result.pagination.pages} itemLabel="reviews" onPageChange={setPageNumber} />}
      </section>
    </div>
  );
}
