// Analytics — every number is derived from the dataset (no hard-coded values).
import { round2, sum, monthKey, addDays, addMonths, median, inr } from './utils.js';
import { ESSENTIAL } from './classifier.js';
import { DEFAULT_SETTINGS } from './pipeline.js';

export function isExpense(t, ctx) {
  if (!(t.debit > 0) || t.is_duplicate || t.is_transfer || t.excluded) return false;
  if (t.category === 'Investment' || t.category === 'Transfers' && t.subcategory === 'Own Account Transfer') return false;
  if (t.is_cc_payment && ctx.excludeCcPayment) return false;
  return true;
}
export function isIncome(t, ctx) {
  if (!(t.credit > 0) || t.is_duplicate || t.is_transfer || t.excluded || t.is_cc_payment_received) return false;
  if (t.is_refund && ctx.settings.excludeRefundsFromIncome) return false;
  if (t.account_type === 'Credit Card') return false;
  return true;
}
export function makeCtx(state) {
  const settings = { ...DEFAULT_SETTINGS, ...(state.settings || {}) };
  const hasCard = state.accounts.some(a => a.account_type === 'Credit Card');
  return { settings, excludeCcPayment: settings.excludeCcPaymentIfCardImported && hasCard };
}
const expAmt = t => t.debit;
export function latestDate(txns) { return txns.reduce((m, t) => (t.transaction_date > m ? t.transaction_date : m), '0000-00-00'); }

export function periodRange(period, anchor, custom = {}) {
  const a = new Date(anchor + 'T00:00:00Z'); const y = a.getUTCFullYear(), m = a.getUTCMonth();
  const first = (yy, mm) => new Date(Date.UTC(yy, mm, 1)).toISOString().slice(0, 10);
  const last = (yy, mm) => new Date(Date.UTC(yy, mm + 1, 0)).toISOString().slice(0, 10);
  switch (period) {
    case 'this_month': return [first(y, m), last(y, m)];
    case 'last_month': return [first(y, m - 1), last(y, m - 1)];
    case '3m': return [first(y, m - 2), last(y, m)];
    case '6m': return [first(y, m - 5), last(y, m)];
    case '12m': return [first(y, m - 11), last(y, m)];
    case 'this_year': return [first(y, 0), last(y, 11)];
    case 'custom': return [custom.from || '1990-01-01', custom.to || '2100-12-31'];
    default: return ['1990-01-01', '2100-12-31'];
  }
}
export function previousRange(period, anchor, custom = {}) {
  const shift = { this_month: 1, last_month: 1, '3m': 3, '6m': 6, '12m': 12, this_year: 12 }[period];
  const a = new Date(anchor + 'T00:00:00Z');
  if (shift) { const back = new Date(Date.UTC(a.getUTCFullYear(), a.getUTCMonth() - shift, Math.min(a.getUTCDate(), 28))).toISOString().slice(0, 10); return periodRange(period, back); }
  const [f, t] = periodRange(period, anchor, custom); const days = Math.round((new Date(t) - new Date(f)) / 864e5) + 1;
  return [new Date(new Date(f).getTime() - days * 864e5).toISOString().slice(0, 10), new Date(new Date(f).getTime() - 864e5).toISOString().slice(0, 10)];
}
export function filterTxns(txns, { from, to, bank = 'All', account = 'All' } = {}) {
  return txns.filter(t => (!from || t.transaction_date >= from) && (!to || t.transaction_date <= to) && (bank === 'All' || t.bank_name === bank) && (account === 'All' || t.account_id === account));
}

