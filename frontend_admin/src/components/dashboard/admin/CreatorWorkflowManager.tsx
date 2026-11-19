"use client";

import { useEffect, useMemo, useState } from "react";
import PublicIcon from "@/components/icons/PublicIcon";
import ProductPagination from "@/components/products/ProductPagination";
import { Badge, Modal } from "@/components/ui";
import useDebouncedValue from "@/hooks/useDebouncedValue";

type Workflow = "applications" | "verifications";
type WorkflowRecord = {
  id: number;
  status: string;
  fullLegalName: string;
  email: string;
  country?: string;
  storeName?: string;
  businessOverview?: string;
  websiteUrl?: string | null;
  phoneNumber?: string | null;
  username?: string;
  reviewReason?: string | null;
  submittedAt: string;
  reviewedAt?: string | null;
  documentType?: string;
  documentMimeType?: string;
  documentSize?: number;
};
type PageResponse = {
  applications?: WorkflowRecord[];
  verifications?: WorkflowRecord[];
  pagination: { page: number; pageSize: number; total: number; pages: number };
};

const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:5000/api";
const statusChoices: Record<Workflow, string[]> = {
  applications: ["pending", "approved", "rejected", "suspended"],
  verifications: ["pending", "additional_info_required", "verified", "rejected", "revoked", "withdrawn"],
};

function statusTone(status: string): "success" | "warning" | "danger" | "neutral" {
  if (status === "approved" || status === "verified") return "success";
  if (status === "pending" || status === "additional_info_required") return "warning";
  if (status === "rejected" || status === "suspended" || status === "revoked") return "danger";
  return "neutral";
}

function reviewActions(workflow: Workflow, status: string): { status: string; label: string; needsReason: boolean }[] {
  if (workflow === "applications") {
    if (status === "pending") return [
      { status: "approved", label: "Approve", needsReason: false },
      { status: "rejected", label: "Reject", needsReason: true },
    ];
    if (status === "approved") return [{ status: "suspended", label: "Suspend", needsReason: true }];
    if (status === "suspended") return [{ status: "approved", label: "Reinstate", needsReason: false }];
    return [];
  }
  if (status === "pending") return [
    { status: "verified", label: "Verify", needsReason: false },
    { status: "additional_info_required", label: "Request information", needsReason: true },
    { status: "rejected", label: "Reject", needsReason: true },
  ];
  if (status === "verified") return [{ status: "revoked", label: "Revoke verification", needsReason: true }];
  return [];
}

function formatBytes(bytes?: number) {
  if (!bytes || bytes < 0) return "—";
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  let value = bytes;
  let unitIndex = -1;
  do {
    value /= 1024;
    unitIndex += 1;
  } while (value >= 1024 && unitIndex < units.length - 1);
  return `${value.toFixed(1)} ${units[unitIndex]}`;
}

