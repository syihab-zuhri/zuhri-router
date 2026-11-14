-- CR-013: the balance unit is the token credit, not Rupiah. Founder's model: a customer buys a token pack,
-- usage is charged as tokens x per-model multiplier, and may overrun the balance by a fixed allowance.
-- Internal unit stays integer micro (one millionth of a token credit), so decimal multipliers remain exact.
-- No customer money existed under the old label; rows are relabelled, amounts are untouched.

alter table ledger_account alter column currency set default 'TOKEN';
update ledger_account set currency = 'TOKEN';
alter table ledger_account add constraint ledger_account_currency_token check (currency = 'TOKEN');

alter table price_version disable trigger price_version_guard;
alter table price_version drop constraint price_version_currency_check;
alter table price_version alter column currency set default 'TOKEN';
update price_version set currency = 'TOKEN';
alter table price_version add constraint price_version_currency_check check (currency = 'TOKEN');
alter table price_version enable trigger price_version_guard;

create table system_setting (
  name text primary key,
  value bigint not null check (value >= 0),
  updated_by uuid, -- no foreign key: a setting must survive account cleanup
  updated_at timestamptz not null default now()
);
-- How far below zero a balance may go before new requests are refused: 500,000 token credits.
insert into system_setting(name, value) values ('overdraft_micro', 500000::bigint * 1000000);
