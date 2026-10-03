// Merchant normalization + UPI intelligence + rules-based classification (ML-ready: every
// result carries a confidence score; user corrections are stored as overrides and win).

// [regex, canonical merchant, category, subcategory, flags]
export const MERCHANT_RULES = [
  [/swiggy\s*instamart|instamart/i, 'Swiggy Instamart', 'Food & Dining', 'Groceries'],
  [/swiggy|bundl tech/i, 'Swiggy', 'Food & Dining', 'Food Delivery'],
  [/zomato|blinkit|grofers/i, m => /blinkit|grofers/i.test(m) ? 'Blinkit' : 'Zomato', 'Food & Dining', m => /blinkit|grofers/i.test(m) ? 'Groceries' : 'Food Delivery'],
  [/bigbasket|big basket|zepto|dmart|avenue supermarts|reliance fresh|jiomart|more retail|nature.?s basket|spencer/i, m => pick(m, { bigbasket: 'BigBasket', 'big basket': 'BigBasket', zepto: 'Zepto', dmart: 'DMart', avenue: 'DMart', jiomart: 'JioMart', 'reliance fresh': 'Reliance Fresh', more: 'More', nature: "Nature's Basket", spencer: "Spencer's" }), 'Food & Dining', 'Groceries'],
  [/starbucks|cafe coffee day|\bccd\b|chaayos|third wave|blue tokai/i, m => pick(m, { starbucks: 'Starbucks', 'cafe coffee': 'Cafe Coffee Day', ccd: 'Cafe Coffee Day', chaayos: 'Chaayos', 'third wave': 'Third Wave Coffee', 'blue tokai': 'Blue Tokai' }), 'Food & Dining', 'Cafe'],
  [/dominos|domino|mcdonald|kfc|pizza hut|burger king|haldiram|barbeque|restaurant|hotel .*rest|dhaba/i, m => pick(m, { domino: "Domino's", mcdonald: "McDonald's", kfc: 'KFC', 'pizza hut': 'Pizza Hut', 'burger king': 'Burger King', haldiram: 'Haldiram' }), 'Food & Dining', 'Restaurants'],
  [/amazon\s*prime|primevideo|prime video/i, 'Amazon Prime', 'Entertainment', 'OTT', { subscription: true }],
  [/amazon|amzn/i, 'Amazon', 'Shopping', 'Online Shopping'],
  [/flipkart|myntra|ajio|meesho|nykaa|tata cliq|snapdeal/i, m => pick(m, { flipkart: 'Flipkart', myntra: 'Myntra', ajio: 'Ajio', meesho: 'Meesho', nykaa: 'Nykaa', 'tata cliq': 'Tata CLiQ', snapdeal: 'Snapdeal' }), 'Shopping', m => /myntra|ajio/i.test(m) ? 'Clothing' : /nykaa/i.test(m) ? 'Personal Care' : 'Online Shopping'],
  [/croma|reliance digital|vijay sales|apple india|samsung/i, m => pick(m, { croma: 'Croma', 'reliance digital': 'Reliance Digital', 'vijay sales': 'Vijay Sales', apple: 'Apple', samsung: 'Samsung' }), 'Shopping', 'Electronics'],
  [/ikea|pepperfry|urban ladder|home centre/i, m => pick(m, { ikea: 'IKEA', pepperfry: 'Pepperfry', 'urban ladder': 'Urban Ladder', 'home centre': 'Home Centre' }), 'Shopping', 'Household'],
  [/netflix/i, 'Netflix', 'Entertainment', 'OTT', { subscription: true }],
  [/spotify/i, 'Spotify', 'Entertainment', 'OTT', { subscription: true }],
  [/hotstar|jiocinema|jiohotstar|sonyliv|zee5|youtube\s*premium|google\s*youtube/i, m => pick(m, { hotstar: 'JioHotstar', jiocinema: 'JioCinema', sonyliv: 'SonyLIV', zee5: 'ZEE5', youtube: 'YouTube Premium' }), 'Entertainment', 'OTT', { subscription: true }],
  [/bookmyshow|pvr|inox|cinepolis/i, m => pick(m, { bookmyshow: 'BookMyShow', pvr: 'PVR INOX', inox: 'PVR INOX', cinepolis: 'Cinepolis' }), 'Entertainment', 'Movies'],
  [/steam|playstation|xbox|dream11|mpl\b/i, m => pick(m, { steam: 'Steam', playstation: 'PlayStation', xbox: 'Xbox', dream11: 'Dream11', mpl: 'MPL' }), 'Entertainment', 'Gaming'],
  [/microsoft|adobe|google\s*(one|storage|workspace)|icloud|apple\.com\/bill|openai|chatgpt|canva|notion|github|dropbox/i, m => pick(m, { microsoft: 'Microsoft 365', adobe: 'Adobe', google: 'Google One', icloud: 'Apple iCloud', 'apple.com': 'Apple Services', openai: 'OpenAI', chatgpt: 'OpenAI', canva: 'Canva', notion: 'Notion', github: 'GitHub', dropbox: 'Dropbox' }), 'Bills & Utilities', 'Software Subscription', { subscription: true }],
  [/uber/i, 'Uber', 'Transport', 'Ride Sharing'],
  [/\bola\b|olacabs|ani technologies|rapido/i, m => /rapido/i.test(m) ? 'Rapido' : 'Ola', 'Transport', 'Ride Sharing'],
  [/indian oil|iocl|bharat petroleum|bpcl|hpcl|hindustan petroleum|petrol|fuel|shell india|nayara/i, m => pick(m, { iocl: 'Indian Oil', 'indian oil': 'Indian Oil', bpcl: 'Bharat Petroleum', bharat: 'Bharat Petroleum', hpcl: 'HP Petrol', hindustan: 'HP Petrol', shell: 'Shell', nayara: 'Nayara' }) , 'Transport', 'Fuel'],
  [/fastag|toll|nhai|paytm.*fastag/i, 'FASTag', 'Transport', 'Toll'],
  [/metro|dmrc|mmrda|bmrcl/i, 'Metro', 'Transport', 'Metro'],
  [/irctc|indian railway/i, 'IRCTC', 'Travel', 'Travel Booking'],
  [/redbus|msrtc|ksrtc|\bbus\b/i, m => /redbus/i.test(m) ? 'redBus' : 'Bus', 'Transport', 'Bus'],
  [/parking/i, 'Parking', 'Transport', 'Parking'],
  [/indigo|interglobe|air india|vistara|akasa|spicejet/i, m => pick(m, { indigo: 'IndiGo', interglobe: 'IndiGo', 'air india': 'Air India', vistara: 'Air India', akasa: 'Akasa Air', spicejet: 'SpiceJet' }), 'Travel', 'Flights'],
  [/makemytrip|goibibo|cleartrip|yatra|ixigo|easemytrip/i, m => pick(m, { makemytrip: 'MakeMyTrip', goibibo: 'Goibibo', cleartrip: 'Cleartrip', yatra: 'Yatra', ixigo: 'ixigo', easemytrip: 'EaseMyTrip' }), 'Travel', 'Travel Booking'],
  [/oyo|taj hotels|marriott|airbnb|treebo|fabhotel/i, m => pick(m, { oyo: 'OYO', taj: 'Taj Hotels', marriott: 'Marriott', airbnb: 'Airbnb', treebo: 'Treebo', fabhotel: 'FabHotels' }), 'Travel', 'Hotels'],
  [/tata power|adani electricity|msedcl|mahadiscom|\bbses\b|tneb|bescom|mpeb|mpez|mppkvvcl|electricity|torrent power|cesc/i, m => pick(m, { 'tata power': 'Tata Power', adani: 'Adani Electricity', msedcl: 'MSEDCL', mahadiscom: 'MSEDCL', bses: 'BSES', bescom: 'BESCOM', mp: 'MP Electricity', torrent: 'Torrent Power', cesc: 'CESC' }), 'Bills & Utilities', 'Electricity', { bill: true }],
  [/mahanagar gas|indraprastha gas|\bigl\b|\bmgl\b|indane|hp gas|bharatgas|gas bill/i, m => pick(m, { mahanagar: 'Mahanagar Gas', indraprastha: 'IGL', igl: 'IGL', mgl: 'Mahanagar Gas', indane: 'Indane', 'hp gas': 'HP Gas', bharatgas: 'Bharatgas' }), 'Bills & Utilities', 'Gas', { bill: true }],
  [/water bill|jal board|municipal/i, 'Water Utility', 'Bills & Utilities', 'Water', { bill: true }],
  [/airtel|jio|reliance jio|vodafone|\bvi\b|bsnl/i, m => pick(m, { airtel: 'Airtel', jio: 'Jio', vodafone: 'Vi', vi: 'Vi', bsnl: 'BSNL' }), 'Bills & Utilities', m => /fiber|broadband|xstream/i.test(m) ? 'Internet' : 'Mobile', { bill: true }],
  [/act fibernet|hathway|tikona|excitel|broadband/i, m => pick(m, { act: 'ACT Fibernet', hathway: 'Hathway', tikona: 'Tikona', excitel: 'Excitel' }) , 'Bills & Utilities', 'Internet', { bill: true }],
  [/tata\s*play|tatasky|dish tv|d2h|sun direct/i, m => pick(m, { tata: 'Tata Play', dish: 'Dish TV', d2h: 'd2h', sun: 'Sun Direct' }), 'Bills & Utilities', 'DTH', { bill: true }],
  [/lic\b|life insurance|hdfc life|icici pru|sbi life|max life|star health|hdfc ergo|icici lombard|policybazaar|digit insurance|acko|niva bupa|care health/i, m => pick(m, { lic: 'LIC', 'hdfc life': 'HDFC Life', 'icici pru': 'ICICI Prudential', 'sbi life': 'SBI Life', 'max life': 'Max Life', star: 'Star Health', ergo: 'HDFC ERGO', lombard: 'ICICI Lombard', policybazaar: 'PolicyBazaar', digit: 'Digit Insurance', acko: 'ACKO', niva: 'Niva Bupa', care: 'Care Health' }), 'Bills & Utilities', 'Insurance', { bill: true }],
  [/apollo|pharmeasy|1mg|netmeds|medplus|pharmacy|chemist|medical/i, m => pick(m, { apollo: 'Apollo', pharmeasy: 'PharmEasy', '1mg': 'Tata 1mg', netmeds: 'Netmeds', medplus: 'MedPlus' }), 'Health', 'Pharmacy'],
  [/hospital|clinic|fortis|manipal|max healthcare|aiims/i, m => pick(m, { fortis: 'Fortis', manipal: 'Manipal Hospitals', max: 'Max Healthcare' }), 'Health', 'Hospital'],
  [/practo|doctor|dr\./i, 'Practo', 'Health', 'Doctor'],
  [/thyrocare|lal path|metropolis|srl diagnostics|diagnostic|redcliffe/i, m => pick(m, { thyrocare: 'Thyrocare', lal: 'Dr Lal PathLabs', metropolis: 'Metropolis', srl: 'SRL', redcliffe: 'Redcliffe Labs' }), 'Health', 'Diagnostics'],
  [/cult\.?fit|curefit|gym|fitness|gold.?s gym|anytime fitness/i, m => /cult|curefit/i.test(m) ? 'Cult.fit' : 'Gym', 'Health', 'Fitness', { subscription: true }],
  [/school|vidyalaya|academy fee/i, 'School', 'Education', 'School'],
  [/college|university|institute/i, 'College', 'Education', 'College'],
  [/udemy|coursera|byju|unacademy|upgrad|simplilearn|linkedin learning/i, m => pick(m, { udemy: 'Udemy', coursera: 'Coursera', byju: "BYJU'S", unacademy: 'Unacademy', upgrad: 'upGrad', simplilearn: 'Simplilearn', linkedin: 'LinkedIn Learning' }), 'Education', 'Courses'],
  [/kindle|crossword|books/i, 'Books', 'Education', 'Books'],
  [/zerodha|groww|upstox|angel one|icicidirect|hdfc securities|kite/i, m => pick(m, { zerodha: 'Zerodha', kite: 'Zerodha', groww: 'Groww', upstox: 'Upstox', angel: 'Angel One', icicidirect: 'ICICI Direct', 'hdfc securities': 'HDFC Securities' }), 'Investment', 'Stocks', { investment: true }],
  [/\bsip\b|mutual fund|bse star|nse mf|cams|kfintech|kfin|mf utility|indian clearing corp|iccl|bsestarmf/i, 'Mutual Fund SIP', 'Investment', 'SIP', { investment: true }],
  [/\bnps\b|pension system|protean|nsdl e-gov/i, 'NPS', 'Investment', 'NPS', { investment: true }],
  [/\bfd\b|fixed deposit|term deposit|tdr\b/i, 'Fixed Deposit', 'Investment', 'FD', { investment: true }],
  [/\brd\b|recurring deposit|rd inst/i, 'Recurring Deposit', 'Investment', 'RD', { investment: true }],
  [/\bppf\b|sukanya/i, 'PPF', 'Investment', 'Insurance Investment', { investment: true }],
];