export function kpis(txns, ctx) {
  const exp = txns.filter(t => isExpense(t, ctx)), inc = txns.filter(t => isIncome(t, ctx));
  const income = round2(sum(inc, t => t.credit));
  const refunds = ctx.settings.excludeRefundsFromIncome ? round2(sum(txns.filter(t => t.credit > 0 && (t.is_refund || (t.account_type === 'Credit Card' && !t.is_cc_payment_received && !t.is_transfer)) && !t.is_duplicate), t => t.credit)) : 0;
  const expenses = round2(sum(exp, expAmt) - refunds);
  const investments = round2(sum(txns.filter(t => t.debit > 0 && !t.is_duplicate && !t.is_transfer && t.category === 'Investment'), t => t.debit));
  const savings = round2(income - expenses);
  return {
    income, expenses, refunds, savings, savingsRate: income ? round2(savings / income * 100) : 0, investments,
    bills: round2(sum(exp.filter(t => t.is_bill_payment), expAmt)), emis: round2(sum(exp.filter(t => t.is_emi), expAmt)),
    subscriptions: round2(sum(exp.filter(t => t.is_subscription), expAmt)), upi: round2(sum(exp.filter(t => t.payment_mode === 'UPI'), expAmt)),
    cards: round2(sum(exp.filter(t => ['Debit Card', 'Credit Card'].includes(t.payment_mode)), expAmt)), cash: round2(sum(exp.filter(t => t.is_cash_withdrawal), expAmt)),
    transfers: round2(sum(txns.filter(t => t.is_transfer && t.debit > 0 && !t.is_duplicate), t => t.debit)), count: txns.length, expenseCount: exp.length,
  };
}
export function groupSum(txns, ctx, keyFn, { type = 'expense' } = {}) {
  const pred = type === 'expense' ? t => isExpense(t, ctx) : t => isIncome(t, ctx);
  const m = new Map();
  for (const t of txns) if (pred(t)) { const k = keyFn(t); const v = type === 'expense' ? t.debit : t.credit; const e = m.get(k) || { key: k, value: 0, count: 0 }; e.value += v; e.count++; m.set(k, e); }
  return [...m.values()].map(e => ({ ...e, value: round2(e.value) })).sort((a, b) => b.value - a.value);
}
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
export const byCategory = (x, c) => groupSum(x, c, t => t.category);
export const bySubcategory = (x, c, cat) => groupSum(x.filter(t => t.category === cat), c, t => t.subcategory);
export const byMerchant = (x, c) => groupSum(x, c, t => t.merchant);
export const byMode = (x, c) => groupSum(x, c, t => t.payment_mode);
export const byBank = (x, c) => groupSum(x, c, t => t.bank_name);
export const byDow = (x, c) => { const g = groupSum(x, c, t => DOW[new Date(t.transaction_date + 'T00:00:00Z').getUTCDay()]); return DOW.map(d => g.find(e => e.key === d) || { key: d, value: 0, count: 0 }); };
export const byWeekend = (x, c) => groupSum(x, c, t => [0, 6].includes(new Date(t.transaction_date + 'T00:00:00Z').getUTCDay()) ? 'Weekend' : 'Weekday');
export const byWeek = (x, c) => groupSum(x, c, t => { const d = new Date(t.transaction_date + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7)); return d.toISOString().slice(0, 10); }).sort((a, b) => a.key.localeCompare(b.key));
export function monthly(txns, ctx) {
  const months = [...new Set(txns.map(t => monthKey(t.transaction_date)))].sort();
  return months.map(m => ({ month: m, ...kpis(txns.filter(t => t.transaction_date.startsWith(m)), ctx) }));
}
export function dailyHeat(txns, ctx) { const m = new Map(); for (const t of txns) if (isExpense(t, ctx)) m.set(t.transaction_date, (m.get(t.transaction_date) || 0) + t.debit); return m; }

