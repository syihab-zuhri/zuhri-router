-- TASK-012 (FR-011): request metadata and upstream attempts. No prompt or response content is ever stored.

create table request (
  id text primary key check (id ~ '^req_[0-9a-f-]{36}$'),
  tenant_id uuid not null references tenant,
  api_key_id uuid not null,
  model_id text not null,
  protocol text not null check (protocol in ('CHAT', 'ANTHROPIC')),
  stream boolean not null,
  state text not null check (state in ('ADMITTED', 'STREAMING', 'SETTLED', 'SETTLED_ESTIMATED', 'FAILED', 'CANCELLED')),
  price_version_id uuid not null references price_version,
  price_snapshot jsonb not null,
  max_input integer not null,
  max_output integer not null,
  hold bigint not null,
  debit bigint,
  estimated boolean not null default false,
  bound_exceeded boolean not null default false,
  usage_raw jsonb,
  usage_norm jsonb,
  outcome text,
  created_at timestamptz not null default now(),
  settled_at timestamptz,
  foreign key (tenant_id, api_key_id) references api_key (tenant_id, id)
);
create index request_tenant_page on request (tenant_id, created_at desc, id);

create table attempt (
  id bigserial primary key,
  request_id text not null references request,
  seq integer not null,
  route_id uuid not null references route,
  outcome text not null,
  created_at timestamptz not null default now(),
  unique (request_id, seq)
);
