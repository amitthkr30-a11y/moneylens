// BankDataProvider abstraction. V1 ships StatementUploadProvider + MockAccountAggregatorProvider.
// Credentials (passwords/OTP/PIN/CVV) are NEVER requested — live data must come via RBI's
// consent-based Account Aggregator framework through a licensed FIU/TSP partner (server-side).

/** @interface */
export class BankDataProvider {
  get id() { throw new Error('not implemented'); }
  async fetchTransactions() { throw new Error('not implemented'); }
}

export class StatementUploadProvider extends BankDataProvider {
  get id() { return 'statement_upload'; }
}

/**
 * AccountAggregatorProvider contract:
 * initiateConsent({ banks, fromDate, toDate, purpose }) → { consentHandle, redirectUrl }
 * getConsentStatus(handle) → 'PENDING' | 'ACTIVE' | 'REJECTED' | 'REVOKED' | 'EXPIRED'
 * fetchAccounts(handle) → [{ fipId, bank, maskedAccNumber, type }]
 * fetchTransactions(handle, account) → RawTransaction[]
 * revokeConsent(handle) → void
 */
export class AccountAggregatorProvider extends BankDataProvider {
  async initiateConsent() { throw new Error('not implemented'); }
  async getConsentStatus() { throw new Error('not implemented'); }
  async fetchAccounts() { throw new Error('not implemented'); }
  async revokeConsent() { throw new Error('not implemented'); }
}

export class MockAccountAggregatorProvider extends AccountAggregatorProvider {
  constructor(demoRows) { super(); this.demo = demoRows; this.consents = new Map(); }
  get id() { return 'mock_aa'; }
  async initiateConsent({ banks = ['HDFC', 'SBI'] } = {}) {
    const handle = 'mock-consent-' + Math.random().toString(36).slice(2, 10);
    this.consents.set(handle, { status: 'ACTIVE', banks });
    return { consentHandle: handle, redirectUrl: null, note: 'Mock provider: consent auto-approved with synthetic data.' };
  }
  async getConsentStatus(h) { return this.consents.get(h)?.status || 'EXPIRED'; }
  async fetchAccounts(h) {
    const c = this.consents.get(h); if (c?.status !== 'ACTIVE') throw new Error('Consent not active');
    return c.banks.map(b => ({ fipId: b + '-FIP', bank: b, maskedAccNumber: b === 'HDFC' ? '1234' : '9876', type: 'Savings' }));
  }
  async fetchTransactions(h, account) {
    if ((await this.getConsentStatus(h)) !== 'ACTIVE') throw new Error('Consent not active');
    return this.demo[account.bank] || [];
  }
  async revokeConsent(h) { const c = this.consents.get(h); if (c) c.status = 'REVOKED'; }
}

/**
 * Production provider placeholder. Real AA flows (consent artefacts, JWS signing, data decryption
 * with ECDH keys) MUST run on a backend holding AA_CLIENT_ID / AA_CLIENT_SECRET — never in a browser.
 * Configure via AA_PROVIDER + AA_API_BASE (see .env.example and docs/ACCOUNT_AGGREGATOR.md).
 */
export class RemoteAccountAggregatorProvider extends AccountAggregatorProvider {
  constructor(apiBase) { super(); this.apiBase = apiBase; }
  get id() { return 'remote_aa'; }
  async #call(path, body) {
    const r = await fetch(this.apiBase + path, { method: body ? 'POST' : 'GET', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    if (!r.ok) throw new Error('Account Aggregator service unavailable');
    return r.json();
  }
  initiateConsent(o) { return this.#call('/aa/consent', o); }
  getConsentStatus(h) { return this.#call('/aa/status?handle=' + encodeURIComponent(h)).then(x => x.status); }
  fetchAccounts(h) { return this.#call('/aa/accounts?handle=' + encodeURIComponent(h)); }
  fetchTransactions(h, a) { return this.#call('/aa/transactions', { handle: h, account: a }); }
  revokeConsent(h) { return this.#call('/aa/revoke', { handle: h }); }
}

export function getAAProvider(config, demoRows) {
  if (config?.AA_PROVIDER && config.AA_PROVIDER !== 'mock' && config.AA_API_BASE) return new RemoteAccountAggregatorProvider(config.AA_API_BASE);
  return new MockAccountAggregatorProvider(demoRows);
}
