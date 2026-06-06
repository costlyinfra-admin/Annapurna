-- 0012: allow Google Gemini as an inference connector.
--
-- Gemini joins Anthropic/OpenAI as a closed-source model provider. Its spend
-- lives in Google Cloud Billing (no per-key cost endpoint), so the connector
-- attributes by GCP project -> feature. Widen the stored-credential type CHECK.
-- Additive: existing rows still satisfy the constraint.

ALTER TABLE connector_credential DROP CONSTRAINT connector_credential_connector_type_check;
ALTER TABLE connector_credential ADD CONSTRAINT connector_credential_connector_type_check
    CHECK (connector_type IN ('github', 'anthropic', 'openai', 'google', 'openrouter',
                              'together', 'fireworks', 'cursor', 'copilot', 'codex'));
