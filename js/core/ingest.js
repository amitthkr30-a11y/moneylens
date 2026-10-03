// Orchestrates the 10-step upload pipeline (pure; browser file reading lives in js/ui/upload.js).
import { parserFor, detectBank, StatementError } from './parsers.js';
import { makeAccount, normalize, runIntelligence } from './pipeline.js';
import { hashId } from './utils.js';
import { latestDate as ld } from './analytics.js';

function headerArea(rows) {
  const i = rows.findIndex(r => r.some(c => /narration|description|particulars/i.test(c)));
  return rows.slice(0, i >= 0 ? i + 1 : 10).map(r => r.join(' ')).join(' ');
}

export function emptyState() {
  return { version: 1, accounts: [], transactions: [], imports: [], budgets: [], recurring: [], subscriptionStatus: {},
    merchantOverrides: {}, categoryOverrides: {}, loans: [], creditCards: [], netWorthItems: [], netWorthHistory: [],
    settings: {}, audit: [], demo: false };
}

export function audit(state, action, meta = {}) {
  // Audit log stores actions & counts only — never descriptions, amounts or account numbers.
  state.audit.push({ at: new Date().toISOString(), action, ...meta });
  if (state.audit.length > 500) state.audit.splice(0, state.audit.length - 500);
}

/**
 * @param {object} state
 * @param {{kind:'csv'|'xlsx'|'pdf', rows?:string[][], lines?:string[], fileName:string, bank:string, accountType:string, last4:string, nickname?:string}} input
 * @param {(step:string)=>void} [onStep]
 */
export function ingest(state, input, onStep = () => {}) {
  const t0 = Date.now();
  onStep('Detecting bank format');
  const headText = input.kind === 'pdf' ? headerArea((input.lines || []).map(l => [l])) : headerArea(input.rows || []);
  const detected = detectBank(headText);
  const bank = input.bank && input.bank !== 'Auto' ? input.bank : detected;
  onStep('Extracting transactions');
  const parser = parserFor(bank, input.kind);
  const raw = input.kind === 'pdf' ? parser.parseLines(input.lines || []) : parser.parseTable(input.rows || []);
  if (!raw.length) throw new StatementError('No transactions were found in this statement.');
  onStep('Normalizing');
  let account = makeAccount({ bank, type: input.accountType || 'Savings', last4: input.last4 || '0000', nickname: input.nickname });
  const existing = state.accounts.find(a => a.id === account.id);
  if (existing) account = existing; else state.accounts.push(account);
  const importId = 'imp_' + hashId(input.fileName + Date.now() + Math.random());
  const txns = normalize(raw, account, importId);
  state.transactions.push(...txns);
  onStep('Classifying, detecting duplicates, transfers & recurring payments');
  runIntelligence(state, ld(state.transactions));
  const mine = state.transactions.filter(t => t.import_id === importId);
  const summary = {
    id: importId, fileName: input.fileName.replace(/[^\w.\- ]/g, '_').slice(0, 80), bank, detectedBank: detected, kind: input.kind, account_id: account.id,
    processed: mine.length, categorized: mine.filter(t => t.category !== 'Other').length,
    needsReview: mine.filter(t => t.review_flags.length).length, duplicates: mine.filter(t => t.is_duplicate).length,
    transfers: mine.filter(t => t.is_transfer).length, from: mine.reduce((m, t) => t.transaction_date < m ? t.transaction_date : m, '9999'), to: ld(mine),
    ms: Date.now() - t0, at: new Date().toISOString(), status: 'completed',
  };
  state.imports.push(summary);
  audit(state, 'import', { importId, bank, kind: input.kind, count: summary.processed });
  onStep('Finalizing');
  return summary;
}

export function deleteImport(state, importId) {
  const before = state.transactions.length;
  state.transactions = state.transactions.filter(t => t.import_id !== importId);
  state.imports = state.imports.filter(i => i.id !== importId);
  state.accounts = state.accounts.filter(a => state.transactions.some(t => t.account_id === a.id));
  runIntelligence(state, ld(state.transactions));
  audit(state, 'delete_import', { importId, removed: before - state.transactions.length });
}

/** Persist a user correction and learn from it (merchant alias + merchant→category rule). */
export function correctTransaction(state, id, { category, subcategory, merchant, markTransfer, notTransfer, ignore, approve, notDuplicate }) {
  const t = state.transactions.find(x => x.transaction_id === id); if (!t) return;
  if (merchant && merchant !== t.merchant) {
    const key = t.upi_id ? 'upi:' + t.upi_id : 'desc:' + (t.description || '').toUpperCase().replace(/[0-9]+/g, '').replace(/[^A-Z ]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 40);
    state.merchantOverrides[key] = merchant; t.merchant = merchant;
  }
  if (category) { t.category = category; t.subcategory = subcategory || ''; t.user_verified_category = true; state.categoryOverrides[t.merchant] = [category, subcategory || '']; }
  if (markTransfer) { t.manual_transfer = true; t.transfer_confirmed = true; }
  if (notTransfer) { t.manual_transfer = false; t.transfer_confirmed = false; }
  if (notDuplicate) t.duplicate_dismissed = true;
  if (ignore) { t.excluded = true; t.review_done = true; }
  if (approve) { t.review_done = true; t.user_verified_category = true; t.anomaly_dismissed = true; }
  t.updated_at = new Date().toISOString();
  runIntelligence(state, ld(state.transactions));
  audit(state, 'correct_transaction', { fields: Object.keys(arguments[2]).join(',') });
}
