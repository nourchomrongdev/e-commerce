"use client";

import { useEffect, useState, type FormEvent } from "react";

const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:5000/api";
type CreatorCase = {
  id: number;
  uuid: string;
  status: string;
  createdAt: string;
  productName: string;
  infringementDetails: string;
  requestedInformation: string | null;
  resolutionReason: string | null;
  restorationNotBefore: string | null;
};
type CaseDetails = {
  case: CreatorCase & { originalWork: string; reporterName: string };
  evidence: Array<{ id: number; name: string; mimeType: string; fileSize: number }>;
  history: Array<{ previousStatus: string | null; newStatus: string; reason: string; createdAt: string }>;
  counterNotices: Array<{ statement: string; createdAt: string }>;
};

function authHeaders() {
  return { Authorization: `Bearer ${window.localStorage.getItem("marketplace-token") || ""}` };
}

function encodeEvidence(file: File) {
  return new Promise<{ name: string; mimeType: string; base64: string }>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const base64 = String(reader.result || "").split(",")[1] || "";
      if (!base64) reject(new Error(`Unable to read ${file.name}.`));
      else resolve({ name: file.name, mimeType: file.type, base64 });
    };
    reader.onerror = () => reject(new Error(`Unable to read ${file.name}.`));
    reader.readAsDataURL(file);
  });
}

