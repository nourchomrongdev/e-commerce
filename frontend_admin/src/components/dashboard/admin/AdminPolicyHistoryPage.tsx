"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import PublicIcon from "@/components/icons/PublicIcon";
import { fetchPolicyHistory, listPolicies, type PolicyRecord, type PolicyVersion } from "@/lib/policyManagement";

type AdminPolicyHistoryPageProps = {
  policyKey: string;
};

function formatDate(value?: string | null) {
  if (!value) return "Not set";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Not set";
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(date);
}

export default function AdminPolicyHistoryPage({ policyKey }: AdminPolicyHistoryPageProps) {
  const [policy, setPolicy] = useState<PolicyRecord | null>(null);
  const [versions, setVersions] = useState<PolicyVersion[]>([]);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const policies = await listPolicies(true);
      const selected = policies.find((item) => item.key === policyKey) || null;
      setPolicy(selected);
      if (selected?.id != null) {
        const history = await fetchPolicyHistory(selected.id);
        setVersions(history);
      } else {
        setVersions([]);
      }
    } catch (error) {
      setPolicy(null);
      setVersions([]);
      setToast(error instanceof Error ? error.message : "Unable to load policy versions.");
    } finally {
      setLoading(false);
    }
  }, [policyKey]);

  useEffect(() => {
    const message = window.sessionStorage.getItem("policy-management-toast");
    let toastTimer: number | undefined;
    if (message) {
      window.sessionStorage.removeItem("policy-management-toast");
      toastTimer = window.setTimeout(() => setToast(message), 0);
    }
    const loadTimer = window.setTimeout(() => void load(), 0);
    return () => {
      if (toastTimer !== undefined) window.clearTimeout(toastTimer);
      window.clearTimeout(loadTimer);
    };
  }, [load]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 500);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const sortedVersions = useMemo(
    () => [...versions].sort((a, b) => Number(b.version || 0) - Number(a.version || 0)),
    [versions],
  );

  return (
    <div className="mx-auto w-full max-w-[1200px]">
      <header className="flex flex-col gap-4 border-b border-divider pb-5 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <Link href={`/admin/policies/${encodeURIComponent(policyKey)}`} className="text-xs font-medium text-primary no-underline hover:underline">
            {policy?.title || "Policy"}
          </Link>
          <h1 className="mt-2 text-2xl font-bold tracking-tight text-heading sm:text-[28px]">Version History</h1>
          <p className="mt-1 text-sm text-muted">Review published and draft versions of this policy.</p>
        </div>
      </header>

      <article className="mt-6 bg-white p-5 shadow-sm sm:p-6">
        {loading ? (
          <p className="py-10 text-center text-sm text-muted">Loading policy versions...</p>
        ) : sortedVersions.length === 0 ? (
          <div className="border-l-2 border-primary px-5 py-8">
            <h2 className="text-sm font-bold text-heading">No saved versions</h2>
            <p className="mt-2 text-xs leading-5 text-muted">Publish or save this policy to create version history.</p>
          </div>
        ) : (
          <div className="space-y-4">
            {sortedVersions.map((version) => {
              const isCurrent = version.status === "published";
              const isUpcoming = version.status === "draft";
              return (
                <section key={String(version.id ?? version.version)} className="border border-[#d6dfed] bg-[#FCFCFE]">
                  <div className="flex flex-col gap-4 border-b border-[#d6dfed] px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <h2 className="border-l-2 border-primary pl-3 text-sm font-bold text-heading">Version {Number(version.version || 1).toFixed(1).replace(".0", ".0")}</h2>
                        {isCurrent && <span className="rounded-md bg-status-success-surface px-2 py-1 text-[10px] font-semibold text-status-success">Current</span>}
                        {isUpcoming && !isCurrent && <span className="rounded-md bg-[#FFF7ED] px-2 py-1 text-[10px] font-semibold text-[#C55A12]">Upcoming</span>}
                        {!isCurrent && !isUpcoming && <span className="rounded-md bg-[#F1F5F9] px-2 py-1 text-[10px] font-semibold text-[#64748B]">Previous</span>}
                      </div>
                      <p className="mt-2 text-xs text-muted">{formatDate(version.createdAt || version.publishedAt)}</p>
                    </div>
                    <Link
                      href={`/admin/policies/${encodeURIComponent(policyKey)}/history/${encodeURIComponent(String(version.id ?? version.version))}`}
                      className="inline-flex h-9 items-center gap-2 rounded-md border border-[#d6dfed] bg-white px-3 text-xs font-semibold text-body-strong no-underline hover:border-[#FFD7B5] hover:text-primary"
                    >
                      <PublicIcon name="eye" className="h-4 w-4 text-[#66718E]" />
                      View Policy
                    </Link>
                  </div>
                  <div className="px-5 py-4">
                    <p className="text-xs font-semibold text-heading">{version.title}</p>
                    <p className="mt-2 line-clamp-2 text-xs leading-5 text-muted">{version.description || "No policy description was saved."}</p>
                  </div>
                </section>
              );
            })}
          </div>
        )}
      </article>
      {toast && <div className="fixed bottom-5 right-5 z-[200] rounded-lg bg-[#111827] px-4 py-3 text-xs font-semibold text-white shadow-xl">{toast}</div>}
    </div>
  );
}
