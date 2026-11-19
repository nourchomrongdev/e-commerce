"use client";

import Link from "next/link";
import { useState } from "react";
import PublicIcon from "@/components/icons/PublicIcon";

const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:5000/api";

export default function WishlistButton({ productId, productName }: { productId: string; productName: string }) {
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");
  const [needsSignIn, setNeedsSignIn] = useState(false);

  const save = async () => {
    if (busy || saved) return;
    const token = window.localStorage.getItem("marketplace-token");
    if (!token) {
      setNeedsSignIn(true);
      setError("");
      return;
    }
    setBusy(true);
    setError("");
    setNeedsSignIn(false);
    try {
      const response = await fetch(`${apiUrl.replace(/\/+$/, "")}/buyer/wishlist`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ productId }),
      });
      let data: unknown;
      try {
        data = await response.json();
      } catch {
        throw new Error(`Wishlist request failed (${response.status}).`);
      }
      if (!response.ok) {
        const serverError =
          data &&
          typeof data === "object" &&
          "error" in data &&
          typeof data.error === "string"
            ? data.error
            : null;
        throw new Error(
          serverError ?? `Unable to save this product (${response.status}).`,
        );
      }
      setSaved(true);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Unable to save this product.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="relative">
      <button
        type="button"
        disabled={busy || saved}
        onClick={() => void save()}
        aria-label={saved ? `${productName} is saved to your wishlist` : `Save ${productName} to wishlist`}
        aria-pressed={saved}
        title={saved ? "Saved to wishlist" : "Add to wishlist"}
        className={`grid h-11 w-11 shrink-0 place-items-center rounded-xl border shadow-sm transition duration-200 hover:-translate-y-0.5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:cursor-default disabled:hover:translate-y-0 ${
          saved
            ? "border-orange-200 bg-orange-50 text-primary"
            : "border-border-control bg-white text-slate-600 hover:border-primary/50 hover:bg-orange-50 hover:text-primary hover:shadow-md"
        }`}
      >
        <PublicIcon name="heart-plus" className={`h-5 w-5 transition-transform ${saved ? "scale-105" : ""}`} />
        {busy && <span className="sr-only">Saving to wishlist…</span>}
      </button>
      {needsSignIn && (
        <Link
          href="/login"
          className="absolute right-0 top-full z-20 mt-2 whitespace-nowrap rounded-lg border border-border-control bg-white px-3 py-2 text-[10px] font-semibold text-primary shadow-lg no-underline hover:underline"
        >
          Sign in to save
        </Link>
      )}
      {error && (
        <p
          role="alert"
          className="absolute right-0 top-full z-20 mt-2 w-52 rounded-lg border border-red-100 bg-white px-3 py-2 text-[10px] text-status-danger shadow-lg"
        >
          {error}
        </p>
      )}
    </div>
  );
}
