"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import PublicIcon from "@/components/icons/PublicIcon";
import { showForegroundNotification } from "@/lib/browserNotifications";
import { BrowserNotificationPreferences } from "./BrowserNotificationPreferences";

const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:5000/api";

type MarketplaceNotification = {
  id: string;
  type: string;
  title: string;
  message: string;
  relatedEntityType: string | null;
  relatedEntityId: string | null;
  href: string | null;
  isRead: boolean;
  readAt: string | null;
  createdAt: string;
};

function notificationHref(value: string | null) {
  if (!value || !value.startsWith("/")) return null;
  try {
    return new URL(value, "https://marketplace.invalid").origin === "https://marketplace.invalid" ? value : null;
  } catch {
    return null;
  }
}

function timeAgo(value: string) {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return "Just now";
  const seconds = Math.round((timestamp - Date.now()) / 1000);
  const formatter = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
  if (Math.abs(seconds) < 60) return formatter.format(seconds, "second");
  if (Math.abs(seconds) < 3600) return formatter.format(Math.round(seconds / 60), "minute");
  if (Math.abs(seconds) < 86400) return formatter.format(Math.round(seconds / 3600), "hour");
  return formatter.format(Math.round(seconds / 86400), "day");
}

function publishUnreadCount(count: number) {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("marketplace-notification-count-updated", { detail: count }));
  }
}

