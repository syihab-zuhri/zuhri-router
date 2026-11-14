-- Responses surface (OpenAI Responses API), stateless mode only.
alter table request drop constraint request_protocol_check;
alter table request add constraint request_protocol_check check (protocol in ('CHAT', 'ANTHROPIC', 'RESPONSES'));
