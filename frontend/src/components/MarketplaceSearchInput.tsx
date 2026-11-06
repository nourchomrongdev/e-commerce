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
  recommendations = [],
  storeSlug,
}: {
  defaultValue: string;
  recommendations?: MarketplaceProduct[];
  storeSlug?: string;
}) {
  const [query, setQuery] = useState(defaultValue);
  const [suggestions, setSuggestions] = useState<Suggestions | null>(null);
  const [loading, setLoading] = useState(false);
  const [focused, setFocused] = useState(false);
  const [retry, setRetry] = useState(0);
  const [mobileSearchOpen, setMobileSearchOpen] = useState(false);
  const [searchHistory, setSearchHistory] = useState<string[]>([]);
  const mobileInputRef = useRef<HTMLInputElement>(null);
  const controllerRef = useRef<AbortController | null>(null);
  const pointerLeaveTimeoutRef = useRef<number | null>(null);
  const trimmedQuery = query.trim();
  const activeSuggestions =
    suggestions?.term === trimmedQuery ? suggestions : null;
  const isOpen = focused && trimmedQuery.length >= 2;

  useEffect(() => {
    if (!mobileSearchOpen) return;
    const timeout = window.setTimeout(() => {
      try {
        const saved = window.localStorage.getItem("marketplace-search-history");
        setSearchHistory(saved ? (JSON.parse(saved) as string[]).slice(0, 8) : []);
      } catch (error) {
        console.error("Unable to read marketplace search history:", error);
        setSearchHistory([]);
      }
    }, 0);
    mobileInputRef.current?.focus();
    return () => window.clearTimeout(timeout);
  }, [mobileSearchOpen]);

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

  const saveSearch = (term: string) => {
    const next = [term.trim(), ...searchHistory.filter((item) => item !== term.trim())]
      .filter(Boolean)
      .slice(0, 8);
    setSearchHistory(next);
    try {
      window.localStorage.setItem("marketplace-search-history", JSON.stringify(next));
    } catch (error) {
      console.error("Unable to save marketplace search history:", error);
    }
  };

  const suggestionsList = (variant: "desktop" | "mobile") => (
    <div
      id={`marketplace-search-suggestions-${variant}`}
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
              saveSearch(trimmedQuery);
              setFocused(false);
              setMobileSearchOpen(false);
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
          onClick={() => saveSearch(trimmedQuery)}
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
          setLoading(value.trim().length >= 2);
          if (value.trim().length < 2) {
            setSuggestions(null);
          }
        }}
        onFocus={() => {
          setFocused(true);
          if (window.matchMedia("(max-width: 639px)").matches) {
            setMobileSearchOpen(true);
          }
        }}
        onBlur={() =>
          window.setTimeout(() => {
            if (!mobileInputRef.current?.matches(":focus")) setFocused(false);
          }, 150)
        }
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={isOpen}
        aria-controls="marketplace-search-suggestions-desktop"
        placeholder="Search products, creators or categories"
        className="h-11 min-w-0 flex-1 border-0 bg-transparent px-3 text-xs text-heading outline-none placeholder:text-muted sm:h-12 sm:px-4 sm:text-sm"
      />
      {isOpen && (
        <div
          className="absolute left-0 right-0 top-full z-30 mt-2 hidden sm:block"
        >
          {suggestionsList("desktop")}
        </div>
      )}
      {mobileSearchOpen && (
        <section
          role="dialog"
          aria-modal="true"
          aria-label="Search marketplace"
          className="fixed inset-0 z-[100] flex flex-col bg-white sm:hidden"
        >
          <header className="sticky top-0 flex min-h-16 shrink-0 items-center gap-2 border-b border-divider bg-white px-3 py-2">
            <button
              type="button"
              onClick={() => setMobileSearchOpen(false)}
              aria-label="Back to marketplace"
              className="grid h-10 w-9 shrink-0 place-items-center text-xl text-body"
            >
              ←
            </button>
            <input
              ref={mobileInputRef}
              type="search"
              role="combobox"
              aria-autocomplete="list"
              aria-expanded={isOpen}
              aria-controls="marketplace-search-suggestions-mobile"
              value={query}
              onChange={(event) => {
                const value = event.target.value;
                setQuery(value);
                setLoading(value.trim().length >= 2);
                if (value.trim().length < 2) setSuggestions(null);
              }}
              onFocus={() => setFocused(true)}
              onBlur={() => window.setTimeout(() => setFocused(false), 150)}
              placeholder="Search digital products"
              className="h-11 min-w-0 flex-1 rounded-full border border-primary px-4 text-sm outline-none focus:ring-2 focus:ring-primary/20"
            />
            {query && (
              <button
                type="button"
                aria-label="Clear search"
                onClick={() => {
                  setQuery("");
                  setSuggestions(null);
                  setLoading(false);
                  mobileInputRef.current?.focus();
                }}
                className="grid h-9 w-8 shrink-0 place-items-center text-lg text-muted"
              >
                ×
              </button>
            )}
            <button
              type="submit"
              onClick={() => {
                if (trimmedQuery) saveSearch(trimmedQuery);
                setMobileSearchOpen(false);
                setFocused(false);
              }}
              className="h-10 shrink-0 rounded-full bg-primary px-4 text-xs font-semibold text-white"
            >
              Search
            </button>
          </header>
          <div className="flex-1 overflow-y-auto p-3">
            {isOpen ? (
              suggestionsList("mobile")
            ) : (
              <div className="space-y-6">
                {searchHistory.length > 0 && (
                  <section>
                    <div className="mb-2 flex items-center justify-between">
                      <h2 className="text-sm font-semibold text-heading">
                        Recent searches
                      </h2>
                      <button
                        type="button"
                        onClick={() => {
                          setSearchHistory([]);
                          try {
                            window.localStorage.removeItem("marketplace-search-history");
                          } catch (error) {
                            console.error("Unable to clear search history:", error);
                          }
                        }}
                        className="text-xs text-muted"
                      >
                        Clear
                      </button>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {searchHistory.map((term) => (
                        <button
                          key={term}
                          type="button"
                          onClick={() => setQuery(term)}
                          className="rounded-full bg-slate-100 px-3 py-2 text-xs text-body"
                        >
                          {term}
                        </button>
                      ))}
                    </div>
                  </section>
                )}
                {recommendations.length > 0 && (
                  <section>
                    <h2 className="mb-2 text-sm font-semibold text-heading">
                      Popular products
                    </h2>
                    {recommendations.slice(0, 5).map((product) => (
                      <Link
                        key={product.id}
                        href={`/marketplace/${encodeURIComponent(product.storeSlug)}/${encodeURIComponent(product.slug)}`}
                        onClick={() => setMobileSearchOpen(false)}
                        className="block border-b border-divider py-3 text-sm text-heading no-underline"
                      >
                        {product.name}
                        <span className="mt-1 block text-xs text-muted">
                          {product.categoryName} · {product.storeName}
                        </span>
                      </Link>
                    ))}
                  </section>
                )}
              </div>
            )}
          </div>
        </section>
      )}
    </div>
  );
}