export function scorecard(allTxns, ctx, monthStr) {
  const [y, mo] = monthStr.split('-').map(Number);
  const prev = new Date(Date.UTC(y, mo - 2, 1)).toISOString().slice(0, 7);
  const calc = ms => {
    const tx = allTxns.filter(t => t.transaction_date.startsWith(ms));
    const k = kpis(tx, ctx); const cats = byCategory(tx, ctx);
    const exp = tx.filter(t => isExpense(t, ctx));
    const essential = sum(exp.filter(t => ESSENTIAL.has(t.category)), t => t.debit);
    const pct = v => (k.income ? round2(v / k.income * 100) : 0);
    const catv = c => cats.find(e => e.key === c)?.value || 0;
    return { Income: k.income, Expenses: k.expenses, Savings: k.savings, 'Savings %': k.savingsRate, 'Investment %': pct(k.investments),
      'Essential %': k.expenses ? round2(essential / (k.expenses + k.refunds) * 100) : 0, 'Discretionary %': k.expenses ? round2(100 - essential / (k.expenses + k.refunds) * 100) : 0,
      'EMI %': pct(k.emis), 'Subscription %': pct(k.subscriptions), 'Food & Dining': catv('Food & Dining'), Transport: catv('Transport'), Shopping: catv('Shopping'), 'Bills & Utilities': catv('Bills & Utilities') };
  };
  const cur = calc(monthStr), pv = calc(prev);
  return Object.keys(cur).map(metric => { const c = cur[metric], p = pv[metric]; const isPct = metric.includes('%');
    return { metric, current: c, previous: p, change: round2(c - p), changePct: !isPct && p ? round2((c - p) / p * 100) : null, isPct }; })
    .concat([{ metric: '__months', current: monthStr, previous: prev }]);
}
export function budgetStatus(budgets, txns, ctx, monthStr) {
  const cats = byCategory(txns.filter(t => t.transaction_date.startsWith(monthStr)), ctx);
  return budgets.map(b => { const actual = cats.find(c => c.key === b.category)?.value || 0; const util = b.amount ? round2(actual / b.amount * 100) : 0;
    return { ...b, actual, remaining: round2(b.amount - actual), utilization: util, status: util >= 100 ? 'exceeded' : util >= 80 ? 'nearing' : 'ok' }; });
}
export function cashFlow(txns, ctx, accounts) {
  return monthly(txns, ctx).map(r => {
    let opening = 0, closing = 0, known = true;
    for (const a of accounts.filter(a => a.account_type !== 'Credit Card')) {
      const at = txns.filter(t => t.account_id === a.id && t.balance !== null && !t.is_duplicate).sort((x, y) => x.transaction_date.localeCompare(y.transaction_date));
      const inM = at.filter(t => t.transaction_date.startsWith(r.month)); const before = at.filter(t => t.transaction_date < r.month + '-01');
      if (!inM.length && !before.length) { known = false; continue; }
      const firstIn = inM[0];
      opening += before.length ? before[before.length - 1].balance : (firstIn ? firstIn.balance - firstIn.credit + firstIn.debit : 0);
      closing += inM.length ? inM[inM.length - 1].balance : before[before.length - 1].balance;
    }
    return { month: r.month, opening: round2(opening), income: r.income, expenses: r.expenses, transfers: r.transfers, investments: r.investments, closing: round2(closing), balancesKnown: known };
  });
}
export function accountSummary(state, ctx) {
  return state.accounts.map(a => {
    const tx = state.transactions.filter(t => t.account_id === a.id && !t.is_duplicate).sort((x, y) => x.transaction_date.localeCompare(y.transaction_date));
    const last = tx[tx.length - 1]; const k = kpis(tx, ctx); const months = new Set(tx.map(t => monthKey(t.transaction_date))).size || 1;
    return { ...a, balance: last?.balance ?? null, lastDate: last?.transaction_date || null, income: k.income, expenses: k.expenses, monthlySpend: round2(k.expenses / months), count: tx.length };
  });
}
export function emiSchedule({ principal, ratePct, tenureMonths, startDate, emi }) {
  const r = ratePct / 1200;
  const calcEmi = r ? principal * r * (1 + r) ** tenureMonths / ((1 + r) ** tenureMonths - 1) : principal / tenureMonths;
  const E = emi || calcEmi; const now = new Date(); const start = startDate ? new Date(startDate) : now;
  const paid = Math.max(0, Math.min(tenureMonths, (now.getFullYear() - start.getFullYear()) * 12 + now.getMonth() - start.getMonth()));
  let bal = principal, interestPaid = 0, principalPaid = 0;
  for (let i = 0; i < paid && bal > 0; i++) { const int = bal * r; const pr = Math.min(E - int, bal); bal -= pr; interestPaid += int; principalPaid += pr; }
  return { emi: round2(E), paidInstallments: paid, remainingTenure: tenureMonths - paid, outstanding: round2(Math.max(bal, 0)), interestPaid: round2(interestPaid), principalPaid: round2(principalPaid), totalInterest: round2(E * tenureMonths - principal), estimate: true };
}

/** Outstanding for an imported loan: exact (bank figure from EMI table) or estimate (statement of account). */
export function loanOutstanding(l) {
  if (l.outstandingAsPerBank && l.outstanding != null) return { outstanding: l.outstanding, principalPaid: l.principalPaid, interestPaid: l.interestPaid, remainingTenure: l.remainingEmis, paidInstallments: l.emisPaid, exact: true };
  if (!l.firstEmiDate || !l.estTenureMonths || !l.loanAmount) return null;
  return { ...emiSchedule({ principal: l.loanAmount, ratePct: l.rate, tenureMonths: l.estTenureMonths, startDate: l.firstEmiDate, emi: l.currentEmi }), exact: false };
}

export function netWorth(items) {
  const assets = round2(sum(items.filter(i => i.kind === 'asset'), i => +i.value || 0));
  const liabilities = round2(sum(items.filter(i => i.kind === 'liability'), i => +i.value || 0));
  return { assets, liabilities, netWorth: round2(assets - liabilities) };
}

