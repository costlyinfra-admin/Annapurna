-- 0017: eight more inference connectors.
--
-- Single-vendor inference APIs (groq, mistral, xai, perplexity, cohere,
-- replicate) and two more gateways (portkey, helicone). The single-vendor ones
-- take a plain API key; the gateways take a JSON {api_key, url?} blob. All reuse
-- connector_credential.ciphertext. Widen the credential type CHECK to accept them.

ALTER TABLE connector_credential DROP CONSTRAINT connector_credential_connector_type_check;
ALTER TABLE connector_credential ADD CONSTRAINT connector_credential_connector_type_check
    CHECK (connector_type IN ('github', 'anthropic', 'openai', 'google', 'bedrock', 'openrouter',
                              'together', 'fireworks', 'okta', 'entra', 'cursor', 'copilot',
                              'codex', 'azure', 'litellm', 'vercel', 'modal', 'elevenlabs',
                              'groq', 'mistral', 'xai', 'perplexity', 'cohere', 'replicate',
                              'portkey', 'helicone'));
