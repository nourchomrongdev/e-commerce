"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import Navbar from "@/components/Navbar";
import PublicFooter from "@/components/PublicFooter";
import CreditDebitCardCarousel from "@/components/dashboard/CreditDebitCardCarousel";
import PaymentMethodCard from "@/components/dashboard/PaymentMethodCard";
import { deleteSavedPayPalCard, getSavedPayPalCards, setDefaultPayPalCard, type SavedPayPalCard } from "@/lib/paypal";

export default function ProfilePaymentMethodsPage() {
  const [cards, setCards] = useState<SavedPayPalCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [actionId, setActionId] = useState<number | null>(null);
  const [activeCardIndex, setActiveCardIndex] = useState(0);
  const [flippedCards, setFlippedCards] = useState<Record<number, boolean>>({});

  useEffect(() => {
    let active = true;
    const loadCards = async () => {
      const token = window.localStorage.getItem("marketplace-token");
      if (!token) {
        setError("Sign in to manage payment methods.");
        setLoading(false);
        return;
      }
      try {
        const savedCards = await getSavedPayPalCards(token);
        if (active) setCards(savedCards);
      } catch (loadError) {
        if (active) setError(loadError instanceof Error ? loadError.message : "Saved payment methods could not be loaded.");
      } finally {
        if (active) setLoading(false);
      }
    };

    void loadCards();
    return () => {
      active = false;
    };
  }, []);

  const makePrimary = async (cardId: number) => {
    const token = window.localStorage.getItem("marketplace-token") || "";
    setActionId(cardId);
    setError("");
    setNotice("");
    try {
      await setDefaultPayPalCard(cardId, token);
      setCards((current) => current.map((card) => ({ ...card, isDefault: card.id === cardId })));
      setNotice("Your primary payment method has been updated.");
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "Unable to update the primary payment method.");
    } finally {
      setActionId(null);
    }
  };

  const removeCard = async (cardId: number) => {
    if (!window.confirm("Remove this saved payment method?")) return;
    const token = window.localStorage.getItem("marketplace-token") || "";
    setActionId(cardId);
    setError("");
    setNotice("");
    try {
      const result = await deleteSavedPayPalCard(cardId, token);
      const remainingCards = cards
        .filter((card) => card.id !== cardId)
        .map((card) => ({ ...card, isDefault: card.id === result.defaultCardId }));
      setCards(remainingCards);
      setActiveCardIndex((index) => Math.max(0, Math.min(index, remainingCards.length - 1)));
      setNotice("The saved payment method has been removed.");
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "Unable to remove the saved payment method.");
    } finally {
      setActionId(null);
    }
  };

  return (
    <main className="flex min-h-screen flex-col bg-[#f7f9fd] text-[#142b4d]">
      <Navbar active={null} />
      <div className="mx-auto w-full max-w-[1180px] flex-1 px-4 pb-12 pt-8 sm:px-6 lg:px-8">
        <div className="mb-6">
          <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-primary">Account</p>
          <h1 className="mt-1 text-3xl font-extrabold tracking-tight text-heading">Payment methods</h1>
          <p className="mt-2 text-sm text-muted">Manage saved cards for future marketplace purchases.</p>
        </div>

        <section className="w-full border border-border bg-white p-6 sm:p-8">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-divider pb-5">
            <div>
              <h2 className="text-sm font-bold text-heading">Saved cards</h2>
              <p className="mt-1 text-[10px] text-muted">Only masked card details are shown. PayPal stores and processes card information.</p>
            </div>
            <Link href="/profile/payments/add" className="rounded-md border border-primary px-3 py-1.5 text-[10px] font-bold text-primary no-underline hover:bg-orange-50">Add card</Link>
          </div>

          {loading ? (
            <p className="py-6 text-xs text-muted">Loading saved payment methods…</p>
          ) : error && cards.length === 0 ? (
            <div className="py-6">
              <p role="alert" className="text-xs text-status-danger">{error}</p>
              {error.includes("Sign in") && <Link href="/login" className="mt-4 inline-flex rounded-md bg-primary px-4 py-2 text-xs font-bold text-white no-underline hover:bg-primary-hover">Sign in</Link>}
            </div>
          ) : cards.length ? (
            <div className="mt-5">
              <CreditDebitCardCarousel
                items={cards}
                activeIndex={activeCardIndex}
                getKey={(card) => card.id}
                onActiveIndexChange={setActiveCardIndex}
                desktopCardClassName="max-w-md"
                renderCard={(card, _index, isActive) => (
                  <div className="mx-auto max-w-md">
                    <PaymentMethodCard
                      method="Credit Card"
                      cardName="Saved card"
                      cardNumber=""
                      lastDigits={card.lastDigits}
                      cardExpiry={card.expiryMonth && card.expiryYear ? `${String(card.expiryMonth).padStart(2, "0")}/${card.expiryYear}` : undefined}
                      cardBrand={card.brand || "Card"}
                      isPrimary={card.isDefault}
                      flipped={isActive && Boolean(flippedCards[card.id])}
                      actionsDisabled={actionId !== null}
                      showControls={isActive}
                      onFlip={isActive ? () => setFlippedCards((current) => ({ ...current, [card.id]: !current[card.id] })) : undefined}
                      onSetPrimary={isActive ? () => void makePrimary(card.id) : undefined}
                      onRemove={isActive ? () => void removeCard(card.id) : undefined}
                    />
                    {isActive && <div className="mt-3 flex justify-end">
                      <Link
                        href={`/profile/payments/add?replaceCardId=${encodeURIComponent(card.id)}`}
                        className="rounded-md border border-primary px-3 py-1.5 text-[10px] font-bold text-primary no-underline hover:bg-orange-50"
                      >
                        Edit card
                      </Link>
                    </div>}
                  </div>
                )}
              />
              {cards.length > 1 && <div className="mt-3 flex items-center justify-center gap-5 md:hidden">
                <button type="button" aria-label="Previous saved card" onClick={() => { setActiveCardIndex((index) => (index - 1 + cards.length) % cards.length); }} className="grid h-9 w-9 place-items-center rounded-full border border-border-control bg-white text-lg text-muted hover:border-primary hover:text-primary">‹</button>
                <span className="text-[10px] font-semibold text-muted">{activeCardIndex + 1} of {cards.length}</span>
                <button type="button" aria-label="Next saved card" onClick={() => { setActiveCardIndex((index) => (index + 1) % cards.length); }} className="grid h-9 w-9 place-items-center rounded-full border border-border-control bg-white text-lg text-muted hover:border-primary hover:text-primary">›</button>
              </div>}
            </div>
          ) : (
            <p className="mt-5 rounded-lg border border-divider px-4 py-4 text-xs text-muted">No saved payment methods. Add a card securely with PayPal to use it for future purchases.</p>
          )}

          {error && cards.length > 0 && <p role="alert" className="mt-4 text-xs text-status-danger">{error}</p>}
          {notice && <p role="status" className="mt-4 text-xs text-status-success">{notice}</p>}
          <div className="mt-6 border-t border-divider pt-5">
            <Link href="/profile" className="text-xs font-semibold text-primary no-underline hover:underline">Back to profile</Link>
          </div>
        </section>
      </div>
      <PublicFooter />
    </main>
  );
}
