// MoneyLens India: application shell, routing, events and all views.
// Every number rendered here is computed from the user's (or clearly-labelled demo) data.
import * as store from '../core/store.js';
import { esc, inr, sum, addDays, monthKey } from '../core/utils.js';
import { emptyState, ingest, ingestLoan, looksLikeLoan, findRegistered, deleteImport, correctTransaction, audit } from '../core/ingest.js';
import { runIntelligence } from '../core/pipeline.js';
import * as A from '../core/analytics.js';
import { CATEGORY_TREE } from '../core/classifier.js';
import { ask } from '../core/assistant.js';
import { generateDemo, demoLoanLines, demoCardLoanLines } from '../core/demo.js';
import { MockAccountAggregatorProvider } from '../core/providers.js';
import { writeXlsx } from '../core/xlsx.js';
import { SupabaseClient } from '../core/supabase.js';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from '../config.js';
import { fingerprint, readStatementBytes, loadJSZip } from './fileReader.js';
import { donut, bars, lines, heatmap } from './charts.js';

export const APP_VERSION = '1.2.1';
const S = {
  state: null,
  f: { period: 'this_month', bank: 'All', account: 'All', from: '', to: '' },
  tx: { q: '', cat: 'All', type: 'All', mode: 'All', flag: 'All', page: 0 },
  chat: [], upload: { busy: false, step: '', result: null, error: null, needPassword: false, dup: null },
  sidebar: false, drillCat: null, sync: { status: 'off', at: null, msg: '' }, cloud: null, cloudMsg: null,
};
const root = document.getElementById('root');
const today = () => new Date().toISOString().slice(0, 10);
const demoEnd = () => { const d = new Date(); return new Date(Date.UTC(d.getFullYear(), d.getMonth(), 0)).toISOString().slice(0, 10); };

/* ----------------------------- cloud (Supabase) ----------------------------- */
function cloudConfig() {
  let o = {}; try { o = JSON.parse(localStorage.getItem('ml.sb.cfg') || '{}'); } catch {}
  return { url: (SUPABASE_URL || o.url || '').trim(), key: (SUPABASE_ANON_KEY || o.key || '').trim(), fromFile: !!(SUPABASE_URL && SUPABASE_ANON_KEY) };
}
function initCloud() {
  const c = cloudConfig(); S.cloud = null;
  if (!c.url || !c.key) { S.sync = { status: 'off', at: null, msg: 'Cloud sync not configured' }; return; }
  try { S.cloud = new SupabaseClient({ url: c.url, key: c.key }); S.sync = { status: S.cloud.signedIn ? 'ok' : 'off', at: null, msg: S.cloud.signedIn ? 'Signed in' : 'Not signed in' }; }
  catch (e) { S.sync = { status: 'err', at: null, msg: e.message }; }
}
const cloudOn = () => !!S.cloud?.signedIn;
async function pullAndMerge({ quiet = false } = {}) {
  if (!cloudOn()) return;
  S.sync = { ...S.sync, status: 'syncing', msg: 'Syncing…' }; paintSync();
  try {
    const remote = await S.cloud.pullState(); const local = S.state;
    const localEmpty = !local.transactions.length && !(local.loanAccounts || []).length && !local.budgets.length;
    if (remote && (local.demo || localEmpty || !local.updatedAt || remote.updatedAt > local.updatedAt)) { S.state = store.withDefaults(remote.data); await store.save(S.state); if (!quiet) toast('☁ Loaded your data from the cloud'); }
    else if (!local.demo && (!remote || local.updatedAt > remote.updatedAt)) await S.cloud.pushState(local);
    S.sync = { status: 'ok', at: new Date(), msg: 'Synced' };
  } catch (e) { S.sync = { status: 'err', at: null, msg: e.message }; }
  render();
}
let pushTimer;
function schedulePush() {
  if (!cloudOn() || S.state.demo) return;
  clearTimeout(pushTimer);
  pushTimer = setTimeout(async () => {
    S.sync = { ...S.sync, status: 'syncing', msg: 'Saving to cloud…' }; paintSync();
    try { await S.cloud.pushState(S.state); S.sync = { status: 'ok', at: new Date(), msg: 'Synced' }; } catch (e) { S.sync = { status: 'err', at: null, msg: e.message }; }
    paintSync();
  }, 1500);
}
function syncBadge() {
  const s = S.sync;
  const txt = s.status === 'ok' ? `☁ Synced${s.at ? ' ' + s.at.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }) : ''}` : s.status === 'syncing' ? '☁ Syncing…' : s.status === 'err' ? '⚠ ' + s.msg : '☁ Local only';
  return `<a href="#/cloud" class="sync ${s.status === 'ok' ? 'on' : s.status === 'err' ? 'err' : ''}" id="syncBadge">${esc(txt)}</a>`;
}
function paintSync() { const el = document.getElementById('syncBadge'); if (el) el.outerHTML = syncBadge(); }

/* ----------------------------- boot & persistence ----------------------------- */
async function boot() {
  document.documentElement.dataset.theme = localStorage.getItem('ml.theme') || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  initCloud();
  try { const r = await store.load(); if (r.locked) return renderLock(); S.state = r.state; }
  catch { S.state = emptyState(); toast('Browser storage unavailable: data will not persist (private mode?).'); }
  addEventListener('hashchange', () => { S.sidebar = false; render(); scrollTo(0, 0); });
  render(); pullAndMerge();
}
function renderLock(err = '') {
  root.innerHTML = `<div class="lock"><form class="card form" data-form="unlock" style="width:min(380px,92vw)">
    <div class="brand"><div class="logo">₹</div><div><b>MoneyLens India</b><small>Your data is encrypted on this device</small></div></div>
    ${err ? `<div class="alert err">${esc(err)}</div>` : ''}
    <label>Passcode<input type="password" name="pass" autocomplete="current-password" required autofocus></label>
    <button class="btn">Unlock</button><a href="#" data-action="forgot" class="mute" style="font-size:12px">Forgot passcode?</a></form></div>`;
}
let saveTimer;
function persist() { S.state.updatedAt = new Date().toISOString(); clearTimeout(saveTimer); saveTimer = setTimeout(() => store.save(S.state).catch(e => toast(e.message)), 150); schedulePush(); }
function toast(msg) { const t = document.createElement('div'); t.className = 'toast'; t.textContent = msg; document.body.appendChild(t); setTimeout(() => t.remove(), 3600); }

/* ----------------------------- helpers ----------------------------- */
const ctx = () => A.makeCtx(S.state);
const hasTx = () => S.state.transactions.length > 0;
const hasData = () => hasTx() || (S.state.loanAccounts || []).length > 0;
const anchor = () => { const l = A.latestDate(S.state.transactions); return l === '0000-00-00' ? today() : l < today() ? l : today(); };
const range = () => A.periodRange(S.f.period, anchor(), S.f);
function scoped(txns = S.state.transactions) { const [from, to] = range(); return A.filterTxns(txns, { from, to, bank: S.f.bank, account: S.f.account }); }
const curMonth = () => anchor().slice(0, 7);
const monthName = m => new Date(m + '-01T00:00:00Z').toLocaleDateString('en-IN', { month: 'short', year: 'numeric', timeZone: 'UTC' });
const fmtDate = d => d ? new Date(d + 'T00:00:00Z').toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' }) : '—';
const reviewCount = () => S.state.transactions.filter(t => t.review_flags?.length).length;
const PERIODS = [['this_month', 'This Month'], ['last_month', 'Last Month'], ['3m', '3 Months'], ['6m', '6 Months'], ['12m', '12 Months'], ['all', 'All Time'], ['custom', 'Custom']];

/* ----------------------------- layout ----------------------------- */
const NAV = [
  ['dashboard', '◧', 'Dashboard'], ['transactions', '≡', 'Transactions'], ['analytics', '◔', 'Analytics'], ['budgets', '◎', 'Budgets'],
  ['subscriptions', '↻', 'Subscriptions'], ['loans', '◈', 'Loans'], ['emis', '⌂', 'EMI Calculator'], ['cards', '▭', 'Credit Cards'], ['cashflow', '⇅', 'Cash Flow'],
  ['networth', '△', 'Net Worth'], ['calendar', '▦', 'Calendar'], ['accounts', '▤', 'Accounts & Statements'], ['review', '⚑', 'Review'],
  ['assistant', '✦', 'Ask MoneyLens'], ['reports', '▥', 'Reports'], ['sep', '', 'Data'], ['upload', '⇪', 'Upload Statement'], ['cloud', '☁', 'Cloud Sync'], ['connect', '⇄', 'Connect Bank (AA)'],
  ['settings', '⚙', 'Settings & Privacy'], ['admin', '⌗', 'Diagnostics'],
];
const BOTTOM = [['dashboard', '◧', 'Home'], ['transactions', '≡', 'Transactions'], ['loans', '◈', 'Loans'], ['upload', '⇪', 'Upload'], ['more', '☰', 'More']];
const NO_DATA_OK = ['upload', 'connect', 'settings', 'privacy', 'terms', 'admin', 'welcome', 'budgets', 'networth', 'emis', 'cards', 'cloud', 'loans', 'accounts'];
const NEEDS_TX = ['dashboard', 'transactions', 'analytics', 'subscriptions', 'cashflow', 'review', 'reports'];

