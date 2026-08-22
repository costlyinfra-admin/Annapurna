-- 0033: track cache-WRITE (cache-creation) input tokens separately.
--
-- Providers bill four distinct token types: uncached input, cache writes (cache
-- creation, billed at a premium), cache reads (billed at a discount), and output.
-- We stored only tokens_in (which folded cache writes in) and cached_tokens_in
-- (cache reads), so a cache write was indistinguishable from ordinary input.
-- Splitting it out lets the Overview show inference cost BY TOKEN TYPE.
--
-- tokens_in remains the TOTAL input (uncached + cache write + cache read), so
-- existing totals and reconciliation are unchanged; this column is a detail of it.
ALTER TABLE inference_cost       ADD COLUMN cache_write_tokens bigint;
ALTER TABLE inference_cost_daily ADD COLUMN cache_write_tokens bigint;
