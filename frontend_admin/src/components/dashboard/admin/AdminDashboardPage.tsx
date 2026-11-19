"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import PublicIcon from "@/components/icons/PublicIcon";
import { Badge, MetricTile } from "@/components/ui";

const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:5000/api";

type DashboardActivity = {
  id: number;
  action: string;
  description: string | null;
  actorName: string;
  createdAt: string;
  outcome: string | null;
};

type DashboardOrder = {
  id: number;
  orderNumber: string;
  buyerName: string;
  totalAmount: number | string;
  currency: string;
  status: string;
  createdAt: string;
};

type DashboardData = {
  summary: {
    totalOrders: number;
    totalUsers: number;
    totalProducts: number;
    activeCreators: number;
    newUsersThisMonth: number;
  };
  revenueByCurrency: { currency: string; payments: number; revenue: number | string }[];
  chart: { period: string; currency: string; revenue: number | string }[];
  categories: { category: string | null; currency: string; revenue: number | string }[];
  recentOrders: DashboardOrder[];
  recentActivity: DashboardActivity[];
};

function currencyFormat(value: number | string, currency: string) {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return "—";
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(amount);
  } catch {
    return `${currency} ${amount.toFixed(2)}`;
  }
}

function dateFormat(value: string) {
  return new Date(value).toLocaleDateString();
}

