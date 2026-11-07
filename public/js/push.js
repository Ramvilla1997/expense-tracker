// @ts-check
// This phone's side of notifications: ask permission, subscribe, and unsubscribe.
import { vapidPublicKey } from '../config.js';

/** Whether this browser can receive Web Push at all. */
export function pushSupported() {
  return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
}

/** iPhone and iPad only deliver notifications to an app added to the Home Screen. */
export function needsHomeScreen() {
  const apple = /iPhone|iPad|iPod/.test(navigator.userAgent);
  const standalone = matchMedia('(display-mode: standalone)').matches || /** @type {any} */ (navigator).standalone === true;
  return apple && !standalone;
}

/** @returns {Promise<any|null>} the current subscription, or null */
export async function currentSubscription() {
  if (!pushSupported()) return null;
  const registration = await navigator.serviceWorker.ready;
  return registration.pushManager.getSubscription();
}

/**
 * Asks for permission and subscribes this phone.
 * @returns {Promise<{status:'on', subscription:any}|{status:'blocked'}>}
 */
export async function turnOn() {
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') return { status: 'blocked' };
  const registration = await navigator.serviceWorker.ready;
  const subscription = (await registration.pushManager.getSubscription())
    ?? await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: base64UrlToBytes(vapidPublicKey) });
  return { status: 'on', subscription: subscription.toJSON() };
}

/** Unsubscribes this phone from the browser side. */
export async function turnOff() {
  const subscription = await currentSubscription();
  if (subscription) await subscription.unsubscribe();
}

/** @param {string} value */
function base64UrlToBytes(value) {
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(value.length / 4) * 4, '=');
  return Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
}
