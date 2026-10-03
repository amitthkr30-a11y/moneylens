// "Chat with my finances" — deterministic query engine. It ONLY answers from the user's dataset
// and always returns the source transactions; it never invents numbers. (An optional LLM layer can
// later translate free text into these same intents — see docs/ARCHITECTURE.md.)
import { inr, sum, round2 } from './utils.js';
import { periodRange, filterTxns, isExpense, isIncome, byMerchant, byCategory, kpis, latestDate, byBank } from './analytics.js';
import { CATEGORY_TREE } from './classifier.js';

function parsePeriod(q, anchor) {
  if (/last month|previous month/.test(q)) return ['last month', ...periodRange('last_month', anchor)];
  if (/this month|current month/.test(q)) return ['this month', ...periodRange('this_month', anchor)];
  if (/this year|ytd/.test(q)) return ['this year', ...periodRange('this_year', anchor)];
  let m = q.match(/last (\d+) months?/); if (m) { const n = +m[1]; const [, to] = periodRange('this_month', anchor); const a = new Date(anchor + 'T00:00:00Z'); return [`last ${n} months`, new Date(Date.UTC(a.getUTCFullYear(), a.getUTCMonth() - n + 1, 1)).toISOString().slice(0, 10), to]; }
  if (/last (12 months|year)/.test(q)) return ['last 12 months', ...periodRange('12m', anchor)];
  return ['all time', '1990-01-01', '2100-12-31'];
}

export function ask(question, state, ctx) {
  const q = question.toLowerCase().trim();
  const anchor = latestDate(state.transactions);
  if (!state.transactions.length) return { answer: 'I don\'t have any transactions yet. Upload a statement or try the demo first.', sources: [] };
  const [label, from, to] = parsePeriod(q, anchor);
  const tx = filterTxns(state.transactions, { from, to });
  const exp = tx.filter(t => isExpense(t, ctx));
  const top = list => list.sort((a, b) => b.amount - a.amount).slice(0, 25);

  let m;
  if ((m = q.match(/(?:above|over|more than|greater than|>)\s*(?:₹|rs\.?|inr)?\s*([\d,]+)\s*(k)?/))) {
    const v = +m[1].replace(/,/g, '') * (m[2] ? 1000 : 1);
    const list = tx.filter(t => t.amount > v && !t.is_duplicate);
    return { answer: `${list.length} transactions above ${inr(v)} (${label}), totalling ${inr(sum(list, t => t.amount))}.`, sources: top(list) };
  }
  if ((m = q.match(/top\s*(\d+)?\s*merchants?/)) || /most.*merchant|merchant.*most/.test(q)) {
    const n = +(m?.[1] || 10); const g = byMerchant(tx, ctx).slice(0, n);
    return { answer: `Top ${g.length} merchants (${label}):\n` + g.map((e, i) => `${i + 1}. ${e.key} — ${inr(e.value)} (${e.count} txns)`).join('\n'), sources: top(exp.filter(t => g.some(e => e.key === t.merchant))) };
  }
  if (/compare.*(hdfc|sbi)|hdfc.*vs|sbi.*vs|bank.?wise/.test(q)) {
    const g = byBank(tx, ctx);
    return { answer: `Spending by bank (${label}):\n` + g.map(e => `• ${e.key}: ${inr(e.value)} across ${e.count} transactions`).join('\n'), sources: [] };
  }
  if (/subscription/.test(q)) {
    const subs = (state.recurring || []).filter(r => r.is_subscription);
    const mth = round2(sum(subs, r => r.monthly_cost));
    return { answer: subs.length ? `You have ${subs.length} detected subscriptions costing about ${inr(mth)}/month (${inr(mth * 12)}/year):\n` + subs.map(s => `• ${s.merchant} — ${inr(s.amount)} ${s.frequency.toLowerCase()}`).join('\n') : 'No recurring subscriptions detected yet.', sources: top(state.transactions.filter(t => subs.some(s => s.transaction_ids.includes(t.transaction_id)))) };
  }
  if (/biggest|largest|highest/.test(q)) {
    const list = top(exp).slice(0, 10);
    return { answer: `Your biggest expenses (${label}):\n` + list.map((t, i) => `${i + 1}. ${t.merchant} — ${inr(t.amount)} on ${t.transaction_date}`).join('\n'), sources: list };
  }
  if (/\bupi\b/.test(q)) {
    const list = exp.filter(t => t.payment_mode === 'UPI');
    return { answer: `You spent ${inr(sum(list, t => t.debit))} via UPI (${label}) across ${list.length} transactions.`, sources: top(list) };
  }
  if (/cash|atm/.test(q)) { const list = exp.filter(t => t.is_cash_withdrawal); return { answer: `You withdrew ${inr(sum(list, t => t.debit))} in cash (${label}) across ${list.length} withdrawals.`, sources: top(list) }; }
  if (/income|earn|salary/.test(q)) { const list = tx.filter(t => isIncome(t, ctx)); return { answer: `Your income (${label}) was ${inr(sum(list, t => t.credit))} from ${list.length} credits.`, sources: top(list) }; }
  if (/sav(e|ing)/.test(q)) { const k = kpis(tx, ctx); return { answer: `For ${label}: income ${inr(k.income)}, expenses ${inr(k.expenses)}, savings ${inr(k.savings)} (savings rate ${k.savingsRate.toFixed(1)}%).`, sources: [] }; }

  // Category or merchant match
  const catNames = Object.keys(CATEGORY_TREE); const subNames = Object.values(CATEGORY_TREE).flat();
  const alias = { food: 'Food & Dining', dining: 'Food & Dining', groceries: 'Groceries', grocery: 'Groceries', bills: 'Bills & Utilities', utilities: 'Bills & Utilities', travel: 'Travel', fuel: 'Fuel', petrol: 'Fuel', shopping: 'Shopping', rent: 'Rent', health: 'Health', medical: 'Health', entertainment: 'Entertainment', ott: 'OTT', emi: 'EMI', education: 'Education', transport: 'Transport', investment: 'Investment', sip: 'SIP' };
  const merchants = [...new Set(state.transactions.map(t => t.merchant))].sort((a, b) => b.length - a.length);
  const merchant = merchants.find(mm => mm && mm.length > 2 && q.includes(mm.toLowerCase()));
  if (merchant) { const list = exp.filter(t => t.merchant === merchant); return { answer: `You spent ${inr(sum(list, t => t.debit))} at ${merchant} (${label}) across ${list.length} transactions.`, sources: top(list) }; }
  let cat = catNames.find(c => q.includes(c.toLowerCase())) || subNames.find(s => q.includes(s.toLowerCase()));
  if (!cat) for (const [k, v] of Object.entries(alias)) if (new RegExp(`\\b${k}\\b`).test(q)) { cat = v; break; }
  if (cat) { const list = exp.filter(t => t.category === cat || t.subcategory === cat); return { answer: `You spent ${inr(sum(list, t => t.debit))} on ${cat} (${label}) across ${list.length} transactions.`, sources: top(list) }; }
  if (/spend|spent|expense/.test(q)) { const k = kpis(tx, ctx); const c = byCategory(tx, ctx).slice(0, 3); return { answer: `Total expenses (${label}): ${inr(k.expenses)}. Top categories: ${c.map(e => `${e.key} ${inr(e.value)}`).join(', ')}.`, sources: top(exp).slice(0, 10) }; }
  return { answer: 'I can answer questions about your imported data, e.g. "How much did I spend on food last month?", "Top 10 merchants", "Compare HDFC and SBI", "Transactions above ₹10,000", "How much did I spend on UPI?", "Subscriptions".', sources: [] };
}
