// MoneyLens India — application shell, routing, events and all views.
// Every number rendered here is computed from the user's (or clearly-labelled demo) data.
import * as store from '../core/store.js';
import { esc, inr, round2, sum, addDays, monthKey } from '../core/utils.js';
import { emptyState, ingest, deleteImport, correctTransaction, audit } from '../core/ingest.js';
import { runIntelligence } from '../core/pipeline.js';
import * as A from '../core/analytics.js';
import { CATEGORY_TREE } from '../core/classifier.js';
import { ask } from '../core/assistant.js';
import { generateDemo } from '../core/demo.js';
import { MockAccountAggregatorProvider } from '../core/providers.js';
import { writeXlsx } from '../core/xlsx.js';
import { readStatementFile } from './fileReader.js';
import { donut, bars, lines, heatmap, PALETTE } from './charts.js';

const S = {
  state: null,
  f: { period: 'this_month', bank: 'All', account: 'All', from: '', to: '' },
  tx: { q: '', cat: 'All', type: 'All', mode: 'All', flag: 'All', page: 0 },
  chat: [], upload: { busy: false, step: '', result: null, error: null, needPassword: false },
  sidebar: false, drillCat: null,
};
const root = document.getElementById('root');
const today = () => new Date().toISOString().slice(0, 10);
const demoEnd = () => { const d = new Date(); return new Date(Date.UTC(d.getFullYear(), d.getMonth(), 0)).toISOString().slice(0, 10); }; // last day of previous month

/* ----------------------------- boot & persistence ----------------------------- */
async function boot() {
  document.documentElement.dataset.theme = localStorage.getItem('ml.theme') || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  try {
    const r = await store.load();
    if (r.locked) return renderLock();
    S.state = r.state;
  } catch { S.state = emptyState(); toast('Browser storage unavailable — data will not persist (private mode?).'); }
  addEventListener('hashchange', () => { S.sidebar = false; render(); scrollTo(0, 0); });
  render();
}
function renderLock(err = '') {
  root.innerHTML = `<div class="lock"><form class="card form" data-form="unlock" style="width:min(380px,92vw)">
    <div class="brand"><div class="logo">₹</div><div><b>MoneyLens India</b><small>Your data is encrypted on this device</small></div></div>
    ${err ? `<div class="alert err">${esc(err)}</div>` : ''}
    <label>Passcode<input type="password" name="pass" autocomplete="current-password" required autofocus></label>
    <button class="btn">Unlock</button>
    <a href="#" data-action="forgot" class="mute" style="font-size:12px">Forgot passcode?</a></form></div>`;
}
let saveTimer;
function persist() { clearTimeout(saveTimer); saveTimer = setTimeout(() => store.save(S.state).catch(e => toast(e.message)), 150); }
function toast(msg) { const t = document.createElement('div'); t.className = 'toast'; t.textContent = msg; document.body.appendChild(t); setTimeout(() => t.remove(), 3200); }

/* ----------------------------- data helpers ----------------------------- */
const ctx = () => A.makeCtx(S.state);
const hasData = () => S.state.transactions.length > 0;
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
  ['subscriptions', '↻', 'Subscriptions'], ['emis', '⌂', 'EMIs & Loans'], ['cards', '▭', 'Credit Cards'], ['cashflow', '⇅', 'Cash Flow'],
  ['networth', '△', 'Net Worth'], ['calendar', '▦', 'Calendar'], ['accounts', '🏦', 'Accounts'], ['review', '⚑', 'Review'],
  ['assistant', '✦', 'Ask MoneyLens'], ['reports', '⎙', 'Reports'], ['sep', '', 'Data'], ['upload', '⇪', 'Upload Statement'], ['connect', '⛓', 'Connect Bank (AA)'],
  ['settings', '⚙', 'Settings & Privacy'], ['admin', '⌗', 'Diagnostics'],
];
const BOTTOM = [['dashboard', '◧', 'Home'], ['transactions', '≡', 'Transactions'], ['analytics', '◔', 'Analytics'], ['budgets', '◎', 'Budgets'], ['more', '☰', 'More']];

