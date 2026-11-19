"use client";

import { useEffect, useState } from "react";
import PublicIcon from "@/components/icons/PublicIcon";
import BuyerCommerceSection from "@/components/dashboard/BuyerCommerceSection";
import BuyerSettings from "@/components/dashboard/BuyerSettings";
import useDebouncedValue from "@/hooks/useDebouncedValue";

const content = {
  purchases: ["My Orders", "Review order history, payment status, and receipts."],
  downloads: ["My Downloads", "Access files for your purchased products and review download limits."],
  payments: ["Transactions", "Review verified payments and payment attempts."],
  licenses: ["My Licenses", "Manage license keys, activations, and product access."],
  reviews: ["My Reviews", "Review feedback submitted for your purchased products."],
  account: ["Settings", "Manage your account and marketplace preferences."],
} as const;
type BuyerView = keyof typeof content;
type PurchasedLicense = {
  id: number;
  uuid: string;
  status: string;
  issuedAt: string;
  expiresAt: string | null;
  terms: string;
  licenseKey: string | null;
  productName: string;
  productType: string;
  licenseName: string;
  maxActivations: number | null;
  activeActivations: number;
  requiresKey: boolean;
};
type LicenseActivation = { id: number; deviceName: string | null; activatedAt: string; isActive: boolean };
type LicensedFile = { id: number; fileName: string; fileSize: number; downloadCount: number; downloadLimit: number | null };
const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:5000/api";

export default function BuyerSection({ view }: { view: BuyerView }) {
  const [heading, description] = content[view];
  if (view === "purchases" || view === "downloads" || view === "payments") {
    return <BuyerCommerceSection view={view} />;
  }
  if (view === "account") return <BuyerSettings />;
  if (view === "reviews") return <BuyerReviews />;
  return (
    <div className="mx-auto w-full max-w-[1400px]">
      <header><h1 className="text-2xl font-bold tracking-tight text-heading sm:text-[28px]">{heading}</h1><p className="mt-1 text-sm text-muted">{description}</p></header>
      <section className="mt-6 overflow-hidden rounded-xl border border-border bg-white shadow-sm">
        <div className="border-b border-divider px-5 py-4"><h2 className="text-sm font-bold text-heading">{heading}</h2></div>
        <BuyerLicenses />
      </section>
      <BuyerDMCASection />
    </div>
  );
}

type BuyerReview = {
  id: number;
  productId: number;
  productName: string;
  rating: number;
  title: string | null;
  comment: string | null;
  status: string;
  createdAt: string;
};
type EligibleReviewProduct = { id: number; name: string };

