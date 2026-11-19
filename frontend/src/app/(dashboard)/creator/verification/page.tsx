"use client";

import { useEffect, useState, type FormEvent } from "react";
import PublicIcon from "@/components/icons/PublicIcon";
import { Badge, Button, InputText, Modal } from "@/components/ui";

const benefits = [
  {
    title: "Higher Trust",
    description: "Show verified badge to customers",
    icon: "verified",
    tone: "bg-orange-50 text-primary",
  },
  {
    title: "More Sales",
    description: "Increase conversion rates",
    icon: "up",
    tone: "bg-orange-50 text-primary",
  },
  {
    title: "Priority Support",
    description: "Get faster help",
    icon: "user",
    tone: "bg-orange-50 text-primary",
  },
  {
    title: "More Features",
    description: "Access exclusive tools",
    icon: "settings",
    tone: "bg-orange-50 text-primary",
  },
];

const steps = [
  ["Submit Identity Information", "Provide your legal name and country"],
  ["Upload Identity Document", "Upload a government-issued identity document"],
  ["Review Process", "Our team will review your application"],
  ["Get Verified", "Receive your verified badge"],
];

const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:5000/api";

type VerificationState = {
  status: string;
  verified: boolean;
  verification: { status: string; reviewReason?: string | null } | null;
};

