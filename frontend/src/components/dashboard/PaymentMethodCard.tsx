"use client";

type PaymentMethodCardProps = {
  method: string;
  cardName?: string;
  cardNumber?: string;
  lastDigits?: string | null;
  cardExpiry?: string;
  cardBrand?: string;
  paypalEmail?: string;
  isPrimary?: boolean;
  flipped?: boolean;
  selected?: boolean;
  disabled?: boolean;
  actionsDisabled?: boolean;
  showControls?: boolean;
  compact?: boolean;
  onFlip?: () => void;
  onSelect?: () => void;
  onSetPrimary?: () => void;
  onRemove?: () => void;
};

function maskCardNumber(cardNumber: string, lastDigits?: string | null): string {
  const digits = (lastDigits || cardNumber).replace(/\D/g, "");
  const lastFour = digits.slice(-4);
  return `•••• •••• •••• ${lastFour || "••••"}`;
}

function CardBrandLogo({ brand, compact }: { brand: string; compact: boolean }) {
  const normalizedBrand = brand.toLowerCase().replace(/[^a-z0-9]/g, "");
  const size = compact ? "h-5 w-10" : "h-6 w-12 sm:h-7 sm:w-14";
  const commonProps = {
    viewBox: "0 0 64 32",
    className: `${size} shrink-0`,
    "aria-hidden": true as const,
    focusable: "false" as const,
  };

  if (normalizedBrand === "visa") {
    return <svg {...commonProps}><text x="32" y="23" fill="white" fontFamily="Arial, sans-serif" fontSize="22" fontStyle="italic" fontWeight="800" textAnchor="middle">VISA</text></svg>;
  }
  if (normalizedBrand === "mastercard" || normalizedBrand === "mc") {
    return <svg {...commonProps}>
      <circle cx="23" cy="16" r="12" fill="#eb001b" />
      <circle cx="41" cy="16" r="12" fill="#f79e1b" />
      <path d="M32 5.2c-4.1 2.4-6.8 6.4-6.8 10.8s2.7 8.4 6.8 10.8c4.1-2.4 6.8-6.4 6.8-10.8S36.1 7.6 32 5.2Z" fill="#ff5f00" />
    </svg>;
  }
  if (normalizedBrand === "amex" || normalizedBrand === "americanexpress") {
    return <svg {...commonProps}>
      <rect x="3" y="4" width="58" height="24" rx="4" fill="#2e77bc" />
      <text x="32" y="20" fill="white" fontFamily="Arial, sans-serif" fontSize="12" fontWeight="800" textAnchor="middle">AMEX</text>
    </svg>;
  }
  if (normalizedBrand === "discover") {
    return <svg {...commonProps}>
      <text x="32" y="20" fill="white" fontFamily="Arial, sans-serif" fontSize="10" fontWeight="800" textAnchor="middle">DISCOVER</text>
      <path d="M8 24c12 5 36 5 48 0" fill="none" stroke="#f59e0b" strokeWidth="3" />
    </svg>;
  }
  if (normalizedBrand === "jcb") {
    return <svg {...commonProps}>
      <rect x="7" y="5" width="16" height="22" rx="2" fill="#159bd7" />
      <rect x="24" y="5" width="16" height="22" rx="2" fill="#e60012" />
      <rect x="41" y="5" width="16" height="22" rx="2" fill="#0b8f4d" />
      <text x="15" y="21" fill="white" fontFamily="Arial, sans-serif" fontSize="12" fontWeight="800" textAnchor="middle">J</text>
      <text x="32" y="21" fill="white" fontFamily="Arial, sans-serif" fontSize="12" fontWeight="800" textAnchor="middle">C</text>
      <text x="49" y="21" fill="white" fontFamily="Arial, sans-serif" fontSize="12" fontWeight="800" textAnchor="middle">B</text>
    </svg>;
  }
  if (normalizedBrand === "diners" || normalizedBrand === "dinersclub") {
    return <svg {...commonProps}>
      <circle cx="32" cy="16" r="12" fill="white" />
      <path d="M32 4a12 12 0 0 0 0 24V4Zm0 0a12 12 0 0 1 0 24V4Z" fill="#1769aa" />
    </svg>;
  }
  if (normalizedBrand === "unionpay") {
    return <svg {...commonProps}>
      <rect x="5" y="6" width="54" height="20" rx="4" fill="#fff" />
      <path d="M9 10h15v12H9z" fill="#e53935" />
      <path d="M24 10h15v12H24z" fill="#1565c0" />
      <path d="M39 10h16v12H39z" fill="#43a047" />
    </svg>;
  }
  return <svg {...commonProps}>
    <rect x="5" y="5" width="54" height="22" rx="4" fill="white" fillOpacity=".14" stroke="white" strokeOpacity=".7" />
    <path d="M5 12h54" stroke="white" strokeOpacity=".7" />
  </svg>;
}

