"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import PublicIcon, { type PublicIconName, type PublicIconSidebarName } from "@/components/icons/PublicIcon";
import { Card, MetricTile } from "@/components/ui";
import { formatCompactCurrency } from "@/lib/formatCurrency";

const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:5000/api";

type Amount = number | string;

type CreatorOverviewData = {
  creator: {
    name: string;
    isVerified: boolean;
    verificationStatus: string;
  };
  stats: {
    totalSales: Amount;
    revenue: Amount;
    products: Amount;
    customers: Amount;
    storefronts: Amount;
  };
  salesTrend: Array<{ date: string; totalSales: Amount }>;
  performance: {
    storeViews: Amount | null;
    conversionRate: Amount | null;
    averageOrderValue: Amount;
    returningCustomers: Amount;
  };
  products: Array<{
    id: number;
    name: string;
    status: string;
    storefrontSlug: string;
    sales: Amount;
    revenue: Amount;
  }>;
  orders: Array<{
    orderNumber: string;
    status: string;
    currency: string;
    amount: Amount;
    createdAt: string;
    storefrontSlug: string;
  }>;
};

type DashboardMetric = {
  label: string;
  value: string;
  detail: string;
  icon: PublicIconName | PublicIconSidebarName;
};

function numericValue(value: Amount | null | undefined) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function formatCurrency(value: Amount, currency = "USD") {
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: currency.trim() || "USD",
  }).format(numericValue(value));
}

function formatDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  }).format(date);
}

