-- 0034: split cache-WRITE tokens by cache TTL.
--
-- Anthropic prices cache writes by how long the entry lives: a 5-minute write
-- costs 1.25x the input rate, a 1-hour write 2x. Its Usage Report returns them as
-- a nested object (cache_creation.ephemeral_5m_input_tokens /
-- .ephemeral_1h_input_tokens) — which 0033's single flat column could not capture,
-- so cache writes never appeared at all.
--
-- cache_write_tokens (0033) remains the TOTAL; these two are its TTL detail, and
-- are NULL for providers that don't report a TTL.
ALTER TABLE inference_cost       ADD COLUMN cache_write_5m_tokens bigint;
ALTER TABLE inference_cost       ADD COLUMN cache_write_1h_tokens bigint;
ALTER TABLE inference_cost_daily ADD COLUMN cache_write_5m_tokens bigint;
ALTER TABLE inference_cost_daily ADD COLUMN cache_write_1h_tokens bigint;
