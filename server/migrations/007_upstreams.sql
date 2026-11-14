-- TASK-013 (FR-012): upstream registry and per-model routes. Upstream API keys are stored sealed (AES-256-GCM)
-- with a key held outside the database, and are write-only from the application.

create table upstream (
  id uuid primary key default gen_random_uuid(),
  name text not null unique check (length(name) between 1 and 80),
  status text not null default 'PENDING' check (status in ('PENDING', 'ELIGIBLE', 'BLOCKED')),
  base_url_chat text,
  base_url_anthropic text,
  base_url_responses text,
  key_enc text,
  key_set_at timestamptz,
  terms_note text not null default '' check (length(terms_note) <= 2000),
  version bigint not null default 1 check (version > 0),
  created_at timestamptz not null default now(),
  check ((key_enc is null) = (key_set_at is null))
);

create table route (
  id uuid primary key default gen_random_uuid(),
  model_id text not null references public_model,
  upstream_id uuid not null references upstream,
  protocol text not null check (protocol in ('CHAT', 'ANTHROPIC', 'RESPONSES')),
  upstream_model text not null check (upstream_model ~ '^[A-Za-z0-9][A-Za-z0-9_.:/\[\]-]{0,127}$'),
  priority integer not null default 100 check (priority between 1 and 1000),
  enabled boolean not null default true,
  max_concurrency integer check (max_concurrency between 1 and 100000),
  version bigint not null default 1 check (version > 0),
  created_at timestamptz not null default now(),
  unique (model_id, upstream_id, protocol)
);
create index route_lookup on route (model_id, protocol, priority);
