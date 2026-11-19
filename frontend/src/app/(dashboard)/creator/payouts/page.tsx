"use client";

import { useEffect, useMemo, useState } from "react";
import PublicIcon from "@/components/icons/PublicIcon";
import type { PublicIconName, PublicIconSidebarName } from "@/components/icons/PublicIcon";
import { Badge, Button, InputText, MetricTile, Table, TableHeader, TableRow } from "@/components/ui";

const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:5000/api";
type FinanceSummary = {
  currency: string;
  totalSales: string;
  grossEarnings: string;
  marketplaceCommission: string;
  paymentFees: string;
  pendingEarnings: string;
  availableEarnings: string;
  onHoldAmount: string;
};
type Payout = {
  id: string;
  amount: string;
  currency: string;
  paymentMethod: string;
  status: string;
  transactionReference?: string | null;
  failureReason?: string | null;
  paidAt?: string | null;
  createdAt: string;
};
type FinanceData = {
  summary: FinanceSummary[];
  payouts: Payout[];
  schedule: { isPaused?: boolean };
  payoutAccount: { provider: string; maskedEmail: string } | null;
  settings: { commissionRate: string; minimumPayoutAmount: string; payoutCurrency: string; monthlyPayoutDay: number };
};

function money(value: number | string, currency = "USD") {
  const amount = Number(value);
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency }).format(Number.isFinite(amount) ? amount : 0);
  } catch {
    return `${currency} ${Number.isFinite(amount) ? amount.toFixed(2) : "0.00"}`;
  }
}

function statusTone(status: string): "success" | "warning" | "danger" | "neutral" {
  if (status === "paid") return "success";
  if (["pending_approval", "processing"].includes(status)) return "warning";
  if (["failed", "cancelled"].includes(status)) return "danger";
  return "neutral";
}

