-- 0020: per-tenant salt for the SDK's optimize mode (opt spec §4, M-opt-2).
--
-- The metering SDK fingerprints request/prefix SHAPES as salted hashes so they
-- can't be dictionary-attacked or cross-referenced (opt spec §2, §14). The salt
-- is a per-tenant secret the SDK fetches once with its ingest token. It is
-- generated lazily on first request and never leaves the tenant's own context.

ALTER TABLE tenant ADD COLUMN opt_salt text;
