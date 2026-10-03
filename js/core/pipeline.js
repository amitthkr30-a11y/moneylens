// Ingestion pipeline + transaction intelligence: normalize → classify → duplicates → transfers
// → credit-card double-count guard → recurring/subscriptions → anomalies → review queue.
import { hashId, round2, daysBetween, addDays, addMonths, median, maskAccount } from './utils.js';
import { classify } from './classifier.js';

export const DEFAULT_SETTINGS = {
  transferWindowDays: 3,           // own-account transfer matching window
  excludeCcPaymentIfCardImported: true,
  excludeRefundsFromIncome: true,  // refunds reduce spend instead of counting as income
  largeCashThreshold: 20000,
  anomalyMultiplier: 3,
  lowConfidence: 0.6,
  selfNames: [],                   // user's own name(s) as they appear in narrations
};

export function makeAccount({ bank, type, last4, nickname }) {
  const id = 'acc_' + hashId(`${bank}|${type}|${last4}`);
  return { id, bank_name: bank, account_type: type, account_number_masked: maskAccount(last4), nickname: nickname || `${bank} ${type}`, created_at: new Date().toISOString() };
}

/** Raw parser rows → normalized transaction model. */
export function normalize(raw, account, importId) {
  const now = new Date().toISOString();
  return raw.map((r, i) => {
    const debit = round2(r.debit || 0), credit = round2(r.credit || 0);
    const t = {
      transaction_id: 'txn_' + hashId(`${account.id}|${r.date}|${r.description}|${r.reference}|${debit}|${credit}|${r.balance}|${i}`),
      account_id: account.id, import_id: importId,
      bank_name: account.bank_name, account_type: account.account_type, account_number_masked: account.account_number_masked,
      transaction_date: r.date, value_date: r.valueDate || r.date,
      description: (r.description || '').slice(0, 300), reference_number: String(r.reference || '').slice(0, 40),
      debit, credit, amount: debit || credit, balance: r.balance ?? null,
      transaction_type: debit ? 'Debit' : 'Credit', payment_mode: 'Other', merchant: '', upi_id: '',
      category: '', subcategory: '', confidence_score: 0,
      is_transfer: false, is_recurring: false, is_subscription: false, is_cash_withdrawal: false, is_salary: false,
      is_bill_payment: false, is_refund: false, is_investment: false, is_emi: false, is_duplicate: false,
      is_cc_payment: false, is_cc_payment_received: false,
      user_verified_category: false, review_flags: [], created_at: now, updated_at: now,
    };
    return t;
  });
}

/** Duplicates: same account + date + amount + direction + (reference or description). Never deleted. */
export function detectDuplicates(txns) {
  const seen = new Map();
  const sorted = [...txns].sort((a, b) => a.created_at.localeCompare(b.created_at));
  for (const t of sorted) {
    if (t.duplicate_dismissed) continue;
    const key = [t.account_id, t.transaction_date, t.amount, t.transaction_type, t.reference_number || t.description.toUpperCase().replace(/\s+/g, '')].join('|');
    if (seen.has(key) && seen.get(key) !== t.import_id) { t.is_duplicate = true; } // same txn appears in two different imports
    else if (seen.has(key)) { t.possible_duplicate = true; }                    // same file — may be genuine repeat; review
    else seen.set(key, t.import_id);
  }
}

