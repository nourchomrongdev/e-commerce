"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import CreditDebitCardCarousel from "@/components/dashboard/CreditDebitCardCarousel";
import PaymentMethodCard from "@/components/dashboard/PaymentMethodCard";
import { Toast } from "@/components/ui";
import {
  deleteSavedPayPalCard,
  getSavedPayPalCards,
  setDefaultPayPalCard,
  type SavedPayPalCard,
} from "@/lib/paypal";

const apiUrl = (typeof process !== "undefined" && process.env?.NEXT_PUBLIC_API_URL) ?? "http://localhost:5000/api";

const getStoredToastState = (key: string, fallback: boolean) => {
  if (typeof window === "undefined") return fallback;
  const storedValue = window.sessionStorage.getItem(key);
  return storedValue === null ? fallback : storedValue === "true";
};

const clearStoredToastState = () => {
  if (typeof window === "undefined") return;
  window.sessionStorage.removeItem("storefront-branding-toast");
  window.sessionStorage.removeItem("storefront-settings-toast");
  window.sessionStorage.removeItem("storefront-payment-toast");
};

const inputClassName =
  "w-full rounded-lg border border-[#e2e7f1] bg-white px-3 py-2.5 text-xs text-[#111b40] outline-none transition focus:border-primary focus:ring-2 focus:ring-[#ff6b001c]";

function PaymentField({
  id,
  label,
  value,
  onChange,
  type = "text",
  placeholder,
  error,
  disabled = false,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
  placeholder?: string;
  error?: string;
  disabled?: boolean;
}) {
  return (
    <div>
      <label
        htmlFor={id}
        className="mb-2 block text-[11px] font-semibold text-[#33405d]"
      >
        {label}
      </label>
      <input
        id={id}
        type={type}
        value={value}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
        disabled={disabled}
        className={`${inputClassName} ${disabled ? "cursor-not-allowed bg-[#f3f6fb] text-[#ccc]" : ""} ${error ? "border-red-300 focus:border-red-400 focus:ring-red-100" : ""}`}
      />
      {error && (
        <p className="mt-1 text-[10px] font-medium text-red-600">{error}</p>
      )}
    </div>
  );
}

