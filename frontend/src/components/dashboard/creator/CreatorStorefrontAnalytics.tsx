"use client";

import { useEffect, useMemo, useState } from "react";
import AnalyticsChart from "@/components/dashboard/AnalyticsChart";
import PublicIcon from "@/components/icons/PublicIcon";
import { Badge, Button, MetricTile, Select, Table, TableHeader, TableRow } from "@/components/ui";
import useDebouncedValue from "@/hooks/useDebouncedValue";

type CurrencyStats = {
  currency: string;
  successfulOrders: number;
  pendingOrders: number;
  failedOrders: number;
  grossSales: number | string;
  platformFee: number | string;
  creatorEarnings: number | string;
  unitsSold: number;
};
type ProductStats = {
  productId: number;
  productName: string;
  currency: string;
  orders: number;
  unitsSold: number;
  grossSales: number | string;
  platformFee: number | string;
  creatorEarnings: number | string;
};
type MonthlySales = { month: string; currency: string; orders: number; revenue: number | string };

const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:5000/api";
const money = (value: number | string, currency: string) =>
  new Intl.NumberFormat(undefined, { style: "currency", currency }).format(Number(value) || 0);

function getDateRange(period: string) {
  const now = new Date();
  const from = new Date(now.getFullYear(), now.getMonth(), 1);
  const to = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  if (period === "Last month") {
    from.setMonth(from.getMonth() - 1);
    to.setDate(0);
  } else if (period === "This year") {
    from.setMonth(0, 1);
    to.setMonth(11, 31);
  }
  return { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) };
}

