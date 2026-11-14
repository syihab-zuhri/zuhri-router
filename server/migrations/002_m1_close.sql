-- Preserve 001; only additive M1 lifecycle changes.
alter table tenant add column version bigint not null default 1 check (version > 0);
alter table app_user add column anonymized_at timestamptz;
alter table app_user add constraint app_user_closed_identity
  check (status <> 'CLOSED' or anonymized_at is not null);
alter table app_user drop constraint app_user_username_check;
alter table app_user add constraint app_user_username_check
  check ((status = 'ACTIVE' and username ~ '^[a-z0-9_]{3,24}$')
      or (status = 'CLOSED' and username ~ '^closed_[0-9a-f]{32}$'));

-- A verifier reserves the former username without retaining it in the current profile.
create table retired_username (
  username_hash text primary key check (username_hash ~ '^[0-9a-f]{64}$')
);
create trigger retired_username_append_only before update or delete on retired_username
  for each row execute function forbid_mutation();

create function guard_closed_identity() returns trigger language plpgsql as $$
begin
  if old.status = 'CLOSED' then
    raise exception 'closed identity is immutable' using errcode = 'P0001';
  end if;
  return new;
end $$;
create trigger app_user_closed_identity before update on app_user
  for each row execute function guard_closed_identity();

create function guard_closed_tenant() returns trigger language plpgsql as $$
begin
  if old.status = 'CLOSED' and new.status <> 'CLOSED' then
    raise exception 'closed tenant cannot be reopened' using errcode = 'P0001';
  end if;
  return new;
end $$;
create trigger tenant_no_reopen before update on tenant
  for each row execute function guard_closed_tenant();
