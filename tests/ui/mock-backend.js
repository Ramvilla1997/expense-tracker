// In-memory backend with the same interface as public/js/backend/firebase.js.
// Tests configure it through window.__TALLY_MOCK__ and drive it through window.__mock.
export function createMockBackend(cfg) {
  const signedOut = sessionStorage.getItem('mock.signedOut') === '1';
  const st = {
    user: signedOut ? null : (cfg.user ?? null),
    members: cfg.members ?? [],
    access: cfg.access ?? 'auto', // auto | offline | denied
    profileStatus: cfg.profileStatus ?? 'auto', // auto | unknown
    data: { entries: {}, bills: {}, debts: {}, profiles: {} },
    pending: { entries: new Set(), bills: new Set(), debts: new Set(), profiles: new Set() },
    ackDelay: cfg.ackDelay ?? 30,
    failWrites: cfg.failWrites ?? false,
    calls: [],
    seq: 0,
  };
  for (const name of ['entries', 'bills', 'debts', 'profiles']) {
    for (const [id, doc] of Object.entries(cfg[name] ?? {})) st.data[name][id] = structuredClone(doc);
  }
  const listeners = { entries: [], bills: [], debts: [], profiles: [] };
  let authCb = null;

  const emit = (name) => {
    const docs = Object.entries(st.data[name]).map(([id, data]) => ({ id, data: structuredClone(data), pending: st.pending[name].has(id) }));
    listeners[name].forEach((cb) => cb(docs));
  };
  const write = (name, id, apply) => {
    st.calls.push({ name, id });
    apply(st.data[name]);
    st.pending[name].add(id);
    emit(name);
    return new Promise((resolve, reject) => setTimeout(() => {
      if (st.failWrites) {
        delete st.data[name][id];
        st.pending[name].delete(id);
        emit(name);
        reject(Object.assign(new Error('denied'), { code: 'permission-denied' }));
        return;
      }
      st.pending[name].delete(id);
      emit(name);
      resolve();
    }, st.ackDelay));
  };

  return {
    control: {
      st,
      emit,
      remoteSet(name, id, data) { st.data[name][id] = { ...(st.data[name][id] ?? {}), ...data }; emit(name); },
      remoteDelete(name, id) { delete st.data[name][id]; emit(name); },
      setFailWrites(v) { st.failWrites = v; },
    },
    onAuth(cb, onError) {
      authCb = cb;
      if (cfg.authError) setTimeout(() => onError(cfg.authError), 0);
      if (cfg.authNeverResolves) return () => {};
      setTimeout(() => cb(st.user), cfg.authDelay ?? 0);
      return () => {};
    },
    async signIn() {
      st.calls.push({ name: 'signIn' });
      sessionStorage.removeItem('mock.signedOut');
      if (cfg.signInAs) setTimeout(() => { st.user = cfg.signInAs; authCb?.(st.user); }, 50);
    },
    async signOut() {
      st.calls.push({ name: 'signOut' });
      sessionStorage.setItem('mock.signedOut', '1');
      st.user = null;
    },
    async checkAccess(email) {
      if (st.access === 'offline') return { status: 'offline' };
      if (st.access === 'denied') return { status: 'denied' };
      const members = st.members.map((m) => m.toLowerCase());
      return members.includes(email) ? { status: 'member', members, fromCache: false } : { status: 'denied' };
    },
    async loadProfile(email) {
      if (st.profileStatus === 'unknown') return { status: 'unknown' };
      const p = st.data.profiles[email];
      return p ? { status: 'found', data: structuredClone(p) } : { status: 'missing' };
    },
    watch(name, cb) {
      listeners[name].push(cb);
      setTimeout(() => emit(name), 0);
      return () => {};
    },
    newId(name) { st.seq += 1; return `${name}-new-${st.seq}`; },
    put(name, id, data, isNew) {
      return write(name, id, (coll) => { coll[id] = isNew ? { ...data } : { ...(coll[id] ?? {}), ...data }; });
    },
    setDeleted(name, id, deleted) {
      return write(name, id, (coll) => { coll[id] = { ...coll[id], deleted }; });
    },
    markBill(id, month, paid) {
      return write('bills', id, (coll) => {
        const months = new Set(coll[id].paidMonths ?? []);
        paid ? months.add(month) : months.delete(month);
        coll[id] = { ...coll[id], paidMonths: [...months] };
      });
    },
    saveSubscription(email, subscription) {
      st.calls.push({ name: 'push', id: email, subscription });
      return Promise.resolve();
    },
    deleteSubscription(email) {
      st.calls.push({ name: 'push-delete', id: email });
      return Promise.resolve();
    },
    idToken() {
      return Promise.resolve(null);
    },
    saveProfile(email, data) {
      return write('profiles', email, (coll) => { coll[email] = { ...(coll[email] ?? {}), ...data }; });
    },
  };
}
