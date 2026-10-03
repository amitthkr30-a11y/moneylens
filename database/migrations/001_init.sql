-- MoneyLens India — PostgreSQL schema for the V2 server edition (Supabase/Postgres).
-- V1 (GitHub Pages) stores the SAME model in browser IndexedDB; this migration is the server mapping.
-- Apply: psql "$DATABASE_URL" -f database/migrations/001_init.sql
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS citext;

CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email citext UNIQUE NOT NULL,
  password_hash text NOT NULL,              -- argon2id hash of the APP password; bank credentials are NEVER stored
  email_verified_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), deleted_at timestamptz
);
CREATE TABLE accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  bank_name text NOT NULL, account_type text NOT NULL CHECK (account_type IN ('Savings','Current','Credit Card','Other')),
  account_number_masked text NOT NULL CHECK (account_number_masked ~ '^XXXX XXXX \d{4}$'),  -- full numbers never stored
  nickname text, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE bank_connections (           -- Account Aggregator consents (no credentials)
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider text NOT NULL, consent_handle text NOT NULL, status text NOT NULL CHECK (status IN ('PENDING','ACTIVE','REJECTED','REVOKED','EXPIRED')),
  fi_types text[], data_from date, data_to date, expires_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE imports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE, account_id uuid REFERENCES accounts(id) ON DELETE CASCADE,
  file_name text, file_kind text, detected_bank text, status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','parsing','normalizing','classifying','finalizing','completed','failed')),
  processed int DEFAULT 0, categorized int DEFAULT 0, needs_review int DEFAULT 0, duplicates int DEFAULT 0, error_code text, processing_ms int,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE categories (id serial PRIMARY KEY, name text UNIQUE NOT NULL, is_essential boolean NOT NULL DEFAULT false);
CREATE TABLE subcategories (id serial PRIMARY KEY, category_id int NOT NULL REFERENCES categories(id), name text NOT NULL, UNIQUE (category_id, name));
CREATE TABLE merchants (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text UNIQUE NOT NULL, default_category_id int REFERENCES categories(id), default_subcategory_id int REFERENCES subcategories(id));
CREATE TABLE merchant_aliases (           -- learned from user corrections (user_id NULL = global rule)
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid REFERENCES users(id) ON DELETE CASCADE,
  alias_key text NOT NULL, merchant_id uuid NOT NULL REFERENCES merchants(id), category_id int REFERENCES categories(id), subcategory_id int REFERENCES subcategories(id),
  created_at timestamptz NOT NULL DEFAULT now(), UNIQUE (user_id, alias_key)
);
CREATE TABLE transactions (
  transaction_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE, account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE, import_id uuid REFERENCES imports(id) ON DELETE CASCADE,
  bank_name text NOT NULL, account_number_masked text NOT NULL,
  transaction_date date NOT NULL, value_date date, description_enc bytea NOT NULL,   -- narration encrypted at rest (app-level AES-GCM)
  reference_number text, debit numeric(14,2) NOT NULL DEFAULT 0, credit numeric(14,2) NOT NULL DEFAULT 0, amount numeric(14,2) NOT NULL, balance numeric(16,2),
  transaction_type text NOT NULL CHECK (transaction_type IN ('Debit','Credit')), payment_mode text, merchant text, upi_id text,
  category text, subcategory text, confidence_score numeric(3,2),
  is_transfer boolean NOT NULL DEFAULT false, is_recurring boolean NOT NULL DEFAULT false, is_subscription boolean NOT NULL DEFAULT false,
  is_cash_withdrawal boolean NOT NULL DEFAULT false, is_salary boolean NOT NULL DEFAULT false, is_bill_payment boolean NOT NULL DEFAULT false,
  is_refund boolean NOT NULL DEFAULT false, is_investment boolean NOT NULL DEFAULT false, is_emi boolean NOT NULL DEFAULT false,
  is_duplicate boolean NOT NULL DEFAULT false, excluded boolean NOT NULL DEFAULT false, transfer_pair_id uuid,
  user_verified_category boolean NOT NULL DEFAULT false, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX tx_user_date ON transactions (user_id, transaction_date DESC);
CREATE INDEX tx_user_cat ON transactions (user_id, category, transaction_date);
CREATE INDEX tx_user_merchant ON transactions (user_id, merchant);
CREATE INDEX tx_dupe ON transactions (account_id, transaction_date, amount, transaction_type);
CREATE TABLE transaction_reviews (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), transaction_id uuid NOT NULL REFERENCES transactions(transaction_id) ON DELETE CASCADE, reason text NOT NULL, resolution text, resolved_at timestamptz);
CREATE TABLE budgets (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE, category text NOT NULL, amount numeric(14,2) NOT NULL CHECK (amount > 0), UNIQUE (user_id, category));
CREATE TABLE recurring_transactions (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE, merchant text NOT NULL, amount numeric(14,2), frequency text CHECK (frequency IN ('Weekly','Monthly','Quarterly','Annual')), last_payment date, next_expected date, annual_cost numeric(14,2), is_emi boolean, is_sip boolean);
CREATE TABLE subscriptions (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE, recurring_id uuid REFERENCES recurring_transactions(id) ON DELETE CASCADE, status text NOT NULL DEFAULT 'Active' CHECK (status IN ('Active','Inactive','Review')));
CREATE TABLE loans (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE, name text, principal numeric(14,2), rate_pct numeric(5,2), tenure_months int, emi numeric(14,2), start_date date);
CREATE TABLE credit_cards (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE, credit_limit numeric(14,2), outstanding numeric(14,2), payment_due numeric(14,2), minimum_due numeric(14,2), statement_date date, due_date date);
CREATE TABLE investments (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE, type text, name text, value numeric(16,2), as_of date);
CREATE TABLE assets (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE, type text, name text, value numeric(16,2), as_of date);
CREATE TABLE liabilities (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE, type text, name text, value numeric(16,2), as_of date);
CREATE TABLE financial_insights (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE, period text, type text, text text, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE audit_logs (id bigserial PRIMARY KEY, user_id uuid, action text NOT NULL, meta jsonb, ip_hash text, at timestamptz NOT NULL DEFAULT now()); -- never store narrations/amounts

-- Row-level security: every user sees only their own rows (Supabase auth.uid()).
DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['accounts','bank_connections','imports','transactions','budgets','recurring_transactions','subscriptions','loans','investments','assets','liabilities','financial_insights'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY own_rows ON %I USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid())', t);
  END LOOP; END $$;
COMMIT;
