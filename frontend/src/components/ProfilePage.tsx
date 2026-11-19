"use client";

import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
import Navbar from "@/components/Navbar";
import PublicFooter from "@/components/PublicFooter";
import PublicIcon from "@/components/icons/PublicIcon";
import CreditDebitCardCarousel from "@/components/dashboard/CreditDebitCardCarousel";
import PaymentMethodCard from "@/components/dashboard/PaymentMethodCard";
import UserAvatar from "@/components/UserAvatar";
import { getSavedPayPalCards, type SavedPayPalCard } from "@/lib/paypal";

export type ProfileUser = {
  id?: string | number;
  username?: string;
  email?: string;
  role?: string;
  roles?: Array<string | { name?: string; role?: string }>;
  fullName?: string;
  name?: string;
  phone?: string;
  avatarUrl?: string;
  bio?: string;
  location?: string;
  createdAt?: string;
  status?: string;
  isVerified?: boolean;
  emailVerified?: boolean;
  recoveryEmail?: string | null;
  recoveryEmailVerified?: boolean;
  recoveryEmailPending?: string | null;
};

type ProfileStats = {
  totalOrders: number;
  purchasedProducts: number;
  totalDownloads: number;
  wishlistItems: number;
};

const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:5000/api";

export function displayName(user: ProfileUser) {
  return user.fullName || user.name || user.username?.replace(/_\d{6}$/, "").replace(/_/g, " ") || "Marketplace user";
}

function formatDate(value?: string) {
  if (!value) return "Not available";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" });
}

export function ProfileAvatar({ url, name, large = false }: { url?: string; name: string; large?: boolean }) {
  return <UserAvatar url={url} name={name} className={`${large ? "h-20 w-20 text-2xl" : "h-16 w-16 text-xl"}`} />;
}