function useNotifications(limit: number, status = "all", search = "") {
  const [token] = useState(() => typeof window === "undefined" ? "" : window.localStorage.getItem("marketplace-token") || "");
  const [items, setItems] = useState<MarketplaceNotification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [totalCount, setTotalCount] = useState(0);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const cursorRef = useRef<string | null>(null);
  const knownNotificationIds = useRef(new Set<string>());
  const hasLoadedNotifications = useRef(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    if (token) return;
    const timer = window.setTimeout(() => setLoading(false), 0);
    return () => window.clearTimeout(timer);
  }, [token]);

  const load = useCallback(async (append = false) => {
    if (!token) return;
    setLoading(!append);
    try {
      const params = new URLSearchParams({ limit: String(limit) });
      if (append && cursorRef.current) params.set("beforeId", cursorRef.current);
      if (status !== "all") params.set("status", status);
      if (search) params.set("search", search);
      const headers = { Authorization: `Bearer ${token}` };
      const [listResponse, countResponse] = await Promise.all([
        fetch(`${apiUrl}/notifications?${params}`, { headers, cache: "no-store" }),
        fetch(`${apiUrl}/notifications/unread-count`, { headers, cache: "no-store" }),
      ]);
      const [listPayload, countPayload] = await Promise.all([listResponse.json(), countResponse.json()]);
      if (!listResponse.ok) throw new Error(listPayload.error || "Unable to load notifications.");
      if (!countResponse.ok) throw new Error(countPayload.error || "Unable to load unread notifications.");
      const pageItems = Array.isArray(listPayload.notifications) ? listPayload.notifications as MarketplaceNotification[] : [];
      if (!append && hasLoadedNotifications.current) {
        for (const notification of pageItems) {
          if (!knownNotificationIds.current.has(notification.id)) showForegroundNotification(notification);
        }
      }
      for (const notification of pageItems) knownNotificationIds.current.add(notification.id);
      hasLoadedNotifications.current = true;
      setItems((current) => append ? [...current, ...pageItems] : pageItems);
      cursorRef.current = listPayload.nextCursor || null;
      setNextCursor(cursorRef.current);
      setUnreadCount(Number(countPayload.count) || 0);
      setTotalCount(Number(listPayload.total) || 0);
      publishUnreadCount(Number(countPayload.count) || 0);
      setError("");
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Unable to load notifications.");
    } finally {
      setLoading(false);
    }
  }, [limit, search, status, token]);

  useEffect(() => {
    if (!token) return;
    const initialLoad = window.setTimeout(() => void load(), 0);
    const interval = window.setInterval(() => void load(), 30000);
    return () => {
      window.clearTimeout(initialLoad);
      window.clearInterval(interval);
    };
  }, [load, token]);

  const markRead = useCallback(async (id: string) => {
    const item = items.find((notification) => notification.id === id);
    if (!item || item.isRead) return true;
    try {
      const response = await fetch(`${apiUrl}/notifications/${encodeURIComponent(id)}/read`, {
        method: "PATCH",
        headers: { Authorization: `Bearer ${token}` },
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Unable to mark this notification as read.");
      setItems((current) => current.map((notification) => notification.id === id ? { ...notification, isRead: true } : notification));
      setUnreadCount((current) => {
        const next = Math.max(0, current - 1);
        publishUnreadCount(next);
        return next;
      });
      if (status === "unread") {
        setItems((current) => current.filter((notification) => notification.id !== id));
        setTotalCount((current) => Math.max(0, current - 1));
      }
      return true;
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "Unable to mark this notification as read.");
      return false;
    }
  }, [items, status, token]);

  const markAllRead = useCallback(async () => {
    try {
      const response = await fetch(`${apiUrl}/notifications/read-all`, {
        method: "PATCH",
        headers: { Authorization: `Bearer ${token}` },
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Unable to mark notifications as read.");
      setItems((current) => current.map((notification) => ({ ...notification, isRead: true })));
      setUnreadCount(0);
      publishUnreadCount(0);
      if (status === "unread") {
        setItems([]);
        setTotalCount(0);
      } else if (status === "read") {
        await load();
      }
      setError("");
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "Unable to mark notifications as read.");
    }
  }, [load, status, token]);

  const dismiss = useCallback(async (id: string) => {
    const item = items.find((notification) => notification.id === id);
    try {
      const response = await fetch(`${apiUrl}/notifications/${encodeURIComponent(id)}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Unable to dismiss this notification.");
      setItems((current) => current.filter((notification) => notification.id !== id));
      setTotalCount((current) => Math.max(0, current - 1));
      if (item && !item.isRead) setUnreadCount((current) => {
        const next = Math.max(0, current - 1);
        publishUnreadCount(next);
        return next;
      });
      setError("");
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "Unable to dismiss this notification.");
    }
  }, [items, token]);

  const dismissAll = useCallback(async () => {
    if (!token) return false;
    try {
      const response = await fetch(`${apiUrl}/notifications`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Unable to delete notifications.");
      setItems([]);
      setTotalCount(0);
      setUnreadCount(0);
      publishUnreadCount(0);
      setNextCursor(null);
      cursorRef.current = null;
      setError("");
      return true;
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "Unable to delete notifications.");
      return false;
    }
  }, [token]);

  return { items, unreadCount, totalCount, nextCursor, loading, error, load, markRead, markAllRead, dismiss, dismissAll };
}

function NotificationList({
  items,
  onOpen,
  onDismiss,
}: {
  items: MarketplaceNotification[];
  onOpen: (item: MarketplaceNotification) => void;
  onDismiss: (id: string) => void;
}) {
  if (!items.length) return <p className="px-4 py-8 text-center text-xs text-muted">You&apos;re all caught up.</p>;
  return (
    <ul className="divide-y divide-divider">
      {items.map((item) => {
        const href = notificationHref(item.href);
        const content = (
          <>
            <span className={`mt-1 h-2 w-2 shrink-0 rounded-full ${item.isRead ? "bg-transparent" : "bg-primary"}`} aria-label={item.isRead ? "Read" : "Unread"} />
            <span className="min-w-0 flex-1">
              <span className={`block text-xs ${item.isRead ? "font-medium text-body" : "font-bold text-heading"}`}>{item.title}</span>
              <span className="mt-1 block text-[11px] leading-4 text-muted">{item.message}</span>
              <time dateTime={item.createdAt} className="mt-1.5 block text-[10px] text-muted-faint">{timeAgo(item.createdAt)}</time>
            </span>
          </>
        );
        return (
          <li key={item.id} className={`flex items-start gap-2 px-4 py-3 ${item.isRead ? "bg-white" : "bg-orange-50/60"}`}>
            {href ? (
              <Link href={href} onClick={(event) => { event.preventDefault(); onOpen(item); }} className="flex min-w-0 flex-1 items-start gap-2 no-underline">
                {content}
              </Link>
            ) : (
              <button type="button" onClick={() => onOpen(item)} className="flex min-w-0 flex-1 items-start gap-2 text-left">
                {content}
              </button>
            )}
            <button type="button" onClick={() => onDismiss(item.id)} aria-label={`Delete ${item.title}`} className="shrink-0 rounded p-1 text-muted hover:bg-surface-control hover:text-body">
              <PublicIcon name="x" className="h-3.5 w-3.5" />
            </button>
          </li>
        );
      })}
    </ul>
  );
}

export function NotificationBell({ className = "" }: { className?: string }) {
  const router = useRouter();
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const { items, unreadCount, loading, error, load, markRead, markAllRead, dismiss } = useNotifications(5);

  useEffect(() => {
    if (!open) return;
    void load();
    const closeOnOutsideClick = (event: PointerEvent) => {
      if (event.target instanceof Node && !rootRef.current?.contains(event.target)) setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        buttonRef.current?.focus();
      }
    };
    document.addEventListener("pointerdown", closeOnOutsideClick);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsideClick);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [load, open]);

  const openNotification = async (item: MarketplaceNotification) => {
    const marked = await markRead(item.id);
    if (!marked) return;
    setOpen(false);
    const href = notificationHref(item.href);
    if (href) router.push(href);
  };

  return (
    <div ref={rootRef} className={`relative ${className}`}>
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen((current) => !current)}
        aria-expanded={open}
        aria-controls="marketplace-notification-menu"
        aria-label={`Notifications${unreadCount ? `, ${unreadCount} unread` : ""}`}
        className="relative grid h-9 w-9 shrink-0 place-items-center rounded-full text-primary hover:bg-accent-light"
      >
        <PublicIcon name="notification" className="h-5 w-5 text-primary" />
        {unreadCount > 0 && (
          <span className="absolute -right-1 -top-1 grid h-4 min-w-4 place-items-center rounded-full bg-primary px-1 text-[9px] font-semibold text-white">
            {unreadCount > 99 ? "99+" : unreadCount}
          </span>
        )}
      </button>
      {open && (
        <section id="marketplace-notification-menu" className="menu-popover-enter absolute right-0 top-full z-[90] mt-2 w-[min(24rem,calc(100vw-1.5rem))] overflow-hidden rounded-xl border border-border bg-white shadow-xl" aria-label="Notifications">
          <header className="flex items-center justify-between border-b border-divider px-4 py-3">
            <div>
              <h2 className="text-xs font-bold text-heading">Notifications</h2>
              <p className="mt-0.5 text-[10px] text-muted">{unreadCount ? `${unreadCount} unread` : "No unread notifications"}</p>
            </div>
            <button type="button" onClick={() => void markAllRead()} disabled={!unreadCount} className="text-[10px] font-semibold text-primary disabled:text-muted-faint">Mark all read</button>
          </header>
          {error && <p role="alert" className="px-4 py-2 text-[10px] text-status-danger">{error}</p>}
          {loading && !items.length ? <p className="px-4 py-8 text-center text-xs text-muted">Loading notifications...</p> : (
            <div className="max-h-[min(28rem,70vh)] overflow-y-auto">
              <NotificationList items={items} onOpen={(item) => void openNotification(item)} onDismiss={(id) => void dismiss(id)} />
            </div>
          )}
          <footer className="border-t border-divider px-4 py-3 text-center">
            <Link href="/notifications" onClick={() => setOpen(false)} className="text-[11px] font-semibold text-primary no-underline hover:underline">View all notifications</Link>
          </footer>
        </section>
      )}
    </div>
  );
}

export function NotificationMenuLink({ className = "", onClick }: { className?: string; onClick?: () => void }) {
  const [token] = useState(() => typeof window === "undefined" ? "" : window.localStorage.getItem("marketplace-token") || "");
  const [unreadCount, setUnreadCount] = useState(0);

  useEffect(() => {
    if (!token) return;
    let active = true;
    const loadCount = async () => {
      try {
        const response = await fetch(`${apiUrl}/notifications/unread-count`, {
          headers: { Authorization: `Bearer ${token}` },
          cache: "no-store",
        });
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error || "Unable to load unread notifications.");
        if (active) setUnreadCount(Number(payload.count) || 0);
      } catch (error) {
        console.error("Unable to refresh the profile notification count:", error);
      }
    };
    const updateCount = (event: Event) => {
      const count = (event as CustomEvent<unknown>).detail;
      if (typeof count === "number" && Number.isFinite(count)) setUnreadCount(Math.max(0, count));
    };
    void loadCount();
    window.addEventListener("marketplace-notification-count-updated", updateCount);
    return () => {
      active = false;
      window.removeEventListener("marketplace-notification-count-updated", updateCount);
    };
  }, [token]);

  return (
    <Link href="/notifications" onClick={onClick} className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-xs text-body no-underline transition hover:bg-accent-light hover:text-primary focus-visible:outline-2 focus-visible:outline-primary ${className}`}>
      <PublicIcon name="notification" className="h-4 w-4 text-primary" />
      <span>Notifications</span>
      {unreadCount > 0 && <span className="ml-auto rounded-full bg-primary px-1.5 py-0.5 text-[9px] font-semibold text-white">{unreadCount > 99 ? "99+" : unreadCount}</span>}
    </Link>
  );
}

export function NotificationCenter() {
  const router = useRouter();
  const [authenticated, setAuthenticated] = useState(false);
  const [searchDraft, setSearchDraft] = useState("");
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const { items, unreadCount, totalCount, nextCursor, loading, error, load, markRead, markAllRead, dismiss, dismissAll } = useNotifications(20, status, search);

  useEffect(() => {
    const timer = window.setTimeout(() => setSearch(searchDraft.trim()), 250);
    return () => window.clearTimeout(timer);
  }, [searchDraft]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setAuthenticated(Boolean(window.localStorage.getItem("marketplace-token")));
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  const openNotification = async (item: MarketplaceNotification) => {
    const marked = await markRead(item.id);
    if (!marked) return;
    const href = notificationHref(item.href);
    if (href) router.push(href);
  };

  return (
    <main className="mx-auto w-full max-w-[1000px] px-4 py-8 sm:px-6">
      <header className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[0.1em] text-primary">Your account</p>
          <h1 className="mt-1 text-2xl font-bold tracking-tight text-heading">Notifications</h1>
          <p className="mt-1 text-sm text-muted">Order, product, review, and account updates.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => void markAllRead()} disabled={!unreadCount} className="rounded-lg border border-border-control bg-white px-3 py-2 text-xs font-semibold text-body disabled:opacity-50">Mark all as read</button>
          <button type="button" onClick={() => { if (totalCount && window.confirm("Delete all notifications from your notification center?")) void dismissAll(); }} disabled={!totalCount} className="rounded-lg border border-border-control bg-white px-3 py-2 text-xs font-semibold text-status-danger disabled:opacity-50">Delete all</button>
        </div>
      </header>
      <BrowserNotificationPreferences />
      {error && <p role="alert" className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}
      {!authenticated && <p role="status" className="mb-4 rounded-lg border border-border bg-white px-4 py-3 text-sm text-muted">Sign in to view and manage your notifications.</p>}
      <section className="overflow-hidden rounded-2xl border border-border bg-white shadow-sm">
        <div className="flex flex-col gap-2 border-b border-divider p-4 sm:flex-row">
          <label className="relative min-w-0 flex-1">
            <span className="sr-only">Search notifications</span>
            <PublicIcon name="search" className="absolute left-3 top-2.5 h-4 w-4 text-muted-faint" />
            <input value={searchDraft} onChange={(event) => setSearchDraft(event.target.value)} placeholder="Search notifications..." className="h-9 w-full rounded-lg border border-border-control pl-9 pr-3 text-xs outline-none focus:border-primary" />
          </label>
          <label>
            <span className="sr-only">Filter notifications by read status</span>
            <select value={status} onChange={(event) => setStatus(event.target.value)} className="h-9 rounded-lg border border-border-control bg-white px-3 text-xs text-body">
              <option value="all">All notifications</option><option value="unread">Unread</option><option value="read">Read</option>
            </select>
          </label>
        </div>
        {loading && !items.length ? <p className="px-5 py-12 text-center text-sm text-muted">Loading notifications...</p> : (
          <NotificationList items={items} onOpen={(item) => void openNotification(item)} onDismiss={(id) => void dismiss(id)} />
        )}
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-divider px-4 py-3">
          <span className="text-[10px] text-muted">{totalCount.toLocaleString()} notifications</span>
          {nextCursor && <button type="button" onClick={() => void load(true)} disabled={loading} className="text-xs font-semibold text-primary disabled:opacity-50">{loading ? "Loading..." : "Load more"}</button>}
        </div>
      </section>
    </main>
  );
}
