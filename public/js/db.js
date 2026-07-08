/* IndexedDB wrapper: two stores —
   'cache'  last good GET responses (key = url) so every screen opens offline,
   'outbox' queued mutations replayed in order when connectivity returns. */
const DB = (() => {
  let dbp = null;
  function open() {
    if (dbp) return dbp;
    dbp = new Promise((resolve, reject) => {
      const req = indexedDB.open('mwss', 1);
      req.onupgradeneeded = () => {
        const d = req.result;
        if (!d.objectStoreNames.contains('cache')) d.createObjectStore('cache', { keyPath: 'url' });
        if (!d.objectStoreNames.contains('outbox')) d.createObjectStore('outbox', { keyPath: 'opId' });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return dbp;
  }
  async function store(name, mode, fn) {
    const d = await open();
    return new Promise((resolve, reject) => {
      const tx = d.transaction(name, mode);
      const r = fn(tx.objectStore(name));
      tx.oncomplete = () => resolve(r && r.result !== undefined ? r.result : undefined);
      tx.onerror = () => reject(tx.error);
    });
  }
  return {
    cachePut: (url, data) => store('cache', 'readwrite', s => s.put({ url, data, at: Date.now() })),
    cacheGet: async (url) => {
      const d = await open();
      return new Promise((resolve) => {
        const req = d.transaction('cache').objectStore('cache').get(url);
        req.onsuccess = () => resolve(req.result ? req.result : null);
        req.onerror = () => resolve(null);
      });
    },
    outboxAdd: (op) => store('outbox', 'readwrite', s => s.put(op)),
    outboxAll: async () => {
      const d = await open();
      return new Promise((resolve) => {
        const req = d.transaction('outbox').objectStore('outbox').getAll();
        req.onsuccess = () => resolve(req.result || []);
        req.onerror = () => resolve([]);
      });
    },
    outboxRemove: (opId) => store('outbox', 'readwrite', s => s.delete(opId)),
    clearAll: async () => { await store('cache', 'readwrite', s => s.clear()); await store('outbox', 'readwrite', s => s.clear()); },
  };
})();
