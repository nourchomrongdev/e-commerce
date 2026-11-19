"use client";

import { useEffect, useMemo, useState } from "react";
import PublicIcon from "@/components/icons/PublicIcon";
import { MetricTile, Toast } from "@/components/ui";

const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:5000/api";
const statuses = [
  "Submitted", "Under Review", "Additional Information Required", "Approved",
  "Rejected", "Takedown Requested", "Content Disabled", "Counter-Notice Submitted",
  "Restoration Pending", "Restored", "Closed",
];
type DMCACase = {
  id: number;
  uuid: string;
  productId: number;
  productName: string | null;
  reporterName: string;
  reporterEmail: string;
  infringementDetails: string;
  status: string;
  requestedInformation: string | null;
  resolutionReason: string | null;
  restorationNotBefore: string | null;
  createdAt: string;
};
type DMCADetails = {
  case: DMCACase & { originalWork: string };
  evidence: Array<{ id: number; name: string; mimeType: string; fileSize: number }>;
  history: Array<{ previousStatus: string | null; newStatus: string; reason: string; createdAt: string; actorEmail: string | null }>;
  counterNotices: Array<{ statement: string; legalDeclaration: string; createdAt: string; submitterEmail: string | null }>;
};

function authHeaders() {
  return { Authorization: `Bearer ${window.localStorage.getItem("marketplace-token") || ""}` };
}

