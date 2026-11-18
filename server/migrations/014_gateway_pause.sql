-- Kill switch (TASK-018, SCR-014): while gateway_paused is 1 the gateway refuses new /v1 requests; admitted ones finish.
-- note holds the operator's reason while paused; updated_by/updated_at say who changed it last.
alter table system_setting add column note text check (note is null or length(note) between 1 and 200);
insert into system_setting(name, value) values ('gateway_paused', 0);

-- Admin request list across tenants (SCR-017) pages newest first.
create index request_created_page on request (created_at desc, id);
