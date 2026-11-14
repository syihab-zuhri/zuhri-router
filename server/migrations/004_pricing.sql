-- TASK-001 (FR-001): public model catalogue and versioned prices with one model multiplier.
-- Rates are integer micro-IDR per 1,000,000 tokens. multiplier_e4 is the factor scaled by 10,000.

create table public_model (
  id text primary key check (id ~ '^[A-Za-z0-9][A-Za-z0-9_.:/-]{0,127}$'),
  display_name text not null check (length(display_name) between 1 and 120),
  version bigint not null default 1 check (version > 0),
  created_by uuid not null references app_user,
  created_at timestamptz not null default now()
);

create table price_version (
  id uuid primary key default gen_random_uuid(),
  model_id text not null references public_model,
  seq integer not null check (seq > 0),
  status text not null default 'DRAFT' check (status in ('DRAFT', 'PUBLISHED', 'RETIRED')),
  currency text not null default 'IDR' check (currency = 'IDR'),
  input_rate bigint not null check (input_rate >= 0),
  output_rate bigint not null check (output_rate >= 0),
  cache_read_rate bigint not null check (cache_read_rate >= 0),
  cache_write_rate bigint not null check (cache_write_rate >= 0),
  multiplier_e4 bigint not null check (multiplier_e4 > 0),
  rate_as_of date,
  created_by uuid not null references app_user,
  created_at timestamptz not null default now(),
  published_by uuid references app_user,
  published_at timestamptz,
  retired_at timestamptz,
  unique (model_id, seq),
  check ((status = 'DRAFT' and published_at is null and retired_at is null)
      or (status = 'PUBLISHED' and published_at is not null and retired_at is null)
      or (status = 'RETIRED' and published_at is not null and retired_at is not null))
);
create unique index price_one_published on price_version (model_id) where status = 'PUBLISHED';
create unique index price_one_draft on price_version (model_id) where status = 'DRAFT';

-- A published price never changes: only PUBLISHED -> RETIRED is allowed, and nothing after that.
create function guard_price_version() returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    if old.status <> 'DRAFT' then raise exception 'published prices cannot be deleted' using errcode = 'P0001'; end if;
    return old;
  end if;
  if new.id <> old.id or new.model_id <> old.model_id or new.seq <> old.seq then
    raise exception 'price version identity is immutable' using errcode = 'P0001';
  end if;
  if old.status = 'DRAFT' then return new; end if;
  if old.status = 'RETIRED' or new.status <> 'RETIRED'
     or new.input_rate <> old.input_rate or new.output_rate <> old.output_rate
     or new.cache_read_rate <> old.cache_read_rate or new.cache_write_rate <> old.cache_write_rate
     or new.multiplier_e4 <> old.multiplier_e4 or new.currency <> old.currency
     or new.published_at <> old.published_at or new.published_by <> old.published_by then
    raise exception 'published prices are immutable' using errcode = 'P0001';
  end if;
  return new;
end $$;
create trigger price_version_guard before update or delete on price_version for each row execute function guard_price_version();
