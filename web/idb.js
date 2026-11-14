// Minimal promise wrapper around IndexedDB — just enough for our two small
// stores, no external dependency. Each helper issues a single request so we
// never trip the "transaction went inactive across an await" pitfall.

export function openDB(name, version, upgrade) {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(name, version);
    req.onupgradeneeded = () => upgrade(req.result, req.transaction);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error('IndexedDB upgrade blocked by another tab'));
  });
}

// Promise for a single IDBRequest.
function wrap(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export function idbGet(db, store, key) {
  return wrap(db.transaction(store, 'readonly').objectStore(store).get(key));
}
export function idbGetAll(db, store) {
  return wrap(db.transaction(store, 'readonly').objectStore(store).getAll());
}
export function idbPut(db, store, value, key) {
  const os = db.transaction(store, 'readwrite').objectStore(store);
  return wrap(key === undefined ? os.put(value) : os.put(value, key));
}
export function idbDelete(db, store, key) {
  return wrap(db.transaction(store, 'readwrite').objectStore(store).delete(key));
}
export function idbClear(db, store) {
  return wrap(db.transaction(store, 'readwrite').objectStore(store).clear());
}
