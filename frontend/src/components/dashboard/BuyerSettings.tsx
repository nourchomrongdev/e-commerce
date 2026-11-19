"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import PublicIcon from "@/components/icons/PublicIcon";

type BuyerSettingsData = {
  emailNotifications: boolean;
  productUpdateNotifications: boolean;
  marketingNotifications: boolean;
};

type BuyerAccount = {
  name?: string;
  username?: string;
  email?: string;
  roles?: string[];
  role?: string;
  connectedAccounts?: Array<{ provider: string; email: string | null }>;
};
const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:5000/api";

const preferenceFields: Array<{ key: keyof BuyerSettingsData; title: string; description: string }> = [
  { key: "emailNotifications", title: "Account and payment emails", description: "Receive important account, order, and payment updates." },
  { key: "productUpdateNotifications", title: "Product updates", description: "Be notified when products you own receive updates." },
  { key: "marketingNotifications", title: "Marketplace news", description: "Receive product recommendations and marketplace announcements." },
];

export default function BuyerSettings() {
  const [account, setAccount] = useState<BuyerAccount | null>(null);
  const [preferences, setPreferences] = useState<BuyerSettingsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    const load = async () => {
      try {
        const token = window.localStorage.getItem("marketplace-token") || "";
        const headers = { Authorization: `Bearer ${token}` };
        const [accountResponse, settingsResponse] = await Promise.all([
          fetch(`${apiUrl}/auth/me`, { headers, cache: "no-store", signal: controller.signal }),
          fetch(`${apiUrl}/buyer/settings`, { headers, cache: "no-store", signal: controller.signal }),
        ]);
        const [accountData, settingsData] = await Promise.all([accountResponse.json(), settingsResponse.json()]);
        if (!accountResponse.ok) throw new Error(accountData.error || "Unable to load your account details.");
        if (!settingsResponse.ok) throw new Error(settingsData.error || "Unable to load your preferences.");
        setAccount(accountData.user);
        setPreferences(settingsData.preferences);
      } catch (requestError) {
        if (!controller.signal.aborted) setError(requestError instanceof Error ? requestError.message : "Unable to load settings.");
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    };
    void load();
    return () => controller.abort();
  }, []);

  const savePreferences = async () => {
    if (!preferences) return;
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const token = window.localStorage.getItem("marketplace-token") || "";
      const response = await fetch(`${apiUrl}/buyer/settings`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify(preferences),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Unable to save notification preferences.");
      setPreferences(data.preferences);
      setNotice("Your notification preferences have been saved.");
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Unable to save notification preferences.");
    } finally {
      setSaving(false);
    }
  };

  const displayName = account?.name || account?.username?.replace(/_\d{6}$/, "").replace(/_/g, " ") || "Marketplace customer";
  const roles = Array.from(new Set([...(account?.roles ?? []), ...(account?.role ? [account.role] : [])]));

  return (
    <div className="mx-auto w-full max-w-[1400px]">
      <header className="mb-5">
        <h1 className="text-2xl font-bold tracking-tight text-heading sm:text-[28px]">Settings</h1>
        <p className="mt-1 text-sm text-muted">Manage your profile, security, and marketplace notifications.</p>
      </header>
      {error && <p role="alert" className="mb-4 rounded-lg border border-red-100 bg-red-50 px-4 py-3 text-xs text-status-danger">{error}</p>}
      {notice && <p role="status" className="mb-4 rounded-lg border border-emerald-100 bg-emerald-50 px-4 py-3 text-xs text-status-success">{notice}</p>}

      <div className="space-y-5">
        <section className="overflow-hidden rounded-xl border border-divider bg-white shadow-sm">
          <div className="border-b border-divider px-5 py-4"><h2 className="text-sm font-bold text-heading">Personal information</h2><p className="mt-1 text-[11px] text-muted">Your verified marketplace account details.</p></div>
          {loading ? <div className="grid gap-4 p-5 sm:grid-cols-2"><div className="h-10 animate-pulse rounded bg-slate-100" /><div className="h-10 animate-pulse rounded bg-slate-100" /></div> : <div className="grid gap-5 p-5 sm:grid-cols-2">
            <div><p className="text-[10px] font-semibold uppercase tracking-wide text-muted-soft">Name</p><p className="mt-1 text-sm font-medium text-heading">{displayName}</p></div>
            <div><p className="text-[10px] font-semibold uppercase tracking-wide text-muted-soft">Email</p><p className="mt-1 break-all text-sm font-medium text-heading">{account?.email || "Unavailable"}</p></div>
            <div><p className="text-[10px] font-semibold uppercase tracking-wide text-muted-soft">Authorized roles</p><div className="mt-2 flex flex-wrap gap-2">{roles.map((role) => <span key={role} className="rounded-full bg-orange-50 px-2.5 py-1 text-[10px] font-semibold capitalize text-primary">{role}</span>)}</div></div>
            <div className="flex items-end"><Link href="/profile" className="inline-flex items-center gap-2 rounded-lg border border-border-control px-3 py-2 text-xs font-semibold text-body no-underline hover:border-primary hover:text-primary"><PublicIcon name="user" className="h-4 w-4" />Open profile</Link></div>
          </div>}
        </section>

        <section id="connected-accounts" className="overflow-hidden rounded-xl border border-divider bg-white shadow-sm">
          <div className="border-b border-divider px-5 py-4"><h2 className="text-sm font-bold text-heading">Connected accounts</h2><p className="mt-1 text-[11px] text-muted">Social sign-in accounts linked to your marketplace login.</p></div>
          {loading ? <div className="space-y-3 p-5"><div className="h-8 animate-pulse rounded bg-slate-100" /></div> : account?.connectedAccounts?.length ? <div className="divide-y divide-divider">{account.connectedAccounts.map((connectedAccount) => <div key={`${connectedAccount.provider}-${connectedAccount.email || ""}`} className="flex items-center justify-between gap-4 px-5 py-4"><div><p className="text-xs font-semibold capitalize text-body">{connectedAccount.provider}</p><p className="mt-1 text-[10px] text-muted">{connectedAccount.email || "Email not shared"}</p></div><span className="rounded-full bg-emerald-50 px-2.5 py-1 text-[9px] font-semibold text-emerald-700">Connected</span></div>)}</div> : <p className="px-5 py-4 text-xs text-muted">No social sign-in accounts are connected.</p>}
        </section>

        <section id="security" className="overflow-hidden rounded-xl border border-divider bg-white shadow-sm">
          <div className="flex items-start gap-3 border-b border-divider px-5 py-4"><span className="mt-0.5 text-primary"><PublicIcon name="lock" className="h-4 w-4" /></span><div><h2 className="text-sm font-bold text-heading">Security</h2><p className="mt-1 text-[11px] text-muted">Manage your password and account access.</p></div></div>
          <div className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:justify-between"><p className="text-xs text-body">Reset your password using the email verification flow.</p><Link href="/forgot-password" className="inline-flex w-fit rounded-lg border border-border-control px-3 py-2 text-xs font-semibold text-body no-underline hover:border-primary hover:text-primary">Reset password</Link></div>
        </section>

        <section id="notifications" className="overflow-hidden rounded-xl border border-divider bg-white shadow-sm">
          <div className="border-b border-divider px-5 py-4"><h2 className="text-sm font-bold text-heading">Notification preferences</h2><p className="mt-1 text-[11px] text-muted">Choose which marketplace emails you receive.</p></div>
          {loading || !preferences ? <div className="space-y-3 p-5"><div className="h-12 animate-pulse rounded bg-slate-100" /><div className="h-12 animate-pulse rounded bg-slate-100" /></div> : <>
            <div className="divide-y divide-divider">
              {preferenceFields.map(({ key, title, description }) => <label key={key} className="flex cursor-pointer items-start justify-between gap-4 px-5 py-4 hover:bg-slate-50"><span><span className="block text-xs font-semibold text-body">{title}</span><span className="mt-1 block text-[10px] text-muted">{description}</span></span><input type="checkbox" checked={preferences[key]} onChange={(event) => setPreferences((current) => current ? { ...current, [key]: event.target.checked } : current)} className="mt-0.5 h-4 w-4 accent-[#f97316] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary" /></label>)}
            </div>
            <div className="flex justify-end border-t border-divider px-5 py-4"><button type="button" disabled={saving} onClick={() => void savePreferences()} className="rounded-lg bg-primary px-4 py-2.5 text-xs font-semibold text-white hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-50">{saving ? "Saving…" : "Save preferences"}</button></div>
          </>}
        </section>
      </div>
    </div>
  );
}
