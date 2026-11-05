export type PolicyVersion = {
  id: number;
  version: number;
  title: string;
  slug: string;
  category: string;
  description: string;
  content: string;
  status: "draft" | "published";
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
  status: "draft" | "published";
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
const STORAGE_KEY = "admin_legal_policy_store";

const DEFAULT_POLICIES: PolicyRecord[] = [
  {
    id: 1,
    key: "privacy",
    title: "Privacy Policy",
    slug: "privacy-policy",
    category: "privacy",
    description: "How we collect, protect, and use personal information.",
    content: "<h2>What we collect</h2><p>We collect information needed to create and operate accounts, process purchases, deliver files, provide support, and manage creator applications.</p><h2>How we use information</h2><p>We use account and order information to authenticate users, deliver purchased products, prevent abuse, respond to support requests, and meet legal obligations.</p>",
    status: "published",
    version: 1,
    createdAt: "2026-09-08T00:00:00.000Z",
    updatedAt: "2026-09-08T00:00:00.000Z",
    publishedAt: "2026-09-08T00:00:00.000Z",
    versions: [
      { id: 1, version: 1, title: "Privacy Policy", slug: "privacy-policy", category: "privacy", description: "How we collect, protect, and use personal information.", content: "<h2>What we collect</h2><p>We collect information needed to create and operate accounts, process purchases, deliver files, provide support, and manage creator applications.</p>", status: "published", createdAt: "2026-09-08T00:00:00.000Z", publishedAt: "2026-09-08T00:00:00.000Z" },
    ],
  },
  {
    id: 2,
    key: "terms",
    title: "Terms & Conditions",
    slug: "terms-and-conditions",
    category: "terms",
    description: "The agreement governing marketplace use.",
    content: "<h2>Using the marketplace</h2><p>Users must use the marketplace lawfully, provide accurate account information, and keep credentials secure.</p>",
    status: "published",
    version: 1,
    createdAt: "2026-09-08T00:00:00.000Z",
    updatedAt: "2026-09-08T00:00:00.000Z",
    publishedAt: "2026-09-08T00:00:00.000Z",
    versions: [
      { id: 2, version: 1, title: "Terms & Conditions", slug: "terms-and-conditions", category: "terms", description: "The agreement governing marketplace use.", content: "<h2>Using the marketplace</h2><p>Users must use the marketplace lawfully, provide accurate account information, and keep credentials secure.</p>", status: "published", createdAt: "2026-09-08T00:00:00.000Z", publishedAt: "2026-09-08T00:00:00.000Z" },
    ],
  },
  {
    id: 3,
    key: "refunds",
    title: "Refund Policy",
    slug: "refund-policy",
    category: "refunds",
    description: "How refund requests are reviewed and resolved.",
    content: "<h2>Digital products</h2><p>Refund eligibility depends on the product licence, reason for the request, applicable consumer law, and whether the file has been accessed or downloaded.</p>",
    status: "published",
    version: 1,
    createdAt: "2026-09-08T00:00:00.000Z",
    updatedAt: "2026-09-08T00:00:00.000Z",
    publishedAt: "2026-09-08T00:00:00.000Z",
    versions: [
      { id: 3, version: 1, title: "Refund Policy", slug: "refund-policy", category: "refunds", description: "How refund requests are reviewed and resolved.", content: "<h2>Digital products</h2><p>Refund eligibility depends on the product licence, reason for the request, applicable consumer law, and whether the file has been accessed or downloaded.</p>", status: "published", createdAt: "2026-09-08T00:00:00.000Z", publishedAt: "2026-09-08T00:00:00.000Z" },
    ],
  },
  {
    id: 4,
    key: "cookies",
    title: "Cookies Policy",
    slug: "cookies-policy",
    category: "cookies",
    description: "How browser storage and consent are managed.",
    content: "<h2>Necessary storage</h2><p>Necessary browser storage may support sign-in state, security, preferences, and shopping features.</p>",
    status: "published",
    version: 1,
    createdAt: "2026-09-08T00:00:00.000Z",
    updatedAt: "2026-09-08T00:00:00.000Z",
    publishedAt: "2026-09-08T00:00:00.000Z",
    versions: [
      { id: 4, version: 1, title: "Cookies Policy", slug: "cookies-policy", category: "cookies", description: "How browser storage and consent are managed.", content: "<h2>Necessary storage</h2><p>Necessary browser storage may support sign-in state, security, preferences, and shopping features.</p>", status: "published", createdAt: "2026-09-08T00:00:00.000Z", publishedAt: "2026-09-08T00:00:00.000Z" },
    ],
  },
  {
    id: 5,
    key: "acceptable-use",
    title: "Acceptable Use Policy",
    slug: "acceptable-use-policy",
    category: "acceptable-use",
    description: "Rules for lawful and responsible platform use.",
    content: "<h2>Allowed use</h2><p>Use the marketplace to discover, sell, purchase, and manage lawful digital products and related services.</p>",
    status: "published",
    version: 1,
    createdAt: "2026-09-08T00:00:00.000Z",
    updatedAt: "2026-09-08T00:00:00.000Z",
    publishedAt: "2026-09-08T00:00:00.000Z",
    versions: [
      { id: 5, version: 1, title: "Acceptable Use Policy", slug: "acceptable-use-policy", category: "acceptable-use", description: "Rules for lawful and responsible platform use.", content: "<h2>Allowed use</h2><p>Use the marketplace to discover, sell, purchase, and manage lawful digital products and related services.</p>", status: "published", createdAt: "2026-09-08T00:00:00.000Z", publishedAt: "2026-09-08T00:00:00.000Z" },
    ],
  },
];

function getStoragePolicies(): PolicyRecord[] {
  if (typeof window === "undefined") return DEFAULT_POLICIES;
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (!stored) return DEFAULT_POLICIES;
    const parsed = JSON.parse(stored);
    return Array.isArray(parsed) && parsed.length ? parsed : DEFAULT_POLICIES;
  } catch {
    return DEFAULT_POLICIES;
  }
}