function statusLabel(value: string) {
  return value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function orderStatusClass(status: string) {
  switch (status.toLowerCase()) {
    case "paid":
    case "completed":
      return "bg-emerald-50 text-emerald-700";
    case "pending":
    case "processing":
      return "bg-amber-50 text-amber-700";
    case "cancelled":
    case "failed":
    case "refunded":
      return "bg-rose-50 text-rose-700";
    default:
      return "bg-slate-100 text-slate-700";
  }
}

function productStatusClass(status: string) {
  return ["published", "approved", "active"].includes(status.toLowerCase())
    ? "bg-emerald-100 text-emerald-700"
    : "bg-amber-100 text-amber-700";
}

function SalesChart({ points }: { points: CreatorOverviewData["salesTrend"] }) {
  const chartWidth = 660;
  const chartHeight = 180;
  const values = points.map((point) => numericValue(point.totalSales));
  const maxValue = Math.max(...values, 0);
  const chartScale = maxValue || 1;
  const linePath = points
    .map((point, index) => {
      const x = points.length < 2 ? 0 : (index / (points.length - 1)) * chartWidth;
      const y = chartHeight - (numericValue(point.totalSales) / chartScale) * chartHeight;
      return `${index === 0 ? "M" : "L"}${x.toFixed(1)} ${y.toFixed(1)}`;
    })
    .join(" ");
  const areaPath = points.length
    ? `${linePath} L${chartWidth} ${chartHeight} L0 ${chartHeight} Z`
    : "";
  const dateIndexes = points.length
    ? Array.from(new Set([0, ...[1, 2, 3, 4, 5].map((step) => Math.round(((points.length - 1) * step) / 6)), points.length - 1]))
    : [];

  return (
    <div className="mt-6 flex gap-3">
      <div className="flex flex-col justify-between pb-6 text-[11px] text-[#6f7894]">
        <span>{formatCompactCurrency(String(maxValue))}</span>
        <span>{formatCompactCurrency(String(maxValue * 2 / 3))}</span>
        <span>{formatCompactCurrency(String(maxValue / 3))}</span>
        <span>$0</span>
      </div>
      <div className="relative flex-1">
        <div className="absolute inset-x-0 top-0 border-t border-[#edf0f5]" />
        <div className="absolute inset-x-0 top-1/3 border-t border-[#edf0f5]" />
        <div className="absolute inset-x-0 top-2/3 border-t border-[#edf0f5]" />
        <svg
          viewBox={`0 0 ${chartWidth} ${chartHeight}`}
          preserveAspectRatio="none"
          className="relative h-[152px] w-full"
          aria-label="Creator sales over the last 30 days"
          role="img"
        >
          <defs>
            <linearGradient id="sales" x1="0" x2="0" y1="0" y2="1">
              <stop stopColor="#ff5a1f" stopOpacity=".16" />
              <stop offset="1" stopColor="#ff5a1f" stopOpacity="0" />
            </linearGradient>
          </defs>
          {areaPath && <path d={areaPath} fill="url(#sales)" />}
          {linePath && <path d={linePath} fill="none" stroke="#ff5a1f" strokeWidth="2.5" />}
        </svg>
        <div className="flex justify-between text-[11px] text-[#6f7894]">
          {dateIndexes.map((index) => (
            <span key={points[index].date}>{formatDate(points[index].date)}</span>
          ))}
        </div>
      </div>
    </div>
  );
}

export default function CreatorOverview() {
  const [data, setData] = useState<CreatorOverviewData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    const loadOverview = async () => {
      try {
        const token = window.localStorage.getItem("marketplace-token");
        if (!token) throw new Error("Please sign in with your creator account.");
        const response = await fetch(`${apiUrl}/creator/overview`, {
          headers: { Authorization: `Bearer ${token}` },
          cache: "no-store",
          signal: controller.signal,
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || "Unable to load creator overview.");
        setData(result);
        setError("");
      } catch (loadError) {
        if (!controller.signal.aborted) {
          setError(loadError instanceof Error ? loadError.message : "Unable to load creator overview.");
        }
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    };

    void loadOverview();
    return () => controller.abort();
  }, [reloadKey]);

  if (loading) {
    return <p className="px-2 py-8 text-sm text-muted">Loading creator overview...</p>;
  }

  if (error || !data) {
    return (
      <div className="rounded-2xl border border-rose-200 bg-rose-50 p-5 text-sm text-rose-800" role="alert">
        <p>{error || "Creator overview data is unavailable."}</p>
        <button
          type="button"
          onClick={() => {
            setLoading(true);
            setReloadKey((key) => key + 1);
          }}
          className="mt-3 rounded-lg bg-white px-3 py-2 font-semibold text-rose-800 shadow-sm"
        >
          Try again
        </button>
      </div>
    );
  }

  const metrics: DashboardMetric[] = [
    { label: "Total Sales", value: formatCompactCurrency(String(numericValue(data.stats.totalSales))), detail: "All-time · USD", icon: "cart" },
    { label: "Revenue", value: formatCompactCurrency(String(numericValue(data.stats.revenue))), detail: "After fees · USD", icon: "dollar" },
    { label: "Products", value: String(numericValue(data.stats.products)), detail: "Across active stores", icon: "shopping-basket" },
    { label: "Customers", value: String(numericValue(data.stats.customers)), detail: "Unique paid buyers", icon: "user" },
    { label: "Total Storefronts", value: String(numericValue(data.stats.storefronts)), detail: "Active storefronts", icon: "store" },
  ];
  const verificationLabel = data.creator.isVerified
    ? "Verified Creator"
    : statusLabel(data.creator.verificationStatus || "unverified");
  const verificationDetail = data.creator.isVerified
    ? "Your creator account is verified."
    : `Your identity verification status is ${statusLabel(data.creator.verificationStatus || "unverified").toLowerCase()}.`;

  return (
    <div className="creator-overview w-full">
      <header className="mb-5">
        <h1 className="text-2xl font-bold tracking-tight text-[#101a3c] sm:text-[28px]">
          Welcome, {data.creator.name || "Creator"}
        </h1>
        <p className="mt-1 text-sm text-[#66718e] sm:text-base">
          Manage your stores, products and earnings.
        </p>
      </header>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_280px] 2xl:grid-cols-[minmax(0,1fr)_300px]">
        <div className="min-w-0 space-y-5">
          <section className="summary-cards grid gap-4 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-5">
            {metrics.map(({ label, value, detail, icon }) => (
              <MetricTile
                key={label}
                label={label}
                value={value}
                change={detail}
                icon={<PublicIcon name={icon} className="h-7 w-7" />}
              />
            ))}
          </section>

          <section>
            <Card className="p-5">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h2 className="font-semibold text-[#66718e]">Sales Overview</h2>
                  <p className="mt-1 text-xs text-[#8790a8]">Daily paid sales · Last 30 days · USD</p>
                </div>
              </div>
              <SalesChart points={data.salesTrend} />
            </Card>
          </section>

          <Card className="overflow-hidden">
            <h2 className="px-5 py-4 font-semibold text-[#66718e]">Recent Products</h2>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[650px] text-left text-xs">
                <thead className="border-y border-[#edf0f5] bg-[#fcfcfe] text-[#4c5675]">
                  <tr>
                    <th className="px-7 py-3 font-medium">Product</th>
                    <th className="font-medium">Status</th>
                    <th className="font-medium">Sales</th>
                    <th className="font-medium">Revenue</th>
                    <th className="font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {data.products.length ? data.products.map((product) => (
                    <tr key={product.id} className="border-b border-[#edf0f5]">
                      <td className="px-7 py-2">
                        <span className="mr-4 inline-grid h-9 w-9 place-items-center rounded-md bg-[#eef2fa] text-primary">
                          <PublicIcon name="product" className="h-5 w-5" />
                        </span>
                        {product.name}
                      </td>
                      <td>
                        <span className={`rounded px-3 py-1.5 text-[10px] ${productStatusClass(product.status)}`}>
                          {statusLabel(product.status)}
                        </span>
                      </td>
                      <td>{numericValue(product.sales).toLocaleString()}</td>
                      <td>{formatCurrency(product.revenue)}</td>
                      <td>
                        <Link
                          href={`/creator/storefront/${encodeURIComponent(product.storefrontSlug)}/products/${product.id}/edit`}
                          className="flex items-center gap-2 font-medium text-primary no-underline"
                        >
                          <PublicIcon name="edit" className="h-4 w-4 text-primary" />
                          Edit
                        </Link>
                      </td>
                    </tr>
                  )) : (
                    <tr>
                      <td colSpan={5} className="px-7 py-8 text-center text-sm text-[#79819a]">
                        No products found for your active storefronts.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            <Link
              href="/creator/storefront"
              className="block py-4 text-center text-xs font-medium text-primary no-underline"
            >
              <span className="inline-flex items-center gap-1">
                <span>View storefronts</span>
                <PublicIcon name="right" className="shrink-0 text-primary" />
              </span>
            </Link>
          </Card>
        </div>

        <aside className="space-y-5">
          <Card className="p-5">
            <h2 className="font-semibold text-[#66718e]">Store Performance</h2>
            <div className="mt-4 space-y-0">
              {[
                ["Store Views", data.performance.storeViews === null ? "Not tracked" : numericValue(data.performance.storeViews).toLocaleString(), data.performance.storeViews === null ? "Analytics unavailable" : "All-time"],
                ["Conversion Rate", data.performance.conversionRate === null ? "Not tracked" : `${numericValue(data.performance.conversionRate).toFixed(2)}%`, data.performance.conversionRate === null ? "Analytics unavailable" : "All-time"],
                ["Avg. Order Value", formatCurrency(data.performance.averageOrderValue), "Paid orders · USD"],
                ["Return Customers", numericValue(data.performance.returningCustomers).toLocaleString(), "More than one paid order"],
              ].map(([label, value, detail]) => (
                <div
                  key={label}
                  className="flex items-center justify-between gap-2 border-b border-[#edf0f5] py-3 last:border-0"
                >
                  <span className="text-xs text-[#273252]">{label}</span>
                  <span className="text-right text-[11px] font-medium text-[#111b40]">
                    <span className="block">{value}</span>
                    <span className="mt-0.5 block text-[9px] font-normal text-[#79819a]">{detail}</span>
                  </span>
                </div>
              ))}
            </div>
          </Card>

          <article className="rounded-2xl bg-gradient-to-br from-primary to-secondary p-5 text-white shadow-sm">
            <p className="flex items-center text-sm font-semibold">
              Verification Status
              {data.creator.isVerified && <PublicIcon name="verified" className="ml-2 h-6 w-6 text-white" />}
            </p>
            <span className="mt-5 inline-flex items-center rounded bg-white px-3 py-1.5 text-xs font-semibold text-primary">
              {verificationLabel}
            </span>
            <p className="mt-4 text-xs leading-5 text-orange-50">{verificationDetail}</p>
            <Link
              href="/creator/verification"
              className="mt-4 inline-block rounded-lg bg-white px-5 py-2.5 text-xs font-medium text-primary no-underline"
            >
              View Details
            </Link>
          </article>

          <Card className="p-5">
            <div className="flex items-center justify-between">
              <h2 className="font-semibold text-[#66718e]">Recent Orders</h2>
              <Link
                href="/creator/storefront"
                className="text-xs font-medium text-primary no-underline"
              >
                View stores
              </Link>
            </div>
            <div className="mt-4 space-y-3">
              {data.orders.length ? data.orders.map((order) => (
                <div key={order.orderNumber} className="flex items-center gap-2">
                  <span className="grid h-7 w-7 place-items-center rounded bg-[#eef2fa] text-primary">
                    <PublicIcon name="receipt" className="h-4 w-4" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <Link
                      href={`/creator/storefront/${encodeURIComponent(order.storefrontSlug)}/orders/${encodeURIComponent(order.orderNumber)}`}
                      className="block truncate text-[10px] font-medium text-[#1b2748] no-underline hover:underline"
                    >
                      {order.orderNumber}
                    </Link>
                    <p className="text-[9px] text-[#79819a]">{formatDate(order.createdAt)}</p>
                  </div>
                  <span className="text-[10px] font-medium">{formatCurrency(order.amount, order.currency)}</span>
                  <span className={`rounded px-1.5 py-1 text-[8px] ${orderStatusClass(order.status)}`}>
                    {statusLabel(order.status)}
                  </span>
                </div>
              )) : (
                <p className="py-4 text-center text-xs text-[#79819a]">No orders found.</p>
              )}
            </div>
          </Card>
        </aside>
      </div>
    </div>
  );
}
