/**
 * Browser-native notifications (Notification API + Service Worker).
 *
 * Works in:
 *   - Desktop browsers (Chrome, Firefox, Edge, Safari) with permission
 *   - Android Chrome / installed PWAs
 *   - iOS 16.4+ when installed as PWA (requires Service Worker registration)
 *
 * Does NOT cache assets — the SW only handles notification display/clicks.
 */

let swRegistrationPromise: Promise<ServiceWorkerRegistration | null> | null = null;

export function isNotificationSupported(): boolean {
  return typeof window !== "undefined" && "Notification" in window;
}

export function getNotificationPermission(): NotificationPermission | "unsupported" {
  if (!isNotificationSupported()) return "unsupported";
  return Notification.permission;
}

/**
 * Detect Lovable preview / iframe contexts. We must NOT register a service
 * worker inside the editor iframe (causes stale content + preview navigation
 * interference). PWA installs always run as top-level documents on the
 * production domain, so this guard does not disable PWA behavior for users.
 */
function isPreviewOrIframe(): boolean {
  if (typeof window === "undefined") return true;
  let inIframe = false;
  try { inIframe = window.self !== window.top; } catch { inIframe = true; }
  const host = window.location.hostname;
  const isPreviewHost =
    host.includes("id-preview--") ||
    host.includes("lovableproject.com") ||
    host.includes("lovable.dev");
  return inIframe || isPreviewHost;
}

function canUseServiceWorker(): boolean {
  return (
    typeof navigator !== "undefined" &&
    "serviceWorker" in navigator &&
    !isPreviewOrIframe()
  );
}

async function ensureServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (!canUseServiceWorker()) return null;
  if (!swRegistrationPromise) {
    swRegistrationPromise = navigator.serviceWorker
      .register("/sw.js", { scope: "/" })
      .then((reg) => reg)
      .catch((err) => {
        console.warn("[notifications] SW registration failed:", err);
        return null;
      });
  }
  return swRegistrationPromise;
}

/**
 * Request permission AND register the service worker (needed for iOS PWA).
 * Safe to call repeatedly.
 */
export async function requestNotificationPermission(): Promise<NotificationPermission | "unsupported"> {
  if (!isNotificationSupported()) return "unsupported";

  let permission = Notification.permission;
  if (permission === "default") {
    try {
      permission = await Notification.requestPermission();
    } catch {
      permission = Notification.permission;
    }
  }

  if (permission === "granted") {
    // Register SW now so iOS / Android PWA can show notifications.
    await ensureServiceWorker();
  }

  return permission;
}

/**
 * Show a system notification. Prefers the Service Worker path (required for
 * iOS PWA) and falls back to `new Notification()` on desktop browsers.
 * Silently no-ops if unsupported or permission not granted.
 */
export async function showBrowserNotification(
  title: string,
  options?: NotificationOptions & { onClickUrl?: string }
): Promise<void> {
  if (!isNotificationSupported()) return;
  if (Notification.permission !== "granted") return;

  const { onClickUrl, ...rest } = options ?? {};
  const payload: NotificationOptions = {
    icon: "/icon-192.png",
    badge: "/icon-192.png",
    ...rest,
    data: { ...(rest.data ?? {}), url: onClickUrl ?? "/" },
  };

  // Try Service Worker first (required on iOS PWA, works everywhere else too).
  if (canUseServiceWorker()) {
    try {
      const reg = await ensureServiceWorker();
      if (reg) {
        await reg.showNotification(title, payload);
        return;
      }
    } catch (err) {
      console.warn("[notifications] SW showNotification failed, falling back:", err);
    }
  }

  // Desktop fallback.
  try {
    const n = new Notification(title, payload);
    if (onClickUrl) {
      n.onclick = () => {
        window.focus();
        if (onClickUrl !== window.location.pathname) {
          window.location.href = onClickUrl;
        }
        n.close();
      };
    }
  } catch (err) {
    console.warn("[notifications] failed to show:", err);
  }
}
