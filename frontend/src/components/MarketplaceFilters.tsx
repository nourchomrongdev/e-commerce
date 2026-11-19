"use client";

import { createPortal } from "react-dom";
import PublicIcon from "@/components/icons/PublicIcon";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useRouter, useSearchParams } from "next/navigation";

const subscribeToNothing = () => () => {};
const getClientMounted = () => true;
const getServerMounted = () => false;

type Option = { value: string; label: string };
type Subcategory = Option & {
  parentId: number;
  parentSlug: string;
  productCount: number;
};
type FilterValues = {
  category: string[];
  subcategory: string[];
  productType: string[];
  license: string[];
  minPrice: string;
  maxPrice: string;
  rating: string;
  availability: string;
  discounted: boolean;
  sort: string;
};

const multiFilterKeys = [
  "category",
  "subcategory",
  "productType",
  "license",
] as const;

const emptyValues: FilterValues = {
  category: [],
  subcategory: [],
  productType: [],
  license: [],
  minPrice: "",
  maxPrice: "",
  rating: "",
  availability: "",
  discounted: false,
  sort: "popular",
};

function getInitialValues(searchParams: URLSearchParams): FilterValues {
  return {
    category: searchParams.getAll("category"),
    subcategory: searchParams.getAll("subcategory"),
    productType: searchParams.getAll("productType"),
    license: searchParams.getAll("license"),
    minPrice: searchParams.get("minPrice") || "",
    maxPrice: searchParams.get("maxPrice") || "",
    rating: searchParams.get("rating") || "",
    availability: searchParams.get("availability") || "",
    discounted: searchParams.get("discounted") === "true",
    sort: searchParams.get("sort") || "popular",
  };
}

function countSelected(values: FilterValues) {
  return (
    multiFilterKeys.reduce((count, key) => count + values[key].length, 0) +
    Number(Boolean(values.minPrice || values.maxPrice)) +
    Number(Boolean(values.rating)) +
    Number(Boolean(values.availability)) +
    Number(values.discounted)
  );
}

function makeSearchUrl(
  current: URLSearchParams,
  values: FilterValues,
  search: string,
  basePath: string,
) {
  const params = new URLSearchParams();
  if (search) params.set("search", search);
  for (const key of multiFilterKeys) {
    for (const value of values[key]) params.append(key, value);
  }
  if (values.minPrice) params.set("minPrice", values.minPrice);
  if (values.maxPrice) params.set("maxPrice", values.maxPrice);
  if (values.rating) params.set("rating", values.rating);
  if (values.availability) params.set("availability", values.availability);
  if (values.discounted) params.set("discounted", "true");
  if (values.sort && values.sort !== "popular") params.set("sort", values.sort);
  const pageSize = current.get("pageSize");
  if (pageSize) params.set("pageSize", pageSize);
  return `${basePath}${params.size ? `?${params.toString()}` : ""}`;
}

function FilterSection({
  title,
  options,
  values,
  onChange,
  defaultOpen = false,
}: {
  title: string;
  options: Option[];
  values: string[];
  onChange: (value: string) => void;
  defaultOpen?: boolean;
}) {
  if (!options.length) return null;
  return (
    <details
      open={defaultOpen}
      className="border-b border-divider py-3 last:border-0"
    >
      <summary className="flex min-h-10 cursor-pointer list-none items-center gap-2 text-sm font-semibold text-heading">
        <span className="flex-1">{title}</span>
        {values.length > 0 && (
          <span className="grid h-5 min-w-5 place-items-center rounded-full bg-orange-50 px-1.5 text-[10px] font-semibold text-primary">
            {values.length}
          </span>
        )}
        <PublicIcon name="down" className="h-4 w-4 text-muted" />
      </summary>
      <div className="mt-3 grid max-h-52 gap-1 overflow-y-auto sm:grid-cols-2">
        {options.map((option) => (
          <label
            key={option.value}
            className="flex min-h-11 cursor-pointer items-center gap-3 rounded-lg px-2 text-xs text-body hover:bg-surface-muted"
          >
            <input
              type="checkbox"
              checked={values.includes(option.value)}
              onChange={() => onChange(option.value)}
              className="h-4 w-4 accent-primary"
            />
            <span className="min-w-0 truncate">{option.label}</span>
          </label>
        ))}
      </div>
    </details>
  );
}

