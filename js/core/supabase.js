// Minimal, dependency-free Supabase client (Auth + PostgREST + Storage) using fetch.
//   table  public.user_data (user_id uuid PK, data jsonb, updated_at timestamptz)  one row per user
//   bucket statements (private)  path: <user_id>/<sha256>.<ext>                   original files
// Row Level Security restricts every row/file to its owner (auth.uid()).
export class CloudError extends Error { constructor(msg, status) { super(msg); this.status = status; } }

export class SupabaseClient {
  constructor({ url, key, storage = globalThis.localStorage, fetchImpl = globalThis.fetch?.bind(globalThis) }) {
    if (!/^https:\/\/[a-z0-9-]+\.supabase\.(co|in)\/?$/i.test(url || '')) throw new CloudError('Supabase URL looks wrong. It should look like https://xxxx.supabase.co');
    if (!key || key.length < 20) throw new CloudError('Supabase anon/publishable key is missing.');
    if (/service_role|sb_secret_/i.test(key) || decodeRole(key) === 'service_role') throw new CloudError('That is the SECRET service_role key. Use the anon / publishable key instead.');
    this.url = url.replace(/\/$/, ''); this.key = key; this.storage = storage; this.fetch = fetchImpl;
    this.session = this.#loadSession();
  }
  #loadSession() { try { return JSON.parse(this.storage?.getItem('ml.sb.session') || 'null'); } catch { return null; } }
  #saveSession(s) { this.session = s; if (s) this.storage?.setItem('ml.sb.session', JSON.stringify(s)); else this.storage?.removeItem('ml.sb.session'); }
  get user() { return this.session?.user || null; }
  get signedIn() { return !!this.session?.access_token; }
  async #req(path, { method = 'GET', body, headers = {}, auth = true, raw = false } = {}) {
    if (auth) await this.ensureSession();
    const h = { apikey: this.key, ...headers };
    if (auth && this.session) h.Authorization = 'Bearer ' + this.session.access_token;
    if (body !== undefined && !(body instanceof Blob) && !(body instanceof ArrayBuffer) && !(body instanceof Uint8Array)) { h['Content-Type'] = h['Content-Type'] || 'application/json'; body = JSON.stringify(body); }
    let r;
    try { r = await this.fetch(this.url + path, { method, headers: h, body }); }
    catch { throw new CloudError('Cannot reach Supabase. Check your internet connection and SUPABASE_URL.'); }
    if (!r.ok) {
      let msg = ''; try { const j = await r.json(); msg = j.msg || j.message || j.error_description || j.error || ''; } catch {}
      if ((r.status === 401 || r.status === 403) && /jwt|token/i.test(msg)) this.#saveSession(null);
      throw new CloudError(friendly(msg, r.status), r.status);
    }
    if (raw) return r;
    const txt = await r.text(); return txt ? JSON.parse(txt) : null;
  }
  async signUp(email, password) {
    const j = await this.#req('/auth/v1/signup', { method: 'POST', body: { email, password }, auth: false });
    if (j?.access_token) { this.#saveSession(withExpiry(j)); return { confirmed: true }; }
    return { confirmed: false };
  }
  async signIn(email, password) { const j = await this.#req('/auth/v1/token?grant_type=password', { method: 'POST', body: { email, password }, auth: false }); this.#saveSession(withExpiry(j)); return j.user; }
  async ensureSession() {
    const s = this.session; if (!s) return;
    if (s.expires_at && s.expires_at - 60 > Date.now() / 1000) return;
    try { const j = await this.#req('/auth/v1/token?grant_type=refresh_token', { method: 'POST', body: { refresh_token: s.refresh_token }, auth: false }); this.#saveSession(withExpiry(j)); }
    catch { this.#saveSession(null); throw new CloudError('Your cloud session expired. Please sign in again.', 401); }
  }
  async signOut() { try { if (this.session) await this.#req('/auth/v1/logout', { method: 'POST' }); } catch {} this.#saveSession(null); }
  async resetPassword(email, redirectTo) { await this.#req('/auth/v1/recover', { method: 'POST', body: { email, ...(redirectTo ? { redirect_to: redirectTo } : {}) }, auth: false }); }
  async pullState() { const uid = this.#uid(); const rows = await this.#req(`/rest/v1/user_data?select=data,updated_at&user_id=eq.${uid}`); return rows && rows[0] ? { data: rows[0].data, updatedAt: rows[0].updated_at } : null; }
  async pushState(state) {
    const uid = this.#uid(); const updated_at = state.updatedAt || new Date().toISOString();
    await this.#req('/rest/v1/user_data?on_conflict=user_id', { method: 'POST', body: { user_id: uid, data: state, updated_at }, headers: { Prefer: 'resolution=merge-duplicates,return=minimal' } });
    return updated_at;
  }
  async deleteState() { await this.#req(`/rest/v1/user_data?user_id=eq.${this.#uid()}`, { method: 'DELETE' }); }
  pathFor(hash, fileName) { const ext = (String(fileName).match(/\.(pdf|csv|txt|tsv|xlsx)$/i)?.[1] || 'bin').toLowerCase(); return `${this.#uid()}/${hash}.${ext}`; }
  async uploadFile(path, bytes, contentType = 'application/octet-stream') { await this.#req(`/storage/v1/object/statements/${encodePath(path)}`, { method: 'POST', body: bytes, headers: { 'Content-Type': contentType, 'x-upsert': 'true', 'cache-control': '3600' } }); return path; }
  async downloadFile(path) { const r = await this.#req(`/storage/v1/object/statements/${encodePath(path)}`, { raw: true }); return r.blob(); }
  async deleteFiles(paths) { if (paths.length) await this.#req('/storage/v1/object/statements', { method: 'DELETE', body: { prefixes: paths } }); }
  #uid() { const id = this.session?.user?.id; if (!id) throw new CloudError('Please sign in to cloud sync first.', 401); return id; }
}
function withExpiry(j) { return { ...j, expires_at: j.expires_at || Math.floor(Date.now() / 1000) + (j.expires_in || 3600) }; }
const encodePath = p => p.split('/').map(encodeURIComponent).join('/');
function decodeRole(key) { try { return JSON.parse(atob(key.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))).role; } catch { return null; } }
function friendly(msg, status) {
  if (/invalid login credentials/i.test(msg)) return 'Wrong email or password.';
  if (/email not confirmed/i.test(msg)) return 'Please confirm your email first (check your inbox), then sign in.';
  if (/already registered|already exists/i.test(msg)) return 'This email is already registered. Use Sign in.';
  if (/password should be|weak/i.test(msg)) return 'Password too weak. Use at least 8 characters with letters and numbers.';
  if (/relation .*user_data.* does not exist|could not find the table/i.test(msg)) return 'Cloud database is not set up yet. Run supabase/setup.sql in the Supabase SQL editor.';
  if (/bucket not found/i.test(msg)) return 'Storage bucket "statements" missing. Run supabase/setup.sql in the Supabase SQL editor.';
  if (/payload too large|exceeded the maximum/i.test(msg) || status === 413) return 'File is too large for cloud storage.';
  if (status === 429) return 'Too many requests. Please wait a minute and try again.';
  return msg ? `Cloud error: ${msg}` : `Cloud error (HTTP ${status}).`;
}
export async function sha256Hex(buf) { const d = await crypto.subtle.digest('SHA-256', buf); return [...new Uint8Array(d)].map(b => b.toString(16).padStart(2, '0')).join(''); }
