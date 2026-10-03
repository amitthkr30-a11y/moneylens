# Account Aggregator integration

India's RBI Account Aggregator (AA) framework lets a user share bank data with a Financial Information User (FIU) through an NBFC-AA, using an explicit, revocable consent artefact — no credentials are shared.

## Interface (`js/core/providers.js`)
```ts
interface AccountAggregatorProvider {
  initiateConsent({ banks, fromDate, toDate, purpose }): Promise<{ consentHandle, redirectUrl }>
  getConsentStatus(handle): Promise<'PENDING'|'ACTIVE'|'REJECTED'|'REVOKED'|'EXPIRED'>
  fetchAccounts(handle): Promise<{ fipId, bank, maskedAccNumber, type }[]>
  fetchTransactions(handle, account): Promise<RawTransaction[]>   // same shape as statement parsers
  revokeConsent(handle): Promise<void>
}
```
- `MockAccountAggregatorProvider` — synthetic data, used by **Connect Bank (AA)** in the app and in tests.
- `RemoteAccountAggregatorProvider` — calls *your* backend (`AA_API_BASE`) at `/aa/consent`, `/aa/status`, `/aa/accounts`, `/aa/transactions`, `/aa/revoke`.
- `getAAProvider(config)` picks the provider from `AA_PROVIDER` / `AA_API_BASE`.

## Going live (V2)
1. Onboard with a licensed AA or a technology service provider as FIU (business/regulatory requirement).
2. Implement the backend endpoints above; keep `AA_CLIENT_ID` / `AA_CLIENT_SECRET` and the ECDH key pair **server-side only**.
3. Map FI data (XML/JSON per ReBIT spec) to `RawTransaction {date, valueDate, description, reference, debit, credit, balance}` and call `ingest()`.
4. Show purpose, data range, fetch frequency and expiry in the consent UI; support revoke.
No provider is hard-coded because credentials and API documentation are partner-specific.
