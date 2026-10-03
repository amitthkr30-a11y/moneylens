// Browser persistence in IndexedDB. Optional passcode → AES-GCM-256 (PBKDF2-SHA256, 310k iterations).
import { emptyState } from './ingest.js';
const DB = 'moneylens', STORE = 'kv', K_PLAIN = 'state', K_ENC = 'state.enc';
let cryptoKey = null, salt = null, encBlob = null;
function db() { return new Promise((res, rej) => { const r = indexedDB.open(DB, 1); r.onupgradeneeded = () => r.result.createObjectStore(STORE); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); }); }
async function op(mode, fn) { const d = await db(); return new Promise((res, rej) => { const tx = d.transaction(STORE, mode); const r = fn(tx.objectStore(STORE)); tx.oncomplete = () => res(r?.result); tx.onerror = () => rej(tx.error); }); }
const get = k => op('readonly', s => s.get(k)); const put = (k, v) => op('readwrite', s => s.put(v, k)); const del = k => op('readwrite', s => s.delete(k));
const b64 = buf => { const a = new Uint8Array(buf); let s = ''; for (let i = 0; i < a.length; i += 0x8000) s += String.fromCharCode.apply(null, a.subarray(i, i + 0x8000)); return btoa(s); };
const unb64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
async function deriveKey(pass, s) {
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(pass), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', salt: s, iterations: 310000, hash: 'SHA-256' }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}
export const withDefaults = s => ({ ...emptyState(), ...s });
export async function load() { encBlob = await get(K_ENC); if (encBlob) return { locked: true }; const s = await get(K_PLAIN); return { state: s ? withDefaults(s) : emptyState() }; }
export const hasPasscode = () => !!encBlob || !!cryptoKey;
export async function unlock(pass) {
  salt = unb64(encBlob.salt); const k = await deriveKey(pass, salt);
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(encBlob.iv) }, k, unb64(encBlob.data));
  cryptoKey = k; return withDefaults(JSON.parse(new TextDecoder().decode(pt)));
}
export async function setPasscode(pass, state) {
  if (!pass || pass.length < 6) throw new Error('Passcode must be at least 6 characters.');
  salt = crypto.getRandomValues(new Uint8Array(16)); cryptoKey = await deriveKey(pass, salt);
  await save(state); await del(K_PLAIN);
}
export async function removePasscode(state) { cryptoKey = null; encBlob = null; await del(K_ENC); await save(state); }
export function lockNow() { cryptoKey = null; location.reload(); }
export async function save(state) {
  if (cryptoKey) {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, cryptoKey, new TextEncoder().encode(JSON.stringify(state)));
    encBlob = { salt: b64(salt), iv: b64(iv), data: b64(ct) }; await put(K_ENC, encBlob);
  } else await put(K_PLAIN, state);
}
export async function wipeAll() { cryptoKey = null; encBlob = null; await del(K_PLAIN); await del(K_ENC); try { sessionStorage.clear(); } catch {} }