export function calendarEvents(state, fromDate, days = 45) {
  const ev = [], to = addDays(fromDate, days);
  for (const r of state.recurring || []) {
    let d = r.next_expected; const step = { Weekly: 7, Monthly: 30, Quarterly: 91, Annual: 365 }[r.frequency];
    while (d < fromDate) d = addDays(d, step);
    while (d <= to) { ev.push({ date: d, title: r.merchant, amount: r.amount, type: r.is_emi ? 'EMI' : r.is_sip ? 'SIP' : r.is_subscription ? 'Subscription' : r.subcategory === 'Insurance' ? 'Insurance' : 'Bill' }); d = addDays(d, step); }
  }
  for (const l of state.loanAccounts || []) {
    if (l.schedule?.length) { for (const s of l.schedule) if (s.date >= fromDate && s.date <= to) ev.push({ date: s.date, title: `${l.product} EMI`, amount: s.emi, type: 'Loan EMI' }); continue; }
    const emis = (l.transactions || []).filter(t => t.type === 'EMI' && t.amount > 0).map(t => t.date).sort();
    if (!emis.length || !l.currentEmi) continue;
    let d = addMonths(emis[emis.length - 1], 1);
    while (d < fromDate) d = addMonths(d, 1);
    while (d <= to) { ev.push({ date: d, title: `${l.product || 'Loan'} EMI`, amount: l.currentEmi, type: 'Loan EMI' }); d = addMonths(d, 1); }
  }
  const sal = state.transactions.filter(t => t.is_salary && !t.is_duplicate).map(t => +t.transaction_date.slice(8));
  if (sal.length >= 2) { const day = Math.round(median(sal)); let d = fromDate.slice(0, 8) + String(Math.min(day, 28)).padStart(2, '0'); if (d < fromDate) d = addDays(d, 30).slice(0, 8) + String(Math.min(day, 28)).padStart(2, '0'); if (d <= to) ev.push({ date: d, title: 'Expected salary', type: 'Salary' }); }
  for (const c of state.creditCards || []) if (c.dueDate && c.dueDate >= fromDate && c.dueDate <= to) ev.push({ date: c.dueDate, title: `${c.name || 'Credit card'} payment due`, amount: c.paymentDue, type: 'Card Due' });
  return ev.sort((a, b) => a.date.localeCompare(b.date));
}

export function insights(state, ctx, anchor) {
  const out = []; const tx = state.transactions;
  for (const l of state.loanAccounts || []) {
    const b = (l.transactions || []).filter(t => t.type === 'Bounce charge' || t.type === 'EMI bounced').length;
    if (b) out.push({ type: 'warn', text: `${l.product || 'Loan'} (${l.accountMasked}) had ${b} EMI bounce event(s) and ${inr(l.charges || 0)} in charges/penal interest this statement period.` });
    if (l.outstandingAsPerBank) out.push({ type: 'info', text: `${l.product} ${l.accountMasked}: ${inr(l.outstanding)} principal outstanding, ${l.remainingEmis} EMIs left (last on ${l.lastEmiDate}).` });
  }
  if (!tx.length) return out;
  const [cf, ct] = periodRange('this_month', anchor), [pf, pt] = periodRange('last_month', anchor);
  const cur = filterTxns(tx, { from: cf, to: ct }), prev = filterTxns(tx, { from: pf, to: pt });
  const cc = byCategory(cur, ctx), pc = byCategory(prev, ctx);
  if (cc[0]) out.push({ type: 'info', text: `Your largest expense category this month is ${cc[0].key} (${inr(cc[0].value)}).` });
  for (const c of cc.slice(0, 6)) { const p = pc.find(x => x.key === c.key)?.value; if (p && p > 500) { const ch = (c.value - p) / p * 100; if (Math.abs(ch) >= 15) out.push({ type: ch > 0 ? 'warn' : 'good', text: `You spent ${Math.abs(ch).toFixed(0)}% ${ch > 0 ? 'more' : 'less'} on ${c.key} this month (${inr(c.value)} vs ${inr(p)}).` }); } }
  const subNow = sum(cur.filter(t => isExpense(t, ctx) && t.is_subscription), t => t.debit), subPrev = sum(prev.filter(t => isExpense(t, ctx) && t.is_subscription), t => t.debit);
  if (subNow - subPrev >= 100) out.push({ type: 'warn', text: `Your subscription expenses increased by ${inr(subNow - subPrev)} compared with last month.` });
  const m = monthly(filterTxns(tx, { from: periodRange('6m', anchor)[0], to: ct }), ctx);
  if (m.length >= 2) out.push({ type: 'info', text: `Your average monthly spending over the last ${m.length} months is ${inr(sum(m, x => x.expenses) / m.length)}.` });
  const rec = state.recurring || [];
  if (rec.length) out.push({ type: 'info', text: `You have ${rec.length} recurring payments costing about ${inr(sum(rec, r => r.monthly_cost))} per month.` });
  const tr = sum(cur.filter(t => t.is_transfer && t.debit > 0 && !t.is_duplicate), t => t.debit);
  if (tr) out.push({ type: 'info', text: `${inr(tr)} of transactions this month were identified as internal transfers and excluded from expenses.` });
  const rv = tx.filter(t => t.review_flags?.length).length;
  if (rv) out.push({ type: 'action', text: `${rv} transaction${rv > 1 ? 's need' : ' needs'} your review.` });
  const k = kpis(cur, ctx); if (k.income) out.push({ type: k.savingsRate >= 20 ? 'good' : 'info', text: `Your savings rate this month is ${k.savingsRate.toFixed(1)}%.` });
  return out;
}
