const RAKUTEN_ENDPOINT = 'https://openapi.rakuten.co.jp/services/api/BooksBook/Search/20170404';
const OPENBD_ENDPOINT = 'https://api.openbd.jp/v1/get';

export const KEYS = {
  rakutenAppId: 'rl.rakutenAppId',
  rakutenAccessKey: 'rl.rakutenAccessKey',
  calilAppKey: 'rl.calilAppKey',
  theme: 'rl.theme',
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
  return url ? url.replace(/_ex=\d+x\d+/, '_ex=400x400') : '';
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

export async function lookupIsbn(isbn) {
  const res = await fetch(`${OPENBD_ENDPOINT}?isbn=${encodeURIComponent(isbn)}`);
  if (!res.ok) return null;
  const [record] = await res.json();
  return record?.summary || null;
}
