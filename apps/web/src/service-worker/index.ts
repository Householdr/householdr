import { pushMessageOf } from '#lib/push-message.js';

// Our own service worker, registered only when someone turns push on for a device (ADR-0014 §7,
// clarification): it shows each push and, when tapped, opens its page. It does nothing else yet.

const worker = self as unknown as ServiceWorkerGlobalScope;

worker.addEventListener('push', (event) => {
  let data: unknown;
  try {
    data = event.data?.json();
  } catch {
    // Not a message of ours; there is nothing to show.
    return;
  }
  const message = pushMessageOf(data);
  if (!message) return;
  event.waitUntil(
    worker.registration.showNotification(message.title, {
      body: message.body,
      data: message,
    }),
  );
});

worker.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const message = pushMessageOf(event.notification.data);
  const url = new URL(message?.path ?? '/', worker.location.origin);
  event.waitUntil(worker.clients.openWindow(url.href));
});
