"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import PublicIcon from "@/components/icons/PublicIcon";
import Button from "@/components/ui/Button";
import Modal from "@/components/ui/Modal";
import { archivePolicy, createPolicyVersion, deletePolicy, listPolicies, publishPolicy, savePolicy, slugifyLabel, unpublishPolicy, type PolicyFormState, type PolicyRecord } from "@/lib/policyManagement";
import LegalDocumentEditor from "@/components/dashboard/admin/LegalDocumentEditor";
import useDebouncedValue from "@/hooks/useDebouncedValue";

type AdminPolicyPageProps = {
  policyKey?: string;
  create?: boolean;
  editorPage?: boolean;
};

const emptyForm = (policyKey?: string): PolicyFormState => ({
  id: null,
  key: policyKey || "",
  title: "",
  slug: "",
  category: "",
  description: "",
  content: "",
  status: "draft",
  version: 1,
  createdAt: null,
  updatedAt: null,
  publishedAt: null,
  createdBy: null,
  updatedBy: null,
  versions: [],
});

const emptyNewPolicyForm = (): PolicyFormState => ({
  ...emptyForm(),
  key: "",
  title: "",
  slug: "",
  category: "general",
  description: "",
  content: "",
  version: 1,
});

function formatDate(dateValue?: string | null) {
  if (!dateValue) return "Not set";
  const date = new Date(dateValue);
  if (Number.isNaN(date.getTime())) return "Not set";
  return new Intl.DateTimeFormat("en-US", { month: "long", day: "numeric", year: "numeric" }).format(date);
}

function getSafeHtml(value?: string | null) {
  return String(value || "").replace(/<script[\s\S]*?<\/script>/gi, "");
}

