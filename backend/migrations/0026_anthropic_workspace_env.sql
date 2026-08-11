-- 0026: Anthropic workspace / API-key identity + environment classification.
--
-- Until now Anthropic inference cost was stored only as (provider, model, amount)
-- with the workspace_id awkwardly overloaded into `api_key_ref`. To separate
-- production inference from other Anthropic API spend we need explicit identity
-- columns and an environment label.
--
-- `environment` classifies each cost row:
--   production    — traffic from a production API key (name ends in "-prod")
--   development   — reserved for manual/dev classification (not auto-set yet)
--   internal      — reserved for manual/internal classification (not auto-set yet)
--   unclassified  — default; anything we can't yet prove is production
--
-- Additive + nullable only: every existing inference_cost row stays valid
-- (environment NULL satisfies the CHECK, which only constrains non-NULL values).

ALTER TABLE inference_cost ADD COLUMN workspace_id   text;
ALTER TABLE inference_cost ADD COLUMN workspace_name text;
ALTER TABLE inference_cost ADD COLUMN api_key_id     text;
ALTER TABLE inference_cost ADD COLUMN api_key_name   text;
ALTER TABLE inference_cost ADD COLUMN environment    text
    CHECK (environment IN ('production', 'development', 'internal', 'unclassified'));

-- Environment/workspace roll-ups per tenant+month (Cost Sources + Overview split).
CREATE INDEX inference_cost_env_idx ON inference_cost (tenant_id, period, environment);