function render() {
  if (!S.state) return;
  let route = location.hash.replace(/^#\/?/, '').split('?')[0] || (hasTx() ? 'dashboard' : hasData() ? 'loans' : 'welcome');
  if (!VIEWS[route]) route = 'dashboard';
  if (route === 'welcome' || (!hasData() && !NO_DATA_OK.includes(route))) { root.innerHTML = `<main style="margin:0">${VIEWS.welcome()}</main>`; return; }
  if (!hasTx() && NEEDS_TX.includes(route)) route = 'loans';
  const rc = reviewCount();
  root.innerHTML = `<div class="app">
  <aside class="side ${S.sidebar ? 'open' : ''}"><div class="brand"><div class="logo">₹</div><div><b>MoneyLens India</b><small>Understand your money.</small></div></div>
  ${syncBadge()}
  <nav class="nav">${NAV.map(([k, ic, l]) => k === 'sep' ? `<div class="sep">${l}</div>` : `<a href="#/${k}" class="${route === k ? 'on' : ''}"><span class="ic">${ic}</span>${l}${k === 'review' && rc ? `<span class="badge-n">${rc}</span>` : ''}</a>`).join('')}</nav>
  <div style="margin-top:auto;padding:12px;font-size:11px" class="mute">🔒 ${cloudOn() ? 'Synced to your private cloud.' : 'Data stays in this browser.'}<br><a href="#/privacy">Privacy</a> · <a href="#/terms">Terms</a><br><span class="ver">v${APP_VERSION}</span></div></aside>
  <main>${S.state.demo ? `<div class="demo-banner">🧪 <b>Demo mode</b>: all figures are synthetic sample data (never synced). <button class="btn sm ghost" data-action="exit-demo">Exit demo & start fresh</button></div>` : ''}${VIEWS[route]()}</main>
  <nav class="bottom">${BOTTOM.map(([k, ic, l]) => `<a href="${k === 'more' ? '#' : '#/' + k}" ${k === 'more' ? 'data-action="menu"' : ''} class="${route === k ? 'on' : ''}"><span class="ic">${ic}</span>${l}</a>`).join('')}</nav></div>`;
}

function header(title, { filters = true, extra = '' } = {}) {
  const banks = [...new Set(S.state.accounts.map(a => a.bank_name))];
  return `<div class="top"><button class="btn ghost sm menu-btn" data-action="menu" aria-label="Menu">☰</button><h1>${title}</h1>
  ${filters ? `<div class="filters">
    <select data-filter="period" aria-label="Period">${PERIODS.map(([v, l]) => `<option value="${v}" ${S.f.period === v ? 'selected' : ''}>${l}</option>`).join('')}</select>
    ${S.f.period === 'custom' ? `<input type="date" data-filter="from" value="${esc(S.f.from)}"><input type="date" data-filter="to" value="${esc(S.f.to)}">` : ''}
    <select data-filter="bank" aria-label="Bank"><option value="All">All banks</option>${banks.map(b => `<option ${S.f.bank === b ? 'selected' : ''}>${esc(b)}</option>`).join('')}</select>
    <select data-filter="account" aria-label="Account"><option value="All">All accounts</option>${S.state.accounts.map(a => `<option value="${a.id}" ${S.f.account === a.id ? 'selected' : ''}>${esc(a.nickname)} ${esc(a.account_number_masked.slice(-4))}</option>`).join('')}</select>
  </div>` : ''}${extra}</div>
  ${filters ? `<div class="mute" style="margin:-8px 0 14px;font-size:12px">${(() => { const [f, t] = range(); return S.f.period === 'all' ? 'All imported data' : `${fmtDate(f)} – ${fmtDate(t)}`; })()} · periods relative to your latest data (${fmtDate(anchor())})</div>` : ''}`;
}
const kpi = (label, value, sub = '', cls = '') => `<div class="kpi ${cls}"><span>${label}</span><b>${value}</b>${sub ? `<em>${sub}</em>` : ''}</div>`;
const chg = (c, p, invert = false) => { if (!p || S.f.period === 'all') return ''; const d = (c - p) / p * 100; const bad = invert ? d < 0 : d > 0; return `<span class="${bad ? 'up' : 'down'}">${d > 0 ? '▲' : '▼'} ${Math.abs(d).toFixed(1)}% vs prev</span>`; };
const catOptions = (sel = '') => Object.keys(CATEGORY_TREE).map(c => `<option ${c === sel ? 'selected' : ''}>${esc(c)}</option>`).join('');
const subOptions = (cat, sel = '') => (CATEGORY_TREE[cat] || []).map(s => `<option ${s === sel ? 'selected' : ''}>${esc(s)}</option>`).join('');
function flagPills(t) {
  const p = [];
  if (t.is_transfer) p.push('<span class="pill x">Transfer</span>');
  if (t.is_duplicate) p.push('<span class="pill b">Duplicate</span>'); else if (t.possible_duplicate) p.push('<span class="pill w">Possible duplicate</span>');
  if (t.is_recurring) p.push('<span class="pill">Recurring</span>');
  if (t.anomaly) p.push(`<span class="pill w" title="${esc(t.anomaly)}">Review</span>`);
  if (t.excluded) p.push('<span class="pill x">Ignored</span>');
  return p.join(' ');
}
function txTable(list, { limit = 100, actions = false } = {}) {
  if (!list.length) return '<div class="empty-chart">No transactions</div>';
  return `<div class="tbl"><table><thead><tr><th>Date</th><th>Merchant</th><th class="hide-m">Category</th><th class="hide-m">Mode</th><th class="hide-m">Account</th><th class="n">Amount</th>${actions ? '<th></th>' : ''}</tr></thead><tbody>
  ${list.slice(0, limit).map(t => `<tr data-action="edit-tx" data-id="${t.transaction_id}" style="cursor:pointer">
    <td style="white-space:nowrap">${fmtDate(t.transaction_date)}</td>
    <td><b>${esc(t.merchant)}</b> ${flagPills(t)}<div class="desc" title="${esc(t.description)}">${esc(t.description)}</div></td>
    <td class="hide-m"><span class="pill ${t.confidence_score < 0.6 ? 'w' : ''}">${esc(t.category)}</span><div class="desc">${esc(t.subcategory)}</div></td>
    <td class="hide-m">${esc(t.payment_mode)}</td><td class="hide-m">${esc(t.bank_name)} ${esc(t.account_number_masked.slice(-4))}</td>
    <td class="n ${t.credit ? 'pos' : ''}"><b>${t.credit ? '+' : '−'}${inr(t.amount, 2)}</b></td>${actions ? `<td>${actions(t)}</td>` : ''}</tr>`).join('')}
  </tbody></table></div>${list.length > limit ? `<div class="mute" style="padding:8px">Showing ${limit} of ${list.length}</div>` : ''}`;
}

/* ----------------------------- views ----------------------------- */
const VIEWS = {};
VIEWS.welcome = () => `<div class="welcome">
  <div class="logo hero-logo">₹</div><h1>MoneyLens India</h1><div class="tag">Understand your money. Control your spending.</div>
  <div class="choice">
    <a class="card" href="#/upload"><h3>⇪ Upload statement</h3><div class="mute">Bank, credit card or <b>loan</b> statements: HDFC, SBI or any bank. PDF, CSV, Excel.</div></a>
    <a class="card" href="#/cloud"><h3>☁ Sign in to Cloud Sync</h3><div class="mute">Already uploaded on another device? Sign in and your data loads automatically. No re-upload.</div></a>
    <a class="card" href="#" data-action="demo"><h3>🧪 Try demo</h3><div class="mute">12 months of synthetic HDFC + SBI + credit-card + loan data.</div></a>
  </div>
  <div class="trust"><span>🔒 No bank passwords, OTP, PIN or CVV, ever</span><span>☁ Optional private cloud (Supabase)</span><span>🆓 Free & open source</span></div>
  <p class="mute" style="margin-top:22px;font-size:12px">By continuing you agree to the <a href="#/terms">Terms</a> and <a href="#/privacy">Privacy Policy</a>. MoneyLens provides information, not financial advice. · v${APP_VERSION}</p></div>`;

VIEWS.dashboard = () => {
  const c = ctx(), tx = scoped(), k = A.kpis(tx, c);
  const [pf, pt] = A.previousRange(S.f.period, anchor(), S.f);
  const pk = A.kpis(A.filterTxns(S.state.transactions, { from: pf, to: pt, bank: S.f.bank, account: S.f.account }), c);
  const cats = A.byCategory(tx, c), merch = A.byMerchant(tx, c).slice(0, 8);
  const ms = A.monthly(A.filterTxns(S.state.transactions, { from: A.periodRange('12m', anchor())[0], to: anchor(), bank: S.f.bank, account: S.f.account }), c);
  const bud = A.budgetStatus(S.state.budgets, S.state.transactions, c, curMonth()).filter(b => b.status !== 'ok');
  const ins = A.insights(S.state, c, anchor());
  const upcoming = A.calendarEvents(S.state, today(), 30).slice(0, 6);
  const loans = S.state.loanAccounts || [];
  return header('Dashboard') + `
  ${bud.map(b => `<div class="alert ${b.status === 'exceeded' ? 'err' : ''}">${b.status === 'exceeded' ? '⛔ Budget exceeded' : '⚠️ Budget nearing limit'}: <b>${esc(b.category)}</b>: ${inr(b.actual)} of ${inr(b.amount)} (${b.utilization.toFixed(0)}%)</div>`).join('')}
  <div class="kpis">
    ${kpi('Total Income', inr(k.income), chg(k.income, pk.income, true))}${kpi('Total Expenses', inr(k.expenses), chg(k.expenses, pk.expenses))}
    ${kpi('Savings', inr(k.savings), '', 'hero')}${kpi('Savings Rate', k.income ? k.savingsRate.toFixed(1) + '%' : '—')}
    ${kpi('Investments', inr(k.investments))}${kpi('Bills', inr(k.bills))}${kpi('EMIs', inr(k.emis))}
    ${loans.length ? kpi('Loans', loans.length, `<a href="#/loans">EMI ${inr(sum(loans, l => l.currentEmi || 0))}/mo →</a>`) : ''}
  </div>
  <div class="grid g2">
    <div class="card"><h3>Where your money went <span class="r">click to drill down</span></h3>${donut(cats, { drill: 'category' })}</div>
    <div class="card"><h3>Income vs expenses <span class="r">last 12 months</span></h3>${lines([{ name: 'Income', color: '#10B981', values: ms.map(m => m.income) }, { name: 'Expenses', color: '#EF4444', values: ms.map(m => m.expenses) }, { name: 'Savings', color: '#4F46E5', values: ms.map(m => m.savings) }], ms.map(m => monthName(m.month)))}</div>
    <div class="card"><h3>Top merchants</h3>${bars(merch, { horizontal: true, drill: 'merchant' })}</div>
    <div class="card"><h3>Insights</h3>${ins.length ? ins.map(i => `<div class="ins ${i.type}"><span class="dot"></span><div>${esc(i.text)}</div></div>`).join('') : '<div class="mute">Insights appear after you import transactions.</div>'}</div>
    <div class="card"><h3>How you paid</h3><div class="kpis" style="margin:0">${kpi('UPI', inr(k.upi))}${kpi('Cards', inr(k.cards))}${kpi('Cash (ATM)', inr(k.cash))}${kpi('Internal transfers', inr(k.transfers), 'excluded from expenses')}</div></div>
    <div class="card"><h3>Upcoming (30 days) <a class="r" href="#/calendar">Calendar →</a></h3>${upcoming.length ? `<table>${upcoming.map(e => `<tr><td>${fmtDate(e.date)}</td><td>${esc(e.title)} <span class="pill x">${esc(e.type)}</span></td><td class="n">${e.amount ? inr(e.amount) : ''}</td></tr>`).join('')}</table>` : '<div class="mute">No upcoming payments detected.</div>'}</div>
  </div>
  <div class="card" style="margin-top:16px"><h3>Recent transactions <a class="r" href="#/transactions">View all →</a></h3>${txTable([...tx].sort((a, b) => b.transaction_date.localeCompare(a.transaction_date)), { limit: 8 })}</div>`;
};

VIEWS.transactions = () => {
  const f = S.tx; const q = f.q.trim().toLowerCase();
  let list = scoped().filter(t =>
    (!q || [t.merchant, t.description, t.category, t.subcategory, t.upi_id, t.reference_number, String(t.amount)].some(v => String(v || '').toLowerCase().includes(q))) &&
    (f.cat === 'All' || t.category === f.cat) && (f.type === 'All' || t.transaction_type === f.type) && (f.mode === 'All' || t.payment_mode === f.mode) &&
    (f.flag === 'All' || (f.flag === 'Recurring' && t.is_recurring) || (f.flag === 'Transfers' && t.is_transfer) || (f.flag === 'Review' && t.review_flags.length) || (f.flag === 'Duplicates' && (t.is_duplicate || t.possible_duplicate))));
  if (f.merchant) list = list.filter(t => t.merchant === f.merchant);
  list.sort((a, b) => b.transaction_date.localeCompare(a.transaction_date));
  const modes = [...new Set(S.state.transactions.map(t => t.payment_mode))].sort();
  const sel = (k, opts) => `<select data-txf="${k}">${['All', ...opts].map(o => `<option ${f[k] === o ? 'selected' : ''}>${esc(o)}</option>`).join('')}</select>`;
  return header('Transactions') + `<div class="card">
    <div class="row" style="margin-bottom:12px"><input type="search" data-txf="q" value="${esc(f.q)}" placeholder="Search merchant, amount, UPI ID, reference, description…" style="flex:3">
      ${sel('cat', Object.keys(CATEGORY_TREE))}${sel('type', ['Debit', 'Credit'])}${sel('mode', modes)}${sel('flag', ['Recurring', 'Transfers', 'Review', 'Duplicates'])}</div>
    ${f.merchant ? `<div class="alert">Merchant: <b>${esc(f.merchant)}</b> <button class="btn sm ghost" data-action="clear-merchant">Clear</button></div>` : ''}
    <div class="mute" style="margin-bottom:8px">${list.length} transactions · Debits ${inr(sum(list, t => t.debit))} · Credits ${inr(sum(list, t => t.credit))} · <a href="#" data-action="export-filtered">Export these (CSV)</a></div>
    ${txTable(list, { limit: 300 })}</div>`;
};

VIEWS.analytics = () => {
  const c = ctx(), tx = scoped(), cats = A.byCategory(tx, c);
  const ms = A.monthly(tx, c);
  const sc = A.scorecard(S.state.transactions, c, curMonth()); const months = sc.pop();
  const upiM = A.groupSum(tx.filter(t => t.payment_mode === 'UPI'), c, t => t.merchant).slice(0, 10);
  const drill = S.drillCat && cats.find(x => x.key === S.drillCat) ? S.drillCat : null;
  const fmtV = r => r.isPct ? r.current.toFixed(1) + '%' : inr(r.current);
  const goodUp = ['Income', 'Savings', 'Savings %', 'Investment %'];
  return header('Analytics') + `<div class="grid g2">
  <div class="card"><h3>${drill ? `${esc(drill)} → subcategories <button class="btn sm ghost" data-action="undrill">← All categories</button>` : 'Expense by category'}</h3>${drill ? donut(A.bySubcategory(tx, c, drill), { drill: 'subcategory' }) : donut(cats, { drill: 'category' })}</div>
  <div class="card"><h3>Expense by month</h3>${bars(ms.map(m => ({ key: m.month, label: monthName(m.month).split(' ')[0], value: m.expenses })), { color: '#4F46E5' })}</div>
  <div class="card"><h3>Expense by merchant</h3>${bars(A.byMerchant(tx, c).slice(0, 12), { horizontal: true, drill: 'merchant' })}</div>
  <div class="card"><h3>Payment mode</h3>${donut(A.byMode(tx, c), { drill: 'mode' })}</div>
  <div class="card"><h3>Expense by bank</h3>${bars(A.byBank(tx, c), { horizontal: true })}</div>
  <div class="card"><h3>Day of week</h3>${bars(A.byDow(tx, c), { color: '#06B6D4' })}
    <div class="row" style="margin-top:8px">${A.byWeekend(tx, c).map(e => `<div class="kpi"><span>${e.key}</span><b>${inr(e.value)}</b><em class="mute">${e.count} txns · avg ${inr(e.value / e.count)}</em></div>`).join('')}</div></div>
  <div class="card"><h3>Weekly trend</h3>${lines([{ name: 'Weekly spend', color: '#8B5CF6', values: A.byWeek(tx, c).map(w => w.value) }], A.byWeek(tx, c).map(w => w.key.slice(5)))}</div>
  <div class="card"><h3>Daily spend heatmap <span class="r">${monthName(curMonth())}</span></h3>${heatmap(A.dailyHeat(S.state.transactions.filter(t => t.transaction_date.startsWith(curMonth())), c), curMonth())}</div>
  <div class="card"><h3>UPI merchants</h3>${bars(upiM, { horizontal: true, drill: 'merchant', color: '#10B981' })}</div>
  <div class="card"><h3>Monthly scorecard <span class="r">${monthName(months.current)} vs ${monthName(months.previous)}</span></h3>
    <div class="scroll-x"><table><thead><tr><th>Metric</th><th class="n">${monthName(months.previous)}</th><th class="n">${monthName(months.current)}</th><th class="n">Change</th></tr></thead><tbody>
    ${sc.map(r => `<tr><td>${esc(r.metric)}</td><td class="n">${r.isPct ? r.previous.toFixed(1) + '%' : inr(r.previous)}</td><td class="n"><b>${fmtV(r)}</b></td>
      <td class="n ${r.change > 0 ? (goodUp.includes(r.metric) ? 'pos' : 'neg') : r.change < 0 ? (goodUp.includes(r.metric) ? 'neg' : 'pos') : ''}">${r.isPct ? (r.change > 0 ? '+' : '') + r.change.toFixed(1) + ' pts' : (r.change > 0 ? '+' : '') + inr(r.change) + (r.changePct !== null ? ` (${r.changePct > 0 ? '+' : ''}${r.changePct.toFixed(1)}%)` : '')}</td></tr>`).join('')}</tbody></table></div></div>
  </div>`;
};

VIEWS.budgets = () => {
  const c = ctx(), m = curMonth(), st = A.budgetStatus(S.state.budgets, S.state.transactions, c, m);
  const tb = sum(st, b => b.amount), ta = sum(st, b => b.actual);
  return header('Budgets', { filters: false }) + `<div class="kpis">${kpi('Month', monthName(m))}${kpi('Total budget', inr(tb))}${kpi('Spent', inr(ta))}${kpi('Remaining', inr(tb - ta), '', tb - ta < 0 ? '' : 'hero')}</div>
  <div class="grid g2"><div class="card"><h3>Category budgets</h3>${st.length ? st.map(b => `<div style="padding:10px 0;border-bottom:1px solid var(--line)">
    <div class="row" style="align-items:center"><b style="flex:2">${esc(b.category)}</b><span class="pill ${b.status === 'exceeded' ? 'b' : b.status === 'nearing' ? 'w' : 'g'}" style="flex:0">${b.utilization.toFixed(0)}% used</span><button class="btn sm ghost" style="flex:0;min-width:0" data-action="del-budget" data-cat="${esc(b.category)}">✕</button></div>
    <div class="prog ${b.status}" style="margin:8px 0"><span style="width:${Math.min(100, b.utilization)}%"></span></div>
    <div class="mute" style="font-size:12.5px">${inr(b.amount)} budget · ${inr(b.actual)} used · <b class="${b.remaining < 0 ? 'neg' : 'pos'}">${inr(Math.abs(b.remaining))} ${b.remaining < 0 ? 'over' : 'remaining'}</b></div></div>`).join('') : '<div class="mute">No budgets yet. Add one →</div>'}</div>
  <div class="card"><h3>Add / update budget</h3><form class="form" data-form="budget">
    <label>Category<select name="category">${Object.keys(CATEGORY_TREE).filter(x => !['Income', 'Transfers', 'Investment'].includes(x)).map(x => `<option>${esc(x)}</option>`).join('')}</select></label>
    <label>Monthly amount (₹)<input type="number" name="amount" min="1" step="1" required></label><button class="btn">Save budget</button></form>
    ${hasTx() ? `<button class="btn ghost" style="margin-top:12px" data-action="suggest-budgets">Suggest from my 3-month average</button>` : ''}
    <p class="mute" style="font-size:12px">Alerts appear on the dashboard at 80% (nearing) and 100% (exceeded).</p></div></div>`;
};

VIEWS.subscriptions = () => {
  const rec = S.state.recurring || [], subs = rec.filter(r => r.is_subscription), status = S.state.subscriptionStatus;
  const active = subs.filter(s => (status[s.id] || (s.possibly_inactive ? 'Review' : 'Active')) !== 'Inactive');
  return header('Subscriptions & recurring', { filters: false }) + `<div class="kpis">${kpi('Active subscriptions', active.length)}${kpi('Monthly subscription cost', inr(sum(active, s => s.monthly_cost)), '', 'hero')}${kpi('Annual subscription cost', inr(sum(active, s => s.annual_cost)))}${kpi('All recurring payments / month', inr(sum(rec, r => r.monthly_cost)))}</div>
  <div class="card"><h3>Subscriptions</h3>${subs.length ? `<div class="tbl"><table><thead><tr><th>Service</th><th class="n">Amount</th><th>Frequency</th><th>Last paid</th><th>Next expected</th><th class="n">Annual cost</th><th>Status</th></tr></thead><tbody>
    ${subs.map(s => { const stt = status[s.id] || (s.possibly_inactive ? 'Review' : 'Active'); return `<tr><td><b>${esc(s.merchant)}</b> ${s.possibly_inactive ? '<span class="pill w">No recent charge</span>' : ''}</td><td class="n">${inr(s.amount, 2)}</td><td>${s.frequency}</td><td>${fmtDate(s.last_payment)}</td><td>${fmtDate(s.next_expected)}</td><td class="n">${inr(s.annual_cost)}</td>
    <td><select data-action="sub-status" data-id="${s.id}">${['Active', 'Inactive', 'Review'].map(o => `<option ${o === stt ? 'selected' : ''}>${o}</option>`).join('')}</select></td></tr>`; }).join('')}</tbody></table></div>` : '<div class="mute">No subscriptions detected yet. They appear after 2–3 repeated charges.</div>'}</div>
  <div class="card" style="margin-top:16px"><h3>All recurring payments</h3>${rec.length ? `<div class="tbl"><table><thead><tr><th>Merchant</th><th>Category</th><th class="n">Amount</th><th>Frequency</th><th>Last payment</th><th>Next expected</th><th class="n">Annual est.</th></tr></thead><tbody>
    ${rec.map(r => `<tr data-action="drill-merchant" data-key="${esc(r.merchant.replace(/ \(₹[\d,]+\)$/, ''))}" style="cursor:pointer"><td><b>${esc(r.merchant)}</b></td><td><span class="pill">${esc(r.subcategory || r.category)}</span></td><td class="n">${inr(r.amount, 2)}</td><td>${r.frequency} <span class="mute">(${r.occurrences}×)</span></td><td>${fmtDate(r.last_payment)}</td><td>${fmtDate(r.next_expected)}</td><td class="n">${inr(r.annual_cost)}</td></tr>`).join('')}</tbody></table></div>` : '<div class="mute">No recurring payments detected.</div>'}</div>`;
};

/* ---------- Loans ---------- */
const LOAN_PILL = { 'EMI': 'g', 'EMI bounced': 'b', 'Bounce charge': 'b', 'Penal interest': 'w', 'Charges': 'w', 'Pre-EMI': '', 'Prepayment': 'g', 'Disbursement': '' };
function emiTableCard(l) {
  const paidPct = l.estTenureMonths ? Math.min(100, l.emisPaid / l.estTenureMonths * 100) : 0;
  return `<div class="card">
    <h3>◈ ${esc(l.product)} <span class="r">${esc(l.bank)} · ${esc(l.accountMasked)}</span></h3>
    <div class="kpis" style="margin-bottom:10px">${kpi('Loan amount', inr(l.loanAmount))}${kpi('Interest rate', l.rate.toFixed(2) + '%')}${kpi('Monthly EMI', inr(l.currentEmi))}${kpi('Principal outstanding', inr(l.outstanding), `${inr(l.outstanding, 2)} as per bank`, 'hero')}</div>
    <div class="prog" style="margin:4px 0"><span style="width:${paidPct}%"></span></div>
    <div class="mute" style="font-size:12px;margin-bottom:8px">${l.emisPaid} of ${l.estTenureMonths} EMIs billed (${paidPct.toFixed(0)}%) · ${l.remainingEmis} remaining</div>
    <table>
      <tr><td>Booked on</td><td class="n">${fmtDate(l.bookedDate)}</td></tr>
      <tr><td>First / last EMI</td><td class="n">${fmtDate(l.firstEmiDate)} → ${fmtDate(l.lastEmiDate)}</td></tr>
      <tr><td>Next EMI</td><td class="n"><b>${l.nextEmiDate ? fmtDate(l.nextEmiDate) : 'Fully repaid'}</b></td></tr>
      <tr><td>Principal repaid</td><td class="n pos">${inr(l.principalPaid, 2)}</td></tr>
      <tr><td>Interest paid so far</td><td class="n">${inr(l.interestPaid, 2)}</td></tr>
      <tr><td>Interest still to pay</td><td class="n neg">${inr(l.interestRemaining, 2)}</td></tr>
      <tr><td>Total interest over the loan</td><td class="n">${inr(l.totalInterest, 2)}</td></tr>
      <tr><td>Payment mode</td><td class="n">Billed to your credit card</td></tr>
    </table>
    <details style="margin-top:12px"><summary style="cursor:pointer"><b>EMI schedule (${l.schedule.length})</b></summary><div class="tbl" style="max-height:360px"><table><thead><tr><th>#</th><th>Statement date</th><th class="n">Principal</th><th class="n">Interest</th><th class="n">EMI</th></tr></thead><tbody>
      ${l.schedule.map((s, i) => `<tr class="${i < l.emisPaid ? 'past' : i === l.emisPaid ? 'nextrow' : ''}"><td>${i + 1}</td><td>${fmtDate(s.date)} ${i < l.emisPaid ? '<span class="pill g">billed</span>' : i === l.emisPaid ? '<span class="pill">next</span>' : ''}</td><td class="n">${inr(s.principal, 2)}</td><td class="n">${inr(s.interest, 2)}</td><td class="n"><b>${inr(s.emi, 2)}</b></td></tr>`).join('')}
    </tbody></table></div></details>
    <p class="mute" style="font-size:12px;margin-bottom:0">This EMI is charged to your credit card, so it appears in your card statement. It is not added to expenses a second time.</p>
  </div>`;
}
function soaCard(l) {
  const o = A.loanOutstanding(l); const paidPct = o && l.estTenureMonths ? Math.min(100, o.paidInstallments / l.estTenureMonths * 100) : 0;
  return `<div class="card">
    <h3>◈ ${esc(l.product)} <span class="r">${esc(l.bank)} · ${esc(l.accountMasked)}</span></h3>
    <div class="kpis" style="margin-bottom:10px">${kpi('Loan amount', inr(l.loanAmount))}${kpi('Interest rate', l.rate != null ? l.rate.toFixed(2) + '%' : '—')}${kpi('Current EMI', inr(l.currentEmi))}${kpi('EMIs paid (period)', l.emisPaid)}</div>
    <table>
      <tr><td>Statement period</td><td class="n">${fmtDate(l.periodFrom)} – ${fmtDate(l.periodTo)}</td></tr>
      <tr><td>Receivable / received (period)</td><td class="n">${inr(l.receivable)} / ${inr(l.received)}</td></tr>
      <tr><td>Overdue</td><td class="n ${l.overdue > 0 ? 'neg' : 'pos'}"><b>${l.overdue != null ? inr(l.overdue) : '—'}</b></td></tr>
      <tr><td>Bounces · charges</td><td class="n ${l.bounces ? 'neg' : ''}">${l.bounces} · ${inr(l.charges)}</td></tr>
      <tr><td>Implied total tenure*</td><td class="n">${l.estTenureMonths ? `${l.estTenureMonths} months (~${(l.estTenureMonths / 12).toFixed(1)} yrs)` : '—'}</td></tr>
      ${o ? `<tr><td>Est. outstanding principal*</td><td class="n"><b>${inr(o.outstanding)}</b></td></tr><tr><td>Est. principal / interest repaid*</td><td class="n">${inr(o.principalPaid)} / ${inr(o.interestPaid)}</td></tr><tr><td>Est. remaining tenure*</td><td class="n">${o.remainingTenure} months</td></tr>` : ''}
    </table>
    ${o ? `<div class="prog" style="margin:10px 0 4px"><span style="width:${paidPct}%"></span></div><div class="mute" style="font-size:12px">${paidPct.toFixed(0)}% of tenure completed (estimate)</div>` : ''}
    <form class="row no-print" data-form="loan-start" data-key="${esc(l.key)}" style="margin-top:10px"><label class="form" style="flex:2">First EMI date (from your sanction letter), for the outstanding estimate<input type="date" name="first" value="${esc(l.firstEmiDate || '')}"></label><button class="btn sm" style="flex:0">Save</button></form>
    <details style="margin-top:12px"><summary style="cursor:pointer"><b>EMI history (${l.transactions.length})</b></summary><div class="tbl" style="max-height:340px"><table><thead><tr><th>Date</th><th>Description</th><th>Type</th><th class="hide-m">Mode</th><th class="n">Amount</th></tr></thead><tbody>
      ${[...l.transactions].reverse().map(t => `<tr><td style="white-space:nowrap">${fmtDate(t.date)}</td><td>${esc(t.description)}${t.bounceReason ? `<div class="desc neg">${esc(t.bounceReason)}</div>` : ''}</td><td><span class="pill ${LOAN_PILL[t.type] ?? 'x'}">${esc(t.type)}</span></td><td class="hide-m">${esc(t.paymode)}</td><td class="n ${t.amount < 0 ? 'neg' : ''}">${inr(t.amount)}</td></tr>`).join('')}
    </tbody></table></div></details></div>`;
}
VIEWS.loans = () => {
  const loans = S.state.loanAccounts || [];
  const outs = loans.map(l => A.loanOutstanding(l)); const known = outs.filter(Boolean);
  const anyEstimate = known.some(o => !o.exact);
  return header('Loans', { filters: false, extra: '<a class="btn" href="#/upload">+ Upload loan statement</a>' }) +
  (loans.length ? '' : `<div class="alert">Upload a <b>loan PDF</b>. Supported formats:<br>• HDFC home / plot / top-up / personal loan <b>Statement of Account</b><br>• HDFC credit-card loan <b>Loan EMI Table</b> (Insta Loan, Jumbo Loan, SmartEMI)<br><span class="mute">Loan EMIs are tracked here separately, so nothing is double counted in expenses.</span></div>`) +
  `<div class="kpis">${kpi('Active loans', loans.length)}${kpi('Total monthly EMI', inr(sum(loans, l => l.currentEmi || 0)), '', 'hero')}${kpi('Total sanctioned', inr(sum(loans, l => l.loanAmount || 0)))}${kpi('Outstanding principal', known.length ? inr(sum(known, o => o.outstanding)) : '—', known.length < loans.length ? 'enter first EMI date for home loans' : anyEstimate ? 'includes estimates' : 'as per bank')}${kpi('Bounces (statement period)', sum(loans, l => l.bounces || 0))}${kpi('Charges & penal interest', inr(sum(loans, l => l.charges || 0)))}</div>
  ${loans.filter(l => l.bounces || l.overdue > 0).map(l => `<div class="alert warnk">⚠️ <b>${esc(l.product)}</b> ${esc(l.accountMasked)}: ${l.bounces ? `${l.bounces} EMI bounce(s)` : ''}${l.bounces && l.overdue > 0 ? ' · ' : ''}${l.overdue > 0 ? `overdue ${inr(l.overdue)}` : ''} · charges ${inr(l.charges)}. Keep enough balance before the EMI date to avoid bounce charges.</div>`).join('')}
  <div class="grid g2">${loans.map(l => l.kind === 'emi_table' ? emiTableCard(l) : soaCard(l)).join('')}</div>
  ${loans.some(l => l.kind !== 'emi_table') ? '<p class="mute" style="font-size:12px">* Home-loan estimates use standard reducing-balance maths from loan amount, ROI and EMI. Check your lender\'s interest certificate for exact figures.</p>' : ''}`;
};

VIEWS.emis = () => {
  const emis = (S.state.recurring || []).filter(r => r.is_emi || r.category === 'Finance' && /EMI|Loan/.test(r.subcategory));
  const loans = S.state.loans.map(l => ({ ...l, ...A.emiSchedule({ principal: +l.principal, ratePct: +l.rate, tenureMonths: +l.tenure, startDate: l.start, emi: +l.emi || undefined }) }));
  return header('EMI Calculator', { filters: false }) + `<div class="alert">Loans from statements have their own page: <a href="#/loans">Loans</a>. Use this page for loans you want to track manually.</div><div class="kpis">${kpi('EMIs detected in bank statements / month', inr(sum(emis, e => e.monthly_cost)))}${kpi('Manual loans', loans.length)}${kpi('Est. outstanding', inr(sum(loans, l => l.outstanding)), 'estimate')}</div>
  <div class="card"><h3>EMIs detected from bank statements</h3>${emis.length ? `<table><thead><tr><th>Lender</th><th class="n">Monthly EMI</th><th>First seen</th><th>Last payment</th><th>Frequency</th><th>Payments</th></tr></thead><tbody>${emis.map(e => `<tr><td><b>${esc(e.merchant)}</b></td><td class="n">${inr(e.amount, 2)}</td><td>${fmtDate(e.first_payment)}</td><td>${fmtDate(e.last_payment)}</td><td>${e.frequency}</td><td>${e.occurrences}</td></tr>`).join('')}</tbody></table>` : '<div class="mute">No EMIs detected in your bank statements.</div>'}</div>
  <div class="grid g2" style="margin-top:16px"><div class="card"><h3>Manual loans (estimates)</h3>${loans.length ? loans.map((l, i) => `<div style="padding:10px 0;border-bottom:1px solid var(--line)"><div class="row" style="align-items:center"><b style="flex:3">${esc(l.name)}</b><button class="btn sm ghost" style="flex:0;min-width:0" data-action="del-loan" data-i="${i}">✕</button></div>
    <div class="prog" style="margin:8px 0"><span style="width:${Math.min(100, l.paidInstallments / l.tenure * 100)}%"></span></div>
    <table><tr><td>EMI</td><td class="n">${inr(l.emi, 2)}</td><td>Outstanding*</td><td class="n"><b>${inr(l.outstanding)}</b></td></tr><tr><td>Principal repaid*</td><td class="n">${inr(l.principalPaid)}</td><td>Interest paid*</td><td class="n">${inr(l.interestPaid)}</td></tr><tr><td>Remaining tenure</td><td class="n">${l.remainingTenure} months</td><td>Total interest*</td><td class="n">${inr(l.totalInterest)}</td></tr></table></div>`).join('') + '<p class="mute" style="font-size:12px">* Estimates using standard reducing-balance amortisation.</p>' : '<div class="mute">Add a loan to see principal / interest split.</div>'}</div>
  <div class="card"><h3>Add loan</h3><form class="form" data-form="loan"><label>Name<input type="text" name="name" maxlength="60" required placeholder="e.g. Car Loan"></label>
    <div class="row"><label>Loan amount (₹)<input type="number" name="principal" min="1" required></label><label>Interest rate (% p.a.)<input type="number" name="rate" step="0.01" min="0" max="60" required></label></div>
    <div class="row"><label>Tenure (months)<input type="number" name="tenure" min="1" max="600" required></label><label>EMI (₹, optional)<input type="number" name="emi" min="0"></label></div>
    <label>Start date<input type="date" name="start" required></label><button class="btn">Add loan</button></form></div></div>`;
};

VIEWS.cards = () => {
  const c = ctx(), cards = S.state.accounts.filter(a => a.account_type === 'Credit Card');
  const info = id => S.state.creditCards.find(x => x.account_id === id) || {};
  const cardLoans = (S.state.loanAccounts || []).filter(l => l.kind === 'emi_table');
  return header('Credit Cards') + (cards.length ? '' : '<div class="alert">Upload a credit-card statement (Account type: Credit Card) to track card spending. Card bill payments from your bank account are then excluded from expenses automatically, so they are not counted twice.</div>') +
  (cardLoans.length ? `<div class="alert">Card loans on your cards: ${cardLoans.map(l => `<b>${esc(l.product)}</b> EMI ${inr(l.currentEmi)}/month, outstanding ${inr(l.outstanding)}`).join(' · ')} · <a href="#/loans">details →</a></div>` : '') +
  `<div class="grid g2">${cards.map(a => { const i = info(a.id); const tx = scoped().filter(t => t.account_id === a.id); const spend = sum(tx.filter(t => A.isExpense(t, c)), t => t.debit);
    const avail = i.limit ? i.limit - (i.outstanding || 0) : null;
    return `<div class="card"><h3>▭ ${esc(a.nickname)} <span class="r">${esc(a.account_number_masked)}</span></h3>
    <div class="kpis">${kpi('Spend (period)', inr(spend))}${kpi('Credit limit', i.limit ? inr(i.limit) : '—')}${kpi('Outstanding', i.outstanding ? inr(i.outstanding) : '—')}${kpi('Available', avail !== null ? inr(avail) : '—')}${kpi('Payment due', i.paymentDue ? inr(i.paymentDue) : '—')}${kpi('Minimum due', i.minDue ? inr(i.minDue) : '—')}${kpi('Statement date', fmtDate(i.statementDate))}${kpi('Due date', fmtDate(i.dueDate))}</div>
    ${i.limit ? `<div class="prog ${i.outstanding / i.limit > .8 ? 'exceeded' : i.outstanding / i.limit > .5 ? 'nearing' : ''}"><span style="width:${Math.min(100, (i.outstanding || 0) / i.limit * 100)}%"></span></div><div class="mute" style="font-size:12px;margin:4px 0 10px">Utilisation ${((i.outstanding || 0) / i.limit * 100).toFixed(0)}%</div>` : ''}
    <details><summary class="mute" style="cursor:pointer">Update card details from your statement</summary><form class="form" data-form="card" data-id="${a.id}" style="margin-top:10px">
      <div class="row"><label>Credit limit<input type="number" name="limit" value="${esc(i.limit || '')}"></label><label>Current outstanding<input type="number" name="outstanding" value="${esc(i.outstanding || '')}"></label></div>
      <div class="row"><label>Payment due<input type="number" name="paymentDue" value="${esc(i.paymentDue || '')}"></label><label>Minimum due<input type="number" name="minDue" value="${esc(i.minDue || '')}"></label></div>
      <div class="row"><label>Statement date<input type="date" name="statementDate" value="${esc(i.statementDate || '')}"></label><label>Due date<input type="date" name="dueDate" value="${esc(i.dueDate || '')}"></label></div><button class="btn">Save</button></form></details>
    <h3 style="margin-top:14px">Top categories</h3>${bars(A.byCategory(tx, c).slice(0, 6), { horizontal: true, drill: 'category' })}</div>`; }).join('')}</div>`;
};

VIEWS.cashflow = () => {
  const c = ctx(), cf = A.cashFlow(scoped(), c, S.state.accounts.filter(a => S.f.account === 'All' || a.id === S.f.account).filter(a => S.f.bank === 'All' || a.bank_name === S.f.bank));
  const t = { income: sum(cf, r => r.income), expenses: sum(cf, r => r.expenses), transfers: sum(cf, r => r.transfers), investments: sum(cf, r => r.investments) };
  return header('Cash Flow') + `<div class="kpis">${kpi('Opening balance', cf[0] ? inr(cf[0].opening) : '—')}${kpi('Income', inr(t.income))}${kpi('Expenses', inr(t.expenses))}${kpi('Internal transfers', inr(t.transfers))}${kpi('Investments', inr(t.investments))}${kpi('Closing balance', cf.length ? inr(cf[cf.length - 1].closing) : '—', '', 'hero')}</div>
  <div class="card"><h3>Monthly cash flow</h3>${lines([{ name: 'Income', color: '#10B981', values: cf.map(r => r.income) }, { name: 'Expenses', color: '#EF4444', values: cf.map(r => r.expenses) }, { name: 'Closing balance', color: '#4F46E5', values: cf.map(r => r.closing) }], cf.map(r => monthName(r.month)))}</div>
  <div class="card" style="margin-top:16px"><div class="tbl"><table><thead><tr><th>Month</th><th class="n">Opening</th><th class="n">Income</th><th class="n">Expenses</th><th class="n">Transfers</th><th class="n">Investments</th><th class="n">Closing</th><th class="n">Net</th></tr></thead><tbody>
  ${cf.map(r => `<tr><td>${monthName(r.month)}</td><td class="n">${inr(r.opening)}</td><td class="n pos">${inr(r.income)}</td><td class="n neg">${inr(r.expenses)}</td><td class="n">${inr(r.transfers)}</td><td class="n">${inr(r.investments)}</td><td class="n"><b>${inr(r.closing)}</b></td><td class="n ${r.income - r.expenses >= 0 ? 'pos' : 'neg'}">${inr(r.income - r.expenses)}</td></tr>`).join('')}</tbody></table></div>
  <p class="mute" style="font-size:12px">Opening/closing balances come from statement running balances (bank accounts only).</p></div>`;
};

const NW_TYPES = { asset: ['Bank Balance', 'Cash', 'FD', 'RD', 'Mutual Funds', 'Stocks', 'NPS', 'PPF/EPF', 'Gold', 'Property', 'Other Asset'], liability: ['Home Loan', 'Car Loan', 'Personal Loan', 'Education Loan', 'Credit Card Outstanding', 'Credit Card Loan', 'Other Liability'] };
VIEWS.networth = () => {
  const items = S.state.netWorthItems, nw = A.netWorth(items), hist = S.state.netWorthHistory;
  return header('Net Worth', { filters: false }) + `<div class="kpis">${kpi('Assets', inr(nw.assets))}${kpi('Liabilities', inr(nw.liabilities))}${kpi('Net worth', inr(nw.netWorth), '', 'hero')}</div>
  <div class="grid g2"><div class="card"><h3>Assets & liabilities <button class="btn sm ghost" data-action="nw-prefill" style="margin-left:auto">Add bank balances & loans from statements</button></h3>
  ${items.length ? `<table>${items.map((i, ix) => `<tr><td><span class="pill ${i.kind === 'asset' ? 'g' : 'b'}">${esc(i.type)}</span></td><td>${esc(i.name)}</td><td class="n ${i.kind === 'asset' ? 'pos' : 'neg'}">${inr(i.value)}</td><td><button class="btn sm ghost" data-action="del-nw" data-i="${ix}">✕</button></td></tr>`).join('')}</table>` : '<div class="mute">Add your assets and liabilities.</div>'}
  <form class="form" data-form="nw" style="margin-top:14px"><div class="row"><label>Type<select name="type">${Object.entries(NW_TYPES).map(([k, v]) => `<optgroup label="${k === 'asset' ? 'Assets' : 'Liabilities'}">${v.map(t => `<option value="${k}|${t}">${t}</option>`).join('')}</optgroup>`).join('')}</select></label><label>Name<input type="text" name="name" maxlength="60" required></label><label>Value (₹)<input type="number" name="value" min="0" required></label></div><button class="btn">Add</button></form></div>
  <div class="card"><h3>Net worth trend <button class="btn sm ghost" data-action="nw-snapshot" style="margin-left:auto">Save this month's snapshot</button></h3>${hist.length ? lines([{ name: 'Net worth', color: '#4F46E5', values: hist.map(h => h.netWorth) }, { name: 'Assets', color: '#10B981', values: hist.map(h => h.assets) }, { name: 'Liabilities', color: '#EF4444', values: hist.map(h => h.liabilities) }], hist.map(h => monthName(h.month))) : '<div class="mute">Save a snapshot each month to build your trend.</div>'}</div></div>`;
};

VIEWS.calendar = () => {
  const base = S.calMonth || today().slice(0, 7);
  const [y, m] = base.split('-').map(Number); const first = new Date(Date.UTC(y, m - 1, 1)); const lead = (first.getUTCDay() + 6) % 7;
  const start = addDays(first.toISOString().slice(0, 10), -lead);
  const ev = A.calendarEvents(S.state, start, 42);
  const cells = [...Array(42)].map((_, i) => { const d = addDays(start, i); const e = ev.filter(x => x.date === d);
    return `<div class="d ${d.slice(0, 7) !== base ? 'o' : ''} ${d === today() ? 't' : ''}"><b>${+d.slice(8)}</b>${e.map(x => `<span class="ev" title="${esc(x.title)} ${x.amount ? inr(x.amount) : ''}">${esc(x.title)}${x.amount ? ' ' + inr(x.amount) : ''}</span>`).join('')}</div>`; }).join('');
  const nav = d => new Date(Date.UTC(y, m - 1 + d, 1)).toISOString().slice(0, 7);
  return header('Financial Calendar', { filters: false }) + `<div class="card"><h3><button class="btn sm ghost" data-action="cal" data-m="${nav(-1)}">‹</button> ${monthName(base)} <button class="btn sm ghost" data-action="cal" data-m="${nav(1)}">›</button><span class="r">EMIs · loans · subscriptions · bills · SIPs · salary · card dues</span></h3>
  <div class="cal">${['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(d => `<div class="mute" style="text-align:center;font-size:11px">${d}</div>`).join('')}${cells}</div>
  <p class="mute" style="font-size:12px">Dates are projected from detected recurring patterns and loan schedules, and may shift by a few days.</p></div>`;
};

VIEWS.accounts = () => {
  const c = ctx(), sm = A.accountSummary(S.state, c), all = A.kpis(S.state.transactions, c);
  const reg = new Map((S.state.statementRegistry || []).map(r => [r.importId, r]));
  return header('Accounts & Statements', { filters: false, extra: '<a class="btn" href="#/upload">+ Add statement</a>' }) + `<div class="kpis">${kpi('Bank / card accounts', sm.length)}${kpi('Loans', (S.state.loanAccounts || []).length)}${kpi('Combined balance', inr(sum(sm.filter(a => a.account_type !== 'Credit Card' && a.balance !== null), a => a.balance)), '', 'hero')}${kpi('Total income', inr(all.income))}${kpi('Total expenses', inr(all.expenses))}</div>
  <div class="grid g3">${sm.map(a => `<div class="card"><h3>▤ ${esc(a.nickname)} <span class="r">${esc(a.account_type)}</span></h3><div class="mute">${esc(a.account_number_masked)}</div>
  <table style="margin-top:10px"><tr><td>Current balance</td><td class="n"><b>${a.balance !== null && a.account_type !== 'Credit Card' ? inr(a.balance, 2) : '—'}</b></td></tr><tr><td>Last transaction</td><td class="n">${fmtDate(a.lastDate)}</td></tr><tr><td>Total income</td><td class="n pos">${inr(a.income)}</td></tr><tr><td>Total expenses</td><td class="n neg">${inr(a.expenses)}</td></tr><tr><td>Avg monthly spending</td><td class="n">${inr(a.monthlySpend)}</td></tr><tr><td>Transactions</td><td class="n">${a.count}</td></tr></table>
  <button class="btn sm ghost" style="margin-top:10px" data-action="filter-account" data-id="${a.id}">View dashboard for this account</button></div>`).join('')}</div>
  <div class="card" style="margin-top:16px"><h3>Statement library <span class="r">${cloudOn() ? '☁ originals stored in your private cloud' : 'sign in to Cloud Sync to keep originals'}</span></h3>
  <p class="mute" style="margin-top:0">Every imported file is fingerprinted (SHA-256). Uploading the same file again is blocked, because its data is already saved${cloudOn() ? ' and synced to all your devices' : ''}.</p>
  ${S.state.imports.length ? `<div class="tbl"><table><thead><tr><th>File</th><th>Type</th><th>Bank</th><th class="hide-m">Period</th><th class="n">Rows</th><th class="hide-m">Imported</th><th></th></tr></thead><tbody>${[...S.state.imports].reverse().map(i => { const r = reg.get(i.id); return `<tr><td>${esc(i.fileName)} ${r?.cloudPath ? '<span class="pill g">☁ saved</span>' : ''}</td><td><span class="pill ${i.type === 'loan' ? 'w' : ''}">${i.type === 'loan' ? (i.loanKind === 'emi_table' ? 'Card loan' : 'Loan') : 'Bank/Card'}</span></td><td>${esc(i.bank)}</td><td class="hide-m">${fmtDate(i.from)} – ${fmtDate(i.to)}</td><td class="n">${i.processed}</td><td class="hide-m">${new Date(i.at).toLocaleDateString('en-IN')}</td><td style="white-space:nowrap">${r?.cloudPath && cloudOn() ? `<button class="btn sm ghost" data-action="dl-original" data-path="${esc(r.cloudPath)}" data-name="${esc(i.fileName)}">⬇</button> ` : ''}<button class="btn sm danger" data-action="del-import" data-id="${i.id}">Delete</button></td></tr>`; }).join('')}</tbody></table></div>` : '<div class="mute">None yet.</div>'}</div>`;
};

VIEWS.review = () => {
  const list = S.state.transactions.filter(t => t.review_flags?.length).sort((a, b) => b.amount - a.amount);
  const groups = {}; list.forEach(t => t.review_flags.forEach(f => (groups[f] = (groups[f] || 0) + 1)));
  const act = t => `<div style="display:flex;gap:4px;flex-wrap:wrap" class="no-print">
    <button class="btn sm ok" data-action="rv" data-op="approve" data-id="${t.transaction_id}" title="Approve">✓</button>
    <button class="btn sm ghost" data-action="edit-tx" data-id="${t.transaction_id}">Edit</button>
    <button class="btn sm ghost" data-action="rv" data-op="${t.is_transfer ? 'notTransfer' : 'markTransfer'}" data-id="${t.transaction_id}">${t.is_transfer ? 'Not transfer' : 'Transfer'}</button>
    ${t.is_duplicate || t.possible_duplicate ? `<button class="btn sm ghost" data-action="rv" data-op="notDuplicate" data-id="${t.transaction_id}">Not dup</button>` : ''}
    <button class="btn sm ghost" data-action="rv" data-op="ignore" data-id="${t.transaction_id}">Ignore</button></div>`;
  return header('Transactions requiring review', { filters: false }) + `<div class="kpis">${Object.entries(groups).map(([k, v]) => kpi(k, v)).join('') || kpi('All clear', '✓')}</div>
  <div class="card"><p class="mute" style="margin-top:0">Corrections are remembered for future transactions from the same merchant / UPI ID. Unusual transactions are flagged for your review only. They are <b>not</b> labelled as fraud.</p>
  ${list.length ? `<div class="tbl"><table><thead><tr><th>Date</th><th>Transaction</th><th>Why</th><th class="n">Amount</th><th></th></tr></thead><tbody>${list.slice(0, 200).map(t => `<tr><td style="white-space:nowrap">${fmtDate(t.transaction_date)}</td><td><b>${esc(t.merchant)}</b> <span class="pill">${esc(t.category)}</span><div class="desc">${esc(t.description)}</div></td><td>${t.review_flags.map(f => `<span class="pill w">${esc(f)}</span>`).join(' ')}${t.anomaly ? `<div class="desc">${esc(t.anomaly)}</div>` : ''}</td><td class="n">${t.credit ? '+' : '−'}${inr(t.amount, 2)}</td><td>${act(t)}</td></tr>`).join('')}</tbody></table></div>` : '<div class="empty-chart">🎉 Nothing to review</div>'}</div>`;
};

VIEWS.assistant = () => header('Ask MoneyLens', { filters: false }) + `<div class="card">
  <p class="mute" style="margin-top:0">Answers are computed only from your imported data, with the source transactions shown.</p>
  <div class="chips" style="margin-bottom:12px">${['How much did I spend on food last month?', 'Show my top 10 merchants', 'Compare HDFC and SBI spending', 'How much did I spend on UPI?', 'What were my biggest expenses last month?', 'How much do I spend on subscriptions?', 'Show transactions above ₹10,000', 'Show my loans'].map(q => `<button class="chip" data-action="ask" data-q="${esc(q)}">${esc(q)}</button>`).join('')}</div>
  <div class="chat" id="chat">${S.chat.map(m => `<div class="msg ${m.role}">${esc(m.text)}</div>${m.sources?.length ? `<details style="align-self:stretch"><summary class="mute" style="cursor:pointer">Source transactions (${m.sources.length})</summary>${txTable(m.sources, { limit: 25 })}</details>` : ''}`).join('')}</div>
  <form class="row" data-form="ask" style="margin-top:12px"><input type="text" name="q" placeholder="Ask about your spending…" maxlength="200" style="flex:4" autocomplete="off"><button class="btn" style="flex:0">Ask</button></form></div>`;

const REPORTS = { monthly: 'Monthly Expense Report', annual: 'Annual Expense Report', category: 'Category Report', bank: 'Bank-wise Report', merchant: 'Merchant Report', transactions: 'Transaction Report' };
VIEWS.reports = () => {
  const r = S.report || 'monthly'; const c = ctx(); const m = S.reportMonth || curMonth(); const y = m.slice(0, 4);
  const months = [...new Set(S.state.transactions.map(t => monthKey(t.transaction_date)))].sort().reverse();
  const tx = r === 'annual' ? S.state.transactions.filter(t => t.transaction_date.startsWith(y)) : r === 'monthly' ? S.state.transactions.filter(t => t.transaction_date.startsWith(m)) : scoped();
  const k = A.kpis(tx, c); let body = '';
  if (r === 'monthly') body = `<div class="kpis">${kpi('Income', inr(k.income))}${kpi('Expenses', inr(k.expenses))}${kpi('Savings', inr(k.savings))}${kpi('Savings rate', k.savingsRate.toFixed(1) + '%')}${kpi('Investments', inr(k.investments))}${kpi('EMIs', inr(k.emis))}${kpi('Subscriptions', inr(k.subscriptions))}${kpi('Transfers (excluded)', inr(k.transfers))}</div>
    <div class="grid g2"><div class="card"><h3>Top categories</h3>${bars(A.byCategory(tx, c).slice(0, 8), { horizontal: true })}</div><div class="card"><h3>Top merchants</h3>${bars(A.byMerchant(tx, c).slice(0, 8), { horizontal: true })}</div></div>
    <div class="card" style="margin-top:16px"><h3>Unusual transactions</h3>${txTable(tx.filter(t => t.anomaly), { limit: 20 })}</div>`;
  else if (r === 'annual') { const ms = A.monthly(tx, c); body = `<div class="kpis">${kpi('Income ' + y, inr(k.income))}${kpi('Expenses', inr(k.expenses))}${kpi('Savings', inr(k.savings))}${kpi('Savings rate', k.savingsRate.toFixed(1) + '%')}</div><div class="card">${lines([{ name: 'Income', color: '#10B981', values: ms.map(x => x.income) }, { name: 'Expenses', color: '#EF4444', values: ms.map(x => x.expenses) }, { name: 'Savings', color: '#4F46E5', values: ms.map(x => x.savings) }], ms.map(x => monthName(x.month)))}
    <table><thead><tr><th>Month</th><th class="n">Income</th><th class="n">Expenses</th><th class="n">Savings</th><th class="n">Rate</th></tr></thead>${ms.map(x => `<tr><td>${monthName(x.month)}</td><td class="n">${inr(x.income)}</td><td class="n">${inr(x.expenses)}</td><td class="n">${inr(x.savings)}</td><td class="n">${x.savingsRate.toFixed(1)}%</td></tr>`).join('')}</table></div>
    <div class="grid g2" style="margin-top:16px"><div class="card"><h3>Categories</h3>${bars(A.byCategory(tx, c), { horizontal: true })}</div><div class="card"><h3>Bank comparison</h3>${bars(A.byBank(tx, c), { horizontal: true })}</div></div>`; }
  else if (r === 'category') body = `<div class="card"><table><thead><tr><th>Category</th><th class="n">Transactions</th><th class="n">Amount</th><th class="n">Share</th></tr></thead>${A.byCategory(tx, c).map(e => `<tr><td>${esc(e.key)}</td><td class="n">${e.count}</td><td class="n">${inr(e.value)}</td><td class="n">${(e.value / ((k.expenses + k.refunds) || 1) * 100).toFixed(1)}%</td></tr>`).join('')}</table></div>`;
  else if (r === 'bank') body = `<div class="card"><table><thead><tr><th>Bank</th><th class="n">Income</th><th class="n">Expenses</th><th class="n">Transactions</th></tr></thead>${[...new Set(tx.map(t => t.bank_name))].map(b => { const bk = A.kpis(tx.filter(t => t.bank_name === b), c); return `<tr><td>${esc(b)}</td><td class="n">${inr(bk.income)}</td><td class="n">${inr(bk.expenses)}</td><td class="n">${bk.count}</td></tr>`; }).join('')}</table></div>`;
  else if (r === 'merchant') body = `<div class="card"><table><thead><tr><th>Merchant</th><th class="n">Transactions</th><th class="n">Amount</th><th class="n">Average</th></tr></thead>${A.byMerchant(tx, c).slice(0, 100).map(e => `<tr><td>${esc(e.key)}</td><td class="n">${e.count}</td><td class="n">${inr(e.value)}</td><td class="n">${inr(e.value / e.count)}</td></tr>`).join('')}</table></div>`;
  else body = `<div class="card">${txTable([...tx].sort((a, b) => b.transaction_date.localeCompare(a.transaction_date)), { limit: 1000 })}</div>`;
  return header('Reports', { filters: !['monthly', 'annual'].includes(r) }) + `<div class="card no-print" style="margin-bottom:16px"><div class="row">
    <label class="form">Report<select data-action="report">${Object.entries(REPORTS).map(([k2, v]) => `<option value="${k2}" ${k2 === r ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
    ${['monthly', 'annual'].includes(r) ? `<label class="form">${r === 'annual' ? 'Year (pick any month)' : 'Month'}<select data-action="report-month">${months.map(x => `<option value="${x}" ${x === m ? 'selected' : ''}>${monthName(x)}</option>`).join('')}</select></label>` : ''}
    <div style="display:flex;gap:8px;align-items:end;flex-wrap:wrap"><button class="btn ghost" data-action="export-csv">⬇ CSV</button><button class="btn ghost" data-action="export-xlsx">⬇ Excel</button><button class="btn" data-action="print">Print / PDF</button></div></div></div>
  <h2 style="margin:4px 0 12px">${REPORTS[r]} <span class="mute" style="font-size:14px;font-weight:500">${r === 'monthly' ? monthName(m) : r === 'annual' ? y : ''}</span></h2>${body}`;
};

VIEWS.upload = () => {
  const u = S.upload; const steps = ['Uploading', 'Detecting bank format', 'Extracting transactions', 'Normalizing', 'Classifying, detecting duplicates, transfers & recurring payments', 'Finalizing'];
  const cur = steps.indexOf(u.step); const m = u.meta || {}; const R = u.result;
  return header('Upload statement', { filters: false }) + `<div class="grid g2"><div class="card">
  <form class="form" data-form="upload">
    <div class="row"><label>Bank<select name="bank">${[['Auto', 'Auto-detect'], ['HDFC', 'HDFC'], ['SBI', 'SBI'], ['Other', 'Other bank']].map(([v, l]) => `<option value="${v}" ${m.bank === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
    <label>Statement type<select name="accountType">${['Savings', 'Current', 'Credit Card', 'Loan', 'Other'].map(t => `<option ${m.accountType === t ? 'selected' : ''}>${t}</option>`).join('')}</select></label></div>
    <div class="row"><label>Last 4 digits of account / card <span class="mute">(not needed for loans)</span><input type="text" name="last4" inputmode="numeric" pattern="\\d{4}" maxlength="4" placeholder="1234" value="${esc(m.last4 || '')}"></label><label>Nickname (optional)<input type="text" name="nickname" maxlength="40" placeholder="e.g. HDFC Salary" value="${esc(m.nickname || '')}"></label></div>
    ${u.needPassword ? `<label>PDF password <span class="mute">(used only in your browser to open the file; never stored)</span><input type="password" name="pdfpass" autocomplete="off" required></label>` : ''}
    <label class="drop" id="drop"><div class="big">⇪</div><b>Drop your statement here or tap to choose</b><div class="mute">Bank · credit card · home loan · card loan EMI table: PDF · CSV · XLSX · TXT, up to 15 MB</div><input type="file" name="file" accept=".pdf,.csv,.txt,.tsv,.xlsx" hidden><div id="fname" class="mute" style="margin-top:6px"></div></label>
    ${u.dup ? `<label><span><input type="checkbox" name="force"> Import this file again anyway</span></label>` : ''}
    <button class="btn" ${u.busy ? 'disabled' : ''}>${u.busy ? 'Processing…' : 'Process statement'}</button>
  </form>
  ${u.busy || (R && R.type !== 'loan') ? `<div class="steps">${steps.map((s, i) => `<span class="${R || i < cur ? 'done' : i === cur ? 'cur' : ''}">${i + 1}. ${s.split(',')[0]}</span>`).join('')}</div>` : ''}
  ${u.dup ? `<div class="alert warnk"><b>Already imported</b> on ${new Date(u.dup.at).toLocaleString('en-IN')} as “${esc(u.dup.fileName)}”. Its data is already saved${cloudOn() ? ' and synced' : ''}, so you don't need to upload it again.</div>` : ''}
  ${u.error ? `<div class="alert err">${esc(u.error)}</div>` : ''}
  ${R && R.type === 'loan' ? `<div class="alert okk">✅ <b>Loan statement processed:</b> ${esc(R.product)} ${esc(R.accountMasked)} (${esc(R.bank)}).${R.loanKind === 'emi_table' ? ` ${R.emisPaid} EMIs billed, ${R.remainingEmis} remaining, principal outstanding <b>${inr(R.outstanding, 2)}</b>.` : ` ${R.processed} loan entries, ${R.added} new${R.bounces ? `, <b>${R.bounces} EMI bounce(s)</b>` : ''}.`}${R.cloud ? ' ☁ Original saved to cloud.' : ''}</div><div class="row"><a class="btn" href="#/loans">Open Loans →</a></div>` : ''}
  ${R && R.type !== 'loan' ? `<div class="alert okk">✅ <b>${R.processed.toLocaleString('en-IN')} transactions processed</b> from ${esc(R.bank)} (${fmtDate(R.from)} – ${fmtDate(R.to)})${R.cloud ? ' · ☁ original saved to cloud' : ''}</div>
    <div class="result"><div><b>${R.categorized.toLocaleString('en-IN')}</b>successfully categorized</div><div><b>${R.needsReview}</b>need review</div><div><b>${R.duplicates}</b>duplicates found</div><div><b>${R.transfers}</b>internal transfers</div></div>
    <div class="row" style="margin-top:14px">${R.needsReview ? '<a class="btn ghost" href="#/review">Review transactions</a>' : ''}${S.state.budgets.length ? '' : '<a class="btn ghost" href="#/budgets">Set monthly budget</a>'}<a class="btn" href="#/dashboard">Go to dashboard →</a></div>` : ''}
  </div>
  <div class="card"><h3>Supported statements</h3>
    <p><b>HDFC savings</b>: NetBanking → Accounts → Account Statement → <i>Download as Excel / PDF</i>.</p>
    <p><b>HDFC home / plot / top-up loan</b>: NetBanking → Loans → <i>Statement of Account</i> (PDF).</p>
    <p><b>HDFC credit-card loan</b> (Insta Loan / Jumbo Loan): the <i>Loan EMI Table</i> PDF ("Linked loans").</p>
    <p><b>SBI</b>: OnlineSBI / YONO → My Accounts → Account Statement → <i>Download Excel / PDF</i>.</p>
    <p class="mute">Loan PDFs are recognised automatically. You don't have to change "Statement type".</p>
    <div class="alert">🔒 MoneyLens never asks for your net-banking ID, password, OTP, UPI PIN, card PIN or CVV.${cloudOn() ? ' Files you upload are kept in <b>your private cloud folder</b> so you never need to upload them again.' : ' <a href="#/cloud">Turn on Cloud Sync</a> to keep data across devices.'}</div></div></div>`;
};

VIEWS.cloud = () => {
  const c = cloudConfig(); const msg = S.cloudMsg;
  const head = header('☁ Cloud Sync (Supabase)', { filters: false });
  const note = msg ? `<div class="alert ${msg.type === 'err' ? 'err' : 'okk'}">${esc(msg.text)}</div>` : '';
  if (!c.url || !c.key) return head + note + `<div class="grid g2"><div class="card"><h3>Not configured yet</h3>
    <p>Cloud Sync stores your MoneyLens data and original statements in <b>your own free Supabase project</b>, so the laptop and iPhone share the same data and you never re-upload a statement.</p>
    <ol><li>Create a free project at supabase.com</li><li>Run <code>supabase/setup.sql</code> in the SQL editor</li><li>Put the Project URL and anon/publishable key in <code>js/config.js</code> and push to GitHub</li></ol>
    <p class="mute">Full steps: <code>docs/SUPABASE_SETUP.md</code></p></div>
    <div class="card"><h3>Quick test on this device only</h3><form class="form" data-form="cloud-cfg"><label>Project URL<input type="text" name="url" placeholder="https://xxxx.supabase.co" required></label><label>anon / publishable key<input type="text" name="key" placeholder="eyJ… or sb_publishable_…" required></label><button class="btn">Save on this device</button></form>
    <p class="mute" style="font-size:12px">Saved only in this browser. For all devices, edit js/config.js instead.</p></div></div>`;
  if (!S.cloud) return head + note + `<div class="alert err">${esc(S.sync.msg)}</div>${c.fromFile ? '' : '<button class="btn ghost" data-action="cloud-reset-cfg">Clear device cloud settings</button>'}`;
  if (!S.cloud.signedIn) return head + note + `<div class="grid g2"><div class="card"><h3>Sign in or create your cloud account</h3>
    <form class="form" data-form="cloud-auth"><label>Email<input type="email" name="email" autocomplete="username" required></label><label>Password (min 8 characters)<input type="password" name="password" minlength="8" autocomplete="current-password" required></label>
    <div class="row"><button class="btn" name="op" value="signin">Sign in</button><button class="btn ghost" name="op" value="signup">Create account</button></div></form>
    <a href="#" data-action="cloud-forgot" class="mute" style="font-size:12px;display:inline-block;margin-top:10px">Forgot password?</a></div>
    <div class="card"><h3>What gets synced</h3><ul><li>All imported transactions, loans, budgets, corrections, net worth, settings</li><li>Original statement files (private storage, only you can read them)</li></ul><p class="mute">This is a MoneyLens login for <b>your</b> Supabase project, never your bank password.</p>${c.fromFile ? '' : '<button class="btn sm ghost" data-action="cloud-reset-cfg">Clear device cloud settings</button>'}</div></div>`;
  const reg = S.state.statementRegistry || [];
  return head + note + `<div class="kpis">${kpi('Signed in as', esc(S.cloud.user?.email || ''))}${kpi('Status', esc(S.sync.msg || ''), S.sync.at ? 'last ' + S.sync.at.toLocaleTimeString('en-IN') : '')}${kpi('Statements on record', reg.length)}${kpi('Originals in cloud', reg.filter(r => r.cloudPath).length)}</div>
  <div class="grid g2"><div class="card"><h3>Sync</h3><p class="mute">Changes upload automatically about 2 seconds after each edit. When you open MoneyLens on another device, the newest copy loads automatically.</p>
    <div class="row"><button class="btn" data-action="cloud-sync">⟳ Sync now</button><button class="btn ghost" data-action="cloud-push">⇪ Upload this device's data (overwrite cloud)</button></div>
    <label style="display:block;margin-top:14px"><input type="checkbox" data-action="keep-originals" ${S.state.settings.keepOriginals === false ? '' : 'checked'}> Keep original statement files in the cloud</label></div>
  <div class="card"><h3>Account</h3><div class="row"><button class="btn ghost" data-action="cloud-signout">Sign out on this device</button><button class="btn danger" data-action="cloud-delete">Delete ALL cloud data</button></div>
    <p class="mute" style="font-size:12px">Signing out keeps a local copy on this device. Deleting cloud data removes your synced data and stored statement files from Supabase.</p></div></div>`;
};

VIEWS.connect = () => `${header('Connect bank via Account Aggregator', { filters: false })}<div class="grid g2"><div class="card">
  <h3>Consent-based connection (RBI Account Aggregator)</h3>
  <p>Account Aggregators let you share bank statements digitally with your explicit, revocable consent. No passwords are shared with MoneyLens. Live AA access requires a regulated partner and a secure backend, so this edition ships a <b>mock provider</b> for testing the flow with synthetic data.</p>
  <button class="btn" data-action="aa-mock">Run mock AA consent (synthetic data)</button></div>
  <div class="card"><h3>Prefer statements?</h3><p>Uploading HDFC/SBI bank, card and loan statements works today.</p><a class="btn ghost" href="#/upload">Upload statement</a></div></div>`;

VIEWS.settings = () => {
  const st = { ...S.state.settings };
  return header('Settings & Privacy', { filters: false }) + `<div class="grid g2">
  <div class="card"><h3>Appearance</h3><button class="btn ghost" data-action="theme">Toggle light / dark mode</button><p class="mute" style="font-size:12px">MoneyLens v${APP_VERSION}</p></div>
  <div class="card"><h3>🔐 App lock</h3><p class="mute">Encrypt your data on this device with a passcode (AES-256-GCM). If you forget it, data on this device cannot be recovered. If Cloud Sync is on, you can delete local data and sign in again.</p>
    ${store.hasPasscode() ? '<button class="btn ghost" data-action="lock">Lock now</button> <button class="btn ghost" data-action="rm-pass">Remove passcode</button>' : '<form class="row" data-form="pass"><input type="password" name="p1" placeholder="New passcode (6+ chars)" minlength="6" required autocomplete="new-password"><input type="password" name="p2" placeholder="Confirm" minlength="6" required autocomplete="new-password"><button class="btn" style="flex:0">Set</button></form>'}</div>
  <div class="card"><h3>Financial rules</h3><form class="form" data-form="settings">
    <label>Your name(s) as they appear in narrations (comma-separated). Helps detect own-account transfers<input type="text" name="selfNames" value="${esc((st.selfNames || []).join(', '))}" maxlength="120"></label>
    <label><span><input type="checkbox" name="excludeCcPaymentIfCardImported" ${st.excludeCcPaymentIfCardImported !== false ? 'checked' : ''}> Exclude credit-card bill payments from expenses when card statements are imported</span></label>
    <label><span><input type="checkbox" name="excludeRefundsFromIncome" ${st.excludeRefundsFromIncome !== false ? 'checked' : ''}> Treat refunds as reduced spending (not income)</span></label>
    <div class="row"><label>Transfer match window (days)<input type="number" name="transferWindowDays" min="0" max="10" value="${st.transferWindowDays ?? 3}"></label><label>Large cash withdrawal (₹)<input type="number" name="largeCashThreshold" min="0" value="${st.largeCashThreshold ?? 20000}"></label></div>
    <button class="btn">Save & recalculate</button></form></div>
  <div class="card"><h3>Your data</h3><p class="mute">${cloudOn() ? 'Stored in this browser and synced to your private Supabase cloud.' : 'Stored only in this browser. Turn on <a href="#/cloud">Cloud Sync</a> or export a backup.'}</p>
    <div class="row"><button class="btn ghost" data-action="backup">⬇ Export all my data (JSON)</button><label class="btn ghost" style="justify-content:center">⇪ Restore backup<input type="file" accept=".json" data-action="restore" hidden></label></div>
    <hr style="border:0;border-top:1px solid var(--line);margin:16px 0"><h3 class="neg">Delete</h3><p class="mute">Delete individual statements from <a href="#/accounts">Accounts & Statements</a>, or erase everything on this device:</p><button class="btn danger" data-action="wipe">Delete all data on this device</button></div>
  <div class="card"><h3>Legal</h3><a href="#/privacy">Privacy Policy</a> · <a href="#/terms">Terms of Service</a></div></div>`;
};

VIEWS.admin = () => {
  const imp = S.state.imports, tx = S.state.transactions;
  return header('Diagnostics', { filters: false }) + `<div class="kpis">${kpi('Version', 'v' + APP_VERSION)}${kpi('Imports', imp.length)}${kpi('Transactions', tx.length.toLocaleString('en-IN'))}${kpi('Loans', (S.state.loanAccounts || []).length)}${kpi('Flagged for review', reviewCount())}${kpi('Errors', (S.state.errors || []).length)}${kpi('Cloud', esc(S.sync.status))}</div>
  <div class="card"><h3>Import status</h3><p class="mute" style="margin-top:0">No financial values are shown here.</p><div class="tbl"><table><thead><tr><th>Import</th><th>Status</th><th>Parser</th><th>Detected</th><th class="n">Rows</th><th class="n">Review</th><th class="n">Time</th></tr></thead>${imp.map(i => `<tr><td>${esc(i.id)}</td><td><span class="pill g">${esc(i.status)}</span></td><td>${esc(i.type || 'bank')} / ${esc(i.loanKind || i.kind)} / ${esc(i.bank)}</td><td>${esc(i.detectedBank)}</td><td class="n">${i.processed}</td><td class="n">${i.needsReview}</td><td class="n">${i.ms} ms</td></tr>`).join('')}</table></div></div>
  <div class="card" style="margin-top:16px"><h3>Errors</h3><table>${(S.state.errors || []).slice(-30).reverse().map(e => `<tr><td>${esc(e.at)}</td><td>${esc(e.code)}</td><td>${esc(e.message)}</td></tr>`).join('') || '<tr><td class="mute">None</td></tr>'}</table></div>
  <div class="card" style="margin-top:16px"><h3>Audit log</h3><div class="tbl" style="max-height:300px"><table>${S.state.audit.slice(-100).reverse().map(a => `<tr><td>${esc(a.at)}</td><td>${esc(a.action)}</td><td class="mute">${esc(Object.entries(a).filter(([k]) => !['at', 'action'].includes(k)).map(([k, v]) => k + '=' + v).join(' '))}</td></tr>`).join('')}</table></div></div>`;
};

VIEWS.privacy = () => header('Privacy Policy & Data Deletion', { filters: false }) + `<div class="card" style="max-width:820px;line-height:1.65">
  <p><b>Summary:</b> MoneyLens processes statements in your browser. By default, data is stored only on your device. If you turn on Cloud Sync, data and original statement files are stored in <b>your own Supabase project</b>, protected by Row Level Security so only your signed-in account can read them.</p>
  <h3>What we never ask for</h3><p>Net-banking user IDs or passwords, OTPs, UPI PINs, debit-card PINs or CVVs. PDF statement passwords are used only in memory to open the file and are never stored.</p>
  <h3>What is stored</h3><p>Transactions, loan summaries and EMI schedules, budgets, corrections, settings. Only the last 4 digits of account/loan numbers are kept. Borrower name, address and CKYC number in loan statements are not extracted.</p>
  <h3>Your rights & data deletion</h3><p>Export everything from Settings. Delete a single statement from Accounts & Statements, erase everything on this device from Settings, and erase your cloud copy from Cloud Sync → Delete ALL cloud data.</p></div>`;
VIEWS.terms = () => header('Terms of Service', { filters: false }) + `<div class="card" style="max-width:820px;line-height:1.65">
  <p>MoneyLens India is free, open-source software provided "as is" under the MIT License, without warranty of any kind.</p>
  <h3>Not financial advice</h3><p>Insights, categories, loan estimates and anomaly flags are automated, may be inaccurate, and are for information only. Verify important figures with your bank.</p>
  <h3>Trademarks</h3><p>HDFC Bank, SBI and other bank names are trademarks of their owners and are used only to identify statement formats. MoneyLens is not affiliated with any bank.</p></div>`;

/* ----------------------------- modals ----------------------------- */
function modal(html) { closeModal(); const m = document.createElement('div'); m.className = 'modal-bg'; m.id = 'modal'; m.innerHTML = `<div class="modal" role="dialog" aria-modal="true">${html}</div>`; document.body.appendChild(m); }
function closeModal() { document.getElementById('modal')?.remove(); }
function editTx(id) {
  const t = S.state.transactions.find(x => x.transaction_id === id); if (!t) return;
  modal(`<h2>Edit transaction</h2><div class="mute" style="margin-bottom:10px">${fmtDate(t.transaction_date)} · ${esc(t.bank_name)} ${esc(t.account_number_masked)} · <b>${t.credit ? '+' : '−'}${inr(t.amount, 2)}</b></div>
  <div class="alert" style="font-size:12px;word-break:break-word">${esc(t.description)}${t.upi_id ? `<br>UPI ID: <b>${esc(t.upi_id)}</b>` : ''}${t.reference_number ? `<br>Ref: ${esc(t.reference_number)}` : ''}<br>Mode: ${esc(t.payment_mode)} · Confidence ${(t.confidence_score * 100).toFixed(0)}%</div>
  <form class="form" data-form="edit-tx" data-id="${t.transaction_id}">
    <label>Merchant<input type="text" name="merchant" value="${esc(t.merchant)}" maxlength="60"></label>
    <div class="row"><label>Category<select name="category" data-action="cat-change">${catOptions(t.category)}</select></label><label>Subcategory<select name="subcategory">${subOptions(t.category, t.subcategory)}</select></label></div>
    <label><span><input type="checkbox" name="transfer" ${t.is_transfer ? 'checked' : ''}> This is a transfer between my own accounts</span></label>
    <label><span><input type="checkbox" name="ignore" ${t.excluded ? 'checked' : ''}> Ignore this transaction in all calculations</span></label>
    <div class="row"><button class="btn" type="submit">Save & learn</button><button class="btn ghost" type="button" data-action="close">Cancel</button></div></form>`);
}

/* ----------------------------- actions ----------------------------- */
const bankRows = rows => [['Date', 'Narration', 'Ref', 'Withdrawal', 'Deposit', 'Balance'], ...rows.map(r => [r.date, r.description, r.reference, r.debit || '', r.credit || '', r.balance ?? ''])];
async function loadDemo() {
  const d = generateDemo(demoEnd()); const st = emptyState();
  const add = (rows, bank, type, last4, nick) => ingest(st, { kind: 'csv', rows: bankRows(rows), fileName: `demo-${bank}-${type}.csv`, bank, accountType: type, last4, nickname: nick });
  add(d.HDFC, 'HDFC', 'Savings', '1234', 'HDFC Savings'); add(d.SBI, 'SBI', 'Savings', '9876', 'SBI Savings'); add(d.CARD, 'HDFC', 'Credit Card', '4321', 'HDFC Credit Card');
  ingestLoan(st, { kind: 'pdf', lines: demoLoanLines(), fileName: 'demo-home-loan.pdf', bank: 'Auto' });
  ingestLoan(st, { kind: 'pdf', lines: demoCardLoanLines().lines, fileName: 'demo-card-loan.pdf', bank: 'Auto' });
  st.loanAccounts.find(l => l.kind === 'soa').firstEmiDate = addDays(today(), -365 * 3);
  st.demo = true;
  st.budgets = [['Food & Dining', 10000], ['Transport', 5000], ['Shopping', 8000], ['Entertainment', 3000], ['Bills & Utilities', 15000]].map(([category, amount]) => ({ category, amount }));
  const cardAcc = st.accounts.find(a => a.account_type === 'Credit Card');
  st.creditCards = [{ account_id: cardAcc.id, limit: 200000, outstanding: 11240, paymentDue: 11240, minDue: 562, statementDate: addDays(today(), -8), dueDate: addDays(today(), 12) }];
  st.netWorthItems = [{ kind: 'asset', type: 'Mutual Funds', name: 'Equity MFs', value: 640000 }, { kind: 'asset', type: 'FD', name: 'SBI FD', value: 300000 }, { kind: 'asset', type: 'Gold', name: 'Gold', value: 150000 }, { kind: 'liability', type: 'Home Loan', name: 'Demo Home Loan', value: 1380000 }];
  st.netWorthHistory = [...Array(6)].map((_, i) => { const m = new Date(); m.setMonth(m.getMonth() - 5 + i); return { month: m.toISOString().slice(0, 7), assets: 1500000 + i * 42000, liabilities: 1440000 - i * 12000, netWorth: 60000 + i * 54000 }; });
  S.state = st; S.f = { period: 'this_month', bank: 'All', account: 'All', from: '', to: '' }; await store.save(st); location.hash = '#/dashboard'; render();
}

const CT = { pdf: 'application/pdf', csv: 'text/csv', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' };
async function processFile(form) {
  const fd = new FormData(form); const file = fd.get('file');
  const meta = { bank: fd.get('bank'), accountType: fd.get('accountType'), last4: String(fd.get('last4') || ''), nickname: String(fd.get('nickname') || '').slice(0, 40) };
  if (!file || !file.size) { S.upload = { ...S.upload, error: 'Please choose a statement file.', meta }; return render(); }
  const fail = (msg, code) => {
    (S.state.errors = S.state.errors || []).push({ at: new Date().toISOString(), code, message: msg });
    S.upload = { busy: false, step: '', result: null, error: msg, needPassword: code === 'PDF_PASSWORD' || S.upload.needPassword, meta, dup: null }; persist(); render();
  };
  S.upload = { busy: true, step: 'Uploading', result: null, error: null, needPassword: S.upload.needPassword, meta, dup: null }; render();
  let fp, parsed;
  try {
    fp = await fingerprint(file);
    const dup = findRegistered(S.state, fp.hash);
    if (dup && !fd.get('force') && !S.state.demo) { S.upload = { busy: false, step: '', result: null, error: null, needPassword: false, meta, dup }; return render(); }
    parsed = await readStatementBytes(fp, fd.get('pdfpass'));
  } catch (e) { return fail(e.userMessage || 'Unable to read this statement.', e.detail === 'PDF_PASSWORD' ? 'PDF_PASSWORD' : 'READ'); }
  if (S.state.demo) S.state = emptyState();
  const input = { ...parsed, fileName: file.name, ...meta, hash: fp.hash, size: fp.size };
  const isLoan = looksLikeLoan(input);
  if (!isLoan && !/^\d{4}$/.test(meta.last4)) return fail('Enter the last 4 digits of the account / card number.', 'INPUT');
  const finish = async (state, summary) => {
    S.state = state;
    if (cloudOn() && S.state.settings.keepOriginals !== false) {
      try { const path = S.cloud.pathFor(fp.hash, file.name); await S.cloud.uploadFile(path, new Uint8Array(fp.buf), CT[fp.kind] || 'application/octet-stream');
        const r = S.state.statementRegistry.find(x => x.hash === fp.hash); if (r) r.cloudPath = path; summary.cloud = true; }
      catch (e) { toast('Data saved, but original file upload failed: ' + e.message); }
    }
    S.upload = { busy: false, step: 'Finalizing', result: summary, error: null, needPassword: false, meta: {}, dup: null }; persist(); render();
  };
  if (isLoan) { try { return await finish(S.state, ingestLoan(S.state, input)); } catch (e) { return fail(e.userMessage || 'Unable to read this loan statement.', 'PARSE'); } }
  try {
    const w = new Worker(new URL('../worker.js', import.meta.url), { type: 'module' });
    w.onmessage = ({ data }) => {
      if (data.type === 'step') { S.upload.step = data.step; render(); }
      else if (data.type === 'done') { w.terminate(); finish(data.state, data.summary); }
      else { w.terminate(); fail(data.message, data.code); }
    };
    w.onerror = () => { w.terminate(); try { finish(S.state, ingest(S.state, input)); } catch (e) { fail(e.userMessage || 'Unable to read this statement.', 'PARSE'); } };
    w.postMessage({ state: S.state, input });
  } catch { try { finish(S.state, ingest(S.state, input)); } catch (e) { fail(e.userMessage || 'Unable to read this statement.', 'PARSE'); } }
}

function download(name, data, type) { const b = data instanceof Blob ? data : new Blob([data], { type }); const a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000); }
const EXPORT_COLS = ['transaction_id', 'bank_name', 'account_number_masked', 'account_type', 'transaction_date', 'value_date', 'description', 'reference_number', 'debit', 'credit', 'balance', 'transaction_type', 'payment_mode', 'merchant', 'upi_id', 'category', 'subcategory', 'confidence_score', 'is_transfer', 'is_recurring', 'is_subscription', 'is_cash_withdrawal', 'is_salary', 'is_bill_payment', 'is_refund', 'is_investment', 'is_emi', 'is_duplicate', 'user_verified_category'];
const csvCell = v => { let s = String(v ?? ''); if (/^[=+\-@]/.test(s) && isNaN(+s)) s = "'" + s; return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
function exportCSV(list, name) { download(name, '\uFEFF' + [EXPORT_COLS.join(','), ...list.map(t => EXPORT_COLS.map(c => csvCell(t[c])).join(','))].join('\n'), 'text/csv'); audit(S.state, 'export_csv', { rows: list.length }); persist(); }
async function exportXLSX() {
  const c = ctx(); const tx = scoped(); const JSZip = await loadJSZip(); const k = A.kpis(tx, c);
  const loans = S.state.loanAccounts || [];
  const sheets = [
    { name: 'Summary', rows: [['Metric', 'Value'], ['Income', k.income], ['Expenses', k.expenses], ['Savings', k.savings], ['Savings rate %', k.savingsRate], ['Investments', k.investments], ['EMIs', k.emis], ['Bills', k.bills], ['UPI', k.upi], ['Cash', k.cash], ['Internal transfers (excluded)', k.transfers]] },
    { name: 'Monthly', rows: [['Month', 'Income', 'Expenses', 'Savings', 'Savings rate %'], ...A.monthly(tx, c).map(m => [m.month, m.income, m.expenses, m.savings, m.savingsRate])] },
    { name: 'Categories', rows: [['Category', 'Amount', 'Transactions'], ...A.byCategory(tx, c).map(e => [e.key, e.value, e.count])] },
    { name: 'Merchants', rows: [['Merchant', 'Amount', 'Transactions'], ...A.byMerchant(tx, c).map(e => [e.key, e.value, e.count])] },
    { name: 'Loans', rows: [['Loan', 'Account', 'Bank', 'Loan amount', 'ROI %', 'EMI', 'EMIs paid', 'EMIs left', 'Outstanding', 'Bounces', 'Charges'], ...loans.map(l => { const o = A.loanOutstanding(l); return [l.product, l.accountMasked, l.bank, l.loanAmount, l.rate, l.currentEmi, l.emisPaid, l.remainingEmis ?? '', o ? o.outstanding : '', l.bounces, l.charges]; })] },
    ...loans.filter(l => l.schedule).map(l => ({ name: ('Sched ' + l.accountMasked.slice(-4)), rows: [['#', 'Date', 'Principal', 'Interest', 'EMI', 'Status'], ...l.schedule.map((s, i) => [i + 1, s.date, s.principal, s.interest, s.emi, i < l.emisPaid ? 'Billed' : 'Upcoming'])] })),
    { name: 'Transactions', rows: [EXPORT_COLS, ...tx.map(t => EXPORT_COLS.map(col => typeof t[col] === 'boolean' ? (t[col] ? 'Yes' : 'No') : t[col] ?? ''))] },
  ];
  download(`moneylens-report-${today()}.xlsx`, await writeXlsx(sheets, JSZip), 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  audit(S.state, 'export_xlsx', { rows: tx.length }); persist();
}

const MORE = ['analytics', 'budgets', 'subscriptions', 'emis', 'cards', 'cashflow', 'networth', 'calendar', 'accounts', 'review', 'assistant', 'reports', 'cloud', 'connect', 'settings'];
document.addEventListener('click', async e => {
  const el = e.target.closest('[data-action],[data-drill]'); if (!el) { if (e.target.id === 'modal') closeModal(); return; }
  if (el.dataset.drill !== undefined && !el.dataset.action) {
    const k = el.dataset.key, d = el.dataset.drill;
    if (d === 'category' && location.hash.includes('analytics')) { S.drillCat = k; return render(); }
    S.tx = { q: '', cat: 'All', type: 'All', mode: 'All', flag: 'All', page: 0 };
    if (d === 'category') S.tx.cat = k; else if (d === 'merchant') S.tx.merchant = k; else if (d === 'mode') S.tx.mode = k; else if (d === 'subcategory') S.tx.q = k;
    location.hash = '#/transactions'; return;
  }
  const a = el.dataset.action, id = el.dataset.id;
  if (el.tagName === 'SELECT' || (el.tagName === 'INPUT' && el.type !== 'button')) return;
  e.preventDefault();
  switch (a) {
    case 'menu': if (innerWidth <= 860 && !el.classList.contains('menu-btn')) { modal(`<h2>More</h2><div class="nav">${NAV.filter(n => MORE.includes(n[0])).map(([k, ic, l]) => `<a href="#/${k}" data-action="close-nav"><span class="ic">${ic}</span>${l}</a>`).join('')}</div>`); } else { S.sidebar = !S.sidebar; render(); } break;
    case 'close-nav': closeModal(); location.hash = el.getAttribute('href'); break;
    case 'demo': await loadDemo(); toast('Demo loaded: synthetic data'); break;
    case 'exit-demo': if (confirm('Remove demo data and start fresh?')) { S.state = emptyState(); await store.save(S.state); location.hash = '#/welcome'; render(); pullAndMerge(); } break;
    case 'edit-tx': editTx(id); break;
    case 'close': closeModal(); break;
    case 'rv': correctTransaction(S.state, id, { [el.dataset.op]: true }); persist(); render(); toast('Saved'); break;
    case 'del-budget': S.state.budgets = S.state.budgets.filter(b => b.category !== el.dataset.cat); persist(); render(); break;
    case 'suggest-budgets': { const c = ctx(); const [f] = A.periodRange('3m', anchor()); const cats = A.byCategory(A.filterTxns(S.state.transactions, { from: f, to: anchor() }), c).filter(x => !['Transfers', 'Cash', 'Other', 'Finance', 'Housing'].includes(x.key)).slice(0, 6);
      for (const x of cats) { const amt = Math.ceil(x.value / 3 / 500) * 500; const b = S.state.budgets.find(y => y.category === x.key); if (b) b.amount = amt; else S.state.budgets.push({ category: x.key, amount: amt }); } persist(); render(); toast('Budgets set to your 3-month average'); break; }
    case 'del-loan': S.state.loans.splice(+el.dataset.i, 1); persist(); render(); break;
    case 'del-nw': S.state.netWorthItems.splice(+el.dataset.i, 1); persist(); render(); break;
    case 'nw-prefill': {
      for (const acc of A.accountSummary(S.state, ctx()).filter(x => x.balance !== null && x.account_type !== 'Credit Card')) { const name = `${acc.nickname} ${acc.account_number_masked.slice(-4)}`; const ex = S.state.netWorthItems.find(i => i.name === name); if (ex) ex.value = acc.balance; else S.state.netWorthItems.push({ kind: 'asset', type: 'Bank Balance', name, value: acc.balance }); }
      for (const l of S.state.loanAccounts || []) { const o = A.loanOutstanding(l); if (!o) continue; const name = `${l.product} ${l.accountMasked.slice(-4)}`; const ex = S.state.netWorthItems.find(i => i.name === name); const type = l.kind === 'emi_table' ? 'Credit Card Loan' : /HOME/i.test(l.product) ? 'Home Loan' : 'Other Liability'; if (ex) ex.value = o.outstanding; else S.state.netWorthItems.push({ kind: 'liability', type, name, value: o.outstanding }); }
      persist(); render(); break; }
    case 'nw-snapshot': { const nw = A.netWorth(S.state.netWorthItems); const m = today().slice(0, 7); S.state.netWorthHistory = S.state.netWorthHistory.filter(h => h.month !== m).concat({ month: m, ...nw }).sort((x, y) => x.month.localeCompare(y.month)); persist(); render(); toast('Snapshot saved'); break; }
    case 'cal': S.calMonth = el.dataset.m; render(); break;
    case 'filter-account': S.f.account = id; location.hash = '#/dashboard'; break;
    case 'del-import': if (confirm('Delete this statement and all its data? (You can upload it again later.)')) {
      const reg = (S.state.statementRegistry || []).find(r => r.importId === id);
      deleteImport(S.state, id); persist(); render(); toast('Statement deleted');
      if (reg?.cloudPath && cloudOn()) S.cloud.deleteFiles([reg.cloudPath]).catch(() => {});
    } break;
    case 'dl-original': try { download(el.dataset.name, await S.cloud.downloadFile(el.dataset.path)); } catch (err) { toast(err.message); } break;
    case 'undrill': S.drillCat = null; render(); break;
    case 'drill-merchant': S.tx = { q: '', cat: 'All', type: 'All', mode: 'All', flag: 'All', page: 0, merchant: el.dataset.key }; location.hash = '#/transactions'; break;
    case 'clear-merchant': delete S.tx.merchant; render(); break;
    case 'ask': askQ(el.dataset.q); break;
    case 'export-filtered': exportCSV(scoped(), `moneylens-transactions-${today()}.csv`); break;
    case 'export-csv': exportCSV(S.report === 'annual' ? S.state.transactions.filter(t => t.transaction_date.startsWith((S.reportMonth || curMonth()).slice(0, 4))) : (S.report || 'monthly') === 'monthly' ? S.state.transactions.filter(t => t.transaction_date.startsWith(S.reportMonth || curMonth())) : scoped(), `moneylens-${S.report || 'monthly'}-${today()}.csv`); break;
    case 'export-xlsx': exportXLSX().catch(() => toast('Excel export failed')); break;
    case 'print': print(); break;
    case 'theme': { const t = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'; document.documentElement.dataset.theme = t; localStorage.setItem('ml.theme', t); break; }
    case 'lock': store.lockNow(); break;
    case 'rm-pass': await store.removePasscode(S.state); toast('Passcode removed'); render(); break;
    case 'backup': download(`moneylens-backup-${today()}.json`, JSON.stringify(S.state), 'application/json'); audit(S.state, 'export_backup'); persist(); break;
    case 'wipe': if (confirm('Delete ALL MoneyLens data on THIS DEVICE? (Your cloud copy, if any, is not touched.)')) { await store.wipeAll(); S.state = emptyState(); if (cloudOn()) await S.cloud.signOut(); initCloud(); location.hash = '#/welcome'; render(); toast('All data on this device deleted'); } break;
    case 'forgot': if (confirm('Without the passcode your encrypted local data cannot be recovered. Delete local data and start over? (Cloud data, if any, can be loaded again by signing in.)')) { await store.wipeAll(); location.hash = ''; location.reload(); } break;
    case 'aa-mock': { const prov = new MockAccountAggregatorProvider(generateDemo(demoEnd())); const { consentHandle } = await prov.initiateConsent({ banks: ['HDFC', 'SBI'] });
      if (S.state.demo || !hasData()) S.state = emptyState();
      for (const acc of await prov.fetchAccounts(consentHandle)) { const rows = await prov.fetchTransactions(consentHandle, acc);
        ingest(S.state, { kind: 'csv', rows: bankRows(rows), fileName: `aa-mock-${acc.bank}`, bank: acc.bank, accountType: acc.type, last4: acc.maskedAccNumber, nickname: `${acc.bank} (AA mock)` }); }
      S.state.demo = true; audit(S.state, 'aa_mock_consent'); await prov.revokeConsent(consentHandle); await store.save(S.state); location.hash = '#/dashboard'; toast('Mock AA data imported (synthetic)'); break; }
    case 'cloud-sync': await pullAndMerge(); S.cloudMsg = { type: S.sync.status === 'err' ? 'err' : 'ok', text: S.sync.status === 'err' ? S.sync.msg : 'Sync complete.' }; render(); break;
    case 'cloud-push': if (S.state.demo) { toast('Demo data is never uploaded. Exit demo first.'); break; } if (confirm('Replace the cloud copy with the data on this device?')) { try { S.state.updatedAt = new Date().toISOString(); await S.cloud.pushState(S.state); S.sync = { status: 'ok', at: new Date(), msg: 'Synced' }; S.cloudMsg = { type: 'ok', text: "Cloud copy replaced with this device's data." }; } catch (err) { S.cloudMsg = { type: 'err', text: err.message }; } render(); } break;
    case 'cloud-signout': await S.cloud.signOut(); initCloud(); S.cloudMsg = { type: 'ok', text: 'Signed out. Your data remains on this device.' }; render(); break;
    case 'cloud-delete': if (confirm('Permanently delete your synced data AND all stored statement files from the cloud? Local data on this device stays.')) {
      try { const paths = (S.state.statementRegistry || []).map(r => r.cloudPath).filter(Boolean); await S.cloud.deleteFiles(paths); await S.cloud.deleteState(); (S.state.statementRegistry || []).forEach(r => { r.cloudPath = null; }); await store.save(S.state); S.cloudMsg = { type: 'ok', text: 'Cloud data deleted.' }; } catch (err) { S.cloudMsg = { type: 'err', text: err.message }; } render(); } break;
    case 'cloud-forgot': { const email = prompt('Enter your cloud account email:'); if (email) { try { await S.cloud.resetPassword(email.trim(), location.origin + location.pathname); toast('Password reset email sent.'); } catch (err) { toast(err.message); } } break; }
    case 'cloud-reset-cfg': localStorage.removeItem('ml.sb.cfg'); initCloud(); render(); break;
  }
});
document.addEventListener('change', e => {
  const el = e.target;
  if (el.dataset.filter) { S.f[el.dataset.filter] = el.value; if (el.dataset.filter === 'bank') S.f.account = 'All'; return render(); }
  if (el.dataset.txf && el.dataset.txf !== 'q') { S.tx[el.dataset.txf] = el.value; return render(); }
  if (el.dataset.action === 'sub-status') { S.state.subscriptionStatus[el.dataset.id] = el.value; persist(); return render(); }
  if (el.dataset.action === 'report') { S.report = el.value; return render(); }
  if (el.dataset.action === 'report-month') { S.reportMonth = el.value; return render(); }
  if (el.dataset.action === 'cat-change') { el.form.subcategory.innerHTML = subOptions(el.value); return; }
  if (el.dataset.action === 'keep-originals') { S.state.settings.keepOriginals = el.checked; persist(); return; }
  if (el.dataset.action === 'restore' && el.files[0]) {
    el.files[0].text().then(async txt => { try { const s = JSON.parse(txt); if (!Array.isArray(s.transactions) || !Array.isArray(s.accounts)) throw 0; S.state = store.withDefaults(s); persist(); toast('Backup restored'); render(); } catch { toast('This is not a valid MoneyLens backup.'); } });
  }
  if (el.name === 'file' && el.files[0]) { const f = document.getElementById('fname'); if (f) f.textContent = el.files[0].name; }
});
let qTimer;
document.addEventListener('input', e => {
  if (e.target.dataset.txf === 'q') { clearTimeout(qTimer); const v = e.target.value; qTimer = setTimeout(() => { S.tx.q = v; const pos = e.target.selectionStart; render(); const i = document.querySelector('[data-txf=q]'); i.focus(); i.setSelectionRange(pos, pos); }, 250); }
});
document.addEventListener('dragover', e => { const d = e.target.closest?.('#drop'); if (d) { e.preventDefault(); d.classList.add('over'); } });
document.addEventListener('dragleave', e => e.target.closest?.('#drop')?.classList.remove('over'));
document.addEventListener('drop', e => { const d = e.target.closest?.('#drop'); if (!d) return; e.preventDefault(); d.classList.remove('over'); const inp = d.querySelector('input[type=file]'); inp.files = e.dataTransfer.files; document.getElementById('fname').textContent = inp.files[0]?.name || ''; });
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeModal(); });
function askQ(q) { if (!q?.trim()) return; const r = ask(q, S.state, ctx()); S.chat.push({ role: 'u', text: q }, { role: 'a', text: r.answer, sources: r.sources }); render(); const c = document.getElementById('chat'); if (c) c.scrollTop = c.scrollHeight; }

document.addEventListener('submit', async e => {
  const f = e.target, kind = f.dataset.form; if (!kind) return; e.preventDefault(); const fd = new FormData(f);
  switch (kind) {
    case 'unlock': try { S.state = await store.unlock(fd.get('pass')); addEventListener('hashchange', () => { S.sidebar = false; render(); }); render(); pullAndMerge(); } catch { renderLock('Incorrect passcode.'); } break;
    case 'upload': processFile(f); break;
    case 'budget': { const cat = fd.get('category'), amt = +fd.get('amount'); if (!(amt > 0)) return; const b = S.state.budgets.find(x => x.category === cat); if (b) b.amount = amt; else S.state.budgets.push({ category: cat, amount: amt }); persist(); render(); break; }
    case 'loan': S.state.loans.push({ name: String(fd.get('name')).slice(0, 60), principal: +fd.get('principal'), rate: +fd.get('rate'), tenure: +fd.get('tenure'), emi: +fd.get('emi') || 0, start: fd.get('start') }); persist(); render(); break;
    case 'loan-start': { const l = (S.state.loanAccounts || []).find(x => x.key === f.dataset.key); if (l) { l.firstEmiDate = fd.get('first') || ''; persist(); render(); toast('Saved'); } break; }
    case 'card': { const id = f.dataset.id; const o = { account_id: id }; for (const k of ['limit', 'outstanding', 'paymentDue', 'minDue']) o[k] = +fd.get(k) || 0; for (const k of ['statementDate', 'dueDate']) o[k] = fd.get(k) || ''; S.state.creditCards = S.state.creditCards.filter(c => c.account_id !== id).concat(o); persist(); render(); toast('Card details saved'); break; }
    case 'nw': { const [kind2, type] = String(fd.get('type')).split('|'); S.state.netWorthItems.push({ kind: kind2, type, name: String(fd.get('name')).slice(0, 60), value: Math.abs(+fd.get('value')) }); persist(); render(); break; }
    case 'edit-tx': { const id = f.dataset.id; const t = S.state.transactions.find(x => x.transaction_id === id); const ch = {};
      const merchant = String(fd.get('merchant') || '').trim().slice(0, 60); if (merchant && merchant !== t.merchant) ch.merchant = merchant;
      if (fd.get('category') !== t.category || fd.get('subcategory') !== t.subcategory || !t.user_verified_category) { ch.category = fd.get('category'); ch.subcategory = fd.get('subcategory'); }
      if (fd.get('transfer') && !t.is_transfer) ch.markTransfer = true; if (!fd.get('transfer') && t.is_transfer) ch.notTransfer = true;
      if (fd.get('ignore')) ch.ignore = true; else if (t.excluded) t.excluded = false;
      ch.approve = true; correctTransaction(S.state, id, ch); persist(); closeModal(); render(); toast('Saved. MoneyLens will remember this'); break; }
    case 'ask': askQ(fd.get('q')); break;
    case 'pass': if (fd.get('p1') !== fd.get('p2')) return toast('Passcodes do not match'); try { await store.setPasscode(fd.get('p1'), S.state); toast('Passcode set: data encrypted'); render(); } catch (err) { toast(err.message); } break;
    case 'settings': { const s = S.state.settings; s.selfNames = String(fd.get('selfNames') || '').split(',').map(x => x.trim()).filter(Boolean).slice(0, 5);
      s.excludeCcPaymentIfCardImported = !!fd.get('excludeCcPaymentIfCardImported'); s.excludeRefundsFromIncome = !!fd.get('excludeRefundsFromIncome');
      s.transferWindowDays = Math.min(10, Math.max(0, +fd.get('transferWindowDays') || 0)); s.largeCashThreshold = Math.max(0, +fd.get('largeCashThreshold') || 0);
      runIntelligence(S.state, A.latestDate(S.state.transactions)); persist(); render(); toast('Rules saved & recalculated'); break; }
    case 'cloud-cfg': { const url = String(fd.get('url')).trim(), key = String(fd.get('key')).trim(); localStorage.setItem('ml.sb.cfg', JSON.stringify({ url, key })); initCloud(); S.cloudMsg = S.cloud ? { type: 'ok', text: 'Saved. Now sign in or create your account.' } : { type: 'err', text: S.sync.msg }; render(); break; }
    case 'cloud-auth': {
      const op = e.submitter?.value || 'signin'; const email = String(fd.get('email')).trim(), pw = String(fd.get('password'));
      try {
        if (op === 'signup') { const r = await S.cloud.signUp(email, pw); if (!r.confirmed) { S.cloudMsg = { type: 'ok', text: 'Account created. Open the confirmation email from Supabase, click the link, then come back and Sign in.' }; render(); break; } }
        else await S.cloud.signIn(email, pw);
        S.cloudMsg = { type: 'ok', text: 'Signed in. Syncing your data…' }; S.sync = { status: 'ok', at: null, msg: 'Signed in' };
        await pullAndMerge();
      } catch (err) { S.cloudMsg = { type: 'err', text: err.message }; render(); }
      break; }
  }
});

boot();
