// Loan statement parsers (v1.2.1)
//  1. HDFC home / plot / top-up / personal loan "Statement of Account" (EMI receipts, bounces, charges)
//  2. HDFC credit-card loan "Loan EMI Table" (Insta Loan / Jumbo Loan / SmartEMI): amortisation
//     schedule with principal + interest per month and the bank's Principal Outstanding.
// Loan data is kept SEPARATE from bank/card transactions (the EMI is already a debit in your savings
// account or a charge on your credit card), so nothing is counted twice.
// Privacy: borrower name, address and CKYC number are deliberately NOT extracted or stored.
import { parseDate, parseSigned, maskAccount, round2, sum, hashId } from './utils.js';
import { StatementError } from './parsers.js';

const D = '\\d{2}-[A-Za-z]{3}-\\d{2,4}';
const DATE_RE = new RegExp(`^${D}$`);
const AMT_RE = /^\(?-?[\d,]+(?:\.\d{1,2})?\)?$/;

/** Credit-card loan amortisation table ("Loan EMI Table"). */
export function isEmiTable(text) {
  const t = String(text || '');
  return /Loan\s*EMI\s*Table/i.test(t) || (/Loan\s*Booked\s*Date/i.test(t) && /Principal\s*Outstanding/i.test(t));
}
/** True when the text looks like any supported loan statement. */
export function isLoanStatement(text) {
  const t = String(text || '');
  if (isEmiTable(t)) return true;
  return /loan\s+account\s+(number|no)/i.test(t) && /(current\s+emi|loan\s+amount|\bROI\b)/i.test(t);
}

const PAYMODES = { A: 'ACH mandate', B: 'Cheque', W: 'Web online receipt', C: 'Cash', N: 'NEFT', E: 'ECS', S: 'Standing instruction' };
function cleanDesc(s) {
  s = String(s || '').replace(/\s+/g, ' ').trim();
  if (/^(?:[A-Z] )+[A-Z]$/.test(s)) s = s.replace(/ /g, '');
  return s.replace(/\bE M I\b/g, 'EMI').replace(/\bP E M I\b/g, 'PEMI');
}
export function classifyLoanTxn(desc, amount, paymode) {
  const d = desc.toUpperCase();
  if (/DISHONOU?R|BOUNCE|RETURN CHARGE/.test(d)) return 'Bounce charge';
  if (/INT(EREST)?\s+ON\s+UNPAID|PENAL|LATE PAY|OVERDUE INT|ADDITIONAL INT/.test(d)) return 'Penal interest';
  if (/^PEMI$|PRE.?EMI/.test(d)) return amount < 0 ? 'Pre-EMI reversal' : 'Pre-EMI';
  if (/^EMI$|\bEMI\b|INSTAL/.test(d)) return amount < 0 ? 'EMI bounced' : 'EMI';
  if (/PREPAY|PART PAY|FORECLOS/.test(d)) return 'Prepayment';
  if (/DISBURS/.test(d)) return 'Disbursement';
  if (/CHARGE|FEE|GST/.test(d)) return 'Charges';
  return paymode === 'B' && amount < 0 ? 'EMI bounced' : 'Other';
}
function parseRows(lines) {
  const re = new RegExp(`^(${D})\\s+(\\d{4,14})\\s+([A-Z])\\s+(.+?)\\s+(\\(?-?[\\d,]+(?:\\.\\d{1,2})?\\)?)\\s+(${D})\\s*(.*)$`);
  const out = [];
  for (const raw of lines) { const m = String(raw).replace(/\s+/g, ' ').trim().match(re); if (m) out.push({ accDate: m[1], doc: m[2], pm: m[3], desc: m[4], amt: m[5], effDate: m[6], reason: m[7] }); }
  return out;
}
const DESC_TOKEN = /P ?E ?M ?I|E ?M ?I|INT(?:EREST)? ON UNPAID [A-Z\/]+(?: ?- ?L\d+)?|CHEQUE DISHONOU?RED CHARGES|[A-Z][A-Z ]*?(?:CHARGES|PREPAYMENT|PART PAYMENT|DISBURSEMENT|FEE)/g;
function parseColumns(text) {
  const start = text.search(/\(For Chq Bounce if any\)|Bounce Reason/i);
  if (start < 0) return [];
  let sec = text.slice(start).replace(/^\(For Chq Bounce if any\)|^Bounce Reason[^)]*\)?/i, '');
  const end = sec.search(/Negative amounts|Receipts other than|Paymode\s*:|DATE\s*:/i);
  if (end >= 0) sec = sec.slice(0, end);
  const tok = sec.replace(/\s+/g, ' ').trim().split(' ');
  let i = 0; const take = (pred, n) => { const r = []; while (i < tok.length && r.length < n && pred(tok[i])) r.push(tok[i++]); return r; };
  const acc = take(t => DATE_RE.test(t), 999); const n = acc.length; if (!n) return [];
  const docs = take(t => /^\d{4,14}$/.test(t), n);
  const pms = take(t => /^[A-Z]$/.test(t), n);
  const descStart = i; while (i < tok.length && !AMT_RE.test(tok[i])) i++;
  const descText = tok.slice(descStart, i).join(' ');
  const amts = take(t => AMT_RE.test(t), n);
  const eff = take(t => DATE_RE.test(t), n);
  const reason = tok.slice(i).join(' ').replace(/[\d,() ]+$/, '').trim();
  const descs = descText.match(DESC_TOKEN) || [];
  if (docs.length !== n || pms.length !== n || amts.length !== n) return [];
  return acc.map((a, k) => ({ accDate: a, doc: docs[k], pm: pms[k], desc: descs[k] || 'Other', amt: amts[k], effDate: eff[k] || a, reason: '' }))
    .map(r => (reason && (r.pm === 'B' || /^\(/.test(r.amt)) ? { ...r, reason } : r));
}

