-- M1 foundation: identity, tenant boundary, sessions, admin second factor, ledger, audit.
-- Contract: docs/ARCHITECTURE.md section 4, docs/SECURITY.md section 2. Money is integer micro-IDR.

create function forbid_mutation() returns trigger language plpgsql as $$
begin raise exception 'table % is append-only', tg_table_name using errcode = 'P0001'; end $$;

create table app_user (
  id uuid primary key default gen_random_uuid(),
  username text not null check (username ~ '^[a-z0-9_]{3,24}$'),
  email text not null check (email = lower(email)),
  password_hash text not null,
  role text not null check (role in ('CUSTOMER', 'ADMIN')),
  status text not null default 'ACTIVE' check (status in ('ACTIVE', 'CLOSED')),
  created_at timestamptz not null default now()
);
create unique index app_user_username_key on app_user (username);
create unique index app_user_email_key on app_user (email);

create table tenant (
  id uuid primary key default gen_random_uuid(),
  status text not null default 'ACTIVE' check (status in ('ACTIVE', 'SUSPENDED', 'CLOSED')),
  created_at timestamptz not null default now()
);
create table membership (
  user_id uuid not null references app_user,
  tenant_id uuid not null references tenant,
  role text not null check (role in ('OWNER')),
  primary key (user_id, tenant_id)
);
create unique index membership_one_owner on membership (tenant_id) where role = 'OWNER';
create unique index membership_one_tenant_per_user on membership (user_id);

create table invite (
  id uuid primary key default gen_random_uuid(),
  token_hash text not null unique,
  email text not null check (email = lower(email)),
  status text not null default 'PENDING' check (status in ('PENDING', 'ACCEPTED', 'REVOKED')),
  expires_at timestamptz not null,
  created_by uuid not null references app_user,
  accepted_user uuid references app_user,
  created_at timestamptz not null default now()
);

create table session (
  id uuid primary key default gen_random_uuid(),
  token_hash text not null unique,
  user_id uuid not null references app_user,
  kind text not null check (kind in ('CUSTOMER', 'ADMIN')),
  mfa_verified boolean not null default false,
  auth_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked_at timestamptz
);
create index session_by_user on session (user_id);

create table password_reset (
  id uuid primary key default gen_random_uuid(),
  token_hash text not null unique,
  user_id uuid not null references app_user,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);

create table admin_credential (
  user_id uuid primary key references app_user,
  totp_secret_enc text not null,
  last_totp_step bigint not null default 0
);
create table admin_recovery_code (
  user_id uuid not null references app_user,
  code_hash text not null,
  used_at timestamptz,
  primary key (user_id, code_hash)
);

create table rate_limit (
  bucket text primary key,
  window_start timestamptz not null,
  count integer not null
);

create table ledger_account (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null unique references tenant,
  currency text not null default 'IDR',
  scale smallint not null default 6,
  posted bigint not null default 0,
  held bigint not null default 0 check (held >= 0)
);
create table ledger_entry (
  id bigserial primary key,
  account_id uuid not null references ledger_account,
  kind text not null check (kind in ('GRANT_REDEEM', 'GRANT_ADMIN_TOPUP', 'DEBIT_USAGE', 'ADJUSTMENT_CREDIT', 'ADJUSTMENT_DEBIT')),
  amount bigint not null check (amount <> 0),
  idem_key text not null,
  ref jsonb not null default '{}',
  actor_user uuid references app_user,
  created_at timestamptz not null default now(),
  unique (kind, idem_key),
  check ((kind in ('GRANT_REDEEM', 'GRANT_ADMIN_TOPUP', 'ADJUSTMENT_CREDIT') and amount > 0) or (kind in ('DEBIT_USAGE', 'ADJUSTMENT_DEBIT') and amount < 0))
);
create index ledger_entry_account on ledger_entry (account_id, id desc);
create trigger ledger_entry_append_only before update or delete on ledger_entry for each row execute function forbid_mutation();

create table hold (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references ledger_account,
  request_id text not null unique,
  amount bigint not null check (amount > 0),
  status text not null default 'ACTIVE' check (status in ('ACTIVE', 'CAPTURED', 'RELEASED')),
  created_at timestamptz not null default now(),
  closed_at timestamptz
);

create table idempotency_record (
  scope text not null,
  key text not null,
  payload_hash text not null,
  result jsonb not null,
  created_at timestamptz not null default now(),
  primary key (scope, key)
);

create table audit_event (
  id bigserial primary key,
  actor_user uuid references app_user,
  actor_kind text not null check (actor_kind in ('ADMIN', 'CUSTOMER', 'SYSTEM', 'ANON')),
  action text not null,
  target_type text not null,
  target_id text,
  summary jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create trigger audit_event_append_only before update or delete on audit_event for each row execute function forbid_mutation();
