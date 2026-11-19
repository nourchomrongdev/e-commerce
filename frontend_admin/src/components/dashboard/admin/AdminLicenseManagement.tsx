"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import PublicIcon from "@/components/icons/PublicIcon";
import ProductPagination from "@/components/products/ProductPagination";
import { Badge, Button, MetricTile, Modal } from "@/components/ui";
import useDebouncedValue from "@/hooks/useDebouncedValue";

const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:5000/api";
const pageSize = 10;
type LicenseType = {
  id: number;
  name: string;
  description: string;
  usageRights: string;
  restrictions: string;
  maxActivations: number | null;
  durationDays: number | null;
  requiresKey: boolean;
  isActive: boolean;
};
type License = {
  id: number;
  status: string;
  issuedAt: string;
  expiresAt: string | null;
  revokedAt: string | null;
  revocationReason: string | null;
  productName: string;
  orderNumber: string | null;
  licenseType: string | null;
  buyerEmail: string | null;
  keySuffix: string;
};
type Activation = {
  id: number;
  licenseId: number;
  activatedAt: string;
  lastValidatedAt: string | null;
  deactivatedAt: string | null;
  isActive: boolean;
  deviceName: string | null;
  productName: string;
  buyerEmail: string | null;
};
type Props = { view: "types" | "licenses" | "revoked" | "activations" };

function headers(json = false) {
  return {
    ...(json ? { "Content-Type": "application/json" } : {}),
    Authorization: `Bearer ${window.localStorage.getItem("marketplace-token") || ""}`,
  };
}

const emptyType: LicenseType = {
  id: 0,
  name: "",
  description: "",
  usageRights: "",
  restrictions: "",
  maxActivations: null,
  durationDays: null,
  requiresKey: false,
  isActive: true,
};