/* ---------------- HDFC credit-card loan "Loan EMI Table" ----------------
 * Loan Number | Loan Booked Date | Loan Type | Principal Amount | Interest Rate | Tenure | Principal Outstanding
 * then rows: Principal (Rs.) | Interest (Rs.) | Statement Date                                              */
const N2 = '[\\d,]+\\.\\d{1,2}';
const DMY = '\\d{1,2}\\s*[-/ ]?\\s*[A-Za-z]{3,9}\\s*[-/ ]?\\s*\\d{4}';
const LOAN_TYPES = { INSTALOAN: 'Credit Card Insta Loan', 'INSTA LOAN': 'Credit Card Insta Loan', JUMBOLOAN: 'Credit Card Jumbo Loan', 'JUMBO LOAN': 'Credit Card Jumbo Loan', SMARTEMI: 'Credit Card SmartEMI', 'SMART EMI': 'Credit Card SmartEMI' };
const normDMY = s => parseDate(String(s).replace(/[-/]/g, ' ').replace(/\s+/g, ' ').replace(/^(\d{1,2}) ?([A-Za-z]{3})[A-Za-z]* ?(\d{4})$/, '$1 $2 $3'));

function emiTableHeader(text) {
  // 1) values in one sequence (normal pdf.js output)
  const m = text.match(new RegExp(`(\\d{6,22})\\s+(${DMY})\\s+([A-Z][A-Z0-9 &\\-]{1,30}?)\\s+(${N2})\\s+(\\d{1,2}(?:\\.\\d{1,2})?)\\s+(\\d{1,3})\\s+(${N2})`));
  if (m) return { end: m.index + m[0].length, accNo: m[1], booked: m[2], type: m[3], amt: m[4], rate: m[5], tenure: m[6], outs: m[7] };
  // 2) fallback: values found individually (cells emitted out of order)
  const acc = text.match(/\b(\d{9,22})\b/); if (!acc) return null;
  const after = text.slice(acc.index);
  const booked = after.match(new RegExp(DMY));
  const type = after.match(/\b(INSTA ?LOAN|JUMBO ?LOAN|SMART ?EMI|[A-Z]{3,}LOAN|[A-Z]{3,} LOAN)\b/i);
  const rest = type ? after.slice(type.index + type[0].length) : '';
  const nums = rest.match(/[\d,]+(?:\.\d+)?/g) || [];
  if (!booked || !type || nums.length < 4) return null;
  const tail = rest.search(new RegExp(`${N2}\\s+${N2}\\s+${DMY}`));
  return { end: acc.index + (type.index + type[0].length) + (tail > 0 ? tail : 0), accNo: acc[1], booked: booked[0], type: type[1], amt: nums[0], rate: nums[1], tenure: nums[2], outs: nums[3] };
}

