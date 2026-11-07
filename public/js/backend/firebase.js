// @ts-check
// Firebase implementation of the Tally backend. The UI only talks to this interface,
// so tests can swap in an in-memory backend with the same shape.
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js';
import {
  getAuth, GoogleAuthProvider, signInWithCredential, signInWithPopup, signInWithRedirect, getRedirectResult, onAuthStateChanged, signOut,
} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js';
import {
  initializeFirestore, persistentLocalCache, persistentMultipleTabManager, doc, collection, getDocFromServer, getDocFromCache,
  onSnapshot, setDoc, updateDoc, deleteDoc, serverTimestamp, arrayUnion, arrayRemove, terminate, clearIndexedDbPersistence,
} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';

const HOUSEHOLD = 'family';

/** @param {any} err */
const isDenied = (err) => err?.code === 'permission-denied';

const GIS_SRC = 'https://accounts.google.com/gsi/client';

/** Loads Google Identity Services once; resolves to google.accounts.id. */
/** @returns {Promise<any>} */
function loadGis() {
  const existing = /** @type {any} */ (window).google?.accounts?.id;
  if (existing) return Promise.resolve(existing);
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = GIS_SRC;
    script.async = true;
    script.onload = () => resolve(/** @type {any} */ (window).google.accounts.id);
    script.onerror = () => reject(new Error('gis-load-failed'));
    document.head.appendChild(script);
  });
}

/**
 * Shows Google's account sheet over the app (One Tap). Resolves with the ID token,
 * or 'cancelled' when the person dismisses it, or 'unavailable' when it cannot be shown.
 * @param {string} clientId
 * @returns {Promise<{kind:'token', credential:string}|{kind:'cancelled'}|{kind:'unavailable'}>}
 */
function requestGoogleSheet(clientId) {
  return loadGis().then((id) => new Promise((resolve) => {
    id.initialize({
      client_id: clientId,
      callback: (/** @type {{credential:string}} */ r) => resolve({ kind: 'token', credential: r.credential }),
      cancel_on_tap_outside: true,
      use_fedcm_for_prompt: true,
    });
    id.prompt((/** @type {any} */ n) => {
      if (n.isNotDisplayed() || n.isSkippedMoment()) resolve({ kind: 'unavailable' });
      else if (n.isDismissedMoment()) resolve({ kind: 'cancelled' });
    });
  }));
}

/**
 * @param {Record<string, any>} firebaseConfig
 * @param {{googleClientId?: string}} [options]
 */
