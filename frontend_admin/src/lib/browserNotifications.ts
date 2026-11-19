export type BrowserNotificationMode = "off" | "foreground" | "push";

const modeStorageKey = "marketplace-browser-notification-mode";
const shownStorageKey = "marketplace-shown-browser-notifications";
const shownIds = new Set<string>();

export function getBrowserNotificationMode(): BrowserNotificationMode {
  const mode = window.localStorage.getItem(modeStorageKey);
  return mode === "foreground" || mode === "push" ? mode : "off";
}

export function setBrowserNotificationMode(mode: BrowserNotificationMode) {
  window.localStorage.setItem(modeStorageKey, mode);
}

function claimNotification(id: string) {
  if (shownIds.has(id)) return false;
  shownIds.add(id);
  if (shownIds.size > 100) {
    const oldestId = shownIds.values().next().value;
    if (oldestId) shownIds.delete(oldestId);
  }

  try {
    const storedIds = JSON.parse(window.localStorage.getItem(shownStorageKey) || "[]");
    const previousIds = Array.isArray(storedIds) ? storedIds.filter((value) => typeof value === "string") : [];
    if (previousIds.includes(id)) return false;
    window.localStorage.setItem(shownStorageKey, JSON.stringify([...previousIds.slice(-99), id]));
  } catch (error) {
    console.warn("Browser notification duplicate suppression is unavailable.", error);
  }
  return true;
}

export function showForegroundNotification(notification: {
  id: string;
  title: string;
  message: string;
  href: string | null;
}) {
  if (
    !("Notification" in window) ||
    getBrowserNotificationMode() === "off" ||
    Notification.permission !== "granted" ||
    document.visibilityState !== "visible"
  ) return;
  if (!claimNotification(notification.id)) return;

  try {
    const browserNotification = new Notification(notification.title, {
      body: notification.message,
      icon: "/icons/notification.svg",
      tag: `marketplace-${notification.id}`,
    });
    browserNotification.onclick = () => {
      window.focus();
      let target = new URL("/notifications", window.location.origin);
      if (notification.href) {
        try {
          const candidate = new URL(notification.href, window.location.origin);
          if (candidate.origin === window.location.origin) target = candidate;
        } catch {
          // Keep the safe notifications page as the fallback.
        }
      }
      window.location.assign(target.href);
    };
  } catch (error) {
    console.error("Unable to display a browser notification.", error);
  }
}
