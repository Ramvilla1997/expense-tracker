// @ts-check
import { normalizeEntry, validateDraft, EXPENSE_CATEGORIES, INCOME_CATEGORIES, DEBT_CATEGORY, canEdit } from './core/entries.js';
import { normalizeBill, validateBill, payableMonth, billStatus } from './core/bills.js';
import { normalizeDebt, validateDebt, balanceLeft, estimate, paymentsFor, debtTypeLabel } from './core/debts.js';
import { normalizeProfile, validateProfile, guessCurrency, normEmail } from './core/profile.js';
import { parseAmount, minorToInput, convert, formatMoney } from './core/money.js';
import { applyKey, keyFromKeyboard } from './core/keypad.js';
import { todayIso, monthOf, shiftMonth } from './core/dates.js';
import { loadRate, readSavedRate } from './core/rates.js';
import { toCsv } from './core/text.js';
import * as V from './ui/views.js';
import { entrySheet, billSheet, debtSheet, amountDisplay, fitClass } from './ui/sheets.js';
import { esc } from './core/text.js';

export const VERSION = '2.1.0';
const ROUTES = ['home', 'activity', 'shared', 'plan', 'profile'];
const INSTALL_KEY = 'tally.installDismissed';
const SIGNED_OUT_KEY = 'tally.signedOut';
const SLOW_MS = 8000;

/**
 * @param {any} backend see backend/firebase.js for the interface
 * @param {{ storage?: Storage|null }} [options]
 */
