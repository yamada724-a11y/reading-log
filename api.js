const RAKUTEN_ENDPOINT = 'https://openapi.rakuten.co.jp/services/api/BooksBook/Search/20170404';
const OPENBD_ENDPOINT = 'https://api.openbd.jp/v1/get';
const CALIL_LIBRARY = 'https://api.calil.jp/library';
const CALIL_CHECK = 'https://api.calil.jp/check';

export const KEYS = {
  rakutenAppId: 'rl.rakutenAppId',
  rakutenAccessKey: 'rl.rakutenAccessKey',
  calilAppKey: 'rl.calilAppKey',
  libraries: 'rl.libraries',
  theme: 'rl.theme',
  lastBackupAt: 'rl.lastBackupAt',
};

export function getSetting(key) {
  return localStorage.getItem(key) || '';
}

export function setSetting(key, value) {
  if (value) localStorage.setItem(key, value);
  else localStorage.removeItem(key);
}

export class MissingKeyError extends Error {}

function enlarge(url) {
  return url ? url.replace(/_ex=\d+x\d+/, '_ex=600x600') : '';
}

function splitAuthors(author) {
  return (author || '')
    .split(/[\/、,]/)
    .map((name) => name.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
}

function yearOf(salesDate) {
  return (salesDate || '').match(/\d{4}/)?.[0] || '';
}

export async function searchBooks(title, { signal } = {}) {
  const appId = getSetting(KEYS.rakutenAppId);
  const accessKey = getSetting(KEYS.rakutenAccessKey);
  if (!appId || !accessKey) throw new MissingKeyError();

  const url = new URL(RAKUTEN_ENDPOINT);
  url.searchParams.set('format', 'json');
  url.searchParams.set('applicationId', appId);
  url.searchParams.set('accessKey', accessKey);
  url.searchParams.set('title', title);
  url.searchParams.set('hits', '20');
  url.searchParams.set('booksGenreId', '001');

  const res = await fetch(url, { signal });
  if (!res.ok) {
    const detail = await res.json().catch(() => null);
    const reason = detail?.errors?.errorMessage || detail?.error_description || '';
    throw new Error(`楽天APIがエラーを返しました（${res.status}）${reason ? `：${reason}` : ''}`);
  }
  const data = await res.json();

  return (data.Items || []).map(({ Item }) => ({
    title: [Item.title, Item.subTitle].filter(Boolean).join(' '),
    authors: splitAuthors(Item.author),
    publisher: Item.publisherName || '',
    pubdate: yearOf(Item.salesDate),
    isbn13: Item.isbn || '',
    coverUrl: enlarge(Item.largeImageUrl || Item.mediumImageUrl || ''),
  }));
}

export function getLibraries() {
  try {
    const stored = JSON.parse(getSetting(KEYS.libraries) || '[]');
    return Array.isArray(stored) ? stored : [];
  } catch {
    return [];
  }
}

export function setLibraries(list) {
  setSetting(KEYS.libraries, list.length ? JSON.stringify(list) : '');
}

export async function fetchLibraries(pref) {
  const appkey = getSetting(KEYS.calilAppKey);
  if (!appkey) throw new MissingKeyError();

  const url = new URL(CALIL_LIBRARY);
  url.searchParams.set('appkey', appkey);
  url.searchParams.set('pref', pref);
  url.searchParams.set('format', 'json');
  url.searchParams.set('callback', '');

  const res = await fetch(url);
  if (!res.ok) throw new Error(`図書館の一覧を取得できませんでした（${res.status}）`);
  const list = await res.json();
  return Array.isArray(list) ? list : [];
}

function delay(ms, signal) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => {
      clearTimeout(timer);
      reject(new DOMException('aborted', 'AbortError'));
    }, { once: true });
  });
}

function checkUrl(params) {
  const url = new URL(CALIL_CHECK);
  url.searchParams.set('appkey', getSetting(KEYS.calilAppKey));
  url.searchParams.set('format', 'json');
  url.searchParams.set('callback', 'no');
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  return url;
}

/* カーリルは検索を非同期で行う。continue が 1 の間は同じセッションで問い合わせ直す。
   仕様上の下限は2秒だが、余裕をもって2.5秒あける。 */
export async function checkAvailability(isbn, systemIds, { onProgress, signal } = {}) {
  if (!getSetting(KEYS.calilAppKey)) throw new MissingKeyError();

  const first = await fetch(checkUrl({ isbn, systemid: systemIds.join(',') }), { signal });
  if (!first.ok) throw new Error(`図書館に問い合わせできませんでした（${first.status}）`);
  let data = await first.json();

  for (let attempt = 0; data.continue === 1 && attempt < 8; attempt += 1) {
    onProgress?.(data.books?.[isbn] || {});
    await delay(2500, signal);
    const next = await fetch(checkUrl({ session: data.session }), { signal });
    if (!next.ok) break;
    data = await next.json();
  }

  return data.books?.[isbn] || {};
}

export async function lookupIsbn(isbn) {
  const res = await fetch(`${OPENBD_ENDPOINT}?isbn=${encodeURIComponent(isbn)}`);
  if (!res.ok) return null;
  const [record] = await res.json();
  return record?.summary || null;
}
