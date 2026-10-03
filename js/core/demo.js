// Synthetic demo data: completely fake and deterministic (seeded).
import { round2 } from './utils.js';
function rng(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }

export function generateDemo(endDate = new Date().toISOString().slice(0, 10), months = 12, seed = 42) {
  const r = rng(seed); const pickA = a => a[Math.floor(r() * a.length)]; const amt = (lo, hi) => round2(lo + r() * (hi - lo));
  const end = new Date(endDate + 'T00:00:00Z');
  const H = [], S = [], C = []; let hb = 185000, sb = 62000; let ref = 400000000000;
  const push = (arr, date, description, debit, credit, isH) => {
    if (date > endDate) return;
    if (isH === 'C') { arr.push({ date, valueDate: date, description, reference: '', debit, credit, balance: null }); return; }
    if (isH) hb = round2(hb - debit + credit); else sb = round2(sb - debit + credit);
    arr.push({ date, valueDate: date, description, reference: String(ref++), debit, credit, balance: isH ? hb : sb });
  };
  for (let i = months - 1; i >= 0; i--) {
    const y = end.getUTCFullYear(), m = end.getUTCMonth() - i;
    const d = day => new Date(Date.UTC(y, m, day)).toISOString().slice(0, 10);
    push(H, d(1), 'NEFT CR-CITI0000001-ACME TECHNOLOGIES PVT LTD-SALARY FOR MONTH', 0, 150000, true);
    push(H, d(2), 'UPI-NOBROKER RENT-nobroker.rent@hdfcbank-HDFC0000001-RENT PAYMENT', 32000, 0, true);
    push(H, d(3), 'IB FUNDS TRANSFER DR-SBI SELF A/C XXXXXXX9876', 40000, 0, true);
    push(S, d(3), 'BY TRANSFER-NEFT*HDFC0000001*SELF HDFC A/C', 0, 40000, false);
    push(H, d(5), 'ACH D- HDFC BANK LTD HOME LOAN EMI 0012345', 18000, 0, true);
    push(S, d(5), 'ACH DR BSE STAR MF SIP ICCL MUTUAL FUND', 15000, 0, false);
    push(S, d(10), 'ACH DR BSESTARMF NIPPON SIP', 10000, 0, false);
    push(H, d(7), 'ME DC SI NETFLIX.COM MUMBAI', 649, 0, true);
    push(H, d(9), 'UPI-SPOTIFY INDIA-spotify@hdfcbank-HDFC0000001-AUTOPAY', 119, 0, true);
    push(S, d(12), 'TO TRANSFER-UPI/DR/' + ref + '/AIRTEL/AIRP/airtelpayments@airtel/Postpaid--', amt(599, 799), 0, false);
    push(S, d(14), 'TO TRANSFER-UPI/DR/' + ref + '/TATA POWER/HDFC/tatapower@hdfcbank/Electricity--', amt(1800, 4200), 0, false);
    push(H, d(15), 'POS 4XXXXXXXXXX1234 ACT FIBERNET', 999, 0, true);
    push(H, d(16), 'UPI-MAHANAGAR GAS-mgl@icici-ICIC0000001-GASBILL', amt(650, 980), 0, true);
    push(S, d(20), 'ATM WDL-ATM CASH 1234 CHHINDWARA', pickA([3000, 5000, 5000, 10000]), 0, false);
    if (m % 3 === 0) push(H, d(18), 'ACH D- LIC OF INDIA PREMIUM', 8500, 0, true);
    if (m % 12 === 3) push(H, d(21), 'ME DC SI AMAZON PRIME MEMBERSHIP', 1499, 0, true);
    push(S, d(28), 'CREDIT INTEREST', 0, amt(120, 240), false);
    const cardBill = amt(7000, 14000);
    push(H, d(22), 'CC 000XXXXXXXXXX4321 AUTOPAY SI-TAD', cardBill, 0, true);
    push(C, d(22), 'PAYMENT RECEIVED - THANK YOU', 0, cardBill, 'C');
    const nVar = 26 + Math.floor(r() * 10);
    for (let k = 0; k < nVar; k++) {
      const day = 1 + Math.floor(r() * 28);
      const [desc, lo, hi, acc] = pickA([
        ['UPI-SWIGGY-swiggy@icici-ICIC0000001-ORDER', 180, 750, 'H'], ['UPI-ZOMATO LTD-zomato@hdfcbank-HDFC0000001-ORDER', 200, 800, 'H'],
        ['TO TRANSFER-UPI/DR/REF/BIGBASKET/YESB/bigbasket@ybl/groceries--', 600, 2800, 'S'], ['TO TRANSFER-UPI/DR/REF/DMART/AXIS/dmart@axisbank/groceries--', 900, 3200, 'S'],
        ['UPI-INDIAN OIL PETROL PUMP-iocl.fuel@sbi-SBIN0000001-FUEL', 1000, 3000, 'H'], ['UPI-UBER INDIA-uber@axisbank-UTIB0000001-RIDE', 150, 600, 'H'],
        ['TO TRANSFER-UPI/DR/REF/RAHUL SHARMA/SBIN/rahul.sharma@oksbi/dinner--', 300, 1500, 'S'], ['UPI-STARBUCKS-starbucks@hdfcbank-HDFC0000001-COFFEE', 250, 600, 'H'],
        ['TO TRANSFER-UPI/DR/REF/APOLLO PHARMACY/ICIC/apollo@icici/meds--', 200, 1500, 'S'], ['CARD:AMAZON PAY INDIA PVT LTD BANGALORE', 300, 4500, 'C'],
        ['CARD:FLIPKART INTERNET PVT LTD', 400, 3500, 'C'], ['CARD:MYNTRA DESIGNS', 700, 2600, 'C'], ['CARD:BOOKMYSHOW', 400, 1200, 'C'], ['CARD:MAKEMYTRIP INDIA', 2500, 9000, 'C'],
      ]);
      const v = amt(lo, hi);
      if (acc === 'C') push(C, d(day), desc.slice(5) + ' ' + (1000 + k), v, 0, 'C');
      else push(acc === 'H' ? H : S, d(day), desc.replace('REF', String(ref)), v, 0, acc === 'H');
    }
    if (i === 1) push(C, d(25), 'CROMA RETAIL ELECTRONICS', 38999, 0, 'C');
    if (i === 2) push(H, d(26), 'REFUND AMAZON ORDER 402-123', 0, 1299, true);
  }
  for (const a of [H, S, C]) a.sort((x, y) => x.date.localeCompare(y.date));
  for (const [arr, start] of [[H, 185000], [S, 62000]]) { let b = start; for (const t of arr) { b = round2(b - t.debit + t.credit); t.balance = b; } }
  return { HDFC: H, SBI: S, CARD: C };
}
export function toBankCSV(rows, bank) {
  const f = d => { const [y, m, dd] = d.split('-'); return bank === 'HDFC' ? `${dd}/${m}/${y.slice(2)}` : `${+dd} ${['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][+m - 1]} ${y}`; };
  const q = s => `"${String(s).replace(/"/g, '""')}"`;
  if (bank === 'HDFC') return ['HDFC BANK Ltd. Statement of account (SYNTHETIC DEMO DATA)', 'Date,Narration,Chq./Ref.No.,Value Dt,Withdrawal Amt.,Deposit Amt.,Closing Balance',
    ...rows.map(t => [f(t.date), q(t.description), t.reference, f(t.valueDate), t.debit ? t.debit.toFixed(2) : '', t.credit ? t.credit.toFixed(2) : '', t.balance?.toFixed(2) ?? ''].join(','))].join('\n');
  return ['State Bank of India - Account Statement (SYNTHETIC DEMO DATA)', 'Txn Date,Value Date,Description,Ref No./Cheque No.,Debit,Credit,Balance',
    ...rows.map(t => [f(t.date), f(t.valueDate), q(t.description), q(t.reference), t.debit ? t.debit.toFixed(2) : '', t.credit ? t.credit.toFixed(2) : '', t.balance?.toFixed(2) ?? ''].join(','))].join('\n');
}
/** Synthetic HDFC-style home loan statement text lines (fake account). */
export function demoLoanLines() {
  return [
    'HDFC Bank Ltd. Account No : 900000005521 Page 1 of 1', 'Loan Account Number : 900000005521',
    'STATEMENT OF ACCOUNT FOR THE PERIOD 01-APR-26 to 30-SEP-26', 'LOAN AMOUNT : 1500000 ROI : 08.40% CURRENT EMI : 14800 DISBURSEMENT UPTO DATE: 1500000',
    'Opening balance 0 0 0', 'Receivable 88800 0 88800', 'Received 88800 0 88800',
    'Acc Dt Doc No PM Description Amount Eff Dt Bounce Reason (For Chq Bounce if any)',
    '06-APR-2026 1100000001 A E M I 14800 05-APR-2026', '06-MAY-2026 1100000002 A E M I 14800 05-MAY-2026',
    '06-JUN-2026 1100000003 A E M I 14800 05-JUN-2026', '06-JUL-2026 1100000004 A E M I 14800 05-JUL-2026',
    '06-JUL-2026 1100000004 B E M I (14800) 05-JUL-2026 BALANCE INSUFFICIENT', '09-JUL-2026 55500001 W INT ON UNPAID EMI/PEMI - L1 12 08-JUL-2026',
    '09-JUL-2026 55500001 W E M I 14800 08-JUL-2026', '09-JUL-2026 55500001 W CHEQUE DISHONOURED CHARGES 450 08-JUL-2026',
    '06-AUG-2026 1100000005 A E M I 14800 05-AUG-2026', '06-SEP-2026 1100000006 A E M I 14800 05-SEP-2026',
    'Negative amounts are indicated in brackets.', 'Paymode: A-ACH Mandate; B-Cheque; W-Web Online Receipt;', 'TYPE : DEMO HOME LOAN',
  ];
}
/** Synthetic HDFC-style credit-card loan EMI table (fake numbers): 36 months @ 12.5% on ₹3,00,000. */
export function demoCardLoanLines(paid = 29) {
  const P = 300000, r = 0.125 / 12, n = 36; const E = P * r * (1 + r) ** n / ((1 + r) ** n - 1);
  const M = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  let bal = P; const rows = [];
  for (let k = 0; k < n; k++) { const mi = 3 + k; const y = 2024 + Math.floor(mi / 12); const int = bal * r + (k === 0 ? 1520.55 : 0); const pr = k === n - 1 ? bal : E - bal * r; bal -= pr; rows.push([pr.toFixed(2), int.toFixed(2), `16 ${M[mi % 12]} ${y}`]); }
  const outs = rows.slice(paid).reduce((a, x) => a + +x[0], 0).toFixed(2);
  return { rows, outs, lines: ['HDFC BANK', 'Loan EMI Table', 'Loan Number Loan Booked Date Loan Type Principal Interest Rate (%) Tenure Principal', 'Amount (Rs.) (months) Outstanding (Rs.)',
    `0000000000900001234 10 Mar 2024 INSTALOAN 300000.00 12.50 36 ${outs}`, 'Principal (Rs.) Interest (Rs.) Statement Date', ...rows.map(x => x.join(' ')),
    'This is a system generated document and does not require signature.'] };
}