export default function CreatorWorkflowManager({ workflow }: { workflow: Workflow }) {
  const isApplications = workflow === "applications";
  const title = isApplications ? "Creator Applications" : "Identity Verification Requests";
  const endpoint = isApplications ? "/admin/creator-applications" : "/admin/creator-verifications";
  const [token, setToken] = useState("");
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("pending");
  const debouncedSearch = useDebouncedValue(search.trim());
  const debouncedStatus = useDebouncedValue(status);
  const [page, setPage] = useState(1);
  const [refresh, setRefresh] = useState(0);
  const [result, setResult] = useState<PageResponse | null>(null);
  const [reasons, setReasons] = useState<Record<number, string>>({});
  const [selectedRecord, setSelectedRecord] = useState<WorkflowRecord | null>(null);
  const [loading, setLoading] = useState(false);
  const [workingId, setWorkingId] = useState<number | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    const timer = window.setTimeout(() => setToken(window.localStorage.getItem("marketplace-token") ?? ""), 0);
    return () => window.clearTimeout(timer);
  }, []);

  const query = useMemo(() => {
    const params = new URLSearchParams({ page: String(page), pageSize: "10" });
    if (debouncedSearch) params.set("search", debouncedSearch);
    if (debouncedStatus) params.set("status", debouncedStatus);
    return params.toString();
  }, [debouncedSearch, debouncedStatus, page]);

  useEffect(() => {
    if (!token || search.trim() !== debouncedSearch || status !== debouncedStatus) return;
    const controller = new AbortController();
    const load = async () => {
      setLoading(true);
      setError("");
      try {
        const response = await fetch(`${apiUrl}${endpoint}?${query}`, {
          headers: { Authorization: `Bearer ${token}` },
          cache: "no-store",
          signal: controller.signal,
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || `Unable to load ${title.toLowerCase()}.`);
        setResult(data as PageResponse);
      } catch (loadError) {
        if (loadError instanceof DOMException && loadError.name === "AbortError") return;
        setResult(null);
        setError(loadError instanceof Error ? loadError.message : `Unable to load ${title.toLowerCase()}.`);
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    };
    void load();
    return () => controller.abort();
  }, [debouncedSearch, debouncedStatus, endpoint, query, refresh, search, status, title, token]);

  const updateStatus = async (record: WorkflowRecord, nextStatus: string, needsReason: boolean) => {
    const reason = reasons[record.id]?.trim() || "";
    if (needsReason && !reason) {
      setError("Enter a review reason before submitting this decision.");
      return;
    }
    setWorkingId(record.id);
    setError("");
    setNotice("");
    try {
      const response = await fetch(`${apiUrl}${endpoint}/${record.id}`, {
        method: "PATCH",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ status: nextStatus, reason }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Unable to update this review.");
      setNotice(`${title.slice(0, -1)} #${record.id} updated to ${nextStatus.replaceAll("_", " ")}.`);
      setSelectedRecord(null);
      setRefresh((current) => current + 1);
    } catch (updateError) {
      setError(updateError instanceof Error ? updateError.message : "Unable to update this review.");
    } finally {
      setWorkingId(null);
    }
  };

  const downloadDocument = async (record: WorkflowRecord) => {
    if (!token) return;
    setWorkingId(record.id);
    setError("");
    try {
      const response = await fetch(`${apiUrl}${endpoint}/${record.id}/document`, {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || "Unable to download the identity document.");
      }
      const blob = await response.blob();
      const objectUrl = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = objectUrl;
      link.download = `identity-document-${record.id}.${record.documentMimeType === "application/pdf" ? "pdf" : "bin"}`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
    } catch (downloadError) {
      setError(downloadError instanceof Error ? downloadError.message : "Unable to download the identity document.");
    } finally {
      setWorkingId(null);
    }
  };

  const records = isApplications ? result?.applications ?? [] : result?.verifications ?? [];

  return (
    <div className="mx-auto w-full max-w-[1400px]">
      <header className="mb-6">
        <p className="mb-1 text-[10px] font-bold uppercase tracking-[0.1em] text-primary">Creator management</p>
        <h1 className="text-2xl font-bold tracking-tight text-heading sm:text-[28px]">{title}</h1>
        <p className="mt-1 text-sm text-muted">{isApplications ? "Review applications for creator account access." : "Review private identity documents for approved creators."}</p>
      </header>

      <div className="mb-4 flex flex-col gap-2 rounded-xl border border-border bg-white p-4 shadow-sm sm:flex-row">
        <label className="relative min-w-[12rem] flex-1">
          <span className="sr-only">Search {title}</span>
          <PublicIcon name="search" className="absolute left-3 top-2.5 h-4 w-4 text-muted-faint" />
          <input value={search} onChange={(event) => { setSearch(event.target.value); setPage(1); }} placeholder={`Search ${isApplications ? "applicants or stores" : "applicants or email"}...`} className="h-9 w-full rounded-lg border border-border-control pl-9 pr-3 text-xs outline-none focus:border-primary focus:ring-2 focus:ring-orange-100" />
        </label>
        <label>
          <span className="sr-only">Filter by status</span>
          <select value={status} onChange={(event) => { setStatus(event.target.value); setPage(1); }} className="h-9 min-w-44 rounded-lg border border-border-control bg-white px-3 text-xs text-body">
            <option value="">All statuses</option>
            {statusChoices[workflow].map((choice) => <option key={choice} value={choice}>{choice.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase())}</option>)}
          </select>
        </label>
      </div>

      {error && <p role="alert" className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}
      {notice && <p role="status" className="mb-4 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{notice}</p>}
      {token === "" && <p role="alert" className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">An administrator session is required to load these records.</p>}

      <section className="overflow-hidden rounded-xl border border-border bg-white shadow-sm">
        <div className="border-b border-divider px-5 py-3 text-xs text-muted">{result?.pagination ? `${result.pagination.total.toLocaleString()} requests` : "Database records"}</div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[900px] text-left text-xs">
            <thead className="bg-surface-muted text-[10px] uppercase tracking-wide text-muted">
              <tr>
                <th className="px-4 py-3 font-medium">Applicant</th>
                <th className="px-4 py-3 font-medium">Store / Country</th>
                <th className="px-4 py-3 font-medium">Submitted</th>
                {workflow === "verifications" && <th className="px-4 py-3 font-medium">Document</th>}
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 text-right font-medium">Review</th>
              </tr>
            </thead>
            <tbody>
              {records.map((record) => {
                return (
                  <tr key={record.id} className="border-t border-divider text-body hover:bg-surface-hover">
                    <td className="px-4 py-4 align-top">
                      <p className="font-semibold text-body-strong">{record.fullLegalName}</p>
                      <p className="mt-1 text-[10px] text-muted">{record.email}</p>
                      <p className="mt-1 text-[10px] text-muted">Application #{record.id}</p>
                    </td>
                    <td className="px-4 py-4 align-top">
                      <p className="font-medium">{record.storeName || "Identity check"}</p>
                      <p className="mt-1 text-[10px] text-muted">{record.country || "—"}</p>
                    </td>
                    <td className="px-4 py-4 align-top text-[10px] text-muted">{new Date(record.submittedAt).toLocaleString()}</td>
                    {workflow === "verifications" && (
                      <td className="px-4 py-4 align-top">
                        <p className="font-medium">{record.documentType?.replaceAll("_", " ") || "—"}</p>
                        <p className="mt-1 text-[10px] text-muted">{formatBytes(record.documentSize)}</p>
                      </td>
                    )}
                    <td className="px-4 py-4 align-top"><Badge tone={statusTone(record.status)}>{record.status.replaceAll("_", " ")}</Badge></td>
                    <td className="px-4 py-4 text-right align-top">
                      <button type="button" onClick={() => setSelectedRecord(record)} aria-label={`Actions for ${record.fullLegalName}`} className="ml-auto grid h-8 w-8 place-items-center rounded-lg border border-border-control text-muted transition hover:border-primary hover:bg-accent-light hover:text-primary"><PublicIcon name="ellipsis-vertical" className="h-4 w-4" /></button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {loading && <p className="px-6 py-12 text-center text-sm text-muted">Loading review requests...</p>}
          {!loading && !error && token && records.length === 0 && <p className="px-6 py-12 text-center text-sm text-muted">No review requests match these filters.</p>}
        </div>
        {result?.pagination && <ProductPagination count={records.length} total={result.pagination.total} page={result.pagination.page} pages={result.pagination.pages} itemLabel="requests" onPageChange={setPage} />}
      </section>

      <Modal open={Boolean(selectedRecord)} title={`${isApplications ? "Application" : "Verification"} actions`} onClose={() => setSelectedRecord(null)} size="lg">
        {selectedRecord && <div className="space-y-4">
          <div className="rounded-lg bg-surface-muted p-4">
            <p className="text-sm font-semibold text-body-strong">{selectedRecord.fullLegalName}</p>
            <p className="mt-1 text-xs text-muted">{selectedRecord.email} · {selectedRecord.storeName || "Identity check"} · {selectedRecord.country || "—"}</p>
            <p className="mt-1 text-[10px] text-muted">Submitted {new Date(selectedRecord.submittedAt).toLocaleString()}</p>
          </div>
          {selectedRecord.businessOverview && <div><p className="text-xs font-semibold text-body">Business overview</p><p className="mt-1 whitespace-pre-wrap text-xs leading-5 text-muted">{selectedRecord.businessOverview}</p></div>}
          {selectedRecord.reviewReason && <div><p className="text-xs font-semibold text-body">Previous review</p><p className="mt-1 whitespace-pre-wrap text-xs leading-5 text-muted">{selectedRecord.reviewReason}</p></div>}
          {(selectedRecord.websiteUrl || selectedRecord.phoneNumber || selectedRecord.username) && <p className="text-xs text-muted">{[selectedRecord.username && `@${selectedRecord.username}`, selectedRecord.phoneNumber, selectedRecord.websiteUrl].filter(Boolean).join(" · ")}</p>}
          {workflow === "verifications" && ["pending", "additional_info_required"].includes(selectedRecord.status) && <button type="button" disabled={workingId === selectedRecord.id} onClick={() => void downloadDocument(selectedRecord)} className="inline-flex items-center gap-2 rounded-lg border border-border-control px-3 py-2 text-xs font-semibold text-body hover:border-primary disabled:opacity-50"><PublicIcon name="download" className="h-4 w-4" />Download identity document</button>}
          {reviewActions(workflow, selectedRecord.status).length > 0 && <>
            <label className="block text-xs font-medium text-body">
              Reviewer note
              <textarea value={reasons[selectedRecord.id] ?? ""} onChange={(event) => setReasons((current) => ({ ...current, [selectedRecord.id]: event.target.value }))} maxLength={1000} rows={3} className="mt-1 w-full resize-y rounded-md border border-border-control p-3 text-xs outline-none focus:border-primary" placeholder="Required for rejection or other restrictive decisions" />
            </label>
            <div className="flex flex-wrap justify-end gap-2 border-t border-divider pt-4">
              {reviewActions(workflow, selectedRecord.status).map((action) => {
                const actionIcon = action.status === "approved" || action.status === "verified" ? "check" : action.status === "rejected" || action.status === "revoked" ? "x" : action.status === "suspended" ? "shield-minus" : "warning";
                const danger = ["rejected", "suspended", "revoked"].includes(action.status);
                return <button key={action.status} type="button" disabled={workingId === selectedRecord.id} onClick={() => void updateStatus(selectedRecord, action.status, action.needsReason)} className={`inline-flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-semibold disabled:opacity-50 ${danger ? "bg-status-danger-surface text-status-danger hover:bg-red-100" : action.status === "approved" || action.status === "verified" ? "bg-status-success-surface text-status-success hover:bg-emerald-100" : "bg-amber-50 text-amber-700 hover:bg-amber-100"}`}><PublicIcon name={actionIcon} className="h-3.5 w-3.5" />{workingId === selectedRecord.id ? "Saving..." : action.label}</button>;
              })}
            </div>
          </>}
        </div>}
      </Modal>
    </div>
  );
}