export default function CreatorDMCACases() {
  const [cases, setCases] = useState<CreatorCase[]>([]);
  const [selected, setSelected] = useState<CaseDetails | null>(null);
  const [statement, setStatement] = useState("");
  const [legalDeclaration, setLegalDeclaration] = useState(false);
  const [evidenceFiles, setEvidenceFiles] = useState<File[]>([]);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const loadCases = async () => {
    const response = await fetch(`${apiUrl}/creator/dmca/cases`, { headers: authHeaders() });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Unable to load copyright complaints.");
    setCases(data.cases || []);
  };

  useEffect(() => {
    let active = true;
    void loadCases()
      .catch((loadError) => { if (active) setError(loadError instanceof Error ? loadError.message : "Unable to load copyright complaints."); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  const openCase = async (item: CreatorCase) => {
    setError("");
    try {
      const response = await fetch(`${apiUrl}/dmca/cases/${item.id}`, { headers: authHeaders() });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Unable to load this case.");
      setSelected(data);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Unable to load this case.");
    }
  };

  const submitCounterNotice = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!selected) return;
    setError("");
    setNotice("");
    setBusy(true);
    try {
      const response = await fetch(`${apiUrl}/creator/dmca/cases/${selected.case.id}/counter-notices`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({
          statement,
          legalDeclarationConfirmed: legalDeclaration,
          evidence: await Promise.all(evidenceFiles.map(encodeEvidence)),
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Unable to submit the counter-notice.");
      setNotice("Counter-notice and evidence submitted.");
      setStatement("");
      setLegalDeclaration(false);
      setEvidenceFiles([]);
      await Promise.all([loadCases(), openCase(cases.find((item) => item.id === selected.case.id) || selected.case)]);
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Unable to submit the counter-notice.");
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

  return <section className="mt-6 overflow-hidden rounded-2xl border border-border bg-white shadow-sm">
    <div className="border-b border-divider px-5 py-4">
      <h2 className="text-sm font-bold text-heading">Copyright complaints</h2>
      <p className="mt-1 text-xs text-muted">Review notifications, submit counter-notices, and track restoration.</p>
    </div>
    {error && <p role="alert" className="px-5 pt-4 text-xs text-status-danger">{error}</p>}
    {notice && <p role="status" className="px-5 pt-4 text-xs text-status-success">{notice}</p>}
    {loading ? <p className="px-5 py-5 text-xs text-muted">Loading complaints…</p> : cases.length === 0
      ? <p className="px-5 py-5 text-xs text-muted">No copyright complaints are associated with your products.</p>
      : <div className="divide-y divide-divider">{cases.map((item) => <article key={item.uuid} className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
        <div><p className="text-xs font-semibold text-body">{item.productName}</p><p className="mt-1 text-[10px] text-muted">{item.uuid} · {new Date(item.createdAt).toLocaleDateString()} · {item.status}</p></div>
        <button type="button" onClick={() => void openCase(item)} className="w-fit rounded-lg border border-border-control px-3 py-2 text-xs font-medium text-body hover:border-primary">View complaint</button>
      </article>)}</div>}
    {selected && <div className="border-t border-divider p-5">
      <div className="flex items-center justify-between gap-3"><h3 className="text-sm font-bold text-heading">{selected.case.productName} · {selected.case.status}</h3><button type="button" onClick={() => setSelected(null)} className="text-xs text-primary underline">Close</button></div>
      <p className="mt-3 whitespace-pre-wrap text-xs text-body">{selected.case.infringementDetails}</p>
      {selected.case.requestedInformation && <p className="mt-3 rounded-lg bg-orange-50 p-3 text-xs text-body"><strong>Information requested:</strong> {selected.case.requestedInformation}</p>}
      {selected.case.resolutionReason && <p className="mt-3 text-xs text-muted"><strong>Reviewer response:</strong> {selected.case.resolutionReason}</p>}
      {selected.case.restorationNotBefore && <p className="mt-2 text-xs text-muted">Restoration review date: {new Date(selected.case.restorationNotBefore).toLocaleDateString()}</p>}
      <div className="mt-4"><h4 className="text-xs font-semibold text-heading">Case evidence</h4>{selected.evidence.length ? selected.evidence.map((item) => <button key={item.id} type="button" onClick={() => void downloadEvidence(selected.case.id, item.id, item.name)} className="mr-3 mt-2 text-xs text-primary underline">{item.name}</button>) : <p className="mt-2 text-xs text-muted">No evidence attached.</p>}</div>
      <div className="mt-4"><h4 className="text-xs font-semibold text-heading">Case history</h4><div className="mt-2 space-y-2">{selected.history.map((item, index) => <p key={`${item.createdAt}-${index}`} className="text-[10px] text-muted">{item.previousStatus ? `${item.previousStatus} → ` : ""}{item.newStatus} · {new Date(item.createdAt).toLocaleString()}{item.reason ? ` · ${item.reason}` : ""}</p>)}</div></div>
      {["Content Disabled", "Takedown Requested"].includes(selected.case.status) && <form onSubmit={submitCounterNotice} className="mt-5 grid gap-3 border-t border-divider pt-4">
        <h4 className="text-xs font-semibold text-heading">Submit a counter-notification</h4>
        <label className="text-xs text-body">Explain why the content was removed in error<textarea value={statement} onChange={(event) => setStatement(event.target.value)} required maxLength={10000} rows={4} className="mt-1 w-full rounded-lg border border-border-control p-3 text-xs" /></label>
        <label className="text-xs text-body">Supporting evidence<input type="file" accept=".pdf,.png,.jpg,.jpeg,.txt,application/pdf,image/png,image/jpeg,text/plain" multiple onChange={(event) => setEvidenceFiles(Array.from(event.target.files || []).slice(0, 5))} className="mt-1 block w-full text-xs" /></label>
        <label className="flex items-start gap-2 text-xs text-body"><input type="checkbox" checked={legalDeclaration} onChange={(event) => setLegalDeclaration(event.target.checked)} required className="mt-0.5" />I consent to the applicable court jurisdiction and will accept service of process as required by the counter-notice process.</label>
        <button type="submit" disabled={busy} className="w-fit rounded-lg bg-primary px-4 py-2 text-xs font-semibold text-white disabled:opacity-50">{busy ? "Submitting…" : "Submit counter-notice"}</button>
      </form>}
    </div>}
  </section>;
}
