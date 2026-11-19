"use client";

import { useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
import PublicIcon from "@/components/icons/PublicIcon";
import useDebouncedValue from "@/hooks/useDebouncedValue";
import { Badge, Button, InputText, Modal, Table, TableHeader, TableRow } from "@/components/ui";

const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:5000/api";
type Payout = {
  id: string;
  uuid: string;
  amount: string;
  currency: string;
  paymentMethod: string;
  executionMode: string;
  status: string;
  transactionReference?: string | null;
  failureReason?: string | null;
  providerStatus?: string | null;
  providerBatchId?: string | null;
  createdAt: string;
  paidAt?: string | null;
  creatorName: string;
  creatorUsername: string;
};
type Hold = {
  id: string;
  earningId: string;
  holdType: string;
  reason: string;
  createdAt: string;
  currency: string;
  saleAmount: string;
  paymentMethod: string;
  productName: string;
  creatorName: string;
  creatorUsername: string;
};
type FinanceSettings = {
  commissionRate: string | number;
  minimumPayoutAmount: string;
  payoutCurrency: string;
  monthlyPayoutDay: number;
  automaticPayoutsEnabled: boolean;
};
type ProviderStatus = { enabled: boolean; configured: boolean; webhookConfigured: boolean; environment: string };

function money(value: string | number, currency = "USD") {
  const amount = Number(value);
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency }).format(Number.isFinite(amount) ? amount : 0);
  } catch {
    return `${currency} ${Number.isFinite(amount) ? amount.toFixed(2) : "0.00"}`;
  }
}

function commissionPercent(rate: string | number) {
  const percent = Number(rate) * 100;
  return Number.isFinite(percent) ? String(Number(percent.toFixed(2))) : "";
}

function statusTone(status: string): "success" | "warning" | "danger" | "neutral" {
  if (status === "paid") return "success";
  if (["pending_approval", "processing"].includes(status)) return "warning";
  if (["failed", "cancelled"].includes(status)) return "danger";
  return "neutral";
}