export default function AdminDashboardPage() {
  const [period, setPeriod] = useState<"month" | "year">("month");
  const [data, setData] = useState<DashboardData | null>(null);
  const [currency, setCurrency] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [refreshVersion, setRefreshVersion] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    const load = async () => {
      setLoading(true);
      setError("");
      try {
        const token = window.localStorage.getItem("marketplace-token");
        if (!token) throw new Error("An administrator session is required to load dashboard data.");
        const response = await fetch(`${apiUrl}/admin/dashboard?period=${period}`, {
          headers: { Authorization: `Bearer ${token}` },
          signal: controller.signal,
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error ?? "Unable to load marketplace dashboard data.");
        const dashboard = result as DashboardData;
        setData(dashboard);
        setCurrency((current) => current || dashboard.revenueByCurrency[0]?.currency || dashboard.chart[0]?.currency || "USD");
      } catch (loadError) {
        if (loadError instanceof DOMException && loadError.name === "AbortError") return;
        setData(null);
        setError(loadError instanceof Error ? loadError.message : "Unable to load marketplace dashboard data.");
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    };
    void load();
    return () => controller.abort();
  }, [period, refreshVersion]);

  const currencies = useMemo(() => {
    if (!data) return [];
    return [...new Set([
      ...data.revenueByCurrency.map((item) => item.currency),
      ...data.chart.map((item) => item.currency),
      ...data.categories.map((item) => item.currency),
    ])];
  }, [data]);
  const selectedRevenue = data?.revenueByCurrency.find((item) => item.currency === currency);
  const chartRows = useMemo(() => {
    const matchingRows = (data?.chart ?? []).filter((item) => item.currency === currency);
    const byPeriod = new Map<string, number>();
    for (const item of matchingRows) {
      byPeriod.set(item.period, (byPeriod.get(item.period) ?? 0) + Number(item.revenue || 0));
    }
    return [...byPeriod.entries()].sort(([left], [right]) => left.localeCompare(right));
  }, [currency, data]);
  const chartMaximum = Math.max(0, ...chartRows.map(([, value]) => value));
  const categories = (data?.categories ?? []).filter((item) => item.currency === currency);
  const categoryTotal = categories.reduce((sum, item) => sum + Number(item.revenue || 0), 0);

  return (
    <div className="mx-auto w-full max-w-[1400px]">
      <header className="mb-7 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="mb-1 text-[10px] font-bold uppercase tracking-[0.1em] text-primary">Administration</p>
          <h1 className="text-2xl font-bold tracking-tight text-heading sm:text-[28px]">Marketplace overview</h1>
          <p className="mt-1 text-sm text-muted">Current totals and records queried from the marketplace database.</p>
        </div>
        <button type="button" onClick={() => setRefreshVersion((current) => current + 1)} className="rounded-lg border border-border-control bg-white px-4 py-2 text-xs font-semibold text-body shadow-sm hover:bg-surface-control">Refresh data</button>
      </header>

      {error && <p role="alert" className="mb-5 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <MetricTile label={currency ? `Revenue (${currency})` : "Revenue"} value={selectedRevenue ? currencyFormat(selectedRevenue.revenue, currency) : "—"} icon={<PublicIcon name="dollar" className="h-5 w-5" />} />
        <MetricTile label="Orders" value={data?.summary.totalOrders.toLocaleString() ?? "—"} icon={<PublicIcon name="receipt" className="h-5 w-5" />} />
        <MetricTile label="Users" value={data?.summary.totalUsers.toLocaleString() ?? "—"} icon={<PublicIcon name="user" className="h-5 w-5" />} />
        <MetricTile label="Active creators" value={data?.summary.activeCreators.toLocaleString() ?? "—"} icon={<PublicIcon name="store" className="h-5 w-5" />} />
        <MetricTile label="Products" value={data?.summary.totalProducts.toLocaleString() ?? "—"} icon={<PublicIcon name="product" className="h-5 w-5" />} />
      </div>

      {loading && <p className="mt-5 rounded-xl border border-border bg-white px-5 py-8 text-center text-sm text-muted">Loading dashboard data...</p>}
      {!loading && !error && !data && <p className="mt-5 rounded-xl border border-border bg-white px-5 py-8 text-center text-sm text-muted">Dashboard data is unavailable.</p>}

      {data && (
        <>
          <div className="mt-5 grid gap-5 xl:grid-cols-[1.2fr_0.8fr]">
            <section className="rounded-xl border border-border bg-white p-5 shadow-sm">
              <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
                <h2 className="text-sm font-bold text-heading">Paid revenue</h2>
                <div className="flex gap-2">
                  {currencies.length > 1 && <select aria-label="Revenue currency" value={currency} onChange={(event) => setCurrency(event.target.value)} className="h-8 rounded-lg border border-border-control bg-white px-3 text-xs text-body">{currencies.map((code) => <option key={code} value={code}>{code}</option>)}</select>}
                  <select aria-label="Revenue period" value={period} onChange={(event) => setPeriod(event.target.value as "month" | "year")} className="h-8 rounded-lg border border-border-control bg-white px-3 text-xs text-body"><option value="month">This month</option><option value="year">This year</option></select>
                </div>
              </div>
              {chartRows.length ? (
                <div className="flex h-48 items-end gap-2 border-b border-dashed border-border-control px-2">
                  {chartRows.map(([date, value]) => <div key={date} title={`${dateFormat(date)} · ${currencyFormat(value, currency)}`} className="flex min-w-0 flex-1 items-end"><span className="w-full rounded-t bg-primary/80" style={{ height: `${Math.max(4, (value / chartMaximum) * 100)}%` }} /></div>)}
                </div>
              ) : <p className="grid h-48 place-items-center text-sm text-muted">No paid revenue recorded for this period and currency.</p>}
            </section>

            <section className="rounded-xl border border-border bg-white p-5 shadow-sm">
              <div className="mb-5 flex items-center justify-between gap-3"><h2 className="text-sm font-bold text-heading">Revenue by category</h2><span className="text-xs text-muted">{currency}</span></div>
              {categories.length ? <div className="space-y-4">{categories.map((item) => {
                const amount = Number(item.revenue || 0);
                const share = categoryTotal > 0 ? (amount / categoryTotal) * 100 : 0;
                return <div key={item.category ?? "Uncategorized"}><div className="mb-1 flex justify-between gap-3 text-xs"><span className="truncate text-body">{item.category ?? "Uncategorized"}</span><span className="shrink-0 font-medium text-body-strong">{currencyFormat(amount, currency)} · {share.toFixed(1)}%</span></div><div className="h-2 overflow-hidden rounded-full bg-surface-control"><div className="h-full rounded-full bg-primary" style={{ width: `${share}%` }} /></div></div>;
              })}</div> : <p className="py-8 text-center text-sm text-muted">No paid order categories recorded.</p>}
            </section>
          </div>

          <div className="mt-5 grid gap-5 xl:grid-cols-2">
            <section className="overflow-hidden rounded-xl border border-border bg-white shadow-sm">
              <div className="flex items-center justify-between border-b border-divider px-5 py-4"><h2 className="text-sm font-bold text-heading">Recent orders</h2><Link href="/admin/orders" className="text-xs font-semibold text-primary hover:underline">View all</Link></div>
              {data.recentOrders.length ? <div className="overflow-x-auto"><table className="w-full min-w-[520px] text-left text-xs"><thead className="bg-surface-muted text-[10px] uppercase text-muted"><tr><th className="px-5 py-3 font-medium">Order</th><th className="py-3 font-medium">Buyer</th><th className="py-3 font-medium">Amount</th><th className="px-5 py-3 font-medium">Status</th></tr></thead><tbody>{data.recentOrders.map((order) => <tr key={order.id} className="border-t border-divider text-body"><td className="px-5 py-3 font-medium text-body-strong"><Link href={`/admin/orders/${encodeURIComponent(order.orderNumber)}`} className="hover:text-primary">{order.orderNumber}</Link></td><td className="py-3">{order.buyerName}</td><td className="py-3">{currencyFormat(order.totalAmount, order.currency)}</td><td className="px-5 py-3"><Badge tone={order.status === "completed" ? "success" : order.status === "pending" ? "warning" : "neutral"}>{order.status}</Badge></td></tr>)}</tbody></table></div> : <p className="px-5 py-8 text-center text-sm text-muted">No orders recorded.</p>}
            </section>

            <section className="rounded-xl border border-border bg-white p-5 shadow-sm">
              <div className="mb-5 flex items-center justify-between"><h2 className="text-sm font-bold text-heading">Recent activity</h2><Link href="/admin/activity" className="text-xs font-semibold text-primary hover:underline">View all</Link></div>
              {data.recentActivity.length ? <div className="space-y-4">{data.recentActivity.map((item) => <div key={item.id} className="flex items-start gap-3"><span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-status-info-surface text-status-info"><PublicIcon name="dashboard" className="h-4 w-4" /></span><div className="min-w-0 flex-1"><Link href={`/admin/activity/${item.id}`} className="text-xs font-semibold text-body-strong hover:text-primary">{item.action}</Link><p className="truncate text-[10px] text-muted">{item.actorName}{item.description ? ` · ${item.description}` : ""}</p></div><span className="shrink-0 text-[10px] text-muted">{dateFormat(item.createdAt)}</span></div>)}</div> : <p className="py-8 text-center text-sm text-muted">No activity records recorded.</p>}
            </section>
          </div>
        </>
      )}
    </div>
  );
}
