"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import PublicIcon from "@/components/icons/PublicIcon";
import { Badge } from "@/components/ui";
import { useToast } from "@/components/ui/GlobalToastProvider";

const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:5000/api";

type ApprovalHistoryEvent = {
  previousStatus: string | null;
  newStatus: string;
  reason: string | null;
  internalNote: string | null;
  createdAt: string;
  actorName: string | null;
};

type ProductDetail = {
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
  publishAfterApproval: boolean;
  creatorName: string;
  storeName: string;
  categoryName: string | null;
  versions: Array<{ id: number; version: string; price: number; releaseNotes: string; current: boolean }>;
  files: Array<{ id: string; name: string; size: number; mimeType: string }>;
  previews: Array<{ id: number; title: string; type: string; url: string }>;
  history: ApprovalHistoryEvent[];
};

function formatPrice(price: number, currency: string) {
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency: currency || "USD" }).format(Number(price || 0));
  } catch {
    return `${currency || "USD"} ${Number(price || 0).toFixed(2)}`;
  }
}

function safePreviewUrl(value: string) {
  return value.startsWith("/") && !value.startsWith("//") || /^https?:\/\//i.test(value) ? value : null;
}

export default function ProductApprovalDetail({ productId }: { productId: string }) {
  const toast = useToast();
  const [token] = useState(() => typeof window === "undefined" ? "" : window.localStorage.getItem("marketplace-token") || "");
  const [product, setProduct] = useState<ProductDetail | null>(null);
  const [reason, setReason] = useState("");
  const [internalNote, setInternalNote] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async (authToken: string, signal?: AbortSignal) => {
    const response = await fetch(`${apiUrl}/admin/products/${encodeURIComponent(productId)}`, {
      headers: { Authorization: `Bearer ${authToken}` },
      cache: "no-store",
      signal,
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || "Unable to load product review details.");
    setProduct(payload.product as ProductDetail);
  }, [productId]);

  useEffect(() => {
    if (!token) {
      const timer = window.setTimeout(() => {
        setError("An administrator session is required.");
        setLoading(false);
      }, 0);
      return () => window.clearTimeout(timer);
    }
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      void load(token, controller.signal)
        .catch((loadError: unknown) => {
          if (controller.signal.aborted) return;
          setError(loadError instanceof Error ? loadError.message : "Unable to load product review details.");
        })
        .finally(() => {
          if (!controller.signal.aborted) setLoading(false);
        });
    }, 0);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [load, token]);

  const decide = async (status: "approved" | "changes_requested" | "rejected") => {
    const reviewerReason = reason.trim();
    if (status !== "approved" && reviewerReason.length < 15) {
      setError("Add at least 15 characters of creator-visible feedback before requesting changes or rejecting this product.");
      return;
    }
    if (!token || saving) return;
    setSaving(true);
    setError("");
    try {
      const response = await fetch(`${apiUrl}/admin/products/${encodeURIComponent(productId)}/approval`, {
        method: "PATCH",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ status, reason: reviewerReason, internalNote: internalNote.trim() }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Unable to save product decision.");
      await load(token);
      setReason("");
      setInternalNote("");
      toast.success(status === "approved"
        ? payload.product.status === "published"
          ? "Product approved and published."
          : "Product approved and saved as a draft."
        : `Product marked ${status.replaceAll("_", " ")}.`);
    } catch (saveError) {
      const message = saveError instanceof Error ? saveError.message : "Unable to save product decision.";
      setError(message);
      toast.error(message);
    } finally {
      setSaving(false);
    }
  };

  const downloadFile = async (file: ProductDetail["files"][number]) => {
    try {
      const response = await fetch(`${apiUrl}/admin/products/${encodeURIComponent(productId)}/files/${encodeURIComponent(file.id)}/content`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!response.ok) {
        const payload = await response.json();
        throw new Error(payload.error || "Unable to download product file.");
      }
      const url = URL.createObjectURL(await response.blob());
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = file.name;
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (downloadError) {
      toast.error(downloadError instanceof Error ? downloadError.message : "Unable to download product file.");
    }
  };

  if (loading) return <p className="mx-auto w-full max-w-[1100px] px-4 py-12 text-center text-sm text-muted">Loading product details...</p>;
  if (error && !product) return <div className="mx-auto w-full max-w-[1100px] px-4 py-8"><p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p><Link href="/admin/products" className="mt-4 inline-block text-xs font-semibold text-primary no-underline">← Back to product approvals</Link></div>;
  if (!product) return null;

  const canDecide = product.approvalStatus === "pending" || product.approvalStatus === "approved";
  return (
    <main className="mx-auto w-full max-w-[1100px] px-4 py-8 sm:px-6">
      <Link href="/admin/products" className="inline-flex items-center gap-1 text-xs font-semibold text-primary no-underline hover:underline"><PublicIcon name="arrow-left" className="h-3.5 w-3.5" />Product approvals</Link>
      <header className="mt-5 flex flex-wrap items-start justify-between gap-4">
        <div><p className="text-[10px] font-bold uppercase tracking-[0.1em] text-primary">Product review</p><h1 className="mt-1 text-2xl font-bold tracking-tight text-heading">{product.name}</h1><p className="mt-1 text-xs text-muted">{product.creatorName} · {product.storeName} · {product.categoryName || "Uncategorized"}</p></div>
        <div className="flex items-center gap-2"><Badge tone={product.approvalStatus === "approved" ? "success" : product.approvalStatus === "rejected" ? "danger" : "warning"}>{product.approvalStatus.replaceAll("_", " ")}</Badge><Badge tone={product.publishAfterApproval ? "success" : "neutral"}>{product.publishAfterApproval ? "Publish after approval" : "Keep as draft"}</Badge><Badge tone={product.status === "published" ? "success" : "neutral"}>{product.status}</Badge></div>
      </header>
      {error && <p role="alert" className="mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}

      <div className="mt-6 grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="space-y-5">
          <section className="rounded-xl border border-border bg-white p-5 shadow-sm">
            <h2 className="text-sm font-bold text-heading">Product information</h2>
            <p className="mt-3 text-xs leading-5 text-muted">{product.shortDescription || "No short description."}</p>
            <p className="mt-3 whitespace-pre-wrap text-xs leading-5 text-body">{product.description || "No detailed description."}</p>
            <p className="mt-3 text-xs font-semibold text-heading">{product.productType} · {formatPrice(product.price, product.currency)}</p>
          </section>
          <section className="rounded-xl border border-border bg-white p-5 shadow-sm">
            <h2 className="text-sm font-bold text-heading">Versions</h2>
            <div className="mt-3 divide-y divide-divider">
              {product.versions.map((version) => <article key={version.id} className="py-3 first:pt-0 last:pb-0"><div className="flex justify-between gap-3 text-xs"><strong className="text-heading">v{version.version}{version.current ? " · Current" : ""}</strong><span className="text-muted">{formatPrice(version.price, product.currency)}</span></div>{version.releaseNotes && <p className="mt-1 whitespace-pre-wrap text-[11px] leading-5 text-muted">{version.releaseNotes}</p>}</article>)}
              {!product.versions.length && <p className="text-xs text-muted">No versions provided.</p>}
            </div>
          </section>
          <section className="rounded-xl border border-border bg-white p-5 shadow-sm">
            <h2 className="text-sm font-bold text-heading">Files and previews</h2>
            <div className="mt-3 space-y-2">
              {product.files.map((file) => <div key={file.id} className="flex items-center justify-between gap-3 rounded-lg bg-surface-muted px-3 py-2"><span className="truncate text-xs text-body">{file.name}</span><button type="button" onClick={() => void downloadFile(file)} className="shrink-0 text-[10px] font-semibold text-primary">Download</button></div>)}
              {!product.files.length && <p className="text-xs text-muted">No files provided.</p>}
            </div>
            {product.previews.length > 0 && <div className="mt-4 grid gap-2 sm:grid-cols-2">{product.previews.map((preview) => {
              const href = safePreviewUrl(preview.url);
              return <article key={preview.id} className="rounded-lg border border-divider p-3"><p className="truncate text-[11px] font-semibold text-heading">{preview.title || preview.type}</p>{href ? <a href={href} target="_blank" rel="noreferrer" className="mt-1 block truncate text-[10px] text-primary">{href}</a> : <p className="mt-1 text-[10px] text-muted">Preview URL is not safe to open.</p>}</article>;
            })}</div>}
          </section>
          <section className="rounded-xl border border-border bg-white p-5 shadow-sm">
            <h2 className="text-sm font-bold text-heading">Decision history</h2>
            <div className="mt-3 divide-y divide-divider">
              {product.history.map((event, index) => <article key={`${event.createdAt}-${index}`} className="py-3 first:pt-0 last:pb-0"><div className="flex flex-wrap justify-between gap-2 text-[10px]"><strong className="text-heading">{event.previousStatus || "new"} → {event.newStatus}</strong><time dateTime={event.createdAt} className="text-muted">{new Date(event.createdAt).toLocaleString()}</time></div><p className="mt-1 text-[10px] text-muted">By {event.actorName || "System"}</p>{event.reason && <p className="mt-2 text-xs leading-5 text-body"><span className="font-semibold">Creator feedback:</span> {event.reason}</p>}{event.internalNote && <p className="mt-2 rounded-md bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-900"><span className="font-semibold">Private admin note:</span> {event.internalNote}</p>}</article>)}
              {!product.history.length && <p className="text-xs text-muted">No approval history yet.</p>}
            </div>
          </section>
        </div>

        <aside className="h-fit rounded-xl border border-border bg-white p-5 shadow-sm lg:sticky lg:top-24">
          <h2 className="text-sm font-bold text-heading">Approval decision</h2>
          {canDecide ? <>
            <p className="mt-3 text-xs leading-5 text-muted">{product.approvalStatus === "pending" ? `Approving this product will ${product.publishAfterApproval ? "publish it" : "save it as a draft"}, as requested by the creator.` : "Rejecting this product will unpublish it."}</p>
            <label className="mt-4 block text-[11px] font-semibold text-body">Creator-visible feedback <span className="font-normal text-muted">(at least 15 characters for changes or rejection)</span><textarea value={reason} onChange={(event) => setReason(event.target.value)} maxLength={2000} rows={4} placeholder="Explain what needs to change or why the product was rejected." className="mt-1 w-full resize-y rounded-md border border-border-control p-3 text-xs font-normal outline-none focus:border-primary" /><span className="mt-1 block text-right text-[10px] font-normal text-muted">{reason.trim().length}/15 minimum</span></label>
            <label className="mt-3 block text-[11px] font-semibold text-body">Private admin note <span className="font-normal text-muted">(not shown to the creator)</span><textarea value={internalNote} onChange={(event) => setInternalNote(event.target.value)} maxLength={2000} rows={3} className="mt-1 w-full resize-y rounded-md border border-border-control p-3 text-xs font-normal outline-none focus:border-primary" /></label>
            <div className="mt-4 grid gap-2">
              {product.approvalStatus === "pending" && <>
                <button type="button" disabled={saving} onClick={() => void decide("approved")} className="inline-flex items-center justify-center gap-2 rounded-lg bg-status-success-surface px-3 py-2.5 text-xs font-semibold text-status-success disabled:opacity-50"><PublicIcon name="check" className="h-3.5 w-3.5" />Approve</button>
                <button type="button" disabled={saving || reason.trim().length < 15} onClick={() => void decide("changes_requested")} className="inline-flex items-center justify-center gap-2 rounded-lg bg-amber-50 px-3 py-2.5 text-xs font-semibold text-amber-700 disabled:opacity-50"><PublicIcon name="warning" className="h-3.5 w-3.5" />Request changes</button>
              </>}
              <button type="button" disabled={saving || reason.trim().length < 15} onClick={() => void decide("rejected")} className="inline-flex items-center justify-center gap-2 rounded-lg bg-status-danger-surface px-3 py-2.5 text-xs font-semibold text-status-danger disabled:opacity-50"><PublicIcon name="x" className="h-3.5 w-3.5" />{product.approvalStatus === "approved" ? "Reject & unpublish" : "Reject"}</button>
            </div>
          </> : <p className="mt-3 text-xs leading-5 text-muted">No decision is available for this product right now.</p>}
        </aside>
      </div>
    </main>
  );
}
