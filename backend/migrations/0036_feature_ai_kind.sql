-- 0036: is a feature an AI feature, or an ordinary one?
--
-- Not every feature in a customer's GitHub calls a model. A login page built with
-- Claude Code has real BUILD cost and no inference cost at all — it belongs on the
-- dashboard (someone spent AI money making it) but it is not an AI feature, and
-- reading it as one distorts every per-feature comparison.
--
-- Two columns, following resource_classification's rule that a person's decision
-- outlives the heuristics that guessed before them:
--   ai_kind         — 'ai' | 'non_ai'; NULL until something determines it
--   ai_kind_source  — who decided: 'discovery' (keyword heuristic over the PR
--                     evidence) or 'user' (someone set it by hand)
--
-- A third source exists but is NOT stored: a feature with inference cost against
-- it demonstrably calls models. That is evidence, not a guess, and it is resolved
-- at read time so it can never go stale — see dashboard.resolve_ai_kind. The
-- precedence is user > inference evidence > discovery guess, and re-running
-- discovery never overwrites ai_kind_source = 'user'.

ALTER TABLE feature ADD COLUMN ai_kind text CHECK (ai_kind IN ('ai', 'non_ai'));
ALTER TABLE feature ADD COLUMN ai_kind_source text
    CHECK (ai_kind_source IN ('discovery', 'user'));
