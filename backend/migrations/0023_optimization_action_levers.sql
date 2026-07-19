-- 0023: allow all four measured levers to be marked applied (opt spec §18, M-opt-9).
--
-- 0022 restricted optimization_action.lever to the two levers that existed then
-- (duplicate_calls, prompt_caching). Provider switch and model right-sizing shipped
-- since (M-opt-7/8) and their cards carry the same "Mark as applied" control, so the
-- reconciliation loop must accept them too.

ALTER TABLE optimization_action DROP CONSTRAINT optimization_action_lever_check;
ALTER TABLE optimization_action ADD CONSTRAINT optimization_action_lever_check
    CHECK (lever IN ('duplicate_calls', 'prompt_caching', 'provider_switch', 'model_rightsizing'));
