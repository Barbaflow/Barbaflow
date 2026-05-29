// Minimal service worker for BarbaFlow.
// Purpose: enable system notifications in installed PWAs (especially iOS 16.4+
// where Notification API only works through a registered Service Worker).
//
// IMPORTANT: this SW does NOT cache any responses (no fetch handler) to avoid
// serving stale content. It only handles notification display and clicks.

self.addEventListener("install", (event) => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

// When the user clicks a notification, focus an existing window or open one.
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const targetUrl = (event.notification.data && event.notification.data.url) || "/";
  event.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((clientsArr) => {
        for (const client of clientsArr) {
          if ("focus" in client) {
            client.focus();
            if ("navigate" in client && targetUrl) {
              try { client.navigate(targetUrl); } catch (_) {}
            }
            return;
          }
        }
        if (self.clients.openWindow) {
          return self.clients.openWindow(targetUrl);
        }
      })
  );
});