function pick(text, dict) {
  const t = text.toLowerCase();
  for (const [k, v] of Object.entries(dict)) if (t.includes(k)) return v;
  return Object.values(dict)[0];
}

const resolve = (v, m) => (typeof v === 'function' ? v(m) : v);

/** UPI intelligence: extract VPA, payee name, reference, direction from HDFC/SBI narrations. */
export function parseUPI(desc) {
  const d = desc || '';
  if (!/\bupi\b|@[a-z]{2,}/i.test(d)) return null;
  const vpa = (d.match(/[a-z0-9._]{2,}@[a-z]{2,}/i) || [])[0] || ''; // '-' excluded: HDFC uses it as a field separator
  const ref = (d.match(/\b(\d{12})\b/) || [])[1] || '';
  let name = '';
  // HDFC: UPI-NAME-VPA-IFSC-REF-NOTE ; SBI: TO TRANSFER-UPI/DR/REF/NAME/BANK/VPA/NOTE ; generic: UPI/NAME
  let m = d.match(/UPI-([^-]+)-/i);
  if (m) name = m[1];
  else if ((m = d.match(/UPI\/(?:DR|CR)\/\d+\/([^\/]+)/i))) name = m[1];
  else if ((m = d.match(/UPI\/([^\/@]+)/i))) name = m[1];
  if (!name && vpa) name = vpa.split('@')[0];
  const direction = /\/CR\/|BY TRANSFER|\bCR\b/i.test(d) ? 'in' : /\/DR\/|TO TRANSFER/i.test(d) ? 'out' : '';
  return { vpa: vpa.toLowerCase(), name: titleCase(name.replace(/[^a-z0-9 .&]/gi, ' ').trim()), reference: ref, direction };
}
export const titleCase = s => s.toLowerCase().replace(/\s+/g, ' ').replace(/\b\w/g, c => c.toUpperCase()).trim();