export function parseEmiTable(lines, { bank = 'Auto' } = {}) {
  const text = lines.join(' ').replace(/\s+/g, ' ');
  const h = emiTableHeader(text);
  if (!h) throw new StatementError('Could not read the loan details row (Loan Number, Booked Date, Type, Amount, Rate, Tenure, Outstanding) in this EMI table.');
  const rowRe = new RegExp(`(?:^|\\s)(${N2})\\s+(${N2})\\s+(${DMY})(?=\\s|$)`, 'g');
  const body = text.slice(h.end);
  const schedule = []; const seen = new Set(); let m;
  while ((m = rowRe.exec(body))) {
    const date = normDMY(m[3]); if (!date || seen.has(date)) continue;
    seen.add(date);
    const principal = parseSigned(m[1]), interest = parseSigned(m[2]);
    schedule.push({ date, principal, interest, emi: round2(principal + interest) });
  }
  if (!schedule.length) throw new StatementError('No EMI rows (Principal / Interest / Statement Date) were found in this EMI table.');
  schedule.sort((a, b) => a.date.localeCompare(b.date));
  const loanAmount = parseSigned(h.amt), outstanding = parseSigned(h.outs), ten = +h.tenure;

  // EMIs already billed = rows after which the remaining principal equals the bank's "Principal Outstanding".
  let paid = -1, rem = round2(sum(schedule, r => r.principal));
  for (let k = 0; k <= schedule.length; k++) {
    if (Math.abs(rem - outstanding) <= 1) { paid = k; break; }
    if (k < schedule.length) rem = round2(rem - schedule[k].principal);
  }
  if (paid < 0) { const today = new Date().toISOString().slice(0, 10); paid = schedule.filter(r => r.date <= today).length; }

  // Regular EMI = most common principal+interest (first row usually has broken-period interest).
  const freq = [...schedule.reduce((mm, r) => mm.set(r.emi, (mm.get(r.emi) || 0) + 1), new Map()).entries()].sort((a, b) => b[1] - a[1]);
  const currentEmi = freq[0][1] > 1 ? freq[0][0] : (schedule[1] || schedule[0]).emi;

  const done = schedule.slice(0, paid), left = schedule.slice(paid);
  const typeKey = h.type.trim().toUpperCase();
  const detectedBank = bank !== 'Auto' && bank ? bank : /hdfc/i.test(text) ? 'HDFC' : /icici/i.test(text) ? 'ICICI' : /axis/i.test(text) ? 'Axis' : /\bsbi\b|state bank/i.test(text) ? 'SBI' : 'Other';
  const transactions = done.map((r, i) => ({
    id: 'ltx_' + hashId([h.accNo, r.date, 'EMI', r.emi].join('|')), date: r.date, effectiveDate: r.date, docNo: '',
    paymode: 'Billed to credit card', description: `EMI ${i + 1}/${ten}: principal ₹${r.principal.toLocaleString('en-IN')} + interest ₹${r.interest.toLocaleString('en-IN')}`,
    amount: r.emi, type: 'EMI', bounceReason: '',
  }));
  const billed = round2(sum(done, r => r.emi));
  return {
    key: 'loan_' + hashId(detectedBank + '|' + h.accNo), kind: 'emi_table',
    bank: detectedBank, accountMasked: maskAccount(h.accNo), product: LOAN_TYPES[typeKey] || `${h.type.trim()} (card loan)`,
    loanAmount, rate: +h.rate, currentEmi, disbursed: loanAmount, bookedDate: normDMY(h.booked),
    periodFrom: normDMY(h.booked), periodTo: done.length ? done[done.length - 1].date : normDMY(h.booked),
    openingDue: null, receivable: billed, received: billed, overdue: null,
    emisPaid: paid, emiAmountPaid: billed, bounces: 0, charges: 0,
    estTenureMonths: ten, firstEmiDate: schedule[0].date,
    outstanding, outstandingAsPerBank: true,
    principalPaid: round2(loanAmount - outstanding), interestPaid: round2(sum(done, r => r.interest)),
    interestRemaining: round2(sum(left, r => r.interest)), totalInterest: round2(sum(schedule, r => r.interest)),
    remainingEmis: left.length, nextEmiDate: left[0]?.date || null, lastEmiDate: schedule[schedule.length - 1].date,
    schedule, transactions,
  };
}

