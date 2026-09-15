import { KEYS, getSetting, setSetting } from './api.js';

/* 非公開の本棚の暗証番号。番号そのものは保存せず、PBKDF2 で作ったハッシュだけを持つ。
   本の記録を暗号化するものではなく、本棚を人に見られたときに目に入らないようにするためのもの。 */

const MAX_TRIES = 5;
const WAIT_MS = 30 * 1000;

function toBase64(bytes) {
  return btoa(String.fromCharCode(...bytes));
}

async function hashPin(pin, salt) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(pin), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: new TextEncoder().encode(salt), iterations: 100000, hash: 'SHA-256' },
    key,
    256
  );
  return toBase64(new Uint8Array(bits));
}

function storedPin() {
  try {
    const stored = JSON.parse(getSetting(KEYS.secretPin) || 'null');
    return stored?.salt && stored?.hash ? stored : null;
  } catch {
    return null;
  }
}

export function hasPin() {
  return Boolean(storedPin());
}

export async function setPin(pin) {
  const salt = toBase64(crypto.getRandomValues(new Uint8Array(16)));
  setSetting(KEYS.secretPin, JSON.stringify({ salt, hash: await hashPin(pin, salt) }));
  setSetting(KEYS.secretFails, '');
  setSetting(KEYS.secretLockUntil, '');
}

export function clearPin() {
  for (const key of [KEYS.secretPin, KEYS.secretFails, KEYS.secretLockUntil]) setSetting(key, '');
}

/* 5回続けて間違えたら30秒待たせる。{ ok, wait（待つ秒数）, left（残りの回数） } を返す */
export async function verifyPin(pin) {
  const until = Number(getSetting(KEYS.secretLockUntil)) || 0;
  if (Date.now() < until) return { ok: false, wait: Math.ceil((until - Date.now()) / 1000) };

  const stored = storedPin();
  if (stored && (await hashPin(pin, stored.salt)) === stored.hash) {
    setSetting(KEYS.secretFails, '');
    return { ok: true };
  }

  const fails = (Number(getSetting(KEYS.secretFails)) || 0) + 1;
  if (fails >= MAX_TRIES) {
    setSetting(KEYS.secretFails, '');
    setSetting(KEYS.secretLockUntil, String(Date.now() + WAIT_MS));
    return { ok: false, wait: WAIT_MS / 1000 };
  }
  setSetting(KEYS.secretFails, String(fails));
  return { ok: false, left: MAX_TRIES - fails };
}
