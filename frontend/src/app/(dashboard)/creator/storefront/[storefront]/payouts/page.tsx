"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import PublicIcon from "@/components/icons/PublicIcon";
import { Badge, Button, MetricTile, Select, Table, TableHeader, TableRow } from "@/components/ui";

const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:5000/api";
type EarningsSummary = {
  currency: string;
  totalOrders: number;
  successfulOrders: number;
  pendingOrders: number;
  failedOrders: number;
  grossSales: number | string;
  platformFee: number | string;
  creatorEarnings: number | string;
  unitsSold: number;
};
type EarningsTransaction = {
  orderNumber: string;
  description: string;
  amount: number | string;
  platformFee: number | string;
  creatorEarnings: number | string;
  currency: string;
  status: string;
  createdAt: string;
};
type FinanceOverview = {
  summary: Array<{ currency: string; availableEarnings: string; pendingEarnings: string; onHoldAmount: string }>;
  payouts: Array<{ id: string; amount: string; currency: string; status: string; createdAt: string; paidAt?: string | null }>;
  schedule: { scheduleType: string; nextPayoutAt?: string | null };
  settings: { monthlyPayoutDay: number; minimumPayoutAmount: string };
};

function money(value: number | string, currency: string) {
  return new Intl.NumberFormat(undefined, { style: "currency", currency }).format(Number(value) || 0);
}

function earningsStatusTone(status: string) {
  if (status === "available") return "success";
  if (status === "refunded" || status === "partially_refunded") return "danger";
  return "warning";
}

function dateRange(period: string) {
  const now = new Date();
  const from = new Date(now.getFullYear(), now.getMonth(), 1);
  const to = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (period === "Last month") {
    from.setMonth(from.getMonth() - 1);
    to.setDate(0);
  } else if (period === "This year") {
    from.setMonth(0, 1);
  }
  return { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) };
}