/** Parse any supported loan statement from PDF text lines. */
export function parseLoanStatement(lines, { bank = 'Auto' } = {}) {
  const text = lines.join(' ').replace(/\s+/g, ' ');
  if (isEmiTable(text)) return parseEmiTable(lines, { bank });
  if (!isLoanStatement(text)) throw new StatementError('This does not look like a loan statement.');
  const num = re => { const m = text.match(re); return m ? parseSigned(m[1]) : null; };
  const accNo = (text.match(/Loan Account (?:Number|No)\.?\s*:?\s*\**\s*(\d{5,20})/i) || text.match(/Account No\.?\s*:?\s*(\d{5,20})/i) || [])[1];
  if (!accNo) throw new StatementError('Could not find the loan account number in this statement.');
  const period = text.match(new RegExp(`PERIOD\\s+(${D})\\s+to\\s+(${D})`, 'i'));
  const product = ((text.match(/TYPE\s*:\s*([A-Z][A-Z0-9 \-\/&().]{2,80}?)(?=\s+(?:HDFC BANK|REGD|PAGE\b|DATE\s*:|PAYMODE|NEGATIVE|THIS STATEMENT)|\s*$)/i) || [])[1] || '').trim();
  const summ = label => { const m = text.match(new RegExp(`${label}\\s+(\\(?-?[\\d,]+\\)?)\\s+(\\(?-?[\\d,]+\\)?)\\s+(\\(?-?[\\d,]+\\)?)`, 'i')); return m ? { emi: parseSigned(m[1]), pemi: parseSigned(m[2]), total: parseSigned(m[3]) } : null; };
  const detectedBank = bank !== 'Auto' && bank ? bank : /hdfc bank/i.test(text) ? 'HDFC' : /state bank of india|\bsbi\b/i.test(text) ? 'SBI' : /icici/i.test(text) ? 'ICICI' : 'Other';
  let rows = parseRows(lines);
  if (!rows.length) rows = parseColumns(text);
  const transactions = rows.map(r => {
    const amount = parseSigned(r.amt) || 0; const desc = cleanDesc(r.desc);
    return { id: 'ltx_' + hashId([accNo, r.accDate, r.doc, desc, amount].join('|')), date: parseDate(r.accDate), effectiveDate: parseDate(r.effDate), docNo: r.doc,
      paymode: PAYMODES[r.pm] || r.pm, description: desc, amount, type: classifyLoanTxn(desc, amount, r.pm), bounceReason: (r.reason || '').trim() };
  }).filter(t => t.date);
  const emiPaid = transactions.filter(t => t.type === 'EMI');
  const bounced = transactions.filter(t => t.type === 'EMI bounced');
  const charges = round2(sum(transactions.filter(t => ['Bounce charge', 'Penal interest', 'Charges'].includes(t.type)), t => t.amount));
  const receivable = summ('Receivable'), received = summ('Received'), opening = summ('Opening balance');
  const loanAmount = num(/LOAN AMOUNT\s*:?\s*([\d,]+(?:\.\d+)?)/i);
  const rate = num(/ROI\s*:?\s*([\d.]+)\s*%/i);
  const emi = num(/CURRENT EMI\s*:?\s*([\d,]+(?:\.\d+)?)/i);
  return {
    key: 'loan_' + hashId(detectedBank + '|' + accNo), kind: 'soa', bank: detectedBank, accountMasked: maskAccount(accNo), product: product || 'Loan',
    loanAmount, rate, currentEmi: emi, disbursed: num(/DISBURSEMENT UPTO DATE\s*:?\s*([\d,]+)/i),
    periodFrom: period ? parseDate(period[1]) : null, periodTo: period ? parseDate(period[2]) : null,
    openingDue: opening?.total ?? null, receivable: receivable?.total ?? null, received: received?.total ?? null,
    overdue: receivable && received ? round2(receivable.total - received.total) : null,
    emisPaid: emiPaid.length - bounced.length, emiAmountPaid: round2(sum(emiPaid, t => t.amount) + sum(bounced, t => t.amount)),
    bounces: bounced.length, charges, estTenureMonths: estimateTenure(loanAmount, rate, emi), transactions,
  };
}

export function estimateTenure(P, ratePct, E) {
  if (!P || !E) return null; const r = (ratePct || 0) / 1200;
  if (!r) return Math.ceil(P / E);
  const x = 1 - r * P / E; if (x <= 0) return null;
  return Math.round(-Math.log(x) / Math.log(1 + r));
}

/** Insert or update a loan (newer statements merge; transactions de-duplicated; user's first-EMI date kept). */
export function upsertLoan(state, loan, importId) {
  state.loanAccounts = state.loanAccounts || [];
  const ex = state.loanAccounts.find(l => l.key === loan.key);
  if (!ex) { state.loanAccounts.push({ ...loan, importIds: [importId], firstEmiDate: loan.firstEmiDate || '' }); return { added: loan.transactions.length, updated: false }; }
  const ids = new Set(ex.transactions.map(t => t.id)); const fresh = loan.transactions.filter(t => !ids.has(t.id));
  const newer = (loan.periodTo || '') >= (ex.periodTo || '');
  const keepFirst = ex.firstEmiDate || loan.firstEmiDate || '';
  if (newer) Object.assign(ex, { ...loan, transactions: ex.transactions, importIds: ex.importIds });
  ex.firstEmiDate = keepFirst;
  ex.transactions = [...ex.transactions, ...fresh].sort((a, b) => a.date.localeCompare(b.date));
  ex.importIds = [...new Set([...(ex.importIds || []), importId])];
  return { added: fresh.length, updated: true };
}