function exportCsv(payouts: Payout[]) {
  const rows = [
    ["Payout ID", "Amount", "Currency", "Method", "Status", "Transaction reference", "Date"],
    ...payouts.map((payout) => [
      payout.id,
      payout.amount,
      payout.currency,
      payout.paymentMethod,
      payout.status,
      payout.transactionReference || "",
      payout.paidAt || payout.createdAt,
    ]),
  ];
  const csv = rows.map((row) => row.map((cell) => `"${String(cell).replaceAll('"', '""')}"`).join(",")).join("\r\n");
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = "creator-payouts.csv";
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function SummaryCard({ label, value, detail, icon, tone }: { label: string; value: string; detail: string; icon: PublicIconName | PublicIconSidebarName; tone: string }) {
  return <MetricTile label={label} value={value} change={detail} icon={<PublicIcon name={icon} className="h-5 w-5" />} iconClassName={tone.split(" ").find((className) => className.startsWith("text-")) ?? "text-primary"} />;
}

export default function CreatorPayoutsPage() {
  const [token, setToken] = useState<string | null>(null);
  const [data, setData] = useState<FinanceData | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [requestingPayout, setRequestingPayout] = useState(false);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const storedToken = window.localStorage.getItem("marketplace-token") ?? "";
      setToken(storedToken);
      if (!storedToken) {
        setLoading(false);
        setError("Please sign in with your approved creator account.");
      }
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!token) return;
    const controller = new AbortController();
    const load = async () => {
      setLoading(true);
      setError("");
      try {
        const response = await fetch(`${apiUrl}/creator/finance/overview?page=1&pageSize=100`, {
          headers: { Authorization: `Bearer ${token}` },
          cache: "no-store",
          signal: controller.signal,
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || "Unable to load creator payout data.");
        setData(result as FinanceData);
      } catch (loadError) {
        if (!controller.signal.aborted) {
          setData(null);
          setError(loadError instanceof Error ? loadError.message : "Unable to load creator payout data.");
        }
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    };
    void load();
    return () => controller.abort();
  }, [refreshKey, token]);

  const usdSummary = data?.summary.find((summary) => summary.currency === "USD");
  const payouts = useMemo(() => (data?.payouts || []).filter((payout) => {
    const matchesStatus = !statusFilter || payout.status === statusFilter;
    const query = search.trim().toLowerCase();
    const matchesSearch = !query || [payout.id, payout.paymentMethod, payout.transactionReference, payout.status]
      .some((value) => String(value || "").toLowerCase().includes(query));
    return matchesStatus && matchesSearch;
  }), [data?.payouts, search, statusFilter]);
  const totalPaid = (data?.payouts || []).filter((payout) => payout.status === "paid")
    .reduce((total, payout) => total + Number(payout.amount || 0), 0);
  const pendingTotal = (data?.payouts || []).filter((payout) => ["pending_approval", "processing"].includes(payout.status))
    .reduce((total, payout) => total + Number(payout.amount || 0), 0);
  const minimum = Number(data?.settings?.minimumPayoutAmount || 100);
  const available = Number(usdSummary?.availableEarnings || 0);
  const canRequestPayout = Boolean(data?.payoutAccount) && available >= minimum;
  const commissionRate = Number(data?.settings?.commissionRate);
  const commissionLabel = Number.isFinite(commissionRate) ? `${Number((commissionRate * 100).toFixed(2))}%` : "Marketplace";

  async function requestPayout() {
    if (!token) return;
    setRequestingPayout(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch(`${apiUrl}/creator/finance/payouts/request`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Unable to request a payout.");
      setNotice("Payout request submitted for admin approval.");
      setRefreshKey((key) => key + 1);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Unable to request a payout.");
    } finally {
      setRequestingPayout(false);
    }
  }

  async function removePayoutAccount() {
    if (!token || !window.confirm("Remove the saved PayPal payout account?")) return;
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch(`${apiUrl}/creator/finance/paypal-account`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Unable to remove the payout account.");
      setNotice(result.message || "PayPal payout account removed.");
      setRefreshKey((key) => key + 1);
    } catch (removeError) {
      setError(removeError instanceof Error ? removeError.message : "Unable to remove the payout account.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mx-auto w-full max-w-[1400px]">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div><h1 className="text-2xl font-bold tracking-tight text-heading sm:text-[28px]">Payouts</h1><p className="mt-1 text-sm text-muted">Track verified earnings, holds, and payout history.</p></div>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="secondary" disabled={!data?.payouts.length} onClick={() => exportCsv(data?.payouts || [])}><PublicIcon name="down" className="h-3.5 w-3.5 rotate-180" />Export</Button>
        </div>
      </header>
      {error && <p role="alert" className="mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-xs text-red-700">{error}</p>}
      {notice && <p role="status" className="mt-4 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-xs text-emerald-700">{notice}</p>}
      <section className="mt-5 flex items-start gap-3 rounded-2xl border border-orange-200 bg-gradient-to-r from-orange-50 to-white p-4 sm:p-5">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-white text-primary shadow-sm"><PublicIcon name="verified" className="h-4 w-4" /></span>
        <div><h2 className="text-sm font-bold text-heading">Your order earnings already include the commission</h2><p className="mt-1 max-w-3xl text-xs leading-5 text-muted">The {commissionLabel} marketplace commission is applied once when a customer places an order. Your balance and payout amount already reflect it, so no additional commission is deducted when you request a payout.</p></div>
      </section>
      <section className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3" aria-label="Payout balances">
        <SummaryCard label="Available to withdraw" value={usdSummary ? money(usdSummary.availableEarnings) : "—"} detail="Verified USD earnings, after commission" icon="dollar" tone="bg-emerald-50 text-status-success" />
        <SummaryCard label="Payouts in progress" value={money(pendingTotal)} detail="Requested or processing" icon="notification" tone="bg-orange-50 text-primary" />
        <SummaryCard label="Total paid" value={money(totalPaid)} detail={`${(data?.payouts || []).filter((payout) => payout.status === "paid").length} completed payouts`} icon="verified" tone="bg-blue-50 text-status-info" />
        <SummaryCard label="Payout method" value={data?.payoutAccount ? "PayPal email" : "Not set"} detail={data?.payoutAccount ? "Legacy payout route · card setup pending" : "Hosted card setup is not configured"} icon="credit-card" tone="bg-purple-50 text-purple-600" />
        <SummaryCard label="Pending earnings" value={usdSummary ? money(usdSummary.pendingEarnings) : "—"} detail="Released after the 30-day hold" icon="notification" tone="bg-amber-50 text-amber-600" />
        <SummaryCard label="Earnings on hold" value={usdSummary ? money(usdSummary.onHoldAmount) : "—"} detail="Awaiting fee reconciliation or review" icon="clock-9" tone="bg-rose-50 text-rose-600" />
      </section>
      <div className="mt-5 grid gap-5 xl:grid-cols-[1.4fr_0.6fr]">
        <section className="overflow-hidden rounded-2xl border border-border bg-white shadow-sm">
          <div className="border-b border-divider px-5 py-4 sm:px-6">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <h2 className="text-sm font-bold text-heading">Payout History</h2>
              <div className="flex gap-2">
                <label className="relative"><span className="sr-only">Search payouts</span><PublicIcon name="search" className="absolute left-3 top-2.5 h-4 w-4 text-muted-faint" /><InputText value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search payouts..." className="h-9 w-full pl-9 text-xs sm:w-56" /></label>
                <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} className="h-9 rounded-lg border border-border-control bg-white px-3 text-xs text-body outline-none focus:border-primary" aria-label="Payout status filter">
                  <option value="">All Status</option><option value="pending_approval">Pending approval</option><option value="processing">Processing</option><option value="paid">Paid</option><option value="failed">Failed</option><option value="cancelled">Cancelled</option>
                </select>
              </div>
            </div>
          </div>
          {loading ? <p className="px-6 py-10 text-center text-sm text-muted">Loading payout records...</p> : <div className="overflow-x-auto">
            <Table className="min-w-[680px]"><TableHeader><tr><th className="px-6 py-3 font-medium">Payout ID</th><th className="py-3 font-medium">Amount</th><th className="py-3 font-medium">Method</th><th className="py-3 font-medium">Status</th><th className="py-3 font-medium">Date</th><th className="px-6 py-3 text-right font-medium">Reference</th></tr></TableHeader>
              <tbody>{payouts.map((payout) => <TableRow key={payout.id} className="text-body transition hover:bg-surface-hover">
                <td className="px-6 py-3 text-[10px] font-medium text-body-strong">#{payout.id}</td>
                <td className="py-3 font-semibold text-body-strong">{money(payout.amount, payout.currency)}</td>
                <td className="py-3 text-[10px] text-muted">{payout.paymentMethod}</td>
                <td className="py-3"><Badge tone={statusTone(payout.status)}>{payout.status.replaceAll("_", " ")}</Badge></td>
                <td className="py-3 text-[10px] text-muted">{new Date(payout.paidAt || payout.createdAt).toLocaleDateString()}</td>
                <td className="px-6 py-3 text-right text-[10px] text-muted">{payout.transactionReference || "—"}</td>
              </TableRow>)}</tbody>
            </Table>
            {!payouts.length && <p className="px-6 py-10 text-center text-sm text-muted">{data?.payouts.length ? "No payouts match these filters." : "No payout records yet."}</p>}
          </div>}
          <footer className="flex items-center justify-between border-t border-divider px-6 py-4 text-[10px] text-muted"><span>Showing {payouts.length} payout{payouts.length === 1 ? "" : "s"}</span><span>{data?.summary.length || 0} currency balances</span></footer>
        </section>
        <div className="space-y-5">
          <section className="rounded-2xl border border-border bg-white p-5 shadow-sm">
            <div className="flex items-start justify-between gap-3"><h2 className="text-sm font-bold text-heading">Payout eligibility</h2><Badge tone={data?.schedule?.isPaused ? "warning" : canRequestPayout ? "success" : "neutral"}>{data?.schedule?.isPaused ? "Paused" : canRequestPayout ? "Ready" : "Not ready"}</Badge></div>
            <p className="mt-5 text-2xl font-bold text-ink">{usdSummary ? money(usdSummary.availableEarnings) : "—"}</p>
            <div className="mt-5 flex items-end justify-between border-t border-divider pt-4 text-[9px] text-muted-soft"><span>Minimum {money(data?.settings?.minimumPayoutAmount || "100")}</span><span>USD only</span></div>
            <Button className="mt-4 w-full" size="sm" disabled={loading || requestingPayout || !data?.payoutAccount || available < minimum} onClick={requestPayout}>
              <PublicIcon name="credit-card" className="h-3.5 w-3.5" />{requestingPayout ? "Submitting..." : "Request payout"}
            </Button>
            {!loading && data && <p className={`mt-3 text-[11px] leading-5 ${canRequestPayout ? "text-status-success" : "text-muted"}`}>{!data.payoutAccount ? "Add a payout method to request a payout." : available < minimum ? `You need ${money(minimum - available)} more to reach the minimum.` : "Your balance meets the minimum. The payout amount already reflects order commission."}</p>}
          </section>
          <section className="rounded-2xl border border-border bg-white p-5 shadow-sm">
            <h2 className="text-sm font-bold text-heading">Payout Methods</h2>
            {data?.payoutAccount ? <div className="mt-4 flex items-center justify-between border-b border-divider pb-3">
              <div className="flex items-center gap-2"><span className="grid h-7 w-7 place-items-center rounded-md bg-blue-50 text-status-info"><PublicIcon name="credit-card" className="h-3.5 w-3.5" /></span><div><p className="text-[10px] font-semibold text-body-strong">Legacy PayPal payout</p><p className="text-[9px] text-muted-soft">{data.payoutAccount.maskedEmail}</p></div></div><Badge tone="warning">Email</Badge>
              <Button size="sm" variant="danger" className="mt-3 w-full" disabled={saving} onClick={removePayoutAccount}><PublicIcon name="delete" className="h-3.5 w-3.5" />Remove legacy PayPal account</Button>
            </div> : <p className="mt-4 border-b border-divider pb-3 text-xs text-muted">No payout destination is configured.</p>}
            <div className="mt-4 rounded-xl border border-orange-200 bg-orange-50/70 p-3">
              <p className="text-[10px] font-semibold text-heading">Credit/debit card payouts</p>
              <p className="mt-1 text-[10px] leading-5 text-muted">Not available yet. Buyer PayPal vault cards are for purchases only; Hyperwallet hosted payout-card onboarding has not been configured.</p>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
