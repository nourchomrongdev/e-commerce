"use client";

import { createPortal } from "react-dom";
import { useEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import PublicIcon from "@/components/icons/PublicIcon";

const subscribeToSearchToggleSlot = (onStoreChange: () => void) => {
  if (typeof document === "undefined" || !document.body) return () => {};
  const observer = new MutationObserver(onStoreChange);
  observer.observe(document.body, { childList: true, subtree: true });
  return () => observer.disconnect();
};

const getSearchToggleSlotSnapshot = () =>
  typeof document !== "undefined" &&
  Boolean(document.getElementById("marketplace-search-toggle-slot"));
const getServerSnapshot = () => false;

export default function MarketplaceToolbar({
  children,
  initiallyExpanded = false,
}: {
  children: ReactNode;
  initiallyExpanded?: boolean;
}) {
  const [expanded, setExpanded] = useState(initiallyExpanded);
  const hasSearchToggleSlot = useSyncExternalStore(
    subscribeToSearchToggleSlot,
    getSearchToggleSlotSnapshot,
    getServerSnapshot,
  );

  useEffect(() => {
    if (!expanded) return;
    const closeOnScroll = (event: WheelEvent) => {
      if (event.deltaY > 0) setExpanded(false);
    };
    const closeOnTouchScroll = (event: TouchEvent) => {
      if (event.touches[0]?.clientY < touchStartY) setExpanded(false);
    };
    let touchStartY = 0;
    const recordTouchStart = (event: TouchEvent) => {
      touchStartY = event.touches[0]?.clientY ?? 0;
    };
    window.addEventListener("wheel", closeOnScroll, { passive: true });
    window.addEventListener("touchstart", recordTouchStart, { passive: true });
    window.addEventListener("touchmove", closeOnTouchScroll, { passive: true });
    return () => {
      window.removeEventListener("wheel", closeOnScroll);
      window.removeEventListener("touchstart", recordTouchStart);
      window.removeEventListener("touchmove", closeOnTouchScroll);
    };
  }, [expanded]);

  return (
    <section className="sticky top-14 z-20 -mx-3 border-b border-slate-200 bg-background/95 px-3 py-2 backdrop-blur sm:-mx-6 sm:px-6 sm:py-3">
      <div className="mx-auto w-full max-w-3xl">
        <div
          id="marketplace-search-controls"
          className={`${expanded ? "block" : "hidden"} min-[1200px]:block`}
        >
          {children}
        </div>
      </div>
      {hasSearchToggleSlot && document.getElementById("marketplace-search-toggle-slot") &&
        createPortal(
          <button
            type="button"
            aria-label={expanded ? "Hide search and filters" : "Show search and filters"}
            aria-expanded={expanded}
            aria-controls="marketplace-search-controls"
            onClick={() => setExpanded((current) => !current)}
            className="grid h-9 w-9 place-items-center rounded-lg text-slate-700 hover:bg-accent-light focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
          >
            <PublicIcon name={expanded ? "x" : "search"} className="h-4 w-4" />
          </button>,
          document.getElementById("marketplace-search-toggle-slot")!,
        )}
    </section>
  );
}