export function startApp(backend, options = {}) {
  const storage = options.storage ?? safeStorage();
  const root = /** @type {HTMLElement} */ (document.getElementById('app'));
  const tabs = /** @type {HTMLElement} */ (document.getElementById('tabs'));
  const sheetRoot = /** @type {HTMLElement} */ (document.getElementById('sheet'));
  const backdrop = /** @type {HTMLElement} */ (document.getElementById('backdrop'));
  const toastEl = /** @type {HTMLElement} */ (document.getElementById('toast'));
  const offlineEl = /** @type {HTMLElement} */ (document.getElementById('offline'));

  /** @type {any} */
  const S = {
    phase: 'boot', // boot | signedOut | denied | offline | setup | ready
    authError: '',
    signingIn: false,
    user: null,
    members: [],
    profiles: new Map(),
    profile: null,
    entries: [],
    bills: [],
    debts: [],
    rate: readSavedRate(storage),
    route: routeFromHash(),
    activity: { month: monthOf(todayIso()), filter: 'all' },
    shared: { month: monthOf(todayIso()) },
    form: null, // setup/profile form state
    formDirty: false,
    sheet: null, // EntryDraft | BillDraft
    sheetOpener: null,
    slow: false,
  };
  let watchersStarted = false;
  /** @type {number|undefined} */
  let slowTimer;

  // ---------- rendering ----------

  function viewState() {
    const now = new Date();
    return {
      me: S.user.email,
      profile: S.profile,
      profiles: S.profiles,
      members: S.members,
      entries: S.entries,
      bills: S.bills,
      debts: S.debts,
      rate: S.rate,
      today: todayIso(now),
      hour: now.getHours(),
      activity: S.activity,
      shared: S.shared,
      showInstall: !isStandalone() && storage?.getItem(INSTALL_KEY) !== '1',
      installHint: installHint(),
      version: VERSION,
    };
  }

  function render() {
    const showTabs = S.phase === 'ready' && S.route !== 'profile';
    tabs.hidden = !showTabs;
    root.classList.toggle('no-tabs', !showTabs);
    if (S.phase === 'boot') return set(V.splashView(S.slow));
    if (S.phase === 'signedOut') return set(V.welcomeView({ error: S.authError, busy: S.signingIn }));
    if (S.phase === 'denied') return set(V.deniedView(S.user?.email ?? ''));
    if (S.phase === 'offline') return set(V.offlineView());
    if (S.phase === 'setup') return set(V.setupView(S.form));
    // ready
    const vs = viewState();
    if (tabs.dataset.route !== S.route) {
      tabs.innerHTML = V.tabsView(S.route);
      tabs.dataset.route = S.route;
    }
    if (S.route === 'profile') {
      if (!S.form) S.form = formFromProfile(S.profile);
      return set(V.profileView(vs, S.form));
    }
    if (S.route === 'activity') return set(V.activityView(vs));
    if (S.route === 'shared') return set(V.sharedView(vs));
    if (S.route === 'plan') return set(V.planView(vs));
    return set(V.homeView(vs));
  }

  /** Replaces the main view, keeping focus on the same control when it still exists. @param {string} html */
  let lastViewHtml = '';
  let lastViewKey = '';
  function set(html) {
    // Identical markup means nothing visible changed: keep the DOM so taps in flight still land.
    if (html === lastViewHtml) return;
    lastViewHtml = html;
    // Only a real screen change plays the entrance fade; data updates swap content silently.
    const viewKey = `${S.phase}:${S.route}`;
    root.dataset.enter = viewKey !== lastViewKey ? '1' : '0';
    lastViewKey = viewKey;
    const focused = /** @type {HTMLElement|null} */ (document.activeElement);
    const key = focused && root.contains(focused) ? focusKey(focused) : null;
    const scrollY = window.scrollY;
    root.innerHTML = html;
    if (key) /** @type {HTMLElement|null} */ (root.querySelector(key))?.focus({ preventScroll: true });
    window.scrollTo(0, scrollY);
  }

  /** Re-render unless the person is typing in a form on the main view. */
  function refresh() {
    if (S.phase === 'ready' && S.route === 'profile' && S.formDirty) return;
    if (S.phase === 'setup') return;
    render();
    if (S.sheet) renderSheet();
  }

  // ---------- lifecycle ----------

  function boot() {
    // After a sign-out reload, start on the welcome screen instead of the splash; auth still confirms it.
    if (storage?.getItem(SIGNED_OUT_KEY) === '1') S.phase = 'signedOut';
    slowTimer = window.setTimeout(() => { if (S.phase === 'boot') { S.slow = true; render(); } }, SLOW_MS);
    render();
    backend.onAuth(onUser, (/** @type {string} */ message) => {
      S.signingIn = false;
      S.authError = message;
      if (S.phase === 'signedOut') render();
    });
    loadRate({ storage }).then((r) => { S.rate = r; refresh(); });
    window.addEventListener('online', updateOnline);
    window.addEventListener('offline', updateOnline);
    updateOnline();
    // A bfcache restore after backing out of Google must re-enable the sign-in button.
    window.addEventListener('pageshow', () => { if (S.signingIn) { S.signingIn = false; render(); } });
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && S.phase === 'ready') refresh(); });
  }

  /** @param {{email:string, name:string}|null} user */
  async function onUser(user) {
    if (!user) {
      S.user = null;
      S.phase = 'signedOut';
      clearTimeout(slowTimer);
      render();
      return;
    }
    S.user = { email: normEmail(user.email), name: user.name };
    try { storage?.removeItem(SIGNED_OUT_KEY); } catch { /* ignore */ }
    const access = await backend.checkAccess(S.user.email);
    if (access.status === 'denied') { S.phase = 'denied'; clearTimeout(slowTimer); return render(); }
    if (access.status === 'offline') { S.phase = 'offline'; clearTimeout(slowTimer); return render(); }
    S.members = access.members;

    const profile = await backend.loadProfile(S.user.email);
    clearTimeout(slowTimer);
    if (profile.status === 'unknown') { S.phase = 'offline'; return render(); }
    const normalized = profile.status === 'found' ? normalizeProfile(S.user.email, profile.data) : null;
    if (!normalized) {
      S.form = {
        name: (user.name || '').split(/\s+/)[0] || '',
        homeCurrency: guessCurrency(Intl.DateTimeFormat().resolvedOptions().timeZone),
        budgetText: '', payFrequency: '', payAnchor: '', errors: {}, saving: false,
      };
      S.phase = 'setup';
      return render();
    }
    S.profile = normalized;
    enterApp();
  }

  function enterApp() {
    S.phase = 'ready';
    S.form = null;
    S.formDirty = false;
    if (!ROUTES.includes(S.route)) S.route = 'home';
    startWatchers();
    render();
  }

  function startWatchers() {
    if (watchersStarted) return;
    watchersStarted = true;
    const onError = (/** @type {any} */ err) => {
      if (err?.code === 'permission-denied') { S.phase = 'denied'; render(); }
      else toast('Couldn’t load the latest data. Showing what’s saved on this phone.');
    };
    backend.watch('entries', (/** @type {any[]} */ docs) => {
      S.entries = docs.map((d) => { const e = normalizeEntry(d.id, d.data); return e && { ...e, pending: d.pending, clientCreatedAt: Number(d.data.clientCreatedAt) || 0 }; })
        .filter((/** @type {any} */ e) => e !== null)
        .sort((/** @type {any} */ a, /** @type {any} */ b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : b.clientCreatedAt - a.clientCreatedAt));
      syncOpenSheet();
      refresh();
    }, onError);
    backend.watch('bills', (/** @type {any[]} */ docs) => {
      S.bills = docs.map((d) => normalizeBill(d.id, d.data)).filter(Boolean);
      refresh();
    }, onError);
    // Debts are newer than the rest: if this household's rules don't allow them yet, keep the app working without them.
    backend.watch('debts', (/** @type {any[]} */ docs) => {
      S.debts = docs.map((d) => normalizeDebt(d.id, d.data)).filter(Boolean);
      refresh();
    }, (/** @type {any} */ err) => { console.warn('Debts unavailable', err?.code); S.debts = []; S.debtsBlocked = err?.code === 'permission-denied'; refresh(); });
    backend.watch('profiles', (/** @type {any[]} */ docs) => {
      S.profiles = new Map();
      for (const d of docs) {
        const p = normalizeProfile(normEmail(d.id), d.data);
        if (p) S.profiles.set(p.email, p);
      }
      const mine = S.profiles.get(S.user.email);
      if (mine) S.profile = mine;
      refresh();
    }, onError);
  }

  /** If the entry being edited was deleted elsewhere, close the sheet and say so. */
  function syncOpenSheet() {
    const d = S.sheet;
    if (!d || d.kind !== 'entry' || d.mode === 'add') return;
    const current = S.entries.find((/** @type {any} */ e) => e.id === d.id);
    if (!current || current.deleted) {
      closeSheet({ force: true });
      toast('That entry was deleted on another device.');
    }
  }

  function updateOnline() {
    offlineEl.hidden = navigator.onLine;
  }

  // ---------- writes (never block the UI on the network) ----------

  /** @param {Promise<any>} promise @param {string} failure */
  function background(promise, failure) {
    promise.catch((err) => {
      console.error(err);
      toast(err?.code === 'permission-denied' ? `${failure} You don’t have permission for that.` : `${failure} Please try again.`);
    });
  }

  // ---------- sheets ----------

  /** @param {any} draft */
  function openSheet(draft) {
    // Moving from one sheet to another (a debt to its Pay sheet) swaps content in place, keeping one history entry.
    if (S.sheet) {
      S.sheet = draft;
      lastSheetHtml = '';
      renderSheet();
      sheetRoot.scrollTop = 0;
      sheetRoot.focus();
      return;
    }
    S.sheetOpener = document.activeElement;
    S.sheet = draft;
    lastSheetHtml = '';
    renderSheet();
    sheetRoot.hidden = false;
    backdrop.hidden = false;
    document.body.style.overflow = 'hidden';
    requestAnimationFrame(() => { sheetRoot.classList.add('open'); backdrop.classList.add('open'); });
    history.pushState({ sheet: true }, '', location.hash || '#/home');
    if ((draft.kind === 'bill' || draft.kind === 'debt') && draft.mode === 'add') /** @type {HTMLElement|null} */ (sheetRoot.querySelector('input[name="name"]'))?.focus();
    else sheetRoot.focus();
  }

  let lastSheetHtml = '';
  function renderSheet() {
    if (!S.sheet) return;
    const html = S.sheet.kind === 'entry' ? entrySheet(S.sheet, todayIso()) : S.sheet.kind === 'debt' ? debtSheet(S.sheet, todayIso()) : billSheet(S.sheet);
    // A live update that changes nothing must not replace the keypad under the finger.
    if (html === lastSheetHtml) return;
    lastSheetHtml = html;
    const focused = /** @type {HTMLElement|null} */ (document.activeElement);
    const fkey = focused && sheetRoot.contains(focused) ? focused.getAttribute('data-fkey') : null;
    sheetRoot.innerHTML = html;
    if (fkey) /** @type {HTMLElement|null} */ (sheetRoot.querySelector(`[data-fkey="${CSS.escape(fkey)}"]`))?.focus({ preventScroll: true });
    if (S.sheet.confirmDiscard || S.sheet.confirmDelete) /** @type {HTMLElement|null} */ (sheetRoot.querySelector('[data-fkey="keep"]'))?.focus();
  }

  /** Close requested by the person (button, backdrop, Esc, Back). */
  function requestClose() {
    const d = S.sheet;
    if (!d) return;
    if (d.dirty && !d.confirmDiscard) {
      d.confirmDiscard = true;
      renderSheet();
      return;
    }
    closeSheet();
  }

  /** @param {{force?: boolean, fromPop?: boolean}} [o] */
  function closeSheet(o = {}) {
    if (!S.sheet) return;
    S.sheet = null;
    sheetRoot.classList.remove('open');
    backdrop.classList.remove('open');
    document.body.style.overflow = '';
    lastSheetHtml = '';
    const done = () => { if (!S.sheet) { sheetRoot.hidden = true; backdrop.hidden = true; sheetRoot.innerHTML = ''; } };
    reducedMotion() ? done() : setTimeout(done, 320);
    if (!o.fromPop && history.state?.sheet) history.back();
    const opener = S.sheetOpener;
    S.sheetOpener = null;
    if (opener && document.contains(opener)) opener.focus({ preventScroll: true });
    else /** @type {HTMLElement|null} */ (tabs.querySelector('.fab'))?.focus({ preventScroll: true });
  }

  /** @param {any} [entry] */
  function openEntry(entry) {
    const today = todayIso();
    if (!entry) {
      return openSheet({ kind: 'entry', mode: 'add', id: backend.newId('entries'), type: 'expense', amountText: '', currency: S.profile.homeCurrency,
        category: 'Food', date: today, scope: 'mine', note: '', author: '', error: '', confirmDiscard: false, confirmDelete: false, dirty: false });
    }
    const mine = canEdit(entry, S.user.email);
    const paidDebt = entry.debtId ? S.debts.find((/** @type {any} */ x) => x.id === entry.debtId) : null;
    if (entry.debtId && mine) return openPay(paidDebt, entry);
    openSheet({ kind: 'entry', mode: mine ? 'edit' : 'view', id: entry.id, type: entry.type, amountText: minorToInput(entry.amount), currency: entry.currency,
      category: entry.category, date: entry.date, scope: entry.scope, note: entry.note, author: V.personName(viewState(), entry.by, { you: false }),
      error: '', confirmDiscard: false, confirmDelete: false, dirty: false });
  }

  function saveEntry() {
    const d = S.sheet;
    readSheetInputs();
    const amount = parseAmount(d.amountText);
    const draft = { type: d.type, amount, category: d.category, date: d.date, note: d.note.trim(), scope: d.type === 'income' ? 'mine' : d.scope, ...(d.debtId ? { debtId: d.debtId } : {}) };
    const error = validateDraft(draft, todayIso());
    if (error) { d.error = error; renderSheet(); return; }
    const isNew = d.mode === 'add';
    const data = { ...draft, amount, currency: d.currency, by: S.user.email, deleted: false, ...(isNew ? { clientCreatedAt: Date.now() } : {}) };
    background(backend.put('entries', d.id, data, isNew), 'Couldn’t save that entry.');
    closeSheet({ force: true });
    if (d.debtId) toast(isNew ? `Paid ${formatMoney(/** @type {number} */ (amount), d.currency)} to ${d.debtName}` : 'Payment updated');
    else toast(isNew ? `Saved ${formatMoney(/** @type {number} */ (amount), d.currency)}` : 'Changes saved');
  }

  function readSheetInputs() {
    const d = S.sheet;
    if (!d) return;
    const val = (/** @type {string} */ n) => /** @type {HTMLInputElement|null} */ (sheetRoot.querySelector(`[name="${n}"]`))?.value;
    if (d.kind === 'entry') {
      d.note = val('note') ?? d.note;
      d.date = val('date') ?? d.date;
    } else if (d.kind === 'debt') {
      d.name = val('name') ?? d.name;
      d.balanceText = val('balance') ?? d.balanceText;
      d.balanceDate = val('balanceDate') ?? d.balanceDate;
      d.minimumText = val('minimum') ?? d.minimumText;
      d.dueDayText = val('dueDay') ?? d.dueDayText;
      d.aprText = val('apr') ?? d.aprText;
    } else {
      d.name = val('name') ?? d.name;
      d.amountText = val('amount') ?? d.amountText;
      d.dueDayText = val('dueDay') ?? d.dueDayText;
    }
  }

  /** @param {string} id */
  function deleteEntry(id) {
    background(backend.setDeleted('entries', id, true), 'Couldn’t delete that entry.');
    closeSheet({ force: true });
    toast('Entry deleted', { label: 'Undo', run: () => background(backend.setDeleted('entries', id, false), 'Couldn’t restore that entry.') });
  }

  // ---------- debts ----------

  /**
   * Opens the Pay sheet for a debt, or edits an existing payment.
   * @param {any} debt @param {any} [entry]
   */
  function openPay(debt, entry) {
    if (!debt && !entry) return;
    const currency = entry ? entry.currency : debt.currency;
    const rate = S.rate.rate;
    const others = entry ? S.entries.filter((/** @type {any} */ e) => e.id !== entry.id) : S.entries;
    const left = debt ? balanceLeft(debt, others, rate) : 0;
    const presets = [];
    if (debt && left > 0) {
      if (debt.minimum > 0 && debt.minimum < left) presets.push({ label: 'Minimum', amountText: minorToInput(debt.minimum) });
      const est = estimate(left, debt.apr, debt.minimum);
      if (est && est.clearIn24 > debt.minimum && est.clearIn24 < left) presets.push({ label: 'Clears in 2 yrs', amountText: minorToInput(est.clearIn24) });
      presets.push({ label: 'Full', amountText: minorToInput(left) });
    }
    const after = (/** @type {string} */ text) => {
      if (!debt) return '';
      const paying = parseAmount(text) ?? 0;
      const rest = Math.max(0, left - paying);
      return rest === 0 && paying > 0 ? 'This pays it off.' : `Balance after: ${formatMoney(rest, debt.currency)}`;
    };
    const today = todayIso();
    const base = { kind: 'entry', type: 'expense', category: DEBT_CATEGORY, debtId: entry?.debtId ?? debt.id, debtName: debt?.name ?? entry.note, currency,
      presets, after, author: '', error: '', confirmDiscard: false, confirmDelete: false, dirty: false };
    if (entry) {
      return openSheet({ ...base, mode: 'edit', id: entry.id, amountText: minorToInput(entry.amount), date: entry.date, scope: entry.scope, note: entry.note });
    }
    openSheet({ ...base, mode: 'add', id: backend.newId('entries'), amountText: debt.minimum > 0 && debt.minimum < left ? minorToInput(debt.minimum) : '',
      date: today, scope: debt.scope, note: `${debt.name} payment` });
  }

  /** Summary shown above an existing debt's form: what is left, progress, estimates, payments. @param {any} debt */
  function debtSummary(debt) {
    const rate = S.rate.rate;
    const left = balanceLeft(debt, S.entries, rate);
    const pct = debt.balance > 0 ? Math.round(((debt.balance - left) / debt.balance) * 100) : 100;
    const est = estimate(left, debt.apr, debt.minimum);
    const pays = paymentsFor(debt, S.entries).slice(0, 5);
    const fm = (/** @type {number} */ m) => formatMoney(m, debt.currency);
    const compare = est ? `<div class="card card-pad" role="note"><div class="spread"><span class="row-title">Each month</span>
        ${est.covers ? '' : `<span class="flag neg" style="margin:0">${'Balance grows'}</span>`}</div>
        <div class="compare"><span class="muted" style="font-weight:600">Interest</span><i style="background:var(--amber);width:${Math.round((Math.min(est.interest, Math.max(est.interest, debt.minimum)) / Math.max(est.interest, debt.minimum, 1)) * 100)}%"></i><span class="num">${esc(fm(est.interest))}</span>
          <span class="muted" style="font-weight:600">Minimum</span><i style="background:var(--brand);width:${Math.round((debt.minimum / Math.max(est.interest, debt.minimum, 1)) * 100)}%"></i><span class="num">${esc(fm(debt.minimum))}</span></div>
        <p class="muted small" style="margin:12px 0 0">${est.months ? `At the minimum, paid off in about ${est.months} month${est.months === 1 ? '' : 's'}. ` : ''}Pay <strong style="color:var(--ink)">${esc(fm(est.clearIn24))} a month</strong> to clear it in about 2 years. A rough estimate from the ${debt.apr}% rate; your statement is the real number.</p></div>` : '';
    return `<div class="card card-pad"><div class="muted small" style="font-weight:600">Balance left · ${esc(debtTypeLabel(debt.type))}</div>
        <div class="num" style="font-size:34px;line-height:1.1">${esc(fm(left))}</div>
        <div class="bar" style="height:10px;margin-top:12px" role="img" aria-label="${pct} percent paid off"><span style="width:${Math.max(pct > 0 ? 2 : 0, pct)}%;background:var(--pos)"></span></div>
        <div class="spread muted small" style="margin-top:8px"><span>${pct}% paid off</span><span>from ${esc(fm(debt.balance))} on ${esc(debt.balanceDate)}</span></div>
        ${left > 0 ? `<button type="button" class="btn" style="margin-top:14px" data-action="pay-debt" data-id="${esc(debt.id)}">Pay ${esc(debt.name)}</button>` : ''}</div>
      ${compare}
      ${pays.length ? `<section class="grp"><div class="gh"><h3 class="h2" style="font-size:16px">Payments</h3></div><div class="card list">${pays.map((/** @type {any} */ e) => `<button type="button" class="row" data-action="open-entry" data-id="${esc(e.id)}"><span>${esc(e.date)} · ${esc(V.personName(viewState(), e.by))}</span><span class="row-amt">${esc(formatMoney(e.amount, e.currency))}</span></button>`).join('')}</div></section>` : ''}`;
  }

  /** @param {any} [debt] */
  function openDebt(debt) {
    const blank = { kind: 'debt', error: '', confirmDiscard: false, confirmDelete: false, dirty: false };
    if (!debt) {
      if (S.debtsBlocked) { toast('Debts aren’t switched on for this household yet. Ask the person who set up Tally to update its rules.'); return; }
      return openSheet({ ...blank, mode: 'add', id: backend.newId('debts'), name: '', type: 'card', currency: S.profile.homeCurrency, balanceText: '', balanceDate: todayIso(),
        minimumText: '', dueDayText: '', aprText: '', scope: 'shared', summary: '' });
    }
    if (debt.by !== S.user.email) {
      return openSheet({ ...blank, mode: 'edit', readOnly: true, id: debt.id, name: debt.name, type: debt.type, currency: debt.currency, balanceText: minorToInput(debt.balance), balanceDate: debt.balanceDate,
        minimumText: debt.minimum ? minorToInput(debt.minimum) : '', dueDayText: debt.dueDay ? String(debt.dueDay) : '', aprText: debt.apr === null ? '' : String(debt.apr), scope: debt.scope,
        summary: `${debtSummary(debt)}<p class="muted small" style="margin:0">Only ${esc(V.personName(viewState(), debt.by, { you: false }))} can change this debt. You can still log payments.</p>` });
    }
    openSheet({ ...blank, mode: 'edit', id: debt.id, name: debt.name, type: debt.type, currency: debt.currency, balanceText: minorToInput(debt.balance), balanceDate: debt.balanceDate,
      minimumText: debt.minimum ? minorToInput(debt.minimum) : '', dueDayText: debt.dueDay ? String(debt.dueDay) : '', aprText: debt.apr === null ? '' : String(debt.apr), scope: debt.scope,
      summary: debtSummary(debt) });
  }

  function saveDebt() {
    const d = S.sheet;
    readSheetInputs();
    const balance = d.balanceText.trim() === '' ? null : d.balanceText.trim() === '0' ? 0 : parseAmount(d.balanceText);
    const minimum = d.minimumText.trim() === '' ? 0 : parseAmount(d.minimumText);
    const dueDay = d.dueDayText.trim() === '' ? 0 : /^\d{1,2}$/.test(d.dueDayText.trim()) ? Number(d.dueDayText.trim()) : NaN;
    const apr = d.aprText.trim() === '' ? null : Number(d.aprText.trim().replace('%', ''));
    const error = validateDebt({ name: d.name, balance, balanceDate: d.balanceDate, minimum, dueDay, apr }, todayIso());
    if (error) { d.error = error; renderSheet(); return; }
    const isNew = d.mode === 'add';
    const data = { name: d.name.trim(), type: d.type, currency: d.currency, balance, balanceDate: d.balanceDate, minimum, dueDay, apr, scope: d.scope, by: S.user.email, deleted: false };
    background(backend.put('debts', d.id, data, isNew), 'Couldn’t save that debt.');
    closeSheet({ force: true });
    toast(isNew ? 'Debt added' : 'Debt updated');
  }

  /** @param {any} [bill] */
  function openBill(bill) {
    if (!bill) {
      return openSheet({ kind: 'bill', mode: 'add', id: backend.newId('bills'), name: '', amountText: '', currency: S.profile.homeCurrency, dueDayText: '',
        scope: 'mine', error: '', confirmDiscard: false, confirmDelete: false, dirty: false });
    }
    if (bill.by !== S.user.email) {
      toast(`Only ${V.personName(viewState(), bill.by, { you: false })} can edit this bill. You can still mark it paid.`);
      return;
    }
    openSheet({ kind: 'bill', mode: 'edit', id: bill.id, name: bill.name, amountText: minorToInput(bill.amount), currency: bill.currency,
      dueDayText: String(bill.dueDay), scope: bill.scope, error: '', confirmDiscard: false, confirmDelete: false, dirty: false });
  }

  function saveBill() {
    const d = S.sheet;
    readSheetInputs();
    const amount = parseAmount(d.amountText);
    const dueDay = /^\d{1,2}$/.test(d.dueDayText.trim()) ? Number(d.dueDayText.trim()) : NaN;
    const error = validateBill({ name: d.name, amount, dueDay });
    if (error) { d.error = error; renderSheet(); return; }
    const isNew = d.mode === 'add';
    const data = { name: d.name.trim(), amount, currency: d.currency, dueDay, scope: d.scope, by: S.user.email, deleted: false,
      ...(isNew ? { paidMonths: [], startMonth: monthOf(todayIso()) } : {}) };
    background(backend.put('bills', d.id, data, isNew), 'Couldn’t save that bill.');
    closeSheet({ force: true });
    toast(isNew ? 'Bill added' : 'Bill updated');
  }

  /** @param {string} id */
  function toggleBillPaid(id) {
    const bill = S.bills.find((/** @type {any} */ b) => b.id === id);
    if (!bill) return;
    const today = todayIso();
    const status = billStatus(bill, today);
    const month = status.kind === 'paid' ? monthOf(today) : payableMonth(bill, today);
    const paying = status.kind !== 'paid';
    background(backend.markBill(id, month, paying), 'Couldn’t update that bill.');
    if (paying) {
      toast(`${bill.name} marked paid`, { label: 'Add as expense', run: () => addBillExpense(bill) });
    } else {
      toast(`${bill.name} marked unpaid`);
    }
  }

  /** @param {any} bill */
  function addBillExpense(bill) {
    const id = backend.newId('entries');
    const data = { type: 'expense', amount: bill.amount, currency: bill.currency, category: 'Bills', note: bill.name, scope: bill.scope,
      by: S.user.email, date: todayIso(), deleted: false, clientCreatedAt: Date.now() };
    background(backend.put('entries', id, data, true), 'Couldn’t add that expense.');
    toast(`Added ${formatMoney(bill.amount, bill.currency)} to today’s spending`);
  }

  // ---------- profile ----------

  /** @param {any} p */
  function formFromProfile(p) {
    return { name: p.name, homeCurrency: p.homeCurrency, budgetText: p.monthlyBudget ? minorToInput(p.monthlyBudget) : '',
      payFrequency: p.payFrequency ?? '', payAnchor: p.payAnchor ?? '', errors: {}, saving: false };
  }

  /** @param {HTMLFormElement} form */
  function readProfileForm(form) {
    const f = S.form;
    const data = new FormData(form);
    f.name = String(data.get('name') ?? '');
    f.budgetText = String(data.get('budget') ?? '');
    f.payAnchor = String(data.get('payAnchor') ?? f.payAnchor ?? '');
    const trimmed = f.budgetText.trim();
    const budget = !trimmed || /^0*(\.0*)?$/.test(trimmed) ? 0 : parseAmount(trimmed);
    const errors = validateProfile({ name: f.name, homeCurrency: f.homeCurrency, budgetText: f.budgetText, budget, payFrequency: f.payFrequency, payAnchor: f.payFrequency ? f.payAnchor : '' });
    f.errors = errors;
    return { ok: Object.keys(errors).length === 0, budget: budget ?? 0 };
  }

  /** @param {HTMLFormElement} form @param {boolean} isSetup */
  function submitProfile(form, isSetup) {
    const f = S.form;
    const { ok, budget } = readProfileForm(form);
    if (!ok) {
      render();
      /** @type {HTMLElement|null} */ (root.querySelector('[aria-invalid="true"]'))?.focus();
      return;
    }
    const previous = S.profile;
    // Changing home currency converts the budget so it keeps its value.
    let monthlyBudget = budget;
    if (!isSetup && previous && previous.homeCurrency !== f.homeCurrency && budget && f.budgetText === minorToInput(previous.monthlyBudget)) {
      monthlyBudget = convert(budget, previous.homeCurrency, f.homeCurrency, S.rate.rate);
    }
    const data = {
      name: f.name.trim(), homeCurrency: f.homeCurrency, monthlyBudget,
      payFrequency: f.payFrequency || null, payAnchor: f.payFrequency ? f.payAnchor : null,
      displayCurrency: isSetup ? f.homeCurrency : previous.displayCurrency,
    };
    background(backend.saveProfile(S.user.email, data), 'Couldn’t save your profile.');
    S.profile = /** @type {any} */ (normalizeProfile(S.user.email, data));
    if (isSetup) {
      enterApp();
      toast(`Welcome, ${S.profile.name}!`);
    } else {
      S.form = formFromProfile(S.profile);
      S.formDirty = false;
      render();
      toast('Profile saved');
    }
  }

  /** @param {'CAD'|'INR'} currency */
  function setDisplay(currency) {
    if (S.profile.displayCurrency === currency) return;
    S.profile = { ...S.profile, displayCurrency: currency };
    background(backend.saveProfile(S.user.email, { displayCurrency: currency }), 'Couldn’t save that setting.');
    refresh();
    if (S.formDirty) render(); // keep the profile screen toggle in sync even mid-edit
  }

  // ---------- export ----------

  async function exportCsv() {
    const vs = viewState();
    const disp = S.profile.displayCurrency;
    const rows = [['Date', 'Type', 'Category', 'Note', 'For', 'Added by', 'Amount', 'Currency', `Amount in ${disp}`]];
    for (const e of S.entries) {
      if (e.deleted) continue;
      rows.push([e.date, e.type, e.category, e.note, e.scope === 'shared' ? 'Shared' : 'Personal', V.personName(vs, e.by, { you: false }),
        minorToInput(e.amount), e.currency, minorToInput(convert(e.amount, e.currency, disp, S.rate.rate))]);
    }
    const name = `tally-${todayIso()}.csv`;
    const blob = new Blob(['﻿' + toCsv(rows)], { type: 'text/csv;charset=utf-8' });
    const file = typeof File === 'function' ? new File([blob], name, { type: 'text/csv' }) : null;
    try {
      if (file && navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file], title: 'Tally backup' });
        return;
      }
    } catch (err) {
      if (/** @type {any} */ (err)?.name === 'AbortError') return;
    }
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast(`Backup saved (${rows.length - 1} entries)`);
  }

  // ---------- toast ----------

  /** @type {number|undefined} */
  let toastTimer;
  let toastPaused = false;
  /** @param {string} message @param {{label:string, run:() => void}} [action] */
  function toast(message, action) {
    clearTimeout(toastTimer);
    toastEl.innerHTML = '';
    const text = document.createElement('span');
    text.textContent = message;
    toastEl.appendChild(text);
    if (action) {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = action.label;
      button.addEventListener('click', () => { hideToast(); action.run(); });
      toastEl.appendChild(button);
    }
    toastEl.hidden = false;
    scheduleHide();
  }
  function scheduleHide() {
    clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => { if (!toastPaused) hideToast(); }, 8000);
  }
  function hideToast() { toastEl.hidden = true; toastEl.innerHTML = ''; }
  toastEl.addEventListener('pointerenter', () => { toastPaused = true; });
  toastEl.addEventListener('pointerleave', () => { toastPaused = false; scheduleHide(); });
  toastEl.addEventListener('focusin', () => { toastPaused = true; });
  toastEl.addEventListener('focusout', () => { toastPaused = false; scheduleHide(); });

  // ---------- events ----------

  /**
   * Tabs don't stack in history, like a native tab bar. From Home a tab adds one entry;
   * moving between tabs, or back to Home, replaces it. So Back from any tab returns to Home,
   * and Back from Home leaves the app.
   * @param {string} route
   */
  function go(route) {
    if (!ROUTES.includes(route)) route = 'home';
    const target = `${location.pathname}${location.search}#/${route}`;
    const fromHome = S.route === 'home';
    if (route !== 'home' && fromHome) history.pushState(null, '', target);
    else history.replaceState(null, '', target);
    if (S.route === 'profile' && route !== 'profile') { S.form = null; S.formDirty = false; }
    S.route = route;
    render();
    window.scrollTo(0, 0);
  }

  window.addEventListener('hashchange', () => {
    const next = routeFromHash();
    if (S.sheet) closeSheet({ fromPop: true, force: true });
    if (next !== S.route) {
      if (S.route === 'profile') { S.form = null; S.formDirty = false; }
      S.route = next;
      render();
      window.scrollTo(0, 0);
    }
  });

  window.addEventListener('popstate', () => {
    if (!S.sheet) return;
    if (S.sheet.dirty && !S.sheet.confirmDiscard) {
      history.pushState({ sheet: true }, '', location.hash);
      S.sheet.confirmDiscard = true;
      renderSheet();
      return;
    }
    closeSheet({ fromPop: true });
  });

  backdrop.addEventListener('click', () => requestClose());

  document.addEventListener('keydown', (ev) => {
    if (!S.sheet) return;
    if (ev.key === 'Escape') { ev.preventDefault(); requestClose(); return; }
    if (ev.key === 'Tab') trapFocus(ev);
    const target = /** @type {HTMLElement} */ (ev.target);
    const typing = target.matches('input, textarea, select');
    if (S.sheet.kind === 'entry' && S.sheet.mode !== 'view' && !typing && !S.sheet.confirmDiscard && !S.sheet.confirmDelete) {
      if (ev.key === 'Enter' && !target.matches('button')) { ev.preventDefault(); saveEntry(); return; }
      const key = keyFromKeyboard(ev.key);
      if (key && !ev.metaKey && !ev.ctrlKey && !ev.altKey) { ev.preventDefault(); pressKey(key); }
    }
  });

  /** @param {KeyboardEvent} ev */
  function trapFocus(ev) {
    const focusables = /** @type {HTMLElement[]} */ ([...sheetRoot.querySelectorAll('button:not([disabled]), input, [tabindex="0"]')]);
    if (!focusables.length) return;
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    if (ev.shiftKey && document.activeElement === first) { ev.preventDefault(); last.focus(); }
    else if (!ev.shiftKey && document.activeElement === last) { ev.preventDefault(); first.focus(); }
    else if (!sheetRoot.contains(document.activeElement)) { ev.preventDefault(); first.focus(); }
  }

  /** @param {string} key */
  function pressKey(key) {
    const d = S.sheet;
    const next = applyKey(d.amountText, key);
    if (next === d.amountText) return;
    d.amountText = next;
    d.dirty = true;
    d.error = '';
    if (d.debtId) { renderSheet(); return; }
    const out = sheetRoot.querySelector('#amount-out');
    const shown = amountDisplay(next);
    if (out) {
      out.textContent = shown;
      out.className = `num ${fitClass(shown)} ${next ? '' : 'placeholder'}`;
      out.setAttribute('aria-label', `Amount ${shown} ${d.currency}`);
    }
    const save = /** @type {HTMLButtonElement|null} */ (sheetRoot.querySelector('[data-action="entry-save"]'));
    if (save) save.disabled = !(next && Number(next) > 0);
    const err = sheetRoot.querySelector('.error');
    if (err) err.textContent = '';
  }

  document.addEventListener('click', (ev) => {
    const target = /** @type {HTMLElement|null} */ ((/** @type {HTMLElement} */ (ev.target)).closest('[data-action]'));
    if (!target || target.matches(':disabled')) return;
    const a = target.dataset.action;
    const d = S.sheet;
    switch (a) {
      case 'sign-in':
        // Clear the signed-out flag before Google takes over, so the return trip starts on the splash, not the welcome screen.
        try { storage?.removeItem(SIGNED_OUT_KEY); } catch { /* ignore */ }
        S.signingIn = true; S.authError = ''; render();
        backend.signIn()
          .then((result) => { if (result === 'cancelled' && S.signingIn && !S.user) { S.signingIn = false; render(); } })
          .catch(() => { S.signingIn = false; S.authError = 'Couldn’t open Google sign-in. Please try again.'; render(); });
        break;
      case 'sign-out':
      case 'switch-account':
        // Show the welcome screen at once, then reload to clear the data connection; the reload starts on it too.
        try { storage?.setItem(SIGNED_OUT_KEY, '1'); } catch { /* ignore */ }
        S.user = null; S.phase = 'signedOut'; S.signingIn = a === 'switch-account'; render();
        backend.signOut().finally(() => {
          if (a === 'switch-account') { try { storage?.removeItem(SIGNED_OUT_KEY); } catch { /* ignore */ } backend.signIn().catch(() => {}).finally(() => location.reload()); }
          else { location.hash = '#/home'; location.reload(); }
        });
        break;
      case 'reload': location.reload(); break;
      case 'go': go(String(target.dataset.route)); break;
      case 'go-activity': S.activity.filter = /** @type {any} */ (target.dataset.filter); S.activity.month = monthOf(todayIso()); go('activity'); break;
      case 'set-display': setDisplay(/** @type {any} */ (target.dataset.currency)); break;
      case 'dismiss-install': try { storage?.setItem(INSTALL_KEY, '1'); } catch { /* ignore */ } render(); break;
      case 'filter': S.activity.filter = /** @type {any} */ (target.dataset.filter); render(); break;
      case 'activity-month': S.activity.month = shiftMonth(S.activity.month, Number(target.dataset.delta)); render(); break;
      case 'shared-month': S.shared.month = shiftMonth(S.shared.month, Number(target.dataset.delta)); render(); break;
      case 'new-entry': openEntry(); break;
      case 'open-entry': openEntry(S.entries.find((/** @type {any} */ e) => e.id === target.dataset.id)); break;
      case 'new-bill': openBill(); break;
      case 'open-bill': openBill(S.bills.find((/** @type {any} */ b) => b.id === target.dataset.id)); break;
      case 'bill-paid': toggleBillPaid(String(target.dataset.id)); break;
      case 'new-debt': openDebt(); break;
      case 'open-debt': openDebt(S.debts.find((/** @type {any} */ x) => x.id === target.dataset.id)); break;
      case 'pay-debt': {
        const debt = S.debts.find((/** @type {any} */ x) => x.id === target.dataset.id);
        if (debt) openPay(debt);
        break;
      }
      case 'pay-preset': if (d) { d.amountText = String(target.dataset.value); d.dirty = true; d.error = ''; renderSheet(); } break;
      case 'debt-type': readSheetInputs(); d.type = target.dataset.value; d.dirty = true; renderSheet(); break;
      case 'debt-currency': readSheetInputs(); d.currency = target.dataset.value; d.dirty = true; renderSheet(); break;
      case 'debt-scope': readSheetInputs(); d.scope = target.dataset.value; d.dirty = true; renderSheet(); break;
      case 'debt-delete': readSheetInputs(); d.confirmDelete = true; renderSheet(); break;
      case 'debt-delete-confirm': {
        const id = d.id;
        background(backend.setDeleted('debts', id, true), 'Couldn’t delete that debt.');
        closeSheet({ force: true });
        toast('Debt deleted', { label: 'Undo', run: () => background(backend.setDeleted('debts', id, false), 'Couldn’t restore that debt.') });
        break;
      }
      case 'form-seg': {
        const field = String(target.dataset.field);
        const form = /** @type {HTMLFormElement|null} */ (target.closest('form'));
        if (form) readProfileForm(form);
        S.form[field] = target.dataset.value;
        S.form.errors = {};
        S.formDirty = true;
        render();
        break;
      }
      // sheet actions
      case 'sheet-close': requestClose(); break;
      case 'sheet-keep': if (d) { d.confirmDiscard = false; d.confirmDelete = false; renderSheet(); } break;
      case 'sheet-discard': closeSheet({ force: true }); break;
      case 'key': if (d) pressKey(String(target.dataset.key)); break;
      case 'entry-type':
        readSheetInputs();
        d.type = target.dataset.value;
        if (!(d.type === 'income' ? INCOME_CATEGORIES : EXPENSE_CATEGORIES).includes(d.category)) d.category = d.type === 'income' ? 'Salary' : 'Food';
        d.dirty = true; renderSheet(); break;
      case 'entry-currency': readSheetInputs(); d.currency = d.currency === 'CAD' ? 'INR' : 'CAD'; d.dirty = true; renderSheet(); break;
      case 'entry-category': readSheetInputs(); d.category = target.dataset.value; d.dirty = true; renderSheet(); break;
      case 'entry-scope': readSheetInputs(); d.scope = target.dataset.value; d.dirty = true; renderSheet(); break;
      case 'entry-save': saveEntry(); break;
      case 'entry-delete': readSheetInputs(); d.confirmDelete = true; renderSheet(); break;
      case 'entry-delete-confirm': deleteEntry(d.id); break;
      case 'bill-scope': readSheetInputs(); d.scope = target.dataset.value; d.dirty = true; renderSheet(); break;
      case 'bill-delete': readSheetInputs(); d.confirmDelete = true; renderSheet(); break;
      case 'bill-delete-confirm': {
        const id = d.id;
        background(backend.setDeleted('bills', id, true), 'Couldn’t delete that bill.');
        closeSheet({ force: true });
        toast('Bill deleted', { label: 'Undo', run: () => background(backend.setDeleted('bills', id, false), 'Couldn’t restore that bill.') });
        break;
      }
      case 'export': exportCsv(); break;
      default: break;
    }
  });

  document.addEventListener('input', (ev) => {
    const t = /** @type {HTMLElement} */ (ev.target);
    if (S.sheet && sheetRoot.contains(t)) { S.sheet.dirty = true; return; }
    if (t.closest('form[data-form="profile"]')) S.formDirty = true;
  });

  document.addEventListener('submit', (ev) => {
    const form = /** @type {HTMLFormElement} */ (ev.target);
    ev.preventDefault();
    if (form.dataset.form === 'setup') submitProfile(form, true);
    else if (form.dataset.form === 'profile') submitProfile(form, false);
    else if (form.dataset.form === 'bill') saveBill();
    else if (form.dataset.form === 'debt') { if (S.sheet?.readOnly) { closeSheet({ force: true }); } else saveDebt(); }
  });

  boot();
  return { state: S };
}

