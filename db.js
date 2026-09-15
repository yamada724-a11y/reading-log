const DB_NAME = 'readinglog';
const DB_VERSION = 1;
const STORE = 'books';

let dbPromise = null;

function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: 'id' });
        store.createIndex('status', 'status');
        store.createIndex('addedAt', 'addedAt');
        store.createIndex('finishedAt', 'finishedAt');
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

async function run(mode, fn) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE, mode);
    const req = fn(transaction.objectStore(STORE));
    transaction.oncomplete = () => resolve(req ? req.result : undefined);
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
}

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

export async function listBooks(status) {
  const all = await run('readonly', (store) => store.getAll());
  const books = status ? all.filter((b) => b.status === status) : all;
  return books.sort((a, b) => (b.addedAt || '').localeCompare(a.addedAt || ''));
}

export function getBook(id) {
  return run('readonly', (store) => store.get(id));
}

export async function saveBook(book) {
  const record = { ...book, updatedAt: new Date().toISOString() };
  await run('readwrite', (store) => store.put(record));
  return record;
}

export function deleteBook(id) {
  return run('readwrite', (store) => store.delete(id));
}

export async function importBooks(records) {
  const existing = new Map((await listBooks()).map((book) => [book.id, book]));
  const counts = { added: 0, updated: 0, skipped: 0 };

  const clean = records
    .filter((record) => record && typeof record.id === 'string' && typeof record.title === 'string')
    .map((record) => ({
      ...createBook(),
      ...record,
      authors: Array.isArray(record.authors) ? record.authors : [],
    }));

  const db = await openDB();
  await new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE, 'readwrite');
    const store = transaction.objectStore(STORE);
    for (const record of clean) {
      const current = existing.get(record.id);
      if (!current) {
        store.put(record);
        counts.added += 1;
      } else if ((record.updatedAt || '') > (current.updatedAt || '')) {
        store.put(record);
        counts.updated += 1;
      } else {
        counts.skipped += 1;
      }
    }
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });

  return counts;
}