export default function ProfilePage({ dashboard = false }: { dashboard?: boolean }) {
  const [user, setUser] = useState<ProfileUser | null>(null);
  const [stats, setStats] = useState<ProfileStats | null>(null);
  const [cards, setCards] = useState<SavedPayPalCard[]>([]);
  const [cardsLoading, setCardsLoading] = useState(true);
  const [cardsError, setCardsError] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [statsError, setStatsError] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    const loadProfile = async () => {
      const token = window.localStorage.getItem("marketplace-token");
      if (!token) {
        setError("Sign in to view your profile.");
        setLoading(false);
        setCardsLoading(false);
        return;
      }
      const headers = { Authorization: `Bearer ${token}` };
      try {
        const profileResponse = await fetch(`${apiUrl}/auth/me`, { headers, cache: "no-store", signal: controller.signal });
        const profileData = await profileResponse.json();
        if (!profileResponse.ok) throw new Error(profileData.error || "We could not load your profile.");
        if (!controller.signal.aborted) {
          setUser(profileData.user ?? profileData);
        }
        try {
          const activityResponse = await fetch(`${apiUrl}/buyer/overview`, { headers, cache: "no-store", signal: controller.signal });
          const activityData = await activityResponse.json();
          if (!activityResponse.ok) throw new Error(activityData.error || "Profile activity could not be loaded.");
          if (!controller.signal.aborted) setStats(activityData.stats ?? null);
        } catch (activityError) {
          if (!controller.signal.aborted) setStatsError(activityError instanceof Error ? activityError.message : "Profile activity could not be loaded.");
        }
      } catch (requestError) {
        if (!controller.signal.aborted) setError(requestError instanceof Error ? requestError.message : "We could not load your profile.");
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }

      try {
        const savedCards = await getSavedPayPalCards(token);
        if (!controller.signal.aborted) setCards(savedCards);
      } catch (requestError) {
        if (!controller.signal.aborted) setCardsError(requestError instanceof Error ? requestError.message : "Saved payment methods could not be loaded.");
      } finally {
        if (!controller.signal.aborted) setCardsLoading(false);
      }
    };

    void loadProfile();
    return () => controller.abort();
  }, []);

  const name = displayName(user ?? {});
  const roleNames = Array.from(new Set([
    ...(user?.roles ?? []).map((entry) => typeof entry === "string" ? entry : entry.name || entry.role || ""),
    user?.role || "buyer",
  ].map((entry) => entry.toLowerCase()).filter(Boolean)));
  const hasCreatorRole = roleNames.includes("creator");
  const hasAffiliateRole = roleNames.includes("affiliate");
  const useSectionedProfileLayout = dashboard || Boolean(user);
  const roleLinks: Array<[string, string, ProfileIcon]> = hasCreatorRole
    ? [
        ["Creator Studio", "/creator", "store" as const],
        ["Manage storefronts", "/creator/storefront", "product" as const],
        ["Payouts", "/creator/payouts", "wallet" as const],
      ]
    : hasAffiliateRole
      ? [
          ["Affiliate Studio", "/affiliate", "dashboard" as const],
          ["Affiliate links", "/affiliate/links", "link" as const],
          ["Commission earnings", "/affiliate/earnings", "dollar" as const],
          ["Payout overview", "/affiliate/payout", "wallet" as const],
        ]
      : [
          ["Purchase history", "/buyer/purchases", "shopping-cart" as const],
          ["Downloads", "/buyer/downloads", "download" as const],
          ["Licenses", "/buyer/licenses", "key" as const],
          ["Reviews", "/buyer/reviews", "message-square-reply" as const],
        ];

  return (
    <main className={dashboard ? "text-[#142b4d]" : "flex min-h-screen flex-col bg-[#f7f9fd] text-[#142b4d]"}>
      {!dashboard && <Navbar active={null} />}
      <div className={dashboard ? "w-full" : "mx-auto w-full max-w-[1180px] flex-1 px-4 pb-12 pt-8 sm:px-6 lg:px-8"}>
        <div className="mb-6">
          <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-primary">Account</p>
          <h1 className="mt-1 text-3xl font-extrabold tracking-tight text-heading">My Profile</h1>
          <p className="mt-2 text-sm text-muted">Manage your identity, account details, and marketplace preferences.</p>
        </div>

        {loading ? (
          <div className="rounded-xl border border-border bg-white p-8 text-sm text-muted shadow-sm">Loading your profile...</div>
        ) : error ? (
          <div className="rounded-xl border border-orange-200 bg-white p-8 shadow-sm">
            <h2 className="text-lg font-bold text-heading">Profile unavailable</h2>
            <p className="mt-2 text-sm text-muted">{error}</p>
            <Link href="/login" className="mt-5 inline-flex rounded-md bg-primary px-4 py-2 text-xs font-bold text-white no-underline hover:bg-primary-hover">Sign in</Link>
          </div>
        ) : (
          useSectionedProfileLayout ? (
            <div className="overflow-hidden border border-border bg-white">
              <section className="grid gap-8 p-6 sm:p-8 lg:grid-cols-[minmax(0,1fr)_minmax(250px,0.34fr)] lg:gap-10">
                <div>
                  <SectionTitle>Profile information</SectionTitle>
                  <div className="mt-6 flex flex-wrap items-center gap-4 border-b border-divider pb-6">
                    <ProfileAvatar url={user?.avatarUrl} name={name} />
                    <div className="min-w-0 flex-1"><h2 className="text-lg font-bold text-heading">{name}</h2><p className="mt-1 text-sm text-muted">{user?.email || "Email not available"}</p><div className="mt-2 flex flex-wrap gap-2">{roleNames.map((roleName) => <span key={roleName} className="inline-flex rounded-full bg-orange-50 px-2.5 py-1 text-[10px] font-bold capitalize text-primary">{roleName}</span>)}</div></div>
                    <Link href="/profile/edit" className="rounded-md border border-primary px-4 py-2 text-xs font-bold text-primary no-underline hover:bg-orange-50">Edit profile</Link>
                  </div>
                  <div className="mt-6 grid gap-x-8 gap-y-5 sm:grid-cols-2">
                    <ProfileField label="Full name" value={name} />
                    <ProfileField label="Username" value={user?.username || "Not available"} />
                    <ProfileField label="Email address" value={user?.email || "Not available"} />
                    <ProfileField label="Phone number" value={user?.phone || "Not added"} />
                    <ProfileField label="Location" value={user?.location || "Not added"} />
                    <ProfileField label="About" value={user?.bio || "Not added"} />
                  </div>
                </div>
                <aside className="border-t border-divider pt-6 lg:border-l lg:border-t-0 lg:pl-8 lg:pt-0">
                  <SectionTitle>Status</SectionTitle>
                  <div className="mt-6 space-y-5">
                    <ProfileField label="Account status" value={user?.status || "Not available"} />
                    <ProfileField label="Email verification" value={user?.emailVerified ? "Verified" : "Not verified"} />
                    {!user?.emailVerified && <Link href="/verify-email" className="text-xs font-semibold text-primary no-underline hover:underline">Verify email address</Link>}
                    <ProfileField label="Member since" value={formatDate(user?.createdAt)} />
                  </div>
                </aside>
              </section>
              <section className="border-t border-divider px-6 py-6 sm:px-8">
                <SectionTitle>Account activity</SectionTitle>
                {statsError && <p role="status" className="mt-3 text-xs text-muted">{statsError}</p>}
                <div className="mt-5 grid gap-5 sm:grid-cols-3">
                  <Stat icon="shopping-cart" label="Purchases" value={stats ? String(stats.purchasedProducts) : "—"} />
                  <Stat icon="download" label="Downloads" value={stats ? String(stats.totalDownloads) : "—"} />
                  <Stat icon="heart-plus" label="Saved products" value={stats ? String(stats.wishlistItems) : "—"} />
                </div>
              </section>
              <section className="grid gap-8 border-t border-divider px-6 py-6 sm:px-8 lg:grid-cols-2">
                <div><PaymentSettings cards={cards} loading={cardsLoading} error={cardsError} /></div>
                <div><SectionTitle>Quick links</SectionTitle><div className="mt-3 space-y-1"><QuickLink href="/buyer/account" icon="settings" label="Account settings" />{roleLinks.map(([label, href, icon]) => <QuickLink key={label} href={href} icon={icon} label={label} />)}<QuickLink href="/marketplace" icon="product" label="Browse marketplace" /></div></div>
              </section>
              <section className="border-t border-divider px-6 py-6 sm:px-8">
                <SectionTitle>Advanced settings</SectionTitle>
                <div className="mt-4 divide-y divide-divider">
                  <SettingLink href="/buyer/account#security" label="Security and password" detail="Password, sessions, and two-step verification" />
                  <SettingLink href="/buyer/account#notifications" label="Notifications" detail="Email and marketplace updates" />
                  <SettingLink href="/legal/privacy-policy" label="Privacy" detail="Read the marketplace privacy policy" />
                  <SettingLink href="/buyer/account#connected-accounts" label="Connected accounts" detail="Google and social sign-in connections" />
                </div>
              </section>
            </div>
          ) : (
          <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_330px]">
            <section className="space-y-5">
              <div className="rounded-xl border border-border bg-white p-5 shadow-sm sm:p-7">
                <div className="flex flex-wrap items-center gap-4 border-b border-divider pb-6">
                  <ProfileAvatar url={user?.avatarUrl} name={name} large />
                  <div className="min-w-0 flex-1">
                    <h2 className="truncate text-xl font-extrabold text-heading">{name}</h2>
                    <p className="mt-1 text-sm text-muted">{user?.email || "Email not available"}</p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {roleNames.map((roleName) => <span key={roleName} className="inline-flex rounded-full bg-orange-50 px-2.5 py-1 text-[10px] font-bold capitalize text-primary">{roleName}</span>)}
                    </div>
                  </div>
                  <Link href="/profile/edit" className="rounded-md border border-primary px-4 py-2 text-xs font-bold text-primary no-underline hover:bg-orange-50">Edit profile</Link>
                </div>
                <div className="mt-6 grid gap-5 sm:grid-cols-2">
                  <Info label="Full name" value={name} />
                  <Info label="Username" value={user?.username || "Not available"} />
                  <Info label="Email address" value={user?.email || "Not available"} />
                  <Info label="Phone number" value={user?.phone || "Not added"} />
                  <Info label="Location" value={user?.location || "Not added"} />
                  <Info label="About" value={user?.bio || "Not added"} />
                </div>
              </div>

              <section className="border-b border-divider py-5 sm:py-7">
                <h2 className="text-base font-bold text-heading">Account activity</h2>
                {statsError && <p role="status" className="mt-3 text-xs text-muted">{statsError}</p>}
                <div className="mt-4 grid gap-3 sm:grid-cols-3">
                  <Stat icon="shopping-cart" label="Purchases" value={stats ? String(stats.purchasedProducts) : "—"} />
                  <Stat icon="download" label="Downloads" value={stats ? String(stats.totalDownloads) : "—"} />
                  <Stat icon="heart-plus" label="Saved products" value={stats ? String(stats.wishlistItems) : "—"} />
                </div>
              </section>
              <PaymentSettings cards={cards} loading={cardsLoading} error={cardsError} />
            </section>

            <aside className="space-y-5">
              <section className="border-b border-divider py-5">
                <h2 className="text-base font-bold text-heading">Account information</h2>
                <div className="mt-4 space-y-4">
                  <Info label="Account roles" value={roleNames.map((roleName) => roleName.charAt(0).toUpperCase() + roleName.slice(1)).join(", ")} />
                  <Info label="Account status" value={user?.status || "Not available"} />
                  <Info label="Member since" value={formatDate(user?.createdAt)} />
                  <Info label="Email verification" value={user?.emailVerified ? "Verified" : "Not verified"} />
                </div>
              </section>
              <section className="border-b border-divider py-5">
                <h2 className="text-base font-bold text-heading">Quick links</h2>
                <div className="mt-3 space-y-1">
                  <QuickLink href="/buyer/account" icon="settings" label="Account settings" />
                  {roleLinks.map(([label, href, icon]) => <QuickLink key={label} href={href} icon={icon} label={label} />)}
                  <QuickLink href="/marketplace" icon="product" label="Browse marketplace" />
                </div>
              </section>
              <section className="border-b border-divider py-5">
                <div className="flex items-center justify-between gap-3">
                  <h2 className="text-base font-bold text-heading">Advanced settings</h2>
                  <PublicIcon name="settings" className="h-4 w-4 text-primary" />
                </div>
                <div className="mt-4 space-y-1">
                  <SettingLink href="/buyer/account#security" label="Security and password" detail="Password, sessions, and two-step verification" />
                  <SettingLink href="/buyer/account#notifications" label="Notifications" detail="Email and marketplace updates" />
                  <SettingLink href="/legal/privacy-policy" label="Privacy" detail="Read the marketplace privacy policy" />
                  <SettingLink href="/buyer/account#connected-accounts" label="Connected accounts" detail="Google and social sign-in connections" />
                </div>
              </section>
            </aside>
          </div>
          )
        )}
      </div>
      {!dashboard && <PublicFooter />}
    </main>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return <div><p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-soft">{label}</p><p className="mt-1 break-words text-sm font-semibold text-heading">{value}</p></div>;
}

