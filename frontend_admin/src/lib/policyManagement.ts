export type PolicyVersion = {
  id: number;
  version: number;
  title: string;
  slug: string;
  category: string;
  description: string;
  content: string;
  contentJson?: unknown | null;
  status: "draft" | "published" | "archived";
  createdBy?: number | null;
  createdAt?: string | null;
  publishedAt?: string | null;
};

export type PolicyRecord = {
  id: number | null;
  key: string;
  title: string;
  slug: string;
  category: string;
  description: string;
  content: string;
  contentJson?: unknown | null;
  status: "draft" | "published" | "archived";
  version: number;
  createdAt?: string | null;
  updatedAt?: string | null;
  publishedAt?: string | null;
  createdBy?: number | null;
  updatedBy?: number | null;
  versions?: PolicyVersion[];
};

export type PolicyFormState = PolicyRecord & {
  id: number | null;
};

const API_BASE = process.env.NEXT_PUBLIC_API_BASE || "http://localhost:5000/api";
export const POLICY_NAVIGATION_UPDATED_EVENT = "policy-navigation-updated";

function notifyPolicyNavigationUpdated() {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(POLICY_NAVIGATION_UPDATED_EVENT));
}

async function getResponseError(response: Response, fallback: string) {
  const text = await response.text();
  try {
    const payload = JSON.parse(text);
    if (payload && typeof payload.error === "string") return payload.error;
  } catch {
    if (text) return text;
  }
  return fallback;
}

function combinePolicyRecord(policy: Partial<PolicyRecord>) {
  return {
    id: policy.id ?? null,
    key: String(policy.key || ""),
    title: String(policy.title || ""),
    slug: String(policy.slug || ""),
    category: String(policy.category || ""),
    description: String(policy.description || ""),
    content: String(policy.content || ""),
    contentJson: policy.contentJson ?? null,
    status: policy.status === "published" || policy.status === "archived" ? policy.status : "draft",
    version: Number(policy.version || 1),
    createdAt: policy.createdAt || null,
    updatedAt: policy.updatedAt || null,
    publishedAt: policy.publishedAt || null,
    createdBy: policy.createdBy ?? null,
    updatedBy: policy.updatedBy ?? null,
    versions: Array.isArray(policy.versions) ? policy.versions : [],
  } satisfies PolicyRecord;
}

export function slugifyLabel(value: string) {
  return value.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "policy";
}

function getHeaders(extra: Record<string, string> = {}) {
  const token = typeof window !== "undefined" ? window.localStorage.getItem("marketplace-token") : null;
  return {
    "Content-Type": "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...extra,
  };
}

export async function listPolicies(includeDrafts = true): Promise<PolicyRecord[]> {
  const response = await fetch(`${API_BASE}/admin/policies?includeDrafts=${String(includeDrafts)}`, {
    headers: getHeaders(),
    cache: "no-store",
  });
  if (!response.ok) throw new Error(await getResponseError(response, "Unable to load policies."));
  const payload = await response.json();
  return (Array.isArray(payload?.policies) ? payload.policies : []).map((item) => combinePolicyRecord(item));
}

export async function savePolicy(payload: Partial<PolicyRecord>, mode: "create" | "update") {
  const body = combinePolicyRecord(payload);
  const isCreate = mode === "create";
  const endpoint = isCreate ? `${API_BASE}/admin/policies` : `${API_BASE}/admin/policies/${body.id ?? body.key}`;
  const response = await fetch(endpoint, {
    method: isCreate ? "POST" : "PUT",
    headers: getHeaders(),
    body: JSON.stringify({
      ...body,
      id: body.id,
      key: body.key,
      title: body.title,
      slug: body.slug,
      category: body.category,
      description: body.description,
      content: body.content,
      contentJson: body.contentJson,
      status: body.status,
      version: body.version,
    }),
  });

  if (!response.ok) {
    throw new Error(await getResponseError(response, "Unable to save policy."));
  }

  const result = await response.json();
  const saved = combinePolicyRecord(result.policy ?? body);
  notifyPolicyNavigationUpdated();
  return saved;
}