function exportCsv(transactions: EarningsTransaction[]) {
  const rows = [
    ["Order Number", "Product", "Gross Sales", "Platform Fee", "Creator Earnings", "Currency", "Status", "Date"],
    ...transactions.map((item) => [item.orderNumber, item.description, String(item.amount), String(item.platformFee), String(item.creatorEarnings), item.currency, item.status, item.createdAt]),
  ];
  const csv = rows.map((row) => row.map((cell) => `"${cell.replaceAll('"', '""')}"`).join(",")).join("\r\n");
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = "creator-earnings.csv";
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export default function CreatorPayoutsPage() {
  const params = useParams<{ storefront: string }>();
  const storefrontName = String(params.storefront || "");
  const [period, setPeriod] = useState("This month");
  const [summaries, setSummaries] = useState<EarningsSummary[]>([]);
  const [transactions, setTransactions] = useState<EarningsTransaction[]>([]);
  const [currency, setCurrency] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [financeOverview, setFinanceOverview] = useState<FinanceOverview | null>(null);
  const [financeError, setFinanceError] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    const loadFinance = async () => {
      try {
        const token = window.localStorage.getItem("marketplace-token");
        if (!token) throw new Error("Please sign in with your creator account.");
        const response = await fetch(`${apiUrl}/creator/finance/overview?page=1&pageSize=100`, {
          headers: { Authorization: `Bearer ${token}` },
          cache: "no-store",
          signal: controller.signal,
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Unable to load payout records.");
        setFinanceOverview(data as FinanceOverview);
        setFinanceError("");
      } catch (loadError) {
        if (!controller.signal.aborted) {
          setFinanceOverview(null);
          setFinanceError(loadError instanceof Error ? loadError.message : "Unable to load payout records.");
        }
      }
    };
    void loadFinance();
    return () => controller.abort();
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    const load = async () => {
      setLoading(true);
      setError("");
      try {
        const token = window.localStorage.getItem("marketplace-token");
        if (!token) throw new Error("Please sign in with your creator account.");
        const range = dateRange(period);
        const query = new URLSearchParams(range);
        const response = await fetch(
          `${apiUrl}/creator/storefronts/${encodeURIComponent(storefrontName)}/earnings?${query}`,
          { headers: { Authorization: `Bearer ${token}` }, cache: "no-store", signal: controller.signal },
        );
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Unable to load creator earnings.");
        const nextSummaries = data.summary || [];
        setSummaries(nextSummaries);
        setCurrency((current) => current && nextSummaries.some((item: EarningsSummary) => item.currency === current)
          ? current
          : nextSummaries[0]?.currency ?? "");
        setTransactions(data.transactions || []);
      } catch (loadError) {
        if (!controller.signal.aborted) {
          setError(loadError instanceof Error ? loadError.message : "Unable to load creator earnings.");
          setSummaries([]);
          setTransactions([]);
        }
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    };
    void load();
    return () => controller.abort();
  }, [period, storefrontName]);

  const summary = summaries.find((item) => item.currency === currency);
  const currencyTransactions = transactions.filter((item) => item.currency === currency);
  const metricCards = [
    ["Gross Sales", summary ? money(summary.grossSales, currency) : "—", "Paid and completed orders", "dollar"],
    ["Platform Fees", summary ? money(summary.platformFee, currency) : "—", "Commission recorded per sale", "receipt"],
    ["Creator Earnings", summary ? money(summary.creatorEarnings, currency) : "—", "After platform fee", "wallet"],
    ["Orders", String(summary?.successfulOrders ?? "—"), `${summary?.unitsSold ?? 0} units sold`, "shopping-cart"],
  ] as const;

  return (
    <div className="mx-auto w-full max-w-[1400px]">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div><h1 className="text-2xl font-bold tracking-tight text-heading sm:text-[28px]">Creator Earnings</h1><p className="mt-1 text-sm text-muted">Track verified sales, marketplace fees, and your earnings.</p></div>
        <Button size="sm" variant="secondary" disabled={loading || currencyTransactions.length === 0} onClick={() => exportCsv(currencyTransactions)}><PublicIcon name="down" className="h-4 w-4 rotate-180" />Export current period</Button>
      </header>

      <section className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {metricCards.map(([label, value, detail, icon]) => <MetricTile key={label} label={label} value={value} change={detail} icon={<PublicIcon name={icon} className="h-5 w-5" />} iconClassName="text-primary" />)}
      </section>

      <div className="mt-5 grid gap-5 xl:grid-cols-[1.4fr_0.6fr]">
        <section className="overflow-hidden rounded-2xl border border-border bg-white shadow-sm">
          <div className="flex flex-col gap-4 border-b border-divider px-5 pt-4 sm:px-6">
            <div className="flex flex-col gap-3 pb-4 sm:flex-row sm:items-center sm:justify-between">
              <h2 className="text-sm font-bold text-heading">Sales transactions</h2>
              <Select aria-label="Earnings period" value={period} onChange={(event) => setPeriod(event.target.value)} className="w-full py-2 text-xs sm:w-auto">
                <option>This month</option><option>Last month</option><option>This year</option>
              </Select>
              <Select aria-label="Earnings currency" value={currency} onChange={(event) => setCurrency(event.target.value)} className="w-full py-2 text-xs sm:w-auto" disabled={summaries.length === 0}>
                {summaries.length === 0 ? <option value="">No sales currency</option> : summaries.map((item) => <option key={item.currency} value={item.currency}>{item.currency}</option>)}
              </Select>
            </div>
          </div>
          {error && <p role="alert" className="border-b border-divider px-5 py-3 text-xs text-status-danger">{error}</p>}
          {loading ? <p className="px-6 py-10 text-center text-sm text-muted">Loading creator earnings...</p> : <Table className="min-w-[700px]">
            <TableHeader><tr><th className="px-6 py-3 font-medium">Order / Product</th><th className="py-3 font-medium">Gross Sales</th><th className="py-3 font-medium">Platform Fee</th><th className="py-3 font-medium">Creator Earnings</th><th className="py-3 font-medium">Status</th><th className="py-3 font-medium">Date</th></tr></TableHeader>
            <tbody>{currencyTransactions.map((transaction, index) => <TableRow key={`${transaction.orderNumber}-${index}`} className="text-[#283554] transition hover:bg-[#fffaf6]">
              <td className="px-6 py-3"><strong className="block text-[10px] text-[#172141]">{transaction.orderNumber}</strong><span className="block text-[9px] text-muted">{transaction.description}</span></td>
              <td className="py-3 text-[10px] text-body">{money(transaction.amount, transaction.currency)}</td>
              <td className="py-3 text-[10px] text-muted">{money(transaction.platformFee, transaction.currency)}</td>
              <td className="py-3 text-[10px] font-semibold text-primary">{money(transaction.creatorEarnings, transaction.currency)}</td>
              <td className="py-3"><Badge tone={earningsStatusTone(transaction.status)}>{transaction.status.replaceAll("_", " ")}</Badge></td>
              <td className="py-3 text-[10px] text-muted">{new Date(transaction.createdAt).toLocaleDateString()}</td>
            </TableRow>)}</tbody>
          </Table>}
          {!loading && currencyTransactions.length === 0 && <p className="px-6 py-12 text-center text-sm text-muted">No completed sales for this currency and period.</p>}
          <footer className="border-t border-divider px-6 py-4 text-[10px] text-muted">Showing {transactions.length} transaction{transactions.length === 1 ? "" : "s"} · {summary?.totalOrders ?? 0} storefront orders in this period</footer>
        </section>

        <div className="space-y-5">
          <section className="rounded-2xl border border-border bg-white p-5 shadow-sm">
            <h2 className="text-sm font-bold text-heading">Commission breakdown</h2>
            <p className="mt-1 text-[10px] text-muted">Marketplace fee is calculated from verified order-item sales.</p>
            <div className="mt-4 space-y-3 text-xs">
              <div className="flex justify-between"><span className="text-muted">Gross sales</span><strong>{summary ? money(summary.grossSales, currency) : "—"}</strong></div>
              <div className="flex justify-between"><span className="text-muted">Marketplace commission</span><strong>{summary ? `−${money(summary.platformFee, currency)}` : "—"}</strong></div>
              <div className="flex justify-between border-t border-divider pt-3"><span className="font-semibold text-body">Creator earnings</span><strong className="text-primary">{summary ? money(summary.creatorEarnings, currency) : "—"}</strong></div>
            </div>
          </section>
          <section className="rounded-2xl border border-border bg-white p-5 shadow-sm">
            <h2 className="text-sm font-bold text-heading">Refund and payment status</h2>
            <p className="mt-2 text-xs text-muted">Refunded, partially refunded, failed, and chargeback order activity is shown in your sales orders.</p>
            <a href={`/creator/storefront/${encodeURIComponent(storefrontName)}/orders`} className="mt-3 inline-block text-xs font-semibold text-primary">View sales orders</a>
          </section>
          <section className="rounded-2xl border border-border bg-white p-5 shadow-sm">
            <h2 className="text-sm font-bold text-heading">Payout records</h2>
            {financeError && <p role="alert" className="mt-2 text-xs text-status-danger">{financeError}</p>}
            {financeOverview && <>
              <div className="mt-3 space-y-2 border-b border-divider pb-3 text-xs">
                {financeOverview.summary.map((item) => <div key={item.currency} className="flex justify-between"><span className="text-muted">{item.currency} available</span><strong>{money(item.availableEarnings, item.currency)}</strong></div>)}
                <div className="flex justify-between"><span className="text-muted">Minimum payout</span><strong>{money(financeOverview.settings.minimumPayoutAmount, "USD")}</strong></div>
                <div className="flex justify-between"><span className="text-muted">Schedule</span><strong className="capitalize">{financeOverview.schedule.scheduleType.replaceAll("_", " ")}</strong></div>
              </div>
              <div className="mt-3 space-y-2">
                {financeOverview.payouts.slice(0, 5).map((payout) => <div key={payout.id} className="flex items-center justify-between gap-2 text-[10px]">
                  <span className="text-muted">{new Date(payout.paidAt || payout.createdAt).toLocaleDateString()}</span>
                  <strong className="text-body-strong">{money(payout.amount, payout.currency)}</strong>
                  <Badge tone={payout.status === "paid" ? "success" : payout.status === "failed" ? "danger" : "warning"}>{payout.status.replaceAll("_", " ")}</Badge>
                </div>)}
                {!financeOverview.payouts.length && <p className="text-xs text-muted">No payout records yet.</p>}
              </div>
              <a href="/creator/payouts" className="mt-4 inline-block text-xs font-semibold text-primary">Manage payouts</a>
            </>}
          </section>
        </div>
      </div>
    </div>
  );
}
