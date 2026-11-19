"use client";

import PublicIcon from "@/components/icons/PublicIcon";

export default function MarketplaceUnavailable() {
  return (
    <section className="mx-auto my-12 max-w-xl rounded-2xl border border-amber-200 bg-white p-6 text-center shadow-sm">
      <span className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-amber-50 text-amber-700">
        <PublicIcon name="warning" className="h-6 w-6" />
      </span>
      <h1 className="mt-4 text-lg font-bold text-heading">Marketplace temporarily unavailable</h1>
      <p className="mt-2 text-sm leading-6 text-muted">
        We couldn&apos;t connect to the marketplace service. Check that the API is running, then try again.
      </p>
      <button
        type="button"
        onClick={() => window.location.reload()}
        className="mt-5 rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-primary-hover"
      >
        Try again
      </button>
    </section>
  );
}