export default function MarketplaceFilters({
  categories,
  subcategories,
  productTypes,
  licenses,
  search,
  resultCount,
  basePath = "/marketplace",
}: {
  categories: Option[];
  subcategories: Subcategory[];
  productTypes: Option[];
  licenses: Option[];
  search: string;
  resultCount: number;
  basePath?: string;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const currentParams = useMemo(
    () => new URLSearchParams(searchParams.toString()),
    [searchParams],
  );
  const [values, setValues] = useState(() => getInitialValues(currentParams));
  const [isOpen, setIsOpen] = useState(false);
  const mounted = useSyncExternalStore(
    subscribeToNothing,
    getClientMounted,
    getServerMounted,
  );
  const [priceError, setPriceError] = useState("");
  const filterButtonRef = useRef<HTMLButtonElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const selectedCount = countSelected(values);

  useEffect(() => {
    if (!isOpen) return;
    const previousOverflow = document.body.style.overflow;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsOpen(false);
        filterButtonRef.current?.focus();
      }
    };
    document.body.style.overflow = "hidden";
    closeButtonRef.current?.focus();
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [isOpen]);

  const apply = (nextValues = values) => {
    const minPrice = nextValues.minPrice.trim()
      ? Number(nextValues.minPrice)
      : null;
    const maxPrice = nextValues.maxPrice.trim()
      ? Number(nextValues.maxPrice)
      : null;
    if (
      [minPrice, maxPrice].some(
        (price) =>
          price !== null &&
          (!Number.isFinite(price) || price < 0 || price > 1000000000),
      )
    ) {
      setPriceError("Prices must be between 0 and 1,000,000,000.");
      return;
    }
    if (minPrice !== null && maxPrice !== null && minPrice > maxPrice) {
      setPriceError("Minimum price cannot exceed maximum price.");
      return;
    }
    setPriceError("");
    router.push(makeSearchUrl(currentParams, nextValues, search, basePath));
    setValues(nextValues);
    setIsOpen(false);
  };
  const reset = () => {
    setValues({ ...emptyValues });
    setPriceError("");
  };
  const close = () => {
    setIsOpen(false);
    filterButtonRef.current?.focus();
  };
  const toggle = (key: (typeof multiFilterKeys)[number], value: string) => {
    if (key === "category" && values.category.includes(value)) {
      const nextCategories = values.category.filter((entry) => entry !== value);
      setValues((current) => ({
        ...current,
        category: nextCategories,
        subcategory: current.subcategory.filter((slug) =>
          subcategories.some(
            (item) =>
              item.value === slug &&
              (item.parentSlug !== value || nextCategories.includes(value)),
          ),
        ),
      }));
      return;
    }
    setValues((current) => ({
      ...current,
      [key]: current[key].includes(value)
        ? current[key].filter((entry) => entry !== value)
        : [...current[key], value],
    }));
  };

  const activeOptions = [
    ...multiFilterKeys.flatMap((key) => {
      const options = {
        category: categories,
        subcategory: subcategories,
        productType: productTypes,
        license: licenses,
      }[key];
      return values[key].map((value) => ({
        key,
        value,
        label: options.find((option) => option.value === value)?.label || value,
      }));
    }),
    ...(values.minPrice || values.maxPrice
      ? [
          {
            key: "price" as const,
            value: "price",
            label: `Price: ${values.minPrice || "0"} – ${values.maxPrice || "Any"}`,
          },
        ]
      : []),
    ...(values.rating
      ? [{ key: "rating" as const, value: values.rating, label: `${values.rating}+ stars` }]
      : []),
    ...(values.availability
      ? [{ key: "availability" as const, value: values.availability, label: values.availability }]
      : []),
    ...(values.discounted
      ? [{ key: "discounted" as const, value: "true", label: "Discounted" }]
      : []),
    ...(search
      ? [{ key: "search" as const, value: search, label: `Search: ${search}` }]
      : []),
    ...(values.sort !== "popular"
      ? [
          {
            key: "sort" as const,
            value: values.sort,
            label: `Sort: ${values.sort.replaceAll("_", " ")}`,
          },
        ]
      : []),
  ];

  const removeChip = (key: string, value: string) => {
    if (multiFilterKeys.includes(key as (typeof multiFilterKeys)[number])) {
      const multiKey = key as (typeof multiFilterKeys)[number];
      apply({
        ...values,
        [multiKey]: values[multiKey].filter((entry) => entry !== value),
      });
    } else if (key === "price") {
      apply({ ...values, minPrice: "", maxPrice: "" });
    } else if (key === "rating") {
      apply({ ...values, rating: "" });
    } else if (key === "availability") {
      apply({ ...values, availability: "" });
    } else if (key === "discounted") {
      apply({ ...values, discounted: false });
    } else if (key === "search") {
      router.push(makeSearchUrl(currentParams, values, "", basePath));
    } else if (key === "sort") {
      apply({ ...values, sort: "popular" });
    }
  };

  const panelContent = (
    <>
      <div className="grid gap-1 border-b border-divider py-4 sm:grid-cols-2">
        <label className="grid gap-1 text-xs font-medium text-body">
          Minimum price
          <input
            type="number"
            min="0"
            step="0.01"
            inputMode="decimal"
            value={values.minPrice}
            onChange={(event) => {
              setPriceError("");
              setValues((current) => ({
                ...current,
                minPrice: event.target.value,
              }));
            }}
            className="h-11 rounded-lg border border-border-control px-3 text-sm"
          />
        </label>
        <label className="grid gap-1 text-xs font-medium text-body">
          Maximum price
          <input
            type="number"
            min="0"
            step="0.01"
            inputMode="decimal"
            value={values.maxPrice}
            onChange={(event) => {
              setPriceError("");
              setValues((current) => ({
                ...current,
                maxPrice: event.target.value,
              }));
            }}
            className="h-11 rounded-lg border border-border-control px-3 text-sm"
          />
        </label>
        {priceError && (
          <p role="alert" className="text-xs text-red-600 sm:col-span-2">
            {priceError}
          </p>
        )}
      </div>
      <FilterSection
        title="Category"
        options={categories}
        values={values.category}
        onChange={(value) => toggle("category", value)}
        defaultOpen={values.category.length > 0}
      />
      {values.category.length > 0 && (
        <FilterSection
          title="Subcategory"
          options={subcategories
            .filter(
              (item) =>
                values.category.length === 0 ||
                values.category.includes(item.parentSlug),
            )
            .map(({ value, label }) => ({ value, label }))}
          values={values.subcategory}
          onChange={(value) => toggle("subcategory", value)}
          defaultOpen={values.subcategory.length > 0}
        />
      )}
      <FilterSection
        title="Product type"
        options={productTypes}
        values={values.productType}
        onChange={(value) => toggle("productType", value)}
        defaultOpen={values.productType.length > 0}
      />
      <FilterSection
        title="License"
        options={licenses}
        values={values.license}
        onChange={(value) => toggle("license", value)}
        defaultOpen={values.license.length > 0}
      />
      <div className="grid gap-3 border-b border-divider py-4 sm:grid-cols-2">
        <label className="grid gap-1 text-xs font-medium text-body">
          Minimum rating
          <select
            value={values.rating}
            onChange={(event) =>
              setValues((current) => ({ ...current, rating: event.target.value }))
            }
            className="h-11 rounded-lg border border-border-control bg-white px-3 text-sm"
          >
            <option value="">Any rating</option>
            <option value="4">4 stars & up</option>
            <option value="3">3 stars & up</option>
            <option value="2">2 stars & up</option>
            <option value="1">1 star & up</option>
          </select>
        </label>
        <label className="grid gap-1 text-xs font-medium text-body">
          Availability
          <select
            value={values.availability}
            onChange={(event) =>
              setValues((current) => ({
                ...current,
                availability: event.target.value,
              }))
            }
            className="h-11 rounded-lg border border-border-control bg-white px-3 text-sm"
          >
            <option value="">Free or paid</option>
            <option value="free">Free</option>
            <option value="paid">Paid</option>
          </select>
        </label>
        <label className="flex min-h-11 items-center gap-3 text-xs font-medium text-body sm:col-span-2">
          <input
            type="checkbox"
            checked={values.discounted}
            onChange={(event) =>
              setValues((current) => ({
                ...current,
                discounted: event.target.checked,
              }))
            }
            className="h-4 w-4 accent-primary"
          />
          Discounted products only
        </label>
      </div>
    </>
  );

  return (
    <div className="relative mt-3">
      <div className="flex items-center justify-between gap-2 sm:justify-center sm:gap-3">
        <label className="hidden text-xs font-medium text-muted sm:block" htmlFor="marketplace-sort">
          Sort by
        </label>
        <select
          id="marketplace-sort"
          value={values.sort}
          onChange={(event) => {
            const nextValues = { ...values, sort: event.target.value };
            setValues(nextValues);
            router.push(makeSearchUrl(currentParams, nextValues, search, basePath));
          }}
          className="h-10 min-w-0 flex-1 rounded-lg border border-border-control bg-white px-3 text-xs text-body sm:w-44 sm:flex-none"
        >
          <option value="relevance">Relevance</option>
          <option value="newest">Newest</option>
          <option value="best_selling">Best selling</option>
          <option value="popular">Most popular</option>
          <option value="rating">Highest rated</option>
          <option value="price_asc">Price: low to high</option>
          <option value="price_desc">Price: high to low</option>
        </select>
        <button
          type="button"
          onClick={() => setIsOpen(true)}
          ref={filterButtonRef}
          aria-haspopup="dialog"
          aria-expanded={isOpen}
          className="inline-flex h-10 shrink-0 items-center gap-2 rounded-lg border border-border-control bg-white px-3 text-xs font-semibold text-heading transition hover:border-primary hover:bg-surface-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
        >
          <PublicIcon name="filter" className="h-4 w-4 text-heading" />
          <span>Filters</span>
          {selectedCount > 0 && (
            <span className="grid h-5 min-w-5 place-items-center rounded-full bg-primary px-1 text-[10px] font-bold text-white">
              {selectedCount}
            </span>
          )}
        </button>
      </div>

      {activeOptions.length > 0 && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {activeOptions.map((option) => (
            <button
              key={`${option.key}-${option.value}`}
              type="button"
              onClick={() => removeChip(option.key, option.value)}
              className="inline-flex min-h-8 items-center gap-2 rounded-full border border-primary/20 bg-orange-50 px-3 text-[11px] text-primary"
            >
              {option.label}
              <span aria-hidden="true">×</span>
              <span className="sr-only">Remove {option.label} filter</span>
            </button>
          ))}
          <button
            type="button"
            onClick={() => apply({ ...emptyValues, sort: values.sort })}
            className="min-h-8 px-2 text-[11px] font-semibold text-muted underline"
          >
            Clear all
          </button>
        </div>
      )}

      {mounted && createPortal(
        <>
          <button
            type="button"
            aria-label="Close filters"
            aria-hidden={!isOpen}
            tabIndex={-1}
            onClick={close}
            className={`fixed inset-0 z-[190] bg-slate-950/40 transition-opacity duration-300 motion-reduce:transition-none ${
              isOpen ? "opacity-100" : "pointer-events-none opacity-0"
            }`}
          />
          <section
            role="dialog"
            aria-modal={isOpen}
            aria-hidden={!isOpen}
            aria-labelledby="marketplace-filters-title"
            inert={!isOpen}
            className={`fixed inset-0 z-[200] flex w-full flex-col border-0 bg-white shadow-2xl transition-transform duration-300 ease-out motion-reduce:transition-none md:left-auto md:w-[40vw] md:border-l ${
              isOpen ? "translate-x-0" : "pointer-events-none translate-x-full"
            }`}
          >
            <header className="flex h-16 shrink-0 items-center justify-between border-b border-divider px-4 sm:px-6">
              <div className="min-w-0">
                <h2
                  id="marketplace-filters-title"
                  className="text-base font-bold text-heading"
                >
                  Filters
                  {selectedCount > 0 && (
                    <span className="ml-2 text-xs font-medium text-muted">
                      {selectedCount} selected
                    </span>
                  )}
                </h2>
                <p className="mt-0.5 text-[11px] text-muted">
                  {resultCount} matching products
                </p>
              </div>
              <button
                ref={closeButtonRef}
                type="button"
                onClick={close}
                className="grid h-10 w-10 shrink-0 place-items-center rounded-full text-body transition hover:bg-surface-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
                aria-label="Close filters"
              >
                <PublicIcon name="x" className="h-5 w-5" />
              </button>
            </header>
            <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-5 sm:px-6">
              {panelContent}
            </div>
            <footer className="flex shrink-0 gap-3 border-t border-divider bg-white px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:px-6">
              <button
                type="button"
                onClick={reset}
                className="h-12 flex-1 rounded-xl border border-border-control text-sm font-semibold text-body transition hover:bg-surface-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
              >
                Reset all
              </button>
              <button
                type="button"
                onClick={() => apply()}
                className="h-12 flex-1 rounded-xl bg-primary text-sm font-semibold text-white transition hover:bg-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
              >
                Apply filters
              </button>
            </footer>
          </section>
        </>,
        document.body,
      )}
    </div>
  );
}
