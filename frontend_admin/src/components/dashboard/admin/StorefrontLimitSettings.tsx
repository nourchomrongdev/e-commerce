"use client";

import { useEffect, useState } from "react";

const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:5000/api";

export default function StorefrontLimitSettings() {
  const [token, setToken] = useState("");
  const [limit, setLimit] = useState("3");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    let active = true;
    const timer = window.setTimeout(() => {
      const storedToken = window.localStorage.getItem("marketplace-token") ?? "";
      if (!active) return;
      setToken(storedToken);
      if (!storedToken) {
        setError("An administrator session is required to manage this setting.");
        setLoading(false);
        return;
      }

      fetch(`${apiUrl}/admin/settings/storefront-limit`, {
        headers: { Authorization: `Bearer ${storedToken}` },
        cache: "no-store",
      })
        .then(async (response) => {
          const result = await response.json();
          if (!response.ok) throw new Error(result.error || "Unable to load storefront limits.");
          if (active) setLimit(String(result.settings.maximumStorefrontsPerCreator));
        })
        .catch((loadError: Error) => {
          if (active) setError(loadError.message);
        })
        .finally(() => {
          if (active) setLoading(false);
        });
    }, 0);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, []);

  async function saveLimit() {
    if (!token || saving) return;
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch(`${apiUrl}/admin/settings/storefront-limit`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ maximumStorefrontsPerCreator: Number(limit) }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Unable to save storefront limits.");
      setNotice(result.message || "Storefront limit saved.");
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Unable to save storefront limits.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="mb-5 rounded-xl border border-border bg-white p-5 shadow-sm">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="text-sm font-bold text-heading">Creator storefront limit</h2>
          <p className="mt-1 max-w-2xl text-xs leading-5 text-muted">
            Set the maximum number of storefronts each creator may own. The default is 3; this limit is enforced by the API.
          </p>
        </div>
        <div className="flex items-end gap-2">
          <label className="text-xs font-medium text-heading">
            Storefronts per creator
            <input
              type="number"
              min="1"
              max="50"
              step="1"
              value={limit}
              onChange={(event) => setLimit(event.target.value)}
              disabled={loading || saving}
              className="mt-1 block w-28 rounded-lg border border-border px-3 py-2 text-sm text-heading outline-none focus:border-primary focus:ring-2 focus:ring-primary/15"
            />
          </label>
          <button
            type="button"
            onClick={saveLimit}
            disabled={loading || saving || !token}
            className="rounded-lg bg-primary px-4 py-2.5 text-xs font-semibold text-white transition hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-50"
          >
            {saving ? "Saving..." : "Save limit"}
          </button>
        </div>
      </div>
      {error && <p role="alert" className="mt-3 text-xs text-red-600">{error}</p>}
      {notice && <p role="status" className="mt-3 text-xs text-emerald-700">{notice}</p>}
    </section>
  );
}