function BuyerReviews() {
  const [reviews, setReviews] = useState<BuyerReview[]>([]);
  const [products, setProducts] = useState<EligibleReviewProduct[]>([]);
  const [productId, setProductId] = useState("");
  const [rating, setRating] = useState(5);
  const [title, setTitle] = useState("");
  const [comment, setComment] = useState("");
  const [editingId, setEditingId] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const loadReviews = async () => {
    const token = window.localStorage.getItem("marketplace-token") || "";
    const response = await fetch(`${apiUrl}/buyer/reviews`, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Unable to load reviews.");
    setReviews(Array.isArray(data.reviews) ? data.reviews : []);
    setProducts(Array.isArray(data.eligibleProducts) ? data.eligibleProducts : []);
  };

  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        await loadReviews();
      } catch (loadError) {
        if (active) setError(loadError instanceof Error ? loadError.message : "Unable to load reviews.");
      } finally {
        if (active) setLoading(false);
      }
    };
    void load();
    return () => { active = false; };
  }, []);

  const resetForm = () => {
    setEditingId(null);
    setProductId("");
    setRating(5);
    setTitle("");
    setComment("");
  };

  const editReview = (review: BuyerReview) => {
    setEditingId(review.id);
    setProductId(String(review.productId));
    setRating(review.rating);
    setTitle(review.title || "");
    setComment(review.comment || "");
    setNotice("");
    setError("");
  };

  const saveReview = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const token = window.localStorage.getItem("marketplace-token") || "";
      const response = await fetch(`${apiUrl}/buyer/reviews${editingId ? `/${editingId}` : ""}`, {
        method: editingId ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ productId: Number(productId), rating, title, comment }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Unable to save your review.");
      await loadReviews();
      resetForm();
      setNotice(editingId ? "Your review was updated and submitted for moderation." : "Your review was submitted for moderation.");
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Unable to save your review.");
    } finally {
      setSaving(false);
    }
  };

  const deleteReview = async (reviewId: number) => {
    if (!window.confirm("Delete this review?")) return;
    setError("");
    setNotice("");
    try {
      const token = window.localStorage.getItem("marketplace-token") || "";
      const response = await fetch(`${apiUrl}/buyer/reviews/${reviewId}`, { method: "DELETE", headers: { Authorization: `Bearer ${token}` } });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Unable to delete your review.");
      setReviews((current) => current.filter((review) => review.id !== reviewId));
      setNotice("Your review was deleted.");
      if (editingId === reviewId) resetForm();
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "Unable to delete your review.");
    }
  };

  return <div className="mx-auto w-full max-w-[1400px]">
    <header><h1 className="text-2xl font-bold tracking-tight text-heading sm:text-[28px]">My Reviews</h1><p className="mt-1 text-sm text-muted">Review products you purchased and manage your feedback.</p></header>
    {error && <p role="alert" className="mt-4 rounded-lg border border-red-100 bg-red-50 px-4 py-3 text-xs text-status-danger">{error}</p>}
    {notice && <p role="status" className="mt-4 rounded-lg border border-emerald-100 bg-emerald-50 px-4 py-3 text-xs text-status-success">{notice}</p>}
    {!loading && (products.length > 0 || editingId !== null) && <form onSubmit={saveReview} className="mt-5 space-y-3 rounded-xl border border-border bg-white p-5 shadow-sm">
      <h2 className="text-sm font-bold text-heading">{editingId ? "Edit review" : "Write a review"}</h2>
      <label className="block text-xs font-medium text-body">Purchased product<select required disabled={editingId !== null} value={productId} onChange={(event) => setProductId(event.target.value)} className="mt-1 h-10 w-full rounded-lg border border-border-control bg-white px-3 text-xs disabled:bg-slate-50">{editingId ? <option value={productId}>{reviews.find((review) => review.id === editingId)?.productName || "Selected product"}</option> : <><option value="">Select a product</option>{products.map((product) => <option key={product.id} value={product.id}>{product.name}</option>)}</>}</select></label>
      <fieldset>
        <legend className="text-xs font-medium text-body">Rating</legend>
        <div className="mt-1 flex items-center gap-1" role="radiogroup" aria-label="Review rating">
          {[1, 2, 3, 4, 5].map((value) => <button key={value} type="button" role="radio" aria-checked={rating === value} aria-label={`${value} star${value === 1 ? "" : "s"}`} onClick={() => setRating(value)} className={`rounded px-0.5 text-2xl leading-none transition-colors ${value <= rating ? "text-amber-500" : "text-slate-300 hover:text-amber-300"}`}>★</button>)}
          <span className="ml-2 text-[10px] text-muted">{rating} out of 5</span>
        </div>
      </fieldset>
      <label className="block text-xs font-medium text-body">Review title <span className="font-normal text-muted">(optional)</span><input maxLength={255} value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Summarize your experience" className="mt-1 h-10 w-full rounded-lg border border-border-control px-3 text-xs placeholder:text-muted-faint" /></label>
      <label className="block text-xs font-medium text-body">Your feedback <span className="font-normal text-muted">(required)</span><textarea required maxLength={5000} rows={4} value={comment} onChange={(event) => setComment(event.target.value)} placeholder="Share what you liked and how the product worked for you." className="mt-1 w-full rounded-lg border border-border-control p-3 text-xs placeholder:text-muted-faint" /><span className="mt-1 block text-right text-[9px] font-normal text-muted">{comment.length.toLocaleString()} / 5,000</span></label>
      <div className="flex flex-wrap gap-2"><button type="submit" disabled={saving || !comment.trim()} className="rounded-lg bg-primary px-4 py-2 text-xs font-semibold text-white disabled:opacity-50">{saving ? "Saving…" : editingId ? "Save changes" : "Submit review"}</button>{editingId !== null && <button type="button" onClick={resetForm} className="rounded-lg border border-border-control px-4 py-2 text-xs font-semibold text-body">Cancel</button>}</div>
    </form>}
    <section className="mt-5 overflow-hidden rounded-xl border border-border bg-white shadow-sm">
      <div className="border-b border-divider px-5 py-4"><h2 className="text-sm font-bold text-heading">Your review history</h2></div>
      {loading ? <div className="p-5 text-xs text-muted">Loading reviews…</div> : reviews.length ? <div className="divide-y divide-divider">{reviews.map((review) => <article key={review.id} className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-start sm:justify-between"><div className="min-w-0"><p className="text-xs font-semibold text-body">{review.productName}</p><p className="mt-1 text-[10px] text-primary">{"★".repeat(review.rating)}{"☆".repeat(5 - review.rating)} · <span className="capitalize text-muted">{review.status}</span></p>{review.title && <p className="mt-2 text-xs font-semibold text-heading">{review.title}</p>}{review.comment && <p className="mt-1 whitespace-pre-wrap text-xs text-muted">{review.comment}</p>}<p className="mt-2 text-[10px] text-muted">{new Date(review.createdAt).toLocaleDateString()}</p></div><div className="flex shrink-0 gap-3"><button type="button" onClick={() => editReview(review)} className="text-[10px] font-semibold text-primary hover:underline">Edit</button><button type="button" onClick={() => void deleteReview(review.id)} className="text-[10px] font-semibold text-status-danger hover:underline">Delete</button></div></article>)}</div> : <p className="px-5 py-8 text-center text-xs text-muted">{products.length ? "You have not reviewed any products yet." : "Reviews you submit for purchased products will appear here."}</p>}
    </section>
  </div>;
}

type MarketplaceProduct = { id: number; name: string; storeName: string };
type ReporterCase = { uuid: string; status: string; productName: string; createdAt: string };

function BuyerDMCASection() {
  const [products, setProducts] = useState<MarketplaceProduct[]>([]);
  const [productSearch, setProductSearch] = useState("");
  const [productId, setProductId] = useState("");
  const [reporterName, setReporterName] = useState("");
  const [reporterEmail, setReporterEmail] = useState("");
  const [originalWork, setOriginalWork] = useState("");
  const [details, setDetails] = useState("");
  const [goodFaith, setGoodFaith] = useState(false);
  const [legalDeclaration, setLegalDeclaration] = useState(false);
  const [evidence, setEvidence] = useState<File[]>([]);
  const [cases, setCases] = useState<ReporterCase[]>([]);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const handle = window.setTimeout(async () => {
      if (productSearch.trim().length < 2) {
        setProducts([]);
        return;
      }
      try {
        const response = await fetch(`${apiUrl}/marketplace?search=${encodeURIComponent(productSearch.trim())}&pageSize=8`);
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Unable to search products.");
        setProducts(data.products || []);
      } catch (searchError) {
        setError(searchError instanceof Error ? searchError.message : "Unable to search products.");
      }
    }, 250);
    return () => window.clearTimeout(handle);
  }, [productSearch]);

  const loadCases = async () => {
    const token = window.localStorage.getItem("marketplace-token") || "";
    if (!token) return;
    const response = await fetch(`${apiUrl}/dmca/cases/mine`, { headers: { Authorization: `Bearer ${token}` } });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Unable to load copyright reports.");
    setCases(data.cases || []);
  };

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadCases().catch((loadError) => setError(loadError instanceof Error ? loadError.message : "Unable to load copyright reports."));
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  const encodeEvidence = (file: File) => new Promise<{ name: string; mimeType: string; base64: string }>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = String(reader.result || "");
      const base64 = dataUrl.slice(dataUrl.indexOf(",") + 1);
      if (!base64) reject(new Error(`Unable to read ${file.name}.`));
      else resolve({ name: file.name, mimeType: file.type, base64 });
    };
    reader.onerror = () => reject(new Error(`Unable to read ${file.name}.`));
    reader.readAsDataURL(file);
  });

  const submitReport = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");
    setNotice("");
    setBusy(true);
    try {
      const token = window.localStorage.getItem("marketplace-token") || "";
      if (!token) throw new Error("Sign in again before submitting a copyright report.");
      const response = await fetch(`${apiUrl}/dmca/cases`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          productId: Number(productId),
          reporterName,
          reporterEmail,
          originalWork,
          infringementDetails: details,
          goodFaithConfirmed: goodFaith,
          legalDeclarationConfirmed: legalDeclaration,
          evidence: await Promise.all(evidence.map(encodeEvidence)),
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Unable to submit the report.");
      setNotice(`Report submitted. Case reference: ${data.case.uuid}`);
      setProductId("");
      setProductSearch("");
      setOriginalWork("");
      setDetails("");
      setEvidence([]);
      setGoodFaith(false);
      setLegalDeclaration(false);
      await loadCases();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Unable to submit the report.");
    } finally {
      setBusy(false);
    }
  };

  return <section className="mt-6 overflow-hidden rounded-2xl border border-border bg-white shadow-sm"><div className="border-b border-divider px-5 py-4"><h2 className="text-sm font-bold text-heading">Copyright reports</h2><p className="mt-1 text-xs text-muted">Submit a good-faith copyright notice and track its review status.</p></div><form onSubmit={submitReport} className="grid gap-3 border-b border-divider p-5"><label className="text-xs font-medium text-body">Reported product<input value={productSearch} onChange={(event) => { setProductSearch(event.target.value); setProductId(""); }} required placeholder="Search published products" className="mt-1 h-10 w-full rounded-lg border border-border-control px-3 text-xs" /><select value={productId} onChange={(event) => setProductId(event.target.value)} required className="mt-2 h-10 w-full rounded-lg border border-border-control bg-white px-3 text-xs"><option value="">Select a product</option>{products.map((product) => <option key={product.id} value={product.id}>{product.name} — {product.storeName}</option>)}</select></label><div className="grid gap-3 sm:grid-cols-2"><label className="text-xs font-medium text-body">Your name<input value={reporterName} onChange={(event) => setReporterName(event.target.value)} required maxLength={255} className="mt-1 h-10 w-full rounded-lg border border-border-control px-3 text-xs" /></label><label className="text-xs font-medium text-body">Email<input type="email" value={reporterEmail} onChange={(event) => setReporterEmail(event.target.value)} required maxLength={320} className="mt-1 h-10 w-full rounded-lg border border-border-control px-3 text-xs" /></label></div><label className="text-xs font-medium text-body">Identify your original work<textarea value={originalWork} onChange={(event) => setOriginalWork(event.target.value)} required maxLength={10000} rows={2} className="mt-1 w-full rounded-lg border border-border-control p-3 text-xs" /></label><label className="text-xs font-medium text-body">Describe the infringement<textarea value={details} onChange={(event) => setDetails(event.target.value)} required maxLength={10000} rows={3} className="mt-1 w-full rounded-lg border border-border-control p-3 text-xs" /></label><label className="text-xs font-medium text-body">Evidence (PDF, PNG, JPEG or text; up to 5 files)<input type="file" accept=".pdf,.png,.jpg,.jpeg,.txt,application/pdf,image/png,image/jpeg,text/plain" multiple onChange={(event) => setEvidence(Array.from(event.target.files || []).slice(0, 5))} className="mt-1 block w-full text-xs" /></label><label className="flex items-start gap-2 text-xs text-body"><input type="checkbox" checked={goodFaith} onChange={(event) => setGoodFaith(event.target.checked)} required className="mt-0.5" />I have a good-faith belief that the disputed use is not authorized by the copyright owner, its agent, or the law.</label><label className="flex items-start gap-2 text-xs text-body"><input type="checkbox" checked={legalDeclaration} onChange={(event) => setLegalDeclaration(event.target.checked)} required className="mt-0.5" />I declare under penalty of perjury that this notice is accurate and that I am authorized to act for the owner of the allegedly infringed right.</label>{error && <p role="alert" className="text-xs text-status-danger">{error}</p>}{notice && <p role="status" className="text-xs text-status-success">{notice}</p>}<button type="submit" disabled={busy} className="w-fit rounded-lg bg-primary px-4 py-2 text-xs font-semibold text-white disabled:opacity-50">{busy ? "Submitting…" : "Submit copyright report"}</button></form><div className="divide-y divide-divider">{cases.map((copyrightCase) => <article key={copyrightCase.uuid} className="flex flex-col gap-2 px-5 py-4 sm:flex-row sm:items-center sm:justify-between"><div><p className="text-xs font-semibold text-body">{copyrightCase.productName || "Reported product"}</p><p className="mt-1 text-[10px] text-muted">Case {copyrightCase.uuid} · {new Date(copyrightCase.createdAt).toLocaleDateString()}</p></div><span className="w-fit rounded-full bg-surface-muted px-2.5 py-1 text-[9px] font-semibold text-muted">{copyrightCase.status}</span></article>)}{cases.length === 0 && <p className="px-5 py-4 text-xs text-muted">No copyright reports submitted.</p>}</div></section>;
}