export default function StorefrontPaymentPage({
  params,
}: {
  params: Promise<{ storefront: string }>;
}) {
  const [storefrontName, setStorefrontName] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void params.then(({ storefront }) => {
      if (active) setStorefrontName(storefront ?? null);
    });
    return () => {
      active = false;
    };
  }, [params]);

  const storefront = {
    displayName: decodeURIComponent(storefrontName ?? (storefrontName ?? "TestStore")),
    type: "Digital Products",
  };
  const [savedMethods, setSavedMethods] = useState<string[]>(["Credit/Debit Card"]);
  const [primaryMethod, setPrimaryMethod] = useState("Credit/Debit Card");
  const [provider, setProvider] = useState("PayPal");
  const [savedCards, setSavedCards] = useState<SavedPayPalCard[]>([]);
  const [activeCardIndex, setActiveCardIndex] = useState(0);
  const [flippedCards, setFlippedCards] = useState<Record<number, boolean>>({});
  const [cardActionId, setCardActionId] = useState<number | null>(null);
  const [cardError, setCardError] = useState("");
  const [cardNotice, setCardNotice] = useState("");
  const [taxId, setTaxId] = useState("");
  const [saved, setSaved] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [showIncompleteBrandingToast, setShowIncompleteBrandingToast] = useState(() => getStoredToastState("storefront-branding-toast", true));
  const [showIncompleteSettingsToast, setShowIncompleteSettingsToast] = useState(() => getStoredToastState("storefront-settings-toast", true));
  const [paymentFormError, setPaymentFormError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [brandingIncomplete, setBrandingIncomplete] = useState(false);
  const [settingsIncomplete, setSettingsIncomplete] = useState(false);

  const creatorPaymentReturnPath = `/creator/storefront/${encodeURIComponent(storefront.displayName)}/payment`;
  const addCardHref = `/profile/payments/add?returnTo=${encodeURIComponent(creatorPaymentReturnPath)}`;

  const makeCardPrimary = async (cardId: number) => {
    const token = window.localStorage.getItem("marketplace-token") || "";
    setCardActionId(cardId);
    setCardError("");
    setCardNotice("");
    try {
      await setDefaultPayPalCard(cardId, token);
      setSavedCards((cards) => cards.map((card) => ({ ...card, isDefault: card.id === cardId })));
      setCardNotice("Your primary purchase card has been updated.");
    } catch (error) {
      setCardError(error instanceof Error ? error.message : "Unable to update the primary card.");
    } finally {
      setCardActionId(null);
    }
  };

  const removeCard = async (cardId: number) => {
    if (!window.confirm("Remove this saved purchase card?")) return;
    const token = window.localStorage.getItem("marketplace-token") || "";
    setCardActionId(cardId);
    setCardError("");
    setCardNotice("");
    try {
      const result = await deleteSavedPayPalCard(cardId, token);
      const remainingCards = savedCards
        .filter((card) => card.id !== cardId)
        .map((card) => ({ ...card, isDefault: card.id === result.defaultCardId }));
      setSavedCards(remainingCards);
      setActiveCardIndex((index) => Math.max(0, Math.min(index, remainingCards.length - 1)));
      setCardNotice("The saved purchase card has been removed.");
    } catch (error) {
      setCardError(error instanceof Error ? error.message : "Unable to remove the saved card.");
    } finally {
      setCardActionId(null);
    }
  };

  useEffect(() => {
    const handleBeforeUnload = () => clearStoredToastState();
    window.addEventListener("beforeunload", handleBeforeUnload);

    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload);
    };
  }, []);

  const persistPaymentSettings = async ({
    nextMethods = savedMethods,
    nextPrimaryMethod = primaryMethod,
  }: {
    nextMethods?: string[];
    nextPrimaryMethod?: string;
  } = {}) => {
    setIsSaving(true);
    const token = window.localStorage.getItem("marketplace-token");
    setPaymentFormError(null);

    try {
      const normalizedMethods = nextMethods.length ? nextMethods : ["Credit/Debit Card"];
      const normalizedPrimaryMethod = nextPrimaryMethod || normalizedMethods[0] || "";

      const response = await fetch(
        `${apiUrl}/creator/storefronts/${encodeURIComponent(storefront.displayName)}/payment`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify({
            methods: normalizedMethods,
            primaryMethod: normalizedPrimaryMethod,
            provider,
            taxId,
          }),
        },
      );

      const responseBody = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(responseBody.error || "Unable to save payment settings");
      }

      setSavedMethods(normalizedMethods);
      setPrimaryMethod(normalizedPrimaryMethod);
      setSaved(true);
      window.setTimeout(() => setSaved(false), 2200);
      return true;
    } catch (error) {
      setPaymentFormError(error instanceof Error ? error.message : "Unable to save payment settings.");
      return false;
    } finally {
      setIsSaving(false);
    }
  };

  const savePayment = () => void persistPaymentSettings();

  useEffect(() => {
    if (!storefrontName) return;
    const token = window.localStorage.getItem("marketplace-token");
    const decodedName = decodeURIComponent(storefrontName);
    if (token) {
      void getSavedPayPalCards(token)
        .then((cards) => setSavedCards(cards))
        .catch((error) => setCardError(error instanceof Error ? error.message : "Saved cards could not be loaded."));
    }

    Promise.all([
      fetch(`${apiUrl}/creator/storefronts/${encodeURIComponent(decodedName)}/payment`, { headers: { Authorization: `Bearer ${token}` } })
        .then(async (response) => {
          const data = await response.json();
          if (!response.ok) return {};
          return data.payment || {};
        }),
      fetch(`${apiUrl}/creator/storefronts/${encodeURIComponent(decodedName)}/branding`, { headers: { Authorization: `Bearer ${token}` } })
        .then(async (response) => {
          const data = await response.json();
          if (!response.ok) return {};
          return data.branding || {};
        }),
      fetch(`${apiUrl}/creator/storefronts/${encodeURIComponent(decodedName)}/settings`, { headers: { Authorization: `Bearer ${token}` } })
        .then(async (response) => {
          const data = await response.json();
          if (!response.ok) return {};
          return data.settings || {};
        }),
    ])
      .then(([payment, branding, settings]) => {
        if (payment) {
          setSavedMethods(Array.isArray(payment.methods) ? payment.methods : []);
          setPrimaryMethod(payment.primaryMethod || "Credit/Debit Card");
          setProvider(payment.provider || "PayPal");
          setTaxId(payment.taxId || "");
        }

        setBrandingIncomplete(!String(branding.storeName ?? "").trim() || !String(branding.description ?? "").trim());
        setSettingsIncomplete(
          !String(settings.email ?? "").trim() ||
            !String(settings.phone ?? "").trim() ||
            !String(settings.country ?? "").trim() ||
            !String(settings.timezone ?? "").trim() ||
            !String(settings.language ?? "").trim(),
        );
      })
      .catch(() => undefined)
      .finally(() => setIsLoading(false));
  }, [storefrontName]);

  if (isLoading) {
    return (
      <div className="w-full min-w-0 max-w-full overflow-x-hidden">
        <section className="min-w-0 rounded-2xl bg-white p-3 shadow-[0_8px_24px_rgba(15,23,42,0.04)] sm:p-6">
          <div className="h-5 w-40 animate-pulse rounded bg-[#edf0f5]" />
          <div className="mt-3 h-3 w-72 animate-pulse rounded bg-[#f1f3f7]" />
          <div className="mt-6 h-40 animate-pulse rounded-xl border border-[#e9edf6] bg-[#f9fafc]" />
          <div className="mt-6 h-40 animate-pulse rounded-xl border border-[#e9edf6] bg-[#f9fafc]" />
        </section>
      </div>
    );
  }

  return (
    <div className="w-full min-w-0 max-w-full overflow-x-hidden">
      <div className="fixed right-5 top-24 z-[60] flex w-[min(24rem,calc(100vw-2rem))] flex-col gap-3">
        {showIncompleteBrandingToast && brandingIncomplete && (
          <Toast
            variant="warning"
            title="Incomplete branding data"
            message="Add a store name and short description to finish your storefront."
            onClose={() => {
              setShowIncompleteBrandingToast(false);
              window.sessionStorage.setItem("storefront-branding-toast", "false");
            }}
          />
        )}
        {showIncompleteSettingsToast && settingsIncomplete && (
          <Toast
            variant="warning"
            title="Incomplete settings data"
            message="Add your store email, phone, country, timezone, and language before saving settings."
            onClose={() => {
              setShowIncompleteSettingsToast(false);
              window.sessionStorage.setItem("storefront-settings-toast", "false");
            }}
          />
        )}
      </div>
      <section className="min-w-0 rounded-2xl bg-white p-3 shadow-[0_8px_24px_rgba(15,23,42,0.04)] sm:p-6">
        <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h2 className="text-lg font-bold text-[#111b40]">Payment</h2>
            <p className="mt-1 text-xs text-[#8993aa]">
              Manage the payment methods used by buyers on your storefront.
            </p>
          </div>
          {saved && (
            <span className="text-xs font-medium text-emerald-600">
              Payment settings saved
            </span>
          )}
        </div>

        <div className="mt-6 space-y-5">
          <div className="rounded-xl border border-[#e9edf6] bg-[#f9fafc] p-3 sm:p-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <h3 className="text-xs font-bold text-[#111b40]">Your saved purchase cards</h3>
                <p className="mt-1 text-[11px] leading-5 text-[#8993aa]">
                  These PayPal-validated cards are saved to your buyer account for purchases. They are not creator payout destinations.
                </p>
              </div>
              <Link href={addCardHref} className="inline-flex w-fit items-center rounded-lg bg-primary px-3 py-2 text-[10px] font-semibold text-white no-underline transition hover:opacity-90">
                Add card with PayPal
              </Link>
            </div>
            {savedCards.length ? (
              <div className="mt-4">
                <CreditDebitCardCarousel
                  items={savedCards}
                  activeIndex={activeCardIndex}
                  getKey={(card) => card.id}
                  onActiveIndexChange={setActiveCardIndex}
                  desktopCardClassName="max-w-md"
                  renderCard={(card, _index, isActive) => (
                    <div className="mx-auto max-w-md">
                      <PaymentMethodCard
                        method="Credit Card"
                        cardName="Saved purchase card"
                        cardNumber=""
                        lastDigits={card.lastDigits}
                        cardExpiry={card.expiryMonth && card.expiryYear ? `${String(card.expiryMonth).padStart(2, "0")}/${card.expiryYear}` : undefined}
                        cardBrand={card.brand || "Card"}
                        isPrimary={card.isDefault}
                        flipped={isActive && Boolean(flippedCards[card.id])}
                        actionsDisabled={cardActionId !== null}
                        showControls={isActive}
                        onFlip={isActive ? () => setFlippedCards((current) => ({ ...current, [card.id]: !current[card.id] })) : undefined}
                        onSetPrimary={isActive ? () => void makeCardPrimary(card.id) : undefined}
                        onRemove={isActive ? () => void removeCard(card.id) : undefined}
                      />
                      {isActive && (
                        <div className="mt-3 flex justify-end">
                          <Link
                            href={`/profile/payments/add?replaceCardId=${encodeURIComponent(card.id)}&returnTo=${encodeURIComponent(creatorPaymentReturnPath)}`}
                            className="rounded-md border border-primary px-3 py-1.5 text-[10px] font-bold text-primary no-underline hover:bg-orange-50"
                          >
                            Edit card
                          </Link>
                        </div>
                      )}
                    </div>
                  )}
                />
                {savedCards.length > 1 && (
                  <div className="mt-3 flex items-center justify-center gap-5 md:hidden">
                    <button type="button" aria-label="Previous saved purchase card" onClick={() => setActiveCardIndex((index) => (index - 1 + savedCards.length) % savedCards.length)} className="grid h-9 w-9 place-items-center rounded-full border border-[#e0e5ef] bg-white text-lg text-[#33405d] hover:border-primary hover:text-primary">‹</button>
                    <span className="text-[10px] font-semibold text-[#8993aa]">{activeCardIndex + 1} of {savedCards.length}</span>
                    <button type="button" aria-label="Next saved purchase card" onClick={() => setActiveCardIndex((index) => (index + 1) % savedCards.length)} className="grid h-9 w-9 place-items-center rounded-full border border-[#e0e5ef] bg-white text-lg text-[#33405d] hover:border-primary hover:text-primary">›</button>
                  </div>
                )}
              </div>
            ) : (
              <p className="mt-4 rounded-lg border border-dashed border-[#dce2ee] bg-white px-4 py-6 text-center text-[11px] text-[#8993aa]">
                No saved purchase cards. Add one securely through PayPal to use it at checkout.
              </p>
            )}
            {cardError && <p role="alert" className="mt-3 text-xs text-red-700">{cardError}</p>}
            {cardNotice && <p role="status" className="mt-3 text-xs text-emerald-700">{cardNotice}</p>}
          </div>

          <div className="rounded-xl border border-[#e9edf6] bg-[#f9fafc] p-3 sm:p-4">
            <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <h3 className="text-xs font-bold text-[#111b40]">
                  Buyer card payments
                </h3>
                <p className="mt-1 max-w-2xl text-[11px] leading-5 text-[#8993aa]">
                  Buyers enter and validate their credit or debit card through PayPal at checkout. You do not need to add or store card details in your storefront settings.
                </p>
              </div>
            </div>
            <div className="mt-4 flex items-center justify-between gap-3 rounded-lg border border-[#e9edf6] bg-white px-3 py-3">
              <div>
                <p className="text-[10px] font-semibold text-[#33405d]">Credit and debit cards</p>
                <p className="mt-1 text-[10px] text-[#8993aa]">Processed by PayPal checkout</p>
              </div>
              <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-[9px] font-semibold text-emerald-700">Enabled</span>
            </div>
          </div>

          <div className="rounded-xl border border-[#e9edf6] bg-[#f9fafc] p-3 sm:p-4">
            <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <h3 className="text-xs font-bold text-[#111b40]">
                  Payment processing
                </h3>
                <p className="mt-1 text-[11px] text-[#8993aa]">
                  PayPal validates and processes buyer payments. Creator earnings, commission, and payout status are tracked separately on the Payouts page.
                </p>
              </div>
            </div>
          </div>

          <div className="rounded-xl border border-[#e9edf6] bg-[#f9fafc] p-3 sm:p-4">
            <h3 className="text-xs font-bold text-[#111b40]">
              Tax Information
            </h3>
            <div className="mt-4 grid min-w-0 gap-4 md:grid-cols-2">
              <PaymentField
                id="tax-id"
                label="Tax ID (Optional)"
                value={taxId}
                onChange={setTaxId}
                placeholder="Enter your tax identification number"
              />
              <div className="flex items-end">
                <div className="flex w-full items-center gap-2 rounded-lg bg-emerald-50 px-3 py-2.5 text-[11px] font-medium text-emerald-700">
                  <span className="h-2 w-2 rounded-full bg-emerald-500" />
                  Tax profile ready for review
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="mt-6 flex flex-col-reverse gap-3 border-t border-[#edf0f5] pt-5 sm:flex-row sm:items-center sm:justify-end">
          {paymentFormError && <p role="alert" className="text-xs text-red-700 sm:mr-auto">{paymentFormError}</p>}
          {saved && (
            <span className="text-xs font-medium text-emerald-600 sm:mr-auto">
              Your payment details are up to date.
            </span>
          )}
          <button
            type="button"
            onClick={savePayment}
            disabled={isSaving}
            className="rounded-lg bg-primary px-5 py-2.5 text-xs font-semibold text-white shadow-[0_8px_16px_rgba(255,103,0,0.18)] transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isSaving ? "Saving..." : "Save Changes"}
          </button>
        </div>
      </section>

    </div>
  );
}
