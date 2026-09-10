/* Service worker for turn notifications.
 *
 * Deliberately tiny: it shows what the server sent, and focuses an already-open
 * tab on the game rather than piling up duplicates when the notification is
 * tapped.
 */

self.addEventListener("push", (event) => {
  if (!event.data) return;

  let payload;
  try {
    payload = event.data.json();
  } catch {
    return;
  }

  event.waitUntil(
    self.registration.showNotification(payload.title ?? "Cribbage", {
      body: payload.body ?? "",
      // Replaces any earlier notification for the same game.
      tag: payload.tag ?? "cribbage",
      renotify: true,
      icon: "/icon.svg",
      badge: "/icon.svg",
      data: { url: payload.url ?? "/games" },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = event.notification.data?.url ?? "/games";

  event.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((clients) => {
        for (const client of clients) {
          if (client.url.includes(target) && "focus" in client) return client.focus();
        }
        return self.clients.openWindow(target);
      }),
  );
});