function PrimaryControl({
  method,
  isPrimary = false,
  onSetPrimary,
  actionsDisabled = false,
}: {
  method: string;
  isPrimary: boolean;
  onSetPrimary?: () => void;
  actionsDisabled?: boolean;
}) {
  if (isPrimary) {
    return (
      <span className="inline-flex min-h-9 items-center rounded-lg bg-emerald-50 px-3 text-xs font-semibold text-emerald-700">
        Primary payment method
      </span>
    );
  }

  if (!onSetPrimary) {
    return <span className="inline-flex min-h-9 items-center rounded-lg bg-slate-50 px-3 text-xs font-semibold text-muted">Saved payment method</span>;
  }

  return (
    <button
      type="button"
      disabled={actionsDisabled}
      aria-label={`Set ${method} as primary payment method`}
      onClick={(event) => {
        event.stopPropagation();
        onSetPrimary();
      }}
      className="min-h-9 rounded-lg bg-primary px-4 text-xs font-semibold text-white shadow-sm transition hover:bg-[#e65d00] focus:outline-none focus:ring-2 focus:ring-primary/30"
    >
      Set as primary
    </button>
  );
}

export default function PaymentMethodCard({
  method,
  cardName = "",
  cardNumber = "",
  lastDigits,
  cardExpiry,
  cardBrand,
  paypalEmail = "",
  isPrimary = false,
  flipped = false,
  selected = false,
  disabled = false,
  actionsDisabled = false,
  showControls = true,
  compact = false,
  onFlip = () => {},
  onSelect,
  onSetPrimary,
  onRemove,
}: PaymentMethodCardProps) {
  const isCard = method === "Credit Card" || method === "Debit Card";
  const cardBrandLabel = cardBrand?.trim()
    || (/^4/.test(cardNumber.replace(/\D/g, "")) ? "Visa" : "Card");
  const frontBackground = isCard
    ? "from-[#5b4bd8] via-[#4431a9] to-[#24175f]"
    : "from-[#0879b9] via-[#075b9d] to-[#06366b]";
  const backBackground = isCard
    ? "from-[#24175f] to-[#4431a9]"
    : "from-[#06366b] to-[#075b9d]";

  return (
    <>
      <div
        role="button"
        tabIndex={disabled ? -1 : 0}
        aria-label={onSelect ? `${selected ? "Selected" : "Select"} ${method}` : `${flipped ? "Show front of" : "Flip"} ${method} card`}
        aria-pressed={onSelect ? selected : undefined}
        onClick={() => {
          if (disabled) return;
          (onSelect || onFlip)();
        }}
        onKeyDown={(event) => {
          if (event.target !== event.currentTarget) return;
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            if (!disabled) (onSelect || onFlip)();
          }
        }}
        className={`relative aspect-[1.586/1] w-full ${compact ? "max-w-xs" : "max-w-3xl"} [perspective:1000px] ${disabled ? "cursor-not-allowed opacity-60" : "cursor-pointer"} ${selected ? "rounded-2xl ring-2 ring-primary ring-offset-2" : ""}`}
      >
      <div
        className="relative h-full w-full transition-transform duration-700 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none"
        style={{
          transformStyle: "preserve-3d",
          transform: flipped ? "rotateY(180deg)" : "rotateY(0deg)",
        }}
      >
        <div
          className={`absolute inset-0 overflow-hidden rounded-2xl bg-gradient-to-br ${compact ? "p-4 sm:p-5" : "p-5 sm:p-7"} text-white shadow-lg ${frontBackground}`}
          style={{ backfaceVisibility: "hidden" }}
        >
          <div className={`absolute rounded-full border-white/10 ${compact ? "-right-6 -top-8 h-28 w-28 border-[18px]" : "-right-8 -top-10 h-36 w-36 border-[22px]"}`} />
          <div className="relative flex h-full flex-col justify-between">
            <div className="flex items-start justify-between gap-3 text-left">
              <div className="min-w-0">
                <p className="text-[9px] font-semibold uppercase tracking-[0.16em] text-white/70">
                  {isCard ? "Card Holder" : "PayPal account"}
                </p>
                {(isCard ? cardName : paypalEmail) && <p className={`mt-1 truncate font-semibold ${compact ? "text-[10px] sm:text-xs" : "text-xs sm:text-sm"}`}>
                  {isCard ? cardName : paypalEmail}
                </p>}
              </div>
              {showControls && onRemove && <button
                type="button"
                disabled={actionsDisabled}
                aria-label={`Remove ${method}`}
                onClick={(event) => {
                  event.stopPropagation();
                  onRemove();
                }}
                className="shrink-0 rounded-md bg-white/10 px-2 py-1 text-[10px] text-white/80 transition hover:bg-white/20 hover:text-white"
              >
                Remove
              </button>}
            </div>
            {isCard ? (
              <>
                <div className={`flex min-w-0 items-center justify-between gap-2 ${compact ? "mt-3 sm:mt-4" : "mt-6"}`}>
                  <p className={`min-w-0 whitespace-nowrap font-semibold ${compact ? "text-xs tracking-[0.08em] sm:text-base sm:tracking-[0.14em]" : "text-sm tracking-[0.12em] sm:text-xl sm:tracking-[0.2em]"}`}>
                    {maskCardNumber(cardNumber, lastDigits)}
                  </p>
                  <CardBrandLogo brand={cardBrandLabel} compact={compact} />
                </div>
                <div className="flex flex-wrap items-end justify-between gap-2 text-[9px] text-white/70">
                  <span>{cardBrandLabel.toUpperCase()}{cardExpiry ? ` · ${cardExpiry}` : ""}</span>
                  <button
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      onFlip();
                    }}
                    className="text-[10px] font-bold text-white sm:text-xs"
                  >
                    {flipped ? "Tap to flip back" : "Tap to flip"}
                  </button>
                </div>
              </>
            ) : (
              <>
                <p className="mt-6 text-2xl font-bold italic sm:text-3xl">
                  PayPal
                </p>
                <div className="flex flex-wrap items-end justify-between gap-2 text-[9px] text-white/70">
                  <span>Verified account</span>
                  <button type="button" onClick={(event) => { event.stopPropagation(); onFlip(); }} className="truncate text-[10px] font-bold text-white sm:text-xs">Tap to flip</button>
                </div>
              </>
            )}
          </div>
        </div>

        <div
          className={`absolute inset-0 flex flex-col items-start justify-between overflow-hidden rounded-2xl bg-gradient-to-br ${compact ? "p-4 sm:p-5" : "p-5 sm:p-7"} text-left text-white shadow-lg ${backBackground}`}
          style={{ backfaceVisibility: "hidden", transform: "rotateY(180deg)" }}
        >
          <div>
            <p className="text-[9px] font-semibold uppercase tracking-[0.16em] text-white/70">
              Payment details
            </p>
            <p className="mt-3 text-sm font-semibold">
              {isCard ? "Secure card payment" : "Verified PayPal account"}
            </p>
            <p className="mt-2 max-w-sm text-[11px] leading-5 text-white/75">
              Used by buyers to complete purchases. Payment data is protected by
              the platform.
            </p>
          </div>
          <p className="text-[10px] font-semibold text-white/80">
            Tap to flip back
          </p>
        </div>
      </div>
      </div>
      {showControls && <div className="mt-3 flex items-center justify-between gap-3 rounded-xl border border-[#e5e9f2] bg-white px-3 py-2.5">
        <div className="min-w-0">
          <p className="text-[10px] font-semibold text-[#33405d]">{method}</p>
          <p className="mt-0.5 truncate text-[9px] text-[#8993aa]">
            {selected ? "Selected for this purchase" : isPrimary ? "Used by default for payments" : "Use this method by default"}
          </p>
        </div>
        <PrimaryControl method={method} isPrimary={isPrimary} onSetPrimary={onSetPrimary} actionsDisabled={actionsDisabled} />
      </div>}
    </>
  );
}
