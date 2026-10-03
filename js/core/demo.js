// Synthetic demo data — completely fake, deterministic (seeded) so tests are repeatable.
import { round2 } from './utils.js';

function rng(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }

/** Returns { HDFC: rawRows[], SBI: rawRows[], CARD: rawRows[] } in parser output shape. */
export function generateDemo(endDate = new Date().toISOString().slice(0, 10), months = 12, seed = 42) {
  const r = rng(seed); const pickA = a => a[Math.floor(r() * a.length)]; const amt = (lo, hi) => round2(lo + r() * (hi - lo));
  const end = new Date(endDate + 'T00:00:00Z');
  const H = [], S = [], C = [];
  let hb = 185000, sb = 62000; let ref = 400000000000;
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
    push(S, d(12), 'TO TRANSFER-UPI/DR/' + (ref) + '/AIRTEL/AIRP/airtelpayments@airtel/Postpaid--', amt(599, 799), 0, false);
    push(S, d(14), 'TO TRANSFER-UPI/DR/' + (ref) + '/TATA POWER/HDFC/tatapower@hdfcbank/Electricity--', amt(1800, 4200), 0, false);
    push(H, d(15), 'POS 4XXXXXXXXXX1234 ACT FIBERNET', 999, 0, true);
    push(H, d(16), 'UPI-MAHANAGAR GAS-mgl@icici-ICIC0000001-GASBILL', amt(650, 980), 0, true);
    push(S, d(20), 'ATM WDL-ATM CASH 1234 CHHINDWARA', pickA([3000, 5000, 5000, 10000]), 0, false);
    if (m % 3 === 0) push(H, d(18), 'ACH D- LIC OF INDIA PREMIUM', 8500, 0, true);
    if (m % 12 === 3) push(H, d(21), 'ME DC SI AMAZON PRIME MEMBERSHIP', 1499, 0, true);
    push(S, d(28), 'CREDIT INTEREST', 0, amt(120, 240), false);
    // card bill payment HDFC → own credit card (card account imported → excluded from expenses)
    const cardBill = amt(7000, 14000);
    push(H, d(22), 'CC 000XXXXXXXXXX4321 AUTOPAY SI-TAD', cardBill, 0, true);
    push(C, d(22), 'PAYMENT RECEIVED - THANK YOU', 0, cardBill, 'C');
    // variable daily spends
    const nVar = 26 + Math.floor(r() * 10);
    for (let k = 0; k < nVar; k++) {
      const day = 1 + Math.floor(r() * 28);
      const pickList = [
        ['UPI-SWIGGY-swiggy@icici-ICIC0000001-ORDER', 180, 750, 'H'],
        ['UPI-ZOMATO LTD-zomato@hdfcbank-HDFC0000001-ORDER', 200, 800, 'H'],
        ['TO TRANSFER-UPI/DR/REF/BIGBASKET/YESB/bigbasket@ybl/groceries--', 600, 2800, 'S'],
        ['TO TRANSFER-UPI/DR/REF/DMART/AXIS/dmart@axisbank/groceries--', 900, 3200, 'S'],
        ['UPI-INDIAN OIL PETROL PUMP-iocl.fuel@sbi-SBIN0000001-FUEL', 1000, 3000, 'H'],
        ['UPI-UBER INDIA-uber@axisbank-UTIB0000001-RIDE', 150, 600, 'H'],
        ['TO TRANSFER-UPI/DR/REF/RAHUL SHARMA/SBIN/rahul.sharma@oksbi/dinner--', 300, 1500, 'S'],
        ['UPI-STARBUCKS-starbucks@hdfcbank-HDFC0000001-COFFEE', 250, 600, 'H'],
        ['TO TRANSFER-UPI/DR/REF/APOLLO PHARMACY/ICIC/apollo@icici/meds--', 200, 1500, 'S'],
        ['CARD:AMAZON PAY INDIA PVT LTD BANGALORE', 300, 4500, 'C'],
        ['CARD:FLIPKART INTERNET PVT LTD', 400, 3500, 'C'],
        ['CARD:MYNTRA DESIGNS', 700, 2600, 'C'],
        ['CARD:BOOKMYSHOW', 400, 1200, 'C'],
        ['CARD:MAKEMYTRIP INDIA', 2500, 9000, 'C'],
      ];
      const [desc, lo, hi, acc] = pickA(pickList);
      const v = amt(lo, hi);
      if (acc === 'C') push(C, d(day), desc.slice(5) + ' ' + (1000 + k), v, 0, 'C');
      else push(acc === 'H' ? H : S, d(day), desc.replace('REF', String(ref)), v, 0, acc === 'H');
    }
    if (i === 1) push(C, d(25), 'CROMA RETAIL ELECTRONICS', 38999, 0, 'C');     // anomaly-ish
    if (i === 2) push(H, d(26), 'REFUND AMAZON ORDER 402-123', 0, 1299, true);
  }
  for (const a of [H, S, C]) a.sort((x, y) => x.date.localeCompare(y.date));
  // recompute running balances after sorting (demo realism)
  for (const [arr, start] of [[H, 185000], [S, 62000]]) { let b = start; for (const t of arr) { b = round2(b - t.debit + t.credit); t.balance = b; } }
  return { HDFC: H, SBI: S, CARD: C };
}

/** Render rows as an HDFC-style or SBI-style CSV (used for sample files & tests). */
export function toBankCSV(rows, bank) {
  const f = d => { const [y, m, dd] = d.split('-'); return bank === 'HDFC' ? `${dd}/${m}/${y.slice(2)}` : `${+dd} ${['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][+m - 1]} ${y}`; };
  const q = s => `"${String(s).replace(/"/g, '""')}"`;
  if (bank === 'HDFC') return ['HDFC BANK Ltd. Statement of account (SYNTHETIC DEMO DATA)', 'Date,Narration,Chq./Ref.No.,Value Dt,Withdrawal Amt.,Deposit Amt.,Closing Balance',
    ...rows.map(t => [f(t.date), q(t.description), t.reference, f(t.valueDate), t.debit ? t.debit.toFixed(2) : '', t.credit ? t.credit.toFixed(2) : '', t.balance?.toFixed(2) ?? ''].join(','))].join('\n');
  return ['State Bank of India - Account Statement (SYNTHETIC DEMO DATA)', 'Txn Date,Value Date,Description,Ref No./Cheque No.,Debit,Credit,Balance',
    ...rows.map(t => [f(t.date), f(t.valueDate), q(t.description), q(t.reference), t.debit ? t.debit.toFixed(2) : '', t.credit ? t.credit.toFixed(2) : '', t.balance?.toFixed(2) ?? ''].join(','))].join('\n');
}
