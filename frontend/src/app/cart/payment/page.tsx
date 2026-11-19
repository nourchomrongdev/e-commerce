"use client";

import Link from "next/link";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import Navbar from "@/components/Navbar";
import PublicFooter from "@/components/PublicFooter";
import CreditDebitCardCarousel from "@/components/dashboard/CreditDebitCardCarousel";
import PaymentMethodCard from "@/components/dashboard/PaymentMethodCard";
import { clearCart, readCart, type CartItem } from "@/lib/cart";
import {
  capturePayPalOrder,
  createPayPalOrder,
  deleteSavedPayPalCard,
  getSavedPayPalCards,
  setDefaultPayPalCard,
  type SavedPayPalCard,
} from "@/lib/paypal";
import { createPayWayOrder, getPayWayPaymentStatus, type PayWayPaymentOption } from "@/lib/payway";
import { formatMarketplacePrice, getProductsByIds, type MarketplaceProduct } from "@/lib/marketplace";
import type { PayPalCardFields, PayPalCardFieldsSdk } from "@/lib/paypal-card-fields";

const apiUrl = (typeof process !== "undefined" && process.env?.NEXT_PUBLIC_API_URL) ?? "http://localhost:5000/api";
type PaymentProvider = "paypal" | "abayapayway";

type CartDisplayItem = CartItem & { product: MarketplaceProduct | null };
type ProviderStatus = {
  configured: boolean;
  environment: string;
  message: string;
  clientId?: string | null;
  advancedCardPaymentsEnabled?: boolean;
};
type PayWayCheckout = {
  tran_id: string;
  paymentReference: string;
  paymentOption: PayWayPaymentOption;
  lifetimeMinutes: number;
  expiresAt: string;
  qrString: string | null;
  qrImage: string | null;
  deeplink: string | null;
  checkoutQrUrl: string | null;
  amount: number;
  currency: string;
};
function getPayPalCardErrorMessage(error: unknown) {
  let serializedError = "";
  try {
    serializedError = JSON.stringify(error);
  } catch {
    serializedError = "";
  }

  if (serializedError.includes("CREDIT_CARD_NUMBER_MUST_BE_TEST_NUMBER")) {
    return "PayPal Sandbox only accepts test card numbers generated for your Sandbox account. Use a Sandbox test card from the PayPal Developer Dashboard; real card numbers are rejected.";
  }

  return error instanceof Error
    ? error.message
    : "PayPal could not validate this card. Check the card details and try again.";
}

function isSavedCardExpired(card: SavedPayPalCard) {
  if (!card.expiryMonth || !card.expiryYear) return false;
  return new Date(Number(card.expiryYear), Number(card.expiryMonth), 0, 23, 59, 59, 999).getTime() <= Date.now();
}

function submitPayWayForm(
  formUrl: string,
  fields: Record<string, string>,
  expectedPaymentOption: PayWayPaymentOption,
  responsePaymentOption?: PayWayPaymentOption,
) {
  if (
    responsePaymentOption !== expectedPaymentOption ||
    fields.payment_option !== expectedPaymentOption
  ) {
    throw new Error(
      "ABA PayWay returned a checkout for a different payment method. Restart the backend and try again.",
    );
  }

  const checkoutUrl = new URL(formUrl);
  if (checkoutUrl.protocol !== "https:") throw new Error("ABA PayWay returned an insecure checkout URL.");

  document.getElementById("aba_merchant_request")?.remove();
  const form = document.createElement("form");
  form.id = "aba_merchant_request";
  form.method = "POST";
  form.target = "_self";
  form.action = checkoutUrl.toString();
  form.hidden = true;
  Object.entries(fields).forEach(([name, value]) => {
    const input = document.createElement("input");
    input.type = "hidden";
    input.name = name;
    input.value = value;
    form.appendChild(input);
  });
  document.body.appendChild(form);
  form.submit();
}

declare global {
  interface Window {
    paypal?: PayPalCardFieldsSdk;
  }
}

