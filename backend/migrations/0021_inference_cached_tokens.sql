-- 0021: cached input tokens on inference rows (opt spec §8, M-opt-5, Tier A).
--
-- Provider cost/usage APIs report how much input was served from their prompt
-- cache (Anthropic cache_read_input_tokens, OpenAI cached_tokens) — data the
-- connectors previously discarded. Storing it lets us show current cache
-- utilization per feature WITHOUT the SDK, and gives the caching recommendation
-- a floor (don't recommend caching what's already cached). Nullable: only rows
-- from providers that report it populate it.

ALTER TABLE inference_cost ADD COLUMN cached_tokens_in bigint;
