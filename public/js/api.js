/* API client. Reads work offline from the IndexedDB cache; writes that fail
   because of connectivity are queued in the outbox with a client op-id and
   replayed automatically (the server de-duplicates by X-Op-Id). */
const API = (() => {
  let syncing = false;

  const token = () => localStorage.getItem('token');
  const authed = () => Boolean(token());
  const me = () => { try { return JSON.parse(localStorage.getItem('me')); } catch { return null; } };

  function setSession(data) {
    localStorage.setItem('token', data.token);
    localStorage.setItem('me', JSON.stringify(data.user));
    if (data.school) localStorage.setItem('school', JSON.stringify(data.school));
  }
  function clearSession() {
    localStorage.removeItem('token'); localStorage.removeItem('me'); localStorage.removeItem('school');
  }
  const school = () => { try { return JSON.parse(localStorage.getItem('school')); } catch { return null; } };

  async function raw(method, path, body, opId) {
    const headers = { 'Content-Type': 'application/json' };
    if (token()) headers.Authorization = 'Bearer ' + token();
    if (opId) headers['X-Op-Id'] = opId;
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 15000);
    try {
      const resp = await fetch('/api' + path, {
        method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal: ctl.signal,
      });
      const data = await resp.json().catch(() => ({}));
      if (resp.status === 401 && authed()) { clearSession(); location.hash = '#/login'; }
      if (data && data.offline) throw Object.assign(new Error('offline'), { offline: true });
      if (!resp.ok) throw Object.assign(new Error(data.error || 'Request failed'), { status: resp.status, data });
      return data;
    } finally { clearTimeout(t); }
  }

  const isNetErr = (e) => e.offline || e.name === 'AbortError' || e.message === 'Failed to fetch' || e.message === 'offline';

  // GET: network first; cache the result; fall back to cache when offline.
  async function get(path) {
    try {
      const data = await raw('GET', path);
      DB.cachePut(path, data).catch(() => {});
      setOnline(true);
      return data;
    } catch (e) {
      if (isNetErr(e)) {
        setOnline(false);
        const hit = await DB.cacheGet(path);
        if (hit) return { ...hit.data, _cached: true, _cachedAt: hit.at };
        throw Object.assign(new Error('You are offline and this screen has not been downloaded yet.'), { offline: true });
      }
      throw e;
    }
  }

  // Mutations: send now, or queue for later when offline.
  async function mutate(method, path, body, { queueable = true, label } = {}) {
    const opId = crypto.randomUUID();
    try {
      const data = await raw(method, path, body, opId);
      setOnline(true);
      return data;
    } catch (e) {
      if (isNetErr(e) && queueable) {
        setOnline(false);
        await DB.outboxAdd({ opId, method, path, body, label: label || `${method} ${path}`, at: Date.now() });
        updatePendingBadge();
        return { queued: true, opId };
      }
      throw e;
    }
  }

  // Replay the outbox in order. Server-side X-Op-Id makes retries safe.
  async function sync() {
    if (syncing || !authed()) return { done: 0 };
    syncing = true;
    let done = 0, failed = 0;
    try {
      const ops = (await DB.outboxAll()).sort((a, b) => a.at - b.at);
      for (const op of ops) {
        try {
          await raw(op.method, op.path, op.body, op.opId);
          await DB.outboxRemove(op.opId);
          done++;
        } catch (e) {
          if (isNetErr(e)) { setOnline(false); break; }   // still offline — stop, keep order
          // Server rejected it (validation etc.) — drop it and tell the user.
          await DB.outboxRemove(op.opId);
          failed++;
          UI.toast(`Could not save "${op.label}": ${e.message}`);
        }
      }
      if (done) { setOnline(true); UI.toast(`Synced ${done} saved change${done > 1 ? 's' : ''} ✓`); }
    } finally {
      syncing = false;
      updatePendingBadge();
    }
    return { done, failed };
  }

  async function updatePendingBadge() {
    const n = (await DB.outboxAll()).length;
    const el = document.getElementById('pending-badge');
    if (el) { el.textContent = n; el.style.display = n ? '' : 'none'; }
    return n;
  }

  function setOnline(on) {
    document.body.classList.toggle('offline', !on);
    if (on) sync();
  }

  // connectivity watchers
  window.addEventListener('online', () => setOnline(true));
  window.addEventListener('offline', () => setOnline(false));
  setInterval(() => {
    if (navigator.onLine) fetch('/api/health', { cache: 'no-store' }).then(r => setOnline(r.ok)).catch(() => setOnline(false));
  }, 45000);

  return {
    get, mutate, sync, raw,
    post: (p, b, o) => mutate('POST', p, b, o),
    put: (p, b, o) => mutate('PUT', p, b, o),
    del: (p, o) => mutate('DELETE', p, undefined, o),
    authed, me, school, setSession, clearSession, updatePendingBadge,
  };
})();
