"use client";

import { useEffect, useState } from "react";
import {
  getBrowserNotificationMode,
  setBrowserNotificationMode,
  type BrowserNotificationMode,
} from "@/lib/browserNotifications";

const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:5000/api";

function decodeVapidKey(value: string): ArrayBuffer {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
  const decoded = atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, "="));
  const bytes = new Uint8Array(decoded.length);
  for (let index = 0; index < decoded.length; index += 1) bytes[index] = decoded.charCodeAt(index);
  return bytes.buffer;
}

export function BrowserNotificationPreferences() {
  const [token] = useState(() => typeof window === "undefined" ? "" : window.localStorage.getItem("marketplace-token") || "");
  const [mode, setMode] = useState<BrowserNotificationMode>("off");
  const [publicKey, setPublicKey] = useState("");
  const [configLoaded, setConfigLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    if (!token) return;
    let active = true;
    const loadConfig = async () => {
      try {
        const response = await fetch(`${apiUrl}/notifications/push/config`, {
          headers: { Authorization: `Bearer ${token}` },
          cache: "no-store",
        });
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error || "Unable to load browser notification settings.");
        if (!active) return;
        const availableKey = payload.enabled && typeof payload.publicKey === "string" ? payload.publicKey : "";
        setPublicKey(availableKey);
        setConfigLoaded(true);

        const savedMode = getBrowserNotificationMode();
        setMode(savedMode);
        if (savedMode !== "push") return;
        if (!availableKey || !("serviceWorker" in navigator) || !("PushManager" in window)) {
          setBrowserNotificationMode("foreground");
          setMode("foreground");
          setMessage("Web Push is unavailable here; foreground browser notifications remain enabled.");
          return;
        }

        const registration = await navigator.serviceWorker.register("/sw.js");
        const subscription = await registration.pushManager.getSubscription();
        if (!subscription) {
          setBrowserNotificationMode("off");
          setMode("off");
          return;
        }
        const saveResponse = await fetch(`${apiUrl}/notifications/push/subscription`, {
          method: "PUT",
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
          body: JSON.stringify({ subscription: subscription.toJSON() }),
        });
        if (!saveResponse.ok) {
          const savePayload = await saveResponse.json();
          throw new Error(savePayload.error || "Unable to sync this browser push subscription.");
        }
      } catch (loadError) {
        if (active) setError(loadError instanceof Error ? loadError.message : "Unable to load browser notification settings.");
      }
    };
    void loadConfig();
    return () => {
      active = false;
    };
  }, [token]);

  const enable = async () => {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      if (!("Notification" in window)) throw new Error("This browser does not support notifications.");
      const permission = Notification.permission === "default"
        ? await Notification.requestPermission()
        : Notification.permission;
      if (permission !== "granted") throw new Error("Notification permission was not granted. Check this site’s browser settings.");

      if (token && publicKey && "serviceWorker" in navigator && "PushManager" in window) {
        const registration = await navigator.serviceWorker.register("/sw.js");
        const existingSubscription = await registration.pushManager.getSubscription();
        const subscription = existingSubscription || await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: decodeVapidKey(publicKey),
        });
        const response = await fetch(`${apiUrl}/notifications/push/subscription`, {
          method: "PUT",
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
          body: JSON.stringify({ subscription: subscription.toJSON() }),
        });
        if (!response.ok) {
          const payload = await response.json();
          throw new Error(payload.error || "Unable to enable Web Push for this browser.");
        }
        setBrowserNotificationMode("push");
        setMode("push");
        setMessage("Browser notifications are enabled, including when this site is closed.");
      } else {
        setBrowserNotificationMode("foreground");
        setMode("foreground");
        setMessage(!token
          ? "Browser notifications are enabled while the marketplace is open. Sign in to enable background notifications."
          : configLoaded
            ? "Browser notifications are enabled while the marketplace is open. Background Web Push is not configured on this server."
            : "Browser notifications are enabled while the marketplace is open.");
      }
    } catch (enableError) {
      setError(enableError instanceof Error ? enableError.message : "Unable to enable browser notifications.");
    } finally {
      setBusy(false);
    }
  };

  const disable = async () => {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      if (mode === "push" && token && "serviceWorker" in navigator) {
        const registration = await navigator.serviceWorker.getRegistration("/");
        const subscription = await registration?.pushManager.getSubscription();
        if (subscription) {
          const response = await fetch(`${apiUrl}/notifications/push/subscription`, {
            method: "DELETE",
            headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
            body: JSON.stringify({ endpoint: subscription.endpoint }),
          });
          if (!response.ok) {
            const payload = await response.json();
            throw new Error(payload.error || "Unable to disable Web Push for this browser.");
          }
          const unsubscribed = await subscription.unsubscribe();
          if (!unsubscribed) throw new Error("The browser could not remove its push subscription.");
        }
      }
      setBrowserNotificationMode("off");
      setMode("off");
      setMessage("Browser notifications are disabled.");
    } catch (disableError) {
      setError(disableError instanceof Error ? disableError.message : "Unable to disable browser notifications.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-white px-4 py-3">
      <div>
        <h2 className="text-sm font-semibold text-heading">Browser notifications</h2>
        <p className="mt-1 text-xs text-muted">
          {mode === "push"
            ? "Web Push is enabled for this browser."
            : mode === "foreground"
              ? "Notifications appear while the marketplace is open."
              : "Get marketplace updates outside the in-app inbox."}
        </p>
        {message && <p role="status" className="mt-1 text-xs text-status-success">{message}</p>}
        {error && <p role="alert" className="mt-1 text-xs text-status-danger">{error}</p>}
      </div>
      <button
        type="button"
        onClick={() => void (mode === "off" ? enable() : disable())}
        disabled={busy}
        className="rounded-lg border border-border-control bg-white px-3 py-2 text-xs font-semibold text-body disabled:cursor-not-allowed disabled:opacity-50"
      >
        {busy ? "Updating..." : mode === "off" ? "Enable notifications" : "Disable notifications"}
      </button>
    </section>
  );
}
