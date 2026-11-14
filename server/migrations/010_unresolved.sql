-- FR-015: a request whose process died after content may have gone out is UNRESOLVED; its hold stays until an admin decides.
alter table request drop constraint request_state_check;
alter table request add constraint request_state_check check (state in ('ADMITTED', 'STREAMING', 'SETTLED', 'SETTLED_ESTIMATED', 'FAILED', 'CANCELLED', 'UNRESOLVED', 'RESOLVED'));
create index request_open on request (created_at) where debit is null;
