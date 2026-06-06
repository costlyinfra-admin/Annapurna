-- 0010: allow fine-tuning runs as a build-cost "tool".
--
-- Fine-tuning an open-source model is a one-time GPU cost to *create* a feature's
-- model — so it belongs on the BUILD side, next to coding-tool spend (and never
-- blended with inference; invariant 2). It is directly attributed to a feature
-- (the customer knows which feature the run was for), so it lands at high
-- confidence. Widen the tool CHECK to admit it. Additive: existing rows still
-- satisfy the constraint.

ALTER TABLE build_cost DROP CONSTRAINT build_cost_tool_check;
ALTER TABLE build_cost ADD CONSTRAINT build_cost_tool_check
    CHECK (tool IN ('claude_code', 'cursor', 'copilot', 'codex', 'fine_tune'));