export default function AdminLicenseManagement({ view }: Props) {
  const [types, setTypes] = useState<LicenseType[]>([]);
  const [licenses, setLicenses] = useState<License[]>([]);
  const [activations, setActivations] = useState<Activation[]>([]);
  const [policy, setPolicy] = useState({ revokeOnRefund: true, disableActivationsOnRefund: true });
  const [draft, setDraft] = useState<LicenseType>(emptyType);
  const [typeModalOpen, setTypeModalOpen] = useState(false);
  const [selectedLicense, setSelectedLicense] = useState<License | null>(null);
  const [licenseModalMode, setLicenseModalMode] = useState<"actions" | "status" | "audit">("actions");
  const [typeSearch, setTypeSearch] = useState("");
  const [typeStatusFilter, setTypeStatusFilter] = useState("");
  const [search, setSearch] = useState("");
  const [licenseStatusFilter, setLicenseStatusFilter] = useState("");
  const [activationSearch, setActivationSearch] = useState("");
  const [activationStatusFilter, setActivationStatusFilter] = useState("");
  const [typePage, setTypePage] = useState(1);
  const [licensePage, setLicensePage] = useState(1);
  const [activationPage, setActivationPage] = useState(1);
  const [status, setStatus] = useState("suspended");
  const [reason, setReason] = useState("");
  const [audit, setAudit] = useState<Array<{ action: string; details: unknown; createdAt: string; actorEmail: string | null }>>([]);
  const debouncedTypeSearch = useDebouncedValue(typeSearch.trim());
  const debouncedTypeStatusFilter = useDebouncedValue(typeStatusFilter);
  const debouncedLicenseSearch = useDebouncedValue(search.trim());
  const debouncedLicenseStatusFilter = useDebouncedValue(licenseStatusFilter);
  const debouncedActivationSearch = useDebouncedValue(activationSearch.trim());
  const debouncedActivationStatusFilter = useDebouncedValue(activationStatusFilter);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      if (view === "types") {
        const [typeResponse, policyResponse] = await Promise.all([
          fetch(`${apiUrl}/admin/license-types`, { headers: headers() }),
          fetch(`${apiUrl}/admin/drm-policy`, { headers: headers() }),
        ]);
        const [typeData, policyData] = await Promise.all([typeResponse.json(), policyResponse.json()]);
        if (!typeResponse.ok) throw new Error(typeData.error || "Unable to load license types.");
        if (!policyResponse.ok) throw new Error(policyData.error || "Unable to load DRM policy.");
        setTypes(typeData.licenseTypes || []);
        setPolicy(policyData.policy);
      } else if (view === "activations") {
        const response = await fetch(`${apiUrl}/admin/license-activations`, { headers: headers() });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Unable to load activation history.");
        setActivations(data.activations || []);
      } else {
        const effectiveStatus = view === "revoked" ? "revoked" : debouncedLicenseStatusFilter;
        const filter = effectiveStatus ? `&status=${encodeURIComponent(effectiveStatus)}` : "";
        const response = await fetch(`${apiUrl}/admin/licenses?search=${encodeURIComponent(debouncedLicenseSearch)}${filter}`, { headers: headers() });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Unable to load product licenses.");
        setLicenses(data.licenses || []);
      }
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Unable to load license management data.");
    } finally {
      setLoading(false);
    }
  }, [debouncedLicenseSearch, debouncedLicenseStatusFilter, view]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => { setTypePage(1); }, [debouncedTypeSearch, debouncedTypeStatusFilter]);
  useEffect(() => { setLicensePage(1); }, [debouncedLicenseSearch, debouncedLicenseStatusFilter]);
  useEffect(() => { setActivationPage(1); }, [debouncedActivationSearch, debouncedActivationStatusFilter]);

  const saveType = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");
    setNotice("");
    setBusy(true);
    try {
      const response = await fetch(
        draft.id ? `${apiUrl}/admin/license-types/${draft.id}` : `${apiUrl}/admin/license-types`,
        {
          method: draft.id ? "PATCH" : "POST",
          headers: headers(true),
          body: JSON.stringify(draft),
        },
      );
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Unable to save license type.");
      setDraft(emptyType);
      setTypeModalOpen(false);
      setNotice(draft.id ? "License type updated." : "License type created.");
      await load();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Unable to save license type.");
    } finally {
      setBusy(false);
    }
  };

  const savePolicy = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch(`${apiUrl}/admin/drm-policy`, {
        method: "PATCH",
        headers: headers(true),
        body: JSON.stringify(policy),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Unable to save DRM policy.");
      setNotice("Refund DRM policy updated.");
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Unable to save DRM policy.");
    } finally {
      setBusy(false);
    }
  };

  const saveLicenseStatus = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!selectedLicense) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch(`${apiUrl}/admin/licenses/${selectedLicense.id}`, {
        method: "PATCH",
        headers: headers(true),
        body: JSON.stringify({ status, reason }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Unable to update license status.");
      setSelectedLicense(null);
      setReason("");
      setAudit([]);
      setNotice(`License status set to ${status}.`);
      await load();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Unable to update license.");
    } finally {
      setBusy(false);
    }
  };

  const loadAudit = async (license: License) => {
    setError("");
    try {
      const response = await fetch(`${apiUrl}/admin/licenses/${license.id}/audit`, { headers: headers() });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Unable to load license audit history.");
      setAudit(data.events || []);
      setSelectedLicense(license);
      setLicenseModalMode("audit");
    } catch (auditError) {
      setError(auditError instanceof Error ? auditError.message : "Unable to load license history.");
    }
  };

  const title = view === "types" ? "License Types & DRM" : view === "activations" ? "License Activations" : view === "revoked" ? "Revoked Licenses" : "Product Licenses";
  const description = view === "types"
    ? "Manage global license terms, enforcement limits, and refund DRM rules."
    : view === "activations"
      ? "Review device activation history across purchased licenses."
      : "Search purchased licenses and suspend or revoke access.";
  const filteredTypes = types.filter((item) =>
    `${item.name} ${item.description} ${item.usageRights} ${item.restrictions}`.toLowerCase().includes(debouncedTypeSearch.toLowerCase())
    && (!debouncedTypeStatusFilter || (debouncedTypeStatusFilter === "active" ? item.isActive : !item.isActive)),
  );
  const filteredActivations = activations.filter((item) =>
    `${item.productName} ${item.buyerEmail || ""} ${item.licenseId} ${item.deviceName || ""}`.toLowerCase().includes(debouncedActivationSearch.toLowerCase())
    && (!debouncedActivationStatusFilter || (debouncedActivationStatusFilter === "active" ? item.isActive : !item.isActive)),
  );
  const typePages = Math.max(1, Math.ceil(filteredTypes.length / pageSize));
  const activeTypePage = Math.min(typePage, typePages);
  const visibleTypes = filteredTypes.slice((activeTypePage - 1) * pageSize, activeTypePage * pageSize);
  const licensePages = Math.max(1, Math.ceil(licenses.length / pageSize));
  const activeLicensePage = Math.min(licensePage, licensePages);
  const visibleLicenses = licenses.slice((activeLicensePage - 1) * pageSize, activeLicensePage * pageSize);
  const activationPages = Math.max(1, Math.ceil(filteredActivations.length / pageSize));
  const activeActivationPage = Math.min(activationPage, activationPages);
  const visibleActivations = filteredActivations.slice((activeActivationPage - 1) * pageSize, activeActivationPage * pageSize);

  return <div className="mx-auto w-full max-w-[1400px]">
    <header className="mb-5"><h1 className="text-2xl font-bold tracking-tight text-heading sm:text-[28px]">{title}</h1><p className="mt-1 text-sm text-muted">{description}</p></header>
    {error && <p role="alert" className="mb-4 rounded-lg bg-red-50 px-3 py-2 text-xs text-status-danger">{error}</p>}
    {notice && <p role="status" className="mb-4 rounded-lg bg-emerald-50 px-3 py-2 text-xs text-status-success">{notice}</p>}
    {view === "types" && <>
      <div className="mb-5 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MetricTile label="Global license types" value={types.length} icon={<PublicIcon name="type" className="h-4 w-4" />} />
        <MetricTile label="Active types" value={types.filter((item) => item.isActive).length} icon={<PublicIcon name="check" className="h-4 w-4" />} />
        <MetricTile label="Require license keys" value={types.filter((item) => item.requiresKey).length} icon={<PublicIcon name="key" className="h-4 w-4" />} />
        <MetricTile label="Activation limited" value={types.filter((item) => item.maxActivations !== null).length} icon={<PublicIcon name="shield-check" className="h-4 w-4" />} />
      </div>
      <form onSubmit={savePolicy} className="mb-5 flex flex-col gap-3 rounded-2xl border border-border bg-white p-5 shadow-sm">
        <h2 className="text-sm font-bold text-heading">Refund DRM policy</h2>
        <label className="flex items-center gap-2 text-xs text-body"><input type="checkbox" checked={policy.revokeOnRefund} onChange={(event) => setPolicy({ ...policy, revokeOnRefund: event.target.checked })} />Revoke licenses when an order is refunded</label>
        <label className="flex items-center gap-2 text-xs text-body"><input type="checkbox" checked={policy.disableActivationsOnRefund} onChange={(event) => setPolicy({ ...policy, disableActivationsOnRefund: event.target.checked })} />Deactivate all registered devices on refund</label>
        <button disabled={busy} className="w-fit rounded-lg border border-border-control px-4 py-2 text-xs font-semibold text-body disabled:opacity-50">Save policy</button>
      </form>
      <TableCard
        title="Global license types"
        loading={loading}
        headers={["Type", "Usage rights", "Restrictions", "Activations", "Expires", "Key", "Status", "Actions"]}
        pagination={!loading && <ProductPagination count={visibleTypes.length} total={filteredTypes.length} page={activeTypePage} pages={typePages} itemLabel="license types" onPageChange={setTypePage} />}
        toolbar={<>
          <label className="relative block min-w-56 flex-1 sm:max-w-sm">
            <PublicIcon name="search" className="absolute left-3 top-2.5 h-4 w-4 text-muted-faint" />
            <input value={typeSearch} onChange={(event) => setTypeSearch(event.target.value)} placeholder="Search license types..." className="h-9 w-full rounded-lg border border-border-control pl-9 pr-3 text-xs" />
          </label>
          <label className="sr-only" htmlFor="license-type-status-filter">Filter license types by status</label>
          <select id="license-type-status-filter" value={typeStatusFilter} onChange={(event) => setTypeStatusFilter(event.target.value)} className="h-9 rounded-lg border border-border-control bg-white px-3 text-xs text-body">
            <option value="">All statuses</option><option value="active">Active</option><option value="inactive">Inactive</option>
          </select>
          <Button size="sm" onClick={() => { setDraft(emptyType); setTypeModalOpen(true); }}>
            <PublicIcon name="add" className="h-4 w-4" /> Create license type
          </Button>
        </>}
      >
        {visibleTypes.map((item) => <tr key={item.id} className="border-t border-divider"><td className="px-4 py-3 font-medium">{item.name}<span className="mt-1 block max-w-56 truncate text-[10px] font-normal text-muted">{item.description || "Global license type"}</span></td><td className="max-w-56 px-4 py-3"><span className="line-clamp-2">{item.usageRights || "—"}</span></td><td className="max-w-56 px-4 py-3"><span className="line-clamp-2">{item.restrictions || "—"}</span></td><td className="px-4 py-3">{item.maxActivations ?? "Unlimited"}</td><td className="px-4 py-3">{item.durationDays ? `${item.durationDays} days` : "No expiry"}</td><td className="px-4 py-3">{item.requiresKey ? "Required" : "Optional"}</td><td className="px-4 py-3"><Badge tone={item.isActive ? "success" : "neutral"}>{item.isActive ? "Active" : "Inactive"}</Badge></td><td className="px-4 py-3"><Button size="sm" variant="secondary" aria-label={`Edit ${item.name}`} onClick={() => { setDraft(item); setTypeModalOpen(true); }}><PublicIcon name="edit" className="h-4 w-4" /> Edit</Button></td></tr>)}
      </TableCard>
      <Modal
        open={typeModalOpen}
        title={draft.id ? "Edit license type" : "Create global license type"}
        onClose={() => { setDraft(emptyType); setTypeModalOpen(false); }}
        size="lg"
        footer={
          <>
            <Button variant="secondary" onClick={() => { setDraft(emptyType); setTypeModalOpen(false); }}>Cancel</Button>
            <Button type="submit" form="license-type-form" disabled={busy}>{busy ? "Saving…" : draft.id ? "Save changes" : "Create license type"}</Button>
          </>
        }
      >
        <form id="license-type-form" onSubmit={saveType} className="grid gap-3 md:grid-cols-2">
          <label className="text-xs text-body">Name<input required maxLength={100} value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} className="mt-1 h-10 w-full rounded-lg border border-border-control px-3" /></label>
          <label className="text-xs text-body">Description<input value={draft.description} onChange={(event) => setDraft({ ...draft, description: event.target.value })} className="mt-1 h-10 w-full rounded-lg border border-border-control px-3" /></label>
          <label className="text-xs text-body md:col-span-2">Usage rights<textarea value={draft.usageRights} onChange={(event) => setDraft({ ...draft, usageRights: event.target.value })} rows={2} className="mt-1 w-full rounded-lg border border-border-control p-3" /></label>
          <label className="text-xs text-body md:col-span-2">Restrictions<textarea value={draft.restrictions} onChange={(event) => setDraft({ ...draft, restrictions: event.target.value })} rows={2} className="mt-1 w-full rounded-lg border border-border-control p-3" /></label>
          <label className="text-xs text-body">Maximum activations<input type="number" min={1} value={draft.maxActivations ?? ""} onChange={(event) => setDraft({ ...draft, maxActivations: event.target.value ? Number(event.target.value) : null })} placeholder="Unlimited" className="mt-1 h-10 w-full rounded-lg border border-border-control px-3" /></label>
          <label className="text-xs text-body">Expires after (days)<input type="number" min={1} value={draft.durationDays ?? ""} onChange={(event) => setDraft({ ...draft, durationDays: event.target.value ? Number(event.target.value) : null })} placeholder="No expiry" className="mt-1 h-10 w-full rounded-lg border border-border-control px-3" /></label>
          <label className="flex items-center gap-2 text-xs text-body"><input type="checkbox" checked={draft.requiresKey} onChange={(event) => setDraft({ ...draft, requiresKey: event.target.checked })} />Generate and require a license key</label>
          <label className="flex items-center gap-2 text-xs text-body"><input type="checkbox" checked={draft.isActive} onChange={(event) => setDraft({ ...draft, isActive: event.target.checked })} />License type is active</label>
        </form>
      </Modal>
    </>}
    {(view === "licenses" || view === "revoked") && <>
      <TableCard
        title={view === "revoked" ? "Revoked licenses" : "All product licenses"}
        loading={loading}
        headers={["Product", "Buyer", "Order", "License type", "Key suffix", "Issued", "Expires", "Status", "Actions"]}
        pagination={!loading && <ProductPagination count={visibleLicenses.length} total={licenses.length} page={activeLicensePage} pages={licensePages} itemLabel="licenses" onPageChange={setLicensePage} />}
        toolbar={<>
          <label className="relative block min-w-56 flex-1 sm:max-w-sm">
            <PublicIcon name="search" className="absolute left-3 top-2.5 h-4 w-4 text-muted-faint" />
            <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search product, buyer, or order..." className="h-9 w-full rounded-lg border border-border-control pl-9 pr-3 text-xs" />
          </label>
          {view !== "revoked" && <><label className="sr-only" htmlFor="license-status-filter">Filter licenses by status</label><select id="license-status-filter" value={licenseStatusFilter} onChange={(event) => setLicenseStatusFilter(event.target.value)} className="h-9 rounded-lg border border-border-control bg-white px-3 text-xs text-body"><option value="">All statuses</option><option value="active">Active</option><option value="suspended">Suspended</option><option value="revoked">Revoked</option></select></>}
        </>}
      >
        {visibleLicenses.map((item) => <tr key={item.id} className="border-t border-divider"><td className="px-4 py-3 font-medium">{item.productName}</td><td className="px-4 py-3">{item.buyerEmail || "—"}</td><td className="px-4 py-3">{item.orderNumber || "—"}</td><td className="px-4 py-3">{item.licenseType || "—"}</td><td className="px-4 py-3">••••{item.keySuffix || "—"}</td><td className="px-4 py-3">{new Date(item.issuedAt).toLocaleDateString()}</td><td className="px-4 py-3">{item.expiresAt ? new Date(item.expiresAt).toLocaleDateString() : "No expiry"}</td><td className="px-4 py-3"><Badge tone={item.status === "active" ? "success" : item.status === "revoked" ? "danger" : "warning"}>{item.status}</Badge></td><td className="px-4 py-3"><Button size="sm" variant="secondary" aria-label={`Actions for ${item.productName}`} onClick={() => { setSelectedLicense(item); setLicenseModalMode("actions"); setReason(""); setAudit([]); }}><PublicIcon name="ellipsis-vertical" className="h-4 w-4" /></Button></td></tr>)}
      </TableCard>
    </>}
    {view === "activations" && <TableCard title="Activation history" loading={loading} headers={["Product", "Buyer", "License", "Device", "Activated", "Last validated", "Status"]} pagination={!loading && <ProductPagination count={visibleActivations.length} total={filteredActivations.length} page={activeActivationPage} pages={activationPages} itemLabel="activations" onPageChange={setActivationPage} />} toolbar={<>
      <label className="relative block min-w-56 flex-1 sm:max-w-sm">
        <PublicIcon name="search" className="absolute left-3 top-2.5 h-4 w-4 text-muted-faint" />
        <input value={activationSearch} onChange={(event) => setActivationSearch(event.target.value)} placeholder="Search product, buyer, device..." className="h-9 w-full rounded-lg border border-border-control pl-9 pr-3 text-xs" />
      </label>
      <label className="sr-only" htmlFor="activation-status-filter">Filter activations by status</label>
      <select id="activation-status-filter" value={activationStatusFilter} onChange={(event) => setActivationStatusFilter(event.target.value)} className="h-9 rounded-lg border border-border-control bg-white px-3 text-xs text-body"><option value="">All statuses</option><option value="active">Active</option><option value="inactive">Inactive</option></select>
    </>}>
      {visibleActivations.map((item) => <tr key={item.id} className="border-t border-divider"><td className="px-4 py-3 font-medium">{item.productName}</td><td className="px-4 py-3">{item.buyerEmail || "—"}</td><td className="px-4 py-3">#{item.licenseId}</td><td className="px-4 py-3">{item.deviceName || "Unnamed device"}</td><td className="px-4 py-3">{new Date(item.activatedAt).toLocaleString()}</td><td className="px-4 py-3">{item.lastValidatedAt ? new Date(item.lastValidatedAt).toLocaleString() : "—"}</td><td className="px-4 py-3"><Badge tone={item.isActive ? "success" : "neutral"}>{item.isActive ? "Active" : "Inactive"}</Badge></td></tr>)}
    </TableCard>}
    <Modal
      open={Boolean(selectedLicense)}
      title={selectedLicense ? licenseModalMode === "actions" ? `Actions: ${selectedLicense.productName}` : licenseModalMode === "audit" ? `License history: ${selectedLicense.productName}` : `Update license: ${selectedLicense.productName}` : "License actions"}
      onClose={() => { setSelectedLicense(null); setAudit([]); }}
      footer={licenseModalMode === "status" ? <>
        <Button variant="secondary" onClick={() => setLicenseModalMode("actions")}>Back</Button>
        <Button type="submit" form="license-status-form" variant={status === "revoked" ? "danger" : "primary"} disabled={busy}>{busy ? "Saving…" : "Confirm"}</Button>
      </> : undefined}
    >
      {selectedLicense && licenseModalMode === "actions" && <div className="space-y-2">
        <Button variant="secondary" className="w-full justify-start border-border px-4 py-3 text-left" onClick={() => void loadAudit(selectedLicense)}><PublicIcon name="file-search-corner" className="h-5 w-5 text-primary" />View audit history</Button>
        <Button variant="secondary" className="w-full justify-start border-border px-4 py-3 text-left" onClick={() => { setStatus(selectedLicense.status === "active" ? "suspended" : "active"); setLicenseModalMode("status"); }}><PublicIcon name="shield-check" className="h-5 w-5 text-primary" />{selectedLicense.status === "active" ? "Suspend license" : "Reactivate license"}</Button>
        {selectedLicense.status !== "revoked" && <Button variant="danger" className="w-full justify-start px-4 py-3 text-left" onClick={() => { setStatus("revoked"); setLicenseModalMode("status"); }}><PublicIcon name="shield-minus" className="h-5 w-5" />Revoke license</Button>}
      </div>}
      {selectedLicense && licenseModalMode === "status" && <form id="license-status-form" onSubmit={saveLicenseStatus} className="grid gap-3">
        <p className="text-sm text-muted">Change the status of this license for <strong className="text-heading">{selectedLicense.buyerEmail || "the buyer"}</strong>.</p>
        <label className="text-xs text-body">Status<select value={status} onChange={(event) => setStatus(event.target.value)} className="mt-1 h-10 w-full rounded-lg border border-border-control bg-white px-3"><option value="active">Active</option><option value="suspended">Suspended</option><option value="revoked">Revoked</option></select></label>
        <label className="text-xs text-body">Reason<input value={reason} onChange={(event) => setReason(event.target.value)} required={status === "revoked"} placeholder={status === "revoked" ? "Reason required for revocation" : "Optional reason"} className="mt-1 h-10 w-full rounded-lg border border-border-control px-3" /></label>
      </form>}
      {selectedLicense && licenseModalMode === "audit" && <div className="max-h-[55vh] space-y-3 overflow-y-auto">
        {audit.length ? audit.map((item, index) => <article key={`${item.createdAt}-${index}`} className="rounded-lg border border-border p-3"><p className="text-xs font-semibold text-heading">{item.action}</p><p className="mt-1 text-[10px] text-muted">{new Date(item.createdAt).toLocaleString()} · {item.actorEmail || "System"}</p><pre className="mt-2 whitespace-pre-wrap break-words text-[10px] text-muted">{JSON.stringify(item.details, null, 2)}</pre></article>) : <p className="text-sm text-muted">No audit events are recorded for this license.</p>}
      </div>}
    </Modal>
  </div>;
}

function TableCard({ title, headers: tableHeaders, loading, children, toolbar, pagination }: { title: string; headers: string[]; loading: boolean; children: React.ReactNode; toolbar?: React.ReactNode; pagination?: React.ReactNode }) {
  return <section className="overflow-hidden rounded-2xl border border-border bg-white shadow-sm"><div className="border-b border-divider px-5 py-4"><h2 className="text-sm font-bold text-heading">{title}</h2></div>{toolbar && <div className="flex flex-col gap-3 border-b border-divider p-4 sm:flex-row sm:items-center">{toolbar}</div>}{loading ? <p className="px-5 py-6 text-sm text-muted">Loading…</p> : <div className="overflow-x-auto"><table className="w-full min-w-[900px] text-left text-xs"><thead className="bg-surface-muted text-[10px] text-muted"><tr>{tableHeaders.map((item) => <th key={item} className="px-4 py-3 font-medium">{item}</th>)}</tr></thead><tbody>{children}</tbody></table></div>}{pagination}</section>;
}
