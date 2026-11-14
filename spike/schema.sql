-- TASK-006 spike schema. NOT the production schema.
drop table if exists attempt, request, route, price, api_key, ledger_entry, ledger_account cascade;
create table ledger_account (
  id bigserial primary key, tenant text unique not null, currency text not null default 'IDR',
  posted bigint not null default 0, held bigint not null default 0, check (held >= 0));
create table ledger_entry (
  id bigserial primary key, account_id bigint not null references ledger_account,
  kind text not null, amount bigint not null, source_id text not null,
  created_at timestamptz not null default now(), unique (kind, source_id));
create table api_key (key_hash text primary key, tenant text not null, status text not null default 'ACTIVE');
create table price (model text primary key, version int not null, input_rate bigint not null,
  output_rate bigint not null, cache_read_rate bigint not null, multiplier_e4 bigint not null);
create table route (id serial primary key, model text not null, protocol text not null,
  upstream_url text not null, upstream_model text not null, priority int not null, enabled boolean not null default true);
create table request (id text primary key, tenant text not null, model text not null, protocol text not null,
  state text not null, price_snapshot jsonb not null, hold bigint not null, debit bigint,
  estimated boolean not null default false, usage_raw jsonb, usage_norm jsonb, created_at timestamptz not null default now());
create table attempt (id bigserial primary key, request_id text not null, route_id int not null, seq int not null, outcome text not null);
