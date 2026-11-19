"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import PublicIcon from "@/components/icons/PublicIcon";
import { Badge, Modal } from "@/components/ui";
import useDebouncedValue from "@/hooks/useDebouncedValue";

const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:5000/api";

type Activity = {
  id: number;
  action: string;
  entityType: string | null;
  entityId: number | null;
  description: string | null;
  ipAddress: string | null;
  userAgent: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
  actorId: number | null;
  actorName: string;
  actorEmail: string | null;
  actorRole: string | null;
  outcome: string | null;
  deviceIdentifier: string | null;
};

type Pagination = { page: number; pageSize: number; total: number; pages: number };
type ActivityResponse = { activities: Activity[]; pagination: Pagination };

type Filters = {
  search: string;
  action: string;
  module: string;
  from: string;
  to: string;
  outcome: string;
  sortBy: string;
  sortOrder: string;
};

const initialFilters: Filters = {
  search: "",
  action: "",
  module: "",
  from: "",
  to: "",
  outcome: "",
  sortBy: "createdAt",
  sortOrder: "desc",
};

function isSuccess(outcome: string | null) {
  return ["success", "successful", "completed"].includes((outcome ?? "").toLowerCase());
}

function statusLabel(outcome: string | null) {
  if (!outcome) return "Recorded";
  return outcome.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function dateLabel(value: string) {
  return new Date(value).toLocaleString();
}

function formatValue(value: unknown) {
  if (value === undefined || value === null) return "Not recorded";
  return typeof value === "string" ? value : JSON.stringify(value, null, 2);
}

function useAdminToken() {
  const [token, setToken] = useState<string | null>(null);
  useEffect(() => {
    const timer = window.setTimeout(() => setToken(window.localStorage.getItem("marketplace-token") ?? ""), 0);
    return () => window.clearTimeout(timer);
  }, []);
  return token;
}

export function AdminActivityList() {
  const router = useRouter();
  const token = useAdminToken();
  const [draft, setDraft] = useState(initialFilters);
  const filters = useDebouncedValue(draft);
  const [page, setPage] = useState(1);
  const [result, setResult] = useState<ActivityResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState("");
  const [refreshVersion, setRefreshVersion] = useState(0);
  const [selectedActivity, setSelectedActivity] = useState<Activity | null>(null);

  const query = useMemo(() => {
    const params = new URLSearchParams({ page: String(page), pageSize: "20" });
    for (const [key, value] of Object.entries(filters)) {
      if (value) params.set(key, value);
    }
    return params.toString();
  }, [filters, page]);

  useEffect(() => {
    if (!token || draft !== filters) return;
    const controller = new AbortController();
    const load = async () => {
      setLoading(true);
      setError("");
      try {
        const response = await fetch(`${apiUrl}/admin/activity?${query}`, {
          headers: { Authorization: `Bearer ${token}` },
          signal: controller.signal,
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error ?? "Unable to load activity records.");
        setResult(data as ActivityResponse);
      } catch (loadError) {
        if (loadError instanceof DOMException && loadError.name === "AbortError") return;
        setError(loadError instanceof Error ? loadError.message : "Unable to load activity records.");
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    };
    void load();
    return () => controller.abort();
  }, [draft, filters, query, refreshVersion, token]);

  const updateDraft = (key: keyof Filters, value: string) => {
    setDraft((current) => ({ ...current, [key]: value }));
    setPage(1);
  };

  const exportCsv = async () => {
    if (!token) {
      setError("An administrator session is required to export activity.");
      return;
    }
    setExporting(true);
    setError("");
    try {
      const params = new URLSearchParams();
      for (const [key, value] of Object.entries(filters)) {
        if (value) params.set(key, value);
      }
      const response = await fetch(`${apiUrl}/admin/activity/export.csv?${params}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error ?? "Unable to export activity records.");
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = "admin-activity.csv";
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (exportError) {
      setError(exportError instanceof Error ? exportError.message : "Unable to export activity records.");
    } finally {
      setExporting(false);
    }
  };

  const pagination = result?.pagination;

  return (
    <div className="mx-auto w-full max-w-[1400px]">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="mb-1 text-[10px] font-bold uppercase tracking-[0.1em] text-primary">Administration</p>
          <h1 className="text-2xl font-bold tracking-tight text-heading sm:text-[28px]">Activity Log</h1>
          <p className="mt-1 text-sm text-muted">Search and review server-recorded account and marketplace activity.</p>
        </div>
        <button
          type="button"
          onClick={() => void exportCsv()}
          disabled={exporting || !result?.pagination.total}
          className="inline-flex h-9 items-center gap-2 rounded-lg bg-primary px-4 text-xs font-semibold text-white transition hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-50"
        >
          <PublicIcon name="download" className="h-3.5 w-3.5" />{exporting ? "Exporting..." : "Export CSV"}
        </button>
      </header>

      <div className="mt-6 grid gap-3 rounded-xl border border-border bg-white p-4 shadow-sm sm:grid-cols-2 lg:grid-cols-4">
        <label className="text-xs font-medium text-body">
          Search
          <input value={draft.search} onChange={(event) => updateDraft("search", event.target.value)} placeholder="Actor, action, resource..." className="mt-1 h-9 w-full rounded-lg border border-border-control px-3 text-xs outline-none focus:border-primary focus:ring-2 focus:ring-orange-100" />
        </label>
        <label className="text-xs font-medium text-body">
          Action
          <input value={draft.action} onChange={(event) => updateDraft("action", event.target.value)} placeholder="Exact action" className="mt-1 h-9 w-full rounded-lg border border-border-control px-3 text-xs outline-none focus:border-primary focus:ring-2 focus:ring-orange-100" />
        </label>
        <label className="text-xs font-medium text-body">
          Module
          <input value={draft.module} onChange={(event) => updateDraft("module", event.target.value)} placeholder="Exact module" className="mt-1 h-9 w-full rounded-lg border border-border-control px-3 text-xs outline-none focus:border-primary focus:ring-2 focus:ring-orange-100" />
        </label>
        <label className="text-xs font-medium text-body">
          Result
          <select value={draft.outcome} onChange={(event) => updateDraft("outcome", event.target.value)} className="mt-1 h-9 w-full rounded-lg border border-border-control bg-white px-3 text-xs outline-none focus:border-primary">
            <option value="">All results</option>
            <option value="success">Success</option>
            <option value="failure">Failure</option>
          </select>
        </label>
        <label className="text-xs font-medium text-body">
          From
          <input type="date" value={draft.from} onChange={(event) => updateDraft("from", event.target.value)} className="mt-1 h-9 w-full rounded-lg border border-border-control px-3 text-xs outline-none focus:border-primary" />
        </label>
        <label className="text-xs font-medium text-body">
          Through
          <input type="date" value={draft.to} onChange={(event) => updateDraft("to", event.target.value)} className="mt-1 h-9 w-full rounded-lg border border-border-control px-3 text-xs outline-none focus:border-primary" />
        </label>
        <label className="text-xs font-medium text-body">
          Sort by
          <select value={draft.sortBy} onChange={(event) => updateDraft("sortBy", event.target.value)} className="mt-1 h-9 w-full rounded-lg border border-border-control bg-white px-3 text-xs outline-none focus:border-primary">
            <option value="createdAt">Date</option>
            <option value="action">Action</option>
            <option value="entityType">Module</option>
            <option value="entityId">Resource ID</option>
          </select>
        </label>
        <div className="flex items-end gap-2">
          <label className="sr-only" htmlFor="activity-sort-order">Sort order</label>
          <select id="activity-sort-order" value={draft.sortOrder} onChange={(event) => updateDraft("sortOrder", event.target.value)} className="h-9 flex-1 rounded-lg border border-border-control bg-white px-3 text-xs outline-none focus:border-primary">
            <option value="desc">Descending</option>
            <option value="asc">Ascending</option>
          </select>
        </div>
      </div>

      {error && <p role="alert" className="mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}
      {token === "" && <p role="alert" className="mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">An administrator session is required to load activity records.</p>}

      <section className="mt-5 overflow-hidden rounded-xl border border-border bg-white shadow-sm">
        <div className="flex items-center justify-between border-b border-divider px-5 py-3 text-xs text-muted">
          <span>{pagination ? `${pagination.total.toLocaleString()} recorded events` : "Activity records"}</span>
          <button type="button" onClick={() => setRefreshVersion((current) => current + 1)} className="inline-flex items-center gap-1.5 font-semibold text-primary hover:underline"><PublicIcon name="rotate-ccw" className="h-3.5 w-3.5" />Refresh</button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[900px] text-left text-xs">
            <thead className="bg-surface-muted text-[10px] uppercase tracking-wide text-muted">
              <tr>{["Occurred", "Actor", "Action", "Module / Resource", "Result", "IP address", "Actions"].map((heading) => <th key={heading} className="px-4 py-3 font-medium">{heading}</th>)}</tr>
            </thead>
            <tbody>
              {result?.activities.map((activity) => (
                <tr key={activity.id} className="border-t border-divider text-body hover:bg-surface-hover">
                  <td className="whitespace-nowrap px-4 py-3">{dateLabel(activity.createdAt)}</td>
                  <td className="px-4 py-3"><span className="font-medium text-body-strong">{activity.actorName}</span><span className="block text-[10px] text-muted">{activity.actorRole ?? "Role unavailable"}{activity.actorEmail ? ` · ${activity.actorEmail}` : ""}</span></td>
                  <td className="px-4 py-3 font-medium text-body-strong">{activity.action}</td>
                  <td className="px-4 py-3">{activity.entityType ?? "—"}{activity.entityId !== null ? ` #${activity.entityId}` : ""}</td>
                  <td className="px-4 py-3"><Badge tone={isSuccess(activity.outcome) ? "success" : activity.outcome ? "danger" : "neutral"}>{statusLabel(activity.outcome)}</Badge></td>
                  <td className="px-4 py-3">{activity.ipAddress ?? "—"}</td>
                  <td className="px-4 py-3 text-right"><button type="button" onClick={() => setSelectedActivity(activity)} aria-label={`Actions for activity ${activity.id}`} className="ml-auto grid h-8 w-8 place-items-center rounded-lg border border-border-control text-muted transition hover:border-primary hover:bg-accent-light hover:text-primary"><PublicIcon name="ellipsis-vertical" className="h-4 w-4" /></button></td>
                </tr>
              ))}
            </tbody>
          </table>
          {loading && <p className="px-6 py-12 text-center text-sm text-muted">Loading activity records...</p>}
          {!loading && !error && token && result && !result.activities.length && <p className="px-6 py-12 text-center text-sm text-muted">No activity records match these filters.</p>}
        </div>
        <footer className="flex items-center justify-between border-t border-divider px-5 py-3 text-xs text-muted">
          <span>Page {pagination?.page ?? page} of {pagination?.pages ?? 1}</span>
          <div className="flex gap-2">
            <button type="button" disabled={page <= 1 || loading} onClick={() => setPage((current) => Math.max(1, current - 1))} className="inline-flex h-8 items-center gap-1 rounded-md border border-border-control px-3 disabled:opacity-40"><PublicIcon name="arrow-left" className="h-3.5 w-3.5" />Previous</button>
            <button type="button" disabled={!pagination || page >= pagination.pages || loading} onClick={() => setPage((current) => current + 1)} className="inline-flex h-8 items-center gap-1 rounded-md border border-border-control px-3 disabled:opacity-40">Next<PublicIcon name="arrow-right" className="h-3.5 w-3.5" /></button>
          </div>
        </footer>
      </section>

      <Modal
        open={Boolean(selectedActivity)}
        title="Activity actions"
        onClose={() => setSelectedActivity(null)}
        footer={<>
          <button type="button" onClick={() => setSelectedActivity(null)} className="inline-flex items-center gap-2 rounded-lg border border-border-control px-3 py-2 text-xs font-semibold text-body"><PublicIcon name="x" className="h-3.5 w-3.5" />Close</button>
          <button type="button" onClick={() => {
            if (!selectedActivity) return;
            const activityId = selectedActivity.id;
            setSelectedActivity(null);
            router.push(`/admin/activity/${activityId}`);
          }} className="inline-flex items-center gap-2 rounded-lg bg-primary px-3 py-2 text-xs font-semibold text-white hover:bg-primary-hover"><PublicIcon name="view" className="h-3.5 w-3.5" />View details</button>
        </>}
      >
        {selectedActivity && <dl className="grid gap-3 text-xs sm:grid-cols-2">
          <div><dt className="text-muted">Occurred</dt><dd className="mt-1 font-medium text-body">{dateLabel(selectedActivity.createdAt)}</dd></div>
          <div><dt className="text-muted">Actor</dt><dd className="mt-1 font-medium text-body">{selectedActivity.actorName}</dd></div>
          <div><dt className="text-muted">Action</dt><dd className="mt-1 font-medium text-body">{selectedActivity.action}</dd></div>
          <div><dt className="text-muted">Module / resource</dt><dd className="mt-1 font-medium text-body">{selectedActivity.entityType ?? "—"}{selectedActivity.entityId !== null ? ` #${selectedActivity.entityId}` : ""}</dd></div>
          <div><dt className="text-muted">Result</dt><dd className="mt-1 font-medium text-body">{statusLabel(selectedActivity.outcome)}</dd></div>
          {selectedActivity.description && <div className="sm:col-span-2"><dt className="text-muted">Description</dt><dd className="mt-1 whitespace-pre-wrap font-medium text-body">{selectedActivity.description}</dd></div>}
        </dl>}
      </Modal>
    </div>
  );
}

export function AdminActivityDetail({ activityId }: { activityId: string }) {
  const token = useAdminToken();
  const [activity, setActivity] = useState<Activity | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!token) return;
    const controller = new AbortController();
    const load = async () => {
      setLoading(true);
      setError("");
      try {
        const response = await fetch(`${apiUrl}/admin/activity/${encodeURIComponent(activityId)}`, {
          headers: { Authorization: `Bearer ${token}` },
          signal: controller.signal,
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error ?? "Unable to load activity record.");
        setActivity(data.activity as Activity);
      } catch (loadError) {
        if (loadError instanceof DOMException && loadError.name === "AbortError") return;
        setError(loadError instanceof Error ? loadError.message : "Unable to load activity record.");
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    };
    void load();
    return () => controller.abort();
  }, [activityId, token]);

  const metadata = activity?.metadata ?? {};
  const before = metadata.before;
  const after = metadata.after;

  return (
    <div className="mx-auto w-full max-w-[1200px]">
      <header className="flex flex-col gap-4 border-b border-divider pb-5 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <Link href="/admin/activity" className="text-xs font-medium text-primary no-underline hover:underline">Activity log</Link>
          <h1 className="mt-2 text-2xl font-bold tracking-tight text-heading sm:text-[28px]">Activity Details</h1>
          <p className="mt-1 text-sm text-muted">Review the server-recorded audit event and available change context.</p>
        </div>
      </header>

      {error && <p role="alert" className="mt-5 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}
      {token === "" && <p role="alert" className="mt-5 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">An administrator session is required to load activity records.</p>}
      {loading && <p className="mt-6 rounded-xl border border-border bg-white p-8 text-center text-sm text-muted">Loading activity record...</p>}
      {!loading && !error && activity && (
        <article className="mt-6 rounded-xl border border-border bg-white p-5 shadow-sm sm:p-6">
          <section className="grid gap-6 border-b border-divider pb-6 lg:grid-cols-[minmax(0,1fr)_220px]">
            <div><h2 className="border-l-2 border-primary pl-3 text-sm font-bold text-heading">{activity.action}</h2><p className="mt-4 text-sm leading-6 text-body">{activity.description ?? "No description was recorded."}</p></div>
            <div className="border-t border-divider pt-4 lg:border-l lg:border-t-0 lg:pl-5 lg:pt-0"><h2 className="border-l-2 border-primary pl-3 text-sm font-bold text-heading">Result</h2><div className="mt-4"><Badge tone={isSuccess(activity.outcome) ? "success" : activity.outcome ? "danger" : "neutral"}>{statusLabel(activity.outcome)}</Badge></div><p className="mt-4 text-[10px] text-muted">{activity.entityType ?? "Marketplace"}{activity.entityId !== null ? ` · #${activity.entityId}` : ""}</p></div>
          </section>

          <section className="border-b border-divider py-6">
            <h2 className="border-l-2 border-primary pl-3 text-sm font-bold text-heading">Activity details</h2>
            <dl className="grid gap-4 pt-4 sm:grid-cols-2 lg:grid-cols-4">
              {[
                ["Actor", activity.actorName],
                ["Role", activity.actorRole ?? "Not available"],
                ["Actor ID", activity.actorId === null ? "Not available" : String(activity.actorId)],
                ["Occurred", dateLabel(activity.createdAt)],
                ["Resource ID", activity.entityId === null ? "Not available" : String(activity.entityId)],
                ["IP address", activity.ipAddress ?? "Not available"],
                ["Device identifier", activity.deviceIdentifier ?? "Not recorded"],
                ["User agent", activity.userAgent ?? "Not recorded"],
              ].map(([label, value]) => <div key={label} className="min-w-0 border-l border-divider pl-4"><dt className="text-[10px] font-semibold uppercase tracking-wide text-muted">{label}</dt><dd className="mt-1 break-words text-xs font-semibold text-body-strong">{value}</dd></div>)}
            </dl>
          </section>

          <section className="border-b border-divider py-6">
            <h2 className="border-l-2 border-primary pl-3 text-sm font-bold text-heading">Before / after</h2>
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              {[["Before", before], ["After", after]].map(([label, value]) => <div key={label} className="min-w-0 rounded-lg bg-surface-muted p-4"><p className="text-[10px] font-semibold uppercase tracking-wide text-muted">{label}</p><pre className="mt-2 max-h-80 overflow-auto whitespace-pre-wrap break-words text-xs text-body-strong">{formatValue(value)}</pre></div>)}
            </div>
          </section>

          <details className="pt-5">
            <summary className="cursor-pointer text-xs font-semibold text-primary">Show recorded metadata</summary>
            <pre className="mt-3 max-h-96 overflow-auto rounded-lg bg-surface-muted p-4 text-xs text-body-strong">{formatValue(metadata)}</pre>
          </details>
        </article>
      )}
    </div>
  );
}
