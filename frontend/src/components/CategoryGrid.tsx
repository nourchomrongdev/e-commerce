import Link from "next/link";
import PublicIcon from "@/components/icons/PublicIcon";
import type { MarketplaceCategory } from "@/lib/marketplace";

const categoryStyles = [
  { icon: "product", tone: "orange" },
  { icon: "type", tone: "teal" },
  { icon: "file-search-corner", tone: "indigo" },
  { icon: "store", tone: "blue" },
  { icon: "download", tone: "pink" },
  { icon: "shopping-basket", tone: "navy" },
] as const;

const toneClasses = {
  orange: "border-t-storefront-orange text-storefront-orange",
  teal: "border-t-storefront-teal text-storefront-teal",
  indigo: "border-t-storefront-indigo text-storefront-indigo",
  blue: "border-t-storefront-blue text-storefront-blue",
  pink: "border-t-storefront-pink text-storefront-pink",
  navy: "border-t-storefront-navy text-storefront-navy",
};

export default function CategoryGrid({
  categories,
  compact = false,
  activeSlug = "",
}: {
  categories: MarketplaceCategory[];
  compact?: boolean;
  activeSlug?: string;
}) {
  return (
    <div
      className={`grid grid-cols-2 gap-2 sm:gap-3 lg:grid-cols-3 xl:grid-cols-4 ${compact ? "" : "2xl:grid-cols-5"}`}
    >
      {categories.map((category, index) => {
        const style = categoryStyles[index % categoryStyles.length];
        const tone = toneClasses[style.tone];
        const isActive = category.slug === activeSlug;
        return (
          <Link
            key={category.id}
            href={`/marketplace?category=${encodeURIComponent(category.slug)}`}
            aria-current={isActive ? "page" : undefined}
            className={`group flex min-h-[72px] min-w-0 items-center gap-2 rounded-xl border border-slate-200 border-t-2 bg-white px-2.5 py-2 text-left no-underline shadow-sm transition hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-md sm:min-h-[88px] sm:gap-4 sm:px-4 sm:py-3 ${tone.split(" ")[0]} ${isActive ? "border-primary bg-orange-50/40 ring-1 ring-primary/20" : ""}`}
          >
            <span
              className={`grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-slate-50 sm:h-11 sm:w-11 ${tone.split(" ")[1]}`}
            >
              <PublicIcon name={style.icon} className="h-4 w-4 sm:h-5 sm:w-5" />
            </span>
            <span className="min-w-0">
              <b className="block truncate text-[11px] font-semibold text-storefront-navy sm:text-sm">
                {category.name}
              </b>
              <small className="mt-1 block text-[8px] text-muted sm:text-[10px]">
                {category.productCount} products
              </small>
            </span>
            <span className="ml-auto shrink-0 text-storefront-orange transition group-hover:translate-x-0.5">
              <PublicIcon name="right" className="h-4 w-4" />
            </span>
          </Link>
        );
      })}
    </div>
  );
}
