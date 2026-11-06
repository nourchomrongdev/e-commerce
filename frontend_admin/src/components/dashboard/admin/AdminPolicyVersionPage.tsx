"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { deletePolicyVersion, fetchPolicyHistory, listPolicies, restorePolicy, setPolicyVersionCurrent, type PolicyRecord, type PolicyVersion } from "@/lib/policyManagement";

type AdminPolicyVersionPageProps = {
  policyKey: string;
  versionId: string;
};

function formatDate(value?: string | null) {
  if (!value) return "Not set";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Not set";
  return new Intl.DateTimeFormat("en-US", { month: "long", day: "numeric", year: "numeric" }).format(date);
}

function getSafeHtml(value?: string | null) {
  return String(value || "")
    .replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, "")
    .replace(/<(style|iframe|object|embed)[^>]*>[\s\S]*?<\/\1\s*>/gi, "")
    .replace(/<(style|iframe|object|embed)[^>]*\/?>/gi, "")
    .replace(/\son[a-z]+\s*=\s*(["'])[\s\S]*?\1/gi, "")
    .replace(/javascript:/gi, "");
}

export default function AdminPolicyVersionPage({ policyKey, versionId }: AdminPolicyVersionPageProps) {
  const router = useRouter();
  const [policy, setPolicy] = useState<PolicyRecord | null>(null);
  const [version, setVersion] = useState<PolicyVersion | null>(null);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [deleteConfirmation, setDeleteConfirmation] = useState("");

  const load = useCallback(async () => {
    try {
      const policies = await listPolicies(true);
      const selected = policies.find((item) => item.key === policyKey) || null;
      setPolicy(selected);
      if (!selected?.id) {
        setVersion(null);
        return true;
      }
      const history = await fetchPolicyHistory(selected.id);
      const match = history.find((item) => String(item.id ?? item.version) === String(versionId));
      setVersion(match || null);
      return true;
    } catch (error) {
      setPolicy(null);
      setVersion(null);
      setToast(error instanceof Error ? error.message : "Unable to load policy version.");
      return false;
    } finally {
      setLoading(false);
    }
  }, [policyKey, versionId]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 500);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const isDraft = version?.status === "draft";
  const isCurrent = version?.status === "published";
  const isUpcoming = isDraft;
  async function handleDeleteVersion() {
    if (!policy?.id || !version?.id) return;
    setWorking(true);
    try {
      await deletePolicyVersion(policy.id, version.id);
      window.sessionStorage.setItem("policy-management-toast", `Version ${Number(version.version || 1).toFixed(1)} permanently deleted.`);
      router.push(`/admin/policies/${encodeURIComponent(policyKey)}/history`);
    } catch (error) {
      setToast(error instanceof Error ? error.message : "Unable to delete policy version.");
    } finally {
      setWorking(false);
      setDeleteConfirmOpen(false);
      setDeleteConfirmation("");
    }
  }

  async function handleRestore() {
    if (!policy?.id || !version) return;
    setWorking(true);
    try {
      await restorePolicy(policy.id, version.id ?? version.version);
      window.sessionStorage.setItem("policy-management-toast", "Version restored as a draft.");
      router.push(`/admin/policies/${encodeURIComponent(policyKey)}/edit`);
    } catch (error) {
      setToast(error instanceof Error ? error.message : "Unable to restore policy version.");
    } finally {
      setWorking(false);
    }
  }

  async function handleSetCurrent() {
    if (!policy?.id || !version) return;
    setWorking(true);
    setLoading(true);
    try {
      await setPolicyVersionCurrent(policy.id, version.id);
      if (await load()) setToast("Version set as the current policy.");
    } catch (error) {
      setToast(error instanceof Error ? error.message : "Unable to set policy version as current.");
    } finally {
      setLoading(false);
      setWorking(false);
    }
  }

  return (
    <div className="mx-auto w-full max-w-[1200px]">
      <header className="flex flex-col gap-4 border-b border-divider pb-5 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <Link href={`/admin/policies/${encodeURIComponent(policyKey)}/history`} className="text-xs font-medium text-primary no-underline hover:underline">
            {policy?.title || "Policy"} / Version history
          </Link>
          <h1 className="mt-2 text-2xl font-bold tracking-tight text-heading sm:text-[28px]">
            {loading ? "Policy Version" : `Version ${version ? Number(version.version || 1) : versionId}`}
          </h1>
          <p className="mt-1 text-sm text-muted">Review this policy version and choose its publishing action.</p>
        </div>
        {version && (
          <div className="flex flex-wrap gap-2">
            {isDraft && (
              <Link href={`/admin/policies/${encodeURIComponent(policyKey)}/edit`} className="inline-flex h-10 items-center rounded-md bg-primary px-4 text-xs font-semibold text-white hover:bg-primary-hover">
                Edit Draft
              </Link>
            )}
            {!isCurrent && !isDraft && (
              <>
                <button type="button" disabled={working} onClick={() => void handleRestore()} className="h-10 rounded-md border border-[#d6dfed] bg-white px-4 text-xs font-semibold text-body-strong hover:border-[#FFD7B5] hover:text-primary disabled:opacity-60">
                  Restore as Draft
                </button>
                <button type="button" disabled={working} onClick={() => void handleSetCurrent()} className="h-10 rounded-md bg-primary px-4 text-xs font-semibold text-white hover:bg-primary-hover disabled:opacity-60">
                  Set as Current
                </button>
              </>
            )}
            <button type="button" disabled={working} onClick={() => setDeleteConfirmOpen(true)} className="h-10 rounded-md border border-[#E8B4B4] bg-white px-4 text-xs font-semibold text-[#C24141] hover:bg-[#FFF5F5] disabled:opacity-60">
              Delete Version
            </button>
          </div>
        )}
      </header>

      {loading ? (
        <p className="mt-6 bg-white py-12 text-center text-sm text-muted shadow-sm">Loading policy version...</p>
      ) : !version ? (
        <div className="mt-6 border-l-2 border-primary bg-white px-6 py-10 shadow-sm">
          <h2 className="text-sm font-bold text-heading">Version not found</h2>
          <p className="mt-2 text-xs text-muted">This version is not available in the policy history.</p>
        </div>
      ) : (
        <article className="mt-6 bg-white p-5 shadow-sm sm:p-6">
          <section className="grid gap-6 border-b border-[#d6dfed] pb-6 lg:grid-cols-[minmax(0,1fr)_220px]">
            <div>
              <h2 className="border-l-2 border-primary pl-3 text-sm font-bold text-heading">{version.title}</h2>
              <p className="mt-4 text-sm leading-6 text-body">{version.description || "No policy description was saved for this version."}</p>
            </div>
            <div className="border-t border-[#cbd7e8] pt-4 lg:border-l lg:border-t-0 lg:pl-5 lg:pt-0">
              <h2 className="border-l-2 border-primary pl-3 text-sm font-bold text-heading">Status</h2>
              <p className={`mt-4 inline-flex rounded-md px-3 py-2 text-xs font-semibold ${isCurrent ? "bg-status-success-surface text-status-success" : isUpcoming ? "bg-[#FFF7ED] text-[#C55A12]" : "bg-[#F1F5F9] text-[#64748B]"}`}>
                {isCurrent ? "Current" : isUpcoming ? "Upcoming" : "Previous"}
              </p>
              <p className="mt-4 text-[10px] text-muted">Version {Number(version.version || 1).toFixed(1).replace(".0", ".0")}</p>
            </div>
          </section>

          <section className="border-b border-[#d6dfed] py-6">
            <h2 className="border-l-2 border-primary pl-3 text-sm font-bold text-heading">Policy content</h2>
            <div className="policy-document-content mt-5 rounded-lg border border-[#d6dfed] px-5 py-7 sm:px-8" dangerouslySetInnerHTML={{ __html: getSafeHtml(version.content) }} />
          </section>

          <section className="py-6">
            <h2 className="border-l-2 border-primary pl-3 text-sm font-bold text-heading">Version information</h2>
            <dl className="mt-4 grid gap-4 text-xs sm:grid-cols-2 lg:grid-cols-4">
              <div><dt className="text-muted">Version</dt><dd className="mt-1 font-semibold text-body-strong">{Number(version.version || 1).toFixed(1).replace(".0", ".0")}</dd></div>
              <div><dt className="text-muted">Created</dt><dd className="mt-1 font-semibold text-body-strong">{formatDate(version.createdAt)}</dd></div>
              <div><dt className="text-muted">Published</dt><dd className="mt-1 font-semibold text-body-strong">{formatDate(version.publishedAt)}</dd></div>
              <div><dt className="text-muted">Created by</dt><dd className="mt-1 font-semibold text-body-strong">{version.createdBy ? `Admin #${version.createdBy}` : "System Administrator"}</dd></div>
            </dl>
          </section>
        </article>
      )}

      {deleteConfirmOpen && version && (
        <div className="fixed inset-0 z-[300] flex items-center justify-center bg-black/50 px-4 py-6" onMouseDown={(event) => {
          if (event.target === event.currentTarget && !working) {
            setDeleteConfirmOpen(false);
            setDeleteConfirmation("");
          }
        }}>
          <section role="dialog" aria-modal="true" aria-labelledby="delete-version-title" className="w-full max-w-md rounded-xl bg-white p-6 shadow-2xl">
            <h2 id="delete-version-title" className="text-lg font-bold text-heading">Delete Version</h2>
            <p className="mt-3 text-sm leading-6 text-muted">
              Permanently delete version {Number(version.version || 1).toFixed(1)}? This action cannot be undone.
              {isCurrent ? " The previous archived version may become current." : ""}
            </p>
            <label htmlFor="delete-version-confirmation" className="mt-5 block text-sm font-semibold text-heading">
              Type <span className="font-bold text-[#C24141]">DELETE</span> to confirm
            </label>
            <input
              id="delete-version-confirmation"
              autoComplete="off"
              value={deleteConfirmation}
              onChange={(event) => setDeleteConfirmation(event.target.value)}
              className="mt-2 h-11 w-full rounded-md border border-[#d6dfed] px-3 text-sm text-heading outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
              placeholder="DELETE"
            />
            <div className="mt-6 flex justify-end gap-3">
              <button
                type="button"
                disabled={working}
                onClick={() => {
                  setDeleteConfirmOpen(false);
                  setDeleteConfirmation("");
                }}
                className="h-10 rounded-md border border-[#d6dfed] px-4 text-sm font-semibold text-body-strong hover:bg-[#F8FAFC] disabled:opacity-60"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={working || deleteConfirmation.trim() !== "DELETE"}
                onClick={() => void handleDeleteVersion()}
                className="h-10 rounded-md bg-[#C24141] px-4 text-sm font-semibold text-white hover:bg-[#A83232] disabled:cursor-not-allowed disabled:opacity-50"
              >
                {working ? "Deleting..." : "Delete Version"}
              </button>
            </div>
          </section>
        </div>
      )}

      {toast && <div className="fixed bottom-5 right-5 z-[200] rounded-lg bg-[#111827] px-4 py-3 text-xs font-semibold text-white shadow-xl">{toast}</div>}
    </div>
  );
}
