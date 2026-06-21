-- 0016: more inference connectors — Azure OpenAI, gateways, compute, audio.
--
-- Adds Azure (Azure Cost Management), LiteLLM + Vercel AI Gateway (proxy spend
-- reports), Modal (compute billing), and ElevenLabs (character usage). The
-- JSON-credential ones (azure/litellm/vercel/modal) reuse the existing
-- connector_credential.ciphertext blob; ElevenLabs stores a plain API key.
-- Widen the credential type CHECK to accept them.

ALTER TABLE connector_credential DROP CONSTRAINT connector_credential_connector_type_check;
ALTER TABLE connector_credential ADD CONSTRAINT connector_credential_connector_type_check
    CHECK (connector_type IN ('github', 'anthropic', 'openai', 'google', 'bedrock', 'openrouter',
                              'together', 'fireworks', 'okta', 'entra', 'cursor', 'copilot',
                              'codex', 'azure', 'litellm', 'vercel', 'modal', 'elevenlabs'));
