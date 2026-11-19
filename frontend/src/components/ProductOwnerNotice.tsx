"use client";

import PublicIcon from "@/components/icons/PublicIcon";

export default function ProductOwnerNotice({ compact = false }: { compact?: boolean }) {
  return (
    <div
      className={`flex items-center gap-2.5 rounded-lg border border-amber-200 bg-amber-50 text-left ${compact ? "min-h-9 px-2.5 py-1.5" : "w-full max-w-[320px] items-start gap-3 p-3.5"}`}
      role="status"
    >
      <span className={`grid shrink-0 place-items-center rounded-full bg-amber-100 text-amber-700 ${compact ? "h-6 w-6" : "h-9 w-9"}`}>
        <PublicIcon name="lock" className={compact ? "h-3 w-3" : "h-4 w-4"} />
      </span>
      <div>
        <p className={`font-bold text-heading ${compact ? "text-[9px]" : "text-xs"}`}>
          This is your product
        </p>
        <p className={`text-muted ${compact ? "text-[8px] leading-3" : "mt-1 text-[10px] leading-4"}`}>
          You can&apos;t purchase your own listing.
        </p>
      </div>
    </div>
  );
}
