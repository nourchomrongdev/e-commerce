"use client";

import { useState, type FormEvent } from "react";

const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:5000/api";

export default function ReportReviewButton({ reviewId }: { reviewId: number }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("spam");
  const [details, setDetails] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [submitted, setSubmitted] = useState(false);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const token = window.localStorage.getItem("marketplace-token");
    if (!token) {
      setError("Sign in to report a review.");
      return;
    }

    setBusy(true);
    setError("");
    try {
      const response = await fetch(`${apiUrl}/buyer/reviews/${reviewId}/report`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ reason, details }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Unable to submit this report.");
      setSubmitted(true);
      setOpen(false);
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Unable to submit this report.");
    } finally {
      setBusy(false);
    }
  };

  if (submitted) return <p role="status" className="mt-2 text-[9px] text-status-success">Report submitted for review.</p>;

  return (
    <div className="mt-2">
      <button type="button" onClick={() => { setOpen((current) => !current); setError(""); }} className="text-[9px] font-medium text-muted underline-offset-2 hover:text-primary hover:underline">
        {open ? "Cancel report" : "Report review"}
      </button>
      {open && (
        <form onSubmit={submit} className="mt-2 max-w-md space-y-2 rounded-lg border border-border bg-surface-muted p-3">
          <label className="block text-[10px] font-medium text-body">
            Reason
            <select value={reason} onChange={(event) => setReason(event.target.value)} className="mt-1 h-8 w-full rounded-md border border-border-control bg-white px-2 text-[10px]">
              <option value="spam">Spam</option>
              <option value="offensive">Offensive content</option>
              <option value="false_information">False information</option>
              <option value="other">Other</option>
            </select>
          </label>
          <label className="block text-[10px] font-medium text-body">
            Details {reason === "other" ? "(required)" : "(optional)"}
            <textarea value={details} onChange={(event) => setDetails(event.target.value)} maxLength={2000} required={reason === "other"} rows={2} className="mt-1 w-full resize-y rounded-md border border-border-control bg-white p-2 text-[10px]" />
          </label>
          {error && <p role="alert" className="text-[10px] text-status-danger">{error}</p>}
          <button type="submit" disabled={busy} className="rounded-md bg-primary px-3 py-1.5 text-[10px] font-semibold text-white disabled:opacity-50">
            {busy ? "Submitting..." : "Submit report"}
          </button>
        </form>
      )}
      {!open && error && <p role="alert" className="mt-1 text-[10px] text-status-danger">{error}</p>}
    </div>
  );
}
