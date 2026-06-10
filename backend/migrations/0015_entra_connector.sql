-- 0015: allow Microsoft Entra ID (Azure AD) as a seat-source identity provider.
--
-- Entra joins Okta for SSO/SCIM seat rosters. Its OAuth client-credentials
-- (tenant_id/client_id/client_secret) are stored as one encrypted JSON blob in
-- the existing connector_credential.ciphertext. Widen the credential type CHECK.
-- The seat_source.provider column already accepts any provider string ('entra').

ALTER TABLE connector_credential DROP CONSTRAINT connector_credential_connector_type_check;
ALTER TABLE connector_credential ADD CONSTRAINT connector_credential_connector_type_check
    CHECK (connector_type IN ('github', 'anthropic', 'openai', 'google', 'bedrock', 'openrouter',
                              'together', 'fireworks', 'okta', 'entra', 'cursor', 'copilot',
                              'codex'));
