export type BrowserNotificationStatus = NotificationPermission | 'unsupported';

export function isNotificationSupported(): boolean {
  return typeof window !== 'undefined' && 'Notification' in window;
}

export function getBrowserNotificationPermission(): BrowserNotificationStatus {
  if (!isNotificationSupported()) return 'unsupported';
  return Notification.permission;
}

export async function requestBrowserNotificationPermission(): Promise<BrowserNotificationStatus> {
  if (!isNotificationSupported()) return 'unsupported';

  try {
    if (Notification.permission === 'granted') {
      return 'granted';
    }
    const result = await Notification.requestPermission();
    return result;
  } catch {
    return Notification.permission || 'denied';
  }
}

export function playNotificationSound(): void {
  try {
    const AudioCtx =
      window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return;

    const ctx = new AudioCtx();
    const now = ctx.currentTime;

    const osc1 = ctx.createOscillator();
    const gain1 = ctx.createGain();
    osc1.type = 'sine';
    osc1.frequency.setValueAtTime(587.33, now); // D5
    osc1.frequency.setValueAtTime(880, now + 0.09); // A5

    gain1.gain.setValueAtTime(0.001, now);
    gain1.gain.exponentialRampToValueAtTime(0.12, now + 0.02);
    gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.28);

    osc1.connect(gain1);
    gain1.connect(ctx.destination);

    osc1.start(now);
    osc1.stop(now + 0.29);
  } catch {
    // Ignore audio context autoplay restrictions
  }
}

export interface PushNotificationOptions {
  title: string;
  body: string;
  icon?: string;
  tag?: string;
  onClick?: () => void;
}

export function triggerBrowserNotification(
  options: PushNotificationOptions
): Notification | null {
  if (!isNotificationSupported()) return null;
  if (Notification.permission !== 'granted') return null;

  try {
    const notification = new Notification(options.title, {
      body: options.body,
      icon: options.icon || undefined,
      tag: options.tag || `clickchat-${Date.now()}`,
      silent: false,
    });

    notification.onclick = () => {
      try {
        window.focus();
      } catch {
        // Ignore focus errors
      }
      options.onClick?.();
      notification.close();
    };

    setTimeout(() => {
      try {
        notification.close();
      } catch {
        // Ignore close errors
      }
    }, 6000);

    return notification;
  } catch {
    return null;
  }
}
