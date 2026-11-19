"use client";

import { useCallback, useEffect, useState } from "react";
import PublicIcon from "@/components/icons/PublicIcon";
import ProductPagination from "@/components/products/ProductPagination";
import { Badge, Button, MetricTile, Modal } from "@/components/ui";
import useDebouncedValue from "@/hooks/useDebouncedValue";

const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:5000/api";
const pageSize = 10;
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
  status: string;
  requestedInformation: string | null;
  restorationNotBefore: string | null;
  createdAt: string;
};
type CaseDetails = {
  case: DMCACase & { originalWork: string; infringementDetails: string };
  evidence: Array<{ id: number; name: string; mimeType: string; fileSize: number }>;
  history: Array<{ previousStatus: string | null; newStatus: string; reason: string; createdAt: string }>;
  counterNotices: Array<{ statement: string; createdAt: string; submitterEmail: string | null }>;
};

function authHeaders(json = false) {
  return {
    ...(json ? { "Content-Type": "application/json" } : {}),
    Authorization: `Bearer ${window.localStorage.getItem("marketplace-token") || ""}`,
  };
}

export default function AdminDMCAWorkflow() {
  const [cases, setCases] = useState<DMCACase[]>([]);
  const [details, setDetails] = useState<CaseDetails | null>(null);
  const [status, setStatus] = useState("Submitted");
  const [reason, setReason] = useState("");
  const [requestedInformation, setRequestedInformation] = useState("");
  const [restorationDate, setRestorationDate] = useState("");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const debouncedSearch = useDebouncedValue(search.trim());
  const debouncedStatusFilter = useDebouncedValue(statusFilter);
  const [page, setPage] = useState(1);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const loadCases = useCallback(async (signal?: AbortSignal) => {
    const response = await fetch(`${apiUrl}/reviewer/dmca/cases?search=${encodeURIComponent(debouncedSearch)}`, { headers: authHeaders(), signal });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Unable to load copyright cases.");
    setCases(data.cases || []);
  }, [debouncedSearch]);

  useEffect(() => {
    const controller = new AbortController();
    const load = async () => {
      setLoading(true);
      try {
        await loadCases(controller.signal);
      } catch (loadError) {
        if (!controller.signal.aborted) setError(loadError instanceof Error ? loadError.message : "Unable to load cases.");
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    };
    void load();
    return () => controller.abort();
  }, [loadCases]);

  const openCase = async (item: DMCACase) => {
    setError("");
    try {
      const response = await fetch(`${apiUrl}/dmca/cases/${item.id}`, { headers: authHeaders() });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Unable to load the case.");
      setDetails(data);
      setStatus(item.status);
      setReason("");
      setRequestedInformation(item.requestedInformation || "");
      setRestorationDate(item.restorationNotBefore?.slice(0, 10) || "");
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Unable to load the case.");
    }
  };

  const saveReview = async () => {
    if (!details) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch(`${apiUrl}/reviewer/dmca/cases/${details.case.id}`, {
        method: "PATCH",
        headers: authHeaders(true),
        body: JSON.stringify({ status, reason, requestedInformation, restorationNotBefore: restorationDate || null }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Unable to update the case.");
      setNotice("Review decision and case history saved.");
      await loadCases();
      const detailResponse = await fetch(`${apiUrl}/dmca/cases/${details.case.id}`, { headers: authHeaders() });
      const detailData = await detailResponse.json();
      if (!detailResponse.ok) throw new Error(detailData.error || "Decision saved, but case details could not be refreshed.");
      setDetails(detailData);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Unable to save the case.");
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

  const filteredCases = cases.filter((item) => !debouncedStatusFilter || item.status === debouncedStatusFilter);
  const totalPages = Math.max(1, Math.ceil(filteredCases.length / pageSize));
  const activePage = Math.min(page, totalPages);
  const visibleCases = filteredCases.slice((activePage - 1) * pageSize, activePage * pageSize);
  const pendingCount = cases.filter((item) => ["Submitted", "Under Review", "Additional Information Required", "Counter-Notice Submitted", "Restoration Pending"].includes(item.status)).length;
  const disabledCount = cases.filter((item) => item.status === "Content Disabled").length;
  const restoredCount = cases.filter((item) => item.status === "Restored").length;

  return <div className="mx-auto w-full max-w-[1400px]">
    <header className="mb-5">
      <p className="mb-1 text-[10px] font-bold uppercase tracking-[0.12em] text-primary">Administration</p>
      <h1 className="text-2xl font-bold tracking-tight text-heading sm:text-[28px]">DMCA Activity</h1>
      <p className="mt-1 text-sm text-muted">Review copyright cases, evidence, counter-notices, and restoration requests.</p>
    </header>
    {error && <p role="alert" className="mb-4 rounded-lg bg-red-50 px-3 py-2 text-xs text-status-danger">{error}</p>}
    {notice && <p role="status" className="mb-4 rounded-lg bg-emerald-50 px-3 py-2 text-xs text-status-success">{notice}</p>}
    <div className="mb-5 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <MetricTile label="Total reports" value={cases.length} icon={<PublicIcon name="file-search-corner" className="h-4 w-4" />} />
      <MetricTile label="Awaiting review" value={pendingCount} icon={<PublicIcon name="clock-9" className="h-4 w-4" />} />
      <MetricTile label="Content disabled" value={disabledCount} icon={<PublicIcon name="shield-minus" className="h-4 w-4" />} />
      <MetricTile label="Restored" value={restoredCount} icon={<PublicIcon name="check" className="h-4 w-4" />} />
    </div>
    <section className="overflow-hidden rounded-2xl border border-border bg-white shadow-sm">
      <div className="border-b border-divider px-5 py-4"><h2 className="text-sm font-bold text-heading">Copyright cases</h2></div>
      <div className="flex flex-col gap-3 border-b border-divider p-4 sm:flex-row sm:items-center">
        <label className="relative block min-w-56 flex-1 sm:max-w-sm">
          <PublicIcon name="search" className="absolute left-3 top-2.5 h-4 w-4 text-muted-faint" />
          <input value={search} onChange={(event) => { setSearch(event.target.value); setPage(1); }} placeholder="Search cases..." className="h-9 w-full rounded-lg border border-border-control pl-9 pr-3 text-xs" />
        </label>
        <label className="sr-only" htmlFor="dmca-status-filter">Filter by status</label>
        <select id="dmca-status-filter" value={statusFilter} onChange={(event) => { setStatusFilter(event.target.value); setPage(1); }} className="h-9 rounded-lg border border-border-control bg-white px-3 text-xs text-body">
          <option value="">All statuses</option>
          {statuses.map((item) => <option key={item} value={item}>{item}</option>)}
        </select>
      </div>
      {loading ? <p className="px-5 py-6 text-sm text-muted">Loading cases…</p> : <div className="overflow-x-auto">
        <table className="w-full min-w-[850px] text-left text-xs">
          <thead className="bg-surface-muted text-[10px] text-muted"><tr>{["Case", "Product", "Reporter", "Filed", "Status", "Actions"].map((item) => <th key={item} className="px-4 py-3 font-medium">{item}</th>)}</tr></thead>
          <tbody>{visibleCases.map((item) => <tr key={item.uuid} className="border-t border-divider">
            <td className="px-4 py-3 font-medium text-heading">{item.uuid}</td>
            <td className="px-4 py-3">{item.productName || `Product ${item.productId}`}</td>
            <td className="px-4 py-3">{item.reporterEmail}</td>
            <td className="px-4 py-3">{new Date(item.createdAt).toLocaleDateString()}</td>
            <td className="px-4 py-3"><Badge tone={["Rejected", "Content Disabled"].includes(item.status) ? "danger" : ["Restored", "Closed", "Approved"].includes(item.status) ? "success" : ["Submitted", "Under Review", "Counter-Notice Submitted", "Restoration Pending"].includes(item.status) ? "warning" : "neutral"}>{item.status}</Badge></td>
            <td className="px-4 py-3"><Button size="sm" variant="secondary" aria-label={`Review ${item.uuid}`} onClick={() => void openCase(item)}><PublicIcon name="ellipsis-vertical" className="h-4 w-4" /></Button></td>
          </tr>)}</tbody>
        </table>
        {filteredCases.length === 0 && <p className="px-5 py-8 text-center text-sm text-muted">{cases.length ? "No cases match this status." : "No copyright cases found."}</p>}
      </div>}
      {!loading && <ProductPagination count={visibleCases.length} total={filteredCases.length} page={activePage} pages={totalPages} itemLabel="cases" onPageChange={setPage} />}
    </section>
    <Modal
      open={Boolean(details)}
      title={details ? `${details.case.uuid} · ${details.case.productName || `Product ${details.case.productId}`}` : "Review copyright case"}
      onClose={() => setDetails(null)}
      size="lg"
      footer={<>
        <Button variant="secondary" onClick={() => setDetails(null)}>Close</Button>
        <Button disabled={busy} onClick={() => void saveReview()}>{busy ? "Saving…" : "Save review decision"}</Button>
      </>}
    >
      {details && <div className="grid gap-5 lg:grid-cols-2">
        <div className="space-y-4">
          <div><h3 className="text-xs font-semibold text-heading">Reporter</h3><p className="mt-1 text-xs text-muted">{details.case.reporterName} · {details.case.reporterEmail}</p></div>
          <div><h3 className="text-xs font-semibold text-heading">Original work</h3><p className="mt-1 whitespace-pre-wrap text-xs text-muted">{details.case.originalWork}</p></div>
          <div><h3 className="text-xs font-semibold text-heading">Infringement details</h3><p className="mt-1 whitespace-pre-wrap text-xs text-muted">{details.case.infringementDetails}</p></div>
          <div><h3 className="text-xs font-semibold text-heading">Evidence</h3>{details.evidence.length ? details.evidence.map((item) => <button key={item.id} type="button" onClick={() => void downloadEvidence(details.case.id, item.id, item.name)} className="mr-3 mt-2 text-xs text-primary underline">{item.name}</button>) : <p className="mt-1 text-xs text-muted">No evidence attached.</p>}</div>
          <div><h3 className="text-xs font-semibold text-heading">Counter-notices</h3>{details.counterNotices.map((item, index) => <p key={`${item.createdAt}-${index}`} className="mt-2 whitespace-pre-wrap text-xs text-muted">{item.statement}<span className="block text-[10px]">{item.submitterEmail || "Creator"} · {new Date(item.createdAt).toLocaleString()}</span></p>)}</div>
        </div>
        <div className="space-y-4">
          <div><h3 className="text-xs font-semibold text-heading">Case history</h3><div className="mt-2 space-y-2">{details.history.map((item, index) => <p key={`${item.createdAt}-${index}`} className="text-[10px] text-muted">{item.previousStatus ? `${item.previousStatus} → ` : ""}{item.newStatus} · {new Date(item.createdAt).toLocaleString()}{item.reason ? ` · ${item.reason}` : ""}</p>)}</div></div>
          <div className="border-t border-divider pt-4">
            <h3 className="text-xs font-semibold text-heading">Review action</h3>
            <label className="mt-3 block text-xs text-body">Status<select value={status} onChange={(event) => setStatus(event.target.value)} className="mt-1 h-10 w-full rounded-lg border border-border-control bg-white px-3">{statuses.map((item) => <option key={item}>{item}</option>)}</select></label>
            {status === "Additional Information Required" && <label className="mt-3 block text-xs text-body">Information requested<textarea value={requestedInformation} onChange={(event) => setRequestedInformation(event.target.value)} rows={3} className="mt-1 w-full rounded-lg border border-border-control p-3" /></label>}
            {status === "Restoration Pending" && <label className="mt-3 block text-xs text-body">Reviewed restoration date<input type="date" value={restorationDate} onChange={(event) => setRestorationDate(event.target.value)} className="mt-1 h-10 w-full rounded-lg border border-border-control px-3" /></label>}
            <label className="mt-3 block text-xs text-body">Documented reason<textarea value={reason} onChange={(event) => setReason(event.target.value)} rows={3} className="mt-1 w-full rounded-lg border border-border-control p-3" /></label>
          </div>
        </div>
      </div>}
    </Modal>
  </div>;
}
