// Firebase backend: Google sign-in + a Firestore-backed army store with the
// SAME interface as the local store (web/storage.js). This module is imported
// lazily by web/main.js, so if the SDK CDN is unreachable the app still runs
// local-only.
//
// The web config below is a PUBLIC identifier, not a secret — security is
// enforced by the Firestore rules (each user may only read/write their own
// users/{uid}/armies). Wahapedia data is never stored here; only army records
// (the original New Recruit / GW export plus display metadata).

import { initializeApp } from 'https://www.gstatic.com/firebasejs/11.1.0/firebase-app.js';
import {
  getAuth, GoogleAuthProvider, signInWithPopup, signOut as fbSignOut, onAuthStateChanged,
} from 'https://www.gstatic.com/firebasejs/11.1.0/firebase-auth.js';
import {
  getFirestore, collection, doc, getDoc, getDocs, setDoc, deleteDoc, query, orderBy,
} from 'https://www.gstatic.com/firebasejs/11.1.0/firebase-firestore.js';

const firebaseConfig = {
  apiKey: 'AIzaSyCvRMYgF0kGGz8bdUqS-DaQ2SW7FHkogM8',
  authDomain: 'muster-roll-wh.firebaseapp.com',
  projectId: 'muster-roll-wh',
  storageBucket: 'muster-roll-wh.firebasestorage.app',
  messagingSenderId: '45241899972',
  appId: '1:45241899972:web:a13ca3823f1a847220a291',
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const provider = new GoogleAuthProvider();

export function signIn() { return signInWithPopup(auth, provider); }
export function signOutUser() { return fbSignOut(auth); }
export function onAuthChange(cb) { return onAuthStateChanged(auth, cb); }

function uuid() {
  if (crypto && crypto.randomUUID) return crypto.randomUUID();
  return 'a' + Math.random().toString(36).slice(2) + Date.now().toString(36);
}

// A Firestore-backed army store (same shape as armyStore in web/storage.js),
// scoped to users/{uid}/armies. `source` (whose NR `data` can contain nested
// arrays Firestore won't store directly) is JSON-stringified on write and parsed
// back on read; the display metadata is stored as plain fields.
export function makeFirestoreStore(uid) {
  const col = () => collection(db, 'users', uid, 'armies');
  const ref = (id) => doc(db, 'users', uid, 'armies', id);
  const fromDoc = (d) => {
    const { sourceJson, ...rest } = d.data();
    return { ...rest, id: d.id, source: sourceJson ? JSON.parse(sourceJson) : rest.source };
  };
  return {
    async list() {
      const snap = await getDocs(query(col(), orderBy('updatedAt', 'desc')));
      return snap.docs.map(fromDoc);
    },
    async get(id) {
      const d = await getDoc(ref(id));
      return d.exists() ? fromDoc(d) : null;
    },
    async put(record, now = new Date().toISOString()) {
      const rec = { ...record };
      if (!rec.id) rec.id = uuid();
      if (!rec.createdAt) rec.createdAt = now;
      rec.updatedAt = now;
      const { source, ...meta } = rec;
      await setDoc(ref(rec.id), { ...meta, sourceJson: JSON.stringify(source) });
      return rec;
    },
    async remove(id) { await deleteDoc(ref(id)); },
    async rename(id, name) {
      const rec = await this.get(id);
      if (!rec) return null;
      rec.name = name;
      return this.put(rec);
    },
  };
}

export { firebaseConfig };
