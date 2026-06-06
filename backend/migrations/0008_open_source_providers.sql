-- 0008: open up inference to hosted open-source + self-hosted providers.
--
-- `provider` was a fixed 2-value CHECK ('anthropic','openai') from when those
-- were the only sources. Providers are now an open, growing set — hosted
-- open-source aggregators (Together, Fireworks, Groq, Bedrock, …) and customer
-- self-hosted GPU pools whose labels are arbitrary. We validate providers in
-- application code (pricing.PRICED_PROVIDERS + the compute-pool registry) rather
-- than a brittle DB enum that needs a migration per new host, so the CHECK is
-- dropped. `source` stays a small closed set, widened to include self-hosted
-- cost that is *allocated* from an infra pool rather than metered per token.
--
-- Additive only: every existing row still satisfies the new constraints.

ALTER TABLE inference_cost DROP CONSTRAINT inference_cost_provider_check;
ALTER TABLE bill_reconciliation DROP CONSTRAINT bill_reconciliation_provider_check;

ALTER TABLE inference_cost DROP CONSTRAINT inference_cost_source_check;
ALTER TABLE inference_cost ADD CONSTRAINT inference_cost_source_check
    CHECK (source IN ('cost_api', 'hook', 'self_host'));
