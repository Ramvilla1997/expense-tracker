// Server-side push: reads household data with the Admin SDK and sends Web Push messages.
// Secrets come only from environment variables set in Vercel; nothing is stored in the repo.
import { cert, getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import * as webPushModule from 'web-push';
import { vapidPublicKey } from '../public/config.js';
import { normalizeBill } from '../public/js/core/bills.js';
import { normalizeDebt } from '../public/js/core/debts.js';
import { normalizeEntry } from '../public/js/core/entries.js';
import { normalizeProfile, normEmail } from '../public/js/core/profile.js';
import { planReminders, REMINDER_URL } from '../public/js/core/reminders.js';
import { loadRate } from '../public/js/core/rates.js';

// web-push is CommonJS: a static import keeps it in the Vercel function bundle; the default export holds the API.
const webpush = webPushModule.default ?? webPushModule;

const APP_URL = 'https://tally-shared-expenses.vercel.app';
const TTL_SECONDS = 12 * 60 * 60;

/** Firestore instance for the Admin SDK, which bypasses client rules. */
export function adminDb() {
  if (!getApps().length) {
    const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
    if (!raw) throw new Error('FIREBASE_SERVICE_ACCOUNT is not set');
    initializeApp({ credential: cert(JSON.parse(raw)) });
  }
  return getFirestore();
}

function configurePush() {
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  if (!privateKey) throw new Error('VAPID_PRIVATE_KEY is not set');
  webpush.setVapidDetails(APP_URL, vapidPublicKey, privateKey);
}

/** Today's date in Toronto, as YYYY-MM-DD. @param {Date} now */
export function torontoToday(now) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Toronto', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
  const part = (/** @type {string} */ type) => parts.find((p) => p.type === type)?.value ?? '';
  return `${part('year')}-${part('month')}-${part('day')}`;
}

/** @param {import('firebase-admin/firestore').Firestore} db */
const household = (db) => db.collection('households').doc('family');

/**
 * Rebuilds the browser's subscription shape from the flat fields saved in Firestore.
 * @param {any} raw @returns {any|null}
 */
export function subscriptionFrom(raw) {
  if (!raw || typeof raw.endpoint !== 'string' || typeof raw.p256dh !== 'string' || typeof raw.auth !== 'string') return null;
  return { endpoint: raw.endpoint, keys: { p256dh: raw.p256dh, auth: raw.auth } };
}

/** @param {import('firebase-admin/firestore').Firestore} db */
async function readMembers(db) {
  const snap = await household(db).get();
  const members = snap.exists && Array.isArray(snap.data()?.members) ? snap.data().members : [];
  return members.map((m) => normEmail(String(m)));
}

/**
 * @template T
 * @param {import('firebase-admin/firestore').Firestore} db
 * @param {string} name
 * @param {(id: string, data: any) => T|null} normalize
 * @returns {Promise<T[]>}
 */
async function readCollection(db, name, normalize) {
  const snap = await household(db).collection(name).get();
  return snap.docs.map((d) => normalize(d.id, d.data())).filter((x) => x !== null);
}

/**
 * Sends one notification. A subscription the browser has dropped (404/410) is removed so it is never retried.
 * @param {import('firebase-admin/firestore').Firestore} db
 * @param {string} email
 * @param {any} subscription
 * @param {{title:string, body:string, tag:string, url:string}} payload
 * @returns {Promise<'sent'|'expired'>}
 */
async function deliver(db, email, subscription, payload) {
  try {
    await webpush.sendNotification(subscription, JSON.stringify(payload), { TTL: TTL_SECONDS });
    return 'sent';
  } catch (err) {
    const code = /** @type {any} */ (err)?.statusCode;
    if (code === 404 || code === 410) {
      await household(db).collection('push').doc(email).delete();
      return 'expired';
    }
    throw err;
  }
}

/** Runs once a day: sends each subscribed person the reminders due today. @param {Date} now */
export async function runDailyReminders(now) {
  configurePush();
  const db = adminDb();
  const today = torontoToday(now);
  const members = await readMembers(db);
  const [bills, debts, entries, profiles, subs, rate] = await Promise.all([
    readCollection(db, 'bills', normalizeBill),
    readCollection(db, 'debts', normalizeDebt),
    readCollection(db, 'entries', normalizeEntry),
    readCollection(db, 'profiles', (id, raw) => normalizeProfile(normEmail(id), raw)),
    readCollection(db, 'push', (id, raw) => ({ email: normEmail(id), subscription: subscriptionFrom(raw) })),
    loadRate({ storage: null, now: now.getTime() }).then((info) => info.rate),
  ]);

  const summary = { today, people: 0, sent: 0, expired: 0 };
  for (const sub of subs) {
    if (!sub.subscription || !members.includes(sub.email)) continue;
    summary.people += 1;
    const profile = profiles.find((p) => p?.email === sub.email) ?? null;
    const reminders = planReminders({ me: sub.email, today, bills, debts, entries, profile, rate });
    for (const reminder of reminders) {
      const outcome = await deliver(db, sub.email, sub.subscription, { ...reminder, url: REMINDER_URL });
      if (outcome === 'sent') summary.sent += 1;
      else summary.expired += 1;
    }
  }
  return summary;
}

/**
 * Confirms a Firebase ID token belongs to a verified household member.
 * @param {string} idToken @returns {Promise<string>} the member's email
 */
export async function memberEmailFromToken(idToken) {
  const db = adminDb();
  const decoded = await getAuth().verifyIdToken(idToken);
  const email = normEmail(decoded.email ?? '');
  if (!decoded.email_verified || !email) throw new Error('unverified');
  const members = await readMembers(db);
  if (!members.includes(email)) throw new Error('not a member');
  return email;
}

/**
 * Sends a test notification to one person's phone.
 * @param {string} email @returns {Promise<'sent'|'expired'|'none'>}
 */
export async function sendTestPush(email) {
  configurePush();
  const db = adminDb();
  const snap = await household(db).collection('push').doc(email).get();
  const subscription = snap.exists ? subscriptionFrom(snap.data()) : null;
  if (!subscription) return 'none';
  return deliver(db, email, subscription, {
    title: 'Tally notifications are on',
    body: 'You’ll get bill and debt reminders here.',
    tag: 'test',
    url: REMINDER_URL,
  });
}