/** Own-account transfer detection: debit in A ↔ credit in B, same amount, within N days. */
export function detectTransfers(txns, accounts, settings = DEFAULT_SETTINGS) {
  const accIds = new Set(accounts.map(a => a.id));
  const credits = txns.filter(t => t.credit > 0 && !t.is_duplicate && !t.transfer_pair && t.transfer_confirmed !== false);
  const byAmt = new Map();
  for (const c of credits) { if (!byAmt.has(c.amount)) byAmt.set(c.amount, []); byAmt.get(c.amount).push(c); }
  let pairs = 0;
  for (const d of txns) {
    if (!(d.debit > 0) || d.is_duplicate || d.transfer_pair || d.transfer_confirmed === false || d.is_salary) continue;
    if (['Food & Dining', 'Shopping', 'Entertainment', 'Health', 'Travel', 'Cash'].includes(d.category) && d.confidence_score > 0.8) continue;
    const cands = (byAmt.get(d.amount) || []).filter(c => c.account_id !== d.account_id && accIds.has(c.account_id) && !c.transfer_pair &&
      Math.abs(daysBetween(d.transaction_date, c.transaction_date)) <= settings.transferWindowDays);
    if (!cands.length) continue;
    const c = cands.sort((x, y) => Math.abs(daysBetween(d.transaction_date, x.transaction_date)) - Math.abs(daysBetween(d.transaction_date, y.transaction_date)))[0];
    const isCardPayment = c.account_type === 'Credit Card';
    for (const t of [d, c]) {
      t.transfer_pair = t === d ? c.transaction_id : d.transaction_id;
      t.is_transfer = true;
      if (!t.user_verified_category) { t.category = 'Transfers'; t.subcategory = isCardPayment ? 'Credit Card Payment Received' : 'Own Account Transfer'; t.confidence_score = 0.9; }
    }
    if (isCardPayment) d.is_cc_payment = true;
    pairs++;
  }
  return pairs;
}

const FREQS = [['Weekly', 7, 2], ['Monthly', 30, 5], ['Quarterly', 91, 10], ['Annual', 365, 20]];

/** Recurring detection: same merchant, similar amount (±15%), regular interval. */
export function detectRecurring(txns, asOf) {
  const groups = new Map();
  for (const t of txns) {
    if (!(t.debit > 0) || t.is_duplicate || t.is_transfer || t.category === 'Cash' || !t.merchant || t.merchant === 'Unknown') continue;
    const k = t.merchant;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(t);
  }
  const out = [];
  const clusters = [];
  for (const [merchant, list] of groups) { // split each merchant into amount clusters (e.g. two SIPs)
    const cat = list[0].category;
    if (cat === 'Bills & Utilities' && !list[0].is_subscription) { clusters.push([merchant, list]); continue; } // utility bills vary month to month
    const structured = ['Finance', 'Investment', 'Housing'].includes(cat) || list[0].is_subscription;
    const tol = structured ? 1.15 : 1.0;
    const byAmt = [...list].sort((a, b) => a.amount - b.amount); let cur = [];
    for (const t of byAmt) { if (cur.length && t.amount > median(cur.map(x => x.amount)) * tol + 1) { clusters.push([merchant, cur]); cur = []; } cur.push(t); }
    if (cur.length) clusters.push([merchant, cur]);
  }
  const multi = new Set(clusters.filter(([m, c]) => c.length >= 2).map(([m]) => m).filter((m, i, a) => a.indexOf(m) !== i));
  for (const [merchant, list] of clusters) {
    list.sort((a, b) => a.transaction_date.localeCompare(b.transaction_date));
    const similar = list;
    if (similar.length < 2) continue;
    const gaps = similar.slice(1).map((t, i) => daysBetween(similar[i].transaction_date, t.transaction_date)).filter(g => g > 2);
    if (!gaps.length) continue;
    const g = median(gaps);
    const f = FREQS.find(([, days, tol]) => Math.abs(g - days) <= tol);
    if (!f) continue;
    const [freq, days] = f;
    const discretionary = !(['Finance', 'Investment', 'Housing', 'Bills & Utilities'].includes(similar[0].category) || similar.some(t => t.is_subscription));
    const minCount = freq === 'Weekly' ? 4 : freq === 'Monthly' || discretionary ? 3 : 2;
    if (discretionary && new Set(similar.map(t => Math.round(t.amount))).size > 1) continue;
    const regular = gaps.filter(x => Math.abs(x - days) <= f[2] * 2).length / gaps.length;
    if (similar.length < minCount || regular < 0.7) continue;
    const last = similar[similar.length - 1];
    const amount = round2(median(similar.map(t => t.amount)));
    const perYear = { Weekly: 52, Monthly: 12, Quarterly: 4, Annual: 1 }[freq];
    const nextExpected = freq === 'Weekly' ? addDays(last.transaction_date, 7) : addMonths(last.transaction_date, { Monthly: 1, Quarterly: 3, Annual: 12 }[freq]);
    similar.forEach(t => { t.is_recurring = true; });
    const isSub = similar.some(t => t.is_subscription) || ['OTT', 'Software Subscription', 'Fitness'].includes(last.subcategory);
    out.push({
      id: 'rec_' + merchant.replace(/\W+/g, '_').toLowerCase() + '_' + Math.round(similar[0].amount), merchant: multi.has(merchant) ? `${merchant} (₹${Math.round(median(similar.map(t => t.amount))).toLocaleString('en-IN')})` : merchant, category: last.category, subcategory: last.subcategory,
      amount, frequency: freq, occurrences: similar.length, first_payment: similar[0].transaction_date, last_payment: last.transaction_date,
      next_expected: nextExpected, annual_cost: round2(amount * perYear), monthly_cost: round2(amount * perYear / 12),
      is_subscription: isSub, is_emi: last.is_emi, is_sip: last.subcategory === 'SIP',
      possibly_inactive: asOf ? daysBetween(nextExpected, asOf) > Math.max(10, g * 0.5) : false,
      account_id: last.account_id, transaction_ids: similar.map(t => t.transaction_id),
    });
  }
  return out.sort((a, b) => b.annual_cost - a.annual_cost);
}