function SectionTitle({ children }: { children: ReactNode }) {
  return <h2 className="border-l-2 border-primary pl-3 text-sm font-bold text-heading">{children}</h2>;
}

function ProfileField({ label, value }: { label: string; value: string }) {
  return <div><p className="text-xs text-muted">{label}</p><p className="mt-1 break-words text-sm font-medium text-heading">{value}</p></div>;
}

function Stat({ icon, label, value }: { icon: "shopping-cart" | "download" | "heart-plus"; label: string; value: string }) {
  return <div className="border-l border-divider px-4 py-2 first:border-l-0"><PublicIcon name={icon} className="h-4 w-4 text-primary" /><p className="mt-4 text-xl font-extrabold text-heading">{value}</p><p className="mt-1 text-[10px] text-muted">{label}</p></div>;
}

function PaymentSettings({ cards, loading, error }: {
  cards: SavedPayPalCard[];
  loading: boolean;
  error: string;
}) {
  const [flippedCards, setFlippedCards] = useState<Record<number, boolean>>({});
  const primaryCard = cards.find((card) => card.isDefault);

  return <section className="border-b border-divider py-5 sm:py-7">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div>
        <h2 className="text-base font-bold text-heading">Payment method</h2>
        <p className="mt-1 text-[10px] text-muted">Your default card for marketplace purchases.</p>
      </div>
      <div className="flex items-center gap-3">
        <Link href="/profile/payments" className="text-[10px] font-semibold text-primary no-underline hover:underline">Manage</Link>
        <Link href="/profile/payments/add" title="Add a payment method without placing an order" className="rounded-md border border-primary px-3 py-1.5 text-[10px] font-bold text-primary no-underline hover:bg-orange-50">Add card</Link>
      </div>
    </div>
    {loading ? <p className="mt-4 text-xs text-muted">Loading saved payment methods…</p> : error ? <p role="alert" className="mt-4 text-xs text-status-danger">{error}</p> : primaryCard ? <div className="mt-4">
      <CreditDebitCardCarousel
        items={[primaryCard]}
        activeIndex={0}
        getKey={(card) => card.id}
        desktopCardClassName="max-w-xs"
        showDesktopNavigation={false}
        renderCard={(card) => (
          <div className="mx-auto w-full max-w-xs">
            <PaymentMethodCard
              method="Credit Card"
              cardName="Saved card"
              cardNumber=""
              lastDigits={card.lastDigits}
              cardExpiry={card.expiryMonth && card.expiryYear ? `${String(card.expiryMonth).padStart(2, "0")}/${card.expiryYear}` : undefined}
              cardBrand={card.brand || "Card"}
              isPrimary
              compact
              showControls={false}
              flipped={Boolean(flippedCards[card.id])}
              onFlip={() => setFlippedCards((current) => ({ ...current, [card.id]: !current[card.id] }))}
            />
          </div>
        )}
      />
    </div> : cards.length > 0 ? <p className="mt-4 rounded-lg border border-divider px-3 py-3 text-xs text-muted">No primary card is set. Choose one on the <Link href="/profile/payments" className="font-semibold text-primary no-underline hover:underline">payment methods page</Link>.</p> : <p className="mt-4 rounded-lg border border-divider px-3 py-3 text-xs text-muted">No saved payment methods. Add one securely with PayPal whenever you are ready.</p>}
    <p className="mt-3 text-[9px] text-muted">Only masked card details are shown. PayPal stores and processes the card information.</p>
  </section>;
}

type ProfileIcon = "settings" | "shopping-cart" | "product" | "store" | "download" | "key" | "message-square-reply" | "dashboard" | "link" | "dollar" | "wallet";

function QuickLink({ href, icon, label }: { href: string; icon: ProfileIcon; label: string }) {
  return <Link href={href} className="flex items-center gap-3 rounded-md px-2 py-2.5 text-xs font-semibold text-body no-underline hover:bg-accent-light hover:text-primary"><PublicIcon name={icon} className="h-4 w-4 text-primary" />{label}<PublicIcon name="right" className="ml-auto h-3.5 w-3.5 text-current" /></Link>;
}

function SettingLink({ href, label, detail }: { href: string; label: string; detail: string }) {
  return <Link href={href} className="flex w-full items-center gap-3 rounded-md px-2 py-2.5 text-left no-underline hover:bg-accent-light"><span className="min-w-0 flex-1"><span className="block text-xs font-semibold text-body">{label}</span><span className="mt-0.5 block text-[9px] leading-4 text-muted">{detail}</span></span><PublicIcon name="right" className="h-3.5 w-3.5 shrink-0 text-primary" /></Link>;
}
