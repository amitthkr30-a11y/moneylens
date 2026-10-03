import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SupabaseClient, CloudError } from '../js/core/supabase.js';
const URL_ = 'https://demoproject.supabase.co', KEY = 'sb_publishable_TESTKEY0123456789abcdef';
const mem = () => { const m = new Map(); return { getItem: k => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k) }; };
const mock = (routes, log) => async (url, opts = {}) => { log.push({ url, ...opts }); for (const [re, fn] of routes) if (re.test(url)) { const [status, body] = fn(url, opts); return { ok: status < 300, status, json: async () => body, text: async () => (body === null ? '' : JSON.stringify(body)), blob: async () => new Blob(['x']) }; } return { ok: false, status: 404, json: async () => ({}), text: async () => '' }; };
const session = { access_token: 'AT', refresh_token: 'RT', expires_in: 3600, user: { id: 'u-123', email: 'a@b.in' } };
test('rejects wrong URL and secret keys', () => {
  assert.throws(() => new SupabaseClient({ url: 'http://evil.com', key: KEY, storage: mem() }), CloudError);
  assert.throws(() => new SupabaseClient({ url: URL_, key: 'sb_secret_abcdefghijklmnopqrstuvwxyz', storage: mem() }), /SECRET/);
});
test('sign in, push, pull, upload', async () => {
  const log = []; let saved = null;
  const c = new SupabaseClient({ url: URL_, key: KEY, storage: mem(), fetchImpl: mock([
    [/grant_type=password/, () => [200, session]], [/user_data\?on_conflict/, (u, o) => { saved = JSON.parse(o.body); return [201, null]; }],
    [/user_data\?select/, () => [200, saved ? [{ data: saved.data, updated_at: saved.updated_at }] : []]], [/storage\/v1\/object\/statements\//, () => [200, {}]]], log) });
  await c.signIn('a@b.in', 'pw12345678'); assert.equal(c.user.id, 'u-123');
  await c.pushState({ transactions: [1], updatedAt: '2026-10-03T10:00:00Z' }); assert.equal(log.at(-1).headers.Authorization, 'Bearer AT');
  assert.deepEqual((await c.pullState()).data.transactions, [1]);
  await c.uploadFile(c.pathFor('abc', 'x.PDF'), new Uint8Array([1]), 'application/pdf'); assert.match(log.at(-1).url, /statements\/u-123\/abc\.pdf$/);
});
test('friendly errors + refresh', async () => {
  const c = new SupabaseClient({ url: URL_, key: KEY, storage: mem(), fetchImpl: mock([[/grant_type=password/, () => [400, { error_description: 'Invalid login credentials' }]]], []) });
  await assert.rejects(c.signIn('a@b.in', 'x'), /Wrong email or password/);
  const log = []; const s = mem(); s.setItem('ml.sb.session', JSON.stringify({ ...session, expires_at: 1 }));
  const c2 = new SupabaseClient({ url: URL_, key: KEY, storage: s, fetchImpl: mock([[/refresh_token/, () => [200, { ...session, access_token: 'AT2' }]], [/user_data\?select/, () => [200, []]]], log) });
  assert.equal(await c2.pullState(), null); assert.equal(log.at(-1).headers.Authorization, 'Bearer AT2');
});