export async function publishPolicy(policyId: number | string, payload?: Partial<PolicyRecord>) {
  const body = payload ? combinePolicyRecord(payload) : null;
  const response = await fetch(`${API_BASE}/admin/policies/${policyId}/publish`, {
    method: "POST",
    headers: getHeaders(),
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!response.ok) {
    throw new Error(await getResponseError(response, "Unable to publish policy."));
  }
  const result = await response.json();
  notifyPolicyNavigationUpdated();
  return combinePolicyRecord(result.policy ?? body ?? {});
}

export async function setPolicyVersionCurrent(policyId: number | string, versionId: number | string) {
  const response = await fetch(`${API_BASE}/admin/policies/${policyId}/set-current/${versionId}`, {
    method: "POST",
    headers: getHeaders(),
  });
  if (!response.ok) throw new Error(await getResponseError(response, "Unable to set policy version as current."));
  const policy = combinePolicyRecord((await response.json()).policy ?? {});
  notifyPolicyNavigationUpdated();
  return policy;
}

export async function unpublishPolicy(policyId: number | string) {
  const response = await fetch(`${API_BASE}/admin/policies/${policyId}/unpublish`, {
    method: "POST",
    headers: getHeaders(),
  });
  if (!response.ok) throw new Error(await getResponseError(response, "Unable to unpublish policy."));
  const policy = combinePolicyRecord((await response.json()).policy ?? {});
  notifyPolicyNavigationUpdated();
  return policy;
}

export async function archivePolicy(policyId: number | string) {
  const response = await fetch(`${API_BASE}/admin/policies/${policyId}/archive`, {
    method: "POST",
    headers: getHeaders(),
  });
  if (!response.ok) throw new Error(await getResponseError(response, "Unable to archive policy."));
  const policy = combinePolicyRecord((await response.json()).policy ?? {});
  notifyPolicyNavigationUpdated();
  return policy;
}

export async function createPolicyVersion(policyId: number | string) {
  const response = await fetch(`${API_BASE}/admin/policies/${policyId}/versions`, {
    method: "POST",
    headers: getHeaders(),
  });
  if (!response.ok) throw new Error(await getResponseError(response, "Unable to create policy version."));
  const policy = combinePolicyRecord((await response.json()).policy ?? {});
  notifyPolicyNavigationUpdated();
  return policy;
}

export async function restorePolicy(policyId: number | string, versionId: number | string) {
  const response = await fetch(`${API_BASE}/admin/policies/${policyId}/restore/${versionId}`, {
    method: "POST",
    headers: getHeaders(),
  });
  if (!response.ok) {
    throw new Error(await getResponseError(response, "Unable to restore version."));
  }
  const result = await response.json();
  notifyPolicyNavigationUpdated();
  return combinePolicyRecord(result.policy ?? {});
}

export async function deletePolicyVersion(policyId: number | string, versionId: number | string) {
  const response = await fetch(`${API_BASE}/admin/policies/${policyId}/versions/${versionId}`, {
    method: "DELETE",
    headers: getHeaders(),
  });
  if (!response.ok) {
    throw new Error(await getResponseError(response, "Unable to delete policy version."));
  }
  const result = await response.json();
  notifyPolicyNavigationUpdated();
  return combinePolicyRecord(result.policy ?? {});
}

export async function deletePolicy(policyId: number | string) {
  const response = await fetch(`${API_BASE}/admin/policies/${policyId}`, {
    method: "DELETE",
    headers: getHeaders(),
  });
  if (!response.ok && response.status !== 204) {
    const errorText = await response.text();
    throw new Error(errorText || "Unable to delete policy.");
  }
  notifyPolicyNavigationUpdated();
  return true;
}

export async function fetchPolicyHistory(policyId: number | string) {
  const response = await fetch(`${API_BASE}/admin/policies/${policyId}/history`, {
    method: "GET",
    headers: getHeaders(),
    cache: "no-store",
  });
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(errorText || "Unable to load policy history.");
  }
  const payload = await response.json();
  return Array.isArray(payload?.versionHistory) ? payload.versionHistory : [];
}