// ---------- helpers ----------

function routeFromHash() {
  const route = location.hash.replace(/^#\/?/, '').split(/[/?]/)[0];
  return ROUTES.includes(route) ? route : 'home';
}

/** @param {HTMLElement} el */
function focusKey(el) {
  const action = el.getAttribute('data-action');
  if (!action) return el.getAttribute('name') ? `[name="${CSS.escape(String(el.getAttribute('name')))}"]` : null;
  const extra = ['route', 'filter', 'currency', 'delta', 'id', 'field', 'value'].map((k) => {
    const v = el.dataset[k];
    return v === undefined ? '' : `[data-${k}="${CSS.escape(v)}"]`;
  }).join('');
  return `[data-action="${CSS.escape(action)}"]${extra}`;
}

function isStandalone() {
  return window.matchMedia?.('(display-mode: standalone)').matches || /** @type {any} */ (navigator).standalone === true;
}

function installHint() {
  const ua = navigator.userAgent;
  if (/iPhone|iPad|iPod/.test(ua)) return 'In Safari, tap the Share button, then “Add to Home Screen”.';
  if (/Android/.test(ua)) return 'In Chrome, tap ⋮ then “Install app” or “Add to Home screen”.';
  return 'Open this link on your phone to install it like an app.';
}

function reducedMotion() {
  return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
}

function safeStorage() {
  try { return window.localStorage; } catch { return null; }
}
