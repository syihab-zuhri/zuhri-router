create table api_key (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenant,
  name text not null check (length(name) between 1 and 80),
  prefix text not null check (length(prefix) = 12),
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  creation_key_hash text not null check (creation_key_hash ~ '^[0-9a-f]{64}$'),
  allowed_models text[],
  spend_limit bigint check (spend_limit >= 0),
  spent bigint not null default 0 check (spent >= 0),
  held bigint not null default 0 check (held >= 0),
  expires_at timestamptz,
  status text not null default 'ACTIVE' check (status in ('ACTIVE','REVOKED')),
  version bigint not null default 1 check (version > 0),
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at timestamptz,
  unique (tenant_id, creation_key_hash),
  unique (tenant_id, id),
  check ((status = 'ACTIVE' and revoked_at is null) or (status = 'REVOKED' and revoked_at is not null))
);
create index api_key_tenant_page on api_key(tenant_id, id);

alter table hold add column tenant_id uuid references tenant;
alter table hold add column api_key_id uuid;
alter table hold add constraint hold_key_tenant foreign key (tenant_id, api_key_id) references api_key(tenant_id, id);
alter table hold add constraint hold_key_has_tenant check (api_key_id is null or tenant_id is not null);
alter table ledger_account add constraint ledger_account_tenant_account_pair unique (tenant_id, id);
alter table hold add constraint hold_account_tenant foreign key (tenant_id, account_id) references ledger_account(tenant_id, id);
alter table hold add column settled_debit bigint check (settled_debit >= 0);

create function guard_api_key_identity() returns trigger language plpgsql as $$
begin
  if new.tenant_id <> old.tenant_id or new.token_hash <> old.token_hash or new.prefix <> old.prefix
     or new.creation_key_hash <> old.creation_key_hash or new.id <> old.id then
    raise exception 'API key identity is immutable' using errcode = 'P0001';
  end if;
  if old.status = 'REVOKED' and new.status <> 'REVOKED' then
    raise exception 'revoked API key cannot be restored' using errcode = 'P0001';
  end if;
  return new;
end $$;
create trigger api_key_immutable_identity before update on api_key for each row execute function guard_api_key_identity();