export function createFirebaseBackend(firebaseConfig, options = {}) {
  const app = initializeApp(firebaseConfig);
  const auth = getAuth(app);
  const db = initializeFirestore(app, { localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }) });
  const householdRef = doc(db, 'households', HOUSEHOLD);
  const sub = (/** @type {string} */ name) => collection(db, 'households', HOUSEHOLD, name);

  /** @type {(() => void)[]} */
  const unsubscribers = [];

  return {
    /** @param {(user: {email:string, name:string}|null) => void} cb @param {(message: string) => void} onError */
    onAuth(cb, onError) {
      getRedirectResult(auth).catch((err) => onError(friendlyAuthError(err)));
      return onAuthStateChanged(auth, (u) => cb(u ? { email: (u.email ?? '').toLowerCase(), name: u.displayName ?? '' } : null));
    },

    /**
     * Popup sign-in keeps Google's pages out of the browser history, so Back leaves the app.
     * Falls back to a full-page redirect only when the browser blocks the popup.
     * @returns {Promise<'sheet'|'popup'|'redirect'|'cancelled'>}
     */
    async signIn() {
      if (options.googleClientId) {
        let sheet;
        try { sheet = await requestGoogleSheet(options.googleClientId); } catch { sheet = { kind: 'unavailable' }; }
        if (sheet.kind === 'token') {
          await signInWithCredential(auth, GoogleAuthProvider.credential(sheet.credential));
          return 'sheet';
        }
        if (sheet.kind === 'cancelled') return 'cancelled';
      }
      const provider = new GoogleAuthProvider();
      provider.setCustomParameters({ prompt: 'select_account' });
      try {
        await signInWithPopup(auth, provider);
        return 'popup';
      } catch (err) {
        const code = /** @type {any} */ (err)?.code;
        if (code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request') return 'cancelled';
        if (code !== 'auth/popup-blocked' && code !== 'auth/operation-not-supported-in-this-environment') throw err;
        await signInWithRedirect(auth, provider);
        return 'redirect';
      }
    },

    /** Signs out and wipes Firestore's on-device cache so no household data stays behind. */
    async signOut() {
      unsubscribers.splice(0).forEach((u) => u());
      await signOut(auth);
      try {
        await terminate(db);
        await clearIndexedDbPersistence(db);
      } catch { /* another tab still holds the cache; it is cleared on that tab's sign-out */ }
    },

    /**
     * @param {string} email
     * @returns {Promise<{status:'member', members:string[], fromCache:boolean} | {status:'denied'} | {status:'offline'}>}
     */
    async checkAccess(email) {
      const verdict = (/** @type {any} */ snap, fromCache) => {
        const members = (snap.exists() && Array.isArray(snap.data().members) ? snap.data().members : []).map((m) => String(m).toLowerCase());
        return members.includes(email) ? { status: 'member', members, fromCache } : { status: 'denied' };
      };
      try {
        return /** @type {any} */ (verdict(await getDocFromServer(householdRef), false));
      } catch (err) {
        if (isDenied(err)) return { status: 'denied' };
        try {
          const cached = await getDocFromCache(householdRef);
          const v = verdict(cached, true);
          return v.status === 'member' ? /** @type {any} */ (v) : { status: 'offline' };
        } catch {
          return { status: 'offline' };
        }
      }
    },

    /**
     * Setup must only show when the server confirms there is no profile.
     * @param {string} email
     * @returns {Promise<{status:'found', data:any} | {status:'missing'} | {status:'unknown'}>}
     */
    async loadProfile(email) {
      const ref = doc(sub('profiles'), email);
      try {
        const snap = await getDocFromServer(ref);
        return snap.exists() ? { status: 'found', data: snap.data() } : { status: 'missing' };
      } catch {
        try {
          const cached = await getDocFromCache(ref);
          return cached.exists() ? { status: 'found', data: cached.data() } : { status: 'unknown' };
        } catch {
          return { status: 'unknown' };
        }
      }
    },

    /**
     * @param {'entries'|'bills'|'profiles'} name
     * @param {(docs: {id:string, data:any, pending:boolean}[]) => void} cb
     * @param {(err: any) => void} onError
     */
    watch(name, cb, onError) {
      const unsubscribe = onSnapshot(sub(name), { includeMetadataChanges: true }, (snap) => {
        cb(snap.docs.map((d) => ({ id: d.id, data: d.data({ serverTimestamps: 'estimate' }), pending: d.metadata.hasPendingWrites })));
      }, onError);
      unsubscribers.push(unsubscribe);
      return unsubscribe;
    },

    /** @param {'entries'|'bills'} name */
    newId(name) {
      return doc(sub(name)).id;
    },

    /** Creates or replaces my own document. Resolves when the server confirms. @param {'entries'|'bills'} name @param {string} id @param {any} data @param {boolean} isNew */
    put(name, id, data, isNew) {
      const stamp = { updatedAt: serverTimestamp(), ...(isNew ? { createdAt: serverTimestamp() } : {}) };
      return setDoc(doc(sub(name), id), { ...data, ...stamp }, { merge: !isNew });
    },

    /** @param {'entries'|'bills'} name @param {string} id @param {boolean} deleted */
    setDeleted(name, id, deleted) {
      return updateDoc(doc(sub(name), id), { deleted, updatedAt: serverTimestamp() });
    },

    /** Atomic paid toggle so two people tapping at once never lose a mark. @param {string} id @param {string} month @param {boolean} paid */
    markBill(id, month, paid) {
      return updateDoc(doc(sub('bills'), id), { paidMonths: paid ? arrayUnion(month) : arrayRemove(month), updatedAt: serverTimestamp() });
    },

    /** This phone's push subscription, saved under the person's own email so only the daily job reads it. */
    /** @param {string} email @param {any} subscription */
    saveSubscription(email, subscription) {
      const { endpoint, keys } = subscription;
      return setDoc(doc(sub('push'), email), { endpoint, p256dh: keys.p256dh, auth: keys.auth, updatedAt: serverTimestamp() });
    },

    /** @param {string} email */
    deleteSubscription(email) {
      return deleteDoc(doc(sub('push'), email));
    },

    /** Proves who is asking when the server sends a test notification. @returns {Promise<string|null>} */
    async idToken() {
      const user = auth.currentUser;
      return user ? user.getIdToken() : null;
    },

    /** @param {string} email @param {any} data */
    saveProfile(email, data) {
      return setDoc(doc(sub('profiles'), email), { ...data, updatedAt: serverTimestamp() }, { merge: true });
    },
  };
}

/** @param {any} err */
function friendlyAuthError(err) {
  const code = err?.code ?? '';
  if (code === 'auth/network-request-failed') return 'Couldn’t reach Google. Check your connection and try again.';
  if (code === 'auth/unauthorized-domain') return 'This address isn’t allowed to sign in. Open Tally from its usual link.';
  if (code === 'auth/user-cancelled' || code === 'auth/popup-closed-by-user') return '';
  return 'Sign-in didn’t finish. Please try again.';
}
