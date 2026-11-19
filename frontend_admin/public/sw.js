self.addEventListener("push", (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = { body: event.data ? event.data.text() : "" };
  }

  const title = typeof payload.title === "string" && payload.title ? payload.title : "Marketplace update";
  const body = typeof payload.body === "string" ? payload.body : "";
  const id = typeof payload.id === "string" ? payload.id : "";
  const href = typeof payload.href === "string" ? payload.href : "/notifications";

  const notification = { id, title, body, href };
  event.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
    const visibleClients = clients.filter((client) => client.visibilityState === "visible");
    if (visibleClients.length) {
      for (const client of visibleClients) {
        client.postMessage({ type: "marketplace:push-notification", notification });
      }
      return;
    }
    return self.registration.showNotification(title, {
      body,
      icon: "/icons/notification.svg",
      tag: id ? `marketplace-${id}` : undefined,
      data: { href },
    });
  }));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const href = event.notification.data && typeof event.notification.data.href === "string"
    ? event.notification.data.href
    : "/notifications";
  let target = new URL("/notifications", self.location.origin);
  try {
    const candidate = new URL(href, self.location.origin);
    if (candidate.origin === self.location.origin) target = candidate;
  } catch {
    target = new URL("/notifications", self.location.origin);
  }

  event.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(async (clients) => {
    for (const client of clients) {
      if (new URL(client.url).origin !== self.location.origin) continue;
      await client.navigate(target.href);
      return client.focus();
    }
    return self.clients.openWindow(target.href);
  }));
});