export default function AdminPolicyPage({ policyKey, create = false, editorPage = false }: AdminPolicyPageProps) {
  const router = useRouter();
  const defaultKey = policyKey || "";
  const [policies, setPolicies] = useState<PolicyRecord[]>([]);
  const [selectedPolicy, setSelectedPolicy] = useState<PolicyRecord | null>(null);
  const [form, setForm] = useState<PolicyFormState>(emptyForm(defaultKey));
  const [loading, setLoading] = useState(!create);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [publishOpen, setPublishOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteConfirmation, setDeleteConfirmation] = useState("");
  const [deletingPolicy, setDeletingPolicy] = useState(false);

  const [actionsMenuOpen, setActionsMenuOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [formErrors, setFormErrors] = useState<Record<string, string>>({});
  const [isDirty, setIsDirty] = useState(false);
  const [policySearch, setPolicySearch] = useState("");
  const [policyStatusFilter, setPolicyStatusFilter] = useState<"All" | "published" | "draft">("All");
  const debouncedPolicySearch = useDebouncedValue(policySearch.trim());
  const debouncedPolicyStatusFilter = useDebouncedValue(policyStatusFilter);
  const [actionPolicy, setActionPolicy] = useState<PolicyRecord | null>(null);

  const loadPolicies = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const response = await listPolicies(true);
      setPolicies(response);
      if (response.length === 0) {
        setSelectedPolicy(null);
        setForm(emptyForm(defaultKey));
        return;
      }

      const matched = defaultKey
        ? response.find((policy) => policy.key === defaultKey || policy.slug === defaultKey)
        : response[0];
      if (!matched) {
        setSelectedPolicy(null);
        setForm(emptyForm(defaultKey));
        setLoadError(`No policy found for “${defaultKey}”.`);
        return;
      }

      setSelectedPolicy(matched);
      setForm({
        id: matched.id,
        key: matched.key,
        title: matched.title,
        slug: matched.slug,
        category: matched.category,
        description: matched.description,
        content: matched.content,
        status: matched.status,
        version: matched.version || 1,
        createdAt: matched.createdAt || null,
        updatedAt: matched.updatedAt || null,
        publishedAt: matched.publishedAt || null,
        createdBy: matched.createdBy || null,
        updatedBy: matched.updatedBy || null,
        versions: matched.versions || [],
      });
    } catch (error) {
      setPolicies([]);
      setSelectedPolicy(null);
      setForm(emptyForm(defaultKey));
      setLoadError(error instanceof Error ? error.message : "Unable to load policies from the database.");
    } finally {
      setLoading(false);
    }
  }, [defaultKey]);

  useEffect(() => {
    if (create) {
      const createFormTimer = window.setTimeout(() => setForm(emptyNewPolicyForm()), 0);
      return () => window.clearTimeout(createFormTimer);
    }
    const message = window.sessionStorage.getItem("policy-management-toast");
    let toastTimer: number | undefined;
    if (message) {
      window.sessionStorage.removeItem("policy-management-toast");
      toastTimer = window.setTimeout(() => setToast(message), 0);
    }
    void Promise.resolve().then(loadPolicies);
    return () => {
      if (toastTimer !== undefined) window.clearTimeout(toastTimer);
    };
  }, [defaultKey, create, loadPolicies]);

  useEffect(() => {
    if (!editorPage || !isDirty) return;
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [editorPage, isDirty]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 500);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const pageStatusText = useMemo(() => {
    if (form.status === "published") return "Published";
    if (form.status === "archived") return "Archived";
    return "Draft";
  }, [form.status]);

  const currentActionLabel = useMemo(() => {
    if (form.status === "published") return "Published policy";
    if (form.status === "archived") return "Archived policy";
    return "Draft policy";
  }, [form.status]);
  const selectedKey = selectedPolicy?.key || defaultKey;
  const visiblePolicies = useMemo(() => {
    const query = debouncedPolicySearch.toLowerCase();
    return policies.filter((policy) =>
      (debouncedPolicyStatusFilter === "All" || policy.status === debouncedPolicyStatusFilter) &&
      (!query || policy.title.toLowerCase().includes(query) || policy.slug.toLowerCase().includes(query) || policy.category.toLowerCase().includes(query))
    );
  }, [debouncedPolicySearch, debouncedPolicyStatusFilter, policies]);
  const activePolicyCount = policies.filter((policy) => policy.status !== "archived").length;
  const canArchivePolicy = selectedPolicy?.status !== "archived" && activePolicyCount > 1;

  const handleDeletePolicy = async () => {
    if (!selectedPolicy?.id) {
      setToast("Save this policy before deleting it.");
      setDeleteOpen(false);
      return;
    }
    if (deleteConfirmation !== selectedPolicy.title) return;
    setDeletingPolicy(true);
    try {
      await deletePolicy(selectedPolicy.id);
      setDeleteOpen(false);
      window.sessionStorage.setItem("policy-management-toast", `“${selectedPolicy.title}” and all its versions were permanently deleted.`);
      router.push("/admin/policies");
    } catch (error) {
      setToast(error instanceof Error ? error.message : "Unable to delete policy.");
    } finally {
      setDeletingPolicy(false);
    }
  };

  const handleSave = async (status: "draft" | "published") => {
    const nextContent = form.content || "<p>Content</p>";
    const contentText = nextContent.replace(/<[^>]*>/g, " ").replace(/&nbsp;/gi, " ").replace(/\s+/g, " ").trim();
    const policySlug = slugifyLabel(form.slug || form.title);
    const nextVersion = create ? 1 : Number(form.version || 1);
    const nextForm = {
      ...form,
      key: create ? policySlug : form.key || selectedKey || defaultKey,
      title: form.title.trim(),
      slug: policySlug,
      category: create ? policySlug : form.category,
      description: form.description.trim(),
      content: nextContent,
      status,
      version: nextVersion,
    };

    const nextErrors: Record<string, string> = {};
    if (!nextForm.title) nextErrors.title = "Enter a policy title.";
    if (!nextForm.slug || nextForm.slug === "policy") nextErrors.slug = "Enter a valid policy slug.";
    if (!nextForm.description) nextErrors.description = "Enter a policy summary.";
    if (!contentText) nextErrors.content = "Add policy content before saving.";
    setFormErrors(nextErrors);
    if (Object.keys(nextErrors).length) return;

    try {
      const savedDraft = await savePolicy(nextForm, form.id ? "update" : "create");
      const saved = status === "published" && savedDraft.id
        ? await publishPolicy(savedDraft.id, savedDraft)
        : savedDraft;
      const savedDraftVersion = status === "draft"
        ? saved.versions?.filter((version) => version.status === "draft").sort((a, b) => b.version - a.version)[0]
        : null;
      setSelectedPolicy(saved);
      setForm({
        ...saved,
        ...(savedDraftVersion ? {
          title: savedDraftVersion.title,
          slug: savedDraftVersion.slug,
          category: savedDraftVersion.category,
          description: savedDraftVersion.description,
          content: savedDraftVersion.content,
          contentJson: savedDraftVersion.contentJson,
          status: "draft" as const,
          version: savedDraftVersion.version,
        } : {}),
        id: saved.id,
        versions: saved.versions || [],
      });
      setPolicies((current) => [...current.filter((policy) => policy.key !== saved.key), saved]);
      setIsDirty(false);
      setToast(status === "published" ? "Policy published successfully." : "Draft saved successfully.");
      if (create && saved.key) {
        router.replace(`/admin/policies/${encodeURIComponent(saved.key)}/edit`);
      }
      if (status === "published") {
        router.push(`/admin/policies/${encodeURIComponent(saved.key)}`);
      }
    } catch (error) {
      setToast(error instanceof Error ? error.message : "Unable to save policy.");
    }
  };

  const cancelEditor = () => {
    const destination = `/admin/policies/${encodeURIComponent(selectedPolicy?.key || form.key || defaultKey)}`;
    if (isDirty && !window.confirm("You have unsaved changes. Leave without saving?")) return;
    setIsDirty(false);
    router.push(destination);
  };

  const handleNewVersion = async () => {
    try {
      const policyId = selectedPolicy?.id || form.id;
      if (!policyId) throw new Error("Select a policy before creating a version.");
      const existingDraft = selectedPolicy?.versions?.filter((version) => version.status === "draft").sort((a, b) => b.version - a.version)[0];
      if (existingDraft) {
        setForm({
          ...selectedPolicy!,
          title: existingDraft.title,
          slug: existingDraft.slug,
          category: existingDraft.category,
          description: existingDraft.description,
          content: existingDraft.content,
          contentJson: existingDraft.contentJson,
          status: "draft",
          version: existingDraft.version,
        });
        setToast(`Draft version ${existingDraft.version.toFixed(1)} already exists.`);
        router.push(`/admin/policies/${encodeURIComponent(selectedPolicy!.key)}/edit`);
        return;
      }
      const saved = await createPolicyVersion(policyId);
      const draft = saved.versions?.filter((version) => version.status === "draft").sort((a, b) => b.version - a.version)[0];
      setSelectedPolicy(saved);
      setForm({
        ...saved,
        ...(draft ? {
          title: draft.title,
          slug: draft.slug,
          category: draft.category,
          description: draft.description,
          content: draft.content,
          contentJson: draft.contentJson,
          status: "draft" as const,
          version: draft.version,
        } : {}),
        versions: saved.versions || [],
      });
      setPolicies((current) => [...current.filter((policy) => policy.key !== saved.key), saved]);
      setIsDirty(false);
      setActionsMenuOpen(false);
      setToast(`New draft version ${saved.version} created.`);
      router.push(`/admin/policies/${encodeURIComponent(saved.key)}/edit`);
    } catch (error) {
      setToast(error instanceof Error ? error.message : "Unable to create a new version.");
    }
  };

  const handleUnpublish = async () => {
    if (!selectedPolicy?.id) return;
    try {
      const saved = await unpublishPolicy(selectedPolicy.id);
      setSelectedPolicy(saved);
      setForm({ ...saved, versions: saved.versions || [] });
      setPolicies((current) => [...current.filter((policy) => policy.key !== saved.key), saved]);
      setIsDirty(false);
      setToast("Policy unpublished successfully.");
    } catch (error) {
      setToast(error instanceof Error ? error.message : "Unable to unpublish policy.");
    }
  };

  const handleArchive = async () => {
    if (!selectedPolicy?.id) return;
    if (selectedPolicy.status === "archived") return;
    if (!window.confirm("Archive this policy? It will no longer be visible publicly.")) return;
    try {
      const saved = await archivePolicy(selectedPolicy.id);
      setSelectedPolicy(saved);
      setForm({ ...saved, versions: saved.versions || [] });
      setPolicies((current) => [...current.filter((policy) => policy.key !== saved.key), saved]);
      setIsDirty(false);
      setToast("Policy archived successfully.");
    } catch (error) {
      setToast(error instanceof Error ? error.message : "Unable to archive policy.");
    }
  };

  if (loading) {
    return <div className="mx-auto max-w-[1200px] py-10 text-center text-sm text-muted">Loading legal policy manager…</div>;
  }

  if (!create && !selectedPolicy) {
    return (
      <Modal
        open
        title={loadError ? "Unable to load policy" : "No policies found"}
        titleId="policy-unavailable-title"
        onClose={() => router.push("/admin/policies")}
        footer={
          <>
            <Button type="button" variant="secondary" onClick={() => void loadPolicies()}>
              Retry
            </Button>
            <Button type="button" onClick={() => router.push("/admin/policies/new")}>
              New Policy
            </Button>
          </>
        }
      >
        <p role={loadError ? "alert" : undefined} className="text-sm leading-6 text-[#66718E]">
          {loadError || "Policies will appear here after they are created in the database."}
        </p>
      </Modal>
    );
  }

  if (editorPage) {
    const policyTitle = form.title || "New policy";
    const destination = `/admin/policies/${encodeURIComponent(selectedPolicy?.key || form.key || defaultKey)}`;
    return (
      <div className="mx-auto w-full max-w-[1180px] text-[#283554]">
        <nav aria-label="Breadcrumb" className="mb-4 flex flex-wrap items-center gap-2 text-xs text-[#66718E]">
          <Link href="/admin" className="hover:text-[#E57218]">Admin</Link><span aria-hidden="true">/</span>
          <Link href={destination} className="hover:text-[#E57218]">Legal &amp; Policies</Link><span aria-hidden="true">/</span>
          {create ? <span className="text-[#101A3C]">Add policy</span> : <><span className="max-w-40 truncate text-[#283554]">{policyTitle}</span><span aria-hidden="true">/</span><span className="text-[#101A3C]">Edit</span></>}
        </nav>

        <header className="flex flex-col justify-between gap-4 border-b border-[#E8EAF2] pb-5 sm:flex-row sm:items-end">
          <div className="min-w-0">
            <Link href={destination} onClick={(event) => { if (isDirty && !window.confirm("You have unsaved changes. Leave without saving?")) event.preventDefault(); else setIsDirty(false); }} className="mb-2 inline-flex items-center gap-2 text-xs font-semibold text-[#66718E] hover:text-[#E57218]">
              <PublicIcon name="left" className="h-3 w-3" />Back to Policies
            </Link>
            <h1 className="text-xl font-bold tracking-tight text-[#101A3C] sm:text-2xl">{create ? "New Policy" : `Edit ${policyTitle}`}</h1>
            <p className="mt-1.5 text-sm text-[#66718E]">{create ? "Create a legal document for the marketplace." : "Update and manage this legal document."}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2 sm:justify-end">
            <span className={`inline-flex h-9 items-center gap-2 rounded-lg px-3 text-xs font-semibold ${form.status === "published" ? "bg-[#ECFDF5] text-[#059669]" : "bg-[#FFFBEB] text-[#B45309]"}`}>
              <span className={`h-1.5 w-1.5 rounded-full ${form.status === "published" ? "bg-[#059669]" : "bg-[#D97706]"}`} />
              {pageStatusText}
            </span>
          </div>
        </header>

        <div className="grid gap-5 py-5 pb-24 lg:grid-cols-[minmax(0,1fr)_280px]">
          <main className="min-w-0">
            <section className="grid gap-x-5 gap-y-4 rounded-xl border border-[#E8EAF2] bg-white p-5 shadow-[0_2px_8px_rgba(16,26,60,0.04)] sm:grid-cols-2">
              <label className="block text-sm font-semibold text-[#283554]">
                Policy title
                <input
                  required
                  value={form.title}
                  aria-invalid={Boolean(formErrors.title)}
                  aria-describedby={formErrors.title ? "policy-title-error" : undefined}
                  onChange={(event) => {
                    const title = event.target.value;
                    setForm((current) => ({ ...current, title, slug: slugifyLabel(title), key: slugifyLabel(title) }));
                    setFormErrors((current) => ({ ...current, title: "", slug: "" }));
                    setIsDirty(true);
                  }}
                  className={`mt-1.5 h-10 w-full rounded-lg border bg-white px-3 text-sm font-medium text-[#101A3C] outline-none focus:ring-2 focus:ring-[#F57E1F]/10 ${formErrors.title ? "border-red-500 focus:border-red-500" : "border-[#E8EAF2] focus:border-[#F57E1F]"}`}
                />
                {formErrors.title && <span id="policy-title-error" className="mt-1 block text-xs text-[#DC2626]">{formErrors.title}</span>}
              </label>
              <label className="block text-sm font-semibold text-[#283554]">
                Policy slug
                <input
                  required
                  value={form.slug}
                  aria-invalid={Boolean(formErrors.slug)}
                  aria-describedby={formErrors.slug ? "policy-slug-error" : undefined}
                  onChange={(event) => {
                    const slug = slugifyLabel(event.target.value);
                    setForm((current) => ({ ...current, slug, key: slug }));
                    setFormErrors((current) => ({ ...current, slug: "" }));
                    setIsDirty(true);
                  }}
                  className={`mt-1.5 h-10 w-full rounded-lg border bg-white px-3 text-sm text-[#101A3C] outline-none focus:ring-2 focus:ring-[#F57E1F]/10 ${formErrors.slug ? "border-red-500 focus:border-red-500" : "border-[#E8EAF2] focus:border-[#F57E1F]"}`}
                />
                {formErrors.slug && <span id="policy-slug-error" className="mt-1 block text-xs text-[#DC2626]">{formErrors.slug}</span>}
              </label>
              <label className="block text-sm font-semibold text-[#283554]">
                Summary
                <input
                  value={form.description}
                  onChange={(event) => {
                    setForm((current) => ({ ...current, description: event.target.value }));
                    setFormErrors((current) => ({ ...current, description: "" }));
                    setIsDirty(true);
                  }}
                  aria-invalid={Boolean(formErrors.description)}
                  className={`mt-1.5 h-10 w-full rounded-lg border bg-white px-3 text-sm text-[#101A3C] outline-none focus:ring-2 focus:ring-[#F57E1F]/10 ${formErrors.description ? "border-red-500 focus:border-red-500" : "border-[#E8EAF2] focus:border-[#F57E1F]"}`}
                />
                {formErrors.description && <span className="mt-1 block text-xs text-[#DC2626]">{formErrors.description}</span>}
              </label>
            </section>

            <section className="mt-5 min-w-0 rounded-xl border border-[#E8EAF2] bg-white p-4 shadow-[0_2px_8px_rgba(16,26,60,0.04)] sm:p-5">
              <div className="mb-2 flex flex-wrap items-end justify-between gap-2">
                <div>
                  <h2 className="text-sm font-bold text-[#101A3C]">Policy content</h2>
                  <p className="mt-1 text-xs text-[#66718E]">Format the document using the toolbar. Changes are saved as a new draft until published.</p>
                </div>
              </div>
              <LegalDocumentEditor
                content={form.content}
                onChange={(html, json) => {
                  setForm((current) => ({ ...current, content: html, contentJson: json }));
                  setIsDirty(true);
                  setFormErrors((current) => ({ ...current, content: "" }));
                }}
                onAutoSave={(html, json) => {
                  const next = { ...form, content: html, contentJson: json };
                  if (create && !next.id) return;
                  return savePolicy(next, next.id ? "update" : "create")
                    .then((saved) => {
                      const draft = saved.versions?.filter((version) => version.status === "draft").sort((a, b) => b.version - a.version)[0];
                      setSelectedPolicy(saved);
                      setForm((current) => ({
                        ...current,
                        id: saved.id,
                        version: draft?.version ?? saved.version,
                        createdAt: saved.createdAt,
                        updatedAt: saved.updatedAt,
                      }));
                      setPolicies((current) => [...current.filter((policy) => policy.key !== saved.key), saved]);
                      setIsDirty(false);
                      setToast("Draft autosaved.");
                    })
                    .catch((error: unknown) => {
                      const message = error instanceof Error ? error.message : "Unable to autosave policy.";
                      setToast(message);
                      throw error;
                    });
                }}
              />
              {formErrors.content && <p role="alert" className="mt-2 text-xs text-[#DC2626]">{formErrors.content}</p>}
            </section>
          </main>

          <aside className="lg:pt-0">
            <div className="space-y-4 lg:sticky lg:top-5">
              <section className="rounded-xl border border-[#E8EAF2] bg-white p-4 shadow-[0_2px_8px_rgba(16,26,60,0.04)]">
                <div className="flex items-center gap-2">
                  <span className="grid h-8 w-8 place-items-center rounded-lg bg-[#FFF0E4] text-[#F57E1F]">
                    <PublicIcon name="shield-check" className="h-4 w-4" />
                  </span>
                  <div>
                    <h2 className="text-sm font-bold text-[#101A3C]">Publishing status</h2>
                    <p className="mt-0.5 text-xs text-[#66718E]">{isDirty ? "Unsaved changes" : "All changes saved"}</p>
                  </div>
                </div>

                <div className="mt-4 space-y-2">
                  <button
                    type="button"
                    onClick={() => {
                      if (selectedPolicy?.status === "published") {
                        void handleUnpublish();
                        return;
                      }
                      setForm((current) => ({ ...current, status: "draft" }));
                      setIsDirty(true);
                    }}
                    className={`flex w-full items-center gap-3 rounded-lg border p-3 text-left transition ${form.status === "draft" ? "border-[#F8C79F] bg-[#FFF9F4]" : "border-[#E8EAF2] bg-white hover:border-[#CBD2DF]"}`}
                  >
                    <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-lg ${form.status === "draft" ? "bg-[#FFF0E4] text-[#E57218]" : "bg-[#F4F6FA] text-[#66718E]"}`}>
                      <PublicIcon name="file-search-corner" className="h-4 w-4" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-semibold text-[#283554]">Draft</span>
                      <span className="mt-0.5 block text-xs text-[#66718E]">Visible only to admins</span>
                    </span>
                    {form.status === "draft" && <PublicIcon name="check" className="h-4 w-4 text-[#F57E1F]" />}
                  </button>

                  <button
                    type="button"
                    onClick={() => { setForm((current) => ({ ...current, status: "published" })); setIsDirty(true); }}
                    className={`flex w-full items-center gap-3 rounded-lg border p-3 text-left transition ${form.status === "published" ? "border-[#86D7B7] bg-[#F4FCF8]" : "border-[#E8EAF2] bg-white hover:border-[#86D7B7]"}`}
                  >
                    <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-lg ${form.status === "published" ? "bg-[#DCFCE7] text-[#059669]" : "bg-[#F4F6FA] text-[#66718E]"}`}>
                      <PublicIcon name="check" className="h-4 w-4" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-semibold text-[#283554]">Published</span>
                      <span className="mt-0.5 block text-xs text-[#66718E]">Visible publicly</span>
                    </span>
                    {form.status === "published" && <PublicIcon name="check" className="h-4 w-4 text-[#059669]" />}
                  </button>

                  <button
                    type="button"
                    disabled={selectedPolicy?.status === "archived" || !canArchivePolicy}
                    onClick={() => void handleArchive()}
                    title={!canArchivePolicy && selectedPolicy?.status !== "archived" ? "At least one policy must remain active" : "Archive this policy"}
                    className={`flex w-full items-center gap-3 rounded-lg border p-3 text-left transition ${
                      form.status === "archived"
                        ? "border-[#C6C9D2] bg-[#F2F3F6]"
                        : "border-[#E8EAF2] bg-white hover:border-[#CBD2DF]"
                    } disabled:cursor-not-allowed disabled:opacity-50`}
                  >
                    <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-lg ${form.status === "archived" ? "bg-[#E4E6EB] text-[#66718E]" : "bg-[#F4F6FA] text-[#66718E]"}`}>
                      <PublicIcon name="shield-minus" className="h-4 w-4" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-semibold text-[#283554]">Archived</span>
                      <span className="mt-0.5 block text-xs text-[#66718E]">Hidden from public marketplace</span>
                    </span>
                    {form.status === "archived" && <PublicIcon name="check" className="h-4 w-4 text-[#66718E]" />}
                  </button>
                </div>
                <div className="mt-4 border-t border-[#E8EAF2] pt-4">
                  <h3 className="text-xs font-bold uppercase tracking-wide text-[#66718E]">Document details</h3>
                  <dl className="mt-3 space-y-3 text-xs">
                    <div className="flex items-center justify-between gap-3"><dt className="text-[#66718E]">Version</dt><dd className="font-semibold text-[#283554]">{form.version || 1}.0</dd></div>
                    <div className="flex items-center justify-between gap-3"><dt className="text-[#66718E]">Updated</dt><dd className="font-semibold text-[#283554]">{formatDate(form.updatedAt)}</dd></div>
                  </dl>
                </div>
              </section>
            </div>
          </aside>
        </div>

        <footer className="policy-editor-footer fixed bottom-0 left-0 right-0 z-[50] border-t border-[#E8EAF2] bg-white px-5 py-4 shadow-[0_-8px_24px_rgba(16,26,60,0.08)]">
          <div className="mx-auto flex max-w-[1180px] items-center justify-between gap-3">
            <button type="button" onClick={cancelEditor} className="h-10 rounded-lg border border-[#E8EAF2] bg-white px-5 text-sm font-semibold text-[#283554] shadow-sm transition hover:bg-[#F7F8FA]">
              Cancel
            </button>
            {form.status === "draft" ? (
              <button type="button" onClick={() => void handleSave("draft")} className="inline-flex h-10 items-center gap-2 rounded-lg bg-[#F57E1F] px-5 text-sm font-semibold text-white shadow-sm transition hover:bg-[#E57218]">
                <PublicIcon name="file-search-corner" className="h-4 w-4" />Save Draft
              </button>
            ) : form.status === "published" ? (
              <button type="button" onClick={() => setPublishOpen(true)} className="inline-flex h-10 items-center gap-2 rounded-lg bg-[#F57E1F] px-5 text-sm font-semibold text-white shadow-sm transition hover:bg-[#E57218]">
                <PublicIcon name="check" className="h-4 w-4" />Publish Changes
              </button>
            ) : null}
          </div>
        </footer>

        {publishOpen && (
          <div className="fixed inset-0 z-[125] grid place-items-center bg-slate-950/40 p-4">
            <div role="dialog" aria-modal="true" aria-labelledby="publish-policy-title" className="w-full max-w-md overflow-hidden rounded-2xl border border-[#E8EAF2] bg-white shadow-[0_24px_64px_rgba(16,26,60,0.20)]">
              <div className="p-5 pb-4">
              <p className="text-xs font-semibold text-[#F57E1F]">Publish document</p>
              <h2 id="publish-policy-title" className="mt-1 text-lg font-bold text-[#101A3C]">{form.title}</h2>
              <dl className="mt-4 grid grid-cols-2 gap-3 rounded-xl border border-[#E8EAF2] bg-[#FCFCFE] p-3 text-xs">
                <div><dt className="text-[#66718E]">Current version</dt><dd className="mt-1 font-semibold text-[#283554]">{form.version || 1}.0</dd></div>
                <div><dt className="text-[#66718E]">New version</dt><dd className="mt-1 font-semibold text-[#F57E1F]">{form.version || 1}.0</dd></div>
              </dl>
              <p className="mt-4 text-sm leading-5 text-[#66718E]">This publication will replace the currently published document and add a new entry to version history.</p>
              </div>
              <div className="flex justify-end gap-2 border-t border-[#E8EAF2] bg-[#FCFCFE] px-5 py-4">
                <button type="button" onClick={() => setPublishOpen(false)} className="h-10 rounded-lg border border-[#E8EAF2] bg-white px-4 text-xs font-semibold text-[#283554] shadow-sm transition hover:bg-[#F7F8FA]">Cancel</button>
                <button type="button" onClick={() => { setPublishOpen(false); void handleSave("published"); }} className="inline-flex h-10 items-center gap-2 rounded-lg bg-[#F57E1F] px-4 text-xs font-semibold text-white shadow-sm transition hover:bg-[#E57218]">Confirm Publish <PublicIcon name="check" className="h-3.5 w-3.5" /></button>
              </div>
            </div>
          </div>
        )}

        {previewOpen && (
          <div className="fixed inset-0 z-[120] grid place-items-center bg-slate-950/40 p-4">
            <div className="w-full max-w-4xl overflow-hidden rounded-xl border border-[#E8EAF2] bg-white shadow-xl">
              <div className="flex items-center justify-between gap-3 border-b border-[#E8EAF2] px-5 py-4">
                <div><p className="text-xs font-semibold text-[#F57E1F]">Document preview</p><h2 className="mt-1 text-xl font-bold text-[#101A3C]">{form.title}</h2></div>
                <button type="button" onClick={() => setPreviewOpen(false)} className="h-9 rounded-lg border border-[#E8EAF2] px-3 text-xs font-semibold">Close</button>
              </div>
              <div className="max-h-[70vh] overflow-y-auto bg-[#F8F8FF] p-4 sm:p-7">
                <div className="policy-document-content mx-auto max-w-[820px] border border-[#E8EAF2] bg-white px-5 py-7 sm:px-10 sm:py-10" dangerouslySetInnerHTML={{ __html: getSafeHtml(form.content) }} />
              </div>
            </div>
          </div>
        )}
        {toast && <div role="status" className="fixed bottom-5 right-5 z-[200] rounded-lg bg-[#101A3C] px-4 py-3 text-sm font-semibold text-white shadow-xl">{toast}</div>}
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-[1440px] text-[#283554]">
      {false && (
      <>
      <header className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="mb-1 text-[10px] font-bold uppercase tracking-[0.1em] text-[#F57E1F]">Administration</p>
          <h1 className="text-2xl font-bold tracking-tight text-[#101A3C] sm:text-[28px]">Legal Policies</h1>
          <p className="mt-1 text-sm text-[#66718E]">Manage marketplace legal documents, revisions, and publishing.</p>
        </div>
        <Link href="/admin/policies/new" className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-[#F57E1F] px-3 py-2 text-xs font-semibold text-white transition hover:bg-[#E57218]">
          <PublicIcon name="add" className="h-3.5 w-3.5" />Add Policy
        </Link>
      </header>

      <section className="mt-5 overflow-hidden rounded-2xl border border-[#E8EAF2] bg-white shadow-sm">
        <div className="flex flex-col gap-2 border-b border-[#E8EAF2] px-4 py-3 sm:flex-row sm:items-center sm:px-5">
          <label className="relative min-w-[12rem] flex-1 sm:max-w-[18rem]">
            <span className="sr-only">Search policies</span>
            <PublicIcon name="search" className="absolute left-3 top-2.5 h-4 w-4 text-[#98A2B3]" />
            <input value={policySearch} onChange={(event) => setPolicySearch(event.target.value)} placeholder="Search policies..." className="h-9 w-full rounded-lg border border-[#E8EAF2] bg-white pl-9 pr-3 text-xs outline-none placeholder:text-[#98A2B3] focus:border-[#F57E1F] focus:ring-2 focus:ring-[#F57E1F]/10" />
          </label>
          <select aria-label="Filter by status" value={policyStatusFilter} onChange={(event) => setPolicyStatusFilter(event.target.value as "All" | "published" | "draft")} className="h-9 rounded-lg border border-[#E8EAF2] bg-white px-3 pr-8 text-xs text-[#283554] sm:w-36">
            <option value="All">All Status</option>
            <option value="published">Published</option>
            <option value="draft">Draft</option>
          </select>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-left text-xs">
            <thead className="bg-[#fcfcfe] text-[10px] uppercase tracking-[0.08em] text-[#66718E]">
              <tr>{["Policy Name", "Category", "Version", "Status", "Last Updated", "Actions"].map((column) => <th key={column} className="px-5 py-3 font-medium">{column}</th>)}</tr>
            </thead>
            <tbody>
              {visiblePolicies.map((policy) => (
                <tr key={policy.id || policy.key} className="border-t border-[#E8EAF2] text-[#283554] odd:bg-white even:bg-[#fffaf7] transition hover:bg-[#FFF7EF]">
                  <td className="px-5 py-3"><p className="font-medium text-[#101A3C]">{policy.title}</p><p className="mt-0.5 text-[10px] text-[#66718E]">/{policy.slug}</p></td>
                  <td className="px-5 py-3 text-[10px] text-[#66718E]">{policy.category}</td>
                  <td className="px-5 py-3 text-[10px] text-[#66718E]">{policy.version || 1}.0</td>
                  <td className="px-5 py-3"><span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-semibold ${policy.status === "published" ? "bg-[#ECFDF5] text-[#059669]" : "bg-[#FFFBEB] text-[#B45309]"}`}><span className={`h-1.5 w-1.5 rounded-full ${policy.status === "published" ? "bg-[#059669]" : "bg-[#D97706]"}`} />{policy.status === "published" ? "Published" : "Draft"}</span></td>
                  <td className="px-5 py-3 text-[10px] text-[#66718E]">{formatDate(policy.updatedAt)}</td>
                  <td className="px-5 py-3"><button type="button" onClick={() => setActionPolicy(policy)} aria-label={`Actions for ${policy.title}`} className="grid h-8 w-8 place-items-center rounded-lg border border-[#E8EAF2] text-[#66718E] transition hover:border-[#F57E1F] hover:bg-[#FFF7EF] hover:text-[#F57E1F]"><PublicIcon name="ellipsis-vertical" className="h-4 w-4" /></button></td>
                </tr>
              ))}
            </tbody>
          </table>
          {visiblePolicies.length === 0 && <p className="px-6 py-12 text-center text-sm text-[#66718E]">No matching policies found.</p>}
        </div>
      </section>

      {actionPolicy && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/40 p-4" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setActionPolicy(null); }}>
          <section role="dialog" aria-modal="true" aria-label="Policy actions" className="w-full max-w-[30rem] rounded-2xl border border-[#E8EAF2] bg-white p-5 shadow-2xl sm:p-7">
            <div className="mb-5 flex items-start justify-between gap-3">
              <h2 className="min-w-0 text-base font-bold leading-6 text-[#101A3C] sm:text-lg">Actions: {actionPolicy.title}</h2>
              <button type="button" onClick={() => setActionPolicy(null)} aria-label="Close dialog" className="shrink-0 rounded-md p-1 text-[#66718E] hover:bg-[#F4F6FA]"><PublicIcon name="x" className="h-5 w-5" /></button>
            </div>
            <div className="space-y-2.5">
              <button type="button" onClick={() => { setSelectedPolicy(actionPolicy); setForm({ ...actionPolicy, versions: actionPolicy.versions || [] }); setPreviewOpen(true); setActionPolicy(null); }} className="flex min-h-[3.6rem] w-full items-center gap-4 rounded-xl border border-[#E8EAF2] px-5 text-left text-sm font-medium text-[#283554] hover:bg-[#FFF7EF]"><PublicIcon name="view" className="h-5 w-5 text-[#F57E1F]" />View Detail</button>
              <Link href={`/admin/policies/${encodeURIComponent(actionPolicy.key)}/edit`} onClick={() => setActionPolicy(null)} className="flex min-h-[3.6rem] w-full items-center gap-4 rounded-xl border border-[#E8EAF2] px-5 text-left text-sm font-medium text-[#283554] hover:bg-[#FFF7EF]"><PublicIcon name="edit" className="h-5 w-5 text-[#F57E1F]" />Edit Policy</Link>
              {actionPolicy.status !== "published" && <button type="button" onClick={() => { setSelectedPolicy(actionPolicy); setForm({ ...actionPolicy, versions: actionPolicy.versions || [] }); setPublishOpen(true); setActionPolicy(null); }} className="flex min-h-[3.6rem] w-full items-center gap-4 rounded-xl border border-[#F8C79F] px-5 text-left text-sm font-medium text-[#E57218] hover:bg-[#FFF7EF]"><PublicIcon name="check" className="h-5 w-5" />Publish Policy</button>}
              <Link href={`/admin/policies/${encodeURIComponent(actionPolicy.key)}/history`} onClick={() => setActionPolicy(null)} className="flex min-h-[3.6rem] w-full items-center gap-4 rounded-xl border border-[#E8EAF2] px-5 text-left text-sm font-medium text-[#283554] hover:bg-[#F7F8FA]"><PublicIcon name="clock-9" className="h-5 w-5 text-[#66718E]" />View History</Link>
            </div>
          </section>
        </div>
      )}
      </>
      )}

        <div className="mx-auto w-full max-w-[1440px] text-[#283554]">
      <header className="flex flex-col justify-between gap-4 border-b border-[#E8EAF2] pb-5 sm:flex-row sm:items-end">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-[#F57E1F]">Legal &amp; Policies</p>
          <h1 className="mt-1 text-2xl font-bold tracking-tight text-[#101A3C] sm:text-[28px]">{selectedPolicy?.title || form.title || "Legal policy"}</h1>
          <p className="mt-1.5 text-sm text-[#66718E]">Manage marketplace legal documents, revisions, and publishing.</p>
        </div>
        <div className="flex flex-col items-start gap-2 sm:items-end">
          {!create && (
            <Link
              href="/admin/policies/new"
              className="inline-flex h-9 items-center gap-2 rounded-lg bg-[#F57E1F] px-3 text-xs font-semibold text-white shadow-sm transition hover:bg-[#E57218]"
            >
              <PublicIcon name="add" className="h-4 w-4 shrink-0" />
              New Policy
            </Link>
          )}
          <div className="flex flex-wrap items-center gap-2 sm:justify-end">
          <span className="inline-flex h-9 items-center gap-2 rounded-lg bg-white px-3 text-xs text-[#66718E]">
            <PublicIcon name="clock-9" className="h-3.5 w-3.5 text-[#8993AA]" />
            Updated {formatDate(selectedPolicy?.updatedAt || form.updatedAt || null)}
          </span>
          <span className={`inline-flex h-9 items-center gap-2 rounded-lg px-3 text-xs font-semibold ${form.status === "published" ? "bg-[#ECFDF5] text-[#059669]" : "bg-[#FFFBEB] text-[#B45309]"}`}>
            <span className={`h-1.5 w-1.5 rounded-full ${form.status === "published" ? "bg-[#059669]" : "bg-[#D97706]"}`} />
            {pageStatusText}
          </span>
          <span className="inline-flex h-9 items-center rounded-lg bg-white px-3 text-xs font-semibold text-[#283554]">Version {selectedPolicy?.version || form.version || 1}.0</span>
          <div className="relative">
            <button type="button" onClick={() => setActionsMenuOpen((open) => !open)} className="grid h-9 w-9 place-items-center rounded-lg border border-[#E8EAF2] bg-white text-[#66718E] transition hover:border-[#FFD7B5] hover:text-[#F57E1F] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#F57E1F]" aria-label="More policy actions" aria-expanded={actionsMenuOpen}>
              <PublicIcon name="ellipsis-vertical" className="h-4 w-4" />
            </button>
            {actionsMenuOpen && (
              <div className="absolute right-0 top-11 z-30 w-[240px] rounded-xl border border-[#E8EAF2] bg-white p-1.5 shadow-[0_12px_32px_rgba(16,26,60,0.14)]">
                {!create && (
                  <button type="button" onClick={() => void handleNewVersion()} className="flex h-10 w-full items-center gap-2.5 whitespace-nowrap rounded-lg px-3 text-sm font-medium leading-10 text-[#283554] hover:bg-[#FFF7EF]">
                    <span className="grid h-4 w-4 shrink-0 place-items-center"><PublicIcon name="add" className="h-4 w-4 text-[#F57E1F]" /></span>
                    <span>New Version</span>
                  </button>
                )}
                {!create && (
                  <Link href={`/admin/policies/${encodeURIComponent(selectedPolicy?.key || form.key)}/edit`} onClick={() => setActionsMenuOpen(false)} className="flex h-10 w-full items-center gap-2.5 whitespace-nowrap rounded-lg px-3 text-sm font-medium leading-10 text-[#283554] hover:bg-[#FFF7EF]">
                    <span className="grid h-4 w-4 shrink-0 place-items-center"><PublicIcon name="edit" className="h-4 w-4 text-[#F57E1F]" /></span>
                    <span>Edit Policy</span>
                  </Link>
                )}
                <button type="button" onClick={() => { setActionsMenuOpen(false); void handleSave("draft"); }} className="flex h-10 w-full items-center gap-2.5 whitespace-nowrap rounded-lg px-3 text-sm font-medium leading-10 text-[#283554] hover:bg-[#FFF7EF]">
                  <span className="grid h-4 w-4 shrink-0 place-items-center"><PublicIcon name="file-search-corner" className="h-4 w-4 text-[#66718E]" /></span>
                  <span>Save Draft</span>
                </button>
                <button type="button" onClick={() => { setActionsMenuOpen(false); setPublishOpen(true); }} className="flex h-10 w-full items-center gap-2.5 whitespace-nowrap rounded-lg px-3 text-sm font-medium leading-10 text-[#E57218] hover:bg-[#FFF7EF]">
                  <span className="grid h-4 w-4 shrink-0 place-items-center"><PublicIcon name="check" className="h-4 w-4" /></span>
                  <span>Publish Changes</span>
                </button>
                <button type="button" onClick={() => { setActionsMenuOpen(false); setPreviewOpen(true); }} className="flex h-10 w-full items-center gap-2.5 whitespace-nowrap rounded-lg px-3 text-sm font-medium leading-10 text-[#283554] hover:bg-[#FFF7EF]">
                  <span className="grid h-4 w-4 shrink-0 place-items-center"><PublicIcon name="eye" className="h-4 w-4 text-[#66718E]" /></span>
                  <span>Preview</span>
                </button>
                <div className="my-1 border-t border-[#E8EAF2]" />
                <Link href={`/admin/policies/${encodeURIComponent(selectedPolicy?.key || form.key)}/history`} onClick={() => setActionsMenuOpen(false)} className="flex h-10 w-full items-center gap-2.5 whitespace-nowrap rounded-lg px-3 text-sm font-medium leading-10 text-[#283554] hover:bg-[#FFF7EF]">
                  <span className="grid h-4 w-4 shrink-0 place-items-center"><PublicIcon name="clock-9" className="h-4 w-4 text-[#66718E]" /></span>
                  <span>View History</span>
                </Link>
              </div>
            )}
          </div>
        </div>
        </div>
      </header>

      <div className="grid min-w-0 gap-6 py-5 lg:grid-cols-[minmax(0,1fr)_264px] xl:gap-8">
        <article className="min-w-0">
          <div className="mb-4 flex flex-col gap-3 border-b border-[#E8EAF2] pb-4 xl:flex-row xl:items-center xl:justify-between">
            <div className="shrink-0">
              <p className="text-xs font-semibold text-[#101A3C]">Current document</p>
              <p className="mt-0.5 text-xs text-[#66718E]">{currentActionLabel}</p>
            </div>
            <p className="text-xs text-[#66718E]">Use the actions menu to manage this policy.</p>
          </div>

          <div className="rounded-xl border border-[#E8EAF2] bg-white px-5 py-7 shadow-[0_2px_8px_rgba(16,26,60,0.04)] sm:px-8 sm:py-10 lg:px-10">
            <div className="policy-document-content mx-auto max-w-[820px]" dangerouslySetInnerHTML={{ __html: getSafeHtml(selectedPolicy?.content || form.content) }} />
          </div>
        </article>

        <aside className="min-w-0 border-t border-[#E8EAF2] pt-5 lg:border-l lg:border-t-0 lg:pl-5 lg:pt-0 xl:pl-6">
          <h2 className="text-sm font-bold text-[#101A3C]">Legal pages</h2>
          <nav className="mt-3 space-y-1">
            {policies.map((policy) => (
            <Link key={policy.key} href={`/admin/policies/${encodeURIComponent(policy.slug || policy.key)}`} aria-current={policy.key === selectedKey ? "page" : undefined} className={`flex min-h-10 items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium no-underline transition ${policy.key === selectedKey ? "bg-[#FFF0E4] text-[#E57218]" : "text-[#283554] hover:bg-[#FCFCFE] hover:text-[#F57E1F]"}`}>
                <PublicIcon name={policy.key === selectedKey ? "check" : "right"} className={`h-3.5 w-3.5 ${policy.key === selectedKey ? "text-[#F57E1F]" : "text-[#8993AA]"}`} />
                <span className="min-w-0">{policy.title}</span>
              </Link>
            ))}
          </nav>

          <section className="mt-5 border-t border-[#E8EAF2] pt-4">
            <h3 className="text-xs font-semibold text-[#101A3C]">Publishing status</h3>
            <p className={`mt-2 inline-flex items-center gap-2 text-sm font-semibold ${selectedPolicy?.status === "published" ? "text-[#059669]" : "text-[#B45309]"}`}>
              <span className={`h-1.5 w-1.5 rounded-full ${selectedPolicy?.status === "published" ? "bg-[#059669]" : "bg-[#D97706]"}`} />
              {selectedPolicy?.status === "published" ? "Published" : "Draft"}
            </p>
            <p className="mt-1 text-xs leading-5 text-[#66718E]">Published documents are visible on the public marketplace.</p>
          </section>

          <section className="mt-5 border-t border-[#E8EAF2] pt-4">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-semibold text-[#101A3C]">Version information</h3>
              <span className="text-xs font-semibold text-[#283554]">{selectedPolicy?.version || form.version || 1}.0</span>
            </div>
            <h3 className="mt-4 text-xs font-semibold text-[#101A3C]">Audit information</h3>
            <dl className="mt-2 space-y-2 text-xs">
              <div className="flex items-start justify-between gap-3"><dt className="text-[#66718E]">Created</dt><dd className="text-right text-[#283554]">{formatDate(selectedPolicy?.createdAt || form.createdAt || null)}</dd></div>
              <div className="flex items-start justify-between gap-3"><dt className="text-[#66718E]">Last updated</dt><dd className="text-right text-[#283554]">{formatDate(selectedPolicy?.updatedAt || form.updatedAt || null)}</dd></div>
              <div className="flex items-start justify-between gap-3"><dt className="text-[#66718E]">Published</dt><dd className="text-right text-[#283554]">{formatDate(selectedPolicy?.publishedAt || form.publishedAt || null)}</dd></div>
              <div className="flex items-start justify-between gap-3"><dt className="text-[#66718E]">Updated by</dt><dd className="text-right text-[#283554]">{selectedPolicy?.updatedBy ? `Admin #${selectedPolicy.updatedBy}` : "System Administrator"}</dd></div>
            </dl>
          </section>

          <section className="mt-5 border-t border-[#E8EAF2] pt-4">
            <h3 className="text-xs font-semibold text-[#991B1B]">Danger Zone</h3>
            <p className="mt-2 text-xs leading-5 text-[#66718E]">
              Permanently delete this policy, all {selectedPolicy?.versions?.length || 0} saved versions, and public access. This cannot be undone.
            </p>
            <Button
              type="button"
              variant="danger"
              size="sm"
              onClick={() => {
                setDeleteConfirmation("");
                setDeleteOpen(true);
              }}
              className="mt-3 min-h-10 w-full whitespace-normal break-words px-2 text-center text-xs leading-4"
            >
              Delete Policy &amp; All Versions
            </Button>
          </section>

        </aside>
        </div>
        </div>

        {previewOpen && (
        <div className="fixed inset-0 z-[120] grid place-items-center bg-slate-950/40 p-4">
          <div className="w-full max-w-4xl overflow-hidden rounded-xl border border-[#E8EAF2] bg-white shadow-xl">
            <div className="flex items-center justify-between gap-3 border-b border-[#E8EAF2] px-5 py-4 sm:px-7">
              <div>
                <p className="text-xs font-semibold text-[#F57E1F]">Document preview</p>
                <h2 className="mt-1 text-xl font-bold text-[#101A3C]">{form.title}</h2>
              </div>
              <button type="button" onClick={() => setPreviewOpen(false)} className="h-9 rounded-lg border border-[#E8EAF2] px-3 text-xs font-semibold text-[#283554] transition hover:bg-[#FCFCFE]">Close</button>
            </div>
            <div className="max-h-[70vh] overflow-y-auto bg-[#F8F8FF] p-4 sm:p-7">
              <div className="policy-document-content mx-auto max-w-[820px] border border-[#E8EAF2] bg-white px-5 py-7 sm:px-10 sm:py-10" dangerouslySetInnerHTML={{ __html: getSafeHtml(form.content) }} />
            </div>
          </div>
        </div>
      )}


      {deleteOpen && selectedPolicy && (
        <div className="fixed inset-0 z-[130] grid place-items-center bg-slate-950/50 p-4">
          <div role="dialog" aria-modal="true" aria-labelledby="delete-policy-title-main" className="w-full max-w-lg rounded-xl border border-[#FECACA] bg-white p-6 shadow-2xl">
            <div className="flex items-start gap-3">
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-[#FEF2F2] text-[#DC2626]">
                <PublicIcon name="delete" className="h-5 w-5" />
              </span>
              <div>
                <h2 id="delete-policy-title-main" className="text-lg font-bold text-[#991B1B]">Permanently delete policy?</h2>
                <p className="mt-2 text-sm leading-5 text-[#6b7280]">
                  This permanently removes <strong className="text-[#283554]">{selectedPolicy.title}</strong>, all {selectedPolicy.versions?.length || 0} saved versions, and its public page. This action cannot be undone.
                </p>
              </div>
            </div>
            <label htmlFor="delete-policy-confirmation" className="mt-5 block text-sm font-semibold text-[#283554]">
              Type <span className="text-[#B91C1C]">{selectedPolicy.title}</span> to confirm
            </label>
            <input
              id="delete-policy-confirmation"
              autoComplete="off"
              value={deleteConfirmation}
              onChange={(event) => setDeleteConfirmation(event.target.value)}
              className="mt-2 h-11 w-full rounded-lg border border-[#E8EAF2] bg-white px-3 text-sm text-[#101A3C] outline-none focus:border-[#DC2626] focus:ring-2 focus:ring-[#DC2626]/10"
              placeholder={selectedPolicy.title}
            />
            <p className="mt-2 text-xs text-[#7F1D1D]">
              The policy and its version history will be permanently deleted. Audit history is retained.
            </p>
            <div className="mt-6 flex justify-end gap-2">
              <button
                type="button"
                disabled={deletingPolicy}
                onClick={() => {
                  setDeleteOpen(false);
                  setDeleteConfirmation("");
                }}
                className="h-10 rounded-lg border border-[#dfe3ee] px-4 text-xs font-semibold text-[#374151] disabled:opacity-60"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={deletingPolicy || deleteConfirmation !== selectedPolicy.title}
                onClick={() => void handleDeletePolicy()}
                className="h-10 rounded-lg bg-[#DC2626] px-4 text-xs font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
              >
                {deletingPolicy ? "Deleting..." : "Permanently Delete"}
              </button>
            </div>
          </div>
        </div>
      )}
      {toast && <div className="fixed bottom-5 right-5 z-[200] rounded-lg bg-[#111827] px-4 py-3 text-xs font-semibold text-white shadow-xl">{toast}</div>}
    </div>
  );
}