export default function AdminFinancePayouts() {
  const [token, setToken] = useState<string | null>(null);
  const [payouts, setPayouts] = useState<Payout[]>([]);
  const [holds, setHolds] = useState<Hold[]>([]);
  const [settings, setSettings] = useState<FinanceSettings | null>(null);
  const [provider, setProvider] = useState<ProviderStatus | null>(null);
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebouncedValue(search.trim());
  const [status, setStatus] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);
  const [selectedPayout, setSelectedPayout] = useState<Payout | null>(null);
  const [selectedEarning, setSelectedEarning] = useState<Hold | null>(null);
  const [transactionReference, setTransactionReference] = useState("");
  const [feeAmount, setFeeAmount] = useState("");
  const [feeReference, setFeeReference] = useState("");
  const [commissionRate, setCommissionRate] = useState("");
  const [minimumPayoutAmount, setMinimumPayoutAmount] = useState("");
  const [automaticPayoutsEnabled, setAutomaticPayoutsEnabled] = useState(true);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const storedToken = window.localStorage.getItem("marketplace-token") ?? "";
      setToken(storedToken);
      if (!storedToken) {
        setLoading(false);
        setError("An administrator session is required to load finance records.");
      }
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!token || search.trim() !== debouncedSearch) return;
    const controller = new AbortController();
    const load = async () => {
      setLoading(true);
      setError("");
      try {
        const headers = { Authorization: `Bearer ${token}` };
        const query = new URLSearchParams({ page: "1", pageSize: "100" });
        if (debouncedSearch) query.set("search", debouncedSearch);
        if (status) query.set("status", status);
        const [payoutResponse, holdResponse, settingsResponse] = await Promise.all([
          fetch(`${apiUrl}/admin/finance/payouts?${query}`, { headers, cache: "no-store", signal: controller.signal }),
          fetch(`${apiUrl}/admin/finance/holds?page=1&pageSize=100`, { headers, cache: "no-store", signal: controller.signal }),
          fetch(`${apiUrl}/admin/finance/settings`, { headers, cache: "no-store", signal: controller.signal }),
        ]);
        const [payoutData, holdData, settingsData] = await Promise.all([
          payoutResponse.json(), holdResponse.json(), settingsResponse.json(),
        ]);
        if (!payoutResponse.ok) throw new Error(payoutData.error || "Unable to load creator payouts.");
        if (!holdResponse.ok) throw new Error(holdData.error || "Unable to load earnings holds.");
        if (!settingsResponse.ok) throw new Error(settingsData.error || "Unable to load finance settings.");
        setPayouts(payoutData.payouts || []);
        setHolds(holdData.holds || []);
        setSettings(settingsData.settings || null);
        setProvider(settingsData.paypal || null);
        setCommissionRate(commissionPercent(settingsData.settings?.commissionRate ?? ""));
        setMinimumPayoutAmount(String(settingsData.settings?.minimumPayoutAmount ?? ""));
        setAutomaticPayoutsEnabled(Boolean(settingsData.settings?.automaticPayoutsEnabled));
      } catch (loadError) {
        if (controller.signal.aborted) return;
        setPayouts([]);
        setHolds([]);
        setError(loadError instanceof Error ? loadError.message : "Unable to load finance data.");
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    };
    void load();
    return () => controller.abort();
  }, [debouncedSearch, refreshKey, search, status, token]);

  const filteredPayouts = useMemo(() => payouts, [payouts]);

  async function sendAction(path: string, method: string, body?: unknown, successMessage = "Finance update saved.") {
    if (!token) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch(`${apiUrl}${path}`, {
        method,
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "The finance update could not be completed.");
      setNotice(result.message || successMessage);
      setSelectedPayout(null);
      setSelectedEarning(null);
      setRefreshKey((key) => key + 1);
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "The finance update could not be completed.");
    } finally {
      setBusy(false);
    }
  }

  async function saveSettings(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await sendAction("/admin/finance/settings", "PUT", {
      commissionRate: (Number(commissionRate) / 100).toFixed(4),
      minimumPayoutAmount,
      automaticPayoutsEnabled,
    }, "Finance settings saved.");
  }

  async function recordManualPayment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedPayout) return;
    await sendAction(`/admin/finance/payouts/${selectedPayout.id}/mark-paid`, "POST", { transactionReference });
    setTransactionReference("");
  }

  async function reconcileFee(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedEarning) return;
    await sendAction(`/admin/finance/earnings/${selectedEarning.earningId}/reconcile-fee`, "POST", {
      amount: feeAmount,
      externalReference: feeReference,
    }, "Provider fee reconciled.");
    setFeeAmount("");
    setFeeReference("");
  }

  return (
    <div className="mx-auto w-full max-w-[1400px]">
      <header className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div><p className="mb-1 text-[10px] font-bold uppercase tracking-[0.1em] text-primary">Administration</p><h1 className="text-2xl font-bold tracking-tight text-heading sm:text-[28px]">Creator Payouts</h1><p className="mt-1 text-sm text-muted">Review creator balances, payout requests, and provider-fee holds.</p></div>
      </header>
      {error && <p role="alert" className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}
      {notice && <p role="status" className="mb-4 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{notice}</p>}

      <section className="mb-5 rounded-2xl border border-orange-200 bg-gradient-to-r from-orange-50 to-white p-4 sm:p-5">
        <div className="flex items-start gap-3">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-white text-primary shadow-sm"><PublicIcon name="verified" className="h-4 w-4" /></span>
          <div>
            <h2 className="text-sm font-bold text-heading">Commission is applied when an order is placed</h2>
            <p className="mt-1 max-w-3xl text-xs leading-5 text-muted">Creator earnings and payout requests already reflect the marketplace commission. Do not deduct the commission again when reviewing or sending a payout. Provider processing-fee holds are tracked separately below.</p>
          </div>
        </div>
      </section>

      <section className="mb-5 rounded-2xl border border-border bg-white p-5 shadow-sm">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div><h2 className="text-sm font-bold text-heading">Commission &amp; payout settings</h2><p className="mt-1 text-xs text-muted">Set the order commission and the minimum USD payout amount.</p></div>
          <Badge tone={provider?.configured ? "success" : "warning"}>PayPal {provider?.configured ? `${provider.environment} configured` : "Payouts disabled"}</Badge>
        </div>
        <form onSubmit={saveSettings} className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-[minmax(12rem,1fr)_minmax(12rem,1fr)_auto_auto] lg:items-end">
          <label className="text-xs font-medium text-body-strong">Marketplace commission
            <span className="relative mt-2 block"><InputText type="number" min="0" max="100" step="0.01" value={commissionRate} onChange={(event) => setCommissionRate(event.target.value)} className="pr-10" required /><span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-xs text-muted">%</span></span>
            <span className="mt-1 block text-[10px] font-normal text-muted">Applied once to each order.</span>
          </label>
          <label className="text-xs font-medium text-body-strong">Minimum payout (USD)
            <InputText type="number" min="0.01" step="0.01" value={minimumPayoutAmount} onChange={(event) => setMinimumPayoutAmount(event.target.value)} className="mt-2" required />
            <span className="mt-1 block text-[10px] font-normal text-muted">Creators must reach this balance to request payment.</span>
          </label>
          <label className="flex min-h-10 items-center gap-2 text-xs text-body-strong"><input type="checkbox" checked={automaticPayoutsEnabled} onChange={(event) => setAutomaticPayoutsEnabled(event.target.checked)} className="h-4 w-4 accent-orange-500" />Automatic payouts</label>
          <Button type="submit" size="sm" className="min-h-10" disabled={busy || !settings}><PublicIcon name="verified" className="h-3.5 w-3.5" />{busy ? "Saving..." : "Save settings"}</Button>
        </form>
        <p className="mt-4 border-t border-divider pt-3 text-[10px] text-muted">PayPal Payouts: {provider?.configured ? "enabled and credentialed" : "disabled or missing local credentials"} · Webhook: {provider?.webhookConfigured ? "configured" : "not configured"}</p>
      </section>

      <div className="mb-4 flex flex-col gap-3 rounded-2xl border border-border bg-white p-4 shadow-sm sm:flex-row">
        <label className="relative min-w-[12rem] flex-1"><span className="sr-only">Search payouts</span><PublicIcon name="search" className="absolute left-3 top-2.5 h-4 w-4 text-muted-faint" /><InputText value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search creator payouts..." className="h-9 pl-9 text-xs" /></label>
        <label><span className="sr-only">Filter payout status</span><select value={status} onChange={(event) => setStatus(event.target.value)} className="h-9 min-w-40 rounded-lg border border-border-control bg-white px-3 text-xs text-body"><option value="">All statuses</option><option value="pending_approval">Pending approval</option><option value="processing">Processing</option><option value="paid">Paid</option><option value="failed">Failed</option><option value="cancelled">Cancelled</option></select></label>
      </div>

      <section className="overflow-hidden rounded-2xl border border-border bg-white shadow-sm">
        <div className="flex flex-col gap-1 border-b border-divider px-5 py-4 sm:flex-row sm:items-center sm:justify-between"><div><h2 className="text-sm font-bold text-heading">Payout requests</h2><p className="mt-1 text-xs text-muted">Review status, payment method, and payout reference.</p></div><span className="text-xs text-muted">{filteredPayouts.length} {filteredPayouts.length === 1 ? "request" : "requests"} · USD</span></div>
        <div className="overflow-x-auto">
          <Table className="min-w-[900px]"><TableHeader><tr><th className="px-4 py-3 font-medium">Creator</th><th className="py-3 font-medium">Amount</th><th className="py-3 font-medium">Method</th><th className="py-3 font-medium">Status</th><th className="py-3 font-medium">Created</th><th className="py-3 font-medium">Reference</th><th className="px-4 py-3 text-right font-medium">Actions</th></tr></TableHeader>
            <tbody>{filteredPayouts.map((payout) => <TableRow key={payout.id} className="text-body transition hover:bg-surface-hover">
              <td className="px-4 py-3"><strong className="block text-xs text-body-strong">{payout.creatorName}</strong><span className="text-[10px] text-muted">@{payout.creatorUsername}</span></td>
              <td className="py-3 text-xs font-semibold text-body-strong">{money(payout.amount, payout.currency)}</td>
              <td className="py-3 text-[10px] text-muted">{payout.paymentMethod}</td>
              <td className="py-3"><Badge tone={statusTone(payout.status)}>{payout.status.replaceAll("_", " ")}</Badge>{payout.providerStatus && <span className="ml-1 text-[9px] text-muted">{payout.providerStatus}</span>}</td>
              <td className="py-3 text-[10px] text-muted">{new Date(payout.paidAt || payout.createdAt).toLocaleDateString()}</td>
              <td className="py-3 text-[10px] text-muted">{payout.transactionReference || payout.failureReason || "—"}</td>
              <td className="px-4 py-3 text-right">
                <div className="flex justify-end gap-1">
                  {payout.status === "pending_approval" && payout.executionMode !== "paypal" && <button type="button" onClick={() => { setSelectedPayout(payout); setTransactionReference(""); }} aria-label={`Record payment for ${payout.creatorName}`} title="Record manual payment" className="grid h-8 w-8 place-items-center rounded-md border border-border-action text-muted hover:border-primary hover:text-primary"><PublicIcon name="verified" className="h-4 w-4" /></button>}
                  {provider?.configured && ["pending_approval", "failed"].includes(payout.status) && <button type="button" onClick={() => void sendAction(`/admin/finance/payouts/${payout.id}/send-paypal`, "POST", undefined, "PayPal payout submitted.")} aria-label={`Send PayPal payout to ${payout.creatorName}`} title="Send with PayPal" className="grid h-8 w-8 place-items-center rounded-md border border-border-action text-muted hover:border-primary hover:text-primary"><PublicIcon name="credit-card" className="h-4 w-4" /></button>}
                  {payout.status === "processing" && payout.providerBatchId && <button type="button" onClick={() => void sendAction(`/admin/finance/payouts/${payout.id}/sync-paypal`, "POST", undefined, "PayPal payout status synchronized.")} aria-label={`Synchronize PayPal payout for ${payout.creatorName}`} title="Sync PayPal status" className="grid h-8 w-8 place-items-center rounded-md border border-border-action text-muted hover:border-primary hover:text-primary"><PublicIcon name="rotate-ccw" className="h-4 w-4" /></button>}
                </div>
              </td>
            </TableRow>)}</tbody>
          </Table>
          {loading && <p className="px-6 py-10 text-center text-sm text-muted">Loading creator payout records...</p>}
          {!loading && !filteredPayouts.length && <p className="px-6 py-10 text-center text-sm text-muted">No payout records match these filters.</p>}
        </div>
      </section>

      <section className="mt-6 overflow-hidden rounded-2xl border border-border bg-white shadow-sm">
        <div className="border-b border-divider px-5 py-4"><h2 className="text-sm font-bold text-heading">Provider-fee holds</h2><p className="mt-1 text-xs text-muted">Payment-provider fees awaiting reconciliation. These are separate from the marketplace commission already applied to the order.</p></div>
        <div className="overflow-x-auto">
          <Table className="min-w-[800px]"><TableHeader><tr><th className="px-4 py-3 font-medium">Creator / Product</th><th className="py-3 font-medium">Reason</th><th className="py-3 font-medium">Payment</th><th className="py-3 font-medium">Sale</th><th className="px-4 py-3 text-right font-medium">Action</th></tr></TableHeader>
            <tbody>{holds.map((hold) => <TableRow key={hold.id} className="text-body">
              <td className="px-4 py-3"><strong className="block text-xs text-body-strong">{hold.creatorName}</strong><span className="text-[10px] text-muted">{hold.productName}</span></td>
              <td className="py-3 text-[10px] text-muted">{hold.reason}</td><td className="py-3 text-[10px] text-muted">{hold.paymentMethod}</td><td className="py-3 text-xs">{money(hold.saleAmount, hold.currency)}</td>
              <td className="px-4 py-3 text-right">{hold.holdType === "provider_fee_pending" && <Button size="sm" variant="secondary" onClick={() => { setSelectedEarning(hold); setFeeAmount(""); setFeeReference(""); }}>Reconcile fee</Button>}</td>
            </TableRow>)}</tbody>
          </Table>
          {!loading && !holds.length && <p className="px-6 py-8 text-center text-sm text-muted">No active earnings holds.</p>}
        </div>
      </section>

      <Modal open={Boolean(selectedPayout)} title="Record manual payout" onClose={() => setSelectedPayout(null)} footer={<><Button size="sm" variant="secondary" onClick={() => setSelectedPayout(null)}>Cancel</Button><Button size="sm" type="submit" form="manual-payout-form" disabled={busy}>Confirm payment</Button></>}>
        <form id="manual-payout-form" onSubmit={recordManualPayment} className="space-y-4">
          <p className="text-sm text-muted">Confirm that {selectedPayout ? money(selectedPayout.amount, selectedPayout.currency) : ""} was sent outside PayPal.</p>
          <label className="block text-xs font-medium text-body-strong">Transaction reference<InputText value={transactionReference} onChange={(event) => setTransactionReference(event.target.value)} className="mt-2" maxLength={255} required /></label>
        </form>
      </Modal>
      <Modal open={Boolean(selectedEarning)} title="Reconcile provider fee" onClose={() => setSelectedEarning(null)} footer={<><Button size="sm" variant="secondary" onClick={() => setSelectedEarning(null)}>Cancel</Button><Button size="sm" type="submit" form="fee-reconciliation-form" disabled={busy}>Confirm fee</Button></>}>
        <form id="fee-reconciliation-form" onSubmit={reconcileFee} className="space-y-4">
          <p className="text-sm text-muted">{selectedEarning?.creatorName} · {selectedEarning?.productName} · {selectedEarning?.currency}</p>
          <label className="block text-xs font-medium text-body-strong">Confirmed processing fee<InputText type="number" min="0" step="0.01" value={feeAmount} onChange={(event) => setFeeAmount(event.target.value)} className="mt-2" required /></label>
          <label className="block text-xs font-medium text-body-strong">Provider reference (optional)<InputText value={feeReference} onChange={(event) => setFeeReference(event.target.value)} className="mt-2" maxLength={255} /></label>
        </form>
      </Modal>
    </div>
  );
}