export function detectPaymentMode(desc) {
  const d = (desc || '').toUpperCase();
  if (/\bUPI\b|UPI[-\/]/.test(d)) return 'UPI';
  if (/\bATM\b|ATW|NWD|CASH WDL|CASH WITHDRAWAL|ATM WDL/.test(d)) return 'Cash';
  if (/\bNEFT\b/.test(d)) return 'NEFT';
  if (/\bIMPS\b|MMT\//.test(d)) return 'IMPS';
  if (/\bRTGS\b/.test(d)) return 'RTGS';
  if (/\bNACH\b|\bECS\b|ACH D|\bSI\b|STANDING INSTRUCTION|AUTOPAY|E-MANDATE|MANDATE/.test(d)) return 'Auto Debit';
  if (/\bPOS\b|DEBIT CARD|\bDC\b|CARD \d|VISA|MASTERCARD|RUPAY|ME DC|POS \d/.test(d)) return 'Debit Card';
  if (/\bCHQ\b|CHEQUE|CLG|CLEARING/.test(d)) return 'Cheque';
  if (/NET ?BANKING|\bNETBK|BILLDESK|\bIB\b|INB /.test(d)) return 'Net Banking';
  return 'Other';
}

/** Clean noisy narration into a readable merchant guess when no rule matches. */
export function guessMerchant(desc) {
  const upi = parseUPI(desc);
  if (upi && upi.name) return upi.name;
  const cleaned = (desc || '')
    .replace(/\b(POS|NEFT|IMPS|RTGS|ACH|NACH|ECS|DR|CR|INB|TO|BY|TRANSFER|PAYMENT|TXN|REF|NO|DEBIT|CREDIT|CARD|ME|DC|VISA|MASTERCARD)\b/gi, ' ')
    .replace(/[0-9X*]{4,}/gi, ' ').replace(/[^a-z .&]/gi, ' ').replace(/\s+/g, ' ').trim();
  return titleCase(cleaned.split(' ').slice(0, 3).join(' ')) || 'Unknown';
}

/**
 * Classify one normalized transaction (mutates & returns it).
 * ctx: { merchantOverrides: {aliasKey: merchant}, categoryOverrides: {merchant: [cat, sub]}, selfNames: [] }
 */
export function classify(t, ctx = {}) {
  const d = t.description || '';
  const D = d.toUpperCase();
  const isDebit = t.debit > 0;
  t.payment_mode = t.account_type === 'Credit Card' ? 'Credit Card' : detectPaymentMode(d);
  const upi = parseUPI(d);
  t.upi_id = upi?.vpa || '';
  let merchant = null, cat = null, sub = null, conf = 0.4, flags = {};

  // 1) bank-level patterns (highest priority, deterministic)
  if (t.payment_mode === 'Cash' && isDebit) { merchant = 'ATM Withdrawal'; cat = 'Cash'; sub = 'ATM Withdrawal'; conf = 0.98; flags.cash = true; }
  else if (/SALARY|SAL CREDIT|\bSAL\b|PAYROLL/.test(D) && !isDebit) { cat = 'Income'; sub = 'Salary'; conf = 0.97; flags.salary = true; merchant = employerFrom(d); }
  else if (/\bINT(EREST)?\.?\s?(PD|PAID|CREDIT|CR)\b|INTEREST CREDIT|CREDIT INTEREST|SB INT/.test(D) && !isDebit) { merchant = 'Bank Interest'; cat = 'Income'; sub = 'Interest'; conf = 0.95; }
  else if (/CASHBACK|CASH BACK/.test(D) && !isDebit) { merchant = 'Cashback'; cat = 'Income'; sub = 'Cashback'; conf = 0.9; }
  else if (/REFUND|REVERSAL|\bREV\b|CHARGEBACK/.test(D) && !isDebit) { cat = 'Income'; sub = 'Refund'; conf = 0.85; flags.refund = true; }
  else if (/\bEMI\b|LOAN|LN REPAY|BAJAJ FIN|HOME FIN|\bHFL\b/.test(D) && isDebit) { cat = 'Finance'; sub = /\bEMI\b/.test(D) ? 'EMI' : 'Loan Payment'; conf = 0.9; flags.emi = true; merchant = lenderFrom(D); }
  else if (/CREDIT CARD|CC PAYMENT|\bCC\b.*(?:AUTOPAY|PAYMENT|SI-TAD)|CCPAY|CARD PAYMENT|CRED CLUB|\bCRED\b|AUTOPAY.*CARD|BILLPAY.*CARD/.test(D) && isDebit && t.account_type !== 'Credit Card') { merchant = 'Credit Card Payment'; cat = 'Finance'; sub = 'Credit Card Payment'; conf = 0.92; flags.ccPayment = true; }
  else if (/PAYMENT RECEIVED|THANK YOU FOR PAYMENT|PAYMENT - THANK/.test(D) && t.account_type === 'Credit Card' && !isDebit) { merchant = 'Card Bill Payment'; cat = 'Transfers'; sub = 'Credit Card Payment Received'; conf = 0.95; flags.ccPaymentReceived = true; }
  else if (/CHARGES|CHRG|\bFEE\b|GST ON|SMS ALERT|AMC|MIN BAL|ANNUAL FEE|PENAL/.test(D) && isDebit) { merchant = 'Bank Charges'; cat = 'Finance'; sub = 'Bank Charges'; conf = 0.9; }
  else if (/\bRENT\b|NOBROKER|HOUSE RENT/.test(D) && isDebit) { merchant = 'Rent'; cat = 'Housing'; sub = 'Rent'; conf = 0.85; }

  // 2) merchant rules
  if (!cat || !merchant) {
    for (const [re, m, c, s, f] of MERCHANT_RULES) {
      if (re.test(d)) {
        merchant = merchant || resolve(m, d);
        if (!cat) { cat = c; sub = resolve(s, d); conf = 0.88; Object.assign(flags, f || {}); }
        break;
      }
    }
  }
  if (!merchant) merchant = guessMerchant(d);

  // 3) generic fallbacks
  if (!cat) {
    if (!isDebit) { cat = 'Income'; sub = 'Other Income'; conf = 0.5; }
    else if (t.payment_mode === 'UPI' && upi) { cat = 'Transfers'; sub = 'UPI Transfer'; conf = 0.55; } // person-to-person UPI
    else if (['NEFT', 'IMPS', 'RTGS'].includes(t.payment_mode)) { cat = 'Transfers'; sub = 'Bank Transfer'; conf = 0.55; }
    else { cat = 'Other'; sub = 'Uncategorized'; conf = 0.3; }
  }

  // 4) user learning — overrides always win
  const key = aliasKey(t);
  if (ctx.merchantOverrides && ctx.merchantOverrides[key]) merchant = ctx.merchantOverrides[key];
  if (ctx.categoryOverrides && ctx.categoryOverrides[merchant]) { [cat, sub] = ctx.categoryOverrides[merchant]; conf = 1; }
  if ((ctx.selfNames || []).some(n => n && D.includes(n.toUpperCase())) && ['Transfers', 'Other', 'Income'].includes(cat) && !flags.salary) { cat = 'Transfers'; sub = 'Own Account Transfer'; conf = 0.8; t.is_transfer = true; }

  t.merchant = merchant;
  t.category = cat; t.subcategory = sub; t.confidence_score = conf;
  t.transaction_type = isDebit ? 'Debit' : 'Credit';
  t.is_cash_withdrawal = !!flags.cash;
  t.is_salary = !!flags.salary;
  t.is_refund = !!flags.refund;
  t.is_emi = !!flags.emi;
  t.is_investment = !!flags.investment || cat === 'Investment';
  t.is_bill_payment = !!flags.bill || cat === 'Bills & Utilities';
  t.is_subscription = !!flags.subscription;
  t.is_cc_payment = !!flags.ccPayment;
  t.is_cc_payment_received = !!flags.ccPaymentReceived;
  if (cat === 'Transfers' && sub === 'Own Account Transfer') t.is_transfer = true;
  return t;
}

const LENDERS = ['HDFC BANK', 'SBI', 'ICICI', 'AXIS', 'KOTAK', 'BAJAJ FIN', 'TATA CAPITAL', 'LIC HOUSING', 'PNB HOUSING', 'IDFC', 'HOME CREDIT'];
function lenderFrom(D) {
  const l = LENDERS.find(x => D.includes(x));
  const kind = /HOME/.test(D) ? 'Home Loan' : /CAR|AUTO|VEHICLE/.test(D) ? 'Car Loan' : /PERSONAL|\bPL\b/.test(D) ? 'Personal Loan' : 'Loan';
  const nice = { 'HDFC BANK': 'HDFC Bank', SBI: 'SBI', ICICI: 'ICICI Bank', AXIS: 'Axis Bank', KOTAK: 'Kotak', IDFC: 'IDFC First' }[l] || titleCase(l || '');
  return l ? `${nice} ${kind} EMI` : `${kind} EMI`;
}

function employerFrom(d) {
  const m = d.match(/(?:NEFT|IMPS|RTGS)[-\/ ]?(?:CR)?[-\/ ]?[A-Z0-9]*[-\/ ]([A-Z][A-Z &.]{3,40}?)(?:[-\/]|LTD|PVT|$)/i);
  return m ? titleCase(m[1]) + ' (Salary)' : 'Salary';
}

/** Key used to remember merchant corrections: UPI VPA if present, else cleaned narration stem. */
export function aliasKey(t) {
  if (t.upi_id) return 'upi:' + t.upi_id;
  return 'desc:' + (t.description || '').toUpperCase().replace(/[0-9]+/g, '').replace(/[^A-Z ]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 40);
}

export const CATEGORY_TREE = {
  'Food & Dining': ['Restaurants', 'Food Delivery', 'Groceries', 'Cafe', 'Snacks'],
  'Transport': ['Fuel', 'Metro', 'Bus', 'Taxi', 'Ride Sharing', 'Parking', 'Toll'],
  'Shopping': ['Online Shopping', 'Clothing', 'Electronics', 'Household', 'Personal Care'],
  'Housing': ['Rent', 'Maintenance', 'Repairs'],
  'Bills & Utilities': ['Electricity', 'Gas', 'Water', 'Mobile', 'Internet', 'DTH', 'Insurance', 'Software Subscription'],
  'Entertainment': ['Movies', 'OTT', 'Gaming', 'Events'],
  'Health': ['Hospital', 'Pharmacy', 'Doctor', 'Diagnostics', 'Fitness'],
  'Travel': ['Flights', 'Hotels', 'Travel Booking'],
  'Education': ['School', 'College', 'Courses', 'Books'],
  'Finance': ['EMI', 'Loan Payment', 'Credit Card Payment', 'Bank Charges', 'Interest'],
  'Investment': ['Mutual Fund', 'SIP', 'Stocks', 'NPS', 'FD', 'RD', 'Insurance Investment'],
  'Income': ['Salary', 'Interest', 'Refund', 'Cashback', 'Other Income'],
  'Transfers': ['Own Account Transfer', 'Family Transfer', 'UPI Transfer', 'Bank Transfer', 'Credit Card Payment Received'],
  'Cash': ['ATM Withdrawal'],
  'Other': ['Uncategorized'],
};
export const ESSENTIAL = new Set(['Housing', 'Bills & Utilities', 'Health', 'Education', 'Finance', 'Transport']);
