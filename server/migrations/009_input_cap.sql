-- CR-018: input tokens billed to the customer are capped at what the customer actually sent.
-- Tokens an upstream adds on its own are recorded here and borne by the business.
alter table request add column unbilled_input_tokens integer not null default 0 check (unbilled_input_tokens >= 0);
