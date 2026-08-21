-- 0031: allow an 'estimated, not-yet-billed' inference source.
--
-- Anthropic's Cost Report lags usage by a day or two, so the most recent days of
-- the current month carry no billed dollars yet. We estimate that not-yet-billed
-- spend (self-calibrated from Anthropic's own effective $/token) and store it in
-- inference_cost under a distinct source so it is counted in the running total but
-- stays clearly separate from the authoritative bill (source='cost_api').
ALTER TABLE inference_cost DROP CONSTRAINT inference_cost_source_check;
ALTER TABLE inference_cost ADD CONSTRAINT inference_cost_source_check
    CHECK (source IN ('cost_api', 'cost_api_est', 'hook', 'self_host'));