export default function CreatorVerificationPage() {
  const [applicationOpen, setApplicationOpen] = useState(false);
  const [verification, setVerification] = useState<VerificationState | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const loadVerification = async (signal?: AbortSignal) => {
    const token = window.localStorage.getItem("marketplace-token");
    if (!token) throw new Error("Please sign in to view identity verification.");
    const response = await fetch(`${apiUrl}/creator-program/verification`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
      signal,
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Unable to load identity verification status.");
    setVerification(result);
  };

  useEffect(() => {
    const controller = new AbortController();
    void loadVerification(controller.signal).catch((loadError) => {
      if (!controller.signal.aborted) setError(loadError instanceof Error ? loadError.message : "Unable to load identity verification status.");
    }).finally(() => {
      if (!controller.signal.aborted) setLoading(false);
    });
    return () => controller.abort();
  }, []);

  const submitApplication = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (submitting) return;
    const token = window.localStorage.getItem("marketplace-token");
    const formData = new FormData(event.currentTarget);
    const legalName = String(formData.get("legalName") || "").trim();
    const country = String(formData.get("country") || "").trim();
    const documentType = String(formData.get("documentType") || "");
    const document = formData.get("document");
    if (!(document instanceof File) || !document.size) {
      setError("Choose an identity document before submitting.");
      return;
    }
    if (document.size > 10 * 1024 * 1024) {
      setError("The identity document must be 10 MB or smaller.");
      return;
    }
    if (!token) {
      setError("Please sign in to submit identity verification.");
      return;
    }

    setSubmitting(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch(`${apiUrl}/creator-program/verification`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/octet-stream",
          "X-Full-Legal-Name": encodeURIComponent(legalName),
          "X-Country": encodeURIComponent(country),
          "X-Document-Type": documentType,
        },
        body: document,
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Unable to submit identity verification.");
      setVerification({
        status: "pending",
        verified: false,
        verification: result.verification || null,
      });
      setApplicationOpen(false);
      setNotice("Your identity verification request has been submitted.");
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Unable to submit identity verification.");
    } finally {
      setSubmitting(false);
    }
  };

  const status = verification?.status || "unverified";
  const pending = status === "pending";
  const verified = status === "verified" && Boolean(verification?.verified);
  const canApply = !loading && !pending && !verified;
  const statusLabel = loading ? "Loading" : verified ? "Verified" : pending ? "Application under review" : status === "additional_info_required" ? "More information required" : status === "rejected" ? "Not verified" : status === "revoked" ? "Verification revoked" : "Not verified";

  return (
    <div className="mx-auto w-full max-w-[1120px]">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex items-start gap-3">
          <span className="grid h-12 w-12 shrink-0 place-items-center rounded-xl bg-orange-50 text-primary">
            <PublicIcon name="verification" className="h-7 w-7" />
          </span>
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-heading sm:text-[28px]">
              Verification
            </h1>
            <p className="mt-1 text-sm text-muted">
              Verify your creator account for more trust and benefits.
            </p>
          </div>
        </div>
        <Badge tone={verified ? "success" : pending || status === "additional_info_required" ? "warning" : status === "rejected" || status === "revoked" ? "danger" : "neutral"}>{statusLabel}</Badge>
      </header>

      <section className="mt-6 grid gap-5 lg:grid-cols-[minmax(0,1fr)_280px]">
        <article className="rounded-2xl border border-verification-border bg-gradient-to-br from-verification-surface to-white p-5 shadow-sm sm:p-6">
          <div className="flex items-start gap-4">
            <span className="grid h-12 w-12 shrink-0 place-items-center rounded-xl border border-primary bg-orange-50 text-white shadow-sm">
              <img src="/icons/verified.svg" alt="Verified badge" className="h-7 w-7" />
            </span>
            <div>
              <h2 className="text-base font-bold text-ink">
                Identity verification
              </h2>
              <p className="mt-1 max-w-lg text-xs leading-5 text-muted">
                Verify your identity to display the verified badge on your creator profile.
              </p>
              <Button
                size="sm"
                className="mt-4"
                onClick={() => setApplicationOpen(true)}
                disabled={!canApply}
              >
                {pending ? "Application Submitted" : verified ? "Verified" : status === "additional_info_required" ? "Submit requested information" : "Apply for Verification"}
              </Button>
            </div>
          </div>
        </article>

        <article className="rounded-2xl border border-border bg-white p-5 shadow-sm">
          <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-soft">
            Creator account status
          </p>
          <div className="mt-4 flex items-center gap-3">
            <span
              className={`grid h-10 w-10 place-items-center rounded-full ${verified ? "bg-status-success-surface text-status-success" : pending || status === "additional_info_required" ? "bg-amber-50 text-status-warning" : "bg-slate-100 text-slate-500"}`}
            >
              <PublicIcon
                name={verified ? "verified" : pending ? "up" : "verification"}
                className="h-5 w-5"
              />
            </span>
            <div>
              <p className="text-sm font-semibold text-ink">
                {statusLabel}
              </p>
              <p className="mt-0.5 text-[10px] text-muted-soft">
                {verification?.verification?.reviewReason || (verified ? "Identity verification is complete" : pending ? "We will contact you after review" : "Creator access is not affected by identity verification")}
              </p>
            </div>
          </div>
        </article>
      </section>

      {error && <p role="alert" className="mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-xs text-red-700">{error}</p>}
      {notice && <p role="status" className="mt-4 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-xs text-emerald-700">{notice}</p>}

      <section className="mt-5 rounded-2xl border border-border bg-white p-5 shadow-sm sm:p-6">
        <h2 className="text-base font-bold text-ink">Verification Benefits</h2>
        <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {benefits.map((benefit) => (
            <article
              key={benefit.title}
              className="rounded-xl border border-divider p-4"
            >
              <span
                className={`grid h-8 w-8 place-items-center rounded-lg ${benefit.tone}`}
              >
                <PublicIcon
                  name={benefit.icon as "verified"}
                  className="h-4 w-4"
                />
              </span>
              <h3 className="mt-3 text-xs font-semibold text-body">
                {benefit.title}
              </h3>
              <p className="mt-1 text-[10px] text-muted-soft">
                {benefit.description}
              </p>
            </article>
          ))}
        </div>
      </section>

      <section className="mt-5 rounded-2xl border border-border bg-white p-5 shadow-sm sm:p-6">
        <h2 className="text-base font-bold text-ink">Verification Steps</h2>
        <div className="mt-5 space-y-4">
          {steps.map(([title, description], index) => (
            <div key={title} className="flex items-start gap-3">
              <span
                className={`grid h-7 w-7 shrink-0 place-items-center rounded-full text-xs font-bold ${index === 0 ? "bg-primary text-white" : "bg-divider text-muted"}`}
              >
                {index + 1}
              </span>
              <div>
                <h3 className="text-xs font-semibold text-body">{title}</h3>
                <p className="mt-0.5 text-[10px] text-muted-soft">
                  {description}
                </p>
              </div>
            </div>
          ))}
        </div>
        <div className="mt-5 flex items-center gap-2 rounded-lg bg-orange-50 px-3 py-2.5 text-[10px] text-verification-text">
          <PublicIcon name="notification" className="h-3.5 w-3.5 shrink-0" />
          Usually takes 1-3 business days for verification review.
        </div>
      </section>

      <Modal
        open={applicationOpen}
        title="Verify creator account"
        onClose={() => setApplicationOpen(false)}
        size="md"
        footer={
          <>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setApplicationOpen(false)}
            >
              Cancel
            </Button>
            <Button size="sm" type="submit" form="verification-form" disabled={submitting}>
              {submitting ? "Submitting..." : "Submit application"}
            </Button>
          </>
        }
      >
        <p className="text-xs text-muted">
          Upload an identity document for a private review. Your document is not shown publicly.
        </p>
        {error && <p role="alert" className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p>}
        <form
          id="verification-form"
          onSubmit={(event) => void submitApplication(event)}
          className="mt-5 space-y-4"
        >
          <InputText name="legalName" aria-label="Full legal name" placeholder="Full legal name" maxLength={255} required />
          <InputText name="country" aria-label="Country" placeholder="Country" maxLength={100} required />
          <label className="block text-xs font-medium text-body">
            Document type
            <select name="documentType" required defaultValue="" className="mt-2 h-10 w-full rounded-lg border border-border-control bg-white px-3 text-xs text-body">
              <option value="" disabled>Select document type</option>
              <option value="passport">Passport</option>
              <option value="national_id">National ID</option>
              <option value="drivers_license">Driver's license</option>
            </select>
          </label>
          <label
            htmlFor="creator-document"
            className="block text-xs font-medium text-body"
          >
            Identity document
            <input
              id="creator-document"
              type="file"
              name="document"
              accept="image/jpeg,image/png,application/pdf"
              disabled={submitting}
              onChange={() => setError("")}
              className="mt-2 block w-full rounded-lg border border-border-control bg-white px-3 py-2.5 text-xs text-muted file:mr-3 file:rounded-md file:border-0 file:bg-orange-50 file:px-3 file:py-1.5 file:text-xs file:font-semibold file:text-primary"
              required
            />
            <span className="mt-1 block text-[11px] font-normal text-muted-light">
              Government-issued ID, PDF or image, up to 10 MB.
            </span>
          </label>
          <p className="text-[10px] leading-4 text-muted-soft">
            By submitting, you confirm that the information provided is accurate
            and belongs to you. Identity documents are stored privately.
          </p>
        </form>
      </Modal>
    </div>
  );
}
