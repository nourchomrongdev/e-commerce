"use client";

import { useEffect, useMemo, useState } from "react";
import PublicIcon from "@/components/icons/PublicIcon";
import ProductPagination from "@/components/products/ProductPagination";
import { Badge, Modal, Toast } from "@/components/ui";
import useDebouncedValue from "@/hooks/useDebouncedValue";

type ReviewStatus = "pending" | "approved" | "rejected" | "hidden" | "flagged" | "removed";
type Review = {
  id: number;
  rating: number;
  title: string | null;
  comment: string | null;
  status: ReviewStatus;
  createdAt: string;
  productName: string;
  customerName: string;
  customerEmail: string;
  storeName: string;
  verifiedPurchase: boolean;
};
type ReviewsResponse = {
  reviews: Review[];
  summary: { total: number; averageRating: number; approved: number; pending: number };
  statusCounts: Partial<Record<ReviewStatus, number>>;
  pagination: { page: number; pageSize: number; total: number; pages: number };
};
type ModerationAction = { status: ReviewStatus; label: string; needsReason: boolean };

const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:5000/api";
const statuses: ReviewStatus[] = ["pending", "approved", "rejected", "hidden", "flagged", "removed"];

function actionsFor(status: ReviewStatus): ModerationAction[] {
  if (status === "pending") return [
    { status: "approved", label: "Approve", needsReason: false },
    { status: "rejected", label: "Reject", needsReason: true },
    { status: "flagged", label: "Flag", needsReason: true },
    { status: "removed", label: "Remove", needsReason: true },
  ];
  if (status === "approved") return [
    { status: "hidden", label: "Hide", needsReason: true },
    { status: "flagged", label: "Flag", needsReason: true },
    { status: "removed", label: "Remove", needsReason: true },
  ];
  if (status === "rejected") return [{ status: "pending", label: "Reopen", needsReason: false }];
  if (status === "hidden") return [
    { status: "approved", label: "Restore", needsReason: false },
    { status: "removed", label: "Remove", needsReason: true },
  ];
  if (status === "flagged") return [
    { status: "approved", label: "Approve", needsReason: false },
    { status: "rejected", label: "Reject", needsReason: true },
    { status: "hidden", label: "Hide", needsReason: true },
    { status: "removed", label: "Remove", needsReason: true },
  ];
  return [];
}

function statusTone(status: ReviewStatus): "success" | "warning" | "danger" | "neutral" {
  if (status === "approved") return "success";
  if (status === "pending" || status === "flagged") return "warning";
  if (status === "rejected" || status === "hidden" || status === "removed") return "danger";
  return "neutral";
}

