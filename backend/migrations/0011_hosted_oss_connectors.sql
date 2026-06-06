-- 0011: allow hosted open-source aggregators as inference connectors.
--
-- Together, Fireworks, and OpenRouter front open-weight models behind one API
-- key and bill per token, so they're first-class inference connectors (admin
-- key -> pull the bill -> attribute by api_key -> feature), just like
-- Anthropic/OpenAI. Widen the stored-credential type CHECK to admit them.
-- Additive: existing rows still satisfy the constraint.

ALTER TABLE connector_credential DROP CONSTRAINT connector_credential_connector_type_check;
ALTER TABLE connector_credential ADD CONSTRAINT connector_credential_connector_type_check
    CHECK (connector_type IN ('github', 'anthropic', 'openai', 'openrouter', 'together',
                              'fireworks', 'cursor', 'copilot', 'codex'));