/** Anomalies — flagged for review, never labelled as fraud. */
export function detectAnomalies(txns, settings = DEFAULT_SETTINGS) {
  const byMerchant = new Map();
  for (const t of txns) if (t.debit > 0 && !t.is_transfer && !t.is_duplicate) {
    if (!byMerchant.has(t.merchant)) byMerchant.set(t.merchant, []);
    byMerchant.get(t.merchant).push(t.amount);
  }
  for (const t of txns) {
    t.anomaly = '';
    if (t.is_duplicate || t.is_transfer || !(t.debit > 0) || t.anomaly_dismissed) continue;
    const hist = byMerchant.get(t.merchant) || [];
    const med = median(hist);
    if (hist.length >= 3 && t.amount > settings.anomalyMultiplier * med && t.amount - med > 1000) t.anomaly = `Amount is ${(t.amount / med).toFixed(1)}× your usual ${t.merchant} spend`;
    else if (t.is_cash_withdrawal && t.amount >= settings.largeCashThreshold) t.anomaly = 'Large cash withdrawal';
  }
}

/** Build the review queue reasons per transaction. */
export function buildReviewFlags(txns, settings = DEFAULT_SETTINGS) {
  for (const t of txns) {
    const f = [];
    if (t.review_done) { t.review_flags = []; continue; }
    if (t.is_duplicate || t.possible_duplicate) f.push('Possible duplicate');
    if (!t.user_verified_category && t.confidence_score < settings.lowConfidence) f.push(t.category === 'Other' ? 'Unknown category' : 'Low classification confidence');
    if (t.merchant === 'Unknown') f.push('Unknown merchant');
    if (!t.is_transfer && t.debit > 0 && t.subcategory === 'Bank Transfer' && t.amount >= 10000) f.push('Possible transfer');
    if (t.anomaly) f.push('Unusual transaction');
    t.review_flags = f;
  }
}

/** Run the whole intelligence pass over the full dataset (idempotent). */
export function runIntelligence(state, asOf) {
  const settings = { ...DEFAULT_SETTINGS, ...(state.settings || {}) };
  const ctx = { merchantOverrides: state.merchantOverrides || {}, categoryOverrides: state.categoryOverrides || {}, selfNames: settings.selfNames };
  for (const t of state.transactions) {
    const keep = t.user_verified_category ? { category: t.category, subcategory: t.subcategory } : null;
    const keepTransfer = t.transfer_confirmed;
    t.is_duplicate = false; t.possible_duplicate = false; t.is_recurring = false;
    if (!t.manual_transfer) { t.is_transfer = false; t.transfer_pair = null; }
    classify(t, ctx);
    if (keep) { Object.assign(t, keep); t.confidence_score = 1; }
    if (t.manual_transfer || keepTransfer === true) { t.is_transfer = true; if (!keep) { t.category = 'Transfers'; t.subcategory = 'Own Account Transfer'; } }
    if (keep && keep.category !== 'Transfers' && keepTransfer !== true) t.is_transfer = false;
  }
  detectDuplicates(state.transactions);
  const pairs = detectTransfers(state.transactions, state.accounts, settings);
  state.recurring = detectRecurring(state.transactions, asOf);
  detectAnomalies(state.transactions, settings);
  buildReviewFlags(state.transactions, settings);
  return { pairs };
}
