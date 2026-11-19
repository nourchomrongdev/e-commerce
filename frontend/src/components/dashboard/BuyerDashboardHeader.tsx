"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import AppBrand, { APP_NAME } from "@/components/AppBrand";
import PublicIcon from "@/components/icons/PublicIcon";
import UserAvatar from "@/components/UserAvatar";
import { NotificationBell, NotificationMenuLink } from "@/components/notifications/NotificationHub";
import type { PublicIconProps } from "@/components/icons/PublicIcon";
import { routes } from "@/lib/routeController";
import { clearSessionData } from "@/lib/session";
import { subscribeToBuyerDownloads, type BuyerDownloadEntry } from "@/lib/buyerDownloads";
import { PROFILE_UPDATED_EVENT, type ProfileUpdatedUser } from "@/lib/profileEvents";

type BuyerHeaderUser = {
  id?: number;
  name?: string;
  username?: string;
  email?: string;
  role?: string;
  roles?: string[];
  avatarUrl?: string | null;
  isVerified?: boolean;
  creatorAccountApprovalStatus?: string;
  hasApplied?: boolean;
};

type Workspace = { label: string; href: string; icon: PublicIconProps["name"]; active: boolean };

const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:5000/api";

function maskEmail(email: string) {
  const [local, domain] = email.split("@");
  if (!local || !domain) return "Email unavailable";
  return `${local.slice(0, 1)}${"*".repeat(Math.max(3, local.length - 1))}@${domain}`;
}

function formatDownloadBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  const unitIndex = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)) - 1, units.length - 1);
  return `${(bytes / 1024 ** (unitIndex + 1)).toFixed(1)} ${units[unitIndex]}`;
}

