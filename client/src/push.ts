import { api, loadStatus, statusStore } from './api';

export function isIOS() {
  return /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

export function isStandalone() {
  return window.matchMedia('(display-mode: standalone)').matches || (navigator as unknown as { standalone?: boolean }).standalone === true;
}

function urlBase64ToUint8Array(base64: string) {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const b64 = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(b64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) out[i] = raw.charCodeAt(i);
  return out;
}

export function pushSupported() {
  return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
}

export async function pushState(): Promise<'unsupported' | 'need-install' | 'denied' | 'off' | 'on'> {
  if (isIOS() && !isStandalone()) return 'need-install';
  if (!pushSupported()) return 'unsupported';
  if (Notification.permission === 'denied') return 'denied';
  try {
    const reg = await navigator.serviceWorker.getRegistration();
    const sub = await reg?.pushManager.getSubscription();
    return sub && Notification.permission === 'granted' ? 'on' : 'off';
  } catch {
    return 'off';
  }
}

export async function enablePush() {
  if (isIOS() && !isStandalone()) throw new Error('На iPhone уведомления работают только в приложении с экрана «Домой»: Поделиться → «На экран Домой», затем открой оттуда.');
  if (!pushSupported()) throw new Error('Этот браузер не поддерживает уведомления');
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') throw new Error('Уведомления запрещены. Разреши их в Настройках iPhone → Уведомления → Распорядок.');
  const status = statusStore.get().status || (await loadStatus());
  if (!status) throw new Error('Нет связи с сервером');
  const reg = await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  const key = urlBase64ToUint8Array(status.push.publicKey);
  if (sub) {
    // если ключ сервера сменился — переподписываемся
    const cur = sub.options?.applicationServerKey ? new Uint8Array(sub.options.applicationServerKey) : null;
    if (!cur || cur.length !== key.length || cur.some((b, i) => b !== key[i])) {
      await sub.unsubscribe();
      sub = null;
    }
  }
  if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
  await api('/api/push/subscribe', { body: { subscription: sub.toJSON() } });
}

export async function disablePush() {
  const reg = await navigator.serviceWorker.getRegistration();
  const sub = await reg?.pushManager.getSubscription();
  if (sub) {
    await api('/api/push/unsubscribe', { body: { endpoint: sub.endpoint } }).catch(() => undefined);
    await sub.unsubscribe();
  }
}
