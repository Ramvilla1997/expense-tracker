import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js';
import {
  getAuth, GoogleAuthProvider, signInWithRedirect, getRedirectResult, onAuthStateChanged, signOut,
} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js';
import {
  initializeFirestore, persistentLocalCache, collection, doc, addDoc, updateDoc, getDoc,
  onSnapshot, query, orderBy, limit, serverTimestamp,
} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';
import { firebaseConfig } from './config.js';

const CATEGORIES = ['Food', 'Transport', 'Bills', 'Home', 'Health', 'Fun', 'Other'];
const money = new Intl.NumberFormat('en-CA', { style: 'currency', currency: 'CAD' });
const fmt = (cents) => money.format((cents || 0) / 100);

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = initializeFirestore(app, { localCache: persistentLocalCache() });
const householdRef = doc(db, 'households', 'family');
const entriesRef = collection(db, 'households', 'family', 'entries');

const root = document.getElementById('app');
const tabs = document.getElementById('tabs');

let user = null;
let entries = [];
let view = 'home';
let toast = null;
let toastTimer = null;
let unsubscribe = null;

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const monthKey = (d = new Date()) => d.toISOString().slice(0, 7);
const todayIso = () => new Date().toLocaleDateString('en-CA');
const shortName = (email) => (email === user?.email ? 'You' : 'Brother');
const activeEntries = () => entries.filter((e) => !e.deleted);
const thisMonth = () => activeEntries().filter((e) => e.date?.startsWith(monthKey()));

function setTabs(visible) { tabs.hidden = !visible; }

function setView(next) {
  view = next;
  document.querySelectorAll('#tabs button').forEach((b) => {
    b.setAttribute('aria-current', b.dataset.tab === view ? 'page' : 'false');
  });
  if (view === 'add') return renderAdd();
  render();
}

function render() {
  if (view === 'home') return renderHome();
  if (view === 'activity') return renderActivity();
  if (view === 'family') return renderFamily();
  if (view === 'more') return renderMore();
}

function showToast(message, actionLabel, onAction) {
  clearTimeout(toastTimer);
  document.querySelector('.toast')?.remove();
  const el = document.createElement('div');
  el.className = 'toast';
  el.innerHTML = `<span>${esc(message)}</span>${actionLabel ? `<button type="button">${esc(actionLabel)}</button>` : ''}`;
  if (actionLabel) el.querySelector('button').addEventListener('click', () => { onAction(); el.remove(); });
  document.body.appendChild(el);
  toastTimer = setTimeout(() => el.remove(), 5000);
}

// ---------- Auth ----------

function renderSignIn(message = '') {
  setTabs(false);
  root.innerHTML = `
    <section class="center">
      <h1>Tally</h1>
      <p class="muted">Shared expenses, simply counted. Sign in with Google to continue.</p>
      <button class="btn" id="signin" type="button">Sign in with Google</button>
      <p class="error">${esc(message)}</p>
    </section>`;
  document.getElementById('signin').addEventListener('click', () => {
    const provider = new GoogleAuthProvider();
    provider.setCustomParameters({ prompt: 'select_account' });
    signInWithRedirect(auth, provider);
  });
}

function renderDenied() {
  setTabs(false);
  root.innerHTML = `
    <section class="center">
      <h1>Not invited yet</h1>
      <p class="muted">This Google account is not allowed to use the app. Ask the account owner to add it.</p>
      <button class="btn secondary" id="signout" type="button">Sign out</button>
    </section>`;
  document.getElementById('signout').addEventListener('click', () => signOut(auth));
}

async function isMember(u) {
  try {
    const snap = await getDoc(householdRef);
    return snap.exists() && Array.isArray(snap.data().members) && snap.data().members.includes(u.email);
  } catch (err) {
    return false;
  }
}

function startListening() {
  unsubscribe?.();
  unsubscribe = onSnapshot(
    query(entriesRef, orderBy('date', 'desc'), limit(500)),
    (snap) => {
      entries = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      if (view !== 'add') render();
    },
    (err) => showToast(`Could not load data: ${err.code || err.message}`)
  );
}

getRedirectResult(auth).catch((err) => renderSignIn(err.message));

onAuthStateChanged(auth, async (u) => {
  user = u;
  if (!u) { unsubscribe?.(); entries = []; return renderSignIn(); }
  if (!(await isMember(u))) { unsubscribe?.(); return renderDenied(); }
  setTabs(true);
  startListening();
  setView(view);
});

// ---------- Screens ----------

function renderHome() {
  const mine = thisMonth().filter((e) => e.by === user.email && e.scope === 'mine');
  const shared = thisMonth().filter((e) => e.scope === 'shared');
  const mineTotal = mine.reduce((s, e) => s + e.amount, 0);
  const sharedTotal = shared.reduce((s, e) => s + e.amount, 0);
  const recent = activeEntries().slice(0, 5);
  root.innerHTML = `
    <h1>This month</h1>
    <section class="card">
      <div class="muted">Your personal spending</div>
      <div class="big">${fmt(mineTotal)}</div>
    </section>
    <section class="card">
      <div class="muted">Shared spending, both of you</div>
      <div class="big">${fmt(sharedTotal)}</div>
    </section>
    <h2>Recent</h2>
    <section class="card">${recent.length ? recent.map(rowHtml).join('') : '<p class="muted">Nothing yet. Tap + to add your first entry.</p>'}</section>`;
}