export default function BuyerDashboardHeader({ onMenuOpen }: { onMenuOpen: () => void }) {
  const pathname = usePathname();
  const router = useRouter();
  const accountRef = useRef<HTMLDivElement>(null);
  const accountButtonRef = useRef<HTMLButtonElement>(null);
  const downloadsRef = useRef<HTMLDivElement>(null);
  const downloadsButtonRef = useRef<HTMLButtonElement>(null);
  const [accountOpen, setAccountOpen] = useState(false);
  const [downloadsOpen, setDownloadsOpen] = useState(false);
  const [downloads, setDownloads] = useState<BuyerDownloadEntry[]>([]);
  const [user, setUser] = useState<BuyerHeaderUser | null>(null);
  const [accountError, setAccountError] = useState("Sign in to view account details.");
  const [search, setSearch] = useState("");
  const name = user?.name || user?.username?.replace(/_\d{6}$/, "").replace(/_/g, " ") || "Customer";
  const roles = new Set((user?.roles ?? []).map((role) => role.toLowerCase()));
  if (user?.role) roles.add(user.role.toLowerCase());
  const hasCreatorAccess = roles.has("creator") && user?.creatorAccountApprovalStatus === "approved";
  const workspaces: Workspace[] = [
    { label: "Customer Workspace", href: routes.buyer.dashboard(), icon: "user-round", active: pathname.startsWith("/buyer") },
    ...(hasCreatorAccess ? [{ label: "Creator Studio", href: routes.creator.overview(), icon: "store" as const, active: pathname.startsWith("/creator") }] : []),
    ...(roles.has("affiliate") ? [{ label: "Affiliate Studio", href: routes.affiliate.dashboard(), icon: "dashboard" as const, active: pathname.startsWith("/affiliate") }] : []),
    ...(roles.has("reviewer") || roles.has("content reviewer") ? [{ label: "Reviewer Workspace", href: routes.reviewer.dashboard(), icon: "product" as const, active: pathname.startsWith("/reviewer") }] : []),
  ];

  useEffect(() => {
    const token = window.localStorage.getItem("marketplace-token");
    if (!token) return;
    const controller = new AbortController();
    fetch(`${apiUrl}/auth/me`, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Unable to load account details.");
        setUser(data.user as BuyerHeaderUser);
        setAccountError("");
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setAccountError(error instanceof Error ? error.message : "Unable to load account details.");
      });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    const updateProfile = (event: Event) => {
      const profile = (event as CustomEvent<ProfileUpdatedUser>).detail;
      if (!profile) return;
      setUser((current) => current ? { ...current, ...profile } : {
        name: profile.fullName || profile.name,
        username: profile.username,
        avatarUrl: profile.avatarUrl,
      });
    };
    window.addEventListener(PROFILE_UPDATED_EVENT, updateProfile);
    return () => window.removeEventListener(PROFILE_UPDATED_EVENT, updateProfile);
  }, []);

  useEffect(() => subscribeToBuyerDownloads(setDownloads), []);

  useEffect(() => {
    if (!downloadsOpen) return;
    const closeOnOutsideClick = (event: PointerEvent) => {
      if (event.target instanceof Node && !downloadsRef.current?.contains(event.target)) setDownloadsOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setDownloadsOpen(false);
        downloadsButtonRef.current?.focus();
      }
    };
    document.addEventListener("pointerdown", closeOnOutsideClick);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsideClick);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [downloadsOpen]);

  const activeDownloads = downloads.filter((item) => item.status === "downloading").length;
  const recentDownloads = downloads.slice(0, 5);
  const activeDownload = downloads.find((item) => item.status === "downloading");
  const activeDownloadPercent = activeDownload?.totalBytes
    ? Math.min(100, Math.floor(activeDownload.loadedBytes / activeDownload.totalBytes * 100))
    : null;

  useEffect(() => {
    if (!accountOpen) return;
    const closeOnOutsideClick = (event: PointerEvent) => {
      if (event.target instanceof Node && !accountRef.current?.contains(event.target)) setAccountOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setAccountOpen(false);
        accountButtonRef.current?.focus();
      }
    };
    document.addEventListener("pointerdown", closeOnOutsideClick);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsideClick);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [accountOpen]);

  const signOut = async () => {
    await clearSessionData();
    setAccountOpen(false);
    window.location.replace(routes.auth.login());
  };

  return (
    <header className="sticky top-0 z-50 border-b border-[#eaebf5] bg-[#fbfbff]/95 px-3 backdrop-blur sm:px-6">
      <div className="flex h-20 w-full items-center gap-3">
        <button type="button" onClick={onMenuOpen} aria-label="Toggle buyer navigation" className="grid h-10 w-10 shrink-0 place-items-center rounded-lg text-heading hover:bg-accent-light min-[901px]:hidden"><PublicIcon name="menu" className="h-5 w-5" /></button>
        <Link href={routes.home()} className="flex min-w-0 items-center no-underline"><AppBrand name={APP_NAME} textClassName="text-base sm:text-xl" logoClassName="h-8 w-8" /></Link>
        <form onSubmit={(event) => { event.preventDefault(); const term = search.trim(); router.push(term ? `/marketplace?search=${encodeURIComponent(term)}` : routes.marketplace()); }} className="relative ml-auto hidden sm:block">
          <label><span className="sr-only">Search marketplace</span><PublicIcon name="search" className="absolute left-3 top-2.5 h-4 w-4 text-muted-soft" /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search products..." className="h-10 w-64 rounded-lg border border-border-control bg-white pl-9 pr-16 text-xs outline-none placeholder:text-muted-soft focus:border-primary focus:ring-2 focus:ring-primary/15" /></label>
          <button type="submit" className="absolute right-2 top-1.5 rounded-md bg-primary px-2.5 py-1.5 text-[10px] font-semibold text-white hover:bg-primary-hover">Search</button>
        </form>
        <div ref={downloadsRef} className="relative">
          <button
            ref={downloadsButtonRef}
            type="button"
            onClick={() => setDownloadsOpen((value) => !value)}
            aria-label={`Downloads${activeDownloads ? `, ${activeDownloads} active` : ""}`}
            aria-expanded={downloadsOpen}
            aria-controls="buyer-downloads-menu"
            className="relative grid h-10 w-10 place-items-center rounded-lg text-body transition hover:bg-accent-light focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
          >
            {activeDownload && <svg viewBox="0 0 40 40" className="absolute inset-0 h-10 w-10 -rotate-90 text-primary" aria-hidden="true">
              <circle cx="20" cy="20" r="17" fill="none" stroke="#e5e7eb" strokeWidth="2" />
              <circle
                cx="20"
                cy="20"
                r="17"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeDasharray={activeDownloadPercent === null ? "28 79" : `${(activeDownloadPercent / 100) * 106.8} 106.8`}
                className={activeDownloadPercent === null ? "animate-spin" : "transition-[stroke-dasharray] duration-200"}
              />
            </svg>}
            <PublicIcon name="download" className={`relative h-5 w-5 ${activeDownload ? "animate-pulse text-primary" : ""}`} />
            {activeDownloads > 0 && <span className="absolute -right-0.5 -top-0.5 grid h-[18px] min-w-[18px] place-items-center rounded-full bg-primary px-1 text-[9px] font-bold text-white">{activeDownloads}</span>}
          </button>
          {downloadsOpen && <div id="buyer-downloads-menu" className="menu-popover-enter absolute right-0 top-full z-50 mt-2 w-[min(22rem,calc(100vw-1.5rem))] overflow-hidden rounded-xl border border-[#e7e9f2] bg-white shadow-xl" aria-label="Download activity">
            <div className="flex items-center justify-between border-b border-divider px-4 py-3">
              <div><h2 className="text-xs font-bold text-heading">Downloads</h2><p className="mt-0.5 text-[10px] text-muted">{activeDownloads ? `${activeDownloads} active` : "Recent activity"}</p></div>
              <PublicIcon name="download" className="h-4 w-4 text-primary" />
            </div>
            {downloads.length === 0 ? <p className="px-4 py-8 text-center text-xs text-muted">Your downloads will appear here.</p> : <ul className="max-h-[min(65vh,24rem)] divide-y divide-divider overflow-y-auto">
              {recentDownloads.map((item) => {
                const percent = item.totalBytes && item.totalBytes > 0 ? Math.min(100, Math.floor(item.loadedBytes / item.totalBytes * 100)) : null;
                const remainingSeconds = item.totalBytes && item.speedBytesPerSecond > 0 ? Math.ceil((item.totalBytes - item.loadedBytes) / item.speedBytesPerSecond) : null;
                return <li key={item.id} className="px-4 py-3">
                  <div className="flex items-start gap-3">
                    <span className={`mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-lg ${item.status === "failed" ? "bg-red-50 text-status-danger" : item.status === "complete" ? "bg-emerald-50 text-emerald-700" : "bg-orange-50 text-primary"}`}>
                      <PublicIcon name={item.status === "complete" ? "check" : item.status === "failed" ? "x" : "download"} className="h-4 w-4" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[11px] font-semibold text-heading" title={item.fileName}>{item.fileName}</p>
                      <p className="mt-1 text-[10px] text-muted">
                        {item.status === "failed" ? item.error || "Download failed" : item.status === "complete" ? `Completed · ${formatDownloadBytes(item.loadedBytes)}` : `${percent === null ? "Receiving ZIP" : `${percent}%`} · ${formatDownloadBytes(item.loadedBytes)}${item.totalBytes ? ` of ${formatDownloadBytes(item.totalBytes)}` : ""}`}
                      </p>
                      {item.status === "downloading" && item.speedBytesPerSecond > 0 && <p className="mt-0.5 text-[10px] text-muted">{formatDownloadBytes(item.speedBytesPerSecond)}/s{remainingSeconds !== null ? ` · about ${remainingSeconds}s left` : ""}</p>}
                      {item.status === "downloading" && <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-100" role="progressbar" aria-label={`Downloading ${item.fileName}`} aria-valuenow={percent ?? undefined} aria-valuemin={0} aria-valuemax={100}>
                        {percent === null ? <div className="h-full w-1/3 animate-pulse rounded-full bg-primary" /> : <div className="h-full rounded-full bg-primary transition-[width] duration-200" style={{ width: `${percent}%` }} />}
                      </div>}
                    </div>
                  </div>
                </li>;
              })}
            </ul>}
            <div className="border-t border-divider px-4 py-2.5">
              <Link href={routes.buyer.downloadActivity()} onClick={() => setDownloadsOpen(false)} className="flex items-center justify-between text-[11px] font-semibold text-primary no-underline hover:text-primary-hover">
                <span>Show all downloads</span><span>{downloads.length}</span>
              </Link>
            </div>
          </div>}
        </div>
        <NotificationBell className="shrink-0" />
        <div ref={accountRef} className="relative">
          <button ref={accountButtonRef} type="button" onClick={() => setAccountOpen((value) => !value)} aria-expanded={accountOpen} aria-controls="buyer-account-menu" aria-label="Open account menu" className="flex items-center gap-2 rounded-lg p-1 text-left transition hover:bg-accent-light focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary">
            <UserAvatar url={user?.avatarUrl} name={name} className="h-9 w-9 text-xs" />
            <span className="hidden text-left sm:block"><strong className="block max-w-36 truncate text-[11px] text-heading">{name}</strong><small className="block text-[9px] text-muted">Customer</small></span>
            <PublicIcon name="down" className={`hidden h-4 w-4 shrink-0 text-[#69738f] transition-transform sm:block ${accountOpen ? "rotate-180" : ""}`} />
          </button>
          {accountOpen && <div id="buyer-account-menu" className="menu-popover-enter absolute right-0 top-full z-50 mt-2 max-h-[min(80vh,36rem)] w-[min(19rem,calc(100vw-1.5rem))] overflow-y-auto rounded-xl border border-[#e7e9f2] bg-white py-2 shadow-xl">
            <div className="border-b border-divider px-4 py-3">
              <div className="flex items-center gap-3">
                <UserAvatar url={user?.avatarUrl} name={name} className="h-10 w-10 text-sm" />
                <div className="min-w-0"><p className="truncate text-xs font-semibold text-heading">{name}</p><p className="mt-1 truncate text-[10px] text-muted">{user?.email ? maskEmail(user.email) : accountError || "Loading account…"}</p></div>
              </div>
              <p className="mt-3 text-[10px] text-muted">Active role: <span className="font-semibold text-heading">Customer</span></p>
            </div>
            <div className="px-2 py-2">
              <Link href="/profile" onClick={() => setAccountOpen(false)} className="flex items-center gap-3 rounded-lg px-3 py-2.5 text-xs text-body no-underline transition hover:bg-accent-light hover:text-primary focus-visible:outline-2 focus-visible:outline-primary"><PublicIcon name="user" className="h-4 w-4 text-primary" />My Profile</Link>
              <NotificationMenuLink onClick={() => setAccountOpen(false)} />
            </div>
            <div className="border-t border-divider px-4 pb-1 pt-3"><p className="text-[9px] font-bold uppercase tracking-[0.12em] text-muted-soft">Workspaces</p></div>
            <div className="px-2 pb-2">
              {workspaces.map((workspace) => <Link key={workspace.label} href={workspace.href} onClick={() => setAccountOpen(false)} aria-current={workspace.active ? "page" : undefined} className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-xs no-underline transition focus-visible:outline-2 focus-visible:outline-primary ${workspace.active ? "bg-orange-50 font-semibold text-primary" : "text-body hover:bg-accent-light hover:text-primary"}`}><PublicIcon name={workspace.icon} className="h-4 w-4" />{workspace.label}{workspace.active && <span className="ml-auto text-[9px]">Current</span>}</Link>)}
              {!hasCreatorAccess && <Link href={routes.programs.creatorProgram()} onClick={() => setAccountOpen(false)} className="flex items-center gap-3 rounded-lg px-3 py-2.5 text-xs text-body no-underline transition hover:bg-accent-light hover:text-primary focus-visible:outline-2 focus-visible:outline-primary"><PublicIcon name="store" className="h-4 w-4 text-primary" />{user?.hasApplied ? "Creator application status" : "Apply to Creator Program"}</Link>}
            </div>
            <div className="border-t border-divider px-2 pt-2">
              <button type="button" onClick={() => void signOut()} className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-xs text-status-danger transition hover:bg-red-50 focus-visible:outline-2 focus-visible:outline-status-danger"><PublicIcon name="arrow-left" className="h-4 w-4" />Log out</button>
            </div>
          </div>}
        </div>
      </div>
    </header>
  );
}
