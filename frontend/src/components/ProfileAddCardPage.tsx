"use client";

import Link from "next/link";
import Script from "next/script";
import { useEffect, useMemo, useRef, useState } from "react";
import Navbar from "@/components/Navbar";
import PublicFooter from "@/components/PublicFooter";
import CreditDebitCardCarousel from "@/components/dashboard/CreditDebitCardCarousel";
import PaymentMethodCard from "@/components/dashboard/PaymentMethodCard";
import type { PayPalCardFields, PayPalCardFieldsSdk } from "@/lib/paypal-card-fields";
import {
  deleteSavedPayPalCard,
  getSavedPayPalCards,
  setDefaultPayPalCard,
  type SavedPayPalCard,
} from "@/lib/paypal";

const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:5000/api";
type PaymentProviderStatus = {
  paypal?: {
    configured?: boolean;
    advancedCardPaymentsEnabled?: boolean;
    clientId?: string | null;
    message?: string;
  };
};

declare global {
  interface Window {
    paypal?: PayPalCardFieldsSdk;
  }
}

function providerErrorMessage(error: unknown) {
  if (error && typeof error === "object" && "message" in error && typeof error.message === "string") {
    return error.message;
  }
  return "PayPal could not save this card. Please check the card details and try again.";
}

function getSafeReturnPath(value: string | null) {
  if (!value || typeof window === "undefined") return "/profile/payments";
  try {
    const url = new URL(value, window.location.origin);
    if (url.origin === window.location.origin && url.pathname.startsWith("/creator/")) {
      return `${url.pathname}${url.search}`;
    }
  } catch {
    return "/profile/payments";
  }
  return "/profile/payments";
}