function renderActivity() {
  const list = activeEntries();
  root.innerHTML = `
    <h1>Activity</h1>
    <section class="card">${list.length ? list.map((e) => rowHtml(e, true)).join('') : '<p class="muted">No entries yet.</p>'}</section>`;
  bindDeletes();
}

function renderFamily() {
  const shared = activeEntries().filter((e) => e.scope === 'shared' && e.date?.startsWith(monthKey()));
  const byPerson = {};
  shared.forEach((e) => { byPerson[e.by] = (byPerson[e.by] || 0) + e.amount; });
  const total = Object.values(byPerson).reduce((a, b) => a + b, 0);
  root.innerHTML = `
    <h1>Shared</h1>
    <section class="card">
      <div class="muted">Shared this month</div>
      <div class="big">${fmt(total)}</div>
    </section>
    <h2>Who paid</h2>
    <section class="card">${Object.keys(byPerson).length
      ? Object.entries(byPerson).map(([email, c]) => `<div class="row"><span>${esc(shortName(email))}</span><span class="amount">${fmt(c)}</span></div>`).join('')
      : '<p class="muted">No shared spending this month.</p>'}</section>`;
}

function renderMore() {
  root.innerHTML = `
    <h1>More</h1>
    <section class="card">
      <p class="muted">Signed in as ${esc(user?.email)}</p>
      <button class="btn secondary" id="export" type="button">Export all entries (CSV)</button>
    </section>
    <section class="card">
      <button class="btn secondary" id="signout" type="button">Sign out</button>
    </section>`;
  document.getElementById('export').addEventListener('click', exportCsv);
  document.getElementById('signout').addEventListener('click', () => signOut(auth));
}

function renderAdd() {
  root.innerHTML = `
    <h1>Add entry</h1>
    <form class="card" id="add-form" novalidate>
      <label for="amount">Amount (CAD)</label>
      <input id="amount" inputmode="decimal" placeholder="0.00" required>
      <label for="category">Category</label>
      <select id="category">${CATEGORIES.map((c) => `<option>${esc(c)}</option>`).join('')}</select>
      <label for="date">Date</label>
      <input id="date" type="date" value="${todayIso()}" required>
      <label>Who it's for</label>
      <div class="seg" role="group" aria-label="Scope">
        <button type="button" data-scope="mine" aria-pressed="true">Personal</button>
        <button type="button" data-scope="shared" aria-pressed="false">Shared</button>
      </div>
      <label for="note">Note (optional)</label>
      <input id="note" maxlength="120">
      <p class="error" id="form-error"></p>
      <button class="btn" type="submit">Save</button>
    </form>`;
  let scope = 'mine';
  document.querySelectorAll('[data-scope]').forEach((b) => b.addEventListener('click', () => {
    scope = b.dataset.scope;
    document.querySelectorAll('[data-scope]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
  }));
  document.getElementById('add-form').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const amountText = document.getElementById('amount').value.trim();
    const amount = Math.round(parseFloat(amountText) * 100);
    const errorEl = document.getElementById('form-error');
    if (!amountText || !Number.isFinite(amount) || amount <= 0) {
      errorEl.textContent = 'Enter an amount greater than zero.';
      return;
    }
    try {
      await addDoc(entriesRef, {
        date: document.getElementById('date').value,
        amount,
        category: document.getElementById('category').value,
        note: document.getElementById('note').value.trim(),
        scope,
        by: user.email,
        deleted: false,
        createdAt: serverTimestamp(),
      });
      showToast('Saved');
      setView('home');
    } catch (err) {
      errorEl.textContent = `Could not save: ${err.code || err.message}`;
    }
  });
}

// ---------- Helpers ----------

function rowHtml(e, withDelete = false) {
  return `
    <div class="row">
      <div>${esc(e.note || e.category)}<small>${esc(e.date)} · ${esc(e.category)} · ${e.scope === 'shared' ? 'Shared' : 'Personal'} · ${esc(shortName(e.by))}</small></div>
      <div class="amount">${fmt(e.amount)}${withDelete ? `<br><button class="btn link" data-delete="${esc(e.id)}" type="button">Delete</button>` : ''}</div>
    </div>`;
}

function bindDeletes() {
  document.querySelectorAll('[data-delete]').forEach((b) => b.addEventListener('click', async () => {
    const id = b.dataset.delete;
    const ref = doc(db, 'households', 'family', 'entries', id);
    await updateDoc(ref, { deleted: true });
    showToast('Entry deleted', 'Undo', () => updateDoc(ref, { deleted: false }));
  }));
}

function exportCsv() {
  const header = ['date', 'scope', 'by', 'category', 'amount_cad', 'note'];
  const lines = activeEntries().map((e) => [e.date, e.scope, e.by, e.category, (e.amount / 100).toFixed(2), e.note || '']
    .map((v) => `"${String(v).replace(/"/g, '""')}"`).join(','));
  const blob = new Blob([[header.join(','), ...lines].join('\n')], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `tally-${todayIso()}.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ---------- Navigation ----------

tabs.addEventListener('click', (ev) => {
  const btn = ev.target.closest('button[data-tab]');
  if (btn) setView(btn.dataset.tab);
});