function persistStoragePolicies(policies: PolicyRecord[]) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(policies));
}

function combinePolicyRecord(policy: Partial<PolicyRecord>) {
  return {
    id: policy.id ?? null,
    key: String(policy.key || "policy"),
    title: String(policy.title || "New policy"),
    slug: String(policy.slug || "new-policy"),
    category: String(policy.category || "general"),
    description: String(policy.description || ""),
    content: String(policy.content || "<p>Start typing policy content.</p>"),
    status: (policy.status === "published" ? "published" : "draft") as "published" | "draft",
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
  try {
    const response = await fetch(`${API_BASE}/admin/policies?includeDrafts=${String(includeDrafts)}`, {
      headers: getHeaders(),
      cache: "no-store",
    });
    if (!response.ok) throw new Error("Unable to load policies.");
    const payload = await response.json();
    const list = Array.isArray(payload?.policies) ? payload.policies : [];
    const normalized = list.map((item) => combinePolicyRecord(item));
    if (normalized.length) {
      persistStoragePolicies(normalized);
      return normalized;
    }
  } catch {
    const fallback = getStoragePolicies();
    return fallback;
  }

  const fallback = getStoragePolicies();
  return fallback;
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
      status: body.status,
      version: body.version,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(errorText || "Unable to save policy.");
  }

  const result = await response.json();
  const policy = combinePolicyRecord(result.policy ?? body);
  const nextPolicies = getStoragePolicies().filter((entry) => entry.key !== policy.key);
  nextPolicies.push(policy);
  persistStoragePolicies(nextPolicies);
  return policy;
}

export async function publishPolicy(policyId: number | string, payload?: Partial<PolicyRecord>) {
  const body = payload ? combinePolicyRecord(payload) : null;
  const response = await fetch(`${API_BASE}/admin/policies/${policyId}/publish`, {
    method: "POST",
    headers: getHeaders(),
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(errorText || "Unable to publish policy.");
  }
  const result = await response.json();
  const policy = combinePolicyRecord(result.policy ?? body ?? {});
  const nextPolicies = getStoragePolicies().filter((entry) => entry.key !== policy.key);
  nextPolicies.push(policy);
  persistStoragePolicies(nextPolicies);
  return policy;
}

export async function restorePolicy(policyId: number | string, versionId: number | string) {
  const response = await fetch(`${API_BASE}/admin/policies/${policyId}/restore/${versionId}`, {
    method: "POST",
    headers: getHeaders(),
  });
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(errorText || "Unable to restore version.");
  }
  const result = await response.json();
  const policy = combinePolicyRecord(result.policy ?? {});
  const nextPolicies = getStoragePolicies().filter((entry) => entry.key !== policy.key);
  nextPolicies.push(policy);
  persistStoragePolicies(nextPolicies);
  return policy;
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
  const nextPolicies = getStoragePolicies().filter((entry) => String(entry.id) !== String(policyId));
  persistStoragePolicies(nextPolicies);
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
