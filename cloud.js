import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js';
import {
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
  collection,
  doc,
  setDoc,
  deleteDoc,
  onSnapshot,
  writeBatch,
} from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signInWithRedirect,
  getRedirectResult,
  signOut as firebaseSignOut,
  onAuthStateChanged,
} from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js';

/* 記録はクラウド（Firestore）に置く。端末のブラウザのデータを消しても、ログインし直せば戻る。
   保存先は users/{ログインした人のID}/books で、ルールにより本人しか読み書きできない。
   Firestore自身が端末内に控えを持つので、電波がなくても読み書きでき、つながったときに同期される。 */

// apiKey はアクセス制御の鍵ではなく、公式にコードへ直書きしてよい値。制御は Firestore のルールで行う。
const firebaseConfig = {
  apiKey: 'AIzaSyCoQzsnmb2NyzkMCvN3b73pWhakI5h3i20',
  authDomain: 'reading-log-165a1.firebaseapp.com',
  projectId: 'reading-log-165a1',
  storageBucket: 'reading-log-165a1.firebasestorage.app',
  messagingSenderId: '507851808365',
  appId: '1:507851808365:web:1a2515f0fa02834bfa2964',
};

const app = initializeApp(firebaseConfig);
const db = initializeFirestore(app, {
  localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
});
const auth = getAuth(app);
const googleProvider = new GoogleAuthProvider();

/* ---------- ログイン ---------- */

// QRコード読み取りアプリなどの「アプリ内ブラウザ」では、ポップアップのログインが失敗する
function inAppBrowser() {
  return /; wv\)|Line\/|FBAN|FBAV|Instagram/i.test(navigator.userAgent);
}

export async function signIn() {
  if (inAppBrowser()) return signInWithRedirect(auth, googleProvider);
  try {
    return await signInWithPopup(auth, googleProvider);
  } catch (error) {
    if (error.code === 'auth/popup-blocked' || error.code === 'auth/operation-not-supported-in-this-environment') {
      return signInWithRedirect(auth, googleProvider);
    }
    throw error;
  }
}

export function signOutUser() {
  return firebaseSignOut(auth);
}

export function onAuthChange(callback) {
  return onAuthStateChanged(auth, callback);
}

export function currentUser() {
  return auth.currentUser;
}

// リダイレクト方式でログインしたときの戻り（エラーは onAuthChange 側で拾えるので握りつぶす）
getRedirectResult(auth).catch(() => {});

/* ---------- 本の記録 ---------- */

export function createBook(fields = {}) {
  const now = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    status: 'want',
    title: '',
    authors: [],
    publisher: '',
    pubdate: '',
    isbn13: '',
    isbn10: '',
    coverUrl: '',
    note: '',
    rating: 0,
    hidden: false,
    startedAt: '',
    finishedAt: '',
    addedAt: now,
    updatedAt: now,
    ...fields,
  };
}

let booksRef = null;
let cache = [];
let unsubscribe = null;
let firstSync = null;
let markSynced = null;
const listeners = new Set();

function notify() {
  for (const listener of listeners) listener();
}

export function onChange(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function sorted(books) {
  return [...books].sort((a, b) => (b.addedAt || '').localeCompare(a.addedAt || ''));
}

/* ログインしている人の本を購読する。ログアウト時は購読をやめて手元の控えも消す。 */
export function startSync(uid) {
  unsubscribe?.();
  cache = [];
  firstSync = new Promise((resolve) => { markSynced = resolve; });
  booksRef = collection(db, 'users', uid, 'books');
  unsubscribe = onSnapshot(
    booksRef,
    (snapshot) => {
      cache = sorted(snapshot.docs.map((d) => d.data()));
      markSynced?.();
      markSynced = null;
      notify();
    },
    (error) => {
      console.error('books onSnapshot error', error);
    }
  );
}

// 端末内に残った記録を移す前に、クラウドの中身がそろうのを待つ
export function waitForFirstSync() {
  return firstSync || Promise.resolve();
}

export function stopSync() {
  unsubscribe?.();
  unsubscribe = null;
  booksRef = null;
  cache = [];
  notify();
}

export async function listBooks(status) {
  return status ? cache.filter((book) => book.status === status) : cache;
}

export async function getBook(id) {
  return cache.find((book) => book.id === id) || null;
}

export async function saveBook(book) {
  const record = { ...createBook(), ...book, updatedAt: new Date().toISOString() };
  await setDoc(doc(booksRef, record.id), record);
  return record;
}

export async function deleteBook(id) {
  await deleteDoc(doc(booksRef, id));
}

/* バックアップの読み戻しと、端末内に残っていた記録の引っ越しに使う。
   同じ本は更新日時が新しいほうを残す。 */
export async function importBooks(records) {
  const existing = new Map(cache.map((book) => [book.id, book]));
  const counts = { added: 0, updated: 0, skipped: 0 };

  const clean = records
    .filter((record) => record && typeof record.id === 'string' && typeof record.title === 'string')
    .map((record) => ({
      ...createBook(),
      ...record,
      authors: Array.isArray(record.authors) ? record.authors : [],
    }));

  // Firestore の一括書き込みは1回500件まで
  for (let start = 0; start < clean.length; start += 400) {
    const batch = writeBatch(db);
    let writes = 0;
    for (const record of clean.slice(start, start + 400)) {
      const current = existing.get(record.id);
      if (!current) counts.added += 1;
      else if ((record.updatedAt || '') > (current.updatedAt || '')) counts.updated += 1;
      else {
        counts.skipped += 1;
        continue;
      }
      batch.set(doc(booksRef, record.id), record);
      writes += 1;
    }
    if (writes) await batch.commit();
  }

  return counts;
}