export default function CartPaymentPage() {
  const router = useRouter();
  const [items, setItems] = useState<CartDisplayItem[]>([]);
  const [provider, setProvider] = useState<PaymentProvider>("paypal");
  const payWayPaymentOption: PayWayPaymentOption = "abapay_khqr_deeplink";
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState("");
  const [productError, setProductError] = useState("");
  const [providerStatus, setProviderStatus] = useState<Record<PaymentProvider, ProviderStatus | null>>({
    paypal: null,
    abayapayway: null,
  });
  const [statusError, setStatusError] = useState("");
  const [isRefreshingStatus, setIsRefreshingStatus] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isVerifyingPayment, setIsVerifyingPayment] = useState(false);
  const [paid, setPaid] = useState(false);
  const [alreadyPurchased, setAlreadyPurchased] = useState(false);
  const [completedOrderNumber, setCompletedOrderNumber] = useState("");
  const [existingOrderReference, setExistingOrderReference] = useState<number | null>(null);
  const [payWayCheckout, setPayWayCheckout] = useState<PayWayCheckout | null>(null);
  const [isPayWayQrOpen, setIsPayWayQrOpen] = useState(false);
  const [payWayPaymentStatus, setPayWayPaymentStatus] = useState("pending");
  const [payWayStatusError, setPayWayStatusError] = useState("");
  const [abaAppLaunchError, setAbaAppLaunchError] = useState("");
  const [payWayClock, setPayWayClock] = useState(0);
  const [saveCard, setSaveCard] = useState(false);
  const [savedCards, setSavedCards] = useState<SavedPayPalCard[]>([]);
  const [selectedSavedCardId, setSelectedSavedCardId] = useState<number | null>(null);
  const [activeSavedCardIndex, setActiveSavedCardIndex] = useState(0);
  const [flippedSavedCards, setFlippedSavedCards] = useState<Record<number, boolean>>({});
  const [replacingCardId, setReplacingCardId] = useState<number | null>(null);
  const [cardActionId, setCardActionId] = useState<number | null>(null);
  const [cardFieldsReady, setCardFieldsReady] = useState(false);
  const [cardFieldsError, setCardFieldsError] = useState("");
  const [savedCardsError, setSavedCardsError] = useState("");
  const [cardSaveMessage, setCardSaveMessage] = useState("");
  const localOrderIdRef = useRef<number | null>(null);
  const saveCardRef = useRef(false);
  const replacingCardIdRef = useRef<number | null>(null);
  const cardFieldsRef = useRef<PayPalCardFields | null>(null);
  const cardNameRef = useRef<HTMLDivElement>(null);
  const cardNumberRef = useRef<HTMLDivElement>(null);
  const cardExpiryRef = useRef<HTMLDivElement>(null);
  const cardCvvRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (paid && completedOrderNumber) {
      router.replace(`/buyer/purchases/${encodeURIComponent(completedOrderNumber)}`);
    }
  }, [completedOrderNumber, paid, router]);

  async function refreshProviderStatus(isActive: () => boolean = () => true) {
    if (isActive()) {
      setIsRefreshingStatus(true);
      setStatusError("");
    }
    try {
      const response = await fetch(`${apiUrl}/payments/providers/status`, { cache: "no-store" });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data?.error || "Could not refresh payment provider settings.");
      if (isActive()) {
        if (data.paypal?.advancedCardPaymentsEnabled !== true) {
          setSavedCards([]);
          setSelectedSavedCardId(null);
          setSaveCard(false);
        }
        setProviderStatus({
          paypal: data.paypal || null,
          abayapayway: data.abayapayway || null,
        });
      }
    } catch (statusFailure) {
      if (isActive()) {
        setStatusError(statusFailure instanceof Error ? statusFailure.message : "Could not refresh payment provider settings.");
      }
    } finally {
      if (isActive()) setIsRefreshingStatus(false);
    }
  }

  useEffect(() => {
    let active = true;
    void Promise.resolve().then(() => {
      if (active) void refreshProviderStatus(() => active);
    });

    async function loadProducts() {
      const cart = readCart();
      if (!cart.length) {
        await Promise.resolve();
        if (active) setIsLoading(false);
        return;
      }

      try {
        const response = await getProductsByIds(cart.map((item) => Number(item.id)));
        if (!active) return;
        const products = new Map((response?.products || []).map((product) => [product.id, product]));
        setItems(cart.map((item) => ({ ...item, product: products.get(Number(item.id)) || null })));
      } catch (loadError: unknown) {
        if (active) setProductError(loadError instanceof Error ? loadError.message : "Could not load current product details.");
      } finally {
        if (active) setIsLoading(false);
      }
    }

    void loadProducts();

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const paymentReference = params.get("payway_reference");
    if (!paymentReference) return;

    let active = true;
    const now = Date.now();
    const option = params.get("payway_option");
    const paymentOption: PayWayPaymentOption =
      option === "cards" || option === "abapay_khqr" || option === "abapay_khqr_deeplink"
        ? option
        : "abapay_khqr_deeplink";
    localOrderIdRef.current = null;
    const wasCancelled = params.get("payway_cancelled") === "1";
    void Promise.resolve().then(() => {
      if (!active) return;
      setPayWayCheckout({
        tran_id: paymentReference,
        paymentReference,
        paymentOption,
        lifetimeMinutes: 5,
        expiresAt: new Date(now + 5 * 60_000).toISOString(),
        qrString: null,
        qrImage: null,
        deeplink: null,
        checkoutQrUrl: null,
        amount: 0,
        currency: "USD",
      });
      setPayWayPaymentStatus("pending");
      setPayWayClock(now);
      if (wasCancelled) setPayWayStatusError("Card checkout was canceled. No payment is confirmed.");
    });
    params.delete("payway_reference");
    params.delete("payway_option");
    params.delete("payway_cancelled");
    const query = params.toString();
    window.history.replaceState({}, "", `${window.location.pathname}${query ? `?${query}` : ""}`);
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!payWayCheckout?.tran_id || paid) return;

    const paymentReference = payWayCheckout.tran_id;
    let active = true;
    let checking = false;
    let terminal = false;
    const token = window.localStorage.getItem("marketplace-token") || "";
    if (!token) {
      void Promise.resolve().then(() => {
        if (active) setPayWayStatusError("Sign in again to check your PayWay payment.");
      });
      return () => {
        active = false;
      };
    }

    async function checkPaymentStatus() {
      if (!active || checking || terminal) return;
      checking = true;
      try {
        const result = await getPayWayPaymentStatus(paymentReference, token);
        if (!active) return;
        const status = String(result.status || "pending").toLowerCase();
        localOrderIdRef.current = result.orderId;
        setPayWayCheckout((current) => current ? {
          ...current,
          paymentOption: result.paymentOption || current.paymentOption,
          expiresAt: result.expiresAt || current.expiresAt,
          amount: result.amount ?? current.amount,
          currency: result.currency || current.currency,
        } : current);
        setPayWayPaymentStatus(status);
        setPayWayStatusError("");
        if (["paid", "completed", "success", "succeeded"].includes(status)) {
          terminal = true;
          clearCart();
          setCompletedOrderNumber(String(result.orderId));
          setPaid(true);
          setPayWayCheckout(null);
        } else if (["failed", "cancelled", "canceled", "expired"].includes(status)) {
          terminal = true;
        }
      } catch (statusError) {
        if (active) {
          const message = statusError instanceof Error ? statusError.message : "Could not check the PayWay payment status.";
          setPayWayStatusError(
            /tran_id not found/i.test(message)
              ? "ABA PayWay cannot find this transaction yet. We’ll keep checking; don’t pay again or create another QR unless ABA confirms this one is invalid."
              : message,
          );
        }
      } finally {
        checking = false;
      }
    }

    void checkPaymentStatus();
    const timer = window.setInterval(() => void checkPaymentStatus(), 10000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [payWayCheckout?.tran_id, paid]);

  useEffect(() => {
    if (!payWayCheckout?.expiresAt) return;
    const timer = window.setInterval(() => setPayWayClock(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [payWayCheckout?.expiresAt]);

  useEffect(() => {
    let active = true;
    if (providerStatus.paypal?.advancedCardPaymentsEnabled !== true) {
      return () => {
        active = false;
      };
    }

    const token = window.localStorage.getItem("marketplace-token");
    if (!token) return () => {
      active = false;
    };

    void getSavedPayPalCards(token)
      .then((cards) => {
        if (!active) return;
        setSavedCards(cards);
        const preferredIndex = cards.findIndex((card) => card.isDefault && !isSavedCardExpired(card));
        const firstUsableIndex = preferredIndex >= 0
          ? preferredIndex
          : cards.findIndex((card) => !isSavedCardExpired(card));
        if (firstUsableIndex >= 0) {
          setSelectedSavedCardId(cards[firstUsableIndex].id);
          setActiveSavedCardIndex(firstUsableIndex);
        }
      })
      .catch((loadError: unknown) => {
        if (active) setSavedCardsError(loadError instanceof Error ? loadError.message : "Saved cards could not be loaded.");
      });

    return () => {
      active = false;
    };
  }, [providerStatus.paypal?.advancedCardPaymentsEnabled]);

  useEffect(() => {
    const clientId = providerStatus.paypal?.clientId;
    if (provider !== "paypal" || isLoading || !items.length) {
      cardFieldsRef.current = null;
      return;
    }
    if (!providerStatus.paypal?.configured || !clientId) {
      return;
    }

    let active = true;
    const scriptId = "paypal-card-fields-sdk";
    let script = document.getElementById(scriptId) as HTMLScriptElement | null;
    const scriptUrl = new URL("https://www.paypal.com/sdk/js");
    scriptUrl.searchParams.set("client-id", clientId);
    scriptUrl.searchParams.set("components", "card-fields");
    scriptUrl.searchParams.set("intent", "capture");
    if (providerStatus.paypal.advancedCardPaymentsEnabled === true) {
      scriptUrl.searchParams.set("vault", "true");
    }

    const initializeCardFields = () => {
      if (!active || typeof window.paypal?.CardFields !== "function" || !cardNameRef.current || !cardNumberRef.current || !cardExpiryRef.current || !cardCvvRef.current) return;

      const cardFields = window.paypal.CardFields({
        style: {
          input: { "font-size": "14px", "font-family": "Arial, sans-serif" },
          ".invalid": { color: "#dc2626" },
        },
        createOrder: async () => {
          const localOrderId = localOrderIdRef.current;
          const token = window.localStorage.getItem("marketplace-token") || "";
          if (!localOrderId || !token) throw new Error("Your checkout session expired. Please try again.");
          const payment = await createPayPalOrder(localOrderId, token, { saveCard: saveCardRef.current, cardFields: true });
          return payment.paypalOrderId;
        },
        onApprove: async ({ orderID }) => {
          const token = window.localStorage.getItem("marketplace-token") || "";
          if (!token) throw new Error("Please sign in again to verify your payment.");
          const result = await capturePayPalOrder(orderID, token);
          if (String(result.status || "").toUpperCase() !== "COMPLETED") {
            throw new Error("PayPal has not confirmed this payment. Your order remains unpaid.");
          }
          clearCart();
          setCompletedOrderNumber(String(result.orderId || localOrderIdRef.current || ""));
          setPaid(true);
          if (result.savedCard) {
            const replacedCardId = replacingCardIdRef.current;
            setSavedCards((current) => [result.savedCard, ...current.filter((card) => card.id !== result.savedCard.id)]);
            if (replacedCardId !== null) {
              if (result.savedCardAlreadyExists && result.savedCard.id === replacedCardId) {
                setSelectedSavedCardId(result.savedCard.id);
                setCardSaveMessage("That card is already saved. It was not added again.");
                setReplacingCardId(null);
                replacingCardIdRef.current = null;
                return;
              }
              try {
                const removal = await deleteSavedPayPalCard(replacedCardId, token);
                setSavedCards((current) => current
                  .filter((card) => card.id !== replacedCardId)
                  .map((card) => ({ ...card, isDefault: card.id === removal.defaultCardId })));
                setSelectedSavedCardId(removal.defaultCardId ?? result.savedCard.id);
                setCardSaveMessage("Your new card was saved and replaced the previous card.");
                setReplacingCardId(null);
                replacingCardIdRef.current = null;
              } catch {
                setCardSaveMessage("Payment succeeded and your new card was saved, but the previous card could not be removed. Remove it from saved cards when you can.");
              }
            } else if (result.savedCardAlreadyExists) {
              setSelectedSavedCardId(result.savedCard.id);
              setCardSaveMessage("That card is already saved. It was not added again.");
            } else {
              setCardSaveMessage("PayPal validated your card and saved its encrypted vault token to your account.");
            }
          } else if (saveCardRef.current) {
            setCardSaveMessage("Payment succeeded, but PayPal did not return a vault token or the token could not be saved. Your card was not stored.");
          }
        },
        onError: (cardError) => {
          setError(getPayPalCardErrorMessage(cardError));
        },
      });

      if (!cardFields.isEligible()) {
        setCardFieldsError("PayPal card entry is unavailable for this account or region. Enable Advanced Credit and Debit Card Payments in PayPal.");
        return;
      }

      cardFieldsRef.current = cardFields;
      void Promise.all([
        cardFields.NameField({ placeholder: "Cardholder name" }).render("#paypal-card-name-field"),
        cardFields.NumberField({ placeholder: "Card number" }).render("#paypal-card-number-field"),
        cardFields.ExpiryField({ placeholder: "MM/YYYY" }).render("#paypal-card-expiry-field"),
        cardFields.CVVField({ placeholder: "CVV" }).render("#paypal-card-cvv-field"),
      ]).then(() => {
        if (active) setCardFieldsReady(true);
      }).catch((renderError: unknown) => {
        if (active) setCardFieldsError(renderError instanceof Error ? renderError.message : "PayPal card fields could not be loaded.");
      });
    };

    if (window.paypal) {
      initializeCardFields();
    } else {
      if (!script) {
        script = document.createElement("script");
        script.id = scriptId;
        script.src = scriptUrl.toString();
        script.async = true;
        document.head.appendChild(script);
      }
      script.addEventListener("load", initializeCardFields);
      script.addEventListener("error", () => {
        if (active) setCardFieldsError("PayPal card fields could not be loaded. Check your connection and PayPal settings.");
      }, { once: true });
    }

    return () => {
      active = false;
      script?.removeEventListener("load", initializeCardFields);
    };
  }, [
    isLoading,
    items.length,
    provider,
    providerStatus.paypal?.clientId,
    providerStatus.paypal?.configured,
    providerStatus.paypal?.advancedCardPaymentsEnabled,
    providerStatus.paypal?.message,
  ]);

  useEffect(() => {
    let active = true;
    const params = new URLSearchParams(window.location.search);
    if (params.get("paypal") === "cancelled") {
      void Promise.resolve().then(() => {
        if (active) setError("PayPal checkout was cancelled. No payment was captured.");
      });
      return () => {
        active = false;
      };
    }

    const paypalOrderId = params.get("token");
    if (!paypalOrderId) return () => {
      active = false;
    };
    const verifiedPayPalOrderId = paypalOrderId;

    const token = window.localStorage.getItem("marketplace-token") || "";
    if (!token) {
      void Promise.resolve().then(() => {
        if (active) setError("Sign in again to verify your PayPal payment.");
      });
      return () => {
        active = false;
      };
    }

    async function verifyPayment() {
      await Promise.resolve();
      if (!active) return;
      setIsVerifyingPayment(true);
      try {
        const result = await capturePayPalOrder(verifiedPayPalOrderId, token);
        if (!active) return;
        if (String(result.status || "").toUpperCase() !== "COMPLETED") {
          setError("PayPal has not confirmed this payment. Your order remains unpaid.");
          return;
        }
        clearCart();
        setCompletedOrderNumber(String(result.orderId || localOrderIdRef.current || ""));
        setPaid(true);
      } catch (verificationError: unknown) {
        if (active) {
          setError(verificationError instanceof Error ? verificationError.message : "Could not verify the PayPal payment.");
        }
      } finally {
        if (active) setIsVerifyingPayment(false);
      }
    }

    void verifyPayment();

    return () => {
      active = false;
    };
  }, []);

  const total = useMemo(
    () => items.reduce((sum, item) => sum + (item.licensePrice ?? item.product?.price ?? 0) * item.quantity, 0),
    [items],
  );
  const currencies = new Set(items.flatMap((item) => item.product?.currency ? [item.product.currency.toUpperCase()] : []));
  const hasMixedCurrencies = currencies.size > 1;
  const paypalCurrencyUnsupported = provider === "paypal" && currencies.size === 1 && !currencies.has("USD");
  const allProductsAvailable = !isLoading && !productError && !hasMixedCurrencies && items.every((item) => item.product);
  const payWayExpiryTimestamp = payWayCheckout ? Date.parse(payWayCheckout.expiresAt) : Number.NaN;
  const payWaySecondsRemaining = Number.isFinite(payWayExpiryTimestamp)
    ? Math.max(0, Math.ceil((payWayExpiryTimestamp - payWayClock) / 1000))
    : null;
  const payWayCountdown = payWaySecondsRemaining === null
    ? ""
    : `${String(Math.floor(payWaySecondsRemaining / 60)).padStart(2, "0")}:${String(payWaySecondsRemaining % 60).padStart(2, "0")}`;
  const isPayWayHostedCheckout = payWayCheckout?.paymentOption === "cards" || payWayCheckout?.paymentOption === "abapay_khqr";
  const paymentInputsLocked =
    isProcessing || isVerifyingPayment || (payWayCheckout !== null && payWayPaymentStatus === "pending");

  async function refreshPayWayCheckout() {
    const token = window.localStorage.getItem("marketplace-token") || "";
    const orderId = localOrderIdRef.current;
    if (!token || !orderId) {
      setPayWayStatusError("Sign in again and restart checkout to request a new PayWay payment.");
      return;
    }

    setIsProcessing(true);
    setPayWayStatusError("");
    try {
      const option = payWayCheckout?.paymentOption || payWayPaymentOption;
      const payment = await createPayWayOrder(orderId, token, option);
      if (option === "cards") {
        if (!payment.formUrl || !payment.fields || !payment.expiresAt) {
          throw new Error("ABA PayWay did not return a hosted checkout form.");
        }
        setPayWayCheckout({
          tran_id: payment.tran_id || payment.paymentReference,
          paymentReference: payment.tran_id || payment.paymentReference,
          paymentOption: payment.paymentOption || option,
          lifetimeMinutes: Number(payment.lifetimeMinutes || 5),
          expiresAt: payment.expiresAt,
          qrString: null,
          qrImage: null,
          deeplink: null,
          checkoutQrUrl: null,
          amount: payWayCheckout?.amount || total,
          currency: payWayCheckout?.currency || "USD",
        });
        setPayWayPaymentStatus("pending");
        setPayWayClock(Date.now());
        setIsPayWayQrOpen(false);
        submitPayWayForm(
          payment.formUrl,
          payment.fields,
          option,
          payment.paymentOption,
        );
        return;
      }
      if ((!payment.qrString && !payment.qrImage) || !payment.expiresAt) {
        throw new Error("ABA PayWay did not return a new QR code and expiry.");
      }
      setPayWayCheckout({
        tran_id: payment.tran_id || payment.paymentReference,
        paymentReference: payment.tran_id || payment.paymentReference,
        paymentOption: payment.paymentOption || option,
        lifetimeMinutes: Number(payment.lifetimeMinutes || 5),
        expiresAt: payment.expiresAt,
        qrString: payment.qrString || null,
        qrImage: payment.qrImage || null,
        deeplink: payment.deeplink || null,
        checkoutQrUrl: payment.checkoutQrUrl || null,
        amount: payWayCheckout?.amount || total,
        currency: payWayCheckout?.currency || "USD",
      });
      setPayWayPaymentStatus("pending");
      setPayWayClock(Date.now());
    } catch (refreshError) {
      setPayWayStatusError(refreshError instanceof Error ? refreshError.message : "Could not refresh the ABA PayWay payment.");
    } finally {
      setIsProcessing(false);
    }
  }

  async function makeDefaultCard(cardId: number) {
    const token = window.localStorage.getItem("marketplace-token") || "";
    if (!token) {
      setSavedCardsError("Sign in again to manage saved cards.");
      return;
    }

    setCardActionId(cardId);
    setSavedCardsError("");
    try {
      await setDefaultPayPalCard(cardId, token);
      setSavedCards((current) => current.map((card) => ({ ...card, isDefault: card.id === cardId })));
      setSelectedSavedCardId(cardId);
      setActiveSavedCardIndex(savedCards.findIndex((card) => card.id === cardId));
    } catch (actionError) {
      setSavedCardsError(actionError instanceof Error ? actionError.message : "Default card could not be updated.");
    } finally {
      setCardActionId(null);
    }
  }

  async function removeSavedCard(card: SavedPayPalCard) {
    if (!window.confirm(`Remove the ${card.brand || "saved"} card ending in ${card.lastDigits || "****"}?`)) return;
    const token = window.localStorage.getItem("marketplace-token") || "";
    if (!token) {
      setSavedCardsError("Sign in again to manage saved cards.");
      return;
    }

    setCardActionId(card.id);
    setSavedCardsError("");
    try {
      const result = await deleteSavedPayPalCard(card.id, token);
      const remainingCards = savedCards
        .filter((savedCard) => savedCard.id !== card.id)
        .map((savedCard) => ({ ...savedCard, isDefault: savedCard.id === result.defaultCardId }));
      setSavedCards(remainingCards);
      setSelectedSavedCardId((current) => current === card.id ? result.defaultCardId : current);
      setActiveSavedCardIndex((current) => {
        const activeCardId = savedCards[current]?.id;
        const remainingIndex = remainingCards.findIndex((savedCard) => savedCard.id === activeCardId);
        return remainingIndex >= 0 ? remainingIndex : Math.max(0, Math.min(current, remainingCards.length - 1));
      });
      if (replacingCardIdRef.current === card.id) {
        replacingCardIdRef.current = null;
        setReplacingCardId(null);
      }
    } catch (actionError) {
      setSavedCardsError(actionError instanceof Error ? actionError.message : "Saved card could not be removed.");
    } finally {
      setCardActionId(null);
    }
  }

  async function submitPayment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!items.length) return;
    if (hasMixedCurrencies) {
      setError("Products with different currencies cannot be checked out together. Remove items until the currency matches.");
      return;
    }
    if (!allProductsAvailable) {
      setError("Product details are unavailable or have changed. Return to your cart and refresh before checkout.");
      return;
    }

    const token = typeof window !== "undefined" ? window.localStorage.getItem("marketplace-token") : "";
    if (!token) {
      setError("Please sign in before completing checkout.");
      return;
    }
    if (provider === "paypal" && selectedSavedCardId === null && (!cardFieldsReady || !cardFieldsRef.current)) {
      setError(cardFieldsError || "PayPal card fields are not ready yet.");
      return;
    }

    try {
      setIsProcessing(true);
      setError("");
      setExistingOrderReference(null);

      const response = await fetch(`${apiUrl}/orders/checkout`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          items: items.map((item) => ({
            productId: Number(item.id),
            quantity: item.quantity,
            licenseTypeId: item.licenseTypeId ?? null,
            allowRepurchase: item.allowRepurchase === true,
          })),
        }),
      });

      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        if (data?.existingOrder?.orderId) setExistingOrderReference(Number(data.existingOrder.orderId));
        throw new Error(data?.error || "Unable to create your order.");
      }

      if (Number(data.totalAmount || 0) === 0 || data.status === "completed") {
        clearCart();
        setAlreadyPurchased(Boolean(data.alreadyPurchased));
        setCompletedOrderNumber(String(data.orderId || data.orderNumber || ""));
        setPaid(true);
        return;
      }

      if (provider === "paypal") {
        localOrderIdRef.current = Number(data.orderId);
        if (selectedSavedCardId !== null) {
          const payment = await createPayPalOrder(Number(data.orderId), token, {
            saveCard: false,
            cardFields: false,
            savedCardId: selectedSavedCardId,
          });
          const result = await capturePayPalOrder(payment.paypalOrderId, token);
          if (String(result.status || "").toUpperCase() !== "COMPLETED") {
            throw new Error("PayPal has not confirmed this payment. Your order remains unpaid.");
          }
          clearCart();
          setCompletedOrderNumber(String(result.orderId || data.orderId));
          setPaid(true);
          setCardSaveMessage("Payment completed with your saved PayPal card.");
          return;
        }
        saveCardRef.current = saveCard;
        const cardFields = cardFieldsRef.current;
        if (!cardFields) throw new Error("PayPal card fields are not ready yet.");
        await cardFields.submit();
        return;
      }

      localOrderIdRef.current = Number(data.orderId);
      const payment = await createPayWayOrder(Number(data.orderId), token, payWayPaymentOption);
      if (payWayPaymentOption === "cards") {
        if (!payment.formUrl || !payment.fields || !payment.expiresAt) {
          throw new Error("ABA PayWay did not return a hosted checkout form.");
        }
        setPayWayCheckout({
          tran_id: payment.tran_id || payment.paymentReference,
          paymentReference: payment.tran_id || payment.paymentReference,
          paymentOption: payment.paymentOption || payWayPaymentOption,
          lifetimeMinutes: Number(payment.lifetimeMinutes || 5),
          expiresAt: payment.expiresAt,
          qrString: null,
          qrImage: null,
          deeplink: null,
          checkoutQrUrl: null,
          amount: Number(data.totalAmount || total),
          currency: String(data.currency || items.find((item) => item.product)?.product?.currency || "USD"),
        });
        setPayWayPaymentStatus("pending");
        setPayWayClock(Date.now());
        setPayWayStatusError("");
        setIsPayWayQrOpen(false);
        submitPayWayForm(
          payment.formUrl,
          payment.fields,
          payWayPaymentOption,
          payment.paymentOption,
        );
        return;
      }
      if (payment.qrString || payment.qrImage) {
        if (!payment.expiresAt) throw new Error("ABA PayWay did not return the QR expiry.");
        setPayWayCheckout({
          tran_id: payment.tran_id || payment.paymentReference,
          paymentReference: payment.tran_id || payment.paymentReference,
          paymentOption: payment.paymentOption || payWayPaymentOption,
          lifetimeMinutes: Number(payment.lifetimeMinutes || 5),
          expiresAt: payment.expiresAt,
          qrString: payment.qrString || null,
          qrImage: payment.qrImage || null,
          deeplink: payment.deeplink || null,
          checkoutQrUrl: payment.checkoutQrUrl || null,
          amount: Number(data.totalAmount || total),
          currency: String(data.currency || items.find((item) => item.product)?.product?.currency || "USD"),
        });
        setPayWayPaymentStatus("pending");
        setPayWayClock(Date.now());
        setPayWayStatusError("");
        setIsPayWayQrOpen(true);
        return;
      }
      if (!payment.formUrl || !payment.fields) throw new Error("ABA PayWay did not return a QR code or checkout form. Check the Sandbox settings and try again.");
      submitPayWayForm(
        payment.formUrl,
        payment.fields,
        payWayPaymentOption,
        payment.paymentOption,
      );
    } catch (caughtError) {
      setError(getPayPalCardErrorMessage(caughtError));
    } finally {
      setIsProcessing(false);
    }
  }

  return (
    <div className="min-h-screen bg-[#f7f9fd] text-[#142b4d]">
      <Navbar active="products" />
      <main className="mx-auto max-w-[960px] px-4 pb-16 pt-8 sm:px-6 lg:px-8">
        <div className="flex items-center gap-2 text-[10px] text-muted">
          <Link href="/cart" className="text-primary">
            Cart
          </Link>
          <span className="text-storefront-blue">/</span>
          <span className="font-medium text-muted">Payment</span>
        </div>

        {paid ? (
          <section className="mt-6 border border-border bg-white p-10 text-center shadow-sm">
            <div className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-emerald-100 text-xl text-emerald-600">
              ✓
            </div>
            <h1 className="mt-4 text-2xl font-extrabold text-heading">{alreadyPurchased ? "Already purchased" : "Payment successful"}</h1>
            <p className="mt-2 text-xs text-muted">{alreadyPurchased ? "This product is already in your purchase history. We reused the existing order instead of creating another one." : "Your digital files are ready in your account."}</p>
            {completedOrderNumber && <Link href={`/buyer/purchases/${encodeURIComponent(completedOrderNumber)}`} className="mt-2 inline-block text-xs font-semibold text-primary">View order {completedOrderNumber}</Link>}
            {cardSaveMessage && <p className="mt-2 text-xs text-muted">{cardSaveMessage}</p>}
            <Link
              href="/marketplace"
              className="mt-5 inline-flex rounded-md bg-primary px-5 py-3 text-xs font-bold text-white hover:bg-primary-hover"
            >
              Back to marketplace
            </Link>
          </section>
        ) : isLoading ? (
          <section className="mt-6 border border-border bg-white p-10 text-center shadow-sm">
            <p className="text-xs text-muted">Loading current product details...</p>
          </section>
        ) : items.length === 0 ? (
          <section className="mt-6 border border-border bg-white p-10 text-center shadow-sm">
            <h1 className="text-xl font-bold text-heading">No items to pay for</h1>
            <Link href="/cart" className="mt-4 inline-block text-xs font-semibold text-primary">
              Return to cart
            </Link>
          </section>
        ) : (
          <div className="mt-6 grid gap-5 lg:grid-cols-[minmax(0,1fr)_300px]">
            <form onSubmit={submitPayment} className="border border-border bg-white p-5 shadow-sm sm:p-6">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h1 className="text-2xl font-extrabold text-heading">Complete payment</h1>
                  <p className="mt-1 text-xs text-muted">Sandbox mode is enabled for local testing.</p>
                </div>
                <span className="rounded-full bg-amber-50 px-2.5 py-1 text-[9px] font-semibold uppercase tracking-[0.12em] text-amber-700">
                  Sandbox
                </span>
              </div>

              <div className="mt-6">
                <fieldset disabled={paymentInputsLocked}>
                  <legend className="mb-2 text-xs font-bold text-heading">Choose a payment method</legend>
                  <div className="grid gap-2 sm:grid-cols-2">
                    <label className={`flex cursor-pointer items-start gap-3 rounded-xl border p-4 text-left shadow-sm transition ${
                      provider === "paypal" ? "border-primary bg-primary/5" : "border-border bg-white hover:border-primary/50"
                    }`}>
                      <input
                        type="radio"
                        name="payment-provider"
                        value="paypal"
                        checked={provider === "paypal"}
                        onChange={() => {
                          setProvider("paypal");
                          setError("");
                        }}
                        className="mt-0.5 accent-primary"
                      />
                      <span>
                        <span className="block text-xs font-bold text-heading">Credit / debit card</span>
                        <span className="mt-1 block text-[10px] leading-4 text-muted">Pay securely with PayPal using a new or saved card.</span>
                      </span>
                    </label>
                    <label className={`flex cursor-pointer items-start gap-3 rounded-xl border p-4 text-left shadow-sm transition ${
                      provider === "abayapayway" ? "border-primary bg-primary/5" : "border-border bg-white hover:border-primary/50"
                    }`}>
                      <input
                        type="radio"
                        name="payment-provider"
                        value="abayapayway"
                        checked={provider === "abayapayway"}
                        onChange={() => {
                          setProvider("abayapayway");
                          setError("");
                        }}
                        className="mt-0.5 accent-primary"
                      />
                      <span>
                        <span className="block text-xs font-bold text-heading">ABA Pay / KHQR</span>
                        <span className="mt-1 block text-[10px] leading-4 text-muted">Scan a QR code with ABA Mobile or another supported banking app.</span>
                      </span>
                    </label>
                  </div>
                </fieldset>
              </div>

              {provider === "paypal" && (
                <section
                  inert={paymentInputsLocked}
                  className="mt-4 rounded-2xl border border-[#e5e9f2] bg-gradient-to-b from-[#fbfcff] to-white p-4 sm:p-5"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <h2 className="text-sm font-bold text-heading">Pay with card</h2>
                      <p className="mt-1 text-[10px] leading-5 text-muted">
                        Choose a saved card or securely enter new details.
                      </p>
                    </div>
                    <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-[#dcefe5] bg-[#f2fbf6] px-2.5 py-1 text-[9px] font-semibold text-[#26734c]">
                      <svg aria-hidden="true" viewBox="0 0 16 16" fill="none" className="h-3 w-3">
                        <path d="M4.5 7V5a3.5 3.5 0 0 1 7 0v2M3.5 7h9v7h-9V7Z" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                      PayPal secure
                    </span>
                  </div>
                  {providerStatus.paypal?.advancedCardPaymentsEnabled && savedCards.length > 0 && (
                    <fieldset className="mt-4">
                      <legend className="mb-2 text-[10px] font-semibold text-heading">Saved cards</legend>
                      <CreditDebitCardCarousel
                        items={savedCards}
                        activeIndex={activeSavedCardIndex}
                        getKey={(card) => card.id}
                        onActiveIndexChange={setActiveSavedCardIndex}
                        mobileLayout="grid"
                        desktopCardClassName="max-w-xs"
                        renderCard={(card, index, isActive) => {
                          const expired = isSavedCardExpired(card);
                          const selected = selectedSavedCardId === card.id;
                          return (
                            <div className="min-w-0">
                              <PaymentMethodCard
                                method="Credit Card"
                                cardName="Saved card"
                                cardNumber=""
                                lastDigits={card.lastDigits}
                                cardExpiry={card.expiryMonth && card.expiryYear ? `${String(card.expiryMonth).padStart(2, "0")}/${card.expiryYear}` : undefined}
                                cardBrand={card.brand || "Card"}
                                isPrimary={card.isDefault}
                                flipped={isActive && Boolean(flippedSavedCards[card.id])}
                                selected={selected}
                                disabled={expired}
                                actionsDisabled={cardActionId !== null}
                                showControls={isActive}
                                compact
                                onFlip={isActive ? () => setFlippedSavedCards((current) => ({ ...current, [card.id]: !current[card.id] })) : undefined}
                                onSelect={isActive ? () => {
                                  setActiveSavedCardIndex(index);
                                  setSelectedSavedCardId(card.id);
                                  setReplacingCardId(null);
                                  replacingCardIdRef.current = null;
                                  setSaveCard(false);
                                  setError("");
                                } : undefined}
                                onSetPrimary={isActive && !expired ? () => void makeDefaultCard(card.id) : undefined}
                                onRemove={isActive ? () => void removeSavedCard(card) : undefined}
                              />
                              {isActive && <button
                                type="button"
                                disabled={expired || cardActionId !== null}
                                onClick={() => {
                                  replacingCardIdRef.current = card.id;
                                  setReplacingCardId(card.id);
                                  setSelectedSavedCardId(null);
                                  setSaveCard(true);
                                  setError("");
                                  window.setTimeout(() => {
                                    document.getElementById("paypal-card-name-field")?.scrollIntoView({ behavior: "smooth", block: "center" });
                                  }, 0);
                                }}
                                className="mt-2 text-[9px] font-semibold text-primary hover:underline disabled:cursor-not-allowed disabled:opacity-50"
                              >
                                Edit / replace
                              </button>}
                              {isActive && expired && <p className="mt-1 text-[9px] font-semibold text-red-600">Expired</p>}
                            </div>
                          );
                        }}
                      />
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedSavedCardId(null);
                          setReplacingCardId(null);
                          replacingCardIdRef.current = null;
                          setSaveCard(false);
                          setError("");
                        }}
                        aria-pressed={selectedSavedCardId === null}
                        className={`mt-2 flex w-full items-center gap-2 rounded-xl border px-3 py-2.5 text-left text-[10px] font-semibold transition ${
                          selectedSavedCardId === null
                            ? "border-primary bg-[#fff9f4] text-heading"
                            : "border-[#e5e9f2] bg-white text-muted hover:border-primary/50 hover:text-heading"
                        }`}
                      >
                        <span className={`grid h-6 w-6 place-items-center rounded-md ${
                          selectedSavedCardId === null ? "bg-primary/10 text-primary" : "bg-[#f3f5f9] text-muted"
                        }`}>
                          <svg aria-hidden="true" viewBox="0 0 16 16" fill="none" className="h-3.5 w-3.5">
                            <path d="M8 3.25v9.5M3.25 8h9.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                          </svg>
                        </span>
                        Use a new card
                      </button>
                    </fieldset>
                  )}
                  <div className={`mt-3 ${selectedSavedCardId !== null ? "hidden" : ""}`}>
                    <div className="grid gap-2">
                    <div className="mb-1 flex items-center justify-between gap-2">
                      <div>
                        <h3 className="text-[10px] font-semibold text-heading">
                          {replacingCardId !== null ? "Replace saved card" : "New card details"}
                        </h3>
                        {replacingCardId !== null && (
                          <div className="mt-1 flex items-start gap-2">
                            <p className="text-[9px] leading-4 text-muted">
                              The new card is saved after this purchase succeeds. The old card stays available until then.
                            </p>
                            <button
                              type="button"
                              onClick={() => {
                                setReplacingCardId(null);
                                replacingCardIdRef.current = null;
                                setSaveCard(false);
                              }}
                              className="shrink-0 text-[9px] font-semibold text-primary hover:underline"
                            >
                              Cancel
                            </button>
                          </div>
                        )}
                      </div>
                      <span className="text-[9px] text-muted">Processed by PayPal</span>
                    </div>
                    <label className="grid gap-1.5 text-[9px] font-semibold text-heading">
                      Cardholder name
                      <div id="paypal-card-name-field" ref={cardNameRef} className="h-20 rounded-lg border border-border-control bg-white px-2 transition focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/30" />
                    </label>
                    <label className="grid gap-1.5 text-[9px] font-semibold text-heading">
                      Card number
                      <div id="paypal-card-number-field" ref={cardNumberRef} className="h-20 rounded-lg border border-border-control bg-white px-2 transition focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/30" />
                    </label>
                    <div className="grid grid-cols-2 gap-2">
                      <label className="grid gap-1.5 text-[9px] font-semibold text-heading">
                        Expiration (MM/YYYY)
                        <div id="paypal-card-expiry-field" ref={cardExpiryRef} className="h-20 rounded-lg border border-border-control bg-white px-2 transition focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/30" />
                      </label>
                      <label className="grid gap-1.5 text-[9px] font-semibold text-heading">
                        Security code
                        <div id="paypal-card-cvv-field" ref={cardCvvRef} className="h-20 rounded-lg border border-border-control bg-white px-2 transition focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/30" />
                      </label>
                    </div>
                  </div>
                  </div>
                  {selectedSavedCardId === null && (
                    <label className="mt-3 flex items-start gap-2 text-[10px] text-heading">
                      <input
                        type="checkbox"
                        checked={saveCard}
                        disabled={
                          replacingCardId !== null ||
                          providerStatus.paypal?.advancedCardPaymentsEnabled !== true
                        }
                        onChange={(event) => setSaveCard(event.target.checked)}
                        className="mt-0.5 accent-primary disabled:opacity-70"
                      />
                      <span>Save this card securely with PayPal</span>
                    </label>
                  )}
                  {selectedSavedCardId === null && !cardFieldsReady && !cardFieldsError && (
                    <p className="mt-2 text-[9px] text-muted">Loading PayPal card fields...</p>
                  )}
                  {selectedSavedCardId === null && cardFieldsError && (
                    <p className="mt-2 text-[9px] text-red-600">{cardFieldsError}</p>
                  )}
                  {savedCardsError && (
                    <p className="mt-2 text-[9px] text-red-600">{savedCardsError}</p>
                  )}
                </section>
              )}

              {!(
                provider === "paypal" &&
                providerStatus.paypal?.configured &&
                providerStatus.paypal.advancedCardPaymentsEnabled !== true
              ) && (
                <div className="mt-4 flex items-start justify-between gap-3 rounded-lg border border-border bg-surface-muted p-3">
                  <div>
                    <p className="text-[10px] font-semibold text-heading">
                      {providerStatus[provider]?.message || "Checking sandbox configuration..."}
                    </p>
                    {statusError && <p className="mt-1 text-[10px] text-red-600">{statusError}</p>}
                  </div>
                  <button
                    type="button"
                    onClick={() => void refreshProviderStatus()}
                    disabled={isRefreshingStatus || paymentInputsLocked}
                    className="shrink-0 text-[10px] font-semibold text-primary disabled:opacity-60"
                  >
                    {isRefreshingStatus ? "Checking..." : "Refresh"}
                  </button>
                </div>
              )}

              {productError && (
                <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
                  {productError}
                </div>
              )}
              {hasMixedCurrencies && (
                <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
                  Products with different currencies cannot be checked out together. Return to your cart and remove items until the currency matches.
                </div>
              )}
              {paypalCurrencyUnsupported && (
                <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                  PayPal card checkout supports USD orders only. Select ABA PayWay for this currency.
                </div>
              )}
              {isVerifyingPayment && (
                <div className="mt-4 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-xs text-blue-800">
                  Verifying the payment directly with PayPal...
                </div>
              )}

              {error && (
                <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
                  {error}
                  {existingOrderReference !== null && <Link href={`/buyer/purchases/${existingOrderReference}`} className="ml-1 font-semibold underline">View existing order</Link>}
                </div>
              )}

              <div className="mt-6 rounded-xl border border-border bg-surface-muted p-4">
                <div className="flex items-center justify-between text-[10px] font-semibold uppercase tracking-[0.12em] text-muted">
                  <span>Selected method</span>
                  <span>{provider === "paypal" ? "PayPal Credit/Debit Card" : "ABA PayWay KHQR"}</span>
                </div>
                <p className="mt-3 text-xs text-muted">
                  {provider === "paypal"
                    ? "PayPal validates and processes the card. If you choose to save it, only PayPal's encrypted vault token and masked card details are kept by this app."
                  : "Pay securely by scanning a KHQR code with ABA Mobile or another supported banking app."}
                </p>
              </div>

              <button
                type="submit"
                disabled={
                  paymentInputsLocked ||
                  isLoading ||
                  !allProductsAvailable ||
                  providerStatus[provider]?.configured === false ||
                  paypalCurrencyUnsupported ||
                  (provider === "paypal" && selectedSavedCardId === null && !cardFieldsReady)
                }
                className="mt-6 flex h-11 w-full items-center justify-center rounded-md bg-primary text-xs font-bold text-white hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-70"
              >
                {isProcessing
                  ? "Processing..."
                  : `Pay ${formatMarketplacePrice(total, items.find((item) => item.product)?.product?.currency || "USD")}`}
              </button>
            </form>

            <aside className="h-fit border border-border bg-white p-5 shadow-sm">
              <h2 className="text-sm font-bold text-heading">Your order</h2>
              {items.map((item) => (
                <div key={item.id} className="mt-4 flex justify-between gap-3 text-xs">
                  <span className="text-muted">
                    {item.product?.name || "Unavailable product"} × {item.quantity}
                  </span>
                  <span className="font-semibold text-heading">
                    {item.product ? formatMarketplacePrice((item.licensePrice ?? item.product.price) * item.quantity, item.product.currency) : "—"}
                  </span>
                </div>
              ))}
              <div className="mt-5 flex justify-between border-t border-divider pt-4 text-sm font-bold text-heading">
                <span>Total</span>
                <span>{formatMarketplacePrice(total, items.find((item) => item.product)?.product?.currency || "USD")}</span>
              </div>
            </aside>
          </div>
        )}
      </main>
      {payWayCheckout && !isPayWayQrOpen && !paid && (
        <div className="fixed bottom-4 right-4 z-40 rounded-xl border border-border bg-white p-3 shadow-lg">
          <p className="text-xs font-semibold text-heading">PayWay payment is {payWayPaymentStatus}.</p>
          <button
            type="button"
            onClick={() => {
              setAbaAppLaunchError("");
              setIsPayWayQrOpen(true);
            }}
            className="mt-2 text-xs font-bold text-primary"
          >
            {isPayWayHostedCheckout ? "Show payment status" : "Show payment QR"}
          </button>
        </div>
      )}
      {payWayCheckout && isPayWayQrOpen && !paid && (
        <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-slate-950/60 p-4" role="dialog" aria-modal="true" aria-labelledby="payway-qr-title">
          <section className="my-auto w-full max-w-md rounded-2xl bg-white p-5 shadow-2xl sm:p-7">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-primary">ABA PayWay Sandbox</p>
                <h2 id="payway-qr-title" className="mt-1 text-xl font-extrabold text-heading">
                  {isPayWayHostedCheckout ? "ABA PayWay payment status" : "Scan to pay"}
                </h2>
                <p className="mt-1 text-xs text-muted">
                  {isPayWayHostedCheckout
                    ? "ABA PayWay is checking whether your checkout completed."
                    : "Open ABA Mobile or a KHQR-compatible banking app and scan this code."}
                </p>
              </div>
              <button
                type="button"
                aria-label="Close QR code"
                onClick={() => {
                  setAbaAppLaunchError("");
                  setIsPayWayQrOpen(false);
                }}
                className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-slate-100 text-lg text-slate-600 hover:bg-slate-200"
              >
                ×
              </button>
            </div>
            {isPayWayHostedCheckout ? (
              <div className="mt-5 rounded-xl border border-slate-200 bg-slate-50 p-5 text-center">
                <p className="text-sm font-semibold text-heading">
                  {payWayPaymentStatus === "pending" ? "Waiting for ABA PayWay confirmation" : `Payment ${payWayPaymentStatus}`}
                </p>
                <p className="mt-1 text-xs text-muted">Keep this page open while the transaction status is checked.</p>
              </div>
            ) : (
              <div className="mt-5 flex justify-center rounded-xl border border-slate-200 bg-white p-4">
                {payWayCheckout.qrImage ? (
                  <Image src={payWayCheckout.qrImage} alt="ABA PayWay payment QR code" width={224} height={224} unoptimized className="h-56 w-56 object-contain" />
                ) : payWayCheckout.qrString ? (
                  <QRCodeSVG value={payWayCheckout.qrString} size={224} level="M" marginSize={4} title="ABA PayWay payment QR code" />
                ) : (
                  <p className="py-12 text-center text-sm text-red-600">PayWay did not provide a scannable QR code.</p>
                )}
              </div>
            )}
            <div className="mt-4 rounded-xl bg-slate-50 p-4 text-center">
              <p className="text-[10px] font-medium uppercase tracking-wide text-muted">Amount due</p>
              <p className="mt-1 text-2xl font-extrabold text-heading">
                {formatMarketplacePrice(payWayCheckout.amount, payWayCheckout.currency)}
              </p>
              <p className="mt-2 text-xs font-semibold capitalize text-amber-700">
                {payWayPaymentStatus === "pending" ? "Waiting for payment confirmation..." : `Payment ${payWayPaymentStatus}`}
              </p>
              <p className="mt-1 text-[10px] text-muted">
                {payWayPaymentStatus === "pending"
                  ? payWaySecondsRemaining
                    ? `${isPayWayHostedCheckout ? "Payment session" : "QR"} expires in ${payWayCountdown}`
                    : `Payment session expired. Confirming status with ABA PayWay...`
                  : payWayPaymentStatus === "expired"
                    ? `${isPayWayHostedCheckout ? "Payment session" : "QR"} expired.`
                    : `Payment session ended after ${payWayCheckout.lifetimeMinutes} minutes.`}
              </p>
              {payWayStatusError && <p className="mt-2 text-[10px] text-red-600">{payWayStatusError}</p>}
            </div>
            {payWayCheckout.deeplink?.startsWith("abamobilebank://") && (
              <a
                href={payWayCheckout.deeplink}
                onClick={() => {
                  setAbaAppLaunchError("");
                  window.setTimeout(() => {
                    if (document.visibilityState === "visible") {
                      setAbaAppLaunchError(
                        "Could not open ABA Mobile. Install the app, or scan this QR code with another KHQR-compatible banking app.",
                      );
                    }
                  }, 1500);
                }}
                className="mt-4 flex h-11 items-center justify-center rounded-lg bg-primary px-4 text-xs font-bold text-white hover:bg-primary-hover"
              >
                Open ABA Mobile
              </a>
            )}
            {abaAppLaunchError && (
              <p role="alert" className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                {abaAppLaunchError}
              </p>
            )}
            {payWayPaymentStatus === "failed" || payWayPaymentStatus === "cancelled" || payWayPaymentStatus === "canceled" || payWayPaymentStatus === "expired" || payWaySecondsRemaining === 0 ? (
              <button type="button" onClick={() => void refreshPayWayCheckout()} disabled={isProcessing} className="mt-3 h-10 w-full rounded-lg border border-slate-200 text-xs font-bold text-heading hover:bg-slate-50 disabled:opacity-60">
                {isProcessing
                  ? "Requesting..."
                  : isPayWayHostedCheckout
                    ? "Open ABA checkout again"
                    : "Refresh QR"}
              </button>
            ) : (
              <p className="mt-4 text-center text-[10px] leading-5 text-muted">
                This page checks for payment confirmation automatically. Keep it open until the payment is confirmed.
              </p>
            )}
            <p className="mt-2 text-center text-[9px] text-slate-400">ABA transaction ID: {payWayCheckout.tran_id}</p>
          </section>
        </div>
      )}
      <PublicFooter />
    </div>
  );
}
