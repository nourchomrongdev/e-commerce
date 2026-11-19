"use client";

import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";
import { useToast } from "@/components/ui/GlobalToastProvider";
import { routes } from "@/lib/routeController";

const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:5000/api";

type ReviewEligibility = {
  hasPurchased: boolean;
  hasReviewed: boolean;
  reviewStatus: string | null;
  eligible: boolean;
};

export default function ProductReviewForm({ productId }: { productId: number }) {
  const toast = useToast();
  const [token] = useState(() => typeof window === "undefined" ? "" : window.localStorage.getItem("marketplace-token") || "");
  const [eligibility, setEligibility] = useState<ReviewEligibility | null>(null);
  const [eligibilityError, setEligibilityError] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [rating, setRating] = useState(5);
  const [title, setTitle] = useState("");
  const [comment, setComment] = useState("");

  useEffect(() => {
    if (!token) {
      const timer = window.setTimeout(() => setLoading(false), 0);
      return () => window.clearTimeout(timer);
    }

    const controller = new AbortController();
    fetch(`${apiUrl}/buyer/products/${productId}/review-eligibility`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
      signal: controller.signal,
    })
      .then(async (response) => {
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error || "Unable to check review eligibility.");
        setEligibility(payload as ReviewEligibility);
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        const message = error instanceof Error ? error.message : "Unable to check review eligibility.";
        setEligibilityError(message);
        toast.error(message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [productId, toast, token]);

  const submitReview = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!token || !eligibility?.eligible || saving) return;
    const trimmedTitle = title.trim();
    const trimmedComment = comment.trim();
    if (!trimmedTitle && !trimmedComment) {
      toast.error("Add a title or a comment before submitting your review.");
      return;
    }

    setSaving(true);
    try {
      const response = await fetch(`${apiUrl}/buyer/reviews`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ productId, rating, title: trimmedTitle, comment: trimmedComment }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Unable to submit your review.");
      setEligibility({ hasPurchased: true, hasReviewed: true, reviewStatus: "pending", eligible: false });
      setTitle("");
      setComment("");
      toast.success("Your verified-purchase review was submitted for moderation.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to submit your review.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="mt-5 rounded-xl border border-border bg-surface-muted p-4">
      <h3 className="text-sm font-bold text-heading">Write a review</h3>
      {loading ? (
        <p className="mt-2 text-xs text-muted">Checking purchase eligibility...</p>
      ) : !token ? (
        <p className="mt-2 text-xs leading-5 text-muted">
          Sign in to check whether you can review this product. Reviews are limited to verified purchases.{" "}
          <Link href={routes.auth.login()} className="font-semibold text-primary no-underline hover:underline">Sign in</Link>
        </p>
      ) : eligibilityError ? (
        <p role="alert" className="mt-2 text-xs leading-5 text-status-danger">{eligibilityError}</p>
      ) : eligibility?.eligible ? (
        <form onSubmit={submitReview} className="mt-3 space-y-3">
          <p className="text-[11px] font-medium text-emerald-700">Verified purchase confirmed</p>
          <fieldset>
            <legend className="text-[11px] font-semibold text-body">Your rating</legend>
            <div className="mt-1 flex gap-1" role="radiogroup" aria-label="Your rating">
              {[1, 2, 3, 4, 5].map((value) => (
                <button
                  key={value}
                  type="button"
                  role="radio"
                  aria-checked={rating === value}
                  aria-label={`${value} star${value === 1 ? "" : "s"}`}
                  onClick={() => setRating(value)}
                  className={`rounded px-1 text-xl leading-none ${value <= rating ? "text-amber-500" : "text-slate-300"}`}
                >★</button>
              ))}
            </div>
          </fieldset>
          <label className="block text-[11px] font-semibold text-body">
            Review title <span className="font-normal text-muted">(optional)</span>
            <input value={title} onChange={(event) => setTitle(event.target.value)} maxLength={255} placeholder="Summarize your experience" className="mt-1 h-9 w-full rounded-md border border-border-control bg-white px-3 text-xs font-normal outline-none placeholder:text-muted-faint focus:border-primary" />
          </label>
          <label className="block text-[11px] font-semibold text-body">
            Your review <span className="font-normal text-muted">(required)</span>
            <textarea required value={comment} onChange={(event) => setComment(event.target.value)} maxLength={5000} rows={4} placeholder="What did you like? How did the product work for you?" className="mt-1 w-full resize-y rounded-md border border-border-control bg-white p-3 text-xs font-normal outline-none placeholder:text-muted-faint focus:border-primary" />
            <span className="mt-1 block text-right text-[9px] font-normal text-muted">{comment.length.toLocaleString()} / 5,000</span>
          </label>
          <div className="flex items-center justify-between gap-3">
            <p className="text-[10px] leading-4 text-muted">Your review will appear after moderation.</p>
            <button type="submit" disabled={saving} className="rounded-lg bg-primary px-4 py-2 text-[11px] font-semibold text-white transition hover:bg-primary-hover disabled:opacity-50">{saving ? "Submitting..." : "Submit review"}</button>
          </div>
        </form>
      ) : eligibility?.hasReviewed ? (
        <p className="mt-2 text-xs leading-5 text-muted">You have already reviewed this product. Current review status: <span className="font-semibold capitalize text-body">{eligibility.reviewStatus || "submitted"}</span>.</p>
      ) : eligibility?.hasPurchased ? (
        <p className="mt-2 text-xs leading-5 text-muted">This purchase is not eligible for another review.</p>
      ) : (
        <p className="mt-2 text-xs leading-5 text-muted">Only buyers with a completed purchase can submit a verified review.</p>
      )}
    </section>
  );
}
