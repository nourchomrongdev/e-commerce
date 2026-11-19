"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import PublicIcon from "@/components/icons/PublicIcon";
import { Card, MetricTile } from "@/components/ui";
import { routes } from "@/lib/routeController";

type BuyerOverviewData = {
  stats: {
    totalOrders: number;
    purchasedProducts: number;
    totalDownloads: number;
    activeLicenses: number;
    wishlistItems: number;
  };
  recentOrders: Array<{
    id: number;
    orderNumber: string;
    status: string;
    totalAmount: number;
    currency: string;
    createdAt: string;
    products: string;
  }>;
  recentActivity: Array<{ activity: string; createdAt: string; href: string }>;
};

const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:5000/api";

function statusStyle(status: string) {
  const normalized = status.toLowerCase();
  if (["paid", "completed"].includes(normalized)) return "bg-emerald-100 text-emerald-700";
  if (["pending", "processing"].includes(normalized)) return "bg-amber-100 text-amber-700";
  if (["failed", "cancelled", "refunded", "partially_refunded"].includes(normalized)) return "bg-slate-100 text-slate-600";
  return "bg-surface-muted text-muted";
}

export default function BuyerDashboard() {
  const [data, setData] = useState<BuyerOverviewData | null>(null);
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [reload, setReload] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    const load = async () => {
      setLoading(true);
      setError("");
      try {
        const token = window.localStorage.getItem("marketplace-token") || "";
        const headers = { Authorization: `Bearer ${token}` };
        const [overviewResponse, accountResponse] = await Promise.all([
          fetch(`${apiUrl}/buyer/overview`, { headers, cache: "no-store", signal: controller.signal }),
          fetch(`${apiUrl}/auth/me`, { headers, cache: "no-store", signal: controller.signal }),
        ]);
        const [overview, account] = await Promise.all([overviewResponse.json(), accountResponse.json()]);
        if (!overviewResponse.ok) throw new Error(overview.error || "Unable to load your buyer overview.");
        if (!accountResponse.ok) throw new Error(account.error || "Unable to load your account details.");
        setData(overview as BuyerOverviewData);
        setName(account.user?.name || account.user?.username || "");
      } catch (requestError) {
        if (controller.signal.aborted) return;
        setError(requestError instanceof Error ? requestError.message : "Unable to load your buyer overview.");
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    };
    void load();
    return () => controller.abort();
  }, [reload]);

  const stats = data?.stats;
  const metrics = [
    ["Orders", stats?.totalOrders ?? 0, "receipt", routes.buyer.purchases()],
    ["Purchased products", stats?.purchasedProducts ?? 0, "shopping-cart", routes.buyer.products()],
    ["Downloads", stats?.totalDownloads ?? 0, "download", routes.buyer.downloads()],
    ["Active licenses", stats?.activeLicenses ?? 0, "shield-check", routes.buyer.licenses()],
  ] as const;

  return (
    <div className="mx-auto w-full max-w-[1400px]">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-heading sm:text-[28px]">
            Welcome{name ? `, ${name.replace(/_\d{6}$/, "").replace(/_/g, " ")}` : " back"} <span aria-hidden="true">👋</span>
          </h1>
          <p className="mt-1 text-sm text-muted">Find and manage your digital products.</p>
        </div>
        <Link href={routes.marketplace()} className="inline-flex items-center justify-center gap-2 rounded-lg bg-primary px-3.5 py-2 text-xs font-semibold text-white no-underline hover:bg-primary-hover">
          <PublicIcon name="search" className="h-3.5 w-3.5" /> Browse marketplace
        </Link>
      </header>

      {error && <div role="alert" className="mt-5 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-red-100 bg-red-50 px-4 py-3 text-xs text-status-danger"><span>{error}</span><button type="button" onClick={() => setReload((value) => value + 1)} className="font-semibold underline">Try again</button></div>}

      <section aria-label="Purchase statistics" className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {metrics.map(([label, value, icon, href]) => (
          <Link key={label} href={href} className="no-underline">
            <MetricTile label={label} value={loading ? "—" : value} icon={<PublicIcon name={icon} className="h-5 w-5" />} iconClassName="text-primary" />
          </Link>
        ))}
      </section>

      <section className="mt-4 grid gap-4 sm:grid-cols-2">
        <Link href={routes.buyer.wishlist()} className="no-underline">
          <Card className="flex items-center justify-between gap-4 px-5 py-4 transition hover:border-primary/30">
            <div><p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-soft">Wishlist</p><p className="mt-1 text-sm font-bold text-heading">{loading ? "—" : stats?.wishlistItems ?? 0} saved products</p></div>
            <PublicIcon name="heart-plus" className="h-5 w-5 text-primary" />
          </Card>
        </Link>
        <Link href={routes.buyer.account()} className="no-underline">
          <Card className="flex items-center justify-between gap-4 px-5 py-4 transition hover:border-primary/30">
            <div><p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-soft">Account</p><p className="mt-1 text-sm font-bold text-heading">Manage profile and settings</p></div>
            <PublicIcon name="settings" className="h-5 w-5 text-primary" />
          </Card>
        </Link>
      </section>

      <div className="mt-5 grid gap-5 xl:grid-cols-[1.25fr_0.75fr]">
        <Card className="overflow-hidden">
          <div className="flex items-center justify-between border-b border-divider px-5 py-4">
            <div><h2 className="text-sm font-bold text-heading">Recent Orders</h2><p className="mt-1 text-[10px] text-muted">Your latest order activity</p></div>
            <Link href={routes.buyer.purchases()} className="text-[10px] font-semibold text-primary no-underline">View all</Link>
          </div>
          {loading ? <div className="space-y-3 p-5"><div className="h-10 animate-pulse rounded bg-slate-100" /><div className="h-10 animate-pulse rounded bg-slate-100" /></div> : (
            <div className="divide-y divide-divider">
              {(data?.recentOrders ?? []).map((order) => (
                <Link key={order.id} href={`/buyer/purchases/${encodeURIComponent(order.orderNumber)}`} className="flex flex-col gap-2 px-5 py-4 no-underline transition hover:bg-slate-50 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0"><p className="text-xs font-semibold text-body">{order.orderNumber}</p><p className="mt-1 truncate text-[10px] text-muted">{order.products || "Order items unavailable"} · {new Date(order.createdAt).toLocaleDateString()}</p></div>
                  <div className="flex shrink-0 items-center gap-3"><span className={`rounded-full px-2.5 py-1 text-[9px] font-semibold capitalize ${statusStyle(order.status)}`}>{order.status.replaceAll("_", " ")}</span><span className="text-xs font-semibold text-heading">{new Intl.NumberFormat(undefined, { style: "currency", currency: order.currency || "USD" }).format(Number(order.totalAmount))}</span></div>
                </Link>
              ))}
              {data?.recentOrders.length === 0 && <div className="px-5 py-8 text-center text-xs text-muted">No orders yet. Browse the marketplace to find your first product.</div>}
            </div>
          )}
        </Card>

        <Card className="overflow-hidden">
          <div className="border-b border-divider px-5 py-4"><h2 className="text-sm font-bold text-heading">Recent Account Activity</h2><p className="mt-1 text-[10px] text-muted">Orders and file downloads</p></div>
          {loading ? <div className="space-y-3 p-5"><div className="h-8 animate-pulse rounded bg-slate-100" /><div className="h-8 animate-pulse rounded bg-slate-100" /></div> : <div className="divide-y divide-divider">
            {(data?.recentActivity ?? []).map((activity, index) => <Link key={`${activity.createdAt}-${index}`} href={activity.href} className="flex items-start gap-3 px-5 py-3 no-underline hover:bg-slate-50"><span className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-orange-50 text-primary"><PublicIcon name={activity.activity.startsWith("Downloaded") ? "download" : "receipt"} className="h-3.5 w-3.5" /></span><span className="min-w-0"><span className="block text-xs font-medium text-body">{activity.activity}</span><time className="mt-1 block text-[10px] text-muted">{new Date(activity.createdAt).toLocaleString()}</time></span></Link>)}
            {data?.recentActivity.length === 0 && <p className="px-5 py-8 text-center text-xs text-muted">Your recent orders and downloads will appear here.</p>}
          </div>}
        </Card>
      </div>
    </div>
  );
}