function exportCsv(products: ProductStats[]) {
  const records = [
    ["Product", "Currency", "Orders", "Units Sold", "Gross Sales", "Platform Fee", "Creator Earnings"],
    ...products.map((product) => [
      product.productName,
      product.currency,
      String(product.orders),
      String(product.unitsSold),
      String(product.grossSales),
      String(product.platformFee),
      String(product.creatorEarnings),
    ]),
  ];
  const csv = records.map((row) => row.map((value) => `"${value.replaceAll('"', '""')}"`).join(",")).join("\r\n");
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = "storefront-sales-analytics.csv";
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export default function CreatorStorefrontAnalytics({ storefront }: { storefront: string }) {
  const [period, setPeriod] = useState("This month");
  const [currency, setCurrency] = useState("");
  const debouncedPeriod = useDebouncedValue(period);
  const debouncedCurrency = useDebouncedValue(currency);
  const [currencies, setCurrencies] = useState<CurrencyStats[]>([]);
  const [products, setProducts] = useState<ProductStats[]>([]);
  const [monthlySales, setMonthlySales] = useState<MonthlySales[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const range = useMemo(() => getDateRange(debouncedPeriod), [debouncedPeriod]);
  useEffect(() => {
    const controller = new AbortController();
    const load = async () => {
      setLoading(true);
      setError("");
      try {
        const token = window.localStorage.getItem("marketplace-token");
        if (!token) throw new Error("Please sign in with your creator account.");
        const query = new URLSearchParams(range);
        const response = await fetch(
          `${apiUrl}/creator/storefronts/${encodeURIComponent(storefront)}/analytics?${query}`,
          { headers: { Authorization: `Bearer ${token}` }, cache: "no-store", signal: controller.signal },
        );
        const data = await response.json();
        if (!response.ok) throw new Error(data.error ?? "Unable to load storefront sales analytics.");
        const nextCurrencies = (data.currencies ?? []) as CurrencyStats[];
        setCurrencies(nextCurrencies);
        setProducts(data.products ?? []);
        setMonthlySales(data.monthlySales ?? []);
        setCurrency((current) => current && nextCurrencies.some((item) => item.currency === current)
          ? current
          : nextCurrencies[0]?.currency ?? "");
      } catch (loadError) {
        if (loadError instanceof DOMException && loadError.name === "AbortError") return;
        setCurrencies([]);
        setProducts([]);
        setMonthlySales([]);
        setError(loadError instanceof Error ? loadError.message : "Unable to load storefront sales analytics.");
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    };
    void load();
    return () => controller.abort();
  }, [range, storefront]);

  const selectedSummary = currencies.find((item) => item.currency === debouncedCurrency);
  const currencyProducts = products.filter((item) => item.currency === debouncedCurrency);
  const currencyMonths = monthlySales.filter((item) => item.currency === debouncedCurrency);
  const chartValues = currencyMonths.map((item) => Number(item.revenue));
  const chartDisplayValues = chartValues.length === 1 ? [chartValues[0], chartValues[0]] : chartValues;
  const metrics = [
    ["Gross Sales", selectedSummary ? money(selectedSummary.grossSales, currency) : "—", "Verified paid and completed orders", "dollar"],
    ["Platform Fees", selectedSummary ? money(selectedSummary.platformFee, currency) : "—", "Configured marketplace commission", "receipt"],
    ["Creator Earnings", selectedSummary ? money(selectedSummary.creatorEarnings, currency) : "—", "After platform fee", "wallet"],
    ["Orders / Units", selectedSummary ? String(selectedSummary.successfulOrders) : "—", `${selectedSummary?.unitsSold ?? 0} units sold`, "shopping-cart"],
  ] as const;

  return <div className="mx-auto w-full max-w-[1400px]">
    <header className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
      <div><h1 className="text-2xl font-bold tracking-tight text-heading sm:text-[28px]">Analytics</h1><p className="mt-1 text-sm text-muted">Track verified sales and product performance for {storefront}.</p></div>
      <Button size="sm" variant="secondary" disabled={loading || currencyProducts.length === 0} onClick={() => exportCsv(currencyProducts)}><PublicIcon name="down" className="h-4 w-4 rotate-180" />Export current period</Button>
    </header>

    <section className="mt-5 flex flex-wrap items-center gap-3">
      <Select aria-label="Sales analytics period" value={period} onChange={(event) => setPeriod(event.target.value)} className="w-full py-2 text-xs sm:w-auto">
        <option>This month</option><option>Last month</option><option>This year</option>
      </Select>
      <Select aria-label="Sales currency" value={currency} onChange={(event) => setCurrency(event.target.value)} className="w-full py-2 text-xs sm:w-auto" disabled={currencies.length === 0}>
        {currencies.length === 0 ? <option value="">No sales currency</option> : currencies.map((item) => <option key={item.currency} value={item.currency}>{item.currency}</option>)}
      </Select>
      {selectedSummary && <div className="flex flex-wrap gap-2 text-[10px] text-muted"><Badge tone="warning">{selectedSummary.pendingOrders} pending</Badge><Badge tone="danger">{selectedSummary.failedOrders} failed or cancelled</Badge></div>}
    </section>

    {error && <p role="alert" className="mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-xs text-status-danger">{error}</p>}
    <section className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {metrics.map(([label, value, detail, icon]) => <MetricTile key={label} label={label} value={value} change={detail} icon={<PublicIcon name={icon} className="h-5 w-5" />} />)}
    </section>

    <section className="mt-5 rounded-2xl border border-border bg-white p-4 shadow-sm sm:p-5">
      <h2 className="text-sm font-bold text-heading">Monthly sales</h2>
      {loading ? <p className="py-12 text-center text-sm text-muted">Loading analytics…</p> : currencyMonths.length === 0
        ? <p className="py-12 text-center text-sm text-muted">No completed sales for this period.</p>
        : <div className="mt-4 grid grid-cols-[32px_1fr] gap-3"><div className="flex h-44 flex-col justify-between text-[9px] text-muted-soft"><span>{money(Math.max(...chartValues), currency)}</span><span>{money(Math.max(...chartValues) / 2, currency)}</span><span>{money(0, currency)}</span></div><div className="relative h-44 border-b border-l border-divider bg-[linear-gradient(to_bottom,transparent_24%,#eef1f6_25%,transparent_26%,transparent_49%,#eef1f6_50%,transparent_51%,transparent_74%,#eef1f6_75%,transparent_76%)]"><AnalyticsChart values={chartDisplayValues} color="#7656f4" fill="#7656f4" /></div></div>}
      {!loading && currencyMonths.length > 0 && <div className="mt-2 flex justify-between pl-11 text-[9px] text-muted-soft">{currencyMonths.map((item) => <span key={item.month}>{new Date(item.month).toLocaleDateString(undefined, { month: "short", year: "2-digit" })}</span>)}</div>}
    </section>

    <section className="mt-5 overflow-hidden rounded-2xl border border-border bg-white shadow-sm">
      <div className="border-b border-divider px-5 py-4"><h2 className="text-sm font-bold text-heading">Product sales statistics</h2><p className="mt-1 text-xs text-muted">Only paid and completed order items are included.</p></div>
      {loading ? <p className="px-6 py-10 text-center text-sm text-muted">Loading product sales…</p> : <Table className="min-w-[760px]">
        <TableHeader><tr><th className="px-6 py-3 font-medium">Product</th><th className="py-3 font-medium">Orders</th><th className="py-3 font-medium">Units</th><th className="py-3 font-medium">Gross Sales</th><th className="py-3 font-medium">Platform Fee</th><th className="py-3 font-medium">Creator Earnings</th></tr></TableHeader>
        <tbody>{currencyProducts.map((item) => <TableRow key={`${item.productId}-${item.currency}`} className="text-[#283554] transition hover:bg-[#fffaf6]">
          <td className="px-6 py-3 text-[10px] font-semibold text-[#172141]">{item.productName}</td><td className="py-3 text-[10px]">{item.orders}</td><td className="py-3 text-[10px]">{item.unitsSold}</td><td className="py-3 text-[10px]">{money(item.grossSales, item.currency)}</td><td className="py-3 text-[10px] text-muted">{money(item.platformFee, item.currency)}</td><td className="py-3 text-[10px] font-semibold text-primary">{money(item.creatorEarnings, item.currency)}</td>
        </TableRow>)}</tbody>
      </Table>}
      {!loading && !error && currencyProducts.length === 0 && <p className="px-6 py-12 text-center text-sm text-muted">No completed product sales for this period.</p>}
    </section>
  </div>;
}
