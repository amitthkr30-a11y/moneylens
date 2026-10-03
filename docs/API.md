# API

## V1 engine API (ES modules in `js/core`)
| Function | Purpose |
|---|---|
| `ingest(state, {kind, rows\|lines, fileName, bank, accountType, last4, nickname})` | Full 10-step import, returns summary `{processed, categorized, needsReview, duplicates, transfers, ...}` |
| `correctTransaction(state, id, {category, subcategory, merchant, markTransfer, notTransfer, ignore, approve, notDuplicate})` | Persisted correction + learning |
| `deleteImport(state, importId)` | Remove a statement and its transactions |
| `kpis(txns, ctx)` | income, expenses, savings, savingsRate, investments, bills, emis, subscriptions, upi, cards, cash, transfers |
| `byCategory / byMerchant / byMode / byBank / byDow / byWeekend / byWeek / monthly / dailyHeat` | Groupings |
| `scorecard(txns, ctx, 'YYYY-MM')` | Current vs previous month with absolute & % change |
| `budgetStatus(budgets, txns, ctx, month)` | actual, remaining, utilization, status |
| `cashFlow`, `accountSummary`, `netWorth`, `emiSchedule`, `calendarEvents`, `insights` | Planning views |
| `ask(question, state, ctx)` | `{answer, sources[]}` grounded in user data |

## V2 REST mapping (server edition)
| Endpoint | Engine call |
|---|---|
| `POST /api/auth/register` | create user (argon2id) |
| `POST /api/statements/upload` | store → AV scan → queue job → `ingest()` |
| `GET /api/accounts` | `accountSummary()` |
| `GET /api/transactions?from&to&bank&account&q&category` | `filterTxns()` + search |
| `GET/PATCH /api/transactions/:id` | read / `correctTransaction()` |
| `GET /api/analytics/{expenses,income,merchants,categories}` | `kpis()`, `groupSum()` variants |
| `GET/POST /api/budgets` | `budgetStatus()` |
| `GET /api/subscriptions`, `GET /api/recurring` | `state.recurring` |
| `GET /api/net-worth` | `netWorth()` |
| `GET /api/insights` | `insights()` |
| `POST /api/aa/consent`, `GET /api/aa/status` | `AccountAggregatorProvider.initiateConsent / getConsentStatus` |