export default function ReviewerDMCAWorkflow() {
  const [cases, setCases] = useState<DMCACase[]>([]);
  const [details, setDetails] = useState<DMCADetails | null>(null);
  const [search, setSearch] = useState("");
  const [nextStatus, setNextStatus] = useState("");
  const [reason, setReason] = useState("");
  const [requestedInformation, setRequestedInformation] = useState("");
  const [restorationDate, setRestorationDate] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const loadCases = async () => {
    const response = await fetch(`${apiUrl}/reviewer/dmca/cases?search=${encodeURIComponent(search)}`, { headers: authHeaders() });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Unable to load copyright cases.");
    setCases(data.cases || []);
  };

  useEffect(() => {
    let active = true;
    setLoading(true);
    void loadCases()
      .catch((loadError) => { if (active) setError(loadError instanceof Error ? loadError.message : "Unable to load copyright cases."); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [search]);

  const counts = useMemo(() => ({
    total: cases.length,
    pending: cases.filter((item) => ["Submitted", "Under Review", "Additional Information Required"].includes(item.status)).length,
    disabled: cases.filter((item) => item.status === "Content Disabled").length,
    restored: cases.filter((item) => item.status === "Restored").length,
  }), [cases]);

  const openCase = async (item: DMCACase) => {
    setError("");
    setNotice("");
    try {
      const response = await fetch(`${apiUrl}/dmca/cases/${item.id}`, { headers: authHeaders() });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Unable to load the case.");
      setDetails(data);
      setNextStatus(item.status);
      setReason("");
      setRequestedInformation(item.requestedInformation || "");
      setRestorationDate(item.restorationNotBefore ? item.restorationNotBefore.slice(0, 10) : "");
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Unable to load the case.");
    }
  };

  const updateCase = async () => {
    if (!details) return;
    setError("");
    setNotice("");
    setBusy(true);
    try {
      const response = await fetch(`${apiUrl}/reviewer/dmca/cases/${details.case.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({
          status: nextStatus,
          reason,
          requestedInformation,
          restorationNotBefore: restorationDate || null,
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Unable to update the case.");
      setNotice("Case status and audit history updated.");
      await Promise.all([loadCases(), openCase(details.case)]);
    } catch (updateError) {
      setError(updateError instanceof Error ? updateError.message : "Unable to update the case.");
    } finally {
      setBusy(false);
    }
  };

  const downloadEvidence = async (caseId: number, evidenceId: number, name: string) => {
    setError("");
    try {
      const response = await fetch(`${apiUrl}/dmca/cases/${caseId}/evidence/${evidenceId}`, { headers: authHeaders() });
      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || "Unable to download evidence.");
      }
      const url = URL.createObjectURL(await response.blob());
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = name;
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (downloadError) {
      setError(downloadError instanceof Error ? downloadError.message : "Unable to download evidence.");
    }
  };

  return <div className="mx-auto w-full max-w-[1400px]">
    {notice && <Toast variant="success" message={notice} onClose={() => setNotice("")} />}
    <header className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
      <div><p className="mb-1 text-[10px] font-bold uppercase tracking-[0.1em] text-primary">DMCA management</p><h1 className="text-2xl font-bold tracking-tight text-heading sm:text-[28px]">DMCA Activity</h1><p className="mt-1 text-sm text-muted">Review copyright reports, evidence, counter-notices, takedowns, and restoration.</p></div>
      <label className="relative sm:w-64"><span className="sr-only">Search copyright cases</span><PublicIcon name="search" className="absolute left-3 top-2.5 h-4 w-4 text-muted-faint" /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search reports..." className="h-9 w-full rounded-lg border border-border-control pl-9 pr-3 text-xs text-body outline-none placeholder:text-muted-faint focus:border-primary" /></label>
    </header>
    {error && <p role="alert" className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-xs text-status-danger">{error}</p>}
    <div className="mt-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <MetricTile label="Cases" value={String(counts.total)} icon={<PublicIcon name="file-search-corner" className="h-5 w-5" />} />
      <MetricTile label="Pending Review" value={String(counts.pending)} icon={<PublicIcon name="clock-9" className="h-5 w-5" />} />
      <MetricTile label="Content Disabled" value={String(counts.disabled)} icon={<PublicIcon name="warning" className="h-5 w-5" />} />
      <MetricTile label="Restored" value={String(counts.restored)} icon={<PublicIcon name="check" className="h-5 w-5" />} />
    </div>
    <section className="mt-5 overflow-hidden rounded-2xl border border-border bg-white shadow-sm">
      <div className="border-b border-divider px-5 py-4"><h2 className="text-sm font-bold text-heading">Copyright cases</h2></div>
      {loading ? <p className="px-6 py-12 text-center text-sm text-muted">Loading cases…</p> : <div className="overflow-x-auto"><table className="w-full min-w-[900px] text-left text-xs"><thead className="bg-surface-muted text-[10px] text-muted"><tr>{["Case", "Product", "Reporter", "Filed", "Status", "Actions"].map((item) => <th key={item} className="px-5 py-3 font-medium">{item}</th>)}</tr></thead><tbody>{cases.map((item) => <tr key={item.uuid} className="border-t border-divider text-body transition hover:bg-surface-hover"><td className="px-5 py-3 font-medium text-body-strong">{item.uuid}</td><td className="px-5 py-3">{item.productName || `Product ${item.productId}`}</td><td className="px-5 py-3">{item.reporterName}<span className="block text-[10px] text-muted">{item.reporterEmail}</span></td><td className="px-5 py-3 text-[10px] text-muted">{new Date(item.createdAt).toLocaleDateString()}</td><td className="px-5 py-3"><span className="rounded-md bg-orange-50 px-2 py-1 text-[9px] font-semibold text-primary">{item.status}</span></td><td className="px-5 py-3"><button type="button" onClick={() => void openCase(item)} className="rounded-md border border-border-action px-3 py-1.5 text-xs hover:border-primary hover:text-primary">Review</button></td></tr>)}</tbody></table>{cases.length === 0 && <p className="px-6 py-12 text-center text-sm text-muted">No copyright cases found.</p>}</div>}
    </section>
    {details && <section className="mt-5 overflow-hidden rounded-2xl border border-border bg-white shadow-sm">
      <div className="flex items-center justify-between gap-3 border-b border-divider px-5 py-4"><div><h2 className="text-sm font-bold text-heading">{details.case.uuid} · {details.case.productName || `Product ${details.case.productId}`}</h2><p className="mt-1 text-xs text-muted">Submitted by {details.case.reporterName} ({details.case.reporterEmail})</p></div><button type="button" onClick={() => setDetails(null)} className="text-xs text-primary underline">Close</button></div>
      <div className="grid gap-5 p-5 lg:grid-cols-2">
        <div className="space-y-4"><div><h3 className="text-xs font-semibold text-heading">Original work</h3><p className="mt-1 whitespace-pre-wrap text-xs text-body">{details.case.originalWork}</p></div><div><h3 className="text-xs font-semibold text-heading">Infringement details</h3><p className="mt-1 whitespace-pre-wrap text-xs text-body">{details.case.infringementDetails}</p></div><div><h3 className="text-xs font-semibold text-heading">Evidence</h3>{details.evidence.length ? details.evidence.map((item) => <button key={item.id} type="button" onClick={() => void downloadEvidence(details.case.id, item.id, item.name)} className="mr-3 mt-2 text-xs text-primary underline">{item.name}</button>) : <p className="mt-1 text-xs text-muted">No evidence attached.</p>}</div><div><h3 className="text-xs font-semibold text-heading">Counter-notices</h3>{details.counterNotices.map((item, index) => <p key={`${item.createdAt}-${index}`} className="mt-2 whitespace-pre-wrap text-xs text-body">{item.statement}<span className="block text-[10px] text-muted">{item.submitterEmail || "Creator"} · {new Date(item.createdAt).toLocaleString()}</span></p>)}</div></div>
        <div className="space-y-4"><div><h3 className="text-xs font-semibold text-heading">Case history</h3><div className="mt-2 space-y-2">{details.history.map((item, index) => <p key={`${item.createdAt}-${index}`} className="text-[10px] text-muted">{item.previousStatus ? `${item.previousStatus} → ` : ""}{item.newStatus} · {new Date(item.createdAt).toLocaleString()}{item.reason ? ` · ${item.reason}` : ""}</p>)}</div></div><div className="border-t border-divider pt-4"><h3 className="text-xs font-semibold text-heading">Review action</h3><label className="mt-3 block text-xs text-body">Case status<select value={nextStatus} onChange={(event) => setNextStatus(event.target.value)} className="mt-1 h-10 w-full rounded-lg border border-border-control bg-white px-3 text-xs">{statuses.map((status) => <option key={status}>{status}</option>)}</select></label>{nextStatus === "Additional Information Required" && <label className="mt-3 block text-xs text-body">Requested information<textarea value={requestedInformation} onChange={(event) => setRequestedInformation(event.target.value)} rows={3} className="mt-1 w-full rounded-lg border border-border-control p-3 text-xs" /></label>}{nextStatus === "Restoration Pending" && <label className="mt-3 block text-xs text-body">Legally reviewed restoration date<input type="date" value={restorationDate} onChange={(event) => setRestorationDate(event.target.value)} className="mt-1 h-10 w-full rounded-lg border border-border-control px-3 text-xs" /></label>}<label className="mt-3 block text-xs text-body">Documented reason<textarea value={reason} onChange={(event) => setReason(event.target.value)} rows={3} className="mt-1 w-full rounded-lg border border-border-control p-3 text-xs" /></label><button type="button" disabled={busy} onClick={() => void updateCase()} className="mt-3 rounded-lg bg-primary px-4 py-2 text-xs font-semibold text-white disabled:opacity-50">{busy ? "Saving…" : "Save review decision"}</button></div></div>
      </div>
    </section>}
  </div>;
}