function render() {
  if (!S.state) return;
  let route = location.hash.replace(/^#\/?/, '').split('?')[0] || (hasData() ? 'dashboard' : 'welcome');
  if (!VIEWS[route]) route = 'dashboard';
  if (route === 'welcome' || ((!hasData()) && !['upload', 'connect', 'settings', 'privacy', 'terms', 'admin', 'welcome', 'budgets', 'networth', 'emis', 'cards'].includes(route))) {
    root.innerHTML = `<main style="margin:0">${VIEWS.welcome()}</main>`; return;
  }
  const rc = reviewCount();
  root.innerHTML = `<div class="app">
  <aside class="side ${S.sidebar ? 'open' : ''}"><div class="brand"><div class="logo">₹</div><div><b>MoneyLens India</b><small>Understand your money.</small></div></div>
  <nav class="nav">${NAV.map(([k, ic, l]) => k === 'sep' ? `<div class="sep">${l}</div>` : `<a href="#/${k}" class="${route === k ? 'on' : ''}"><span class="ic">${ic}</span>${l}${k === 'review' && rc ? `<span class="badge-n">${rc}</span>` : ''}</a>`).join('')}</nav>
  <div style="margin-top:auto;padding:12px;font-size:11px" class="mute">🔒 Data stays in this browser.<br><a href="#/privacy">Privacy</a> · <a href="#/terms">Terms</a></div></aside>
  <main>${S.state.demo ? `<div class="demo-banner">🧪 <b>Demo mode</b> — all figures are synthetic sample data. <button class="btn sm ghost" data-action="exit-demo">Exit demo & start fresh</button></div>` : ''}${VIEWS[route]()}</main>
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
  <div class="logo hero-logo">₹</div>
  <h1>MoneyLens India</h1><div class="tag">Understand your money. Control your spending.</div>
  <div class="choice">
    <a class="card" href="#/upload"><h3>⇪ Upload bank statement</h3><div class="mute">HDFC, SBI or any bank — PDF, CSV, Excel. Processed entirely in your browser.</div></a>
    <a class="card" href="#/connect"><h3>⛓ Connect via Account Aggregator</h3><div class="mute">Consent-based RBI AA framework. Mock provider available today; live provider is pluggable.</div></a>
    <a class="card" href="#" data-action="demo"><h3>🧪 Try demo</h3><div class="mute">Explore with 12 months of synthetic HDFC + SBI + credit-card data (₹1.5L/month income).</div></a>
  </div>
  <div class="trust"><span>🔒 No bank passwords, OTP, PIN or CVV — ever</span><span>💻 No server: data never leaves your device</span><span>🆓 Free & open source</span></div>
  <p class="mute" style="margin-top:22px;font-size:12px">By continuing you agree to the <a href="#/terms">Terms</a> and <a href="#/privacy">Privacy Policy</a>. MoneyLens provides information, not financial advice.</p></div>`;

VIEWS.dashboard = () => {
  const c = ctx(), tx = scoped(), k = A.kpis(tx, c);
  const [pf, pt] = A.previousRange(S.f.period, anchor(), S.f);
  const pk = A.kpis(A.filterTxns(S.state.transactions, { from: pf, to: pt, bank: S.f.bank, account: S.f.account }), c);
  const cats = A.byCategory(tx, c), merch = A.byMerchant(tx, c).slice(0, 8);
  const ms = A.monthly(A.filterTxns(S.state.transactions, { from: A.periodRange('12m', anchor())[0], to: anchor(), bank: S.f.bank, account: S.f.account }), c);
  const bud = A.budgetStatus(S.state.budgets, S.state.transactions, c, curMonth()).filter(b => b.status !== 'ok');
  const ins = A.insights(S.state, c, anchor());
  const upcoming = A.calendarEvents(S.state, today(), 30).slice(0, 6);
  return header('Dashboard') + `
  ${bud.map(b => `<div class="alert ${b.status === 'exceeded' ? 'err' : ''}">${b.status === 'exceeded' ? '⛔ Budget exceeded' : '⚠️ Budget nearing limit'}: <b>${esc(b.category)}</b> — ${inr(b.actual)} of ${inr(b.amount)} (${b.utilization.toFixed(0)}%)</div>`).join('')}
  <div class="kpis">
    ${kpi('Total Income', inr(k.income), chg(k.income, pk.income, true))}
    ${kpi('Total Expenses', inr(k.expenses), chg(k.expenses, pk.expenses))}
    ${kpi('Savings', inr(k.savings), '', 'hero')}
    ${kpi('Savings Rate', k.income ? k.savingsRate.toFixed(1) + '%' : '—')}
    ${kpi('Investments', inr(k.investments))}
    ${kpi('Bills', inr(k.bills))}
    ${kpi('EMIs', inr(k.emis))}
  </div>
  <div class="grid g2">
    <div class="card"><h3>Where your money went <span class="r">click to drill down</span></h3>${donut(cats, { drill: 'category' })}</div>
    <div class="card"><h3>Income vs expenses <span class="r">last 12 months</span></h3>${lines([{ name: 'Income', color: '#10B981', values: ms.map(m => m.income) }, { name: 'Expenses', color: '#EF4444', values: ms.map(m => m.expenses) }, { name: 'Savings', color: '#4F46E5', values: ms.map(m => m.savings) }], ms.map(m => monthName(m.month)))}</div>
    <div class="card"><h3>Top merchants</h3>${bars(merch, { horizontal: true, drill: 'merchant' })}</div>
    <div class="card"><h3>Insights</h3>${ins.length ? ins.map(i => `<div class="ins ${i.type}"><span class="dot"></span><div>${esc(i.text)}</div></div>`).join('') : '<div class="mute">Insights appear after you import transactions.</div>'}</div>
    <div class="card"><h3>How you paid</h3>
      <div class="kpis" style="margin:0">${kpi('UPI', inr(k.upi))}${kpi('Cards', inr(k.cards))}${kpi('Cash (ATM)', inr(k.cash))}${kpi('Internal transfers', inr(k.transfers), 'excluded from expenses')}</div></div>
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
      <td class="n ${r.change > 0 ? (['Income', 'Savings', 'Savings %', 'Investment %'].includes(r.metric) ? 'pos' : 'neg') : r.change < 0 ? (['Income', 'Savings', 'Savings %', 'Investment %'].includes(r.metric) ? 'neg' : 'pos') : ''}">${r.isPct ? (r.change > 0 ? '+' : '') + r.change.toFixed(1) + ' pts' : (r.change > 0 ? '+' : '') + inr(r.change) + (r.changePct !== null ? ` (${r.changePct > 0 ? '+' : ''}${r.changePct.toFixed(1)}%)` : '')}</td></tr>`).join('')}</tbody></table></div></div>
  </div>`;
};

VIEWS.budgets = () => {
  const c = ctx(), m = curMonth(), st = A.budgetStatus(S.state.budgets, S.state.transactions, c, m);
  const tb = sum(st, b => b.amount), ta = sum(st, b => b.actual);
  const used = new Set(S.state.budgets.map(b => b.category));
  return header('Budgets', { filters: false }) + `<div class="kpis">${kpi('Month', monthName(m))}${kpi('Total budget', inr(tb))}${kpi('Spent', inr(ta))}${kpi('Remaining', inr(tb - ta), '', tb - ta < 0 ? '' : 'hero')}</div>
  <div class="grid g2"><div class="card"><h3>Category budgets</h3>${st.length ? st.map(b => `<div style="padding:10px 0;border-bottom:1px solid var(--line)">
    <div class="row" style="align-items:center"><b style="flex:2">${esc(b.category)}</b><span class="pill ${b.status === 'exceeded' ? 'b' : b.status === 'nearing' ? 'w' : 'g'}" style="flex:0">${b.utilization.toFixed(0)}% used</span><button class="btn sm ghost" style="flex:0;min-width:0" data-action="del-budget" data-cat="${esc(b.category)}">✕</button></div>
    <div class="prog ${b.status}" style="margin:8px 0"><span style="width:${Math.min(100, b.utilization)}%"></span></div>
    <div class="mute" style="font-size:12.5px">${inr(b.amount)} budget · ${inr(b.actual)} used · <b class="${b.remaining < 0 ? 'neg' : 'pos'}">${inr(Math.abs(b.remaining))} ${b.remaining < 0 ? 'over' : 'remaining'}</b></div></div>`).join('') : '<div class="mute">No budgets yet. Add one →</div>'}</div>
  <div class="card"><h3>Add / update budget</h3><form class="form" data-form="budget">
    <label>Category<select name="category">${Object.keys(CATEGORY_TREE).filter(x => !['Income', 'Transfers', 'Investment'].includes(x)).map(x => `<option>${esc(x)}</option>`).join('')}</select></label>
    <label>Monthly amount (₹)<input type="number" name="amount" min="1" step="1" required></label><button class="btn">Save budget</button></form>
    ${hasData() ? `<button class="btn ghost" style="margin-top:12px" data-action="suggest-budgets">Suggest from my 3-month average</button>` : ''}
    <p class="mute" style="font-size:12px">Alerts appear on the dashboard at 80% (nearing) and 100% (exceeded).</p>
    ${[...used].length ? '' : ''}</div></div>`;
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

VIEWS.emis = () => {
  const emis = (S.state.recurring || []).filter(r => r.is_emi || r.category === 'Finance' && /EMI|Loan/.test(r.subcategory));
  const loans = S.state.loans.map(l => ({ ...l, ...A.emiSchedule({ principal: +l.principal, ratePct: +l.rate, tenureMonths: +l.tenure, startDate: l.start, emi: +l.emi || undefined }) }));
  return header('EMIs & Loans', { filters: false }) + `<div class="kpis">${kpi('Detected EMIs / month', inr(sum(emis, e => e.monthly_cost)))}${kpi('Tracked loans', loans.length)}${kpi('Est. outstanding', inr(sum(loans, l => l.outstanding)), 'estimate')}</div>
  <div class="card"><h3>EMIs detected from statements</h3>${emis.length ? `<table><thead><tr><th>Lender</th><th class="n">Monthly EMI</th><th>First seen</th><th>Last payment</th><th>Frequency</th><th>Payments</th></tr></thead><tbody>${emis.map(e => `<tr><td><b>${esc(e.merchant)}</b></td><td class="n">${inr(e.amount, 2)}</td><td>${fmtDate(e.first_payment)}</td><td>${fmtDate(e.last_payment)}</td><td>${e.frequency}</td><td>${e.occurrences}</td></tr>`).join('')}</tbody></table>` : '<div class="mute">No EMIs detected in your statements.</div>'}</div>
  <div class="grid g2" style="margin-top:16px"><div class="card"><h3>Loan details (estimates)</h3>${loans.length ? loans.map((l, i) => `<div style="padding:10px 0;border-bottom:1px solid var(--line)"><div class="row" style="align-items:center"><b style="flex:3">${esc(l.name)}</b><button class="btn sm ghost" style="flex:0;min-width:0" data-action="del-loan" data-i="${i}">✕</button></div>
    <div class="prog" style="margin:8px 0"><span style="width:${Math.min(100, l.paidInstallments / l.tenure * 100)}%"></span></div>
    <table><tr><td>EMI</td><td class="n">${inr(l.emi, 2)}</td><td>Outstanding*</td><td class="n"><b>${inr(l.outstanding)}</b></td></tr><tr><td>Principal repaid*</td><td class="n">${inr(l.principalPaid)}</td><td>Interest paid*</td><td class="n">${inr(l.interestPaid)}</td></tr><tr><td>Remaining tenure</td><td class="n">${l.remainingTenure} months</td><td>Total interest*</td><td class="n">${inr(l.totalInterest)}</td></tr></table></div>`).join('') + '<p class="mute" style="font-size:12px">* Estimates using standard reducing-balance amortisation from the details you entered; actual figures depend on your lender (prepayments, rate resets, fees).</p>' : '<div class="mute">Add a loan to see principal / interest split.</div>'}</div>
  <div class="card"><h3>Add loan</h3><form class="form" data-form="loan"><label>Name<input type="text" name="name" maxlength="60" required placeholder="e.g. HDFC Home Loan"></label>
    <div class="row"><label>Loan amount (₹)<input type="number" name="principal" min="1" required></label><label>Interest rate (% p.a.)<input type="number" name="rate" step="0.01" min="0" max="60" required></label></div>
    <div class="row"><label>Tenure (months)<input type="number" name="tenure" min="1" max="600" required></label><label>EMI (₹, optional)<input type="number" name="emi" min="0"></label></div>
    <label>Start date<input type="date" name="start" required></label><button class="btn">Add loan</button></form></div></div>`;
};

VIEWS.cards = () => {
  const c = ctx(), cards = S.state.accounts.filter(a => a.account_type === 'Credit Card');
  const info = id => S.state.creditCards.find(x => x.account_id === id) || {};
  return header('Credit Cards') + (cards.length ? '' : '<div class="alert">Upload a credit-card statement (Account type: Credit Card) to track card spending. Card bill payments from your bank account are then automatically excluded from expenses to avoid double counting.</div>') +
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
  <p class="mute" style="font-size:12px">Opening/closing balances come from statement running balances (bank accounts only). Credit card accounts are excluded from balances.</p></div>`;
};