export default function AdminCustomerReviews() {
  const [token, setToken] = useState("");
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebouncedValue(search.trim());
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);
  const [result, setResult] = useState<ReviewsResponse | null>(null);
  const [selected, setSelected] = useState<Review | null>(null);
  const [reason, setReason] = useState("");
  const [loading, setLoading] = useState(false);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [refresh, setRefresh] = useState(0);

  useEffect(() => {
    const timer = window.setTimeout(() => setToken(window.localStorage.getItem("marketplace-token") ?? ""), 0);
    return () => window.clearTimeout(timer);
  }, []);

  const query = useMemo(() => {
    const params = new URLSearchParams({ page: String(page), pageSize: "10" });
    if (debouncedSearch) params.set("search", debouncedSearch);
    if (status) params.set("status", status);
    return params.toString();
  }, [debouncedSearch, page, status]);

  useEffect(() => {
    if (!token || search.trim() !== debouncedSearch) return;
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
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error || "Unable to load customer reviews.");
        setResult(payload as ReviewsResponse);
      } catch (loadError) {
        if (loadError instanceof DOMException && loadError.name === "AbortError") return;
        setResult(null);
        setError(loadError instanceof Error ? loadError.message : "Unable to load customer reviews.");
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    };
    void load();
    return () => controller.abort();
  }, [debouncedSearch, query, refresh, search, status, token]);

  const moderate = async (action: ModerationAction) => {
    if (!selected || !token) return;
    const note = reason.trim();
    if (action.needsReason && !note) {
      setError("Enter a moderation reason before applying this decision.");
      return;
    }
    if (action.status === "removed" && !window.confirm("Remove this review? This action cannot be undone.")) return;

    setWorking(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch(`${apiUrl}/admin/reviews/${selected.id}/moderation`, {
        method: "PATCH",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ status: action.status, reason: note }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Unable to update this review.");
      setNotice(`Review #${selected.id} updated to ${action.status}.`);
      setSelected(null);
      setReason("");
      setRefresh((value) => value + 1);
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "Unable to update this review.");
    } finally {
      setWorking(false);
    }
  };

  return (
    <div className="mx-auto w-full max-w-[1400px]">
      {error && <Toast key={`error-${error}`} variant="error" message={error} />}
      {notice && <Toast key={`success-${notice}`} variant="success" message={notice} />}
      <header className="mb-5">
        <p className="mb-1 text-[10px] font-bold uppercase tracking-[0.1em] text-primary">Reviews management</p>
        <h1 className="text-2xl font-bold tracking-tight text-heading sm:text-[28px]">Customer Reviews</h1>
        <p className="mt-1 text-sm text-muted">Review customer feedback and manage publication status.</p>
      </header>

      {result && <section className="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-6" aria-label="Review counts by status">
        {statuses.map((item) => <article key={item} className="rounded-xl border border-border bg-white p-4 shadow-sm">
          <p className="text-[10px] font-semibold capitalize text-muted">{item}</p>
          <p className="mt-2 text-xl font-bold text-heading">{(result.statusCounts[item] ?? 0).toLocaleString()}</p>
        </article>)}
      </section>}

      <div className="mb-4 flex flex-col gap-2 rounded-xl border border-border bg-white p-4 shadow-sm sm:flex-row">
        <label className="relative min-w-[12rem] flex-1">
          <span className="sr-only">Search customer reviews</span>
          <PublicIcon name="search" className="absolute left-3 top-2.5 h-4 w-4 text-muted-faint" />
          <input value={search} onChange={(event) => { setSearch(event.target.value); setPage(1); }} placeholder="Search reviews, products, or customers..." className="h-9 w-full rounded-lg border border-border-control pl-9 pr-3 text-xs outline-none focus:border-primary focus:ring-2 focus:ring-orange-100" />
        </label>
        <label>
          <span className="sr-only">Filter by review status</span>
          <select value={status} onChange={(event) => { setStatus(event.target.value); setPage(1); }} className="h-9 min-w-40 rounded-lg border border-border-control bg-white px-3 text-xs text-body">
            <option value="">All statuses</option>
            {statuses.map((item) => <option key={item} value={item}>{item[0].toUpperCase() + item.slice(1)}</option>)}
          </select>
        </label>
      </div>

      {!token && <p role="alert" className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">An administrator session is required to load reviews.</p>}

      <section className="overflow-hidden rounded-xl border border-border bg-white shadow-sm">
        <div className="border-b border-divider px-5 py-3 text-xs text-muted">
          {result ? `${result.summary.total.toLocaleString()} total reviews · Average ${Number(result.summary.averageRating).toFixed(2)} / 5 · ${result.pagination.total.toLocaleString()} matching` : "Database records"}
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1000px] text-left text-xs">
            <thead className="bg-surface-muted text-[10px] uppercase tracking-wide text-muted"><tr>
              <th className="px-4 py-3 font-medium">Reviewer</th><th className="px-4 py-3 font-medium">Product</th><th className="px-4 py-3 font-medium">Rating</th><th className="px-4 py-3 font-medium">Review</th><th className="px-4 py-3 font-medium">Status</th><th className="px-4 py-3 font-medium">Purchase</th><th className="px-4 py-3 font-medium">Submitted</th><th className="px-4 py-3 text-right font-medium">Action</th>
            </tr></thead>
            <tbody>{result?.reviews.map((review) => <tr key={review.id} className="border-t border-divider text-body hover:bg-surface-hover">
              <td className="px-4 py-4 align-top"><p className="font-semibold text-body-strong">{review.customerName || "Marketplace customer"}</p><p className="mt-1 text-[10px] text-muted">{review.customerEmail}</p></td>
              <td className="px-4 py-4 align-top"><p className="font-medium">{review.productName}</p><p className="mt-1 text-[10px] text-muted">{review.storeName}</p></td>
              <td className="px-4 py-4 align-top whitespace-nowrap"><span className="tracking-wider text-primary" aria-label={`${review.rating} out of 5 stars`}>{"★".repeat(review.rating)}{"☆".repeat(5 - review.rating)}</span></td>
              <td className="max-w-[280px] px-4 py-4 align-top"><p className="font-medium">{review.title || "—"}</p><p className="mt-1 line-clamp-3 whitespace-pre-wrap text-[10px] leading-4 text-muted">{review.comment || "—"}</p></td>
              <td className="px-4 py-4 align-top"><Badge tone={statusTone(review.status)}>{review.status}</Badge></td>
              <td className="px-4 py-4 align-top text-[10px] text-muted">{review.verifiedPurchase ? "Verified" : "Unverified"}</td>
              <td className="px-4 py-4 align-top text-[10px] text-muted">{new Date(review.createdAt).toLocaleString()}</td>
              <td className="px-4 py-4 text-right align-top"><button type="button" onClick={() => { setSelected(review); setReason(""); setError(""); }} className="rounded-md border border-border-control px-3 py-1.5 text-[10px] font-semibold text-body hover:border-primary hover:text-primary">View review</button></td>
            </tr>)}</tbody>
          </table>
          {loading && <p className="px-6 py-10 text-center text-sm text-muted">Loading review records...</p>}
          {!loading && token && !error && result && !result.reviews.length && <p className="px-6 py-10 text-center text-sm text-muted">No reviews match these filters.</p>}
        </div>
        {result?.pagination && <ProductPagination count={result.reviews.length} total={result.pagination.total} page={result.pagination.page} pages={result.pagination.pages} itemLabel="reviews" onPageChange={setPage} />}
      </section>

      <Modal open={Boolean(selected)} title="Review details" onClose={() => setSelected(null)} size="lg">
        {selected && <div className="space-y-4">
          <div className="rounded-lg bg-surface-muted p-4">
            <p className="text-sm font-semibold text-body-strong">{selected.productName}</p>
            <p className="mt-1 text-xs text-muted">{selected.customerName} · {selected.customerEmail} · {new Date(selected.createdAt).toLocaleString()}</p>
            <p className="mt-1 text-xs text-muted">{selected.storeName} · {selected.verifiedPurchase ? "Verified purchase" : "Purchase not verified"} · {selected.rating}/5</p>
          </div>
          <div><p className="text-xs font-semibold text-body">{selected.title || "Customer review"}</p><p className="mt-1 whitespace-pre-wrap text-xs leading-5 text-muted">{selected.comment || "No written comment."}</p></div>
          <p className="text-xs text-muted">Current status: <Badge tone={statusTone(selected.status)}>{selected.status}</Badge></p>
          {actionsFor(selected.status).length > 0 && <>
            <label className="block text-xs font-medium text-body">Moderation reason<textarea value={reason} onChange={(event) => setReason(event.target.value)} maxLength={2000} rows={3} className="mt-1 w-full resize-y rounded-md border border-border-control p-3 text-xs outline-none focus:border-primary" placeholder="Required for restrictive decisions" /></label>
            <div className="flex flex-wrap justify-end gap-2 border-t border-divider pt-4">
              {actionsFor(selected.status).map((action) => <button key={action.status} type="button" disabled={working} onClick={() => void moderate(action)} className={`rounded-lg px-3 py-2 text-xs font-semibold disabled:opacity-50 ${action.status === "approved" || action.status === "pending" ? "bg-status-success-surface text-status-success" : "bg-status-danger-surface text-status-danger"}`}>{working ? "Saving..." : action.label}</button>)}
            </div>
          </>}
        </div>}
      </Modal>
    </div>
  );
}
