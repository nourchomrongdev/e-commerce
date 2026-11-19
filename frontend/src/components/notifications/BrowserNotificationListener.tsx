"use client";

import { useEffect } from "react";
import { showForegroundNotification } from "@/lib/browserNotifications";

export default function BrowserNotificationListener() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    const handleMessage = (event: MessageEvent) => {
      if (event.data?.type !== "marketplace:push-notification") return;
      const notification = event.data.notification;
      if (
        !notification ||
        typeof notification.id !== "string" ||
        typeof notification.title !== "string" ||
        typeof notification.body !== "string"
      ) return;
      showForegroundNotification({
        id: notification.id,
        title: notification.title,
        message: notification.body,
        href: typeof notification.href === "string" ? notification.href : null,
      });
    };

    navigator.serviceWorker.addEventListener("message", handleMessage);
    return () => navigator.serviceWorker.removeEventListener("message", handleMessage);
  }, []);

  return null;
}