const NW_TYPES = { asset: ['Bank Balance', 'Cash', 'FD', 'RD', 'Mutual Funds', 'Stocks', 'NPS', 'PPF/EPF', 'Gold', 'Property', 'Other Asset'], liability: ['Home Loan', 'Car Loan', 'Personal Loan', 'Education Loan', 'Credit Card Outstanding', 'Other Liability'] };
VIEWS.networth = () => {
  const items = S.state.netWorthItems, nw = A.netWorth(items), hist = S.state.netWorthHistory;
  return header('Net Worth', { filters: false }) + `<div class="kpis">${kpi('Assets', inr(nw.assets))}${kpi('Liabilities', inr(nw.liabilities))}${kpi('Net worth', inr(nw.netWorth), '', 'hero')}</div>
  <div class="grid g2"><div class="card"><h3>Assets & liabilities <button class="btn sm ghost r" data-action="nw-prefill" style="margin-left:auto">Add bank balances from statements</button></h3>
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
  const nav = d => { const x = new Date(Date.UTC(y, m - 1 + d, 1)); return x.toISOString().slice(0, 7); };
  return header('Financial Calendar', { filters: false }) + `<div class="card"><h3><button class="btn sm ghost" data-action="cal" data-m="${nav(-1)}">‹</button> ${monthName(base)} <button class="btn sm ghost" data-action="cal" data-m="${nav(1)}">›</button><span class="r">EMIs · subscriptions · bills · SIPs · insurance · salary · card dues</span></h3>
  <div class="cal">${['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(d => `<div class="mute" style="text-align:center;font-size:11px">${d}</div>`).join('')}${cells}</div>
  <p class="mute" style="font-size:12px">Dates are projected from detected recurring patterns and may shift by a few days.</p></div>`;
};

VIEWS.accounts = () => {
  const c = ctx(), sm = A.accountSummary(S.state, c), all = A.kpis(S.state.transactions, c);
  return header('Accounts', { filters: false, extra: '<a class="btn" href="#/upload">+ Add statement</a>' }) + `<div class="kpis">${kpi('All accounts', sm.length)}${kpi('Combined balance', inr(sum(sm.filter(a => a.account_type !== 'Credit Card' && a.balance !== null), a => a.balance)), '', 'hero')}${kpi('Total income', inr(all.income))}${kpi('Total expenses', inr(all.expenses))}</div>
  <div class="grid g3">${sm.map(a => `<div class="card"><h3>🏦 ${esc(a.nickname)} <span class="r">${esc(a.account_type)}</span></h3><div class="mute">${esc(a.account_number_masked)}</div>
  <table style="margin-top:10px"><tr><td>Current balance</td><td class="n"><b>${a.balance !== null && a.account_type !== 'Credit Card' ? inr(a.balance, 2) : '—'}</b></td></tr><tr><td>Last transaction</td><td class="n">${fmtDate(a.lastDate)}</td></tr><tr><td>Total income</td><td class="n pos">${inr(a.income)}</td></tr><tr><td>Total expenses</td><td class="n neg">${inr(a.expenses)}</td></tr><tr><td>Avg monthly spending</td><td class="n">${inr(a.monthlySpend)}</td></tr><tr><td>Transactions</td><td class="n">${a.count}</td></tr></table>
  <button class="btn sm ghost" style="margin-top:10px" data-action="filter-account" data-id="${a.id}">View dashboard for this account</button></div>`).join('')}</div>
  <div class="card" style="margin-top:16px"><h3>Imported statements</h3>${S.state.imports.length ? `<div class="tbl"><table><thead><tr><th>File</th><th>Bank</th><th>Period</th><th class="n">Transactions</th><th>Imported</th><th></th></tr></thead><tbody>${S.state.imports.map(i => `<tr><td>${esc(i.fileName)}</td><td>${esc(i.bank)}</td><td>${fmtDate(i.from)} – ${fmtDate(i.to)}</td><td class="n">${i.processed}</td><td>${new Date(i.at).toLocaleString('en-IN')}</td><td><button class="btn sm danger" data-action="del-import" data-id="${i.id}">Delete</button></td></tr>`).join('')}</tbody></table></div>` : '<div class="mute">None yet.</div>'}</div>`;
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
  <div class="card"><p class="mute" style="margin-top:0">Corrections are remembered: changing a merchant or category applies to future transactions from the same merchant / UPI ID. Unusual transactions are flagged for your review only — they are <b>not</b> labelled as fraud.</p>
  ${list.length ? `<div class="tbl"><table><thead><tr><th>Date</th><th>Transaction</th><th>Why</th><th class="n">Amount</th><th></th></tr></thead><tbody>${list.slice(0, 200).map(t => `<tr><td style="white-space:nowrap">${fmtDate(t.transaction_date)}</td><td><b>${esc(t.merchant)}</b> <span class="pill">${esc(t.category)}</span><div class="desc">${esc(t.description)}</div></td><td>${t.review_flags.map(f => `<span class="pill w">${esc(f)}</span>`).join(' ')}${t.anomaly ? `<div class="desc">${esc(t.anomaly)}</div>` : ''}</td><td class="n">${t.credit ? '+' : '−'}${inr(t.amount, 2)}</td><td>${act(t)}</td></tr>`).join('')}</tbody></table></div>` : '<div class="empty-chart">🎉 Nothing to review</div>'}</div>`;
};

VIEWS.assistant = () => header('Ask MoneyLens', { filters: false }) + `<div class="card">
  <p class="mute" style="margin-top:0">Answers are computed only from your imported transactions, with the source transactions shown. No data is sent anywhere.</p>
  <div class="chips" style="margin-bottom:12px">${['How much did I spend on food last month?', 'Show my top 10 merchants', 'How much did I spend on Amazon this year?', 'Compare HDFC and SBI spending', 'How much did I spend on UPI?', 'What were my biggest expenses last month?', 'How much do I spend on subscriptions?', 'Show transactions above ₹10,000'].map(q => `<button class="chip" data-action="ask" data-q="${esc(q)}">${esc(q)}</button>`).join('')}</div>
  <div class="chat" id="chat">${S.chat.map(m => `<div class="msg ${m.role}">${esc(m.text)}</div>${m.sources?.length ? `<details style="align-self:stretch"><summary class="mute" style="cursor:pointer">Source transactions (${m.sources.length})</summary>${txTable(m.sources, { limit: 25 })}</details>` : ''}`).join('')}</div>
  <form class="row" data-form="ask" style="margin-top:12px"><input type="text" name="q" placeholder="Ask about your spending…" maxlength="200" style="flex:4" autocomplete="off"><button class="btn" style="flex:0">Ask</button></form></div>`;

const REPORTS = { monthly: 'Monthly Expense Report', annual: 'Annual Expense Report', category: 'Category Report', bank: 'Bank-wise Report', merchant: 'Merchant Report', transactions: 'Transaction Report' };
VIEWS.reports = () => {
  const r = S.report || 'monthly'; const c = ctx(); const m = S.reportMonth || curMonth(); const y = m.slice(0, 4);
  const months = [...new Set(S.state.transactions.map(t => monthKey(t.transaction_date)))].sort().reverse();
  const tx = r === 'annual' ? S.state.transactions.filter(t => t.transaction_date.startsWith(y)) : ['monthly'].includes(r) ? S.state.transactions.filter(t => t.transaction_date.startsWith(m)) : scoped();
  const k = A.kpis(tx, c); let body = '';
  if (r === 'monthly') body = `<div class="kpis">${kpi('Income', inr(k.income))}${kpi('Expenses', inr(k.expenses))}${kpi('Savings', inr(k.savings))}${kpi('Savings rate', k.savingsRate.toFixed(1) + '%')}${kpi('Investments', inr(k.investments))}${kpi('EMIs', inr(k.emis))}${kpi('Subscriptions', inr(k.subscriptions))}${kpi('Transfers (excluded)', inr(k.transfers))}</div>
    <div class="grid g2"><div class="card"><h3>Top categories</h3>${bars(A.byCategory(tx, c).slice(0, 8), { horizontal: true })}</div><div class="card"><h3>Top merchants</h3>${bars(A.byMerchant(tx, c).slice(0, 8), { horizontal: true })}</div></div>
    <div class="card" style="margin-top:16px"><h3>Unusual transactions</h3>${txTable(tx.filter(t => t.anomaly), { limit: 20 })}</div>`;
  else if (r === 'annual') { const ms = A.monthly(tx, c); body = `<div class="kpis">${kpi('Income ' + y, inr(k.income))}${kpi('Expenses', inr(k.expenses))}${kpi('Savings', inr(k.savings))}${kpi('Savings rate', k.savingsRate.toFixed(1) + '%')}</div><div class="card">${lines([{ name: 'Income', color: '#10B981', values: ms.map(x => x.income) }, { name: 'Expenses', color: '#EF4444', values: ms.map(x => x.expenses) }, { name: 'Savings', color: '#4F46E5', values: ms.map(x => x.savings) }], ms.map(x => monthName(x.month)))}
    <table><thead><tr><th>Month</th><th class="n">Income</th><th class="n">Expenses</th><th class="n">Savings</th><th class="n">Rate</th></tr></thead>${ms.map(x => `<tr><td>${monthName(x.month)}</td><td class="n">${inr(x.income)}</td><td class="n">${inr(x.expenses)}</td><td class="n">${inr(x.savings)}</td><td class="n">${x.savingsRate.toFixed(1)}%</td></tr>`).join('')}</table></div>
    <div class="grid g2" style="margin-top:16px"><div class="card"><h3>Categories</h3>${bars(A.byCategory(tx, c), { horizontal: true })}</div><div class="card"><h3>Bank comparison</h3>${bars(A.byBank(tx, c), { horizontal: true })}</div></div>`; }
  else if (r === 'category') body = `<div class="card"><table><thead><tr><th>Category</th><th class="n">Transactions</th><th class="n">Amount</th><th class="n">Share</th></tr></thead>${A.byCategory(tx, c).map(e => `<tr><td>${esc(e.key)}</td><td class="n">${e.count}</td><td class="n">${inr(e.value)}</td><td class="n">${(e.value / (k.expenses + k.refunds) * 100).toFixed(1)}%</td></tr>`).join('')}</table></div>`;
  else if (r === 'bank') body = `<div class="card"><table><thead><tr><th>Bank</th><th class="n">Income</th><th class="n">Expenses</th><th class="n">Transactions</th></tr></thead>${[...new Set(tx.map(t => t.bank_name))].map(b => { const bk = A.kpis(tx.filter(t => t.bank_name === b), c); return `<tr><td>${esc(b)}</td><td class="n">${inr(bk.income)}</td><td class="n">${inr(bk.expenses)}</td><td class="n">${bk.count}</td></tr>`; }).join('')}</table></div>`;
  else if (r === 'merchant') body = `<div class="card"><table><thead><tr><th>Merchant</th><th class="n">Transactions</th><th class="n">Amount</th><th class="n">Average</th></tr></thead>${A.byMerchant(tx, c).slice(0, 100).map(e => `<tr><td>${esc(e.key)}</td><td class="n">${e.count}</td><td class="n">${inr(e.value)}</td><td class="n">${inr(e.value / e.count)}</td></tr>`).join('')}</table></div>`;
  else body = `<div class="card">${txTable([...tx].sort((a, b) => b.transaction_date.localeCompare(a.transaction_date)), { limit: 1000 })}</div>`;
  return header('Reports', { filters: !['monthly', 'annual'].includes(r) }) + `<div class="card no-print" style="margin-bottom:16px"><div class="row">
    <label class="form">Report<select data-action="report">${Object.entries(REPORTS).map(([k2, v]) => `<option value="${k2}" ${k2 === r ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
    ${['monthly', 'annual'].includes(r) ? `<label class="form">${r === 'annual' ? 'Year (pick any month)' : 'Month'}<select data-action="report-month">${months.map(x => `<option value="${x}" ${x === m ? 'selected' : ''}>${monthName(x)}</option>`).join('')}</select></label>` : ''}
    <div style="display:flex;gap:8px;align-items:end;flex-wrap:wrap"><button class="btn ghost" data-action="export-csv">⬇ CSV</button><button class="btn ghost" data-action="export-xlsx">⬇ Excel</button><button class="btn" data-action="print">⎙ PDF</button></div></div></div>
  <h2 style="margin:4px 0 12px">${REPORTS[r]} <span class="mute" style="font-size:14px;font-weight:500">${r === 'monthly' ? monthName(m) : r === 'annual' ? y : ''}</span></h2>${body}`;
};

VIEWS.upload = () => {
  const u = S.upload; const steps = ['Uploading', 'Detecting bank format', 'Extracting transactions', 'Normalizing', 'Classifying, detecting duplicates, transfers & recurring payments', 'Finalizing'];
  const cur = steps.indexOf(u.step);
  return header('Upload bank statement', { filters: false }) + `<div class="grid g2"><div class="card">
  <form class="form" data-form="upload">
    <div class="row"><label>Bank<select name="bank"><option value="Auto">Auto-detect</option><option>HDFC</option><option>SBI</option><option value="Other">Other bank</option></select></label>
    <label>Account type<select name="accountType"><option>Savings</option><option>Current</option><option>Credit Card</option><option>Other</option></select></label></div>
    <div class="row"><label>Last 4 digits of account / card<input type="text" name="last4" inputmode="numeric" pattern="\\d{4}" maxlength="4" required placeholder="1234"></label><label>Nickname (optional)<input type="text" name="nickname" maxlength="40" placeholder="e.g. HDFC Salary"></label></div>
    ${u.needPassword ? `<label>PDF password <span class="mute">(used only in your browser to open the file; never stored)</span><input type="password" name="pdfpass" autocomplete="off" required></label>` : ''}
    <label class="drop" id="drop"><div class="big">⇪</div><b>Drop your statement here or tap to choose</b><div class="mute">PDF · CSV · XLSX · TXT — up to 15 MB</div><input type="file" name="file" accept=".pdf,.csv,.txt,.tsv,.xlsx" required hidden><div id="fname" class="mute" style="margin-top:6px"></div></label>
    <button class="btn" ${u.busy ? 'disabled' : ''}>${u.busy ? 'Processing…' : 'Process statement'}</button>
  </form>
  ${u.busy || u.result ? `<div class="steps">${steps.map((s, i) => `<span class="${u.result || i < cur ? 'done' : i === cur ? 'cur' : ''}">${i + 1}. ${s.split(',')[0]}</span>`).join('')}</div>` : ''}
  ${u.error ? `<div class="alert err">${esc(u.error)}</div>` : ''}
  ${u.result ? `<div class="alert okk">✅ <b>${u.result.processed.toLocaleString('en-IN')} transactions processed</b> from ${esc(u.result.bank)} (${fmtDate(u.result.from)} – ${fmtDate(u.result.to)})</div>
    <div class="result"><div><b>${u.result.categorized.toLocaleString('en-IN')}</b>successfully categorized</div><div><b>${u.result.needsReview}</b>need review</div><div><b>${u.result.duplicates}</b>duplicates found</div><div><b>${u.result.transfers}</b>internal transfers</div></div>
    <div class="row" style="margin-top:14px">${u.result.needsReview ? '<a class="btn ghost" href="#/review">Review transactions</a>' : ''}${S.state.budgets.length ? '' : '<a class="btn ghost" href="#/budgets">Set monthly budget</a>'}<a class="btn" href="#/dashboard">Go to dashboard →</a></div>` : ''}
  </div>
  <div class="card"><h3>How to download your statement</h3>
    <p><b>HDFC Bank</b> — NetBanking → Accounts → Account Statement → choose period → <i>Download as Delimited / Excel / PDF</i>.</p>
    <p><b>SBI</b> — OnlineSBI / YONO → My Accounts → Account Statement → select dates → <i>Download Excel / PDF</i>.</p>
    <p><b>Other banks</b> — any statement with Date, Description/Narration and Debit/Credit (or Amount + Dr/Cr) columns works; columns are detected automatically.</p>
    <div class="alert">🔒 MoneyLens never asks for your net-banking ID, password, OTP, UPI PIN, card PIN or CVV. Files are parsed in your browser and are not uploaded to any server.</div>
    <p class="mute" style="font-size:12px">Tip: upload the same period from both HDFC and SBI so transfers between your own accounts are matched and excluded from expenses. Re-uploading an overlapping statement is safe — duplicates are flagged, never auto-deleted.</p></div></div>`;
};

VIEWS.connect = () => `${header('Connect bank via Account Aggregator', { filters: false })}<div class="grid g2"><div class="card">
  <h3>⛓ Consent-based connection (RBI Account Aggregator)</h3>
  <p>Account Aggregators let you share bank statements digitally with your explicit, revocable consent — no passwords are shared with MoneyLens. Live AA access requires a regulated partner and a secure backend, so this free browser edition ships a <b>mock provider</b> for testing the flow with synthetic data.</p>
  <ol><li>Choose banks (HDFC, SBI)</li><li>Approve consent in your AA app (purpose, data range, expiry)</li><li>Statements are fetched & processed</li><li>Revoke consent anytime</li></ol>
  <button class="btn" data-action="aa-mock">Run mock AA consent (synthetic data)</button>
  <p class="mute" style="font-size:12px">Developers: implement <code>AccountAggregatorProvider</code> on a backend and set <code>AA_PROVIDER</code> / <code>AA_API_BASE</code>. See docs/ACCOUNT_AGGREGATOR.md.</p></div>
  <div class="card"><h3>Prefer statements?</h3><p>Uploading HDFC/SBI PDF, CSV or Excel statements works today with any bank.</p><a class="btn ghost" href="#/upload">Upload statement</a></div></div>`;

VIEWS.settings = () => {
  const st = { ...S.state.settings };
  return header('Settings & Privacy', { filters: false }) + `<div class="grid g2">
  <div class="card"><h3>Appearance</h3><button class="btn ghost" data-action="theme">Toggle light / dark mode</button></div>
  <div class="card"><h3>🔐 App lock</h3><p class="mute">Encrypt your data on this device with a passcode (AES-256-GCM, PBKDF2 key derivation). If you forget it, data cannot be recovered — only deleted.</p>
    ${store.hasPasscode() ? '<button class="btn ghost" data-action="lock">Lock now</button> <button class="btn ghost" data-action="rm-pass">Remove passcode</button>' : '<form class="row" data-form="pass"><input type="password" name="p1" placeholder="New passcode (6+ chars)" minlength="6" required autocomplete="new-password"><input type="password" name="p2" placeholder="Confirm" minlength="6" required autocomplete="new-password"><button class="btn" style="flex:0">Set</button></form>'}</div>
  <div class="card"><h3>Financial rules</h3><form class="form" data-form="settings">
    <label>Your name(s) as they appear in narrations (comma-separated) — helps detect own-account transfers<input type="text" name="selfNames" value="${esc((st.selfNames || []).join(', '))}" maxlength="120"></label>
    <label><span><input type="checkbox" name="excludeCcPaymentIfCardImported" ${st.excludeCcPaymentIfCardImported !== false ? 'checked' : ''}> Exclude credit-card bill payments from expenses when card statements are imported</span></label>
    <label><span><input type="checkbox" name="excludeRefundsFromIncome" ${st.excludeRefundsFromIncome !== false ? 'checked' : ''}> Treat refunds as reduced spending (not income)</span></label>
    <div class="row"><label>Transfer match window (days)<input type="number" name="transferWindowDays" min="0" max="10" value="${st.transferWindowDays ?? 3}"></label><label>Large cash withdrawal (₹)<input type="number" name="largeCashThreshold" min="0" value="${st.largeCashThreshold ?? 20000}"></label></div>
    <button class="btn">Save & recalculate</button></form></div>
  <div class="card"><h3>Your data</h3><p class="mute">Everything is stored only in this browser (IndexedDB). Clearing site data or switching devices loses it — export a backup.</p>
    <div class="row"><button class="btn ghost" data-action="backup">⬇ Export all my data (JSON)</button><label class="btn ghost" style="justify-content:center">⇪ Restore backup<input type="file" accept=".json" data-action="restore" hidden></label></div>
    <hr style="border:0;border-top:1px solid var(--line);margin:16px 0"><h3 class="neg">Delete</h3><p class="mute">Delete individual statements from <a href="#/accounts">Accounts</a>, or erase everything:</p><button class="btn danger" data-action="wipe">Delete all data & account</button></div>
  <div class="card"><h3>Legal</h3><a href="#/privacy">Privacy Policy</a> · <a href="#/terms">Terms of Service</a> · <a href="#/privacy">Data deletion</a></div></div>`;
};

VIEWS.admin = () => {
  const imp = S.state.imports, tx = S.state.transactions;
  return header('Diagnostics', { filters: false }) + `<div class="kpis">${kpi('Imports', imp.length)}${kpi('Transactions', tx.length.toLocaleString('en-IN'))}${kpi('Uncategorized', tx.filter(t => t.category === 'Other').length)}${kpi('Flagged for review', reviewCount())}${kpi('Errors', (S.state.errors || []).length)}</div>
  <div class="card"><h3>Import status</h3><p class="mute" style="margin-top:0">No financial values are shown here.</p><table><thead><tr><th>Import</th><th>Status</th><th>Parser</th><th>Detected</th><th class="n">Rows</th><th class="n">Review</th><th class="n">Time</th></tr></thead>${imp.map(i => `<tr><td>${esc(i.id)}</td><td><span class="pill g">${esc(i.status)}</span></td><td>${esc(i.kind)} / ${esc(i.bank)}</td><td>${esc(i.detectedBank)}</td><td class="n">${i.processed}</td><td class="n">${i.needsReview}</td><td class="n">${i.ms} ms</td></tr>`).join('')}</table></div>
  <div class="card" style="margin-top:16px"><h3>Errors</h3><table>${(S.state.errors || []).slice(-30).reverse().map(e => `<tr><td>${esc(e.at)}</td><td>${esc(e.code)}</td><td>${esc(e.message)}</td></tr>`).join('') || '<tr><td class="mute">None</td></tr>'}</table></div>
  <div class="card" style="margin-top:16px"><h3>Audit log</h3><div class="tbl" style="max-height:300px"><table>${S.state.audit.slice(-100).reverse().map(a => `<tr><td>${esc(a.at)}</td><td>${esc(a.action)}</td><td class="mute">${esc(Object.entries(a).filter(([k]) => !['at', 'action'].includes(k)).map(([k, v]) => k + '=' + v).join(' '))}</td></tr>`).join('')}</table></div></div>`;
};

VIEWS.privacy = () => header('Privacy Policy & Data Deletion', { filters: false }) + `<div class="card" style="max-width:820px;line-height:1.65">
  <p><b>Summary:</b> MoneyLens India runs entirely in your web browser. Your statements and transactions are processed and stored on your device only. We operate no server that receives your financial data.</p>
  <h3>What we collect</h3><p>Nothing is transmitted to us. Data you import (transactions, budgets, net-worth entries) is stored in your browser's IndexedDB, optionally encrypted with your passcode. Only the last 4 digits of account numbers are kept, displayed as XXXX XXXX 1234.</p>
  <h3>What we never ask for</h3><p>Net-banking user IDs or passwords, OTPs, UPI PINs, debit-card PINs or CVVs. If anyone asks for these on behalf of MoneyLens, it is not us. PDF statement passwords, if needed, are used only in memory to open the file and are never stored.</p>
  <h3>Account Aggregator</h3><p>Any future live bank connection will use RBI's consent-based Account Aggregator framework. You will see the purpose, data range and expiry before approving, and can revoke consent at any time.</p>
  <h3>Your rights & data deletion</h3><p>Export all your data from Settings → Export. Delete a single statement from Accounts, edit or ignore single transactions, or erase everything from Settings → Delete all data. Clearing your browser's site data also deletes everything.</p>
  <h3>Hosting</h3><p>The static app is served by GitHub Pages, which may log standard request metadata (e.g. IP address) as described in GitHub's privacy statement. No analytics or third-party trackers are included.</p></div>`;
VIEWS.terms = () => header('Terms of Service', { filters: false }) + `<div class="card" style="max-width:820px;line-height:1.65">
  <p>MoneyLens India is free, open-source software provided "as is" under the MIT License, without warranty of any kind.</p>
  <h3>Not financial advice</h3><p>Insights, categories, recurring-payment detection, EMI estimates and anomaly flags are automated, may be inaccurate, and are for informational purposes only. They are not investment, tax, credit or legal advice. Verify important figures against your bank statements.</p>
  <h3>Your responsibilities</h3><p>Only import statements you are authorised to use. Keep your device and passcode secure, and export backups — data stored in your browser can be lost if site data is cleared.</p>
  <h3>Trademarks</h3><p>HDFC Bank, SBI and other bank names are trademarks of their respective owners and are used only to identify statement formats. MoneyLens is not affiliated with or endorsed by any bank.</p></div>`;

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
    <label><span><input type="checkbox" name="transfer" ${t.is_transfer ? 'checked' : ''}> This is a transfer between my own accounts (exclude from income/expenses)</span></label>
    <label><span><input type="checkbox" name="ignore" ${t.excluded ? 'checked' : ''}> Ignore this transaction in all calculations</span></label>
    <div class="row"><button class="btn" type="submit">Save & learn</button><button class="btn ghost" type="button" data-action="close">Cancel</button></div>
    <p class="mute" style="font-size:12px;margin:0">Your merchant/category correction will also apply to other transactions from this ${t.upi_id ? 'UPI ID' : 'merchant'}.</p></form>`);
}

/* ----------------------------- actions ----------------------------- */
async function loadDemo() {
  const d = generateDemo(demoEnd()); const st = emptyState(); const toRows = rows => rows;
  const add = (rows, bank, type, last4, nick) => ingest(st, { kind: 'csv', rows: [['Date', 'Narration', 'Ref', 'Withdrawal', 'Deposit', 'Balance'], ...toRows(rows).map(r => [r.date, r.description, r.reference, r.debit || '', r.credit || '', r.balance ?? ''])], fileName: `demo-${bank}-${type}.csv`, bank, accountType: type, last4, nickname: nick });
  add(d.HDFC, 'HDFC', 'Savings', '1234', 'HDFC Savings'); add(d.SBI, 'SBI', 'Savings', '9876', 'SBI Savings'); add(d.CARD, 'HDFC', 'Credit Card', '4321', 'HDFC Credit Card');
  st.demo = true;
  st.budgets = [['Food & Dining', 10000], ['Transport', 5000], ['Shopping', 8000], ['Entertainment', 3000], ['Bills & Utilities', 15000]].map(([category, amount]) => ({ category, amount }));
  st.loans = [{ name: 'HDFC Home Loan (demo)', principal: 2000000, rate: 8.5, tenure: 180, start: addDays(today(), -365 * 2), emi: 18000 }];
  const cardAcc = st.accounts.find(a => a.account_type === 'Credit Card');
  st.creditCards = [{ account_id: cardAcc.id, limit: 200000, outstanding: 11240, paymentDue: 11240, minDue: 562, statementDate: addDays(today(), -8), dueDate: addDays(today(), 12) }];
  st.netWorthItems = [{ kind: 'asset', type: 'Mutual Funds', name: 'Equity MFs', value: 640000 }, { kind: 'asset', type: 'FD', name: 'SBI FD', value: 300000 }, { kind: 'asset', type: 'Gold', name: 'Gold', value: 150000 }, { kind: 'liability', type: 'Home Loan', name: 'HDFC Home Loan', value: 1680000 }];
  st.netWorthHistory = [...Array(6)].map((_, i) => { const m = new Date(); m.setMonth(m.getMonth() - 5 + i); return { month: m.toISOString().slice(0, 7), assets: 1500000 + i * 42000, liabilities: 1740000 - i * 12000, netWorth: -240000 + i * 54000 }; });
  S.state = st; S.f = { period: 'this_month', bank: 'All', account: 'All', from: '', to: '' }; await store.save(st); location.hash = '#/dashboard'; render();
}

function processFile(form) {
  const fd = new FormData(form); const file = fd.get('file');
  if (!file || !file.size) { S.upload.error = 'Please choose a statement file.'; return render(); }
  if (!/^\d{4}$/.test(fd.get('last4') || '')) { S.upload.error = 'Enter exactly 4 digits.'; return render(); }
  const meta = { bank: fd.get('bank'), accountType: fd.get('accountType'), last4: fd.get('last4'), nickname: (fd.get('nickname') || '').toString().slice(0, 40) };
  S.upload = { busy: true, step: 'Uploading', result: null, error: null, needPassword: S.upload.needPassword, meta };
  if (S.state.demo) { S.state = emptyState(); }
  render();
  readStatementFile(file, fd.get('pdfpass')).then(parsed => {
    const input = { ...parsed, fileName: file.name, ...meta };
    const done = (state, summary) => { S.state = state; S.upload = { busy: false, step: 'Finalizing', result: summary, error: null, needPassword: false }; persist(); render(); };
    try {
      const w = new Worker(new URL('../worker.js', import.meta.url), { type: 'module' });
      w.onmessage = ({ data }) => {
        if (data.type === 'step') { S.upload.step = data.step; render(); }
        else if (data.type === 'done') { w.terminate(); done(data.state, data.summary); }
        else { w.terminate(); fail(data.message, data.code); }
      };
      w.onerror = () => { w.terminate(); try { const s = ingest(S.state, input, st => (S.upload.step = st)); done(S.state, s); } catch (e) { fail(e.userMessage || 'Unable to read this statement.', 'PARSE'); } };
      w.postMessage({ state: S.state, input });
    } catch { const s = ingest(S.state, input); done(S.state, s); }
  }).catch(e => fail(e.userMessage || 'Unable to read this statement.', e.detail === 'PDF_PASSWORD' ? 'PDF_PASSWORD' : 'READ'));
  function fail(msg, code) {
    (S.state.errors = S.state.errors || []).push({ at: new Date().toISOString(), code, message: msg }); // no file contents logged
    S.upload = { busy: false, step: '', result: null, error: msg, needPassword: code === 'PDF_PASSWORD' || S.upload.needPassword }; persist(); render();
  }
}

function download(name, data, type) { const b = new Blob([data], { type }); const a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000); }
const EXPORT_COLS = ['transaction_id', 'bank_name', 'account_number_masked', 'account_type', 'transaction_date', 'value_date', 'description', 'reference_number', 'debit', 'credit', 'balance', 'transaction_type', 'payment_mode', 'merchant', 'upi_id', 'category', 'subcategory', 'confidence_score', 'is_transfer', 'is_recurring', 'is_subscription', 'is_cash_withdrawal', 'is_salary', 'is_bill_payment', 'is_refund', 'is_investment', 'is_emi', 'is_duplicate', 'user_verified_category'];
const csvCell = v => { let s = String(v ?? ''); if (/^[=+\-@]/.test(s) && isNaN(+s)) s = "'" + s; return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; }; // CSV-injection safe
function exportCSV(list, name) { download(name, '\uFEFF' + [EXPORT_COLS.join(','), ...list.map(t => EXPORT_COLS.map(c => csvCell(t[c])).join(','))].join('\n'), 'text/csv'); audit(S.state, 'export_csv', { rows: list.length }); persist(); }
async function exportXLSX() {
  const c = ctx(); const tx = scoped();
  if (!window.JSZip) await new Promise((res, rej) => { const s = document.createElement('script'); s.src = 'vendor/jszip/jszip.min.js'; s.onload = res; s.onerror = rej; document.head.appendChild(s); });
  const k = A.kpis(tx, c);
  const sheets = [
    { name: 'Summary', rows: [['Metric', 'Value'], ['Income', k.income], ['Expenses', k.expenses], ['Savings', k.savings], ['Savings rate %', k.savingsRate], ['Investments', k.investments], ['EMIs', k.emis], ['Bills', k.bills], ['UPI', k.upi], ['Cash', k.cash], ['Internal transfers (excluded)', k.transfers]] },
    { name: 'Monthly', rows: [['Month', 'Income', 'Expenses', 'Savings', 'Savings rate %'], ...A.monthly(tx, c).map(m => [m.month, m.income, m.expenses, m.savings, m.savingsRate])] },
    { name: 'Categories', rows: [['Category', 'Amount', 'Transactions'], ...A.byCategory(tx, c).map(e => [e.key, e.value, e.count])] },
    { name: 'Merchants', rows: [['Merchant', 'Amount', 'Transactions'], ...A.byMerchant(tx, c).map(e => [e.key, e.value, e.count])] },
    { name: 'Transactions', rows: [EXPORT_COLS, ...tx.map(t => EXPORT_COLS.map(col => typeof t[col] === 'boolean' ? (t[col] ? 'Yes' : 'No') : t[col] ?? ''))] },
  ];
  download(`moneylens-report-${today()}.xlsx`, await writeXlsx(sheets, window.JSZip), 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  audit(S.state, 'export_xlsx', { rows: tx.length }); persist();
}

const MORE = ['subscriptions', 'emis', 'cards', 'cashflow', 'networth', 'calendar', 'accounts', 'review', 'assistant', 'reports', 'upload', 'connect', 'settings'];
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
  if (el.tagName === 'SELECT' || el.tagName === 'INPUT' && el.type !== 'button') return;
  e.preventDefault();
  const reRun = () => { runIntelligence(S.state, A.latestDate(S.state.transactions)); persist(); render(); };
  switch (a) {
    case 'menu': if (innerWidth <= 860 && !el.classList.contains('menu-btn')) { modal(`<h2>More</h2><div class="nav">${NAV.filter(n => MORE.includes(n[0])).map(([k, ic, l]) => `<a href="#/${k}" data-action="close-nav"><span class="ic">${ic}</span>${l}</a>`).join('')}</div>`); } else { S.sidebar = !S.sidebar; render(); } break;
    case 'close-nav': closeModal(); location.hash = el.getAttribute('href'); break;
    case 'demo': await loadDemo(); toast('Demo loaded — synthetic data'); break;
    case 'exit-demo': if (confirm('Remove demo data and start fresh?')) { S.state = emptyState(); await store.save(S.state); location.hash = '#/welcome'; render(); } break;
    case 'edit-tx': editTx(id); break;
    case 'close': closeModal(); break;
    case 'rv': correctTransaction(S.state, id, { [el.dataset.op]: true }); persist(); render(); toast('Saved'); break;
    case 'del-budget': S.state.budgets = S.state.budgets.filter(b => b.category !== el.dataset.cat); persist(); render(); break;
    case 'suggest-budgets': { const c = ctx(); const [f] = A.periodRange('3m', anchor()); const cats = A.byCategory(A.filterTxns(S.state.transactions, { from: f, to: anchor() }), c).filter(x => !['Transfers', 'Cash', 'Other', 'Finance', 'Housing'].includes(x.key)).slice(0, 6);
      for (const x of cats) { const amt = Math.ceil(x.value / 3 / 500) * 500; const b = S.state.budgets.find(y => y.category === x.key); if (b) b.amount = amt; else S.state.budgets.push({ category: x.key, amount: amt }); } persist(); render(); toast('Budgets set to your 3-month average'); break; }
    case 'del-loan': S.state.loans.splice(+el.dataset.i, 1); persist(); render(); break;
    case 'del-nw': S.state.netWorthItems.splice(+el.dataset.i, 1); persist(); render(); break;
    case 'nw-prefill': for (const acc of A.accountSummary(S.state, ctx()).filter(x => x.balance !== null && x.account_type !== 'Credit Card')) { const name = `${acc.nickname} ${acc.account_number_masked.slice(-4)}`; const ex = S.state.netWorthItems.find(i => i.name === name); if (ex) ex.value = acc.balance; else S.state.netWorthItems.push({ kind: 'asset', type: 'Bank Balance', name, value: acc.balance }); } persist(); render(); break;
    case 'nw-snapshot': { const nw = A.netWorth(S.state.netWorthItems); const m = today().slice(0, 7); S.state.netWorthHistory = S.state.netWorthHistory.filter(h => h.month !== m).concat({ month: m, ...nw }).sort((x, y) => x.month.localeCompare(y.month)); persist(); render(); toast('Snapshot saved'); break; }
    case 'cal': S.calMonth = el.dataset.m; render(); break;
    case 'filter-account': S.f.account = id; location.hash = '#/dashboard'; break;
    case 'del-import': if (confirm('Delete this statement and all its transactions?')) { deleteImport(S.state, id); persist(); render(); toast('Statement deleted'); } break;
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
    case 'wipe': if (confirm('Permanently delete ALL MoneyLens data on this device? This cannot be undone.')) { await store.wipeAll(); S.state = emptyState(); location.hash = '#/welcome'; render(); toast('All data deleted'); } break;
    case 'forgot': if (confirm('Without the passcode your encrypted data cannot be recovered. Delete all data and start over?')) { await store.wipeAll(); location.hash = ''; location.reload(); } break;
    case 'aa-mock': { const prov = new MockAccountAggregatorProvider(generateDemo(demoEnd())); const { consentHandle } = await prov.initiateConsent({ banks: ['HDFC', 'SBI'] });
      if (S.state.demo || !hasData()) S.state = emptyState();
      for (const acc of await prov.fetchAccounts(consentHandle)) { const rows = await prov.fetchTransactions(consentHandle, acc);
        ingest(S.state, { kind: 'csv', rows: [['Date', 'Narration', 'Ref', 'Withdrawal', 'Deposit', 'Balance'], ...rows.map(r => [r.date, r.description, r.reference, r.debit || '', r.credit || '', r.balance ?? ''])], fileName: `aa-mock-${acc.bank}`, bank: acc.bank, accountType: acc.type, last4: acc.maskedAccNumber, nickname: `${acc.bank} (AA mock)` }); }
      S.state.demo = true; audit(S.state, 'aa_mock_consent'); await prov.revokeConsent(consentHandle); await store.save(S.state); location.hash = '#/dashboard'; toast('Mock AA data imported (synthetic)'); break; }
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
  if (el.dataset.action === 'restore' && el.files[0]) {
    el.files[0].text().then(async txt => { try { const s = JSON.parse(txt); if (!Array.isArray(s.transactions) || !Array.isArray(s.accounts)) throw 0; S.state = { ...emptyState(), ...s }; await store.save(S.state); toast('Backup restored'); render(); } catch { toast('This is not a valid MoneyLens backup.'); } });
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
    case 'unlock': try { S.state = await store.unlock(fd.get('pass')); addEventListener('hashchange', () => { S.sidebar = false; render(); }); render(); } catch { renderLock('Incorrect passcode.'); } break;
    case 'upload': processFile(f); break;
    case 'budget': { const cat = fd.get('category'), amt = +fd.get('amount'); if (!(amt > 0)) return; const b = S.state.budgets.find(x => x.category === cat); if (b) b.amount = amt; else S.state.budgets.push({ category: cat, amount: amt }); persist(); render(); break; }
    case 'loan': S.state.loans.push({ name: String(fd.get('name')).slice(0, 60), principal: +fd.get('principal'), rate: +fd.get('rate'), tenure: +fd.get('tenure'), emi: +fd.get('emi') || 0, start: fd.get('start') }); persist(); render(); break;
    case 'card': { const id = f.dataset.id; const o = { account_id: id }; for (const k of ['limit', 'outstanding', 'paymentDue', 'minDue']) o[k] = +fd.get(k) || 0; for (const k of ['statementDate', 'dueDate']) o[k] = fd.get(k) || ''; S.state.creditCards = S.state.creditCards.filter(c => c.account_id !== id).concat(o); persist(); render(); toast('Card details saved'); break; }
    case 'nw': { const [kind2, type] = String(fd.get('type')).split('|'); S.state.netWorthItems.push({ kind: kind2, type, name: String(fd.get('name')).slice(0, 60), value: Math.abs(+fd.get('value')) }); persist(); render(); break; }
    case 'edit-tx': { const id = f.dataset.id; const t = S.state.transactions.find(x => x.transaction_id === id); const ch = {};
      const merchant = String(fd.get('merchant') || '').trim().slice(0, 60); if (merchant && merchant !== t.merchant) ch.merchant = merchant;
      if (fd.get('category') !== t.category || fd.get('subcategory') !== t.subcategory || !t.user_verified_category) { ch.category = fd.get('category'); ch.subcategory = fd.get('subcategory'); }
      if (fd.get('transfer') && !t.is_transfer) ch.markTransfer = true; if (!fd.get('transfer') && t.is_transfer) ch.notTransfer = true;
      if (fd.get('ignore')) ch.ignore = true; else if (t.excluded) t.excluded = false;
      ch.approve = true; correctTransaction(S.state, id, ch); persist(); closeModal(); render(); toast('Saved — MoneyLens will remember this'); break; }
    case 'ask': askQ(fd.get('q')); break;
    case 'pass': if (fd.get('p1') !== fd.get('p2')) return toast('Passcodes do not match'); try { await store.setPasscode(fd.get('p1'), S.state); toast('Passcode set — data encrypted'); render(); } catch (err) { toast(err.message); } break;
    case 'settings': { const s = S.state.settings; s.selfNames = String(fd.get('selfNames') || '').split(',').map(x => x.trim()).filter(Boolean).slice(0, 5);
      s.excludeCcPaymentIfCardImported = !!fd.get('excludeCcPaymentIfCardImported'); s.excludeRefundsFromIncome = !!fd.get('excludeRefundsFromIncome');
      s.transferWindowDays = Math.min(10, Math.max(0, +fd.get('transferWindowDays') || 0)); s.largeCashThreshold = Math.max(0, +fd.get('largeCashThreshold') || 0);
      reRunAll(); toast('Rules saved & recalculated'); break; }
  }
});
function reRunAll() { runIntelligence(S.state, A.latestDate(S.state.transactions)); persist(); render(); }

boot();