export default function ProfileAddCardPage() {
  const [token, setToken] = useState("");
  const [providerStatus, setProviderStatus] = useState<PaymentProviderStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [sdkLoaded, setSdkLoaded] = useState(false);
  const [fieldsReady, setFieldsReady] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [savedCard, setSavedCard] = useState<SavedPayPalCard | null>(null);
  const [alreadySaved, setAlreadySaved] = useState(false);
  const [replacementCard, setReplacementCard] = useState<SavedPayPalCard | null>(null);
  const [replacementMessage, setReplacementMessage] = useState("");
  const [replacementFailed, setReplacementFailed] = useState(false);
  const [savedCardFlipped, setSavedCardFlipped] = useState(false);
  const [returnPath, setReturnPath] = useState("/profile/payments");
  const fieldsRef = useRef<PayPalCardFields | null>(null);
  const setupStateRef = useRef("");
  const returnPathRef = useRef("/profile/payments");

  useEffect(() => {
    const controller = new AbortController();
    const loadStatus = async () => {
      const currentToken = window.localStorage.getItem("marketplace-token") || "";
      if (!currentToken) {
        setError("Sign in to add a payment method.");
        setLoading(false);
        return;
      }
      setToken(currentToken);
      try {
        const searchParams = new URLSearchParams(window.location.search);
        const resolvedReturnPath = getSafeReturnPath(searchParams.get("returnTo"));
        returnPathRef.current = resolvedReturnPath;
        if (!controller.signal.aborted) setReturnPath(resolvedReturnPath);
        const replacementIdValue = searchParams.get("replaceCardId");
        if (replacementIdValue !== null) {
          const replacementId = Number(replacementIdValue);
          if (!Number.isSafeInteger(replacementId) || replacementId <= 0) {
            throw new Error("The saved card to edit is invalid.");
          }
          const cards = await getSavedPayPalCards(currentToken);
          const card = cards.find((saved) => saved.id === replacementId);
          if (!card) throw new Error("The saved card to edit could not be found.");
          if (!controller.signal.aborted) setReplacementCard(card);
        }

        const response = await fetch(`${apiUrl}/payments/providers/status`, {
          cache: "no-store",
          signal: controller.signal,
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "PayPal availability could not be checked.");
        if (!controller.signal.aborted) setProviderStatus(data);
      } catch (statusError) {
        if (!controller.signal.aborted) {
          setError(statusError instanceof Error ? statusError.message : "PayPal availability could not be checked.");
        }
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    };

    void loadStatus();
    return () => controller.abort();
  }, []);

  const clientId = providerStatus?.paypal?.clientId || "";
  const paypalEnabled = Boolean(providerStatus?.paypal?.configured && providerStatus.paypal.advancedCardPaymentsEnabled && clientId);
  const scriptUrl = useMemo(() => {
    if (!paypalEnabled || !clientId) return "";
    const query = new URLSearchParams({ "client-id": clientId, components: "card-fields" });
    return `https://www.paypal.com/sdk/js?${query.toString()}`;
  }, [clientId, paypalEnabled]);

  useEffect(() => {
    if (!sdkLoaded || !paypalEnabled || !token) return;
    if (!window.paypal) return;
    let active = true;
    const fields = window.paypal.CardFields({
      style: {
        input: {
          "font-size": "14px",
          "font-family": "Inter, Arial, sans-serif",
        },
        ".invalid": { color: "#b42318" },
      },
      createVaultSetupToken: async () => {
        const response = await fetch(`${apiUrl}/payments/paypal/saved-cards/setup-token`, {
          method: "POST",
          headers: { Authorization: `Bearer ${token}` },
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "PayPal card setup could not be started.");
        if (typeof data.setupTokenId !== "string" || typeof data.setupState !== "string") {
          throw new Error("PayPal did not return a valid card setup session.");
        }
        setupStateRef.current = data.setupState;
        return data.setupTokenId;
      },
      onApprove: async ({ vaultSetupToken }) => {
        const setupState = setupStateRef.current;
        setupStateRef.current = "";
        if (!vaultSetupToken || !setupState) {
          setError("The PayPal card setup session expired. Start again.");
          setSaving(false);
          return;
        }
        try {
          const response = await fetch(`${apiUrl}/payments/paypal/saved-cards/confirm`, {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
            body: JSON.stringify({ vaultSetupToken, setupState }),
          });
          const data = await response.json();
          if (!response.ok) throw new Error(data.error || "PayPal could not save this card.");
          if (!active) return;
          const newCardId = Number(data.card?.id);
          if (!Number.isSafeInteger(newCardId) || newCardId <= 0) {
            throw new Error("PayPal did not return a valid saved-card reference.");
          }

          let newCardIsDefault = Boolean(data.card.isDefault);
          let replacementStatus = "";
          let didReplacementFail = false;
          if (replacementCard) {
            if (replacementCard.id === newCardId) {
              replacementStatus = "This card is already saved. No replacement was necessary.";
            } else {
              try {
                if (replacementCard.isDefault) {
                  await setDefaultPayPalCard(newCardId, token);
                  newCardIsDefault = true;
                }
                await deleteSavedPayPalCard(replacementCard.id, token);
                replacementStatus = "Your saved card was replaced.";
              } catch (replaceError) {
                didReplacementFail = true;
                const message = replaceError instanceof Error
                  ? replaceError.message
                  : "The old card could not be removed.";
                replacementStatus = `The new card was saved, but the old card could not be removed: ${message}`;
              }
            }
          }

          setSavedCard({ ...data.card, id: newCardId, isDefault: newCardIsDefault });
          setSavedCardFlipped(false);
          setAlreadySaved(Boolean(data.alreadyExists));
          setReplacementMessage(replacementStatus);
          setReplacementFailed(didReplacementFail);
          setError("");
          if (returnPathRef.current.startsWith("/creator/")) {
            window.setTimeout(() => window.location.assign(returnPathRef.current), 900);
          }
        } catch (saveError) {
          if (active) setError(saveError instanceof Error ? saveError.message : "PayPal could not save this card.");
        } finally {
          if (active) setSaving(false);
        }
      },
      onError: (cardError) => {
        if (active) {
          setSaving(false);
          setError(providerErrorMessage(cardError));
        }
      },
    });

    if (!fields.isEligible()) {
      setError("PayPal card vaulting is unavailable for this account or region. Check Advanced Card Payments eligibility.");
      return () => {
        active = false;
      };
    }

    fieldsRef.current = fields;
    void Promise.all([
      fields.NameField({ placeholder: "Cardholder name" }).render("#profile-paypal-card-name"),
      fields.NumberField({ placeholder: "Card number" }).render("#profile-paypal-card-number"),
      fields.ExpiryField({ placeholder: "MM/YYYY" }).render("#profile-paypal-card-expiry"),
      fields.CVVField({ placeholder: "CVV" }).render("#profile-paypal-card-cvv"),
    ]).then(() => {
      if (active) setFieldsReady(true);
    }).catch(() => {
      if (active) setError("PayPal card fields could not be loaded. Please refresh and try again.");
    });

    return () => {
      active = false;
      fieldsRef.current = null;
    };
  }, [sdkLoaded, paypalEnabled, token, replacementCard]);

  const submitCard = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!fieldsRef.current || !fieldsReady || saving) return;
    setSaving(true);
    setError("");
    try {
      await fieldsRef.current.submit();
    } catch (submitError) {
      setSaving(false);
      setError(providerErrorMessage(submitError));
    }
  };

  const providerMessage = providerStatus?.paypal?.message || "PayPal card vaulting is not configured.";

  return (
    <main className="flex min-h-screen flex-col bg-[#f7f9fd] text-[#142b4d]">
      {scriptUrl && <Script
        src={scriptUrl}
        strategy="afterInteractive"
        onReady={() => {
          if (window.paypal) setSdkLoaded(true);
          else setError("PayPal card fields did not initialize. Please refresh and try again.");
        }}
        onError={() => setError("PayPal card fields could not be loaded. Please try again later.")}
      />}
      <Navbar active={null} />
      <div className="mx-auto w-full max-w-[1180px] flex-1 px-4 pb-12 pt-8 sm:px-6 lg:px-8">
        <div className="mb-6">
          <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-primary">Account</p>
          <h1 className="mt-1 text-3xl font-extrabold tracking-tight text-heading">{replacementCard ? "Edit payment method" : "Add payment method"}</h1>
          <p className="mt-2 text-sm text-muted">{replacementCard ? "Enter the replacement card details. Your current card stays saved until the new card is confirmed." : "Save a card securely for future purchases without placing an order."}</p>
        </div>

        <section className="max-w-3xl border border-border bg-white p-6 sm:p-8">
          {loading ? (
            <p className="text-sm text-muted">Checking PayPal availability...</p>
          ) : !token ? (
            <div>
              <p className="text-sm text-muted">{error}</p>
              <Link href="/login" className="mt-5 inline-flex rounded-md bg-primary px-4 py-2 text-xs font-bold text-white no-underline hover:bg-primary-hover">Sign in</Link>
            </div>
          ) : !paypalEnabled ? (
            <div>
              <p role="status" className="text-sm text-muted">{error || providerMessage}</p>
              <p className="mt-2 text-xs text-muted">Adding cards without a purchase requires PayPal Advanced Card Payments and vaulting to be enabled for your merchant account.</p>
            </div>
          ) : savedCard ? (
            <div>
              {replacementMessage && <p role={replacementFailed ? "alert" : "status"} className={`mb-3 text-sm font-semibold ${replacementFailed ? "text-status-danger" : "text-status-success"}`}>{replacementMessage}</p>}
              <p role="status" className="text-sm font-semibold text-status-success">
                {savedCard.brand || "Card"} ending in {savedCard.lastDigits || "••••"} {alreadySaved ? "is already saved" : "was saved"}{savedCard.isDefault ? " as your primary payment method" : ""}.
              </p>
              <CreditDebitCardCarousel
                items={[savedCard]}
                activeIndex={0}
                getKey={(card) => card.id}
                desktopCardClassName="max-w-md"
                showDesktopNavigation={false}
                renderCard={(card) => (
                  <div className="mt-5 max-w-md">
                    <PaymentMethodCard
                      method="Credit Card"
                      cardName="Saved card"
                      cardNumber=""
                      lastDigits={card.lastDigits}
                      cardExpiry={card.expiryMonth && card.expiryYear ? `${String(card.expiryMonth).padStart(2, "0")}/${card.expiryYear}` : undefined}
                      cardBrand={card.brand || "Card"}
                      isPrimary={card.isDefault}
                      flipped={savedCardFlipped}
                      showControls={false}
                      onFlip={() => setSavedCardFlipped((current) => !current)}
                    />
                  </div>
                )}
              />
              <div className="mt-5 flex flex-wrap gap-2">
                <Link href={returnPath} className="rounded-md bg-primary px-4 py-2 text-xs font-semibold text-white no-underline hover:bg-primary-hover">{returnPath.startsWith("/creator/") ? "Return to creator payments" : "View payment methods"}</Link>
                <Link href="/profile" className="rounded-md border border-border-control px-4 py-2 text-xs font-semibold text-body no-underline hover:bg-slate-50">Back to profile</Link>
              </div>
            </div>
          ) : (
            <form onSubmit={submitCard}>
              <div className="mb-5">
                <h2 className="text-sm font-bold text-heading">{replacementCard ? "Replacement card details" : "Card details"}</h2>
                <p className="mt-1 text-[10px] leading-5 text-muted">Card entry is hosted by PayPal. KhmerDigital receives only a vaulted token and masked card details.</p>
              </div>
              <div className="grid gap-4">
                <label className="grid gap-1.5 text-xs font-semibold text-heading">Cardholder name
                    <div id="profile-paypal-card-name" className="h-20 rounded-md border border-border-control bg-white px-3 transition focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/30" />
                  </label>
                <label className="grid gap-1.5 text-xs font-semibold text-heading">Card number
                    <div id="profile-paypal-card-number" className="h-20 rounded-md border border-border-control bg-white px-3 transition focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/30" />
                  </label>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <label className="grid gap-1.5 text-xs font-semibold text-heading">Expiration date
                      <div id="profile-paypal-card-expiry" className="h-20 rounded-md border border-border-control bg-white px-3 transition focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/30" />
                    </label>
                    <label className="grid gap-1.5 text-xs font-semibold text-heading">Security code
                      <div id="profile-paypal-card-cvv" className="h-20 rounded-md border border-border-control bg-white px-3 transition focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/30" />
                    </label>
                  </div>
              </div>
              {error && <p role="alert" className="mt-4 text-xs text-status-danger">{error}</p>}
              <div className="mt-6 flex flex-wrap justify-end gap-2 border-t border-divider pt-5">
                <Link href={returnPath} className="rounded-md border border-border-control px-4 py-2 text-xs font-semibold text-body no-underline hover:bg-slate-50">Cancel</Link>
                <button type="submit" disabled={!fieldsReady || saving} className="rounded-md bg-primary px-4 py-2 text-xs font-semibold text-white hover:bg-primary-hover disabled:opacity-50">
                  {saving ? "Saving with PayPal…" : fieldsReady ? "Save card" : "Loading secure fields…"}
                </button>
              </div>
            </form>
          )}
        </section>
      </div>
      <PublicFooter />
    </main>
  );
}