function BuyerLicenses() {
  const [licenses, setLicenses] = useState<PurchasedLicense[]>([]);
  const [activations, setActivations] = useState<LicenseActivation[]>([]);
  const [files, setFiles] = useState<LicensedFile[]>([]);
  const [expandedLicenseId, setExpandedLicenseId] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [deviceName, setDeviceName] = useState("");
  const [busy, setBusy] = useState(false);
  const [copiedLicenseId, setCopiedLicenseId] = useState<number | null>(null);
  const [downloadVersion, setDownloadVersion] = useState<"purchased" | "latest">("purchased");
  const [purchasedVersion, setPurchasedVersion] = useState("Legacy version");
  const [latestVersion, setLatestVersion] = useState<string | null>(null);
  const [latestVersionLicensed, setLatestVersionLicensed] = useState(false);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const debouncedSearch = useDebouncedValue(search.trim());
  const debouncedStatusFilter = useDebouncedValue(statusFilter);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);

  const authHeaders = () => ({
    Authorization: `Bearer ${window.localStorage.getItem("marketplace-token") || ""}`,
  });

  useEffect(() => {
    if (search.trim() !== debouncedSearch || statusFilter !== debouncedStatusFilter) return;
    let active = true;
    const load = async () => {
      setLoading(true);
      setError("");
      try {
        const params = new URLSearchParams({ page: String(page), pageSize: "10" });
        if (debouncedSearch) params.set("search", debouncedSearch);
        if (debouncedStatusFilter) params.set("status", debouncedStatusFilter);
        const response = await fetch(`${apiUrl}/buyer/licenses?${params}`, { headers: authHeaders(), cache: "no-store" });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Unable to load licenses.");
        if (active) {
          setLicenses(Array.isArray(data.licenses) ? data.licenses : []);
          setTotal(Number(data.pagination?.total || 0));
          setTotalPages(Math.max(1, Number(data.pagination?.totalPages || 1)));
        }
      } catch (loadError) {
        if (active) setError(loadError instanceof Error ? loadError.message : "Unable to load licenses.");
      } finally {
        if (active) setLoading(false);
      }
    };
    void load();
    return () => { active = false; };
  }, [debouncedSearch, debouncedStatusFilter, page, search, statusFilter]);

  const expandLicense = async (license: PurchasedLicense) => {
    setError("");
    setExpandedLicenseId((current) => current === license.id ? null : license.id);
    if (expandedLicenseId === license.id) return;
    setBusy(true);
    try {
      const [activationResponse, fileResponse] = await Promise.all([
        fetch(`${apiUrl}/buyer/licenses/${license.id}/activations`, { headers: authHeaders() }),
        fetch(`${apiUrl}/buyer/licenses/${license.id}/downloads`, { headers: authHeaders() }),
      ]);
      const [activationData, fileData] = await Promise.all([activationResponse.json(), fileResponse.json()]);
      if (!activationResponse.ok) throw new Error(activationData.error || "Unable to load activations.");
      if (!fileResponse.ok) throw new Error(fileData.error || "Unable to load downloads.");
      setActivations(activationData.activations || []);
      setFiles(fileData.files || []);
      setDownloadVersion("purchased");
      setPurchasedVersion(fileData.purchasedVersion || "Legacy version");
      setLatestVersion(fileData.latestVersion || null);
      setLatestVersionLicensed(Boolean(fileData.latestVersionLicensed));
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Unable to load license details.");
    } finally {
      setBusy(false);
    }
  };

  const activateThisDevice = async (license: PurchasedLicense) => {
    setBusy(true);
    setError("");
    try {
      const deviceIdentifierKey = `marketplace-license-device-${license.id}`;
      const deviceIdentifier = window.localStorage.getItem(deviceIdentifierKey) || crypto.randomUUID();
      window.localStorage.setItem(deviceIdentifierKey, deviceIdentifier);
      const response = await fetch(`${apiUrl}/buyer/licenses/${license.id}/activations`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({ deviceIdentifier, deviceName: deviceName.trim() || navigator.userAgent.slice(0, 100) }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Unable to activate this device.");
      setDeviceName("");
      await expandLicense(license);
      setLicenses((current) => current.map((item) => item.id === license.id
        ? { ...item, activeActivations: data.activeActivations ?? item.activeActivations + 1 }
        : item));
    } catch (activationError) {
      setError(activationError instanceof Error ? activationError.message : "Unable to activate this device.");
    } finally {
      setBusy(false);
    }
  };

  const deactivate = async (license: PurchasedLicense, activationId: number) => {
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`${apiUrl}/buyer/licenses/${license.id}/activations/${activationId}`, {
        method: "DELETE",
        headers: authHeaders(),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Unable to deactivate this device.");
      setActivations((current) => current.map((item) => item.id === activationId ? { ...item, isActive: false } : item));
      setLicenses((current) => current.map((item) => item.id === license.id ? { ...item, activeActivations: Math.max(0, item.activeActivations - 1) } : item));
    } catch (activationError) {
      setError(activationError instanceof Error ? activationError.message : "Unable to deactivate this device.");
    } finally {
      setBusy(false);
    }
  };

  const selectDownloadVersion = async (license: PurchasedLicense, version: "purchased" | "latest") => {
    if (version === downloadVersion) return;
    setBusy(true);
    setError("");
    try {
      const suffix = version === "latest" ? "?version=latest" : "";
      const response = await fetch(`${apiUrl}/buyer/licenses/${license.id}/downloads${suffix}`, { headers: authHeaders(), cache: "no-store" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Unable to load this product version.");
      setFiles(data.files || []);
      setDownloadVersion(version);
      setPurchasedVersion(data.purchasedVersion || "Legacy version");
      setLatestVersion(data.latestVersion || null);
      setLatestVersionLicensed(Boolean(data.latestVersionLicensed));
    } catch (versionError) {
      setError(versionError instanceof Error ? versionError.message : "Unable to load this product version.");
    } finally {
      setBusy(false);
    }
  };

  const downloadZip = async (license: PurchasedLicense) => {
    setBusy(true);
    setError("");
    try {
      const versionQuery = downloadVersion === "latest" ? "?version=latest" : "";
      const response = await fetch(`${apiUrl}/buyer/licenses/${license.id}/downloads.zip${versionQuery}`, { headers: authHeaders() });
      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || "Unable to download this product ZIP.");
      }
      const blobUrl = URL.createObjectURL(await response.blob());
      const anchor = document.createElement("a");
      anchor.href = blobUrl;
      anchor.download = `${license.productName.replace(/[\\/:*?"<>|]/g, "-")}.zip`;
      anchor.click();
      window.setTimeout(() => URL.revokeObjectURL(blobUrl), 1000);
    } catch (downloadError) {
      setError(downloadError instanceof Error ? downloadError.message : "Unable to download this product ZIP.");
    } finally {
      setBusy(false);
    }
  };

  const copyLicenseKey = async (license: PurchasedLicense) => {
    if (!license.licenseKey) return;
    try {
      await navigator.clipboard.writeText(license.licenseKey);
      setCopiedLicenseId(license.id);
      window.setTimeout(() => setCopiedLicenseId(null), 2000);
    } catch (copyError) {
      setError(copyError instanceof Error ? copyError.message : "Unable to copy the license key.");
    }
  };

  if (loading) return <p className="px-5 py-6 text-sm text-muted">Loading purchased licenses…</p>;
  if (error && licenses.length === 0) return <p role="alert" className="px-5 py-6 text-sm text-status-danger">{error}</p>;

  return (
    <div className="divide-y divide-divider">
      <div className="flex flex-col gap-3 border-b border-divider px-5 py-4 sm:flex-row sm:items-center">
        <label className="relative min-w-0 flex-1">
          <span className="sr-only">Search licenses</span>
          <PublicIcon name="search" className="absolute left-3 top-2.5 h-4 w-4 text-muted-soft" />
          <input value={search} onChange={(event) => { setSearch(event.target.value); setPage(1); }} placeholder="Search products or license types..." className="h-9 w-full rounded-lg border border-border-control pl-9 pr-3 text-xs outline-none focus:border-primary" />
        </label>
        <select aria-label="Filter licenses by status" value={statusFilter} onChange={(event) => { setStatusFilter(event.target.value); setPage(1); }} className="h-9 rounded-lg border border-border-control bg-white px-3 text-xs">
          <option value="">All statuses</option>
          {["active", "revoked", "expired", "suspended"].map((status) => <option key={status} value={status}>{status}</option>)}
        </select>
      </div>
      {error && <p role="alert" className="px-5 py-3 text-xs text-status-danger">{error}</p>}
      {licenses.map((license) => (
        <article key={license.id} className="px-5 py-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-3">
              <span className="grid h-9 w-9 place-items-center rounded-lg bg-orange-50 text-primary"><PublicIcon name="key" className="h-4 w-4" /></span>
              <div>
                <p className="text-xs font-semibold text-body">{license.productName}</p>
                <p className="mt-1 text-[10px] text-muted">{license.licenseName} · {license.status} · {license.expiresAt ? `Expires ${new Date(license.expiresAt).toLocaleDateString()}` : "No expiry"}</p>
              </div>
            </div>
            <button type="button" onClick={() => void expandLicense(license)} className="w-fit rounded-lg border border-border-control px-3 py-2 text-xs font-medium text-body hover:border-primary">{expandedLicenseId === license.id ? "Hide details" : "License details"}</button>
          </div>
          {expandedLicenseId === license.id && (
            <div className="mt-4 space-y-4 rounded-xl border border-divider bg-surface-muted p-4">
              <div className="grid gap-3 text-xs sm:grid-cols-2">
                <p><span className="font-semibold">Issued:</span> {new Date(license.issuedAt).toLocaleDateString()}</p>
                <p><span className="font-semibold">Activations:</span> {license.activeActivations} / {license.maxActivations ?? "Unlimited"}</p>
              </div>
              {license.licenseKey && (
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                  <p className="min-w-0 break-all text-xs"><span className="font-semibold">License key:</span> <code className="ml-1 rounded bg-white px-2 py-1">{license.licenseKey}</code></p>
                  <button type="button" onClick={() => void copyLicenseKey(license)} className="w-fit shrink-0 rounded-lg border border-border-control bg-white px-3 py-2 text-[10px] font-semibold text-body hover:border-primary hover:text-primary">{copiedLicenseId === license.id ? "Copied" : "Copy key"}</button>
                </div>
              )}
              {license.terms && <div><p className="mb-1 text-xs font-semibold">License agreement</p><p className="whitespace-pre-wrap text-xs text-muted">{license.terms}</p></div>}
              {license.requiresKey && /software|desktop|license\s*\/\s*key/i.test(license.productType) && license.status === "active" && (
                <div className="flex flex-col gap-2 sm:flex-row">
                  <input value={deviceName} onChange={(event) => setDeviceName(event.target.value)} placeholder="Device name (optional)" className="h-9 rounded-lg border border-border-control px-3 text-xs" />
                  <button type="button" disabled={busy} onClick={() => void activateThisDevice(license)} className="rounded-lg bg-primary px-3 py-2 text-xs font-semibold text-white disabled:opacity-50">Activate this device</button>
                </div>
              )}
              {activations.length > 0 && <div>
                <p className="mb-2 text-xs font-semibold">Activation history</p>
                <div className="space-y-2">{activations.map((activation) => <div key={activation.id} className="flex items-center justify-between gap-3 text-xs"><span>{activation.deviceName || "Device"} · {new Date(activation.activatedAt).toLocaleDateString()}</span>{activation.isActive && <button type="button" disabled={busy} onClick={() => void deactivate(license, activation.id)} className="text-primary underline disabled:opacity-50">Deactivate</button>}</div>)}</div>
              </div>}
              {(files.length > 0 || latestVersionLicensed) && <div>
                <p className="mb-2 text-xs font-semibold">{downloadVersion === "latest" ? "Latest version downloads" : "Purchased downloads"}</p>
                {latestVersion && latestVersionLicensed && latestVersion !== purchasedVersion && <label className="mb-3 block max-w-xs text-[10px] font-medium text-muted">Product version
                  <select value={downloadVersion} onChange={(event) => void selectDownloadVersion(license, event.target.value as "purchased" | "latest")} disabled={busy} className="mt-1 h-9 w-full rounded-lg border border-border-control bg-white px-3 text-xs text-body disabled:opacity-60">
                    <option value="purchased">Purchased version ({purchasedVersion})</option>
                    <option value="latest">Latest version ({latestVersion})</option>
                  </select>
                </label>}
                {files.length > 0 ? <>
                  <div className="space-y-2">{files.map((file) => <p key={file.id} className="text-xs">{file.fileName} · {file.downloadCount}{file.downloadLimit === null ? "" : ` / ${file.downloadLimit}`} downloads</p>)}</div>
                  <button type="button" disabled={busy} onClick={() => void downloadZip(license)} className="mt-3 inline-flex items-center gap-1 rounded-lg bg-primary px-3 py-2 text-xs font-semibold text-white hover:bg-primary-hover disabled:opacity-50"><PublicIcon name="download" className="h-3.5 w-3.5" />Download ZIP</button>
                </> : <p className="text-xs text-muted">No files are currently available for this version.</p>}
              </div>}
              {busy && <p className="text-[10px] text-muted">Processing…</p>}
            </div>
          )}
        </article>
      ))}
      {licenses.length === 0 && <p className="px-5 py-8 text-center text-xs text-muted">{total === 0 ? "No purchased licenses yet." : "No licenses match these filters."}</p>}
      {totalPages > 1 && <div className="flex items-center justify-between border-t border-divider px-5 py-3 text-xs">
        <span className="text-muted">{total} licenses · Page {page} of {totalPages}</span>
        <div className="flex gap-2">
          <button type="button" disabled={page <= 1} onClick={() => setPage((value) => value - 1)} className="rounded-md border border-border-control px-3 py-1.5 disabled:opacity-40">Previous</button>
          <button type="button" disabled={page >= totalPages} onClick={() => setPage((value) => value + 1)} className="rounded-md border border-border-control px-3 py-1.5 disabled:opacity-40">Next</button>
        </div>
      </div>}
    </div>
  );
}