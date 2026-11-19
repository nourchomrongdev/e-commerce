"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import PublicIcon from "@/components/icons/PublicIcon";
import UserAvatar from "@/components/UserAvatar";
import ProductPagination from "@/components/products/ProductPagination";
import { Modal } from "@/components/ui";
import useDebouncedValue from "@/hooks/useDebouncedValue";

type Props = { view: "reviews" | "responses"; storefrontName: string };
type CreatorReview = {
  id: number;
  customerName: string | null;
  customerEmail: string | null;
  customerAvatarUrl: string | null;
  productName: string;
  rating: number;
  title: string | null;
  comment: string | null;
  verifiedPurchase: boolean;
  createdAt: string;
  response: string | null;
  responseUpdatedAt: string | null;
};
type ReviewsResponse = {
  reviews: CreatorReview[];
  pagination: { page: number; pageSize: number; total: number; pages: number };
};

const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:5000/api";

export default function CreatorReviewsManager({ view, storefrontName }: Props) {
  const isResponses = view === "responses";
  const title = isResponses ? "My Responses" : "Customer Reviews";
  const [token, setToken] = useState("");
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebouncedValue(search.trim());
  const [page, setPage] = useState(1);
  const [result, setResult] = useState<ReviewsResponse | null>(null);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [selectedActionReview, setSelectedActionReview] = useState<CreatorReview | null>(null);
  const [deleteConfirmationReview, setDeleteConfirmationReview] = useState<CreatorReview | null>(null);
  const [draft, setDraft] = useState("");
  const [loading, setLoading] = useState(false);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    const timer = window.setTimeout(() => setToken(window.localStorage.getItem("marketplace-token") ?? ""), 0);
    return () => window.clearTimeout(timer);
  }, []);

  const query = useMemo(() => {
    const params = new URLSearchParams({ page: String(page), pageSize: "10" });
    if (debouncedSearch) params.set("search", debouncedSearch);
    return params.toString();
  }, [debouncedSearch, page]);

  useEffect(() => {
    if (!token || search.trim() !== debouncedSearch) return;
    const controller = new AbortController();
    const endpoint = isResponses ? "reviews/responses" : "reviews";
    const load = async () => {
      setLoading(true);
      setError("");
      try {
        const response = await fetch(`${apiUrl}/creator/storefronts/${encodeURIComponent(storefrontName)}/${endpoint}?${query}`, {
          headers: { Authorization: `Bearer ${token}` },
          cache: "no-store",
          signal: controller.signal,
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || `Unable to load ${title.toLowerCase()}.`);
        setResult(data as ReviewsResponse);
      } catch (loadError) {
        if (loadError instanceof DOMException && loadError.name === "AbortError") return;
        setResult(null);
        setError(loadError instanceof Error ? loadError.message : `Unable to load ${title.toLowerCase()}.`);
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    };
    void load();
    return () => controller.abort();
  }, [debouncedSearch, isResponses, query, search, storefrontName, title, token]);

  const saveResponse = async (event: FormEvent<HTMLFormElement>, review: CreatorReview) => {
    event.preventDefault();
    const responseText = draft.trim();
    if (!responseText || responseText.length > 5000) {
      setError("Enter a response of up to 5,000 characters.");
      return;
    }
    setWorking(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch(`${apiUrl}/creator/storefronts/${encodeURIComponent(storefrontName)}/reviews/${review.id}/response`, {
        method: "PUT",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ response: responseText }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Unable to save review response.");
      setNotice("Your response has been saved.");
      setEditingId(null);
      setDraft("");
      setResult((current) => current ? ({
        ...current,
        reviews: current.reviews.map((item) => item.id === review.id ? { ...item, response: data.response.response, responseUpdatedAt: data.response.updatedAt } : item),
      }) : current);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Unable to save review response.");
    } finally {
      setWorking(false);
    }
  };

  const deleteResponse = async (review: CreatorReview) => {
    setWorking(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch(`${apiUrl}/creator/storefronts/${encodeURIComponent(storefrontName)}/reviews/${review.id}/response`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Unable to remove review response.");
      setNotice("Your response has been removed.");
      setDeleteConfirmationReview(null);
      if (isResponses && result?.reviews.length === 1 && page > 1) setPage((current) => current - 1);
      setResult((current) => current ? ({
        ...current,
        reviews: current.reviews.filter((item) => !isResponses || item.id !== review.id).map((item) => item.id === review.id ? { ...item, response: null, responseUpdatedAt: null } : item),
        pagination: current.pagination.total > 0 ? { ...current.pagination, total: current.pagination.total - 1 } : current.pagination,
      }) : current);
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "Unable to remove review response.");
    } finally {
      setWorking(false);
    }
  };

  const reviews = result?.reviews ?? [];
  const editingReview = reviews.find((review) => review.id === editingId) ?? null;
  return (
    <div className="mx-auto w-full max-w-[1400px]">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-heading sm:text-[28px]">{title}</h1>
          <p className="mt-1 text-sm text-muted">{isResponses ? "Manage your responses to customer reviews." : "See approved customer reviews for your products and respond to customers."}</p>
        </div>
      </header>
      <section className="mt-6 overflow-hidden rounded-2xl border border-border bg-white shadow-sm">
        <div className="flex flex-col gap-3 border-b border-divider px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <h2 className="text-sm font-bold text-heading">{title}{result ? ` (${result.pagination.total})` : ""}</h2>
          <label className="relative sm:w-64">
            <span className="sr-only">Search reviews</span>
            <PublicIcon name="search" className="absolute left-3 top-2.5 h-4 w-4 text-muted-faint" />
            <input value={search} onChange={(event) => { setPage(1); setSearch(event.target.value); }} placeholder="Search reviews..." className="h-9 w-full rounded-lg border border-border-control pl-9 pr-3 text-xs text-body outline-none placeholder:text-muted-faint focus:border-primary" />
          </label>
        </div>
        {error && <p role="alert" className="mx-5 mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-xs text-red-700 sm:mx-6">{error}</p>}
        {notice && <p role="status" className="mx-5 mt-4 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-xs text-emerald-700 sm:mx-6">{notice}</p>}
        <div className="overflow-x-auto">
          <table className="w-full min-w-[900px] text-left text-xs">
            <thead className="bg-surface-muted text-[10px] text-muted">
              <tr>
                <th className="px-5 py-3 font-medium">Customer</th>
                <th className="px-5 py-3 font-medium">Product</th>
                <th className="px-5 py-3 font-medium">Rating</th>
                <th className="px-5 py-3 font-medium">Review</th>
                <th className="px-5 py-3 font-medium">Date</th>
                <th className="px-5 py-3 font-medium">{isResponses ? "Your response" : "Response"}</th>
                <th className="px-5 py-3 text-right font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {reviews.map((review) => (
                <tr key={review.id} className="border-t border-divider text-body hover:bg-surface-hover">
                  <td className="px-5 py-4 align-top">
                    <div className="flex items-center gap-2">
                      <UserAvatar url={review.customerAvatarUrl} name={review.customerName || review.customerEmail || "Marketplace customer"} className="h-8 w-8 text-[9px]" />
                      <div className="min-w-0">
                        <p className="truncate font-medium">{review.customerName || "Marketplace customer"}</p>
                        {review.customerEmail && <p className="mt-0.5 truncate text-[9px] text-muted">{review.customerEmail}</p>}
                      </div>
                    </div>
                    {review.verifiedPurchase && <span className="mt-1 inline-flex items-center gap-1 text-[9px] font-semibold text-status-success"><PublicIcon name="verification" className="h-3 w-3" />Verified purchase</span>}
                  </td>
                  <td className="px-5 py-4 align-top text-[10px]">{review.productName}</td>
                  <td className="px-5 py-4 align-top whitespace-nowrap"><span className="tracking-wider text-primary">{"★".repeat(review.rating)}{"☆".repeat(5 - review.rating)}</span></td>
                  <td className="max-w-[280px] px-5 py-4 align-top">
                    {review.title && <p className="font-semibold">{review.title}</p>}
                    <p className="mt-1 whitespace-pre-wrap text-[10px] leading-4 text-muted">{review.comment || "—"}</p>
                  </td>
                  <td className="px-5 py-4 align-top text-[10px] text-muted">{new Date(review.createdAt).toLocaleDateString()}</td>
                  <td className="max-w-[260px] px-5 py-4 align-top">
                    <p className="whitespace-pre-wrap text-[10px] leading-4 text-muted">{review.response || "No response yet"}</p>
                  </td>
                  <td className="px-5 py-4 align-top text-right">
                    <button type="button" disabled={working} onClick={() => setSelectedActionReview(review)} aria-label={`Actions for review ${review.id}`} className="ml-auto grid h-8 w-8 place-items-center rounded-lg border border-border-control text-muted transition hover:border-primary hover:bg-accent-light hover:text-primary disabled:opacity-50"><PublicIcon name="ellipsis-vertical" className="h-4 w-4" /></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {loading && <p className="px-6 py-12 text-center text-sm text-muted">Loading reviews...</p>}
          {!loading && token && !error && reviews.length === 0 && <p className="px-6 py-12 text-center text-sm text-muted">{isResponses ? "You have not responded to any reviews yet." : "No approved reviews match this search."}</p>}
          {!token && !loading && <p role="alert" className="px-6 py-12 text-center text-sm text-red-700">An authenticated creator session is required.</p>}
        </div>
        {result?.pagination && <ProductPagination count={reviews.length} total={result.pagination.total} page={result.pagination.page} pages={result.pagination.pages} itemLabel="reviews" onPageChange={setPage} />}
      </section>

      <Modal open={Boolean(selectedActionReview)} title={`Actions: ${selectedActionReview?.productName ?? "Review"}`} onClose={() => setSelectedActionReview(null)}>
        {selectedActionReview && <div className="grid gap-2">
          <button type="button" onClick={() => { setEditingId(selectedActionReview.id); setDraft(selectedActionReview.response || ""); setSelectedActionReview(null); }} className="flex items-center gap-3 rounded-lg border border-border-control px-4 py-3 text-left text-xs font-medium text-body hover:border-primary hover:bg-accent-light"><PublicIcon name={selectedActionReview.response ? "edit" : "message-square-reply"} className="h-4 w-4 text-primary" />{selectedActionReview.response ? "Edit response" : "Respond to review"}</button>
          {selectedActionReview.response && <button type="button" onClick={() => { setDeleteConfirmationReview(selectedActionReview); setSelectedActionReview(null); }} className="flex items-center gap-3 rounded-lg border border-status-danger/20 px-4 py-3 text-left text-xs font-medium text-status-danger hover:bg-status-danger-surface"><PublicIcon name="delete" className="h-4 w-4" />Remove response</button>}
        </div>}
      </Modal>

      <Modal open={Boolean(editingReview)} title={editingReview?.response ? "Edit review response" : "Respond to review"} onClose={() => { setEditingId(null); setDraft(""); }} size="md">
        {editingReview && <form onSubmit={(event) => void saveResponse(event, editingReview)} className="space-y-4">
          <p className="rounded-lg bg-surface-muted p-3 text-xs leading-5 text-muted">{editingReview.title || editingReview.comment || "Customer review"} · {editingReview.productName}</p>
          <label className="block text-xs font-medium text-body">Your response<textarea aria-label={`Response to review ${editingReview.id}`} value={draft} onChange={(event) => setDraft(event.target.value)} maxLength={5000} rows={5} className="mt-1 w-full rounded-md border border-border-control p-3 text-xs outline-none focus:border-primary" placeholder="Write a helpful response..." /></label>
          <div className="flex justify-end gap-2">
            <button type="button" disabled={working} onClick={() => { setEditingId(null); setDraft(""); }} className="inline-flex items-center gap-2 rounded-lg border border-border-control px-3 py-2 text-xs font-semibold text-body disabled:opacity-50"><PublicIcon name="x" className="h-3.5 w-3.5" />Cancel</button>
            <button type="submit" disabled={working || !draft.trim()} className="inline-flex items-center gap-2 rounded-lg bg-primary px-3 py-2 text-xs font-semibold text-white disabled:opacity-50"><PublicIcon name="check" className="h-3.5 w-3.5" />{working ? "Saving..." : "Save response"}</button>
          </div>
        </form>}
      </Modal>

      <Modal open={Boolean(deleteConfirmationReview)} title="Remove review response?" onClose={() => !working && setDeleteConfirmationReview(null)} footer={<>
        <button type="button" disabled={working} onClick={() => setDeleteConfirmationReview(null)} className="inline-flex items-center gap-2 rounded-lg border border-border-control px-3 py-2 text-xs font-semibold text-body disabled:opacity-50"><PublicIcon name="x" className="h-3.5 w-3.5" />Keep response</button>
        <button type="button" disabled={working} onClick={() => deleteConfirmationReview && void deleteResponse(deleteConfirmationReview)} className="inline-flex items-center gap-2 rounded-lg bg-status-danger px-3 py-2 text-xs font-semibold text-white disabled:opacity-50"><PublicIcon name="delete" className="h-3.5 w-3.5" />{working ? "Removing..." : "Remove response"}</button>
      </>}>
        <p className="text-sm leading-6 text-muted">This removes your response to the review for <span className="font-semibold text-body">{deleteConfirmationReview?.productName}</span>.</p>
      </Modal>
    </div>
  );
}
