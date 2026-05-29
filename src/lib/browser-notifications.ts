/**
 * Browser-native notifications (Notification API).
 * Works even when the tab is in background or minimized, as long as
 * the browser/OS allows it and permission was granted.
 */

export function isNotificationSupported(): boolean {
  return typeof window !== "undefined" && "Notification" in window;
}

export function getNotificationPermission(): NotificationPermission | "unsupported" {
  if (!isNotificationSupported()) return "unsupported";
  return Notification.permission;
}

/**
 * Request permission. Returns the final permission state.
 * Safe to call repeatedly.
 */
export async function requestNotificationPermission(): Promise<NotificationPermission | "unsupported"> {
  if (!isNotificationSupported()) return "unsupported";
  if (Notification.permission === "granted" || Notification.permission === "denied") {
    return Notification.permission;
  }
  try {
    const result = await Notification.requestPermission();
    return result;
  } catch {
    return Notification.permission;
  }
}

/**
 * Show a system notification. Silently no-ops if unsupported / denied.
 */
export function showBrowserNotification(
  title: string,
  options?: NotificationOptions & { onClickUrl?: string }
): void {
  if (!isNotificationSupported()) return;
  if (Notification.permission !== "granted") return;

  try {
    const { onClickUrl, ...rest } = options ?? {};
    const n = new Notification(title, {
      icon: "/favicon.ico",
      badge: "/favicon.ico",
      ...rest,
    });
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
