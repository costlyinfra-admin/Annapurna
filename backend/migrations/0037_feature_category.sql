-- 0037: what KIND of feature is this — the product surface it lives on.
--
-- Replaces the AI / Non-AI mark (0036) as the Overview's "Type" column. The
-- binary answered "does it call a model"; this answers the more useful question
-- "what is it", across a whole product rather than only its AI half.
--
--   category        chat | api | ui | docs | data | auth | reporting |
--                   integration | infra;  NULL = untagged
--   category_source 'discovery' (keyword read of the PR evidence) or 'user'
--
-- Same rule as resource_classification and 0036 before it: a person's tag
-- outlives the guess, and re-running discovery never overwrites
-- category_source = 'user'.
--
-- 0036's ai_kind / ai_kind_source columns are left in place and no longer read
-- by the UI. They are nullable and cost nothing; discovery still computes AI-ness
-- internally because it helps tell a Chat feature from an ordinary UI one.

ALTER TABLE feature ADD COLUMN category text
    CHECK (category IN ('chat', 'api', 'ui', 'docs', 'data',
                        'auth', 'reporting', 'integration', 'infra'));
ALTER TABLE feature ADD COLUMN category_source text
    CHECK (category_source IN ('discovery', 'user'));
