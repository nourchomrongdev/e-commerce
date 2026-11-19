"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import {
  formatMarketplacePrice,
  type MarketplaceProduct,
} from "@/lib/marketplace";

type Suggestions = {
  term: string;
  products: MarketplaceProduct[];
  error?: string;
};

const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:5000/api";

export default function MarketplaceSearchInput({
  defaultValue,
  storeSlug,
}: {
  defaultValue: string;
  storeSlug?: string;
}) {
  const [query, setQuery] = useState(defaultValue);
  const [suggestions, setSuggestions] = useState<Suggestions | null>(null);
  const [loading, setLoading] = useState(false);
  const [focused, setFocused] = useState(false);
  const [retry, setRetry] = useState(0);
  const controllerRef = useRef<AbortController | null>(null);
  const pointerLeaveTimeoutRef = useRef<number | null>(null);
  const trimmedQuery = query.trim();
  const activeSuggestions =
    suggestions?.term === trimmedQuery ? suggestions : null;
  const isOpen =
    focused &&
    trimmedQuery.length >= 2 &&
    (loading || activeSuggestions !== null);

  useEffect(() => {
    if (trimmedQuery.length < 2) return;

    const controller = new AbortController();
    controllerRef.current?.abort();
    controllerRef.current = controller;

    const timeout = window.setTimeout(() => {
      setLoading(true);
      const params = new URLSearchParams({
        search: trimmedQuery,
        page: "1",
        pageSize: "5",
        sort: "popular",
        suggestions: "true",
      });
      if (storeSlug) params.set("store", storeSlug);

      fetch(`${apiUrl.replace(/\/$/, "")}/marketplace?${params}`, {
        cache: "no-store",
        signal: controller.signal,
      })
        .then(async (response) => {
          if (!response.ok) {
            const body = response.headers
              .get("content-type")
              ?.includes("application/json")
              ? ((await response.json()) as { error?: string })
              : null;
            throw new Error(
              body?.error || `Search suggestions failed (${response.status}).`,
            );
          }
          return (await response.json()) as {
            products?: MarketplaceProduct[];
          };
        })
        .then((result) => {
          if (!controller.signal.aborted) {
            setSuggestions({
              term: trimmedQuery,
              products: result.products ?? [],
            });
          }
        })
        .catch((error: unknown) => {
          if (controller.signal.aborted) return;
          console.error("Unable to load marketplace search suggestions:", error);
          setSuggestions({
            term: trimmedQuery,
            products: [],
            error:
              error instanceof Error
                ? error.message
                : "Search suggestions could not be loaded.",
          });
        })
        .finally(() => {
          if (!controller.signal.aborted) setLoading(false);
        });
    }, 300);

    return () => {
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [retry, storeSlug, trimmedQuery]);

  const suggestionsList = () => (
    <div
      id="marketplace-search-suggestions"
      role="listbox"
      aria-label="Search suggestions"
      className="overflow-hidden rounded-xl border border-border-control bg-white py-2 shadow-xl"
    >
      {loading && (
        <p className="px-4 py-3 text-xs text-muted">Searching products…</p>
      )}
      {!loading && activeSuggestions?.error && (
        <div className="flex items-center justify-between gap-3 px-4 py-3">
          <p role="status" className="text-xs text-red-600">
            {activeSuggestions.error}
          </p>
          <button
            type="button"
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => setRetry((value) => value + 1)}
            className="shrink-0 text-xs font-semibold text-primary hover:underline"
          >
            Retry
          </button>
        </div>
      )}
      {!loading &&
        !activeSuggestions?.error &&
        activeSuggestions?.products.length === 0 && (
          <p role="status" className="px-4 py-3 text-xs text-muted">
            No matching products. Press Search to see all results.
          </p>
        )}
      {!loading &&
        activeSuggestions?.products.map((product) => (
          <Link
            key={product.id}
            role="option"
            aria-selected="false"
            href={`/marketplace/${encodeURIComponent(product.storeSlug)}/${encodeURIComponent(product.slug)}`}
            onClick={() => {
              setFocused(false);
            }}
            className="flex items-center justify-between gap-4 px-4 py-3 text-left no-underline transition hover:bg-surface-muted focus:bg-surface-muted focus:outline-none"
          >
            <span className="min-w-0">
              <span className="block truncate text-sm font-semibold text-heading">
                {product.name}
              </span>
              <span className="mt-1 block truncate text-[11px] text-muted">
                {product.categoryName} · {product.storeName}
              </span>
            </span>
            <span className="shrink-0 text-xs font-semibold text-primary">
              {product.isFree
                ? "Free"
                : formatMarketplacePrice(product.price, product.currency)}
            </span>
          </Link>
        ))}
      {!loading && activeSuggestions?.products.length ? (
        <button
          type="submit"
          onMouseDown={() => setFocused(false)}
          className="mt-1 w-full border-t border-divider px-4 py-3 text-left text-xs font-semibold text-primary hover:bg-surface-muted"
        >
          See all results for “{trimmedQuery}”
        </button>
      ) : null}
    </div>
  );

  return (
    <div
      className="relative flex min-w-0 flex-1"
      onMouseEnter={() => {
        if (pointerLeaveTimeoutRef.current !== null) {
          window.clearTimeout(pointerLeaveTimeoutRef.current);
          pointerLeaveTimeoutRef.current = null;
        }
      }}
      onMouseLeave={() => {
        if (window.matchMedia("(hover: none)").matches) return;
        pointerLeaveTimeoutRef.current = window.setTimeout(() => {
          setFocused(false);
          pointerLeaveTimeoutRef.current = null;
        }, 150);
      }}
    >
      <label className="sr-only" htmlFor="marketplace-search">
        Search products
      </label>
      <input
        id="marketplace-search"
        name="search"
        type="search"
        value={query}
        onChange={(event) => {
          const value = event.target.value;
          setQuery(value);
          setLoading(false);
          if (value.trim().length < 2) {
            setSuggestions(null);
          }
        }}
        onFocus={() => {
          setFocused(true);
        }}
        onBlur={() =>
          window.setTimeout(() => {
            setFocused(false);
          }, 150)
        }
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={isOpen}
        aria-controls="marketplace-search-suggestions"
        placeholder="Search products, creators or categories"
        className="h-11 min-w-0 flex-1 border-0 bg-transparent px-3 text-xs text-heading outline-none placeholder:text-muted sm:h-12 sm:px-4 sm:text-sm"
      />
      {isOpen && (
        <div
          className="absolute left-0 top-full z-30 mt-2 w-[min(48rem,calc(100vw-1.5rem))]"
        >
          {suggestionsList()}
        </div>
      )}
    </div>
  );
}
