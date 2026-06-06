-- 0013: allow Amazon Bedrock as a cloud-cost inference connector.
--
-- Bedrock spend lives in AWS billing, not a model-provider API. The connector
-- reads AWS Cost Explorer (filtered to Bedrock, grouped by a cost-allocation
-- tag -> feature). Widen the stored-credential type CHECK to admit it; the AWS
-- key/secret/region/tag are stored as one encrypted JSON blob in the existing
-- ciphertext column. Additive: existing rows still satisfy the constraint.

ALTER TABLE connector_credential DROP CONSTRAINT connector_credential_connector_type_check;
ALTER TABLE connector_credential ADD CONSTRAINT connector_credential_connector_type_check
    CHECK (connector_type IN ('github', 'anthropic', 'openai', 'google', 'bedrock',
                              'openrouter', 'together', 'fireworks', 'cursor', 'copilot', 'codex'));
