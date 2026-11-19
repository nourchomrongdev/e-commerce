"use client";

import type { CSSProperties, Key, ReactNode } from "react";

type CreditDebitCardCarouselProps<T> = {
  items: T[];
  activeIndex: number;
  getKey: (item: T) => Key;
  onActiveIndexChange?: (index: number) => void;
  renderCard: (item: T, index: number, isActive: boolean) => ReactNode;
  mobileLayout?: "single" | "grid" | "slider";
  mobileGridClassName?: string;
  desktopCardClassName?: string;
  showDesktopNavigation?: boolean;
};

function relativePosition(index: number, activeIndex: number, length: number) {
  if (index === activeIndex) return 0;
  if (length === 2) return 1;

  const forward = (index - activeIndex + length) % length;
  if (forward === 1) return 1;
  if (forward === length - 1) return -1;
  return forward < length / 2 ? 2 : -2;
}

function slideStyle(position: number): CSSProperties {
  if (position === 0) {
    return {
      transform: "translate3d(0, 0, 36px) rotateY(0deg) scale(1)",
      opacity: 1,
      zIndex: 30,
      pointerEvents: "auto",
      visibility: "visible",
    };
  }

  if (position === -1 || position === 1) {
    const side = position < 0 ? -1 : 1;
    return {
      transform: `translate3d(${side * 60}%, 0, -72px) rotateY(${side * -12}deg) scale(.86)`,
      opacity: 0.62,
      zIndex: 20,
      filter: "saturate(.88)",
      pointerEvents: "auto",
      visibility: "visible",
    };
  }

  const side = position < 0 ? -1 : 1;
  return {
    transform: `translate3d(${side * 110}%, 0, -150px) rotateY(${side * -18}deg) scale(.74)`,
    opacity: 0,
    zIndex: 0,
    pointerEvents: "none",
    visibility: "hidden",
  };
}

export default function CreditDebitCardCarousel<T>({
  items,
  activeIndex,
  getKey,
  onActiveIndexChange,
  renderCard,
  mobileLayout = "single",
  mobileGridClassName = "grid gap-4 sm:grid-cols-2",
  desktopCardClassName = "max-w-md",
  showDesktopNavigation = true,
}: CreditDebitCardCarouselProps<T>) {
  const safeActiveIndex = items.length
    ? Math.max(0, Math.min(activeIndex, items.length - 1))
    : 0;

  const goTo = (offset: number) => {
    if (items.length < 2 || !onActiveIndexChange) return;
    onActiveIndexChange((safeActiveIndex + offset + items.length) % items.length);
  };

  return (
    <>
      {mobileLayout === "single" ? (
        <div className="md:hidden">
          {items[safeActiveIndex] !== undefined && renderCard(items[safeActiveIndex], safeActiveIndex, true)}
        </div>
      ) : mobileLayout === "grid" ? (
        <div className={`md:hidden ${mobileGridClassName}`}>
          {items.map((item, index) => (
            <div key={getKey(item)} className="min-w-0">
              {renderCard(item, index, true)}
            </div>
          ))}
        </div>
      ) : (
        <div className="overflow-hidden md:hidden">
          <div
            className="flex transition-transform duration-500 ease-out"
            style={{ transform: `translateX(-${safeActiveIndex * 100}%)` }}
          >
            {items.map((item, index) => (
              <div key={getKey(item)} className="flex min-w-full justify-center">
                {renderCard(item, index, index === safeActiveIndex)}
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="hidden md:block">
        <div className="relative mx-auto w-full max-w-5xl overflow-hidden rounded-2xl [perspective:1400px]">
          <div className={`relative mx-auto w-full ${desktopCardClassName} [transform-style:preserve-3d]`}>
            {items[safeActiveIndex] !== undefined && (
              <div aria-hidden="true" inert className="invisible pointer-events-none">
                {renderCard(items[safeActiveIndex], safeActiveIndex, true)}
              </div>
            )}
            {items.map((item, index) => {
              const position = relativePosition(index, safeActiveIndex, items.length);
              const isActive = position === 0;
              const isAdjacent = Math.abs(position) === 1;

              return (
                <div
                  key={getKey(item)}
                  aria-hidden={!isActive && !isAdjacent}
                  inert={!isActive && !isAdjacent}
                  className="absolute inset-0 transition-[transform,opacity,filter] duration-500 ease-out motion-reduce:transition-none"
                  style={slideStyle(position)}
                >
                  {isActive ? (
                    renderCard(item, index, true)
                  ) : (
                    <>
                      <div aria-hidden="true" inert className="pointer-events-none">
                        {renderCard(item, index, false)}
                      </div>
                      {isAdjacent && onActiveIndexChange && (
                        <button
                          type="button"
                          aria-label={`Show saved card ${index + 1}`}
                          onClick={() => onActiveIndexChange(index)}
                          className="absolute inset-x-0 top-0 z-10 aspect-[1.586/1] w-full rounded-2xl bg-transparent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
                        />
                      )}
                    </>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {showDesktopNavigation && items.length > 1 && onActiveIndexChange && (
          <nav aria-label="Saved card navigation" className="mt-4 flex items-center justify-center gap-5">
            <button
              type="button"
              aria-label="Previous saved card"
              onClick={() => goTo(-1)}
              className="grid h-9 w-9 place-items-center rounded-full border border-border-control bg-white text-lg text-muted transition hover:border-primary hover:text-primary"
            >
              ‹
            </button>
            <span className="text-[10px] font-semibold text-muted">
              {safeActiveIndex + 1} of {items.length}
            </span>
            <button
              type="button"
              aria-label="Next saved card"
              onClick={() => goTo(1)}
              className="grid h-9 w-9 place-items-center rounded-full border border-border-control bg-white text-lg text-muted transition hover:border-primary hover:text-primary"
            >
              ›
            </button>
          </nav>
        )}
      </div>
    </>
  );
}
