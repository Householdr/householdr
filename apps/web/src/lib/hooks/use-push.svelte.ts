/**
 * Where push stands on this device: not known before JavaScript runs, not possible in this
 * browser, blocked by the person, off, on, or failed to turn on.
 */
export type PushState = 'no-script' | 'unsupported' | 'blocked' | 'off' | 'on' | 'failed';

/**
 * What the settings page gives: the key to subscribe with, and the endpoints this session holds;
 * null on an instance that offers no push.
 */
interface Push {
  publicKey: string;
  endpoints: string[];
}

const endpoint = '/notification-settings/push';

/** A base64url key as the bytes `subscribe` takes. */
const bytesOf = (key: string) =>
  Uint8Array.from(atob(key.replaceAll('-', '+').replaceAll('_', '/')), (c) => c.charCodeAt(0));

const send = (method: 'POST' | 'DELETE', body: unknown) =>
  fetch(endpoint, {
    method,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

/**
 * Push on this device (ADR-0014 §7, clarification; ADR-0008 §7): whether it is on, and turning it
 * on or off. Only turning it on asks the browser's permission, from the person's own press. The
 * service worker is registered then, not before. A browser subscription this session doesn't hold,
 * such as another account's, counts as off.
 */
export function usePush(push: () => Push | null) {
  let state = $state<PushState>('no-script');
  let busy = $state(false);

  const supported = () =>
    'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

  const current = async () => {
    const registration = await navigator.serviceWorker.getRegistration();
    return (await registration?.pushManager.getSubscription()) ?? null;
  };

  // The browser's own state, which only exists once the page runs in it.
  $effect(() => {
    const endpoints = push()?.endpoints;
    if (!endpoints) return;
    if (!supported()) {
      state = 'unsupported';
      return;
    }
    if (Notification.permission === 'denied') {
      state = 'blocked';
      return;
    }
    void current().then((subscription) => {
      state = subscription && endpoints.includes(subscription.endpoint) ? 'on' : 'off';
    });
  });

  const turnOn = async () => {
    const publicKey = push()?.publicKey;
    if (!publicKey) return;
    busy = true;
    try {
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') {
        state = permission === 'denied' ? 'blocked' : 'off';
        return;
      }
      const registration = await navigator.serviceWorker.register('/service-worker.js', {
        // The dev server serves it as a module; a build bundles it as a classic script.
        type: import.meta.env.DEV ? 'module' : 'classic',
      });
      await navigator.serviceWorker.ready;
      const subscription =
        (await registration.pushManager.getSubscription()) ??
        (await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: bytesOf(publicKey),
        }));
      state = (await send('POST', subscription.toJSON())).ok ? 'on' : 'failed';
    } catch {
      // The browser or its push service refused: nothing was saved.
      state = 'failed';
    } finally {
      busy = false;
    }
  };

  const turnOff = async () => {
    busy = true;
    try {
      const subscription = await current();
      if (subscription) {
        await send('DELETE', { endpoint: subscription.endpoint });
        await subscription.unsubscribe();
      }
      state = 'off';
    } finally {
      busy = false;
    }
  };

  return {
    get state() {
      return state;
    },
    get busy() {
      return busy;
    },
    turnOn,
    turnOff,
  };
}
