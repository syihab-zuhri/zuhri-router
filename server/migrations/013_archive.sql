-- Models and upstreams that are no longer used can be archived: hidden from pickers, never routed to, history kept.
alter table public_model add column archived boolean not null default false;
alter table upstream add column archived boolean not null default false;
