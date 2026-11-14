-- Token packs (display catalogue) and redeem codes valued in token credits (FR-004, FR-005, CR-013).

create table token_pack (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(name) between 1 and 80),
  tokens bigint not null check (tokens > 0),                 -- whole token credits
  display_price_idr bigint not null check (display_price_idr >= 0),
  is_promo boolean not null default false,
  active boolean not null default true,
  version bigint not null default 1 check (version > 0),
  created_at timestamptz not null default now()
);

create table voucher (
  id uuid primary key default gen_random_uuid(),
  seq bigserial unique,
  code_hash text not null unique check (code_hash ~ '^[0-9a-f]{64}$'),
  prefix text not null,
  amount bigint not null check (amount > 0),                  -- micro-credits, immutable
  kind text not null check (kind in ('SALE', 'PROMO')),
  sale_ref text not null check (length(sale_ref) between 1 and 200),
  pack_id uuid references token_pack,
  price_idr bigint check (price_idr >= 0),                    -- display price at issue time, for sales records
  recipient_tenant uuid references tenant,
  expires_at timestamptz,
  status text not null default 'ACTIVE' check (status in ('ACTIVE', 'REDEEMED', 'REVOKED')),
  issued_by uuid not null references app_user,
  issue_key_hash text not null,
  issued_at timestamptz not null default now(),
  closed_at timestamptz,
  unique (issued_by, issue_key_hash),
  check ((status = 'ACTIVE') = (closed_at is null))
);
-- One live code per sale reference; a revoked code frees the reference for a replacement.
create unique index voucher_sale_ref_live on voucher (sale_ref) where kind = 'SALE' and status <> 'REVOKED';

create function guard_voucher() returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then raise exception 'vouchers cannot be deleted' using errcode = 'P0001'; end if;
  if old.status <> 'ACTIVE' then raise exception 'voucher state is terminal' using errcode = 'P0001'; end if;
  if new.id <> old.id or new.code_hash <> old.code_hash or new.amount <> old.amount or new.kind <> old.kind
     or new.sale_ref <> old.sale_ref or new.recipient_tenant is distinct from old.recipient_tenant
     or new.expires_at is distinct from old.expires_at or new.issued_by <> old.issued_by then
    raise exception 'voucher value and terms are immutable' using errcode = 'P0001';
  end if;
  return new;
end $$;
create trigger voucher_guard before update or delete on voucher for each row execute function guard_voucher();

create table redemption (
  voucher_id uuid primary key references voucher,
  tenant_id uuid not null references tenant,
  entry_id bigint not null references ledger_entry,
  created_at timestamptz not null default now()
);
create trigger redemption_append_only before update or delete on redemption for each row execute function forbid_mutation();
